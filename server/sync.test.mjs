import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSyncPush, handleSyncPull, parseToken } from './sync.mjs'
import { memStore, sha256Hex, syncBackend, redact, neonSyncEnabled } from './syncStore.mjs'

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

test('DATABASE_URL turns Neon on unless SYNC_BACKEND says otherwise', async () => {
  // Local dev and self-hosted Node only have a connection string, so it is the
  // switch. An explicit mode still wins.
  assert.equal(neonSyncEnabled({}), false)
  assert.equal(neonSyncEnabled({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/db' }), true)
  assert.equal((await syncBackend({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/db' })).kind, 'neon')
  assert.equal(neonSyncEnabled({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/db', SYNC_BACKEND: 'memory' }), false)
  assert.equal((await syncBackend({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/db', SYNC_BACKEND: 'memory' })).kind, 'memory')
  assert.equal(neonSyncEnabled({ SYNC_BACKEND: 'neon' }), true)
  assert.equal(neonSyncEnabled({ SYNC_BACKEND: 'NEON' }), true)
  // "neon" without a URL cannot reach a database, so it stays in memory.
  assert.equal((await syncBackend({ SYNC_BACKEND: 'neon' })).kind, 'memory')
})

test('connection strings are redacted before they can reach logs', () => {
  assert.equal(redact('connection string: postgres://user:hunter2@db.example/neondb'), 'connection string: postgres://***')
  assert.equal(redact('Failed to parse URL from https://api.0.0.1/sql'), 'Failed to parse URL from https://***')
  assert.equal(redact('plain message'), 'plain message')
  assert.ok(!redact('x'.repeat(2000)).includes('x'.repeat(400)))
})

/* ---- incremental sync ---- */

const pullReq = (token, since) => ({
  method: 'GET',
  url: `/api/sync/pull${since == null ? '' : `?since=${since}`}`,
  headers: { authorization: `Bearer ${token}` },
})

const tokenFor = (id, secret = 's'.repeat(43)) => `byok1-${id}-${secret}`

async function seed(backend, token, payload = { v: 4, storeVersion: 18, settings: { themeMode: 'dark' }, chats: [], workspaces: {}, selectedRevision: {} }) {
  const { id, secret } = parseToken(token)
  assert.ok(secret)
  return handleSyncPush(req({ token, payload }), backend)
}

test('a delta write appends a change and an up-to-date pull returns no payload', async () => {
  const backend = memStore()
  const token = tokenFor('d'.repeat(16))
  const full = await seed(backend, token)
  assert.equal(full.seq, 1)

  const first = await handleSyncPull(pullReq(token), backend)
  assert.equal(first.full, true)
  assert.equal(first.seq, 1)
  assert.deepEqual(first.payload.settings, { themeMode: 'dark' })

  // The common idle poll after that pull must carry no save data at all.
  const idle = await handleSyncPull(pullReq(token, 1), backend)
  assert.equal(idle.upToDate, true)
  assert.equal(idle.payload, undefined)
  assert.equal(idle.deltas, undefined)

  const delta = { v: 1, at: Date.now(), settings: { set: { themeMode: 'light' } } }
  const pushed = await handleSyncPush(req({ token, delta, baseSeq: 1 }), backend)
  assert.equal(pushed.seq, 2)

  const since = await handleSyncPull(pullReq(token, 1), backend)
  assert.equal(since.seq, 2)
  assert.equal(since.full, undefined)
  assert.equal(since.payload, undefined)
  assert.deepEqual(since.deltas, [{ seq: 2, delta }])

  const stale = { v: 1, at: Date.now(), settings: { set: { themeMode: 'sepia' } } }
  await assert.rejects(() => handleSyncPush(req({ token, delta: stale, baseSeq: 1 }), backend), (e) => {
    assert.equal(e.status, 409)
    assert.equal(e.code, 'sync_conflict')
    assert.equal(e.seq, 2)
    return true
  })

  // A device that is behind the compacted base gets the snapshot plus the
  // deltas layered on it, so every part of the save can be reconstructed.
  const rebuild = await handleSyncPull(pullReq(token, 0), backend)
  assert.equal(rebuild.full, true)
  assert.equal(rebuild.seq, 2)
  assert.equal(rebuild.baseSeq, 1)
  assert.deepEqual(rebuild.payload.settings, { themeMode: 'dark' })
  assert.deepEqual(rebuild.deltas, [{ seq: 2, delta }])
})

test('simultaneous delta pushes are serialized so one cannot overwrite the other', async () => {
  const backend = memStore()
  const token = tokenFor('j'.repeat(16))
  await seed(backend, token)
  // Both devices read sequence 1 and race to claim 2. Serializing the write
  // makes the loser a conflict (it then pulls and retries) instead of letting
  // the second write silently replace the first one's change.
  const settle = (p) => p.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
  const results = await Promise.all([
    settle(handleSyncPush(req({ token, delta: { v: 1, at: 1, settings: { set: { a: 1 } } }, baseSeq: 1 }), backend)),
    settle(handleSyncPush(req({ token, delta: { v: 1, at: 2, settings: { set: { b: 2 } } }, baseSeq: 1 }), backend)),
  ])
  assert.equal(results.filter((r) => r.ok).length, 1, 'exactly one push may claim a sequence')
  const loser = results.find((r) => !r.ok)
  assert.equal(loser.error.status, 409)
  assert.equal(loser.error.seq, 2)
  const pulled = await handleSyncPull(pullReq(token, 1), backend)
  assert.equal(pulled.seq, 2)
  assert.equal(pulled.deltas.length, 1, 'the log must hold one change per sequence')
})

test('a full push compacts the log and resets the base sequence', async () => {
  const backend = memStore()
  const token = tokenFor('e'.repeat(16))
  await seed(backend, token)
  await handleSyncPush(req({ token, delta: { v: 1, at: 1, settings: { set: { a: 1 } } }, baseSeq: 1 }), backend)

  const full = await handleSyncPush(req({
    token,
    payload: { v: 4, storeVersion: 18, settings: { themeMode: 'light' }, chats: [], workspaces: {}, selectedRevision: {} },
    baseSeq: 2,
  }), backend)
  assert.equal(full.seq, 3)

  const pulled = await handleSyncPull(pullReq(token), backend)
  assert.equal(pulled.full, true)
  assert.equal(pulled.baseSeq, 3)
  assert.deepEqual(pulled.deltas, [])
  assert.deepEqual(pulled.payload.settings, { themeMode: 'light' })

  // The old sequence is behind the new base: a full snapshot is required.
  const old = await handleSyncPull(pullReq(token, 2), backend)
  assert.equal(old.full, true)
  assert.equal(old.payload.settings.themeMode, 'light')
})

test('a delta push requires a base sequence and a non-empty slot', async () => {
  const backend = memStore()
  const emptyToken = tokenFor('f'.repeat(16))
  await assert.rejects(() => handleSyncPull(pullReq(emptyToken), backend), (e) => {
    assert.equal(e.status, 404)
    assert.equal(e.code, 'empty')
    return true
  })

  const token = tokenFor('g'.repeat(16))
  await seed(backend, token)
  await assert.rejects(() => handleSyncPush(req({ token, delta: { v: 1, at: 1 } }), backend), (e) => {
    assert.equal(e.status, 400)
    assert.equal(e.code, 'bad_payload')
    return true
  })
})

test('a legacy full push without baseSeq still replaces the slot', async () => {
  const backend = memStore()
  const token = tokenFor('h'.repeat(16))
  await seed(backend, token)
  const replaced = await handleSyncPush(req({
    token,
    payload: { v: 4, storeVersion: 18, settings: { themeMode: 'sepia' }, chats: [], workspaces: {}, selectedRevision: {} },
  }), backend)
  assert.equal(replaced.seq, 2)
  const pulled = await handleSyncPull(pullReq(token), backend)
  assert.equal(pulled.payload.settings.themeMode, 'sepia')
})

test('the server asks the client to compact before the delta log grows unbounded', async () => {
  const backend = memStore()
  const token = tokenFor('i'.repeat(16))
  await seed(backend, token)
  let seq = 1
  let compact = false
  for (let i = 0; i < 120; i++) {
    const result = await handleSyncPush(req({ token, delta: { v: 1, at: i, settings: { set: { n: i } } }, baseSeq: seq }), backend)
    seq = result.seq
    compact = result.compact
  }
  assert.equal(compact, true)
  const pulled = await handleSyncPull(pullReq(token, 1), backend)
  assert.equal(pulled.deltas.length, 120)
})
