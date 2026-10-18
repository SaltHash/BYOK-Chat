import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSyncPush, handleSyncPull, parseToken } from './sync.mjs'
import { memStore, sha256Hex, syncBackend, redact } from './syncStore.mjs'

const req = (body, query = '') => {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return { method: 'POST', url: `/api/sync/push${query}`, headers: {}, [Symbol.asyncIterator]: async function* () { yield text } }
}
const getReq = (token) => ({ method: 'GET', url: '/api/sync/pull', headers: { authorization: `Bearer ${token}` } })

test('token parsing accepts generated shape and rejects junk', () => {
  assert.throws(() => parseToken('nope'), /Invalid sync token/)
  assert.throws(() => parseToken('byok1-short-x'), /Invalid sync token/)
})

test('push then pull round-trips with auth, wrong secret rejected', async () => {
  const backend = memStore()
  const id = 'abcdefghijklmnop'.slice(0, 16)
  const secret = 's'.repeat(43)
  const token = `byok1-${id}-${secret}`
  const payload = { v: 4, storeVersion: 18, settings: { themeMode: 'dark' }, chats: [], workspaces: {}, selectedRevision: {} }
  const pushed = await handleSyncPush(req({ token, payload }), backend)
  assert.equal(pushed.ok, true)
  const stored = await backend.get(id)
  assert.equal(stored.secretHash, sha256Hex(secret))
  assert.notEqual(stored.secretHash, secret)
  const pulled = await handleSyncPull(getReq(token), backend)
  assert.deepEqual(pulled.payload.settings, { themeMode: 'dark' })
  await assert.rejects(() => handleSyncPull(getReq(`byok1-${id}-${'x'.repeat(43)}`), backend), /Unknown or incorrect/)
  await assert.rejects(() => handleSyncPull({ method: 'GET', url: `/api/sync/pull?token=${encodeURIComponent(token)}`, headers: {} }, backend), /Missing sync token/)
})

test('payload size limit enforced', async () => {
  const backend = memStore()
  const big = 'y'.repeat(9_000_000)
  await assert.rejects(() => handleSyncPush(req({ token: `byok1-${'a'.repeat(16)}-${'b'.repeat(43)}`, payload: { big } }), backend), /too large/)
})

test('idle sync rows are pruned lazily on pull and can be revived by a push', async () => {
  const backend = memStore()
  const id = 'e'.repeat(16)
  const secret = 's'.repeat(43)
  const token = `byok1-${id}-${secret}`
  await backend.put({ id, secretHash: sha256Hex(secret), payload: { v: 4 }, storeVersion: 18, exportVersion: 4, updatedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 })
  await assert.rejects(() => handleSyncPull(getReq(token), backend), /expired/)
  assert.equal(await backend.get(id), null, 'the expired row must be pruned on read')
  await handleSyncPush(req({ token, payload: { v: 4, storeVersion: 18 } }), backend)
  const pulled = await handleSyncPull(getReq(token), backend)
  assert.equal(pulled.ok, true)
})

test('rows approaching the TTL are touched so pull-only devices do not expire', async () => {
  const backend = memStore()
  const id = 'f'.repeat(16)
  const secret = 's'.repeat(43)
  const token = `byok1-${id}-${secret}`
  const old = Date.now() - 20 * 24 * 60 * 60 * 1000
  await backend.put({ id, secretHash: sha256Hex(secret), payload: { v: 4 }, storeVersion: 18, exportVersion: 4, updatedAt: old })
  const pulled = await handleSyncPull(getReq(token), backend)
  assert.equal(pulled.ok, true)
  assert.ok((await backend.get(id)).updatedAt > old, 'a long-idle row is refreshed on pull')
})

test('the in-memory backend stays bounded under anonymous pushes', async () => {
  const backend = memStore()
  const idFor = (i) => `id${String(i).padStart(14, '0')}`
  for (let i = 0; i < 260; i++) {
    await backend.put({ id: idFor(i), secretHash: 'h', payload: {}, storeVersion: 18, exportVersion: 4, updatedAt: i })
  }
  assert.equal(await backend.get(idFor(0)), null)
  assert.ok(await backend.get(idFor(259)))
  let count = 0
  for (let i = 0; i < 260; i++) if (await backend.get(idFor(i))) count++
  assert.equal(count, 200, 'the in-memory backend must hold a bounded number of rows')
})

test('the in-memory backend also bounds the total payload bytes it keeps', async () => {
  const backend = memStore()
  // 12 rows of ~8 MB each exceed the 64 MB budget: the oldest are evicted even
  // though the row cap has not been reached.
  for (let i = 0; i < 12; i++) {
    await backend.put({ id: `big${String(i).padStart(13, '0')}`, secretHash: 'h', payload: { blob: 'x'.repeat(8_000_000) }, storeVersion: 18, exportVersion: 4, updatedAt: i })
  }
  assert.equal(await backend.get('big0000000000000'), null)
  assert.ok(await backend.get('big0000000000011'))
})

test('syncBackend uses memory without DATABASE_URL and surfaces query failures', async () => {
  assert.equal((await syncBackend({})).kind, 'memory')
  // A configured database is never silently replaced by the in-memory store:
  // failures reaching the store's own methods must propagate to the caller.
  const backend = await syncBackend({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/db' })
  assert.equal(backend.kind, 'neon')
  await assert.rejects(() => backend.get('anything'))
})

test('connection strings are redacted before they can reach logs', () => {
  assert.equal(redact('connection string: postgres://user:hunter2@db.example/neondb'), 'connection string: postgres://***')
  assert.equal(redact('Failed to parse URL from https://api.0.0.1/sql'), 'Failed to parse URL from https://***')
  assert.equal(redact('plain message'), 'plain message')
  assert.ok(!redact('x'.repeat(2000)).includes('x'.repeat(400)))
})
