/* Optional password-based backup encryption (AES-GCM + PBKDF2, WebCrypto).
 * Unencrypted backups/sync remain the default; this is opt-in only.
 * Format: { alg:'AES-GCM-256+PBKDF2-SHA256-250k', salt, iv, data } (base64). */

export const BACKUP_CRYPTO_ALG = 'AES-GCM-256+PBKDF2-SHA256-250k'
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
