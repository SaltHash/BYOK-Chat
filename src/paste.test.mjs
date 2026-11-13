import test from 'node:test'
import assert from 'node:assert/strict'
import { isLargePaste, PASTE_ATTACH_CHARS, PASTE_ATTACH_LINES } from './paste.ts'

test('short pasted snippets stay inline', () => {
  assert.equal(isLargePaste(''), false)
  assert.equal(isLargePaste('fix this typo'), false)
  assert.equal(isLargePaste(Array.from({ length: PASTE_ATTACH_LINES - 1 }, () => 'line').join('\n')), false)
})

test('long or many-line pastes become attachments', () => {
  assert.equal(isLargePaste('x'.repeat(PASTE_ATTACH_CHARS)), true)
  assert.equal(isLargePaste(Array.from({ length: PASTE_ATTACH_LINES }, (_, i) => `line ${i}`).join('\n')), true)
  assert.equal(isLargePaste('a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\ni\r\nj'), true, 'CRLF counts as line breaks')
})

test('thresholds can be overridden for tests and future tuning', () => {
  assert.equal(isLargePaste('12345', { chars: 5 }), true)
  assert.equal(isLargePaste('1234', { chars: 5 }), false)
  assert.equal(isLargePaste('a\nb', { lines: 3 }), false)
})
