import test from 'node:test'
import assert from 'node:assert/strict'
import { useS } from './store.ts'

const mk = (id) => ({ id, title: id, msgs: [] })
const seed = () => useS.setState({ chats: [mk('a'), mk('b')], chat: 'a', draft: '', drafts: {} })

/* A half-typed message belongs to the chat it was typed in: switching chats
 * must stash it, restore the other chat's draft, and never blend the two. */
test('drafts are remembered per chat and never leak across chats', () => {
  const s = () => useS.getState()
  seed()
  s().patch({ draft: 'half-typed a' })
  assert.equal(s().drafts.a, 'half-typed a')
  s().patch({ chat: 'b' })
  assert.equal(s().draft, '')
  s().patch({ draft: 'b draft' })
  s().patch({ chat: 'a' })
  assert.equal(s().draft, 'half-typed a')
  s().patch({ chat: 'b' })
  assert.equal(s().draft, 'b draft')
})

test('the draft of a deleted chat is dropped with it', () => {
  const s = () => useS.getState()
  seed()
  s().patch({ draft: 'doomed' })
  s().chatOp('a', 'del')
  assert.equal(s().chat, 'b')
  assert.equal(s().drafts.a, undefined)
  assert.equal(s().draft, '')
})
