import test from 'node:test'
import assert from 'node:assert/strict'

const { blockEnds, splitBlocks } = await import('./streamSplit.ts')

test('paragraphs split after their blank line', () => {
  assert.deepEqual(splitBlocks('one\n\ntwo'), ['one\n\n', 'two'])
  assert.deepEqual(blockEnds('one\n\ntwo'), [5])
})

test('a blank line inside a code fence is content, not a boundary', () => {
  const text = 'a\n\n```js\nx\n\ny\n```\n\nb'
  assert.deepEqual(splitBlocks(text), ['a\n\n', '```js\nx\n\ny\n```\n\n', 'b'])
  assert.deepEqual(splitBlocks(text.replace(/```/g, '~~~')), ['a\n\n', '~~~js\nx\n\ny\n~~~\n\n', 'b'])
})

test('a blank line between items does not split a list', () => {
  assert.deepEqual(splitBlocks('- one\n\n- two\n\nend'), ['- one\n\n- two\n\n', 'end'])
  assert.deepEqual(splitBlocks('1. one\n\n2. two\n\ntext'), ['1. one\n\n2. two\n\n', 'text'])
})

test('a blank line inside display math is content', () => {
  assert.deepEqual(splitBlocks('a\n\n$$\nx\n\ny\n$$\n\nb'), ['a\n\n', '$$\nx\n\ny\n$$\n\n', 'b'])
})

test('an empty stream and a single unfinished block stay in one piece', () => {
  assert.deepEqual(splitBlocks(''), [''])
  assert.deepEqual(splitBlocks('still typing'), ['still typing'])
  assert.deepEqual(blockEnds('a\n\n```js\nx'), [3])
})
