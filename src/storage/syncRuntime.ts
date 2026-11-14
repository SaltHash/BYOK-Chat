/* Automatic device-sync runtime.
 *
 * One place owns the token/option bookkeeping and the push/pull orchestration
 * so the settings UI stays thin:
 *   - on boot and whenever the tab becomes visible, and on a slow interval, the
 *     newest remote changes are pulled and smart-merged into local state;
 *   - local changes (chats, workspaces or settings) are debounced and pushed,
 *     so the average user never presses a sync button;
 *   - manual push/pull in the settings UI call the same helpers.
 * All work is best-effort: a failed sync must never break the app.
 *
 * Two data classes travel separately, both incrementally:
 *
 *   settings  one encrypted snapshot plus one encrypted delta per change;
 *   chats     only when the user opts in: one encrypted row per chat and one
 *             encrypted row per message, pulled by sequence so a device never
 *             re-downloads a message it already has.
 *
 * Chats are NOT stored on the server by default. Neither are API keys. Both
 * are explicit opt-ins in Settings → Data → Device sync. Turning the chat store
 * off pushes a settings-only snapshot, which also deletes every stored chat
 * row from the slot.
 */

import { buildSyncPayload, checkSyncCompat, decryptSyncDelta, decryptSyncPayload, encryptSyncDelta, encryptSyncPayload, parseSyncToken, type SyncPayload } from './sync'
import { chatChangesToDelta, encryptChatPush, encryptChatPushChunks, type SyncChatPush } from './chatSync'
import { mergeSyncData, type SyncData } from './syncMerge'
import { applyDeltaToBaseline, applySyncDelta, baselineFromData, baselineMatches, computeSyncDelta, emptyBaseline, settingsOnlyDelta, type SyncBaseline, type SyncDelta } from './syncDelta'
import { detectChatConflicts, recordSyncConflicts } from './syncConflicts'
import { shapeSyncData, type SyncShapeOptions } from './syncShaping'
import { syncPull, syncPush, type SyncPullResult } from './syncClient'
import { durableGetSyncBase, durablePutSyncBase } from './durable'
import { clearSyncKeyCache } from './backupCrypto'
import { useS } from '../store'
import { STORE_VERSION } from '../persistence'

/* Device sync is on. Set this to false to hide the UI and stop every timer. */
export const DEVICE_SYNC_ENABLED = true

/* Device-local link state, deliberately outside the synced store: the token is
 * the credential that opens the slot itself, and auto/last-sync describe this
 * device's link rather than shared configuration. Everything else syncs. */
const TOKEN_KEY = 'byok.sync.token'
const AUTO_KEY = 'byok.sync.auto'
const LAST_KEY = 'byok.sync.last'
/** Opt-in: store conversations in the sync slot. Off by default. */
const CHATS_KEY = 'byok.sync.chats'
/** Opt-in: include endpoint/search/MCP credentials. Off by default. */
const KEYS_KEY = 'byok.sync.keys'

/** How often an open, idle tab checks the sync slot. */
export const SYNC_PULL_INTERVAL_MS = 5 * 60_000
/** Quiet period after a local change before it is pushed. */
export const SYNC_PUSH_DEBOUNCE_MS = 2500
/** Backoff after a failed push; the next edit retries sooner. */
export const SYNC_PUSH_RETRY_MS = 30_000
/** Live-only fields that must never ride a remote snapshot. Every other field
 *  in the store is configuration/content and is included automatically, so a
 *  new setting is synced without touching this list.
 *
 *  The view pointers belong here too: which chat is open (`chat`), whether a
 *  new chat is being started (`newChatPending`) and whether a project overview
 *  is showing (`activeProject`) are this device's position in the UI, not
 *  shared configuration. Syncing them let a peer's last-used chat drag the
 *  view onto another conversation every time it pushed.
 *
 *  The kept usage ledger is deliberately device-local as well: it is this
 *  browser's permanent usage history (its own storage key, capped at 12,000
 *  attempts), so uploading it would bloat every payload and let a peer's
 *  history replace this device's. */
export const SYNC_LIVE_ONLY = ['busy', 'busyChats', 'doneChats', 'queued', 'draft', 'drafts', 'notice', 'flashMsg', 'researchPanel', 'chat', 'newChatPending', 'activeProject', 'usage', 'usageTitles', 'runJournal']

export const getSyncToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
export const setSyncToken = (t: string): void => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* blocked storage */ }
  // A different token means a different key: never reuse a derived key (or a
  // baseline) from the previous slot.
  clearSyncKeyCache()
}
export const getAutoSync = (): boolean => { try { return localStorage.getItem(AUTO_KEY) === '1' } catch { return false } }
export const setAutoSync = (on: boolean): void => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0') } catch { /* blocked storage */ } }
export const getLastSync = (): number => { try { return Number(localStorage.getItem(LAST_KEY) ?? 0) || 0 } catch { return 0 } }
const setLastSync = (t: number): void => { try { localStorage.setItem(LAST_KEY, String(t)) } catch { /* blocked storage */ } }

/* The two storage options are read on every push, so keep the last value in
 * memory as well. Storage being blocked (private mode, a test host without a
 * DOM) must not silently flip an opt-in off after the user enabled it. */
/** Set when an option that changes what the snapshot may contain was toggled:
 *  the next push must rewrite the snapshot, not send a delta, or the old
 *  snapshot (with keys or chats) would stay in the slot forever. */
let forceFullPush = false

const optionCache = new Map<string, boolean>()
const readFlag = (key: string): boolean => {
  const cached = optionCache.get(key)
  if (cached !== undefined) return cached
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
const writeFlag = (key: string, on: boolean): void => {
  optionCache.set(key, on)
  try { localStorage.setItem(key, on ? '1' : '0') } catch { /* blocked storage */ }
}

/** Whether conversations are stored in the slot. Off unless opted in. */
export const getSyncChats = (): boolean => readFlag(CHATS_KEY)
/** Whether credentials are stored in the slot. Off unless opted in. */
export const getSyncKeys = (): boolean => readFlag(KEYS_KEY)

/** Change what the slot holds. Resets the delta baseline and drops the derived
 *  key so the next push rewrites the slot from scratch under the new policy. */
export function setSyncChats(on: boolean): void {
  writeFlag(CHATS_KEY, on)
  // The slot's shape changes completely: rewrite the snapshot and the rows
  // instead of sending a delta shaped under the old policy. The baseline is
  // kept so the rewrite can also emit tombstones for chats being removed.
  forceFullPush = true
}

export function setSyncKeys(on: boolean): void {
  writeFlag(KEYS_KEY, on)
  // The stored snapshot may hold credentials from before the toggle; only a
  // full rewrite replaces it.
  forceFullPush = true
}

export function getSyncShapeOptions(): SyncShapeOptions {
  return { chats: getSyncChats(), includeKeys: getSyncKeys() }
}

/** Whether background automatic push/pull should run. Manual sync works with
 *  or without this, so it only gates the timers. */
export const autoSyncEnabled = (): boolean => DEVICE_SYNC_ENABLED && !!getSyncToken() && getAutoSync()

/** Snapshot this device's synchronisable state. */
export function readLocalData(): SyncData {
  const s = useS.getState() as unknown as Record<string, unknown>
  const { chats, workspaces, selectedRevision, ...settings } = s
  for (const k of SYNC_LIVE_ONLY) delete settings[k]
  return {
    settings,
    chats: Array.isArray(chats) ? chats : [],
    workspaces: (workspaces && typeof workspaces === 'object' ? workspaces : {}) as Record<string, unknown>,
    selectedRevision: (selectedRevision && typeof selectedRevision === 'object' ? selectedRevision : {}) as Record<string, unknown>,
  }
}

/** Apply a merged snapshot without tripping the change watcher that would push
 *  the result straight back (and risk a push/pull loop). */
let applying = false
export function applySyncData(data: SyncData): void {
  // The open-chat pointer is device-local (see SYNC_LIVE_ONLY), so the merged
  // settings never carry it and the view stays where the user left it. The one
  // repair left to do here is a pointer whose chat the merge deleted: the real
  // pointer is only known at this boundary, not in the pure merge.
  const current = useS.getState() as unknown as { chat?: unknown; newChatPending?: unknown; activeProject?: unknown; draft?: unknown; drafts?: unknown; busy?: unknown; notice?: unknown; flashMsg?: unknown; researchPanel?: unknown }
  const settings = { ...data.settings }
  // Full snapshots from older clients may contain live-only fields. Filter at
  // the final write boundary as well as during normal snapshot creation.
  for (const key of SYNC_LIVE_ONLY) delete settings[key]
  const chats = Array.isArray(data.chats) ? (data.chats as { id?: unknown; archived?: boolean }[]) : []
  const pointer = typeof current.chat === 'string' ? current.chat : ''
  const repair = pointer && !chats.some((c) => !!c && c.id === pointer)
  applying = true
  try {
    useS.setState({
      ...settings,
      chats: data.chats as never,
      workspaces: data.workspaces as never,
      selectedRevision: data.selectedRevision as never,
      ...(repair ? { chat: chats.find(c => !c.archived)?.id ?? '' } : {}),
    } as unknown as Parameters<typeof useS.setState>[0])
  } finally {
    // Never let the applied snapshot look like a fresh local edit, or the
    // watcher would push it straight back and the two devices would chatter.
    refreshWatchers()
    setTimeout(() => {
      applying = false
      // A local edit that landed while this snapshot was being applied still
      // needs to reach the slot (the merged state above already includes it).
      if (pendingDirty) schedulePush()
    }, 0)
  }
}

const toSyncData = (p: SyncPayload): SyncData => ({
  settings: (p.settings && typeof p.settings === 'object' ? p.settings : {}) as Record<string, unknown>,
  chats: Array.isArray(p.chats) ? p.chats : [],
  workspaces: (p.workspaces && typeof p.workspaces === 'object' ? p.workspaces : {}) as Record<string, unknown>,
  selectedRevision: (p.selectedRevision && typeof p.selectedRevision === 'object' ? p.selectedRevision : {}) as Record<string, unknown>,
})

/** Refuse a payload this build cannot read (a newer export format) before we
 *  touch local state. Version warnings are harmless and ignored. */
const assertCompatible = (payload: SyncPayload, exportVersion?: number, storeVersion?: number): void => {
  const compat = checkSyncCompat({ v: exportVersion ?? payload.v, storeVersion: storeVersion ?? payload.storeVersion }, STORE_VERSION)
  if (!compat.ok) throw Error(compat.warning)
}

/* ---- incremental-sync baseline ---- */

const tokenIdFor = (token: string): string => {
  try { return parseSyncToken(token).id } catch { return '' }
}

let baselineCache: SyncBaseline | null = null
let baselineId = ''

async function loadBaseline(token: string): Promise<SyncBaseline> {
  const id = tokenIdFor(token)
  if (baselineCache && baselineId === id && baselineMatches(baselineCache, id)) return baselineCache
  let stored: unknown = null
  try { stored = await durableGetSyncBase<unknown>() } catch { /* no durable storage: start clean */ }
  const typed = stored as SyncBaseline | null
  baselineCache = baselineMatches(typed, id) ? typed : emptyBaseline(id)
  baselineId = id
  return baselineCache
}

function setBaseline(base: SyncBaseline): void {
  baselineCache = base
  baselineId = base.tokenId
  void durablePutSyncBase(base).catch(() => { /* sync keeps working from memory */ })
}

/** Forget the in-memory sequence, e.g. after unlinking this device. */
export function resetSyncBaseline(): void {
  baselineCache = null
  baselineId = ''
}

const decryptDelta = async (raw: unknown, token: string): Promise<SyncDelta> => {
  // The server returns change-log entries as `{ seq, delta }` so a pull can be
  // ordered and verified; the envelope itself is inside `delta`.
  const envelope = raw && typeof raw === 'object' && 'delta' in raw ? (raw as { delta: unknown }).delta : raw
  const value = await decryptSyncDelta(envelope, token)
  if (!value || typeof value !== 'object' || (value as SyncDelta).v !== 1) {
    throw Error('That sync change was made by an incompatible app version.')
  }
  return value as SyncDelta
}

/** Decode the per-message rows of a pull into the same delta shape the merge
 *  engine already understands. */
async function rowsDeltaOf(r: SyncPullResult, token: string): Promise<SyncDelta | null> {
  return chatChangesToDelta(r.chats, r.messages, token)
}

/** Fetch and decrypt the remote slot without touching local state. Used by the
 *  linking flow: a new device receives the complete save plus any deltas
 *  layered on it, then chooses how to combine it with this device. */
export async function fetchRemote(token = getSyncToken()): Promise<{ data: SyncData; updatedAt: number; backend: string; seq: number }> {
  if (!token) throw Error('No sync token on this device.')
  const r = await syncPull(token)
  if (!r.payload) throw Error('The sync slot returned no complete snapshot.')
  const payload = await decryptSyncPayload(r.payload, token)
  assertCompatible(payload, r.exportVersion, r.storeVersion)
  let data = toSyncData(payload)
  for (const raw of r.deltas ?? []) data = applySyncDelta(data, await decryptDelta(raw, token))
  const rows = await rowsDeltaOf(r, token)
  if (rows) data = applySyncDelta(data, rows)
  return { data, updatedAt: r.updatedAt, backend: r.backend, seq: Number(r.seq) || 0 }
}

/** Pull the remote changes after this device's last sequence and merge them
 *  into local state. Returns the merge, which the caller can push if it wants
 *  both devices to converge. */
export async function pullAndMerge(token = getSyncToken()): Promise<{ data: SyncData; updatedAt: number; backend: string; seq: number }> {
  if (!token) throw Error('No sync token on this device.')
  const base = await loadBaseline(token)
  const r = await syncPull(token, base.seq)
  const seq = Number(r.seq) || 0
  if (r.upToDate) {
    setLastSync(r.updatedAt)
    return { data: readLocalData(), updatedAt: r.updatedAt, backend: r.backend, seq }
  }
  let data: SyncData
  let nextBase: SyncBaseline
  const rows = await rowsDeltaOf(r, token)

  if (r.payload) {
    // First pull, or the server compacted past our sequence. Rebuild the
    // complete remote state from the snapshot and its pending deltas, then
    // smart-merge it with this device.
    const payload = await decryptSyncPayload(r.payload, token)
    assertCompatible(payload, r.exportVersion, r.storeVersion)
    let remote = toSyncData(payload)
    for (const raw of r.deltas ?? []) remote = applySyncDelta(remote, await decryptDelta(raw, token))
    if (rows) remote = applySyncDelta(remote, rows)
    const local = readLocalData()
    recordSyncConflicts(detectChatConflicts(local.chats, remote.chats))
    data = mergeSyncData(local, remote, 'merge')
    nextBase = baselineFromData(remote, base.tokenId, seq)
  } else {
    // Only the changes we missed: apply them to the current save without
    // replacing it, and advance the hash baseline by the same operations.
    const deltas = await Promise.all((r.deltas ?? []).map(raw => decryptDelta(raw, token)))
    let current = readLocalData()
    let next = base
    for (const delta of deltas) {
      current = applySyncDelta(current, delta)
      next = applyDeltaToBaseline(next, delta)
    }
    if (rows) {
      current = applySyncDelta(current, rows)
      next = applyDeltaToBaseline(next, rows)
    }
    data = current
    nextBase = { ...next, seq }
  }
  nextBase.seq = seq
  applySyncData(data)
  setBaseline(nextBase)
  setLastSync(r.updatedAt)
  return { data, updatedAt: r.updatedAt, backend: r.backend, seq }
}

const isMissingSlot = (error: unknown): boolean => {
  const e = error as { status?: number; code?: string; message?: string }
  return e?.status === 404 || e?.status === 410 || e?.code === 'empty' || e?.code === 'expired' || /slot is empty|unknown or incorrect sync token/i.test(String(e?.message ?? ''))
}
const isConflict = (error: unknown): boolean =>
  (error as { status?: number }).status === 409 || (error as { code?: string }).code === 'sync_conflict'

/** Chat rows for a full push. A first push sends everything; a compacting
 *  push diffs against the current baseline so a chat deleted locally while the
 *  log was full still produces its tombstone. Large saves are split into
 *  requests the transport can carry. */
async function fullChatPushes(data: SyncData, token: string): Promise<SyncChatPush[]> {
  if (!getSyncChats()) return []
  const base = await loadBaseline(token)
  const from = base.seq > 0 ? base : emptyBaseline(tokenIdFor(token), 0)
  const all = computeSyncDelta(from, data)
  return encryptChatPushChunks(all?.chats, token)
}

/** Send the remaining chat chunks after the request that seeded the slot. */
async function pushChatChunks(token: string, chunks: SyncChatPush[], fromSeq: number): Promise<number> {
  let seq = fromSeq
  for (const chunk of chunks) {
    const r = await syncPush(token, { chats: chunk, baseSeq: seq, storeVersion: STORE_VERSION, exportVersion: 4, chatStore: true, at: Date.now() })
    seq = Number(r.seq) || 0
  }
  return seq
}

async function pushFull(token: string, baseSeq: number): Promise<{ updatedAt: number; backend: string; seq: number }> {
  const data = shapeSyncData(readLocalData(), getSyncShapeOptions())
  // Conversations never ride the snapshot: with the chat store on they travel
  // as one row per message, and with it off they do not travel at all.
  const payload = buildSyncPayload({ storeVersion: STORE_VERSION, settings: data.settings, chats: [], workspaces: data.workspaces, selectedRevision: data.selectedRevision })
  const [firstChunk, ...restChunks] = await fullChatPushes(data, token)
  const r = await syncPush(token, {
    payload: await encryptSyncPayload(payload, token),
    baseSeq,
    storeVersion: payload.storeVersion,
    exportVersion: payload.v,
    // Always explicit: `false` tells the server to erase any conversations it
    // stored before the option was turned off.
    chatStore: getSyncChats(),
    ...(firstChunk ? { chats: firstChunk } : {}),
    at: Date.now(),
  })
  const seq = await pushChatChunks(token, restChunks, Number(r.seq) || 0)
  setBaseline(baselineFromData(data, tokenIdFor(token), seq))
  setLastSync(r.updatedAt)
  return { updatedAt: r.updatedAt, backend: r.backend, seq }
}

/** A full push can lose a race with another device; pull its changes, merge,
 *  and try again. Used for the first push and for log compaction. */
async function pushFullWithRetry(token: string, baseSeq: number): Promise<{ updatedAt: number; backend: string; seq: number }> {
  let base = baseSeq
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await pushFull(token, base)
    } catch (error) {
      if (!isConflict(error)) throw error
      await pullAndMerge(token)
      base = (await loadBaseline(token)).seq
    }
  }
  throw Error('Sync kept conflicting with another device. Try again in a moment.')
}

/** Encrypt and upload the current local state as a delta (or a full snapshot
 *  on a first push / after the server asks for compaction). */
export async function pushNow(token = getSyncToken()): Promise<{ updatedAt: number; backend: string; seq: number }> {
  if (!token) throw Error('No sync token on this device.')
  // Pull-and-merge first: a delta based on an older sequence would be rejected
  // (and a full push could erase newer work). A first push to an empty slot
  // fails here and proceeds to seed it.
  let pullError: unknown = null
  try { await pullAndMerge(token) } catch (error) { pullError = error }
  let base = await loadBaseline(token)

  // A storage option changed: the stored snapshot itself must be replaced, not
  // patched, or the previous credentials/chats would remain in the slot.
  if (forceFullPush) {
    forceFullPush = false
    return pushFullWithRetry(token, base.seq)
  }

  // A first push, or the slot disappeared (server restart, expiry). Re-seed
  // with a complete snapshot; if the slot actually exists, the server's 409
  // sends us through pull-and-merge before retrying, so nothing is overwritten.
  if (base.seq === 0 || (pullError && isMissingSlot(pullError))) {
    if (pullError && !isMissingSlot(pullError)) throw pullError
    return pushFullWithRetry(token, 0)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const data = shapeSyncData(readLocalData(), getSyncShapeOptions())
    const delta = computeSyncDelta(base, data)
    if (!delta) return { updatedAt: getLastSync(), backend: 'up-to-date', seq: base.seq }
    const settingsDelta = settingsOnlyDelta(delta)
    const chatStore = getSyncChats()
    const chats = chatStore
      ? await encryptChatPush(delta.chats, token)
      // With the store off, chat deletions only exist to clear an older slot:
      // the flag tells the server to erase its rows, so no rows need to travel.
      : (delta.chats?.del?.length ? { del: delta.chats.del } : undefined)
    try {
      const r = await syncPush(token, {
        ...(settingsDelta ? { delta: await encryptSyncDelta(settingsDelta, token) } : {}),
        ...(chats ? { chats } : {}),
        baseSeq: base.seq,
        storeVersion: STORE_VERSION,
        exportVersion: 4,
        chatStore,
        at: delta.at,
      })
      const seq = Number(r.seq) || 0
      setBaseline(baselineFromData(data, tokenIdFor(token), seq))
      setLastSync(r.updatedAt)
      // The log is full. Replace it with one complete snapshot now, so a new
      // device never has to replay an unbounded chain of deltas.
      if (r.compact) return pushFullWithRetry(token, seq)
      return { updatedAt: r.updatedAt, backend: r.backend, seq }
    } catch (error) {
      if (!isConflict(error)) throw error
      try {
        await pullAndMerge(token)
      } catch (pullError) {
        // The slot disappeared between our pull and our write (server restart
        // or expiry). Re-seed it with a full snapshot instead of looping.
        if (isMissingSlot(pullError)) return pushFullWithRetry(token, 0)
        throw pullError
      }
      base = await loadBaseline(token)
    }
  }
  throw Error('Sync kept conflicting with another device. Try again in a moment.')
}

/** Apply a freshly linked remote snapshot using the chosen merge mode, then
 *  upload the result so the two devices agree. A first link sends the complete
 *  save; later writes are deltas. */
export async function linkAndMerge(token: string, mode: 'merge' | 'remote' | 'local', remote: SyncData, remoteSeq = 0): Promise<{ updatedAt: number; backend: string; seq: number }> {
  const local = readLocalData()
  if (mode === 'merge') recordSyncConflicts(detectChatConflicts(local.chats, remote.chats))
  const data = mergeSyncData(local, remote, mode)
  // Chats are not stored unless the user opted in, so a remote snapshot from
  // this slot cannot legitimately be empty of conversations while meaning
  // "delete them here". Keep this device's chats when the store is off.
  if (!getSyncChats() && mode === 'remote') data.chats = local.chats
  applySyncData(data)
  // "Use the other device" is exactly what the slot already holds: adopting it
  // needs no upload at all. The baseline is the remote state, so any local-only
  // settings still ride the next delta.
  if (mode === 'remote') {
    setBaseline(baselineFromData(remote, tokenIdFor(token), remoteSeq))
    setLastSync(Date.now())
    return { updatedAt: Date.now(), backend: 'remote', seq: remoteSeq }
  }
  const shaped = shapeSyncData(data, getSyncShapeOptions())
  const payload = buildSyncPayload({ storeVersion: STORE_VERSION, settings: shaped.settings, chats: [], workspaces: shaped.workspaces, selectedRevision: shaped.selectedRevision })
  const [firstChunk, ...restChunks] = await fullChatPushes(shaped, token)
  const r = await syncPush(token, {
    payload: await encryptSyncPayload(payload, token),
    baseSeq: remoteSeq,
    storeVersion: payload.storeVersion,
    exportVersion: payload.v,
    chatStore: getSyncChats(),
    ...(firstChunk ? { chats: firstChunk } : {}),
    at: Date.now(),
  })
  const seq = await pushChatChunks(token, restChunks, Number(r.seq) || 0)
  setBaseline(baselineFromData(shaped, tokenIdFor(token), seq))
  setLastSync(r.updatedAt)
  return { updatedAt: r.updatedAt, backend: r.backend, seq }
}

/* ---- background loops ---- */

let started = false
let pushing = false
let pendingDirty = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let watcherSettings: Record<string, unknown> = {}
let watcherChats: unknown = null
let watcherWorkspaces: unknown = null
let watcherSelected: unknown = null

/** The synchronisable slice of local state (everything but live-only fields). */
const snapshot = () => {
  const s = useS.getState() as unknown as Record<string, unknown>
  const { chats, workspaces, selectedRevision, ...settings } = s
  for (const k of SYNC_LIVE_ONLY) delete settings[k]
  return { settings, chats, workspaces, selectedRevision }
}
const refreshWatchers = () => {
  const { settings, chats, workspaces, selectedRevision } = snapshot()
  watcherSettings = settings
  watcherChats = chats
  watcherWorkspaces = workspaces
  watcherSelected = selectedRevision
}

const schedulePush = (delay = SYNC_PUSH_DEBOUNCE_MS) => {
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    if (!autoSyncEnabled()) return
    // A reply, an in-flight push or an incoming merge pauses the write, but
    // the change stays dirty and is retried when that state clears.
    if (pushing || applying || useS.getState().busy) { pendingDirty = true; return }
    if (!pendingDirty) return
    pendingDirty = false
    pushing = true
    void pushNow()
      .catch(() => { pendingDirty = true; schedulePush(SYNC_PUSH_RETRY_MS) })
      .finally(() => {
        pushing = false
        // A change that landed during the push still needs its own write.
        if (pendingDirty && !pushTimer) schedulePush()
      })
  }, delay)
}

/** Shallow compare of the synchronisable slice: immutable updates replace the
 *  object or array they touch, so reference equality is enough and cheap. */
const changed = () => {
  const { settings, chats, workspaces, selectedRevision } = snapshot()
  let dirty = chats !== watcherChats || workspaces !== watcherWorkspaces || selectedRevision !== watcherSelected
  if (!dirty) {
    const keys = new Set([...Object.keys(watcherSettings), ...Object.keys(settings)])
    for (const k of keys) if (watcherSettings[k] !== settings[k]) { dirty = true; break }
  }
  watcherSettings = settings
  watcherChats = chats
  watcherWorkspaces = workspaces
  watcherSelected = selectedRevision
  return dirty
}

/** Start the background pull/push loops. Safe to call once; idempotent. */
export function startSyncRuntime(): void {
  if (!DEVICE_SYNC_ENABLED || started || typeof window === 'undefined') return
  started = true
  refreshWatchers()
  let lastPull = 0
  const pull = () => {
    if (!autoSyncEnabled() || applying || useS.getState().busy) return
    // Focus/visibility events can flap; never pull more than once a minute.
    if (Date.now() - lastPull < 60_000) return
    lastPull = Date.now()
    void pullAndMerge().catch(() => { /* offline / empty slot: keep going */ })
  }
  // A short delay lets durable storage hydrate before the first merge.
  setTimeout(pull, 1500)
  setInterval(pull, SYNC_PULL_INTERVAL_MS)
  window.addEventListener('focus', pull)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull() })
  useS.subscribe(() => {
    if (!autoSyncEnabled() || applying) return
    if (changed()) pendingDirty = true
    if (pendingDirty && !useS.getState().busy) schedulePush()
  })
}
