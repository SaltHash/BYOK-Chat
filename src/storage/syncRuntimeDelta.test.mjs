import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSyncPush, handleSyncPull, parseToken } from '../../server/sync.mjs'
import { memStore, sha256Hex } from '../../server/syncStore.mjs'
import { encryptSyncDelta, encryptSyncPayload } from './sync.ts'
import { encryptChatPush } from './chatSync.ts'
import { normSearch, searchKeyOf, useS } from '../store.ts'
import { getSyncToken, pullAndMerge, pushNow, resetSyncBaseline, setSyncChats, setSyncToken, shapePulledSnapshot } from './syncRuntime.ts'

/* Drive the real runtime against the real sync handlers with fetch routed to
 * an in-memory backend. This covers the wiring the pure delta tests cannot:
 * encryption, sequence baselines, the first full push, and tiny follow-ups. */

const tokenFor = (id) => `byok1-${id}-${'Q'.repeat(43)}`
const TOKEN_A = tokenFor('abcdefghijklmnop')
const TOKEN_B = tokenFor('bcdefghijklmnopq')
const TOKEN_C = tokenFor('cdefghijklmnopqr')
const TOKEN_D = tokenFor('defghijklmnopqrs')
const TOKEN_E = tokenFor('efghijklmnopqrst')

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
    setSyncChats(true)
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
    // The new message is one row; the settings log stays empty.
    assert.equal(row.deltas.length, 0)
    const changed = [...row.messages.values()].filter((m) => m.seq === 2)
    assert.deepEqual(changed.map((m) => m.id), ['new'])
    const fullBytes = JSON.stringify([...row.messages.values()]).length
    const deltaBytes = JSON.stringify(changed).length
    assert.ok(deltaBytes < fullBytes / 5, `one message ${deltaBytes} bytes should be far below the ${fullBytes}-byte history`)

    // The same state produces no request-sized work once it is settled.
    const settled = await pushNow(TOKEN_A)
    assert.equal(settled.backend, 'up-to-date')
    assert.equal([...row.messages.values()].length, next.length)
  } finally {
    restore()
    setSyncChats(false)
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
    setSyncChats(true)
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
    setSyncChats(false)
    setSyncToken(previousToken)
    resetSyncBaseline()
  }
})

test('a pulled change leaves the open chat and the search credentials alone', async () => {
  const backend = memStore()
  const restore = installFetch(backend)
  const previousToken = getSyncToken()
  try {
    setSyncToken(TOKEN_E)
    setSyncChats(false)
    resetSyncBaseline()
    useS.setState({
      chats: [
        { id: 'c1', title: 'older', msgs: [{ id: 'm1', r: 'user', t: 'hi', at: 1 }] },
        { id: 'c2', title: 'recent', msgs: [{ id: 'm2', r: 'user', t: 'yo', at: 5 }] },
      ],
      workspaces: {}, selectedRevision: {}, chat: 'c1',
      search: normSearch({ provider: 'exa', keys: { exa: 'sk-local' } }),
    })
    assert.equal((await pushNow(TOKEN_E)).seq, 1)

    // Another device writes its open chat and its credential-blanked search.
    const remote = { v: 1, at: Date.now(), settings: { set: { chat: 'c2', search: normSearch({}) } } }
    await handleSyncPush(
      request('https://app.test/api/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: TOKEN_E, delta: await encryptSyncDelta(remote, TOKEN_E), baseSeq: 1 }),
      }),
      backend,
    )

    // This device starts a new chat while the pull is in flight.
    useS.setState({ chat: '' })
    assert.equal((await pullAndMerge(TOKEN_E)).seq, 2)
    const after = useS.getState()
    assert.equal(after.chat, '', 'the new chat must stay open')
    assert.equal(searchKeyOf(after.search), 'sk-local', 'web search must keep using this device\'s key')
    assert.equal(after.search.keys.exa, 'sk-local')
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
    setSyncChats(true)
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
          const remote = { ops: [{ id: 'c1', order: ['m1', 'remote'], add: [{ id: 'remote', r: 'user', t: 'remote edit', at: 3 }] }] }
          await handleSyncPush(
            request('https://app.test/api/sync/push', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token: TOKEN_C, chats: await encryptChatPush(remote, TOKEN_C), baseSeq: 1, chatStore: true, at: 3 }),
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
    const stored = await backend.get(parseToken(TOKEN_C).id)
    // Every message is its own row, and the local edit is the newest one.
    assert.equal([...stored.messages.values()].filter((m) => !m.deleted).length, 3)
    assert.ok([...stored.messages.values()].some((m) => m.id === 'local' && m.seq === 3))
  } finally {
    restore()
    setSyncChats(false)
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
    setSyncChats(true)
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
    setSyncChats(false)
    setSyncToken(previousToken)
    resetSyncBaseline()
  }
})

test('a legacy snapshot is shaped like an upload before it is merged', async () => {
  const backend = memStore()
  const restore = installFetch(backend)
  const previousToken = getSyncToken()
  try {
    setSyncToken(TOKEN_E)
    setSyncChats(false)
    resetSyncBaseline()
    const { id, secret } = parseToken(TOKEN_E)
    // A slot written before the storage split still holds the old envelope,
    // whole conversation and attachment bytes included.
    const legacy = {
      v: 4,
      storeVersion: 18,
      settings: { themeMode: 'dark' },
      chats: [{ id: 'old', title: 'Legacy', msgs: [{ id: 'm1', r: 'user', t: 'old text', at: 1, att: [{ name: 'a.png', kind: 'img', data: 'BYTES' }] }] }],
      workspaces: {},
      selectedRevision: {},
    }
    await backend.putFull({
      id, secretHash: sha256Hex(secret), payload: await encryptSyncPayload(legacy, TOKEN_E),
      storeVersion: 18, exportVersion: 4, seq: 1, baseSeq: 1, keepChats: true, chatStore: false,
    })
    useS.setState({ chats: [], workspaces: {}, selectedRevision: {}, chat: '' })

    const pulled = await pullAndMerge(TOKEN_E)
    assert.equal(pulled.data.settings.themeMode, 'dark')
    // The server cannot inspect the envelope, so the client applies the policy
    // after decrypting it: no conversation arrives from a slot that never
    // opted into storing one.
    assert.deepEqual(pulled.data.chats, [])
    assert.deepEqual(useS.getState().chats, [])

    // With the opt-in on the transcript may arrive, but never the file bytes or
    // the tool payloads.
    setSyncChats(true)
    const shaped = shapePulledSnapshot({
      settings: {},
      chats: [{ id: 'old', msgs: [{ id: 'm1', t: 'text', att: [{ name: 'a.png', kind: 'img', data: 'BYTES' }], toolRounds: [{ calls: [{ name: 'search', result: 'OUT' }] }] }] }],
      workspaces: {},
      selectedRevision: {},
    })
    assert.equal(shaped.chats[0].msgs[0].t, 'text')
    assert.equal(shaped.chats[0].msgs[0].att[0].data, undefined)
    assert.equal(shaped.chats[0].msgs[0].toolRounds[0].calls[0].result, undefined)
  } finally {
    restore()
    setSyncChats(false)
    setSyncToken(previousToken)
    resetSyncBaseline()
  }
})
