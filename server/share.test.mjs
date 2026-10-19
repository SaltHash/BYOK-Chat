import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSharedChat, shareIdOf, handleShareCreate, handleShareGet, handleShareUpdate } from './share.mjs'
import { memStore } from './shareStore.mjs'

const req = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

test('a snapshot keeps only title, text, and byline', () => {
  const snap = sanitizeSharedChat({
    title: '  My   chat ',
    msgs: [
      { r: 'user', t: 'hello', att: [{ name: 'secret.png' }], ctx: ['x'] },
      { r: 'assistant', t: 'hi there', by: 'OpenAI · gpt-4o', toolRounds: [{ calls: [{ result: 'TOKEN' }] }], reasoning: 'hidden', sys: 'system prompt' },
      { r: 'assistant', t: '   ' },
      { r: 'system', t: 'never shared' },
      { r: 'assistant', t: 42 },
    ],
  })
  assert.equal(snap.title, 'My chat')
  assert.equal(snap.v, 1)
  assert.deepEqual(snap.msgs.map((m) => m.r), ['user', 'assistant'])
  assert.equal(snap.msgs[1].by, 'OpenAI · gpt-4o')
  const json = JSON.stringify(snap)
  assert.ok(!json.includes('secret.png'))
  assert.ok(!json.includes('hidden'))
  assert.ok(!json.includes('system prompt'))
  assert.ok(!json.includes('TOKEN'))
})

test('an empty or unusable chat has nothing to share', () => {
  assert.equal(sanitizeSharedChat(null), null)
  assert.equal(sanitizeSharedChat({ msgs: [] }), null)
  assert.equal(sanitizeSharedChat({ msgs: [{ r: 'user', t: '  ' }] }), null)
  assert.equal(sanitizeSharedChat({ title: 'x', msgs: 'nope' }), null)
})

test('share ids are validated before touching storage', () => {
  assert.equal(shareIdOf('abcDEF123_-x'), 'abcDEF123_-x')
  assert.equal(shareIdOf('short'), '')
  assert.equal(shareIdOf('bad id'), '')
  assert.equal(shareIdOf('a'.repeat(65)), '')
})

test('create then get round-trips through the in-memory backend', async () => {
  const backend = memStore()
  const created = await handleShareCreate(req({ chat: { title: 'Round trip', msgs: [{ r: 'user', t: 'q' }, { r: 'assistant', t: 'a', by: 'model' }] } }), backend, () => 'abcDEF123_-x')
  assert.equal(created.ok, true)
  assert.equal(created.messages, 2)
  assert.equal(created.url, '/api/share/abcDEF123_-x')
  assert.equal(typeof created.token, 'string')
  assert.ok(created.token.length >= 20)
  const got = await handleShareGet(created.id, backend)
  assert.equal(got.title, 'Round trip')
  assert.equal(got.msgs[1].t, 'a')
  await assert.rejects(() => handleShareGet('missing12345', backend), /was not found/)
  await assert.rejects(() => handleShareGet('bad', backend), /not a valid share link/)
})

test('a private share refuses reads without the owner token', async () => {
  const backend = memStore()
  const created = await handleShareCreate(req({ chat: { msgs: [{ r: 'user', t: 'secret' }] }, private: true }), backend, () => 'abcDEF123_-x')
  assert.equal(created.private, true)
  await assert.rejects(() => handleShareGet(created.id, backend), (e) => e.code === 'private' && e.status === 403)
  await assert.rejects(() => handleShareGet(created.id, backend, 'wrong-token'), (e) => e.code === 'private')
  const got = await handleShareGet(created.id, backend, created.token)
  assert.equal(got.msgs[0].t, 'secret')
  assert.equal(got.private, true)
  // The owner token hash itself is never echoed back to a reader.
  assert.equal('token' in got, false)
  assert.equal('tokenHash' in got, false)
})

test('updates require the owner token and can flip privacy and content', async () => {
  const backend = memStore()
  const created = await handleShareCreate(req({ chat: { title: 'v1', msgs: [{ r: 'user', t: 'one' }] } }), backend, () => 'abcDEF123_-x')
  // No token: refused.
  await assert.rejects(
    () => handleShareUpdate(created.id, req({ chat: { msgs: [{ r: 'user', t: 'two' }] } }), backend),
    (e) => e.code === 'forbidden' && e.status === 403,
  )
  // Correct token: content and privacy are both replaced.
  const updated = await handleShareUpdate(created.id, req({ token: created.token, chat: { title: 'v2', msgs: [{ r: 'user', t: 'two' }] }, private: true }), backend)
  assert.equal(updated.private, true)
  assert.equal(updated.messages, 1)
  await assert.rejects(() => handleShareGet(created.id, backend), (e) => e.code === 'private')
  const got = await handleShareGet(created.id, backend, created.token)
  assert.equal(got.title, 'v2')
  assert.equal(got.msgs[0].t, 'two')
  // An update that omits chat keeps the current snapshot.
  await handleShareUpdate(created.id, req({ token: created.token, private: false }), backend)
  const publicAgain = await handleShareGet(created.id, backend)
  assert.equal(publicAgain.title, 'v2')
  assert.equal(publicAgain.private, false)
})

test('empty chats and oversized bodies are rejected with stable codes', async () => {
  const backend = memStore()
  await assert.rejects(() => handleShareCreate(req({ chat: { msgs: [] } }), backend, () => 'abcDEF123_-x'), (e) => e.code === 'empty' && e.status === 400)
  await assert.rejects(() => handleShareCreate(req('not json'), backend, () => 'abcDEF123_-x'), (e) => e.code === 'bad_json' && e.status === 400)
  const huge = { method: 'POST', headers: { 'content-length': String(9_000_000) }, text: async () => '' }
  await assert.rejects(() => handleShareCreate(huge, backend, () => 'abcDEF123_-x'), (e) => e.code === 'too_large' && e.status === 413)
})
