import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptChatPush, chatChangesToDelta } from './chatSync.ts'

const TOKEN = 'byok1-abcdefghijklmnop-' + 'Q'.repeat(43)
const OTHER = 'byok1-zyxwvutsrqponmlk-' + 'R'.repeat(43)

const chatDelta = {
  ops: [{
    id: 'c1',
    meta: { id: 'c1', title: 'A very secret title' },
    order: ['m1', 'm2'],
    add: [{ id: 'm1', r: 'user', t: 'secret question', at: 1 }, { id: 'm2', r: 'assistant', t: 'secret answer', at: 2 }],
  }],
  del: ['c2'],
}

test('a chat push encrypts every body but keeps the row ids addressable', async () => {
  const push = await encryptChatPush(chatDelta, TOKEN)
  const op = push.ops[0]
  assert.equal(op.id, 'c1')
  assert.equal(op.add[0].id, 'm1')
  assert.equal(typeof op.add[0].body.encrypted, 'string')
  assert.deepEqual(op.order, ['m1', 'm2'])
  assert.deepEqual(push.del, ['c2'])
  const wire = JSON.stringify(push)
  for (const secret of ['secret question', 'secret answer', 'A very secret title']) {
    assert.equal(wire.includes(secret), false, `${secret} must not reach the server in clear text`)
  }
})

test('server rows round-trip back into the delta the merge engine expects', async () => {
  const push = await encryptChatPush(chatDelta, TOKEN)
  const op = push.ops[0]
  const chatRows = [
    { chatId: 'c1', meta: op.meta, order: op.order, seq: 4, at: 10 },
    { chatId: 'c2', deleted: true, seq: 4, at: 10 },
  ]
  const messageRows = op.add.map((message, index) => ({ chatId: 'c1', id: message.id, body: message.body, ord: index, seq: 4, at: 10 }))
  const back = await chatChangesToDelta(chatRows, messageRows, TOKEN)
  assert.deepEqual(back.chats.ops[0].meta, { id: 'c1', title: 'A very secret title' })
  assert.deepEqual(back.chats.ops[0].add.map((m) => m.t), ['secret question', 'secret answer'])
  assert.deepEqual(back.chats.ops[0].order, ['m1', 'm2'])
  assert.deepEqual(back.chats.del, ['c2'])
  assert.equal(back.at, 10)
})

test('a message sealed for one slot cannot be opened by another', async () => {
  const push = await encryptChatPush(chatDelta, TOKEN)
  const op = push.ops[0]
  const rows = [{ chatId: 'c1', id: 'm1', body: op.add[0].body, ord: 0, seq: 1, at: 1 }]
  const back = await chatChangesToDelta(undefined, rows, OTHER)
  assert.equal(back, null, 'undecryptable rows are dropped rather than applied')
})

test('a message edit carries no chat metadata or id order', async () => {
  const push = await encryptChatPush({ ops: [{ id: 'c1', update: [{ id: 'm1', r: 'user', t: 'edited' }] }] }, TOKEN)
  const op = push.ops[0]
  assert.equal(op.meta, undefined)
  assert.equal(op.order, undefined)
  assert.equal(op.update[0].id, 'm1')
})
