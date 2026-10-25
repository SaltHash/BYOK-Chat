/* Incremental device-sync deltas.
 *
 * A push used to upload the whole shaped store (settings + every chat +
 * workspaces). That is both expensive and racy: a 1 KB message edit sent
 * megabytes, and a write based on an older snapshot could erase newer work.
 * Deltas fix both. A push carries only what changed:
 *
 *   - settings: the changed keys, or a key list to delete;
 *   - chats: metadata, new/edited/deleted messages and (rarely) a new order;
 *   - workspaces: the latest revision only, or an id to delete;
 *   - selectedRevision: changed or deleted workspace pointers.
 *
 * The client keeps a baseline of content hashes (never a second full copy) so
 * it can compute the delta locally. The server still stores the full snapshot
 * and sends it to a newly linked device; it also appends these deltas so an
 * already-linked device can pull only what it missed.
 *
 * Everything here is pure: no store, DOM, network or crypto imports. Apply is
 * idempotent and merges by id, so replaying a delta cannot duplicate chats,
 * messages, revisions or settings.
 */

import { chatFingerprint, mergeSelectedRevision, mergeSettings, mergeWorkspace, type SyncData } from './syncMerge'

type Obj = Record<string, unknown>

export type SyncChatOp = {
  id: string
  /** Chat fields other than `msgs`. Sent whenever metadata changed. */
  meta?: Obj
  /** Whole chat, used only when its messages cannot be addressed by id. */
  full?: unknown
  add?: unknown[]
  update?: unknown[]
  del?: string[]
  /** Full message-id order, sent only when the order actually changed. */
  order?: string[]
}

export type SyncDelta = {
  v: 1
  /** When the change was made; also a tombstone clock for deletes. */
  at: number
  settings?: { set?: Obj; del?: string[] }
  chats?: { ops?: SyncChatOp[]; del?: string[] }
  workspaces?: { upsert?: Obj; del?: string[] }
  selectedRevision?: { set?: Record<string, string>; del?: string[] }
}

export type SyncChatBase = {
  /** Hash of the chat without `msgs`. */
  h: string
  /** Message ids in order. */
  m: string[]
  /** Message id -> hash. */
  mh: Record<string, string>
  /** Set when messages have no stable id and the whole chat must be sent. */
  whole?: boolean
}

export type SyncBaseline = {
  v: 2
  tokenId: string
  seq: number
  settings: Record<string, string>
  chats: Record<string, SyncChatBase>
  workspaces: Record<string, string>
  selected: Record<string, string>
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asObj = (v: unknown): Obj => (isObj(v) ? v : {})
const msgId = (m: unknown): string => (isObj(m) && typeof m.id === 'string' ? m.id : '')

/* JSON.stringify is not stable across key insertion order, and a remote object
 * may list keys in a different order than the local one. Hashing without this
 * would make unchanged values look new and re-send them. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const obj = value as Obj
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(',')}}`
}

/** Short, deterministic content hash. Two independent 32-bit mixes plus the
 *  serialized length make an accidental collision vanishingly unlikely while
 *  staying synchronous (no WebCrypto promise on every message). */
export function hashValue(value: unknown): string {
  let text: string
  try { text = stable(value) } catch { text = `unserializable:${Math.random()}` }
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x85ebca6b)
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}:${text.length.toString(36)}`
}

const chatMeta = (chat: Obj): Obj => {
  const { msgs: _msgs, ...meta } = chat
  return meta
}

const chatMessages = (chat: Obj): unknown[] => asArr(chat.msgs)

const canAddressMessages = (msgs: unknown[]): boolean => msgs.every((m) => !!msgId(m))

const baselineChat = (chat: Obj): SyncChatBase => {
  const msgs = chatMessages(chat)
  if (!canAddressMessages(msgs)) return { h: hashValue(chat), m: [], mh: {}, whole: true }
  const m: string[] = []
  const mh: Record<string, string> = {}
  for (const msg of msgs) {
    const id = msgId(msg)
    m.push(id)
    mh[id] = hashValue(msg)
  }
  return { h: hashValue(chatMeta(chat)), m, mh }
}

const maxMsgAt = (chat: Obj): number => {
  let at = 0
  for (const msg of chatMessages(chat)) {
    if (isObj(msg) && typeof msg.at === 'number' && msg.at > at) at = msg.at
  }
  return at
}

const latestRevisionAt = (ws: unknown): number => {
  let at = 0
  for (const rev of asArr(asObj(ws).revisions)) {
    if (isObj(rev) && typeof rev.createdAt === 'number' && rev.createdAt > at) at = rev.createdAt
  }
  return at
}

export function emptyBaseline(tokenId = '', seq = 0): SyncBaseline {
  return { v: 2, tokenId, seq, settings: {}, chats: {}, workspaces: {}, selected: {} }
}

/** Hash a complete shaped snapshot. Used after a full pull (the baseline must
 *  describe the server's copy, not the merged local result) and after a full
 *  push. */
export function baselineFromData(data: SyncData, tokenId = '', seq = 0): SyncBaseline {
  const out = emptyBaseline(tokenId, seq)
  for (const [k, v] of Object.entries(data.settings)) if (v !== undefined) out.settings[k] = hashValue(v)
  for (const chat of data.chats) {
    if (isObj(chat) && typeof chat.id === 'string') out.chats[chat.id] = baselineChat(chat)
  }
  for (const [id, ws] of Object.entries(data.workspaces ?? {})) out.workspaces[id] = hashValue(ws)
  for (const [id, rev] of Object.entries(data.selectedRevision ?? {})) {
    if (typeof rev === 'string') out.selected[id] = hashValue(rev)
  }
  return out
}

/** True when the baseline belongs to a different sync slot and must be reset. */
export const baselineMatches = (base: SyncBaseline | null, tokenId: string): base is SyncBaseline =>
  !!base && base.v === 2 && base.tokenId === tokenId

/* ---- computing a delta ---- */

export function computeSyncDelta(base: SyncBaseline, data: SyncData, at = Date.now()): SyncDelta | null {
  const delta: SyncDelta = { v: 1, at }
  let touched = false

  const setSettings: Obj = {}
  const delSettings: string[] = []
  for (const [k, v] of Object.entries(data.settings)) {
    if (v === undefined) { if (k in base.settings) { delSettings.push(k); touched = true }; continue }
    const h = hashValue(v)
    if (base.settings[k] !== h) { setSettings[k] = v; touched = true }
  }
  for (const k of Object.keys(base.settings)) if (!(k in data.settings)) { delSettings.push(k); touched = true }
  if (Object.keys(setSettings).length) delta.settings = { set: setSettings }
  if (delSettings.length) delta.settings = { ...(delta.settings ?? {}), del: delSettings }

  const ops: SyncChatOp[] = []
  const seen = new Set<string>()
  for (const raw of data.chats) {
    if (!isObj(raw) || typeof raw.id !== 'string') continue
    const id = raw.id
    seen.add(id)
    const prev = base.chats[id]
    const next = baselineChat(raw)
    if (!prev) {
      const msgs = chatMessages(raw)
      const op: SyncChatOp = { id, meta: chatMeta(raw) }
      if (msgs.length) op.add = msgs
      ops.push(op)
      touched = true
      continue
    }
    if (prev.whole || next.whole) {
      if (prev.h !== next.h) { ops.push({ id, full: raw }); touched = true }
      continue
    }
    let op: SyncChatOp | null = null
    if (prev.h !== next.h) { op = { id, meta: chatMeta(raw) }; touched = true }
    const msgs = chatMessages(raw)
    const oldSet = new Set(prev.m)
    const currentSet = new Set(next.m)
    const added: unknown[] = []
    const updated: unknown[] = []
    for (const msg of msgs) {
      const mid = msgId(msg)
      if (!oldSet.has(mid)) added.push(msg)
      else if (prev.mh[mid] !== hashValue(msg)) updated.push(msg)
    }
    const removed = prev.m.filter((mid) => !currentSet.has(mid))
    if (added.length || updated.length || removed.length) {
      op = op ?? { id }
      if (added.length) op.add = added
      if (updated.length) op.update = updated
      if (removed.length) op.del = removed
      const kept = prev.m.filter((mid) => currentSet.has(mid))
      const fresh = next.m.filter((mid) => !oldSet.has(mid))
      if ([...kept, ...fresh].join('\n') !== next.m.join('\n')) op.order = next.m
      touched = true
    }
    if (op) ops.push(op)
  }
  const delChats = Object.keys(base.chats).filter((id) => !seen.has(id))
  if (ops.length) delta.chats = { ops }
  if (delChats.length) delta.chats = { ...(delta.chats ?? {}), del: delChats }
  if (delChats.length) touched = true

  const upsertWorkspaces: Obj = {}
  const delWorkspaces: string[] = []
  for (const [id, ws] of Object.entries(data.workspaces ?? {})) {
    const h = hashValue(ws)
    if (base.workspaces[id] !== h) { upsertWorkspaces[id] = ws; touched = true }
  }
  for (const id of Object.keys(base.workspaces)) if (!(id in (data.workspaces ?? {}))) { delWorkspaces.push(id); touched = true }
  if (Object.keys(upsertWorkspaces).length) delta.workspaces = { upsert: upsertWorkspaces }
  if (delWorkspaces.length) delta.workspaces = { ...(delta.workspaces ?? {}), del: delWorkspaces }

  const setSelected: Record<string, string> = {}
  const delSelected: string[] = []
  for (const [id, rev] of Object.entries(data.selectedRevision ?? {})) {
    if (typeof rev !== 'string') continue
    const h = hashValue(rev)
    if (base.selected[id] !== h) { setSelected[id] = rev; touched = true }
  }
  for (const id of Object.keys(base.selected)) if (!(id in (data.selectedRevision ?? {}))) { delSelected.push(id); touched = true }
  if (Object.keys(setSelected).length) delta.selectedRevision = { set: setSelected }
  if (delSelected.length) delta.selectedRevision = { ...(delta.selectedRevision ?? {}), del: delSelected }

  return touched ? delta : null
}

/* ---- applying a delta ---- */

/** Merge a partial remote change into the current save. Never replaces the
 *  whole store, never drops local work that the delta did not mention, and
 *  deletes only entities that have not been edited since the delete was made. */
export function applySyncDelta(local: SyncData, delta: SyncDelta): SyncData {
  let settings: Record<string, unknown> = { ...local.settings }
  if (delta.settings?.set && Object.keys(delta.settings.set).length) {
    const set = delta.settings.set
    const projects = asArr(settings.projects ?? settings.folders) as Obj[]
    const merged = { ...settings, ...mergeSettings(settings, set, projects) }
    // mergeSettings keeps the local project list so a full merge can collapse
    // same-named projects; a delta that carries projects is the newer list and
    // must win, or a project rename/delete would never propagate.
    const nextProjects = Array.isArray(set.projects) ? set.projects : Array.isArray(set.folders) ? set.folders : null
    if (nextProjects) {
      // Same id: the incoming project is the newer name/state. Local-only
      // projects stay, so a device that has not pushed yet cannot lose them.
      const byId = new Map<string, Obj>()
      for (const project of projects) if (isObj(project) && typeof project.id === 'string') byId.set(project.id, project)
      for (const project of nextProjects) if (isObj(project) && typeof project.id === 'string') byId.set(project.id, project)
      merged.projects = [...byId.values()]
      merged.folders = merged.projects
    } else if (!('projects' in settings) && !('folders' in settings)) {
      // A one-key delta should not add empty arrays that were never part of
      // this save.
      delete merged.projects
      delete merged.folders
    }
    settings = merged
  }
  for (const k of delta.settings?.del ?? []) delete settings[k]

  let chats: unknown[] = Array.isArray(local.chats) ? [...local.chats] : []
  if (delta.chats) {
    const byId = new Map<string, Obj>()
    for (const chat of chats) if (isObj(chat) && typeof chat.id === 'string') byId.set(chat.id, chat)

    const addedIds = new Set<string>()
    for (const op of delta.chats.ops ?? []) {
      if (!op || typeof op.id !== 'string') continue
      const existing = byId.get(op.id)
      if (!existing) addedIds.add(op.id)
      if (op.full && isObj(op.full)) {
        // A whole-chat delta exists only when its messages have no stable ids,
        // so there is nothing to merge by id: the remote copy is the change.
        byId.set(op.id, { ...op.full, id: op.id })
        continue
      }
      const base: Obj = existing ? { ...existing, msgs: asArr(existing.msgs) } : { id: op.id, title: 'Untitled chat', msgs: [] }
      const withMeta = op.meta && isObj(op.meta) ? { ...base, ...op.meta, id: op.id, msgs: base.msgs } : { ...base }
      let msgs = asArr(withMeta.msgs)
      const index = new Map<string, number>()
      msgs.forEach((m, i) => { const id = msgId(m); if (id) index.set(id, i) })
      const put = (msg: unknown) => {
        if (!isObj(msg)) return
        const id = msgId(msg)
        if (id && index.has(id)) { msgs[index.get(id)!] = msg; return }
        msgs.push(msg)
        if (id) index.set(id, msgs.length - 1)
      }
      // Updates and adds are both upserts by id, so replaying a delta (or
      // pulling it twice) replaces the message instead of appending a twin.
      for (const msg of op.update ?? []) put(msg)
      for (const msg of op.add ?? []) put(msg)
      if (op.del?.length) {
        const gone = new Set(op.del)
        msgs = msgs.filter((m) => !gone.has(msgId(m)))
      }
      if (op.order?.length) {
        const at = new Map<string, unknown>()
        for (const m of msgs) { const id = msgId(m); if (id) at.set(id, m) }
        const ordered: unknown[] = []
        const used = new Set<string>()
        for (const id of op.order) {
          const m = at.get(id)
          if (m !== undefined) { ordered.push(m); used.add(id) }
        }
        for (const m of msgs) { const id = msgId(m); if (!id || !used.has(id)) ordered.push(m) }
        msgs = ordered
      }
      byId.set(op.id, { ...withMeta, msgs })
    }

    for (const id of delta.chats.del ?? []) {
      const chat = byId.get(id)
      // A delete is a tombstone, not a mandate: if this device edited the chat
      // after the other device deleted it, keep the newer local copy and let
      // the next push converge.
      if (chat && maxMsgAt(chat) <= delta.at) byId.delete(id)
    }

    const next: unknown[] = []
    const placed = new Set<string>()
    for (const chat of chats) {
      const id = isObj(chat) && typeof chat.id === 'string' ? chat.id : ''
      if (!id) { next.push(chat); continue }
      const value = byId.get(id)
      if (value) { next.push(value); placed.add(id) }
    }
    for (const [id, chat] of byId) if (!placed.has(id)) next.push(chat)
    // Collapse a twin the other device created for the same chat (two ids, one
    // message sequence), exactly like a full merge does — but only for chats
    // this delta introduced, so a change can never delete a chat it did not
    // mention. The local copy comes first, so the newcomer is the one dropped.
    if (addedIds.size) {
      const seen = new Set<string>()
      const kept: unknown[] = []
      for (const chat of next) {
        const id = isObj(chat) && typeof chat.id === 'string' ? chat.id : ''
        const fp = isObj(chat) ? chatFingerprint(chat) : null
        if (fp) {
          if (addedIds.has(id) && seen.has(fp)) continue
          seen.add(fp)
        }
        kept.push(chat)
      }
      chats = kept
    } else {
      chats = next
    }
  }

  let workspaces: Record<string, unknown> = { ...(local.workspaces ?? {}) }
  for (const [id, ws] of Object.entries(delta.workspaces?.upsert ?? {})) {
    const prev = workspaces[id]
    if (!isObj(prev) || !isObj(ws)) { workspaces[id] = ws; continue }
    // The delta carries the newer workspace metadata, so unlike a full merge
    // it must win; revisions still union so neither device loses history.
    const merged = mergeWorkspace(prev, ws)
    workspaces[id] = { ...merged, ...ws, revisions: merged.revisions }
  }
  for (const id of delta.workspaces?.del ?? []) {
    if (latestRevisionAt(workspaces[id]) <= delta.at) delete workspaces[id]
  }

  let selected: Record<string, unknown> = { ...(local.selectedRevision ?? {}) }
  for (const [id, rev] of Object.entries(delta.selectedRevision?.set ?? {})) selected[id] = rev
  for (const id of delta.selectedRevision?.del ?? []) delete selected[id]
  selected = mergeSelectedRevision(selected, {}, workspaces)

  // Keep the open-chat pointer valid after a delete. The local choice wins
  // whenever it survived, matching the full-merge behavior.
  const open = typeof settings.chat === 'string' ? settings.chat : ''
  const openAlive = open && chats.some((c) => isObj(c) && c.id === open)
  if (!openAlive) settings = { ...settings, chat: isObj(chats[0]) && typeof (chats[0] as Obj).id === 'string' ? (chats[0] as Obj).id : '' }

  return { settings, chats, workspaces, selectedRevision: selected }
}

/** Update the server-state baseline after applying a delta from the slot.
 *  Values are hashed exactly as they arrive, so this never needs a second
 *  full copy of the remote store. */
export function applyDeltaToBaseline(base: SyncBaseline, delta: SyncDelta): SyncBaseline {
  const out: SyncBaseline = {
    ...base,
    settings: { ...base.settings },
    chats: { ...base.chats },
    workspaces: { ...base.workspaces },
    selected: { ...base.selected },
  }
  for (const [k, v] of Object.entries(delta.settings?.set ?? {})) out.settings[k] = hashValue(v)
  for (const k of delta.settings?.del ?? []) delete out.settings[k]

  for (const op of delta.chats?.ops ?? []) {
    if (!op || typeof op.id !== 'string') continue
    if (op.full && isObj(op.full)) { out.chats[op.id] = baselineChat({ ...op.full, id: op.id }); continue }
    const prev = out.chats[op.id] ?? { h: '', m: [], mh: {} }
    const h = op.meta ? hashValue({ ...op.meta, id: op.id }) : prev.h
    let m = [...prev.m]
    const mh = { ...prev.mh }
    const put = (msg: unknown) => {
      const id = msgId(msg)
      if (!id) return
      mh[id] = hashValue(msg)
      if (!m.includes(id)) m.push(id)
    }
    for (const msg of op.update ?? []) put(msg)
    for (const msg of op.add ?? []) put(msg)
    for (const id of op.del ?? []) { delete mh[id]; m = m.filter((x) => x !== id) }
    if (op.order) m = op.order.filter((id) => id in mh)
    out.chats[op.id] = { h, m, mh }
  }
  for (const id of delta.chats?.del ?? []) delete out.chats[id]

  for (const [id, ws] of Object.entries(delta.workspaces?.upsert ?? {})) out.workspaces[id] = hashValue(ws)
  for (const id of delta.workspaces?.del ?? []) delete out.workspaces[id]

  for (const [id, rev] of Object.entries(delta.selectedRevision?.set ?? {})) out.selected[id] = hashValue(rev)
  for (const id of delta.selectedRevision?.del ?? []) delete out.selected[id]

  return out
}

/** Number of messages (or whole chats) a delta touches, for tests and for a
 *  compact status line. */
export const deltaOps = (delta: SyncDelta): number =>
  (delta.chats?.ops?.length ?? 0) + (delta.chats?.del?.length ?? 0) +
  (delta.workspaces?.upsert ? Object.keys(delta.workspaces.upsert).length : 0) + (delta.workspaces?.del?.length ?? 0)

