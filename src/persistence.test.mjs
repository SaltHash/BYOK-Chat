import test from 'node:test'
import assert from 'node:assert/strict'

const { pruneChatForPersist, createPersistMapper } = await import('./persistence.ts')

test('pruneChatForPersist drops empty assistant placeholders and keeps real messages', () => {
  const chat = {
    id: 'c1',
    msgs: [
      { id: 'u1', r: 'user', t: 'hello' },
      { id: 'a1', r: 'assistant', t: '' },
      { id: 'a2', r: 'assistant', t: '', err: true },
      { id: 'a3', r: 'assistant', t: '', research: { id: 'r' } },
      { id: 'a4', r: 'assistant', t: 'answer' },
    ],
  }
  const out = pruneChatForPersist(chat)
  assert.deepEqual(out.msgs.map((m) => m.id), ['u1', 'a2', 'a3', 'a4'])
})

test('pruneChatForPersist strips attachment bytes but keeps metadata', () => {
  const chat = {
    id: 'c1',
    msgs: [{ id: 'u1', r: 'user', t: 'see file', att: [{ name: 'a.pdf', kind: 'pdf', size: '2 KB', mime: 'application/pdf', source: 'upload', pages: 3, data: 'BASE64BYTES', text: 'extracted' }] }],
  }
  const [m] = pruneChatForPersist(chat).msgs
  assert.deepEqual(m.att, [{ name: 'a.pdf', kind: 'pdf', size: '2 KB', mime: 'application/pdf', source: 'upload', pages: 3 }])
  assert.equal('data' in m.att[0], false)
  assert.equal('text' in m.att[0], false)
})

test('persist mapper reuses the mapped copy for unchanged chats', () => {
  const map = createPersistMapper()
  const a = { id: 'a', msgs: [{ id: 'm', r: 'user', t: 'x' }] }
  const b = { id: 'b', msgs: [{ id: 'm', r: 'user', t: 'y' }] }
  const first = map([a, b])
  // A store write replaces only the chat that changed.
  const a2 = { ...a, msgs: [...a.msgs, { id: 'm2', r: 'assistant', t: 'z' }] }
  const second = map([a2, b])
  assert.equal(second[1], first[1], 'unchanged chat keeps its mapped copy')
  assert.notEqual(second[0], first[0], 'changed chat is re-mapped')
  assert.equal(second[0].msgs.length, 2)
})

test('persist mapper output is stable state, not mutated by later writes', () => {
  const map = createPersistMapper()
  const a = { id: 'a', msgs: [{ id: 'm', r: 'user', t: 'x' }] }
  const out = map([a])
  const a2 = { ...a, msgs: [] }
  map([a2])
  assert.equal(out[0].msgs.length, 1)
})
