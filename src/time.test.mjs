import test from 'node:test'
import assert from 'node:assert/strict'

const { formatMsgTime, formatMsgDateTime, clockOf } = await import('./time.ts')

const at = (y, m, d, h, min) => new Date(y, m, d, h, min).getTime()

test('missing or invalid timestamps render nothing', () => {
  assert.equal(formatMsgTime(undefined), '')
  assert.equal(formatMsgTime(Number.NaN), '')
  assert.equal(formatMsgDateTime(undefined), '')
})

test('today shows only the 24-hour clock', () => {
  const now = at(2026, 9, 22, 18, 0)
  assert.equal(formatMsgTime(at(2026, 9, 22, 9, 5), now), '09:05')
  assert.equal(formatMsgTime(at(2026, 9, 22, 23, 59), now), '23:59')
})

test('another day in the same year adds the date', () => {
  const now = at(2026, 9, 22, 18, 0)
  assert.equal(formatMsgTime(at(2026, 2, 4, 14, 5), now), '4 Mar, 14:05')
})

test('another year adds the year', () => {
  const now = at(2026, 0, 2, 8, 0)
  assert.equal(formatMsgTime(at(2025, 11, 31, 23, 5), now), '31 Dec 2025, 23:05')
})

test('midnight keeps leading zeros and the tooltip is always full', () => {
  assert.equal(clockOf(at(2026, 9, 22, 0, 0)), '00:00')
  assert.equal(formatMsgDateTime(at(2026, 9, 22, 0, 0)), '22 Oct 2026, 00:00')
})
