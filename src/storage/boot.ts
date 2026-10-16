/* Durable boot: automatic in-place migration + hydration.
 * Strategy (backwards compatible):
 * - zustand persist `byok.v1` in localStorage stays the fast-boot source.
 * - Every change mirrors full chats/workspaces (+ attachment bytes) to
 *   IndexedDB/OPFS (debounced). localStorage keeps the pruned copy.
 * - On boot, if durable holds chats/workspaces, they win when localStorage
 *   was quota-pruned (smaller/fewer messages). Attachment bytes are restored
 *   from blob storage. Settings are never overwritten by durable. */
import { durableGetChats, durableGetWorkspaces, durablePutChats, durablePutWorkspaces, durableSetMeta, durableGetMeta, blobPut, blobGet, splitPersistedForDurable, compactChatsForDurable, stripEphemeralFromChats } from './durable'

const CHATS_DEBOUNCE_MS = 1200
let timer: ReturnType<typeof setTimeout> | null = null
let lastMirror = ''

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

function readLocalRaw(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('byok.v1')
    if (!raw) return null
    const v = JSON.parse(raw)
    return (v?.state ?? v) as Record<string, unknown>
  } catch { return null }
}

/* Automatic in-place migration: first run movesChats/workspaces to durable,
 * then every boot reconciles durable vs localStorage (durable wins when it
 * has strictly more messages, i.e. localStorage was pruned). */
export async function hydrateDurable(patch: (p: Record<string, unknown>) => void): Promise<{ migrated: boolean; restoredBlobs: number; backend: string }> {
  let migrated = false
  try {
    const meta = await durableGetMeta().catch(() => null)
    const local = readLocalRaw()
    if (local && (local.chats || local.workspaces) && !meta?.migratedAt) {
      const { chats, workspaces } = splitPersistedForDurable(local)
      await durablePutChats(chats).catch(() => {})
      await durablePutWorkspaces(workspaces).catch(() => {})
      await durableSetMeta({ migratedAt: Date.now(), storeVersion: Number((local as { version?: number }).version ?? 18) }).catch(() => {})
      migrated = true
    }
    const [dChats, dWs] = await Promise.all([durableGetChats<unknown[]>().catch(() => null), durableGetWorkspaces<Record<string, unknown>>().catch(() => null)])
    const localMsgs = Array.isArray((local as { chats?: unknown[] })?.chats) ? (local as { chats: Array<{ msgs: unknown[] }> }).chats.reduce((a, c) => a + c.msgs.length, 0) : 0
    const durableMsgs = Array.isArray(dChats) ? (dChats as Array<{ msgs: unknown[] }>).reduce((a, c) => a + (c.msgs?.length ?? 0), 0) : 0
    let restoredBlobs = 0
    if (dChats && Array.isArray(dChats) && (migrated || durableMsgs >= localMsgs)) {
      restoredBlobs = await restoreAttachmentBytes(dChats as Parameters<typeof restoreAttachmentBytes>[0]).catch(() => 0)
      const p: Record<string, unknown> = {}
      // Drop session-relative fade timestamps from durable copies written by
      // older builds, so reloaded messages render fully visible.
      if (dChats) p.chats = stripEphemeralFromChats(dChats as { msgs?: Array<Record<string, unknown>> }[])
      if (dWs) p.workspaces = dWs
      if (Object.keys(p).length) patch(p)
    } else if (dChats) {
      restoredBlobs = await restoreAttachmentBytes(dChats as Parameters<typeof restoreAttachmentBytes>[0]).catch(() => 0)
    }
    const { durableUsage } = await import('./durable')
    const u = await durableUsage().catch(() => null)
    return { migrated, restoredBlobs, backend: u?.backend ?? 'memory' }
  } catch { return { migrated, restoredBlobs: 0, backend: 'memory' } }
}

/* Debounced mirror of full chats/workspaces to durable (fire-and-forget). */
export function mirrorToDurable(chats: unknown, workspaces: unknown): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    const key = JSON.stringify({ c: (chats as unknown[])?.length, w: Object.keys((workspaces as object) ?? {}).length })
    void key
    Promise.all([durablePutChats(stripEphemeralFromChats(chats as { msgs?: Array<Record<string, unknown>> }[])).catch(() => {}), durablePutWorkspaces(workspaces).catch(() => {})]).then(() => { lastMirror = String(Date.now()) })
    void lastMirror
  }, CHATS_DEBOUNCE_MS)
}

export async function compactDurable(chats: Parameters<typeof compactChatsForDurable>[0]): Promise<{ freedChars: number; droppedChats: number }> {
  const before = JSON.stringify(chats).length
  const { chats: pruned, droppedChats } = compactChatsForDurable(chats)
  await durablePutChats(pruned).catch(() => {})
  return { freedChars: Math.max(0, before - JSON.stringify(pruned).length), droppedChats }
}
