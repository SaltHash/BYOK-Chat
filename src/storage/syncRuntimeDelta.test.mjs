import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSyncPush, handleSyncPull, parseToken } from '../../server/sync.mjs'
import { memStore } from '../../server/syncStore.mjs'
import { encryptSyncDelta } from './sync.ts'
import { useS } from '../store.ts'
import { getSyncToken, pullAndMerge, pushNow, resetSyncBaseline, setSyncToken } from './syncRuntime.ts'

/* Drive the real runtime against the real sync handlers with fetch routed to
 * an in-memory backend. This covers the wiring the pure delta tests cannot:
 * encryption, sequence baselines, the first full push, and tiny follow-ups. */

const tokenFor = (id) => `byok1-${id}-${'Q'.repeat(43)}`
const TOKEN_A = tokenFor('abcdefghijklmnop')
const TOKEN_B = tokenFor('bcdefghijklmnopq')
const TOKEN_C = tokenFor('cdefghijklmnopqr')
const TOKEN_D = tokenFor('defghijklmnopqrs')

const request = (url, init = {}) => ({
  method: init.method ?? 'GET',
  url: String(url),
  headers: init.headers ?? {},
  text: async () => String(init.body ?? ''),
})

function installFetch(backend) {
  const real = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'https://app.test')
    const req = request(url.toString(), init)
    let body
    let status = 200
    try {
      if (url.pathname === '/api/sync/push') body = await handleSyncPush(req, backend)
      else if (url.pathname === '/api/sync/pull') body = await handleSyncPull(req, backend)
      else throw Object.assign(Error(`unexpected ${url.pathname}`), { status: 500 })
    } catch (error) {
      status = typeof error.status === 'number' ? error.status : 500
      body = { error: error.message, code: error.code, ...(error.seq != null ? { seq: error.seq } : {}) }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return () => { globalThis.fetch = real }
}

const bigHistory = (count = 40) => Array.from({ length: count }, (_, i) => ({
  id: `m${i}`,
  r: 'user',
  t: `message ${i} ${'x'.repeat(900)}`,
  at: i,
}))

test('the first push is complete and follow-up pushes are small deltas', async () => {
  const backend = memStore()
  const restore = installFetch(backend)
  const previousToken = getSyncToken()
  try {
    setSyncToken(TOKEN_A)
    resetSyncBaseline()
    const messages = bigHistory()
    useS.setState({
      chats: [{ id: 'c1', title: 'Big chat', msgs: messages }],
      workspaces: {},
      selectedRevision: {},
      chat: 'c1',
    })

    const first = await pushNow(TOKEN_A)
    assert.equal(first.seq, 1)
    const id = parseToken(TOKEN_A).id
    const seeded = await backend.get(id)
    assert.ok(seeded.payload, 'the first push must store a complete snapshot')
    assert.deepEqual(seeded.deltas, [])

    const next = [...messages, { id: 'new', r: 'user', t: 'one small line', at: 99 }]
    useS.setState({ chats: [{ ...useS.getState().chats[0], msgs: next }] })
    const second = await pushNow(TOKEN_A)
    assert.equal(second.seq, 2)

    const row = await backend.get(id)
    assert.equal(row.deltas.length, 1)
    const fullBytes = JSON.stringify(seeded.payload).length
    const deltaBytes = JSON.stringify(row.deltas[0].delta).length
    assert.ok(deltaBytes < fullBytes / 5, `delta ${deltaBytes} bytes should be far below the ${fullBytes}-byte snapshot`)

    // The same state produces no request-sized work once it is settled.
    const settled = await pushNow(TOKEN_A)
    assert.equal(settled.backend, 'up-to-date')
    assert.equal((await backend.get(id)).deltas.length, 1)
  } finally {
    restore()
    setSyncToken(previousToken)
    resetSyncBaseline()
  }
})

test('a pull asks only for changes after the local sequence and applies them', async () => {
  const backend = memStore()
  const restore = installFetch(backend)
  const previousToken = getSyncToken()
  try {
    setSyncToken(TOKEN_B)
    resetSyncBaseline()
    useS.setState({
      chats: [{ id: 'c1', title: 'Chat', msgs: [{ id: 'm1', r: 'user', t: 'hello', at: 1 }] }],
      workspaces: {},
      selectedRevision: {},
      chat: 'c1',
    })
    const first = await pushNow(TOKEN_B)
    assert.equal(first.seq, 1)

    // Another device appends one message and writes a delta.
    const remote = { v: 1, at: Date.now(), chats: { ops: [{ id: 'c1', add: [{ id: 'remote', r: 'user', t: 'from the other device', at: 2 }] }] } }
    const row = await handleSyncPush(
      request('https://app.test/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: TOKEN_B, delta: await encryptSyncDelta(remote, TOKEN_B), baseSeq: 1 }),
      }),
      backend,
    )
    assert.equal(row.seq, 2)

    const pulled = await pullAndMerge(TOKEN_B)
    assert.equal(pulled.seq, 2)
    const msgs = useS.getState().chats[0].msgs
    assert.deepEqual(msgs.map((m) => m.id), ['m1', 'remote'])
    assert.equal(msgs[1].t, 'from the other device')

    // Applying the remote change advanced the baseline, so pushing again is a
    // no-op rather than echoing the message back.
    const settled = await pushNow(TOKEN_B)
    assert.equal(settled.backend, 'up-to-date')
  } finally {
    restore()
    setSyncToken(previousToken)
    resetSyncBaseline()
  }
})

test('a stale write is rejected, the missing change is pulled, and the write retries', async () => {
  const backend = memStore()
  const restore = installFetch(backend)
  const previousToken = getSyncToken()
  try {
    setSyncToken(TOKEN_C)
    resetSyncBaseline()
    useS.setState({
      chats: [{ id: 'c1', title: 'Chat', msgs: [{ id: 'm1', r: 'user', t: 'hello', at: 1 }] }],
      workspaces: {}, selectedRevision: {}, chat: 'c1',
    })
    assert.equal((await pushNow(TOKEN_C)).seq, 1)

    // This device edits locally, then another device lands a change between
    // this device's pull and its push. The push must lose cleanly, pull the
    // missing message, merge, and retry rather than overwrite the slot.
    useS.setState({ chats: [{ ...useS.getState().chats[0], msgs: [...useS.getState().chats[0].msgs, { id: 'local', r: 'user', t: 'local edit', at: 2 }] }] })
    let injected = false
    const routed = globalThis.fetch
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input), 'https://app.test')
      if (url.pathname === '/api/sync/push' && !injected) {
        const body = JSON.parse(String(init.body ?? '{}'))
        if (body.baseSeq === 1) {
          injected = true
          const remote = { v: 1, at: Date.now(), chats: { ops: [{ id: 'c1', add: [{ id: 'remote', r: 'user', t: 'remote edit', at: 3 }] }] } }
          await handleSyncPush(
            request('https://app.test/api/sync/push', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token: TOKEN_C, delta: await encryptSyncDelta(remote, TOKEN_C), baseSeq: 1 }),
            }),
            backend,
          )
          // Fall through: the original request now carries a stale baseSeq
          // and the real handler answers 409 with the current sequence.
        }
      }
      return routed(input, init)
    }
    const result = await pushNow(TOKEN_C)
    assert.equal(result.seq, 3)
    const ids = useS.getState().chats[0].msgs.map((m) => m.id)
    assert.equal(ids.length, 3)
    assert.equal(new Set(ids).size, 3)
    assert.ok(ids.includes('remote') && ids.includes('local'))
    assert.equal((await backend.get(parseToken(TOKEN_C).id)).deltas.length, 2)
  } finally {
    restore()
    setSyncToken(previousToken)
    resetSyncBaseline()
  }
})

test('a slot cleared by a server restart is re-seeded instead of failing forever', async () => {
  const backend = memStore()
  const restore = installFetch(backend)
  const previousToken = getSyncToken()
  try {
    setSyncToken(TOKEN_D)
    resetSyncBaseline()
    useS.setState({
      chats: [{ id: 'c1', title: 'Chat', msgs: [{ id: 'm1', r: 'user', t: 'hello', at: 1 }] }],
      workspaces: {}, selectedRevision: {}, chat: 'c1',
    })
    assert.equal((await pushNow(TOKEN_D)).seq, 1)
    const id = parseToken(TOKEN_D).id
    await backend.del(id)

    useS.setState({ chats: [{ ...useS.getState().chats[0], msgs: [...useS.getState().chats[0].msgs, { id: 'm2', r: 'user', t: 'after reset', at: 2 }] }] })
    const reseeded = await pushNow(TOKEN_D)
    assert.equal(reseeded.seq, 1)
    const row = await backend.get(id)
    assert.ok(row.payload, 'the re-seeded slot must hold a complete snapshot')
    assert.deepEqual(row.deltas, [])
  } finally {
    restore()
    setSyncToken(previousToken)
    resetSyncBaseline()
  }
})
