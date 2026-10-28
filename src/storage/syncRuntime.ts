/* Automatic device-sync runtime.
 *
 * One place owns the token/auto bookkeeping and the push/pull orchestration so
 * the settings UI stays thin:
 *   - on boot and whenever the tab becomes visible, and on a slow interval, the
 *     newest remote changes are pulled and smart-merged into local state;
 *   - local changes (chats, workspaces or settings) are debounced and pushed,
 *     so the average user never presses a sync button;
 *   - manual push/pull in the settings UI call the same helpers.
 * All work is best-effort: a failed sync must never break the app.
 *
 * Reads and writes are incremental. A push sends only the entities and
 * messages that changed since the last synced sequence, and a pull asks the
 * server for changes after that sequence. Only a first link (or a reset after
 * the server compacted its log) transfers the complete snapshot, which is why
 * a newly linked device still receives every part of the save. */

import { buildSyncPayload, checkSyncCompat, decryptSyncDelta, decryptSyncPayload, encryptSyncDelta, encryptSyncPayload, parseSyncToken, type SyncPayload } from './sync'
import { mergeSyncData, type SyncData } from './syncMerge'
import { applyDeltaToBaseline, applySyncDelta, baselineFromData, baselineMatches, computeSyncDelta, emptyBaseline, type SyncBaseline, type SyncDelta } from './syncDelta'
import { detectChatConflicts, recordSyncConflicts } from './syncConflicts'
import { shapeSyncData } from './syncShaping'
import { syncPull, syncPush } from './syncClient'
import { durableGetSyncBase, durablePutSyncBase } from './durable'
import { useS } from '../store'
import { STORE_VERSION } from '../persistence'

/* Device sync is on. It was switched off while every push uploaded the whole
 * store; with incremental deltas the loops move only what changed, so the
 * Settings section and the background runtime are enabled again. Set this to
 * false to hide the UI and stop every timer. */
export const DEVICE_SYNC_ENABLED = true

/* Device-local link state, deliberately outside the synced store: the token is
 * the credential that opens the slot itself, and auto/last-sync describe this
 * device's link rather than shared configuration. Everything else syncs. */
const TOKEN_KEY = 'byok.sync.token'
const AUTO_KEY = 'byok.sync.auto'
const LAST_KEY = 'byok.sync.last'

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
 *  view onto another conversation every time it pushed. */
export const SYNC_LIVE_ONLY = ['busy', 'draft', 'drafts', 'notice', 'flashMsg', 'researchPanel', 'chat', 'newChatPending', 'activeProject']

export const getSyncToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
export const setSyncToken = (t: string): void => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* blocked storage */ } }
export const getAutoSync = (): boolean => { try { return localStorage.getItem(AUTO_KEY) === '1' } catch { return false } }
export const setAutoSync = (on: boolean): void => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0') } catch { /* blocked storage */ } }
export const getLastSync = (): number => { try { return Number(localStorage.getItem(LAST_KEY) ?? 0) || 0 } catch { return 0 } }
const setLastSync = (t: number): void => { try { localStorage.setItem(LAST_KEY, String(t)) } catch { /* blocked storage */ } }

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

/** Fetch and decrypt the remote slot without touching local state. Used by the
 *  linking flow: a new device receives the complete snapshot plus any deltas
 *  layered on it, then chooses how to combine it with this device. */
export async function fetchRemote(token = getSyncToken()): Promise<{ data: SyncData; updatedAt: number; backend: string; seq: number }> {
  if (!token) throw Error('No sync token on this device.')
  const r = await syncPull(token)
  if (!r.payload) throw Error('The sync slot returned no complete snapshot.')
  const payload = await decryptSyncPayload(r.payload, token)
  assertCompatible(payload, r.exportVersion, r.storeVersion)
  let data = toSyncData(payload)
  for (const raw of r.deltas ?? []) data = applySyncDelta(data, await decryptDelta(raw, token))
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

  if (r.payload) {
    // First pull, or the server compacted past our sequence. Rebuild the
    // complete remote state from the snapshot and its pending deltas, then
    // smart-merge it with this device.
    const payload = await decryptSyncPayload(r.payload, token)
    assertCompatible(payload, r.exportVersion, r.storeVersion)
    let remote = toSyncData(payload)
    for (const raw of r.deltas ?? []) remote = applySyncDelta(remote, await decryptDelta(raw, token))
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

async function pushFull(token: string, baseSeq: number): Promise<{ updatedAt: number; backend: string; seq: number }> {
  const data = shapeSyncData(readLocalData())
  const payload = buildSyncPayload({ storeVersion: STORE_VERSION, settings: data.settings, chats: data.chats, workspaces: data.workspaces, selectedRevision: data.selectedRevision })
  const r = await syncPush(token, { payload: await encryptSyncPayload(payload, token), baseSeq, storeVersion: payload.storeVersion, exportVersion: payload.v })
  const seq = Number(r.seq) || 0
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

  // A first push, or the slot disappeared (server restart, expiry). Re-seed
  // with a complete snapshot; if the slot actually exists, the server's 409
  // sends us through pull-and-merge before retrying, so nothing is overwritten.
  if (base.seq === 0 || (pullError && isMissingSlot(pullError))) {
    if (pullError && !isMissingSlot(pullError)) throw pullError
    return pushFullWithRetry(token, 0)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const data = shapeSyncData(readLocalData())
    const delta = computeSyncDelta(base, data)
    if (!delta) return { updatedAt: getLastSync(), backend: 'up-to-date', seq: base.seq }
    try {
      const r = await syncPush(token, {
        delta: await encryptSyncDelta(delta, token),
        baseSeq: base.seq,
        storeVersion: STORE_VERSION,
        exportVersion: 4,
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
  applySyncData(data)
  // "Use the other device" is exactly what the slot already holds: adopting it
  // needs no upload at all. The baseline is the remote state, so any local-only
  // settings still ride the next delta.
  if (mode === 'remote') {
    setBaseline(baselineFromData(remote, tokenIdFor(token), remoteSeq))
    setLastSync(Date.now())
    return { updatedAt: Date.now(), backend: 'remote', seq: remoteSeq }
  }
  const shaped = shapeSyncData(data)
  const payload = buildSyncPayload({ storeVersion: STORE_VERSION, settings: shaped.settings, chats: shaped.chats, workspaces: shaped.workspaces, selectedRevision: shaped.selectedRevision })
  const r = await syncPush(token, { payload: await encryptSyncPayload(payload, token), baseSeq: remoteSeq, storeVersion: payload.storeVersion, exportVersion: payload.v })
  const seq = Number(r.seq) || 0
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
