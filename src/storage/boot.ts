/* Durable boot: automatic in-place migration + hydration.
 * Strategy (backwards compatible):
 * - zustand persist `byok.v1` in localStorage stays the fast-boot source.
 * - Every change mirrors full chats/workspaces (+ attachment bytes) to
 *   IndexedDB/OPFS (debounced). localStorage keeps the pruned copy.
 * - On boot, if durable holds chats/workspaces, they win when localStorage
 *   was quota-pruned (smaller/fewer messages). Attachment bytes are restored
 *   from blob storage. Settings are never overwritten by durable. */
import { durableGetChats, durableGetWorkspaces, durablePutChats, durablePutWorkspaces, durableSetMeta, durableGetMeta, blobDel, blobPut, blobGet, splitPersistedForDurable, compactChatsForDurable } from './durable'
import { STORE_VERSION } from '../persistence'

const CHATS_DEBOUNCE_MS = 1200
let timer: ReturnType<typeof setTimeout> | null = null
let pendingMirror: { chats: unknown; workspaces: unknown } | null = null

export function blobIdFor(msgId: string, index: number, name: string): string {
  return `${msgId}:${index}:${name}`.slice(0, 180)
}

export async function persistAttachmentBytes(msgId: string, att: Array<{ name: string; data?: string; text?: string }>): Promise<void> {
  await Promise.all(att.map((a, i) => {
    const payload = a.data ?? a.text ?? ''
    if (!payload) return Promise.resolve()
    return blobPut(blobIdFor(msgId, i, a.name), payload).then(() => {}).catch(() => {})
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

function readLocal(): { state: Record<string, unknown>; version: number } | null {
  try {
    const raw = localStorage.getItem('byok.v1')
    if (!raw) return null
    const v = JSON.parse(raw)
    const version = Number((v as { version?: unknown })?.version)
    return { state: (v?.state ?? v) as Record<string, unknown>, version: Number.isFinite(version) && version > 0 ? version : STORE_VERSION }
  } catch { return null }
}

/* Automatic in-place migration: first run movesChats/workspaces to durable,
 * then every boot reconciles durable vs localStorage (durable wins when it
 * has strictly more messages, i.e. localStorage was pruned). */
export async function hydrateDurable(patch: (p: Record<string, unknown>) => void): Promise<{ migrated: boolean; restoredBlobs: number; backend: string }> {
  let migrated = false
  try {
    const meta = await durableGetMeta().catch(() => null)
    const local = readLocal()
    if (local && (local.state.chats || local.state.workspaces) && !meta?.migratedAt) {
      const { chats, workspaces } = splitPersistedForDurable(local.state)
      await durablePutChats(chats).catch(() => {})
      await durablePutWorkspaces(workspaces).catch(() => {})
      await durableSetMeta({ migratedAt: Date.now(), storeVersion: local.version }).catch(() => {})
      migrated = true
    }
    const [dChats, dWs] = await Promise.all([durableGetChats<unknown[]>().catch(() => null), durableGetWorkspaces<Record<string, unknown>>().catch(() => null)])
    const localMsgs = Array.isArray(local?.state.chats) ? (local!.state.chats as Array<{ msgs?: unknown[] }>).reduce((a, c) => a + (c.msgs?.length ?? 0), 0) : 0
    const durableMsgs = Array.isArray(dChats) ? (dChats as Array<{ msgs: unknown[] }>).reduce((a, c) => a + (c.msgs?.length ?? 0), 0) : 0
    let restoredBlobs = 0
    if (dChats && Array.isArray(dChats) && (migrated || durableMsgs >= localMsgs)) {
      restoredBlobs = await restoreAttachmentBytes(dChats as Parameters<typeof restoreAttachmentBytes>[0]).catch(() => 0)
      const p: Record<string, unknown> = {}
      // Empty chats are not store entries anymore: strip leftovers from both
      // storage tiers so a durable copy cannot resurrect them.
      p.chats = dChats.filter((c) => Array.isArray((c as { msgs?: unknown[] })?.msgs) && (c as { msgs: unknown[] }).msgs.length > 0)
      // An empty durable map must not wipe the workspaces that localStorage
      // still holds (the durable copy can be empty after a quota prune).
      if (dWs && Object.keys(dWs).length) p.workspaces = dWs
      if (Object.keys(p).length) patch(p)
    } else if (dChats) {
      restoredBlobs = await restoreAttachmentBytes(dChats as Parameters<typeof restoreAttachmentBytes>[0]).catch(() => 0)
    }
    const { durableUsage } = await import('./durable')
    const u = await durableUsage().catch(() => null)
    return { migrated, restoredBlobs, backend: u?.backend ?? 'memory' }
  } catch { return { migrated, restoredBlobs: 0, backend: 'memory' } }
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
  void Promise.all([durablePutChats(p.chats).catch(() => {}), durablePutWorkspaces(p.workspaces).catch(() => {})])
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
export function beginDurableErase(): void {
  eraseInProgress = true
  if (timer) { clearTimeout(timer); timer = null }
  pendingMirror = null
}

export async function compactDurable(chats: Parameters<typeof compactChatsForDurable>[0]): Promise<{ freedChars: number; droppedChats: number }> {
  const before = JSON.stringify(chats).length
  const { chats: pruned, droppedChats } = compactChatsForDurable(chats)
  await durablePutChats(pruned).catch(() => {})
  return { freedChars: Math.max(0, before - JSON.stringify(pruned).length), droppedChats }
}
