import test from 'node:test'
import assert from 'node:assert/strict'

const { shareableChat, shareIdFromHash, shareHash, latestShare } = await import('./share.ts')

test('a shareable snapshot keeps visible text only and normalizes the title', () => {
  const snap = shareableChat({
    title: '  Big   Topic ',
    msgs: [
      { id: '1', r: 'user', t: 'question', att: [{ name: 'a.png' }] },
      { id: '2', r: 'assistant', t: 'answer', by: 'OpenAI · gpt-4o', reasoning: 'private', log: [{ n: 'x' }] },
      { id: '3', r: 'assistant', t: '   ' },
    ],
  })
  assert.equal(snap.title, 'Big Topic')
  assert.equal(snap.msgs.length, 2)
  assert.deepEqual(Object.keys(snap.msgs[0]).sort(), ['r', 't'])
  assert.equal(snap.msgs[1].by, 'OpenAI · gpt-4o')
})

test('an empty chat cannot be shared and long text is capped', () => {
  assert.equal(shareableChat({ title: 'x', msgs: [] }), null)
  assert.equal(shareableChat({ title: 'x', msgs: [{ id: '1', r: 'user', t: '  ' }] }), null)
  const big = shareableChat({ title: '', msgs: [{ id: '1', r: 'user', t: 'a'.repeat(30_000) }] })
  assert.equal(big.title, 'Shared conversation')
  assert.equal(big.msgs[0].t.length, 20_000)
})

test('share ids are parsed out of the hash', () => {
  assert.equal(shareIdFromHash('#share/abcDEF123_-x'), 'abcDEF123_-x')
  assert.equal(shareIdFromHash('#/share/abcDEF123_-x'), 'abcDEF123_-x')
  assert.equal(shareIdFromHash('#chat'), '')
  assert.equal(shareIdFromHash('#share/too-short'), '')
})

test('the share hash tracks the visible transcript and ignores private fields', () => {
  const a = { title: 'T', msgs: [{ id: '1', r: 'user', t: 'hello' }] }
  const b = { title: 'T', msgs: [{ id: '1', r: 'user', t: 'hello', reasoning: 'different', log: [{ n: 'x' }] }] }
  assert.equal(shareHash(a), shareHash(b))
  assert.notEqual(shareHash(a), shareHash({ title: 'T', msgs: [{ id: '1', r: 'user', t: 'hello!' }] }))
  assert.equal(shareHash({ title: 'x', msgs: [] }), '')
})

test('the latest share for a chat is the newest one', () => {
  const rows = [
    { id: 'a', chatId: 'c1', at: 10 },
    { id: 'b', chatId: 'c2', at: 99 },
    { id: 'c', chatId: 'c1', at: 20 },
  ]
  assert.equal(latestShare(rows, 'c1')?.id, 'c')
  assert.equal(latestShare(rows, 'missing'), undefined)
  assert.equal(latestShare(undefined, 'c1'), undefined)
})
