import test from 'node:test'
import assert from 'node:assert/strict'

const { splitStream } = await import('./streamMd.ts')

const doc = [
  '# Title',
  '',
  'Intro paragraph that is still being typed',
  '- one',
  '- two',
  '',
  '```ts',
  'const a = 1',
  '',
  'const b = 2',
  '```',
  '',
  '## Next',
  '',
  'Tail text',
].join('\n')

test('nothing settles before the first blank line', () => {
  assert.deepEqual(splitStream(''), { head: '', tail: '' })
  assert.deepEqual(splitStream('Hello'), { head: '', tail: 'Hello' })
  assert.deepEqual(splitStream('A paragraph\nthat continues'), { head: '', tail: 'A paragraph\nthat continues' })
})

test('a completed block is committed and the next one stays live', () => {
  assert.deepEqual(splitStream('First paragraph.\n\nSecond par'), {
    head: 'First paragraph.\n\n',
    tail: 'Second par',
  })
})

test('line breaks inside one block never split it', () => {
  // A list is one block: splitting at its newline would render the live item
  // outside the list, at the wrong indent.
  const list = '- first item\n- second item is st'
  assert.deepEqual(splitStream(list), { head: '', tail: list })
  const fence = '```js\nconst a = 1\nconst b'
  assert.deepEqual(splitStream(fence), { head: '', tail: fence })
})

test('blank lines inside a fenced code block are not block boundaries', () => {
  const src = 'Intro.\n\n```js\nconst a = 1\n\nconst b = 2\n'
  assert.deepEqual(splitStream(src), { head: 'Intro.\n\n', tail: '```js\nconst a = 1\n\nconst b = 2\n' })
})

test('a closed fence followed by a blank line is committed', () => {
  const src = 'Intro.\n\n```js\nconst a = 1\n```\n\nNext'
  assert.deepEqual(splitStream(src), { head: 'Intro.\n\n```js\nconst a = 1\n```\n\n', tail: 'Next' })
})

test('a fence nested in a list item is still a fence', () => {
  const src = '1. Step one.\n\n   ```js\n   const a = 1\n\n   const b = 2\n   ```\n\nNext block'
  assert.deepEqual(splitStream(src), { head: "1. Step one.\n\n   ```js\n   const a = 1\n\n   const b = 2\n   ```\n\n", tail: 'Next block' })
})

test('indented lines continue the block above them', () => {
  // A blank line inside a list item body, and indented code, both belong to
  // the block above; committing in front of them would change the rendering.
  const src = '1. First\n\n   still the same item\n'
  assert.deepEqual(splitStream(src), { head: '', tail: src })
  const code = 'Intro.\n\n    indented code\n'
  assert.deepEqual(splitStream(code), { head: '', tail: code })
})

test('trailing blank lines stay live until a block follows them', () => {
  // Committing early would render the same thing; waiting costs nothing and
  // keeps the splitter from inventing a boundary at the end of the reply.
  assert.deepEqual(splitStream('Done.\n\n'), { head: '', tail: 'Done.\n\n' })
})

test('every prefix of a reply splits without losing or reordering text', () => {
  for (let i = 0; i <= doc.length; i++) {
    const full = doc.slice(0, i)
    const { head, tail } = splitStream(full)
    assert.equal(head + tail, full, `prefix ${i} loses text`)
    // Whatever head contains must be a settled prefix: it ends at a blank line
    // (a real block boundary) or at the start of the reply.
    if (head) assert.match(head, /\n\n$/, `prefix ${i} head does not end on a block boundary`)
    // The live tail must start on a block the prefix does not already cover,
    // i.e. it never begins with a continuation of the previous block.
    if (tail) assert.doesNotMatch(tail, /^[ \t]/, `prefix ${i} tail starts indented`)
  }
})

test('the live tail inside an unfinished fence is never the fence content alone', () => {
  const src = doc.slice(0, doc.indexOf('const b = 2'))
  const { head, tail } = splitStream(src)
  assert.ok(tail.startsWith('```ts'), 'the open fence stays with the live tail')
  assert.ok(!head.includes('```'), 'an unterminated fence is never committed')
})
