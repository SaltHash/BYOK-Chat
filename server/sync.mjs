/* Token sync HTTP logic (pure helpers + handlers). Token format is shared
 * with src/storage/sync.ts: `byok1-<id>-<secret>`. */
import { sha256Hex, safeEqual, syncBackend } from './syncStore.mjs'

const TOKEN_RE = /^byok1-([A-Za-z0-9_-]{16})-([A-Za-z0-9_-]{40,50})$/
export const SYNC_MAX_BYTES = 8_000_000

export function parseToken(raw) {
  const m = TOKEN_RE.exec(String(raw || '').trim())
  if (!m) { const e = Error('Invalid sync token.'); e.code = 'bad_token'; e.status = 400; throw e }
  return { id: m[1], secret: m[2] }
}

export function bearerToken(req) {
  const h = String(req.headers.authorization || '')
  const m = /^Bearer (.+)$/.exec(h.trim())
  return m ? m[1] : ''
}

async function readJson(req, max = SYNC_MAX_BYTES) {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > max) { const e = Error('Sync payload is too large (8 MB limit).'); e.code = 'too_large'; e.status = 413; throw e } }
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
  const existing = await backend.get(id)
  if (existing && !safeEqual(sha256Hex(secret), String(existing.secretHash))) {
    const e = Error('Unknown or incorrect sync token.'); e.code = 'bad_token'; e.status = 401; throw e
  }
  const row = { id, secretHash: sha256Hex(secret), payload, storeVersion, exportVersion, updatedAt: Date.now() }
  await backend.put(row)
  return { ok: true, id, updatedAt: row.updatedAt, storeVersion, exportVersion, backend: backend.kind }
}

export async function handleSyncPull(req, backend) {
  const url = new URL(req.url || '/', 'http://localhost')
  const fromQuery = url.searchParams.get('token')
  let token = fromQuery || bearerToken(req)
  if (!token && (req.method === 'POST')) {
    const body = await readJson(req).catch(() => ({}))
    token = body.token || token
  }
  if (!token) { const e = Error('Missing sync token.'); e.code = 'bad_token'; e.status = 401; throw e }
  const { row } = await authRow(backend, token)
  return { ok: true, payload: row.payload, storeVersion: row.storeVersion, exportVersion: row.exportVersion, updatedAt: row.updatedAt, backend: backend.kind }
}

export async function routeSync(req, res, send) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/sync/')) return false
  const backend = await syncBackend()
  try {
    if (url.pathname === '/api/sync/push' && req.method === 'POST') return void send(res, 200, await handleSyncPush(req, backend))
    if (url.pathname === '/api/sync/pull' && (req.method === 'GET' || req.method === 'POST')) return void send(res, 200, await handleSyncPull(req, backend))
    if (url.pathname === '/api/sync/status' && req.method === 'GET') {
      return void send(res, 200, { ok: true, backend: backend.kind, configured: Boolean(process.env.DATABASE_URL) })
    }
    return void send(res, 404, { error: 'Unknown sync route.' })
  } catch (e) {
    return void send(res, e.status ?? 400, { error: e.message || 'Sync failed.', code: e.code || 'sync_error' })
  }
}
