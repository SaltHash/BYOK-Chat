import test from 'node:test'
import assert from 'node:assert/strict'

const { splitFadeUnits, rehypeFade, fadeCutoff, FADE_TAIL } = await import('./streamFade.ts')

const classesOf = (n) => {
  const c = n.properties?.className
  return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : ''
}
const textOf = (n) => (n.type === 'text' ? n.value : (n.children ?? []).map(textOf).join(''))

test('a word plus the whitespace after it is one fade unit', () => {
  assert.deepEqual(splitFadeUnits('one two\n'), [
    { t: 'one ', fade: true },
    { t: 'two\n', fade: true },
  ])
})

test('whitespace on its own is kept, but does not fade', () => {
  assert.deepEqual(splitFadeUnits('  hi'), [{ t: '  ', fade: false }, { t: 'hi', fade: true }])
  assert.deepEqual(splitFadeUnits('   '), [{ t: '   ', fade: false }])
  assert.deepEqual(splitFadeUnits(''), [])
})

test('a word still being written is one unit, so it fades once and then grows', () => {
  // The plain-text body renders these positions as keys: the same index keeps
  // the same span, so completing the word never re-runs the animation.
  assert.deepEqual(splitFadeUnits('wor'), [{ t: 'wor', fade: true }])
  assert.deepEqual(splitFadeUnits('word '), [{ t: 'word ', fade: true }])
})

test('the units cover the text exactly, newlines included', () => {
  const text = '  First line.\n\nSecond **line** here.\n'
  assert.equal(splitFadeUnits(text).map((u) => u.t).join(''), text)
})

test('the markdown plugin fades exactly those units', () => {
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'p', children: [{ type: 'text', value: ' a b' }] }] }
  rehypeFade()(tree)
  const kids = tree.children[0].children
  assert.deepEqual(kids.map((k) => k.type), ['text', 'element', 'element'])
  assert.equal(kids[0].value, ' ')
  assert.deepEqual(kids.slice(1).map((k) => k.children[0].value), ['a ', 'b'])
  assert.equal(kids[1].properties.className[0], 'sd-fade')
})

test('the cutoff keeps the newest units and leaves the rest as text', () => {
  assert.equal(fadeCutoff(10), 0)
  assert.equal(fadeCutoff(10, 4), 6)
  assert.equal(fadeCutoff(10, 0), 10)
  assert.equal(fadeCutoff(0), 0)
})

test('only the newest words of a long block keep a fade span', () => {
  // The block still being written is re-parsed and re-rendered for every
  // released word; a span per word made that cost grow with the reply.
  const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ') + ' '
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'p', children: [{ type: 'text', value: words }] }] }
  rehypeFade()(tree)
  const kids = tree.children[0].children
  const spans = kids.filter((k) => k.type === 'element')
  assert.equal(kids.map(textOf).join(''), words)      // nothing is lost or reordered
  assert.equal(spans.length, FADE_TAIL)
  assert.equal(spans[0].children[0].value, `w${100 - FADE_TAIL} `)
  assert.equal(kids[0].type, 'text')                   // the earlier words stay plain
})

test('a code block fades as one unit and keeps its own text', () => {
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'pre', children: [{ type: 'text', value: 'const a = 1\n' }] }] }
  rehypeFade()(tree)
  assert.deepEqual(tree.children[0].properties.className, ['sd-fade'])
  assert.equal(tree.children[0].children[0].value, 'const a = 1\n')
})

test('a block past the cutoff is left alone entirely', () => {
  // A shorter window than the document: the code block is old, the word after
  // it is not.
  const tree = {
    type: 'root',
    children: [
      { type: 'element', tagName: 'pre', children: [{ type: 'text', value: 'old\n' }] },
      { type: 'element', tagName: 'p', children: [{ type: 'text', value: 'new ' }] },
    ],
  }
  rehypeFade(1)(tree)
  assert.equal(classesOf(tree.children[0]), '')
  assert.equal(tree.children[1].children[0].type, 'element')
  assert.equal(textOf(tree), 'old\nnew ')
})
