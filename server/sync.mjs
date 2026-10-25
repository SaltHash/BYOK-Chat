/* Token sync HTTP logic (pure helpers + handlers). Token format is shared
 * with src/storage/sync.ts: `byok1-<id>-<secret>`. Route dispatch lives in
 * server/api.mjs so both the Node server and the Cloudflare Worker reuse it.
 *
 * Storage contract:
 *   - `payload` is the latest complete encrypted snapshot.
 *   - `baseSeq` is the sequence that snapshot represents.
 *   - `deltas` is the encrypted change log after it, each `{ seq, delta }`.
 * A new device pulls the snapshot plus every pending delta and reconstructs
 * the save locally. An already-linked device pulls only deltas after its
 * `since` sequence, so an idle poll is a few dozen bytes instead of megabytes.
 * Writes are deltas too, guarded by `baseSeq` so two devices cannot silently
 * overwrite each other; the loser gets 409 + the current sequence, pulls the
 * missing deltas, merges and retries. */
import { sha256Hex, safeEqual } from './syncStore.mjs'
import { bearerToken, readBodyText } from './http.mjs'

const TOKEN_RE = /^byok1-([A-Za-z0-9_-]{16})-([A-Za-z0-9_-]{40,50})$/
export const SYNC_MAX_BYTES = 8_000_000
/** A token that has not been used (push or pull) for this long is pruned on
 *  read: Neon is serverless, so there is no background job to do it. */
export const SYNC_ROW_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Keep the encrypted delta log bounded. Once either cap is reached the
 *  pushing client is asked to compact it with one full snapshot, so a new
 *  device never has to replay an unbounded chain. */
export const SYNC_DELTA_MAX = 120
export const SYNC_DELTA_BYTES_MAX = 1_500_000

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

const asSeq = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback)
const deltasOf = (row) => (Array.isArray(row?.deltas) ? row.deltas : [])
const seqOf = (row) => asSeq(row?.seq, 0)
const baseSeqOf = (row) => asSeq(row?.baseSeq, seqOf(row))
const bytesOf = (value) => {
  try { return JSON.stringify(value ?? {}).length } catch { return 0 }
}
const logBytes = (deltas) => deltas.reduce((sum, d) => sum + bytesOf(d), 0)

const conflict = (seq) => {
  const e = Error('Another device changed this sync slot. Pull the missing changes and retry.')
  e.code = 'sync_conflict'
  e.status = 409
  e.seq = seq
  return e
}

async function authRow(backend, token) {
  const { id, secret } = parseToken(token)
  const row = await backend.get(id)
  // A generated token that has never been pushed is an empty slot, not a bad
  // credential: the link flow seeds it from this device instead of failing.
  if (!row) {
    const e = Error('Sync slot is empty. Push from the other device first.')
    e.code = 'empty'
    e.status = 404
    throw e
  }
  if (!safeEqual(sha256Hex(secret), String(row.secretHash))) {
    const e = Error('Unknown or incorrect sync token.')
    e.code = 'bad_token'
    e.status = 401
    throw e
  }
  return { row, id, secret }
}

/* Serialize read-check-write for one slot inside this process. Without it,
 * two pushes can read the same sequence and both write seq+1, silently losing
 * one device's delta. The memory backend is per process and the Node host is a
 * single process, which is the deployment this protects. */
const syncQueues = new Map()
const syncQueueDepth = new Map()
async function withSyncLock(id, fn) {
  const previous = syncQueues.get(id) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  syncQueues.set(id, run.catch(() => {}))
  syncQueueDepth.set(id, (syncQueueDepth.get(id) ?? 0) + 1)
  try {
    return await run
  } finally {
    const left = (syncQueueDepth.get(id) ?? 1) - 1
    if (left <= 0) { syncQueueDepth.delete(id); syncQueues.delete(id) }
    else syncQueueDepth.set(id, left)
  }
}

export async function handleSyncPush(req, backend) {
  const body = await readJson(req)
  const token = body.token || bearerToken(req)
  const { id, secret } = parseToken(token)
  return withSyncLock(id, () => pushLocked(body, id, secret, backend))
}

async function pushLocked(body, id, secret, backend) {
  const secretHash = sha256Hex(secret)
  const existing = await backend.get(id)
  if (existing && !safeEqual(secretHash, String(existing.secretHash))) {
    const e = Error('Unknown or incorrect sync token.')
    e.code = 'bad_token'
    e.status = 401
    throw e
  }

  const currentSeq = seqOf(existing)
  const requestedBase = Number.isInteger(body.baseSeq) && body.baseSeq >= 0 ? body.baseSeq : null
  const storeVersion = Number(body.storeVersion ?? body.payload?.storeVersion ?? 18) || 18
  const exportVersion = Number(body.exportVersion ?? body.payload?.v ?? 4) || 4
  const delta = body.delta

  if (delta != null) {
    if (!existing) throw conflict(0)
    if (requestedBase == null) {
      const e = Error('A delta push must include baseSeq.')
      e.code = 'bad_payload'
      e.status = 400
      throw e
    }
    if (typeof delta !== 'object') {
      const e = Error('Missing delta object.')
      e.code = 'bad_payload'
      e.status = 400
      throw e
    }
    if (requestedBase !== currentSeq) throw conflict(currentSeq)

    const nextSeq = currentSeq + 1
    const deltas = [...deltasOf(existing), { seq: nextSeq, delta }]
    const row = {
      ...existing,
      storeVersion,
      exportVersion,
      seq: nextSeq,
      baseSeq: baseSeqOf(existing),
      deltas,
      updatedAt: Date.now(),
    }
    await backend.put(row)
    return {
      ok: true,
      id,
      updatedAt: row.updatedAt,
      storeVersion,
      exportVersion,
      backend: backend.kind,
      seq: nextSeq,
      compact: deltas.length >= SYNC_DELTA_MAX || logBytes(deltas) >= SYNC_DELTA_BYTES_MAX,
    }
  }

  const payload = body.payload
  if (!payload || typeof payload !== 'object') {
    const e = Error('Missing payload object.')
    e.code = 'bad_payload'
    e.status = 400
    throw e
  }
  // A full push is how a new device seeds a slot and how a client compacts a
  // long delta log. When it carries `baseSeq` it must be current, so a stale
  // full snapshot cannot overwrite newer work. Legacy clients that omit it
  // keep the old overwrite behavior.
  if (existing && requestedBase != null && requestedBase !== currentSeq) throw conflict(currentSeq)

  const nextSeq = currentSeq + 1
  const row = {
    id,
    secretHash,
    payload,
    storeVersion,
    exportVersion,
    seq: nextSeq,
    baseSeq: nextSeq,
    deltas: [],
    updatedAt: Date.now(),
  }
  await backend.put(row)
  return {
    ok: true,
    id,
    updatedAt: row.updatedAt,
    storeVersion,
    exportVersion,
    backend: backend.kind,
    seq: nextSeq,
    compact: false,
  }
}

export async function handleSyncPull(req, backend) {
  const url = new URL(req.url || '/', 'http://localhost')
  let token = bearerToken(req)
  let sinceRaw = url.searchParams.get('since')
  // Token travels only in the Authorization header (or POST body): URLs end up
  // in logs and history. `since` is not a secret, so it may be a query param.
  if ((!token || sinceRaw == null) && req.method === 'POST') {
    const body = await readJson(req).catch(() => ({}))
    token = token || body.token || ''
    if (sinceRaw == null && body.since != null) sinceRaw = body.since
  }
  if (!token) { const e = Error('Missing sync token.'); e.code = 'bad_token'; e.status = 401; throw e }
  const { row, id } = await authRow(backend, token)

  const since = sinceRaw == null || sinceRaw === '' ? null : Number(sinceRaw)
  if (since != null && (!Number.isFinite(since) || since < 0)) {
    const e = Error('since must be a non-negative sequence number.')
    e.code = 'bad_request'
    e.status = 400
    throw e
  }

  const age = Number.isFinite(row.updatedAt) ? Date.now() - row.updatedAt : 0
  // Lazy expiry: prune a row that has been idle past its TTL instead of
  // keeping an abandoned payload (and its plaintext settings) forever.
  if (age > SYNC_ROW_TTL_MS) {
    try { await backend.del(id) } catch { /* best-effort prune */ }
    const e = Error('This sync token expired after 30 days of inactivity. Push from one of your devices to start fresh.')
    e.code = 'expired'
    e.status = 410
    throw e
  }
  // Touch rows that are halfway to expiry, so a device that only ever pulls
  // keeps the token alive while a genuinely abandoned one still expires.
  if (age > SYNC_ROW_TTL_MS / 2) {
    // Keep-alive only: never rewrite the row from this read, or a delta pushed
    // while we were reading it would be erased.
    try { await backend.touch?.(id, Date.now()) } catch { /* the next push will refresh */ }
  }

  const seq = seqOf(row)
  const baseSeq = baseSeqOf(row)
  const deltas = deltasOf(row)
  const common = {
    ok: true,
    seq,
    baseSeq,
    storeVersion: row.storeVersion,
    exportVersion: row.exportVersion,
    updatedAt: row.updatedAt,
    backend: backend.kind,
  }

  // No `since` means a newly linked device (or an explicit full refresh):
  // send the complete snapshot plus everything layered on top of it.
  if (since == null) {
    return { ...common, full: true, payload: row.payload, deltas }
  }
  if (since === seq) {
    // No body at all: this is the common idle poll.
    return { ...common, upToDate: true }
  }
  if (since > seq || since < baseSeq) {
    // The client is ahead (its slot was reset) or behind the compacted base:
    // only a full snapshot can bring it back to a known state.
    return { ...common, full: true, payload: row.payload, deltas }
  }
  return {
    ...common,
    deltas: deltas.filter((entry) => asSeq(entry?.seq) > since),
  }
}
