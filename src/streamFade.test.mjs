import test from 'node:test'
import assert from 'node:assert/strict'

const { splitFadeUnits, rehypeFade } = await import('./streamFade.ts')

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
