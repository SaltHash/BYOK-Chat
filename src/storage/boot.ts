/* Durable boot: automatic in-place migration + hydration.
 * Strategy (backwards compatible):
 * - zustand persist `byok.v1` in localStorage stays the fast-boot source.
 * - Every change mirrors full chats/workspaces (+ attachment bytes) to
 *   IndexedDB/OPFS (debounced). localStorage keeps the pruned copy.
 * - On boot, if durable holds chats/workspaces, they win when localStorage
 *   was quota-pruned (smaller/fewer messages). Attachment bytes are restored
 *   from blob storage. Settings are never overwritten by durable. */
import { durableGetChats, durableGetWorkspaces, durablePutChats, durablePutWorkspaces, durableSetMeta, durableGetMeta, blobDel, blobPut, blobGet, splitPersistedForDurable, compactChatsForDurable } from './durable'
import { joinPersistShards, missingPersistShards, QUOTA_FLAG, reportStorageFailure, STORE_VERSION, withoutExpiredTemps } from '../persistence'

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

function readLocal(): { state: Record<string, unknown>; version: number; missing: string[] } | null {
  const raw = localStorage.getItem('byok.v1')
  if (raw === null) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw Error('The local snapshot is corrupt.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('The local snapshot is invalid.')
  const original = parsed as Record<string, unknown>
  if ('state' in original && (!original.state || typeof original.state !== 'object' || Array.isArray(original.state))) throw Error('The local snapshot is invalid.')
  const state = ('state' in original ? original.state : original) as Record<string, unknown>
  if (state.__byokSharded === true && (!Array.isArray(state.__byokChatIds) || state.__byokChatIds.some(id => typeof id !== 'string' || !id))) throw Error('The local chat index is corrupt.')
  const v = JSON.parse(joinPersistShards(raw, (key) => localStorage.getItem(key)) ?? raw)
  const version = Number(original.version)
  return { state: (v.state ?? v) as Record<string, unknown>, version: Number.isFinite(version) && version > 0 ? version : STORE_VERSION, missing: missingPersistShards(raw, key => localStorage.getItem(key)) }
}

/* Automatic in-place migration: local shards are authoritative for ordinary
 * writes; a richer durable copy is used only after a reported quota failure or
 * when the local snapshot is missing. */
export async function hydrateDurable(patch: (p: Record<string, unknown>) => void, initial?: Record<string, unknown>): Promise<{ migrated: boolean; restoredBlobs: number; backend: string }> {
  let migrated = false
  // Snapshot local state and the quota marker before any asynchronous read.
  const saved = readLocal()
  const quota = (() => { try { return !!localStorage.getItem(QUOTA_FLAG) } catch { return false } })()
  const local = saved && initial ? { ...saved, state: initial } : saved
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
    // An indexed shard may be missing or truncated after interruption. Restore
    // only those IDs from durable, never unrelated chats deleted locally.
    if (local?.missing.length) {
      const recovered = new Map((Array.isArray(dChats) ? dChats : []).filter((c): c is { id: string; msgs: unknown[] } => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string' && Array.isArray((c as { msgs?: unknown }).msgs)).map(c => [c.id, c]))
      if (local.missing.some(id => !recovered.has(id))) throw Error('A saved chat is missing and its durable copy could not be restored.')
      const chats = Array.isArray(local.state.chats) ? [...local.state.chats] : []
      chats.push(...local.missing.map(id => recovered.get(id)))
      local.state = { ...local.state, chats }
      patch({ chats })
      reportStorageFailure()
    }
    const localMsgs = Array.isArray(local?.state.chats) ? (local!.state.chats as Array<{ msgs?: unknown[] }>).reduce((a, c) => a + (c.msgs?.length ?? 0), 0) : 0
    const durableMsgs = Array.isArray(dChats) ? (dChats as Array<{ msgs: unknown[] }>).reduce((a, c) => a + (c.msgs?.length ?? 0), 0) : 0
    let restoredBlobs = 0
    // A larger old mirror is not proof of a quota prune: a user may have
    // deliberately deleted messages or chats since it was written.
    const useDurableChats = Array.isArray(dChats) && (!local || (quota && durableMsgs > localMsgs))
    if (useDurableChats && dChats) {
      // With a local index, recover richer content only for IDs that still
      // exist locally. A stale mirror must not resurrect deleted chats.
      const selected = local ? (local.state.chats as Array<{ id?: unknown }>).map(c => {
        const durable = dChats.find(d => (d as { id?: unknown })?.id === c.id) as { msgs?: unknown[] } | undefined
        const current = c as { msgs?: unknown[] }
        return durable && (durable.msgs?.length ?? 0) > (current.msgs?.length ?? 0) ? durable : c
      }) : dChats
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
      if (restoredBlobs) patch({ chats })
    }
    const { durableUsage } = await import('./durable')
    const u = await durableUsage().catch(() => null)
    return { migrated, restoredBlobs, backend: u?.backend ?? 'memory' }
  } catch (error) {
    // A corrupt local snapshot can fall back to durable storage, but an
    // unexpected recovery failure must not silently mirror an empty store.
    if (!saved || quota || saved.missing.length) throw error
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
