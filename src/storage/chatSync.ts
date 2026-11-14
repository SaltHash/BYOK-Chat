/* Per-message chat sync.
 *
 * The opt-in chat store keeps each message as its own row on the server, sealed
 * with the same token-derived key as the settings snapshot. A device pulls
 * only the rows after its last sequence, so it never re-downloads a message it
 * already has, and one edited message moves one row.
 *
 * The conversion between the delta engine's chat operations and the server's
 * row shape lives here so both sides stay in lockstep:
 *
 *   delta op { id, meta, order, add[], update[], del[] }
 *        <-> chat row { chatId, meta, order, seq }
 *        <-> message rows { chatId, id, body, ord, seq, deleted }
 *
 * Uploaded message bodies and chat metadata are encrypted individually; the
 * server stores opaque envelopes and can never read a conversation.
 */

import { decryptChatPart, encryptChatPart, type SyncEnvelope } from './sync'
import type { SyncDelta } from './syncDelta'

export type SyncSealedMessage = { id: string; body: SyncEnvelope }

export type SyncChatPushOp = {
  id: string
  meta?: SyncEnvelope
  order?: string[]
  add?: SyncSealedMessage[]
  update?: SyncSealedMessage[]
  del?: string[]
}

export type SyncChatPush = { ops?: SyncChatPushOp[]; del?: string[] }

export type SyncChatRow = {
  chatId: string
  meta?: unknown
  order?: string[]
  seq?: number
  at?: number
  deleted?: boolean
}

export type SyncMessageRow = {
  chatId: string
  id: string
  body?: unknown
  ord?: number
  seq?: number
  at?: number
  deleted?: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Encrypt a delta's chat operations for upload. Returns undefined when there
 *  is nothing to send, so a settings-only push stays a settings-only push. */
export async function encryptChatPush(chats: SyncDelta['chats'], token: string): Promise<SyncChatPush | undefined> {
  if (!chats) return undefined
  const ops: SyncChatPushOp[] = []
  for (const op of chats.ops ?? []) {
    if (!op || typeof op.id !== 'string') continue
    const out: SyncChatPushOp = { id: op.id }
    if (op.meta && isObj(op.meta)) out.meta = await encryptChatPart(op.meta, token, 'chat')
    if (Array.isArray(op.order)) out.order = op.order
    // Each entry keeps its id in the clear so the server can address one row
    // per message; the body is sealed. The id is a random local identifier,
    // never the message text.
    const seal = async (message: unknown) => {
      const id = isObj(message) && typeof message.id === 'string' ? message.id : ''
      return id ? { id, body: await encryptChatPart(message, token, 'message') } : null
    }
    if (op.add?.length) out.add = (await Promise.all(op.add.map(seal))).filter((m): m is SyncSealedMessage => !!m)
    if (op.update?.length) out.update = (await Promise.all(op.update.map(seal))).filter((m): m is SyncSealedMessage => !!m)
    if (op.del?.length) out.del = op.del
    ops.push(out)
  }
  const del = Array.isArray(chats.del) ? chats.del : []
  if (!ops.length && !del.length) return undefined
  return { ...(ops.length ? { ops } : {}), ...(del.length ? { del } : {}) }
}

/** A first sync can hold many thousands of messages; one request would hit
 *  the 8 MB transport cap. Chunks keep every request small enough to send and
 *  are idempotent, so a retry after a lost response is safe. */
export const CHAT_PUSH_MAX_OPS = 200
export const CHAT_PUSH_MAX_CHARS = 1_400_000

export async function encryptChatPushChunks(chats: SyncDelta['chats'], token: string): Promise<SyncChatPush[]> {
  if (!chats) return []
  const out: SyncChatPush[] = []
  const del = Array.isArray(chats.del) ? chats.del.filter((id) => typeof id === 'string') : []
  // Deletions go first: a later chunk must never re-create a chat that this
  // push is removing.
  for (let i = 0; i < del.length; i += CHAT_PUSH_MAX_OPS) out.push({ del: del.slice(i, i + CHAT_PUSH_MAX_OPS) })

  const ops = (chats.ops ?? []).filter((op) => op && typeof op.id === 'string')
  let group: typeof ops = []
  let size = 0
  const flush = async () => {
    if (!group.length) return
    const push = await encryptChatPush({ ops: group }, token)
    if (push) out.push(push)
    group = []
    size = 0
  }
  for (const op of ops) {
    const opSize = JSON.stringify(op).length
    if (group.length && (group.length >= CHAT_PUSH_MAX_OPS || size + opSize > CHAT_PUSH_MAX_CHARS)) await flush()
    group.push(op)
    size += opSize
  }
  await flush()
  return out
}

/** Decrypt the rows a pull returned into a delta the merge engine understands.
 *  Returns null when the server sent no chat changes at all. */
export async function chatChangesToDelta(
  chatRows: SyncChatRow[] | undefined,
  messageRows: SyncMessageRow[] | undefined,
  token: string,
): Promise<SyncDelta | null> {
  const chats = Array.isArray(chatRows) ? chatRows : []
  const messages = Array.isArray(messageRows) ? messageRows : []
  if (!chats.length && !messages.length) return null

  let at = 0
  for (const row of [...chats, ...messages]) if (Number.isFinite(row?.at) && (row.at as number) > at) at = row.at as number
  const delta: SyncDelta = { v: 1, at: at || Date.now() }
  const deletedChats: string[] = []
  const ops = new Map<string, { meta?: Record<string, unknown>; order?: string[]; add: unknown[]; del: string[]; firstSeq: number }>()

  // Decrypt in parallel: a first link may return thousands of rows, and each
  // AES-GCM open is independent once the token key is derived.
  const openedChats = await Promise.all(chats.map(async (row) => {
    if (!row || typeof row.chatId !== 'string' || row.deleted) return { row, meta: null }
    const meta = isObj(row.meta) || typeof row.meta === 'string'
      ? await decryptChatPart(row.meta, token, 'chat').catch(() => null)
      : null
    return { row, meta }
  }))
  const openedMessages = await Promise.all(messages.map(async (row) => {
    if (!row || typeof row.chatId !== 'string' || typeof row.id !== 'string' || row.deleted) return { row, message: null }
    const message = await decryptChatPart(row.body, token, 'message').catch(() => null)
    return { row, message }
  }))

  for (const { row, meta } of openedChats) {
    if (!row || typeof row.chatId !== 'string') continue
    if (row.deleted) { deletedChats.push(row.chatId); continue }
    const entry = ops.get(row.chatId) ?? { add: [], del: [], firstSeq: Number(row.seq) || 0 }
    if (isObj(meta)) entry.meta = meta
    if (Array.isArray(row.order)) entry.order = row.order.filter((id): id is string => typeof id === 'string')
    ops.set(row.chatId, entry)
  }

  for (const { row, message } of openedMessages) {
    if (!row || typeof row.chatId !== 'string' || typeof row.id !== 'string') continue
    const entry = ops.get(row.chatId) ?? { add: [], del: [], firstSeq: Number(row.seq) || 0 }
    if (row.deleted) entry.del.push(row.id)
    else if (isObj(message)) entry.add.push({ ...message, id: row.id })
    ops.set(row.chatId, entry)
  }

  if (deletedChats.length) delta.chats = { del: [...new Set(deletedChats)] }
  const chatOps = [...ops.entries()]
    .sort((a, b) => a[1].firstSeq - b[1].firstSeq)
    .map(([id, entry]) => {
      const op: NonNullable<NonNullable<SyncDelta['chats']>['ops']>[number] = { id }
      if (entry.meta) op.meta = { ...entry.meta, id }
      if (entry.add.length) op.add = entry.add
      if (entry.order?.length) op.order = entry.order
      if (entry.del.length) op.del = entry.del
      if (entry.add.length || entry.order?.length) {
        // Keep a stable order even when the server's row order is only the
        // sparse set of changed messages.
        const seen = new Set(entry.order ?? [])
        for (const message of entry.add) {
          const messageId = isObj(message) && typeof message.id === 'string' ? message.id : ''
          if (messageId && !seen.has(messageId)) { (op.order ??= []).push(messageId); seen.add(messageId) }
        }
      }
      return op
    })
    // A row that could not be opened carries nothing to apply: do not turn it
    // into an empty operation that would still bump the local sequence.
    .filter((op) => op.meta !== undefined || op.add !== undefined || op.order !== undefined || op.del !== undefined)
  if (chatOps.length) delta.chats = { ...(delta.chats ?? {}), ops: chatOps }
  return delta.chats ? delta : null
}
