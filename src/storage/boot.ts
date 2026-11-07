/* Durable boot: automatic in-place migration + hydration.
 * Strategy (backwards compatible):
 * - zustand persist `byok.v1` in localStorage stays the fast-boot source.
 * - Every change mirrors full chats/workspaces (+ attachment bytes) to
 *   IndexedDB/OPFS (debounced). localStorage keeps the pruned copy.
 * - On boot, if durable holds chats/workspaces, they win when localStorage
 *   was quota-pruned (smaller/fewer messages). Attachment bytes are restored
 *   from blob storage. Settings are never overwritten by durable.
 * - The main localStorage value is only an index/settings row. Chat rows are
 *   validated independently and the index is rebuilt when it is damaged, so a
 *   bad record or interrupted write cannot block the whole app. */
import { durableGetChats, durableGetWorkspaces, durablePutChats, durablePutWorkspaces, durableSetMeta, durableGetMeta, blobDel, blobPut, blobGet, splitPersistedForDurable, compactChatsForDurable } from './durable'
import { CHAT_SHARD_PREFIX, QUOTA_FLAG, reportStorageFailure, reportStorageRecovery, STORE_VERSION, withoutExpiredTemps } from '../persistence'

const CHATS_DEBOUNCE_MS = 1200
let timer: ReturnType<typeof setTimeout> | null = null
let pendingMirror: { chats: unknown; workspaces: unknown } | null = null
let mirrorWrites: Promise<void> = Promise.resolve()

export function blobIdFor(msgId: string, index: number, name: string): string {
  return `${msgId}:${index}:${name}`.slice(0, 180)
}

export async function persistAttachmentBytes(msgId: string, att: Array<{ name: string; data?: string; text?: string }>): Promise<void> {
  await Promise.all(att.map((a, i) => {
    const payload = a.data ?? a.text ?? ''
    if (!payload) return Promise.resolve()
    return blobPut(blobIdFor(msgId, i, a.name), payload).then(() => {}).catch(reportStorageFailure)
  }))
}

/* Remove durable blobs for messages that no longer exist (a deleted message
 * or a deleted chat): otherwise erased attachments linger in IndexedDB/OPFS
 * with no reference left to find them. */
export async function dropAttachmentBytes(msgs: Array<{ id: string; att?: Array<{ name: string; kind: string }> }>): Promise<void> {
  await Promise.all(msgs.flatMap((m) => (m.att ?? []).map((a, i) => blobDel(blobIdFor(m.id, i, a.name)).catch(() => {}))))
}

export async function restoreAttachmentBytes(chats: Array<{ msgs: Array<{ id: string; att?: Array<{ name: string; kind: string; data?: string; text?: string }> }> }>): Promise<number> {
  let restored = 0
  for (const c of chats) {
    for (const m of c.msgs) {
      if (!m.att?.length) continue
      for (let i = 0; i < m.att.length; i++) {
        const a = m.att[i]
        // Blobs carry both binary (img/pdf) and extracted text (txt, docs,
        // transcripts, OCR): restore whichever side the pruned localStorage
        // copy dropped.
        if (a.data ?? a.text) continue
        try {
          const v = await blobGet(blobIdFor(m.id, i, a.name))
          if (v) {
            if (a.kind === 'img' || a.kind === 'pdf') a.data = v
            else a.text = v
            restored++
          }
        } catch { /* ignore */ }
      }
    }
  }
  return restored
}

type LocalSnapshot = { state: Record<string, unknown>; version: number; missing: string[]; repaired: boolean }
type StoredChat = { id: string; msgs: unknown[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isStoredChat = (value: unknown, id: string): value is StoredChat =>
  isRecord(value) && value.id === id && Array.isArray(value.msgs)

const isLiveChat = (value: unknown): boolean =>
  isRecord(value) && Array.isArray(value.msgs) && value.msgs.length > 0

/** Merge record sets by primary key. The index and the rows can disagree after
 *  an interrupted write; keep the first copy of each id instead of replacing a
 *  whole chat with a partial one. Records without an id are appended once. */
function mergeChats(...groups: unknown[]): unknown[] {
  const out: unknown[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const chat of group) {
      const id = isRecord(chat) && typeof chat.id === 'string' ? chat.id : ''
      if (id) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      out.push(chat)
    }
  }
  return out
}

/** Every chat is a row under its own localStorage key. Read them by prefix,
 *  validating each row independently, so one bad row cannot hide the rest. */
function scanChatShards(): { chats: StoredChat[]; ids: Set<string> } {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) keys.push(key)
  }
  const chats: StoredChat[] = []
  const ids = new Set<string>()
  for (const key of keys) {
    if (!key.startsWith(CHAT_SHARD_PREFIX)) continue
    const id = key.slice(CHAT_SHARD_PREFIX.length)
    if (!id || ids.has(id)) continue
    const raw = localStorage.getItem(key)
    if (raw == null) continue
    try {
      const chat: unknown = JSON.parse(raw)
      if (isStoredChat(chat, id)) {
        chats.push(chat)
        ids.add(id)
      }
    } catch { /* a bad row is reported as missing if the index names it */ }
  }
  return { chats, ids }
}

/** Read the small main record plus every chat row. The main record is only an
 *  index/settings row: if it is damaged, valid chat rows are still recovered.
 *  Throws only when localStorage itself is inaccessible, not when data is bad. */
function readLocal(): LocalSnapshot | null {
  const raw = localStorage.getItem('byok.v1')
  const shards = scanChatShards()
  if (raw === null && !shards.chats.length) return null

  let state: Record<string, unknown> = {}
  let version = STORE_VERSION
  let mainValid = false
  let indexIds: string[] | null = null
  let indexCorrupt = false

  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed)) {
        const candidate = 'state' in parsed ? parsed.state : parsed
        if (isRecord(candidate)) {
          state = candidate
          mainValid = true
          const parsedVersion = Number(parsed.version)
          if (Number.isFinite(parsedVersion) && parsedVersion > 0) version = parsedVersion
          if (state.__byokSharded === true) {
            const ids = state.__byokChatIds
            if (Array.isArray(ids) && ids.every((id) => typeof id === 'string' && !!id)) {
              indexIds = [...new Set(ids as string[])]
            } else {
              indexCorrupt = true
            }
          }
        }
      }
    } catch { /* fall through to the row scan below */ }
  }

  // With a healthy index, its rows are authoritative; orphaned keys may be
  // leftovers from a delete and must not resurrect chats. Without one, every
  // valid row is a recovery candidate.
  const useAllRows = !mainValid || indexCorrupt
  const rows = indexIds ? shards.chats.filter((chat) => indexIds!.includes(chat.id)) : useAllRows ? shards.chats : []
  const embedded = Array.isArray(state.chats) ? state.chats : []
  const chats = mergeChats(embedded, rows)
  const missing = indexIds ? indexIds.filter((id) => !shards.ids.has(id)) : []
  return {
    state: { ...state, chats },
    version,
    missing,
    repaired: !mainValid || indexCorrupt || missing.length > 0 || (raw === null && shards.chats.length > 0),
  }
}

/* Automatic in-place migration: local shards are authoritative for ordinary
 * writes; a richer durable copy is used only after a reported quota failure or
 * when the local snapshot is missing. */
export async function hydrateDurable(patch: (p: Record<string, unknown>) => void, initial?: Record<string, unknown>): Promise<{ migrated: boolean; restoredBlobs: number; backend: string }> {
  let migrated = false
  // Snapshot local state and the quota marker before any asynchronous read.
  const saved = readLocal()
  const quota = (() => { try { return !!localStorage.getItem(QUOTA_FLAG) } catch { return false } })()
  const local = saved ? (() => {
    const state = { ...saved.state, ...(initial ?? {}) }
    const initialChats = Array.isArray(initial?.chats) ? initial.chats : []
    const recoveredChats = Array.isArray(saved.state.chats) ? saved.state.chats : []
    state.chats = mergeChats(initialChats, recoveredChats)
    if (saved.state.workspaces && (!isRecord(state.workspaces) || !Object.keys(state.workspaces).length)) {
      state.workspaces = saved.state.workspaces
    }
    return { ...saved, state }
  })() : saved
  try {
    const meta = await durableGetMeta()
    let [dChats, dWs] = await Promise.all([durableGetChats<unknown[]>(), durableGetWorkspaces<Record<string, unknown>>()])
    if (local && !quota && !local.missing.length && (local.state.chats || local.state.workspaces) && !meta?.migratedAt) {
      const { chats, workspaces } = splitPersistedForDurable(local.state)
      // Do not overwrite an existing durable copy just because migration
      // metadata is absent; it may contain the only full history.
      if (dChats == null) { await durablePutChats(chats); dChats = chats as unknown[] }
      if (dWs == null) { await durablePutWorkspaces(workspaces); dWs = workspaces as Record<string, unknown> }
      await durableSetMeta({ migratedAt: Date.now(), storeVersion: local.version })
      migrated = true
    }
    // An indexed row may be missing or truncated after interruption. Restore
    // those IDs from durable, never unrelated chats deleted locally. A row that
    // cannot be found anywhere is skipped instead of aborting the whole boot.
    if (local?.missing.length) {
      const recovered = new Map((Array.isArray(dChats) ? dChats : []).filter((c): c is { id: string; msgs: unknown[] } => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string' && Array.isArray((c as { msgs?: unknown }).msgs)).map(c => [c.id, c]))
      const found = local.missing.map(id => recovered.get(id)).filter((c): c is { id: string; msgs: unknown[] } => !!c)
      const chats = mergeChats(local.state.chats, found)
      local.state = { ...local.state, chats }
      patch({ chats })
    }
    const localMsgs = Array.isArray(local?.state.chats) ? (local!.state.chats as Array<{ msgs?: unknown[] }>).reduce((a, c) => a + (c.msgs?.length ?? 0), 0) : 0
    const durableMsgs = Array.isArray(dChats) ? (dChats as Array<{ msgs: unknown[] }>).reduce((a, c) => a + (c.msgs?.length ?? 0), 0) : 0
    let restoredBlobs = 0
    // A larger old mirror is not proof of a quota prune: a user may have
    // deliberately deleted messages or chats since it was written. It is only
    // safe to take the whole mirror when local storage has no readable chats.
    const useAllDurable = Array.isArray(dChats) && (!local || (!!saved?.repaired && localMsgs === 0 && durableMsgs > 0))
    const useDurableChats = Array.isArray(dChats) && (useAllDurable || (quota && durableMsgs > localMsgs))
    if (useDurableChats && dChats) {
      // With a local index, recover richer content only for IDs that still
      // exist locally. A stale mirror must not resurrect deleted chats.
      const selected = useAllDurable ? dChats : (local!.state.chats as Array<{ id?: unknown }>).map(c => {
        const durable = dChats.find(d => (d as { id?: unknown })?.id === c.id) as { msgs?: unknown[] } | undefined
        const current = c as { msgs?: unknown[] }
        return durable && (durable.msgs?.length ?? 0) > (current.msgs?.length ?? 0) ? durable : c
      })
      restoredBlobs = await restoreAttachmentBytes(selected as Parameters<typeof restoreAttachmentBytes>[0]).catch(() => 0)
      const p: Record<string, unknown> = {}
      // Empty chats are not store entries anymore: strip leftovers from both
      // storage tiers so a durable copy cannot resurrect them.
      p.chats = withoutExpiredTemps(selected.filter((c) => Array.isArray((c as { msgs?: unknown[] })?.msgs) && (c as { msgs: unknown[] }).msgs.length > 0) as Array<{ temporary?: boolean; expiresAt?: number }>)
      // An empty durable map must not wipe the workspaces that localStorage
      // still holds (the durable copy can be empty after a quota prune).
      if (dWs && Object.keys(dWs).length) p.workspaces = dWs
      if (Object.keys(p).length) patch(p)
    } else if (Array.isArray(local?.state.chats)) {
      const chats = (local.state.chats as Parameters<typeof restoreAttachmentBytes>[0]).map(c => ({ ...c, msgs: c.msgs.map(m => ({ ...m, ...(m.att ? { att: m.att.map(a => ({ ...a })) } : {}) })) }))
      restoredBlobs = await restoreAttachmentBytes(chats).catch(() => 0)
      if (restoredBlobs) {
        local.state = { ...local.state, chats }
        patch({ chats })
      }
    }
    // Repairing the index is a normal boot, not a fatal error: publish the
    // recovered rows to the live store and tell the user to keep a backup.
    if (saved?.repaired) {
      reportStorageRecovery()
      if (!useDurableChats) {
        const chats = withoutExpiredTemps((Array.isArray(local?.state.chats) ? local.state.chats : []).filter(isLiveChat) as Array<{ temporary?: boolean; expiresAt?: number }>)
        patch({ chats })
      }
    }
    const { durableUsage } = await import('./durable')
    const u = await durableUsage().catch(() => null)
    return { migrated, restoredBlobs, backend: u?.backend ?? 'memory' }
  } catch {
    // Durable storage can be blocked or unavailable. The validated local rows
    // are still usable, so boot them instead of replacing the whole app with an
    // error page. localStorage itself being inaccessible is thrown by readLocal
    // before this try and remains a hard failure.
    if (saved?.repaired && local) {
      const chats = withoutExpiredTemps((Array.isArray(local.state.chats) ? local.state.chats : []).filter(isLiveChat) as Array<{ temporary?: boolean; expiresAt?: number }>)
      patch({ chats })
      reportStorageRecovery()
      return { migrated, restoredBlobs: 0, backend: 'memory' }
    }
    reportStorageFailure()
    return { migrated, restoredBlobs: 0, backend: 'memory' }
  }
}

/* Debounced mirror of full chats/workspaces to durable (fire-and-forget).
 * Coalesces bursts — a streamed reply updates the store many times per
 * second — into a single write per window, using the newest arguments. */
export function mirrorToDurable(chats: unknown, workspaces: unknown): void {
  if (eraseInProgress) return
  pendingMirror = { chats, workspaces }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; flushDurableMirror() }, CHATS_DEBOUNCE_MS)
}

function flushDurableMirror(): void {
  const p = pendingMirror
  pendingMirror = null
  if (!p) return
  mirrorWrites = mirrorWrites.then(async () => {
    if (eraseInProgress) return
    await Promise.all([durablePutChats(p.chats), durablePutWorkspaces(p.workspaces)])
  }).catch(reportStorageFailure)
}

/* The debounce window can swallow UI edits when the tab closes; flush the
 * newest mirror payload at pagehide so durable is not staler than the
 * session (a stale durable copy resurrects deleted messages on next boot). */
if (typeof window !== 'undefined') {
  const onHide = () => { if (timer) { clearTimeout(timer); timer = null } flushDurableMirror() }
  window.addEventListener('pagehide', onHide)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide() })
}

/* Set while "Erase everything" runs: a queued mirror write must not recreate
 * the IndexedDB database that is about to be deleted. */
let eraseInProgress = false
export async function beginDurableErase(): Promise<void> {
  eraseInProgress = true
  if (timer) { clearTimeout(timer); timer = null }
  pendingMirror = null
  await mirrorWrites
}

export async function compactDurable(chats: Parameters<typeof compactChatsForDurable>[0]): Promise<{ freedChars: number; droppedChats: number }> {
  const before = JSON.stringify(chats).length
  const { chats: pruned, droppedChats } = compactChatsForDurable(chats)
  await durablePutChats(pruned)
  return { freedChars: Math.max(0, before - JSON.stringify(pruned).length), droppedChats }
}
