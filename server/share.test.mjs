import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSharedChat, shareIdOf, handleShareCreate, handleShareGet } from './share.mjs'
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
  const got = await handleShareGet(created.id, backend)
  assert.equal(got.title, 'Round trip')
  assert.equal(got.msgs[1].t, 'a')
  await assert.rejects(() => handleShareGet('missing12345', backend), /was not found/)
  await assert.rejects(() => handleShareGet('bad', backend), /not a valid share link/)
})

test('empty chats and oversized bodies are rejected with stable codes', async () => {
  const backend = memStore()
  await assert.rejects(() => handleShareCreate(req({ chat: { msgs: [] } }), backend, () => 'abcDEF123_-x'), (e) => e.code === 'empty' && e.status === 400)
  await assert.rejects(() => handleShareCreate(req('not json'), backend, () => 'abcDEF123_-x'), (e) => e.code === 'bad_json' && e.status === 400)
  const huge = { method: 'POST', headers: { 'content-length': String(9_000_000) }, text: async () => '' }
  await assert.rejects(() => handleShareCreate(huge, backend, () => 'abcDEF123_-x'), (e) => e.code === 'too_large' && e.status === 413)
})
