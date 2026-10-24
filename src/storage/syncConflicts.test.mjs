import test from 'node:test'
import assert from 'node:assert/strict'
import { detectChatConflicts, conflictChat } from './syncConflicts.ts'

const chat = (id, msgs) => ({ id, title: id, msgs: msgs.map((m) => ({ id: m, r: 'user', t: m, at: 1 })) })

test('chats that merely differ in length are catching up, not conflicts', () => {
  const local = [chat('a', ['m1', 'm2'])]
  const remote = [chat('a', ['m1', 'm2', 'm3'])]
  assert.equal(detectChatConflicts(local, remote).length, 0)
  assert.equal(detectChatConflicts(remote, local).length, 0)
})

test('both sides adding different messages is recorded with both copies', () => {
  const local = [chat('a', ['m1', 'm2-local'])]
  const remote = [chat('a', ['m1', 'm2-remote'])]
  const [c] = detectChatConflicts(local, remote, 100)
  assert.equal(c.chatId, 'a')
  assert.equal(c.local.msgs, 2)
  assert.equal(c.remote.msgs, 2)
  assert.match(c.local.last, /local/)
  const restored = conflictChat(c, 'remote')
  assert.deepEqual(restored.msgs.map((m) => m.id), ['m1', 'm2-remote'])
})

test('identical and one-sided chats never become conflicts', () => {
  const a = [chat('a', ['m1'])]
  assert.equal(detectChatConflicts(a, a).length, 0)
  assert.equal(detectChatConflicts(a, [chat('b', ['m1'])]).length, 0)
})
