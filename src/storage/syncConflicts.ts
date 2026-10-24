/* Visible sync conflicts.
 *
 * Smart merge resolves most divergence silently, but when both devices added
 * different messages to the same chat there is no objectively correct answer.
 * Instead of quietly keeping the "richer" side, the runtime records both
 * versions here and the Data settings tab shows them, so the user can restore
 * the side they meant to keep. Detection is pure; persistence is a small,
 * bounded localStorage list. */

export const CONFLICTS_KEY = 'byok.sync.conflicts'
export const CONFLICTS_MAX = 6

export type ConflictSide = {
  updatedAt: number
  msgs: number
  /** The last message, trimmed: enough to recognise the fork at a glance. */
  last: string
  chat: string
}

export type SyncConflict = {
  id: string
  at: number
  chatId: string
  title: string
  local: ConflictSide
  remote: ConflictSide
}

type AnyMsg = { id?: unknown; t?: unknown; at?: unknown }
type AnyChat = { id?: string; title?: unknown; msgs?: unknown[]; [k: string]: unknown }

const msgIds = (c: AnyChat): string[] => (Array.isArray(c.msgs) ? c.msgs : []).map((m) => String((m as AnyMsg)?.id ?? '')).filter(Boolean)

const recency = (c: AnyChat): number => {
  let t = 0
  for (const m of Array.isArray(c.msgs) ? c.msgs : []) {
    const at = (m as AnyMsg)?.at
    if (typeof at === 'number' && at > t) t = at
  }
  return t
}

const lastText = (c: AnyChat): string => {
  const msgs = Array.isArray(c.msgs) ? c.msgs : []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = String((msgs[i] as AnyMsg)?.t ?? '').replace(/\s+/g, ' ').trim()
    if (t) return t.slice(0, 240)
  }
  return ''
}

const sideOf = (c: AnyChat): ConflictSide => ({
  updatedAt: recency(c),
  msgs: Array.isArray(c.msgs) ? c.msgs.length : 0,
  last: lastText(c),
  chat: JSON.stringify(c),
})

const isPrefix = (a: string[], b: string[]): boolean => a.length <= b.length && a.every((id, i) => id === b[i])

/** Both sides gained different messages: neither message list is a prefix of
 *  the other. A side that is merely behind (a prefix of the other) is not a
 *  conflict; it is ordinary catching-up. */
export function detectChatConflicts(localChats: unknown[], remoteChats: unknown[], now = Date.now()): SyncConflict[] {
  const remote = new Map<string, AnyChat>()
  for (const c of remoteChats) if (c && typeof c === 'object' && typeof (c as AnyChat).id === 'string') remote.set((c as AnyChat).id as string, c as AnyChat)
  const out: SyncConflict[] = []
  for (const c of localChats) {
    if (!c || typeof c !== 'object') continue
    const l = c as AnyChat
    if (typeof l.id !== 'string') continue
    const r = remote.get(l.id)
    if (!r) continue
    const li = msgIds(l), ri = msgIds(r)
    if (li.join('\n') === ri.join('\n')) continue
    if (isPrefix(li, ri) || isPrefix(ri, li)) continue
    out.push({
      id: `conflict-${l.id}-${now}`,
      at: now,
      chatId: l.id,
      title: String(l.title ?? r.title ?? 'Untitled chat'),
      local: sideOf(l),
      remote: sideOf(r),
    })
  }
  return out
}

export function readSyncConflicts(): SyncConflict[] {
  try {
    const raw = localStorage.getItem(CONFLICTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is SyncConflict => !!x && typeof x === 'object' && typeof x.chatId === 'string' && !!x.local && !!x.remote) : []
  } catch { return [] }
}

function writeSyncConflicts(list: SyncConflict[]): void {
  try { localStorage.setItem(CONFLICTS_KEY, JSON.stringify(list.slice(0, CONFLICTS_MAX))) } catch { /* blocked storage */ }
}

/** Record new conflicts, replacing an older record for the same chat. */
export function recordSyncConflicts(conflicts: SyncConflict[]): SyncConflict[] {
  if (!conflicts.length) return readSyncConflicts()
  const ids = new Set(conflicts.map((c) => c.chatId))
  const next = [...conflicts, ...readSyncConflicts().filter((c) => !ids.has(c.chatId))].slice(0, CONFLICTS_MAX)
  writeSyncConflicts(next)
  return next
}

export function dismissSyncConflict(id: string): SyncConflict[] {
  const next = readSyncConflicts().filter((c) => c.id !== id)
  writeSyncConflicts(next)
  return next
}

export function clearSyncConflicts(): void {
  try { localStorage.removeItem(CONFLICTS_KEY) } catch { /* blocked storage */ }
}

/** Parse the stored chat JSON for one side, for the restore action. */
export function conflictChat(conflict: SyncConflict, side: 'local' | 'remote'): AnyChat | null {
  try {
    const chat = JSON.parse(conflict[side].chat)
    return chat && typeof chat === 'object' && typeof chat.id === 'string' ? chat : null
  } catch { return null }
}
