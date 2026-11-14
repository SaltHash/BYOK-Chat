/* Optional password-based backup encryption (AES-GCM + PBKDF2, WebCrypto).
 * Unencrypted backups/sync remain the default; this is opt-in only.
 * Format: { alg:'AES-GCM-256+PBKDF2-SHA256-250k', salt, iv, data } (base64). */

export const BACKUP_CRYPTO_ALG = 'AES-GCM-256+PBKDF2-SHA256-250k'
/** Envelope used for device sync. The sync token already carries 256 bits of
 *  randomness, so a stretching KDF buys nothing: HKDF derives the key directly
 *  and binds the ciphertext to its slot and purpose with associated data. */
export const SYNC_CRYPTO_ALG = 'AES-GCM-256+HKDF-SHA256'
const ITERATIONS = 250_000

const te = () => new TextEncoder()
const td = () => new TextDecoder()

function b64e(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function b64d(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  if (!password) throw Error('Enter a password to encrypt the backup.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, te().encode(plaintext)))
  return JSON.stringify({ alg: BACKUP_CRYPTO_ALG, salt: b64e(salt), iv: b64e(iv), data: b64e(ct) })
}

export async function decryptBackup(payload: string, password: string): Promise<string> {
  const j = JSON.parse(payload)
  if (j?.alg !== BACKUP_CRYPTO_ALG || typeof j.salt !== 'string' || typeof j.iv !== 'string' || typeof j.data !== 'string') {
    throw Error('That file is not a password-encrypted backup.')
  }
  if (!password) throw Error('Enter the backup password to decrypt.')
  const key = await deriveKey(password, b64d(j.salt))
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) as BufferSource }, key, b64d(j.data) as BufferSource)
    return td().decode(pt)
  } catch { throw Error('Wrong password or corrupted backup.') }
}

export const isEncryptedBackup = (text: string): boolean => {
  try { return (JSON.parse(text) as { alg?: string })?.alg === BACKUP_CRYPTO_ALG } catch { return false }
}

/* ---- token-derived sync envelopes ----
 *
 * Every sync payload, delta and stored message is sealed with a key derived
 * from the sync token itself. The slot id is the HKDF salt (it is public) and
 * the purpose ("payload" / "delta") plus the slot id are authenticated as
 * associated data, so an envelope cannot be replayed into a different slot or
 * passed off as a different kind of record. Derived keys are cached per
 * session: the old PBKDF2 path re-ran 250k iterations for every message push. */

export type SyncPurpose = 'payload' | 'delta' | 'message' | 'chat'

const syncKeys = new Map<string, Promise<CryptoKey>>()
const syncPurposeTag = (token: string, purpose: SyncPurpose): string => {
  const id = String(token).split('-')[1] ?? ''
  return `byok-sync-v2|${purpose}|${id}`
}

async function deriveSyncKey(token: string, purpose: SyncPurpose): Promise<CryptoKey> {
  const cacheKey = `${purpose}\u0000${token}`
  const cached = syncKeys.get(cacheKey)
  if (cached) return cached
  const id = String(token).split('-')[1] ?? ''
  const derived = (async () => {
    const base = await crypto.subtle.importKey('raw', te().encode(token), 'HKDF', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: te().encode(id) as BufferSource, info: te().encode(syncPurposeTag(token, purpose)) as BufferSource },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  })()
  syncKeys.set(cacheKey, derived)
  // A failed derivation must not poison the cache forever.
  derived.catch(() => syncKeys.delete(cacheKey))
  return derived
}

/** Drop cached keys, e.g. when the user unlinks this device. */
export function clearSyncKeyCache(): void {
  syncKeys.clear()
}

/* Compact wire form: `v2.<base64url iv>.<base64url ciphertext>`. A per-message
 *  envelope is stored once per message, so dropping the JSON field names and
 *  padding saves roughly 60 bytes on every one of them. */
const b64url = (bytes: Uint8Array): string => b64e(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlD = (text: string): Uint8Array => {
  const norm = text.replace(/-/g, '+').replace(/_/g, '/')
  return b64d(norm + '='.repeat((4 - (norm.length % 4)) % 4))
}
const SYNC_WIRE_PREFIX = 'v2'

export async function encryptSecret(plaintext: string, token: string, purpose: SyncPurpose): Promise<string> {
  if (!token) throw Error('A sync token is required to encrypt.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveSyncKey(token, purpose)
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: te().encode(syncPurposeTag(token, purpose)) as BufferSource },
    key,
    te().encode(plaintext),
  ))
  return `${SYNC_WIRE_PREFIX}.${b64url(iv)}.${b64url(ct)}`
}

export async function decryptSecret(payload: string, token: string, purpose: SyncPurpose): Promise<string> {
  if (payload.startsWith(`${SYNC_WIRE_PREFIX}.`)) {
    const [prefix, iv, data, ...rest] = payload.split('.')
    if (prefix !== SYNC_WIRE_PREFIX || !iv || !data || rest.length) throw Error('That sync record is corrupt.')
    const key = await deriveSyncKey(token, purpose)
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64urlD(iv) as BufferSource, additionalData: te().encode(syncPurposeTag(token, purpose)) as BufferSource },
        key,
        b64urlD(data) as BufferSource,
      )
      return td().decode(pt)
    } catch { throw Error('Wrong sync token or corrupted sync data.') }
  }
  let j: { alg?: unknown; iv?: unknown; data?: unknown }
  try { j = JSON.parse(payload) } catch { throw Error('That sync record is corrupt.') }
  if (j?.alg === SYNC_CRYPTO_ALG) {
    if (typeof j.iv !== 'string' || typeof j.data !== 'string') throw Error('That sync record is corrupt.')
    const key = await deriveSyncKey(token, purpose)
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64d(j.iv) as BufferSource, additionalData: te().encode(syncPurposeTag(token, purpose)) as BufferSource },
        key,
        b64d(j.data) as BufferSource,
      )
      return td().decode(pt)
    } catch { throw Error('Wrong sync token or corrupted sync data.') }
  }
  // Envelopes written by older builds used PBKDF2 over the token.
  if (j?.alg === BACKUP_CRYPTO_ALG) return decryptBackup(payload, token)
  throw Error('That sync record uses an unknown encryption format.')
}
