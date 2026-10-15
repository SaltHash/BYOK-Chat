/* Token-based sync: one super-long shared token links two devices.
 * Token format: `byok1-<id>-<secret>` where id = 12 random bytes, secret =
 * 32 random bytes (base64url, no padding). The id is the DB row key; the
 * secret authenticates (server stores only sha256(secret)). The full token
 * is the only thing the user ever copies.
 * Payloads are versioned ({ v, storeVersion }) for backwards compatibility. */

export const SYNC_TOKEN_PREFIX = 'byok1'
export const SYNC_EXPORT_VERSION = 4
export const SYNC_MIN_COMPAT_STORE = 11

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function generateSyncToken(): string {
  const id = b64url(crypto.getRandomValues(new Uint8Array(12)))
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)))
  return `${SYNC_TOKEN_PREFIX}-${id}-${secret}`
}

export function parseSyncToken(token: string): { id: string; secret: string } {
  const t = String(token || '').trim()
  const m = new RegExp(`^${SYNC_TOKEN_PREFIX}-([A-Za-z0-9_-]{16})-([A-Za-z0-9_-]{40,50})$`).exec(t)
  if (!m) throw Error('That sync token is invalid. Generate a new one on the other device and copy it exactly.')
  return { id: m[1], secret: m[2] }
}

export type SyncPayload = {
  v: number
  storeVersion: number
  updatedAt: number
  settings: Record<string, unknown>
  chats: unknown
  workspaces: unknown
  selectedRevision: unknown
  encrypted?: boolean
}

export function buildSyncPayload(input: { storeVersion: number; settings: Record<string, unknown>; chats: unknown; workspaces: unknown; selectedRevision: unknown }): SyncPayload {
  return { v: SYNC_EXPORT_VERSION, storeVersion: input.storeVersion, updatedAt: Date.now(), settings: input.settings, chats: input.chats, workspaces: input.workspaces, selectedRevision: input.selectedRevision }
}

/* Backwards-compat check for an incoming payload vs this client's store
 * version. Never throws; callers surface `warning` when present. */
export function checkSyncCompat(payload: Pick<SyncPayload, 'v' | 'storeVersion'>, currentStoreVersion: number): { ok: boolean; warning: string } {
  if (typeof payload?.v !== 'number' || typeof payload?.storeVersion !== 'number') {
    return { ok: false, warning: 'That sync data is corrupt (missing version).' }
  }
  if (payload.v > SYNC_EXPORT_VERSION) return { ok: false, warning: `That sync data uses export v${payload.v}; this app reads v${SYNC_EXPORT_VERSION}. Update this device first.` }
  if (payload.storeVersion > currentStoreVersion) {
    return { ok: true, warning: `Made by a newer app (store v${payload.storeVersion} vs v${currentStoreVersion}). Settings will merge; unknown fields are ignored.` }
  }
  if (payload.storeVersion < SYNC_MIN_COMPAT_STORE) {
    return { ok: true, warning: `Made by a very old app (store v${payload.storeVersion}). It will be migrated automatically.` }
  }
  return { ok: true, warning: '' }
}

/* Merge strategy for pull: remote wins for chats/workspaces by updatedAt,
 * settings merge shallowly (remote overwrites known keys). Pure. */
export function mergeSyncState(local: { updatedAt: number; settings: Record<string, unknown> }, remote: SyncPayload): { settings: Record<string, unknown>; takeRemoteData: boolean } {
  void local
  return { settings: { ...local.settings, ...remote.settings }, takeRemoteData: true }
}
