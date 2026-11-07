import test from 'node:test'
import assert from 'node:assert/strict'
import { continuationHeads, continuations, forkAt, siblingCount, siblingIndex, switchTo } from './conversationTree.ts'

const u = (id, t) => ({ id, r: 'user', t })
const a = (id, t) => ({ id, r: 'assistant', t })

test('a linear chat has one sibling and no fork', () => {
  const chat = { msgs: [u('u1', 'hi'), a('a1', 'hello')] }
  assert.equal(siblingCount(chat, 0), 1)
  assert.equal(siblingIndex(chat, 0), 0)
  assert.deepEqual(continuations(chat, 0), [chat.msgs.slice(1)])
})

test('branching keeps the old continuation instead of copying the chat', () => {
  const chat = { msgs: [u('u1', 'hi'), a('a1', 'hello'), u('u2', 'more')] }
  const forked = forkAt(chat, 0, [])
  assert.equal(forked.msgs.length, 1, 'the visible path stops at the fork')
  assert.equal(forked.msgs[0].fork.paths.length, 1)
  assert.equal(siblingCount(forked, 0), 2)
  assert.equal(siblingIndex(forked, 0), 0, 'the new empty path takes the current slot')
  assert.deepEqual(continuations(forked, 0)[1].map((m) => m.id), ['a1', 'u2'])
})

test('switching restores the other path and captures what was written since', () => {
  const forked = forkAt({ msgs: [u('u1', 'hi'), a('a1', 'hello')] }, 0, [])
  // Continue on the new path.
  const grown = { ...forked, msgs: [...forked.msgs, a('a2', 'a fresh answer')] }
  const back = switchTo(grown, 0, 1)
  assert.deepEqual(back.msgs.map((m) => m.id), ['u1', 'a1'])
  assert.equal(siblingIndex(back, 0), 1)
  const forward = switchTo(back, 0, 0)
  assert.deepEqual(forward.msgs.map((m) => m.id), ['u1', 'a2'], 'the grown path survived the switch')
  assert.equal(siblingCount(forward, 0), 2)
})

test('an edit replaces the active sibling in place and keeps the old wording', () => {
  const chat = { msgs: [u('u1', 'first'), a('a1', 'old answer')] }
  const edited = forkAt(chat, 0, [u('u1b', 'second')])
  assert.equal(siblingIndex(edited, 0), 0, 'stays at the same ordinal')
  const heads = continuationHeads(edited, 0)
  assert.deepEqual(heads.map((h) => h.path[0].id), ['u1b', 'a1'])
  assert.deepEqual(edited.msgs.map((m) => m.id), ['u1', 'u1b'])
})

test('an explicit ordinal places a new sibling in the list', () => {
  const chat = { msgs: [u('u1', 'q'), a('a1', 'one')] }
  const at0 = forkAt(chat, 0, [a('a2', 'two')], 0)
  assert.equal(siblingIndex(at0, 0), 0)
  assert.deepEqual(at0.msgs.map((m) => m.id), ['u1', 'a2'])
  assert.deepEqual(continuations(at0, 0)[1].map((m) => m.id), ['a1'])
})

test('a fork before the first message lives on the chat', () => {
  const chat = { msgs: [u('u1', 'hi'), a('a1', 'hello')] }
  const forked = forkAt(chat, -1, [u('u0', 'another opening')])
  assert.deepEqual(forked.msgs.map((m) => m.id), ['u0'])
  assert.equal(siblingCount(forked, -1), 2)
  const back = switchTo(forked, -1, 1)
  assert.deepEqual(back.msgs.map((m) => m.id), ['u1', 'a1'])
})

test('forks nest: a sibling path keeps its own siblings', () => {
  const inner = forkAt({ msgs: [u('u1', 'q'), a('a1', 'one')] }, 0, [a('a2', 'two')])
  const outer = forkAt(inner, -1, [], 1)
  const restored = switchTo(outer, -1, 0)
  assert.deepEqual(restored.msgs.map((m) => m.id), ['u1', 'a2'])
  assert.equal(siblingCount(restored, 0), 2, 'the nested fork survives the outer switch')
})

test('invalid switches leave the chat alone', () => {
  const chat = { msgs: [u('u1', 'hi'), a('a1', 'hello')] }
  assert.equal(switchTo(chat, 0, 4), chat)
  assert.equal(switchTo(chat, 0, -1), chat)
})
