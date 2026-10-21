/* Automatic device-sync runtime.
 *
 * One place owns the token/auto bookkeeping and the push/pull orchestration so
 * the settings UI stays thin:
 *   - on boot and whenever the tab becomes visible, and on a slow interval, the
 *     newest remote snapshot is pulled and smart-merged into local state;
 *   - local changes (chats, workspaces or settings) are debounced and pushed,
 *     so the average user never presses a sync button;
 *   - manual push/pull in the settings UI call the same helpers.
 * All work is best-effort: a failed sync must never break the app. */

import { buildSyncPayload, checkSyncCompat, decryptSyncPayload, encryptSyncPayload, type SyncPayload } from './sync'
import { mergeSyncData, type SyncData } from './syncMerge'
import { syncPull, syncPush } from './syncClient'
import { useS } from '../store'
import { STORE_VERSION } from '../persistence'

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
 *  new setting is synced without touching this list. */
export const SYNC_LIVE_ONLY = ['busy', 'draft', 'drafts', 'notice', 'flashMsg', 'researchPanel']

export const getSyncToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
export const setSyncToken = (t: string): void => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* blocked storage */ } }
export const getAutoSync = (): boolean => { try { return localStorage.getItem(AUTO_KEY) === '1' } catch { return false } }
export const setAutoSync = (on: boolean): void => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0') } catch { /* blocked storage */ } }
export const getLastSync = (): number => { try { return Number(localStorage.getItem(LAST_KEY) ?? 0) || 0 } catch { return 0 } }
const setLastSync = (t: number): void => { try { localStorage.setItem(LAST_KEY, String(t)) } catch { /* blocked storage */ } }

/** Whether background automatic push/pull should run. Manual sync works with
 *  or without this, so it only gates the timers. */
export const autoSyncEnabled = (): boolean => !!getSyncToken() && getAutoSync()

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
  applying = true
  try {
    useS.setState({
      ...data.settings,
      chats: data.chats as never,
      workspaces: data.workspaces as never,
      selectedRevision: data.selectedRevision as never,
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

/** Fetch and decrypt the remote slot without touching local state. */
export async function fetchRemote(token = getSyncToken()): Promise<{ data: SyncData; updatedAt: number; backend: string }> {
  if (!token) throw Error('No sync token on this device.')
  const r = await syncPull(token)
  const payload = await decryptSyncPayload(r.payload, token)
  assertCompatible(payload, r.exportVersion, r.storeVersion)
  return { data: toSyncData(payload), updatedAt: r.updatedAt, backend: r.backend }
}

/** Pull the remote slot and merge it into local state. Returns the merge, which
 *  the caller can push if it wants both devices to converge. */
export async function pullAndMerge(token = getSyncToken()): Promise<{ data: SyncData; updatedAt: number; backend: string }> {
  if (!token) throw Error('No sync token on this device.')
  const r = await syncPull(token)
  const payload = await decryptSyncPayload(r.payload, token)
  assertCompatible(payload, r.exportVersion, r.storeVersion)
  const data = mergeSyncData(readLocalData(), toSyncData(payload), 'merge')
  applySyncData(data)
  setLastSync(r.updatedAt)
  return { data, updatedAt: r.updatedAt, backend: r.backend }
}

/** Encrypt and upload the current local state. */
export async function pushNow(token = getSyncToken()): Promise<{ updatedAt: number; backend: string }> {
  if (!token) throw Error('No sync token on this device.')
  const data = readLocalData()
  const payload = buildSyncPayload({ storeVersion: STORE_VERSION, settings: data.settings, chats: data.chats, workspaces: data.workspaces, selectedRevision: data.selectedRevision })
  const r = await syncPush(token, await encryptSyncPayload(payload, token), { storeVersion: payload.storeVersion, exportVersion: payload.v })
  setLastSync(r.updatedAt)
  return r
}

/** Apply a freshly linked remote snapshot using the chosen merge mode, then
 *  upload the result so the two devices agree. */
export async function linkAndMerge(token: string, mode: 'merge' | 'remote' | 'local', remote: SyncData): Promise<{ updatedAt: number; backend: string }> {
  const data = mergeSyncData(readLocalData(), remote, mode)
  applySyncData(data)
  const payload = buildSyncPayload({ storeVersion: STORE_VERSION, settings: data.settings, chats: data.chats, workspaces: data.workspaces, selectedRevision: data.selectedRevision })
  const r = await syncPush(token, await encryptSyncPayload(payload, token), { storeVersion: payload.storeVersion, exportVersion: payload.v })
  setLastSync(r.updatedAt)
  return r
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
  if (started || typeof window === 'undefined') return
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
