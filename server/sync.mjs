/* Token sync HTTP logic (pure helpers + handlers). Token format is shared
 * with src/storage/sync.ts: `byok1-<id>-<secret>`. Route dispatch lives in
 * server/api.mjs so both the Node server and the Cloudflare Worker reuse it. */
import { sha256Hex, safeEqual } from './syncStore.mjs'
import { bearerToken, readBodyText } from './http.mjs'

const TOKEN_RE = /^byok1-([A-Za-z0-9_-]{16})-([A-Za-z0-9_-]{40,50})$/
export const SYNC_MAX_BYTES = 8_000_000

export function parseToken(raw) {
  const m = TOKEN_RE.exec(String(raw || '').trim())
  if (!m) { const e = Error('Invalid sync token.'); e.code = 'bad_token'; e.status = 400; throw e }
  return { id: m[1], secret: m[2] }
}

export { bearerToken }

async function readJson(req, max = SYNC_MAX_BYTES) {
  const raw = await readBodyText(req, max)
  if (raw === null) { const e = Error('Sync payload is too large (8 MB limit).'); e.code = 'too_large'; e.status = 413; throw e }
  try { return raw ? JSON.parse(raw) : {} } catch { const e = Error('Expected JSON.'); e.code = 'bad_json'; e.status = 400; throw e }
}

async function authRow(backend, token) {
  const { id, secret } = parseToken(token)
  const row = await backend.get(id)
  if (!row || !safeEqual(sha256Hex(secret), String(row.secretHash))) {
    const e = Error('Unknown or incorrect sync token.'); e.code = 'bad_token'; e.status = 401; throw e
  }
  return { row, id, secret }
}

export async function handleSyncPush(req, backend) {
  const body = await readJson(req)
  const token = body.token || bearerToken(req)
  const { id, secret } = parseToken(token)
  const payload = body.payload
  if (!payload || typeof payload !== 'object') { const e = Error('Missing payload object.'); e.code = 'bad_payload'; e.status = 400; throw e }
  const storeVersion = Number(body.storeVersion ?? payload.storeVersion ?? 18) || 18
  const exportVersion = Number(body.exportVersion ?? payload.v ?? 4) || 4
  const secretHash = sha256Hex(secret)
  const existing = await backend.get(id)
  if (existing && !safeEqual(secretHash, String(existing.secretHash))) {
    const e = Error('Unknown or incorrect sync token.'); e.code = 'bad_token'; e.status = 401; throw e
  }
  const row = { id, secretHash, payload, storeVersion, exportVersion, updatedAt: Date.now() }
  await backend.put(row)
  return { ok: true, id, updatedAt: row.updatedAt, storeVersion, exportVersion, backend: backend.kind }
}

export async function handleSyncPull(req, backend) {
  // Token travels only in the Authorization header (or POST body): URLs end up in logs and history.
  let token = bearerToken(req)
  if (!token && (req.method === 'POST')) {
    const body = await readJson(req).catch(() => ({}))
    token = body.token || token
  }
  if (!token) { const e = Error('Missing sync token.'); e.code = 'bad_token'; e.status = 401; throw e }
  const { row } = await authRow(backend, token)
  return { ok: true, payload: row.payload, storeVersion: row.storeVersion, exportVersion: row.exportVersion, updatedAt: row.updatedAt, backend: backend.kind }
}
