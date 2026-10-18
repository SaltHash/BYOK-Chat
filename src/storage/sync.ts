/* Token-based sync: one super-long shared token links two devices.
 * Token format: `byok1-<id>-<secret>` where id = 12 random bytes, secret =
 * 32 random bytes (base64url, no padding). The id is the DB row key; the
 * secret authenticates (server stores only sha256(secret)). The full token
 * is the only thing the user ever copies.
 * Payloads are versioned ({ v, storeVersion }) for backwards compatibility. */

import { decryptBackup, encryptBackup } from './backupCrypto'

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

/* Display form for a sync token: everything from three characters after the
 * first hyphen up to three characters before the end becomes asterisks, so the
 * header still reads `byok1-abc****************…xyz` without ever putting the
 * full secret on screen. The real token is only kept in the copy button. */
export function maskSyncToken(token: string): string {
  const t = String(token || '')
  const h = t.indexOf('-')
  if (h < 0) return t
  const start = h + 4
  const end = t.length - 3
  if (end <= start) return t
  return t.slice(0, start) + '*'.repeat(end - start) + t.slice(end)
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

/* ---- end-to-end payload encryption ----
 *
 * The payload is encrypted on the device with the sync token itself
 * (AES-GCM-256 + PBKDF2-SHA256 via backupCrypto): the server stores an opaque
 * envelope, so even a database leak reveals no settings, chats or API keys,
 * while any device holding the token can read the slot. Plain objects pushed
 * by older builds are still accepted on pull. */
export type SyncEnvelope = { encrypted: string }

/* Worker/Node hosts cap request bodies at 8 MB; base64 inflates by ~4/3, so
 * keep the plaintext JSON under about 5.7 MB. */
export const SYNC_PLAINTEXT_MAX_BYTES = 5_700_000

export async function encryptSyncPayload(payload: SyncPayload, token: string): Promise<SyncEnvelope> {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json).length
  if (bytes > SYNC_PLAINTEXT_MAX_BYTES) {
    throw Error(`This sync data is too large to encrypt (${(bytes / 1e6).toFixed(1)} MB; the limit is about 5.7 MB). Trim chats, or export a file backup instead.`)
  }
  return { encrypted: await encryptBackup(json, token) }
}

export async function decryptSyncPayload(body: unknown, token: string): Promise<SyncPayload> {
  if (body && typeof body === 'object' && typeof (body as SyncEnvelope).encrypted === 'string') {
    return JSON.parse(await decryptBackup((body as SyncEnvelope).encrypted, token)) as SyncPayload
  }
  // Legacy plaintext payload from a device running an older build.
  if (body && typeof body === 'object') return body as SyncPayload
  throw Error('That sync slot does not contain a usable payload.')
}
