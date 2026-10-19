/* Smart merge for device sync.
 *
 * Pure and side-effect free so the rules stay unit-testable. Two devices that
 * share a sync token hold overlapping-but-not-identical stores: the same chat
 * lives on both, each device also has chats the other never saw, folders and
 * other id-keyed collections drift apart, and settings evolve independently.
 *
 * The merge below never duplicates data:
 *   - chats union by id (the richer copy wins on a collision) and identical
 *     conversations under different ids collapse into one;
 *   - folders with the same name (case-insensitive) become a single folder and
 *     every chat that pointed at either id is repointed at the survivor;
 *   - workspaces union by id, their revision lists union by revision id;
 *   - id-keyed collections (endpoints, playlists, prompts, commands, skills,
 *     memories, todos) union by id;
 *   - string lists (snips) and record maps (keys, widgets, prefs, params, …)
 *     merge so neither device loses a value.
 * No DOM, no store imports. */

export type SyncMergeMode = 'merge' | 'remote' | 'local'

export type SyncData = {
  settings: Record<string, unknown>
  chats: unknown[]
  workspaces: Record<string, unknown>
  selectedRevision: Record<string, unknown>
}

type Obj = Record<string, unknown>
type AnyChat = { id?: unknown; title?: unknown; folder?: unknown; msgs?: unknown; [k: string]: unknown }

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asObj = (v: unknown): Obj => (isObj(v) ? v : {})
const asStrArr = (v: unknown): string[] => asArr(v).filter((x): x is string => typeof x === 'string')

/* ---- chats ---- */

/** Most recent activity in a chat (max message timestamp); 0 when unknown. */
const chatRecency = (c: AnyChat): number => {
  let t = 0
  for (const m of asArr(c.msgs)) {
    const at = (m as { at?: unknown })?.at
    if (typeof at === 'number' && at > t) t = at
  }
  return t
}

/** A chat is a duplicate of another only when it is non-empty and its message
 *  sequence is identical. Empty chats share the title "New chat" and must never
 *  be collapsed. */
const chatFingerprint = (c: AnyChat): string | null => {
  const msgs = asArr(c.msgs)
  if (!msgs.length) return null
  const ids = msgs.map((m) => String((m as { id?: unknown })?.id ?? ''))
  if (ids.some((id) => !id)) return null
  return `${String(c.title ?? '')}|${ids.join(',')}`
}

function mergeChats(localChats: unknown[], remoteChats: unknown[]): unknown[] {
  const byId = new Map<string, AnyChat>()
  const order: string[] = []
  const add = (c: unknown, allowReplace: boolean) => {
    if (!isObj(c) || typeof c.id !== 'string') return
    const id = c.id
    const chat = c as AnyChat
    const prev = byId.get(id)
    if (!prev) { byId.set(id, chat); order.push(id); return }
    if (!allowReplace) return
    const newer = chatRecency(chat) > chatRecency(prev)
    const richer = chatRecency(chat) === chatRecency(prev) && asArr(chat.msgs).length > asArr(prev.msgs).length
    if (newer || richer) byId.set(id, chat)
  }
  for (const c of localChats) add(c, false)
  for (const c of remoteChats) add(c, true)
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const id of order) {
    const chat = byId.get(id) as AnyChat
    const fp = chatFingerprint(chat)
    if (fp) {
      if (seen.has(fp)) continue
      seen.add(fp)
    }
    out.push(chat)
  }
  return out
}

/* ---- folders ---- */

/** Union folders by id (local order and value win), then collapse folders that
 *  share a name onto one survivor, returning a remap from every dropped id to
 *  the survivor so chats can be repointed. Unnamed folders are kept as-is. */
function mergeFolders(localFolders: unknown[], remoteFolders: unknown[]): { folders: Obj[]; remap: Map<string, string> } {
  const norm = (n: unknown) => String(n ?? '').trim().toLowerCase()
  const union: Obj[] = []
  const seenId = new Set<string>()
  for (const f of [...localFolders, ...remoteFolders]) {
    if (!isObj(f) || typeof f.id !== 'string' || seenId.has(f.id)) continue
    seenId.add(f.id)
    union.push({ ...f })
  }
  const byName = new Map<string, Obj>()
  const remap = new Map<string, string>()
  for (const f of union) {
    const name = norm(f.name)
    const key = name === '' ? `#${String(f.id)}` : name
    const existing = byName.get(key)
    if (existing) {
      remap.set(String(f.id), String(existing.id))
      if (typeof existing.open !== 'boolean') existing.open = f.open
      else if (f.open === true) existing.open = true
    } else {
      byName.set(key, f)
    }
  }
  return { folders: [...byName.values()], remap }
}

const remapChatFolders = (chats: unknown[], remap: Map<string, string>): unknown[] => {
  if (!remap.size) return chats
  return chats.map((c) => {
    if (!isObj(c) || typeof c.folder !== 'string') return c
    const next = remap.get(c.folder)
    return next && next !== c.folder ? { ...c, folder: next } : c
  })
}

/* ---- workspaces ---- */

function mergeWorkspace(l: Obj, r: Obj): Obj {
  const revisions: unknown[] = []
  const seen = new Set<string>()
  const push = (rev: unknown) => {
    if (!isObj(rev) || typeof rev.id !== 'string' || seen.has(rev.id)) return
    seen.add(rev.id)
    revisions.push(rev)
  }
  for (const rev of asArr(l.revisions)) push(rev)
  for (const rev of asArr(r.revisions)) push(rev)
  revisions.sort((a, b) => Number((a as { createdAt?: unknown }).createdAt ?? 0) - Number((b as { createdAt?: unknown }).createdAt ?? 0))
  return { ...r, ...l, revisions }
}

function mergeWorkspaces(local: unknown, remote: unknown): Record<string, unknown> {
  const l = asObj(local), r = asObj(remote)
  const out: Record<string, unknown> = {}
  const ids = [...Object.keys(l), ...Object.keys(r).filter((k) => !(k in l))]
  for (const id of ids) {
    const a = l[id], b = r[id]
    if (isObj(a) && isObj(b)) out[id] = mergeWorkspace(a, b)
    else out[id] = a ?? b
  }
  return out
}

/* ---- collections ---- */

/** Union arrays of `{ id }` by id; on a collision the first copy (local) wins
 *  unless `pick` chooses otherwise (e.g. the newer memory). */
function unionById(local: unknown[], remote: unknown[], pick?: (a: Obj, b: Obj) => Obj): unknown[] {
  const out: unknown[] = []
  const at = new Map<string, number>()
  const add = (item: unknown) => {
    if (!isObj(item) || typeof item.id !== 'string') return
    const idx = at.get(item.id)
    if (idx === undefined) { at.set(item.id, out.length); out.push(item); return }
    if (pick) out[idx] = pick(out[idx] as Obj, item)
  }
  for (const x of local) add(x)
  for (const x of remote) add(x)
  return out
}

/** Collections that carry a stable id and should union rather than be replaced. */
const ID_COLLECTIONS = ['eps', 'pls', 'prompts', 'cmds', 'skills', 'todos', 'memories', 'mcps', 'shares'] as const
/** Flat record maps whose keys should union so neither device loses an entry. */
const MAP_FIELDS = ['keys', 'widgets', 'features', 'libraryShow', 'effort', 'routeStats'] as const

function mergeSettings(local: Obj, remote: Obj, folders: Obj[]): Obj {
  const out: Obj = { ...local, ...remote }
  // Recurse one level into plain objects both sides own (prefs, params,
  // widgetPrefs, search, custom colors, …) so a key set on one device is not
  // wiped by the other device's whole-object value.
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (isObj(local[k]) && isObj(remote[k])) out[k] = { ...local[k], ...remote[k] }
  }
  const dedupeByText = (list: unknown[]): unknown[] => {
    const seen = new Set<string>()
    const kept: unknown[] = []
    for (const item of list) {
      const text = String((item as { text?: unknown })?.text ?? '').trim().toLowerCase()
      if (text && seen.has(text)) continue
      if (text) seen.add(text)
      kept.push(item)
    }
    return kept
  }
  for (const k of ID_COLLECTIONS) {
    if (!(k in local) && !(k in remote)) continue
    if (k === 'memories') {
      out[k] = dedupeByText(unionById(asArr(local[k]), asArr(remote[k]), (a, b) => (Number(b.updatedAt ?? 0) > Number(a.updatedAt ?? 0) ? b : a)))
    } else if (k === 'todos') {
      out[k] = dedupeByText(unionById(asArr(local[k]), asArr(remote[k])))
    } else {
      out[k] = unionById(asArr(local[k]), asArr(remote[k]))
    }
  }
  for (const k of MAP_FIELDS) {
    if (isObj(local[k]) || isObj(remote[k])) out[k] = { ...asObj(local[k]), ...asObj(remote[k]) }
  }
  if ('snips' in local || 'snips' in remote) out.snips = [...new Set([...asStrArr(local.snips), ...asStrArr(remote.snips)])]
  out.folders = folders
  return out
}

/* ---- selected revision ---- */

function mergeSelectedRevision(local: unknown, remote: unknown, workspaces: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...asObj(remote), ...asObj(local) }
  for (const k of Object.keys(out)) {
    const ws = workspaces[k]
    const revs = isObj(ws) ? asArr(ws.revisions) : []
    if (typeof out[k] !== 'string') delete out[k]
    else if (revs.length && !revs.some((r) => isObj(r) && r.id === out[k])) delete out[k]
  }
  return out
}

/* ---- entry point ---- */

/**
 * Combine a local store snapshot with a remote one.
 *
 * `merge` unions both sides (the default, used for auto-pull), `remote`
 * replaces local data with the remote snapshot, `local` keeps this device's
 * data. Settings are taken from the preferred side on a conflict while
 * id-keyed collections still union.
 */
export function mergeSyncData(local: SyncData, remote: SyncData, mode: SyncMergeMode = 'merge'): SyncData {
  if (mode === 'remote') {
    return { settings: { ...local.settings, ...remote.settings }, chats: remote.chats, workspaces: { ...asObj(remote.workspaces) }, selectedRevision: { ...asObj(remote.selectedRevision) } }
  }
  if (mode === 'local') {
    return { settings: { ...remote.settings, ...local.settings }, chats: local.chats, workspaces: { ...asObj(local.workspaces) }, selectedRevision: { ...asObj(local.selectedRevision) } }
  }
  const { folders, remap } = mergeFolders(asArr(local.settings.folders), asArr(remote.settings.folders))
  const chats = mergeChats(remapChatFolders(local.chats, remap), remapChatFolders(remote.chats, remap))
  const workspaces = mergeWorkspaces(local.workspaces, remote.workspaces)
  const settings = mergeSettings(local.settings, remote.settings, folders)
  // Keep the "open chat" pointer valid after chats and folders are merged.
  // Prefer the local open chat when it survived the merge: the app may have
  // opened to it moments ago (startup, a brand-new chat) and a remote snapshot
  // must not yank the view onto a different chat. Fall back to repair only when
  // the local chat was dropped in the merge (deleted, or collapsed into a twin).
  const localChatId = typeof local.settings.chat === 'string' ? local.settings.chat : ''
  if (localChatId && (chats as AnyChat[]).some((c) => isObj(c) && c.id === localChatId)) {
    settings.chat = localChatId as string
  } else if (typeof settings.chat !== 'string' || !(chats as AnyChat[]).some((c) => isObj(c) && c.id === settings.chat)) {
    settings.chat = (isObj(chats[0]) ? (chats[0] as AnyChat).id : '') as string
  }
  const selectedRevision = mergeSelectedRevision(local.selectedRevision, remote.selectedRevision, workspaces)
  return { settings, chats, workspaces, selectedRevision }
}
