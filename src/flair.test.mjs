import test from 'node:test'
import assert from 'node:assert/strict'

const { PROMPT_QUALITIES, normQualities, normGlobalPrompt, qualityPrompt, seasonalLine, seasonalLines, greetingFor, flairLine, TEMPORARY_FLAIR } = await import('./flair.ts')

const at = (y, m, d) => new Date(y, m - 1, d, 12)

test('Halloween and Christmas open three weeks out and linger two days', () => {
  assert.equal(seasonalLine(at(2026, 10, 9)), null)
  assert.ok(seasonalLine(at(2026, 10, 10)), 'Halloween should start Oct 10')
  assert.ok(seasonalLine(at(2026, 10, 31)))
  assert.ok(seasonalLine(at(2026, 11, 2)), 'Halloween should last through Nov 2')
  assert.equal(seasonalLine(at(2026, 11, 3)), null)
  assert.equal(seasonalLine(at(2026, 12, 3)), null)
  assert.ok(seasonalLine(at(2026, 12, 4)), 'Christmas should start Dec 4')
  assert.ok(seasonalLine(at(2026, 12, 25)))
  assert.ok(seasonalLine(at(2026, 12, 27)), 'Christmas should last through Dec 27')
})

test('the New Year window carries on through January 2', () => {
  assert.ok(seasonalLine(at(2026, 12, 28)))
  assert.ok(seasonalLine(at(2027, 1, 1)))
  assert.ok(seasonalLine(at(2027, 1, 2)))
  assert.equal(seasonalLine(at(2027, 1, 3)), null)
  assert.equal(seasonalLines(at(2026, 12, 28)).length, 3)
})

test('an ordinary day in the year has no seasonal line', () => {
  for (const [m, d] of [[3, 15], [6, 1], [8, 20], [9, 30], [11, 10]]) assert.equal(seasonalLine(at(2026, m, d)), null)
})

test('each holiday offers several short lines, none about coding or a flat greeting', () => {
  const coding = /\b(code|coding|commit|build|debug|log|repo|deploy|bug|refactor|compile|kernel|script|terminal)\b/i
  const names = /\b(halloween|spooky|christmas|xmas|merry|holidays|new year|valentine|happy)\b/i
  const windows = { halloween: [2026, 10, 31], christmas: [2026, 12, 20], newYear: [2027, 1, 1], valentine: [2026, 2, 14] }
  for (const [name, [y, m, d]] of Object.entries(windows)) {
    const lines = seasonalLines(at(y, m, d))
    const expected = name === 'valentine' ? 2 : 3
    assert.ok(lines.length >= expected, `${name} should offer at least ${expected} lines, saw ${lines.length}`)
    for (const line of lines) {
      assert.ok(!coding.test(line), `${name} line reads as coding copy: ${line}`)
      assert.ok(!names.test(line), `${name} line announces the holiday instead of suggesting it: ${line}`)
      assert.ok(line.length <= 42, `${name} line is too long: ${line}`)
    }
  }
})

test('a holiday draws one line at random and then holds it', () => {
  const real = Math.random
  try {
    /* Stubbed values chosen so the index they map to is unambiguous. */
    Math.random = () => 0.0000005
    const first = seasonalLine(at(2031, 10, 31))
    assert.equal(first, seasonalLines(at(2031, 10, 31))[0])
    Math.random = () => 0.9999995
    assert.equal(seasonalLine(at(2031, 11, 1)), first, 'the draw should hold for the rest of the window')
    assert.equal(seasonalLine(at(2032, 10, 31)), seasonalLines(at(2032, 10, 31))[3], 'a later window should draw afresh')
    assert.equal(seasonalLine(at(2032, 11, 1)), seasonalLine(at(2032, 10, 31)), 'and hold that draw too')
  } finally {
    Math.random = real
  }
})

test('a temporary chat gets its own fixed line, whatever the date', () => {
  assert.equal(flairLine(at(2026, 12, 25), { temporary: true, seasonal: true, seed: 3 }), TEMPORARY_FLAIR)
  assert.equal(flairLine(at(2026, 3, 15), { temporary: true, seasonal: true, seed: 3 }), TEMPORARY_FLAIR)
  assert.equal(flairLine(at(2026, 3, 15), { temporary: true, seasonal: false, seed: 3 }), TEMPORARY_FLAIR)
  assert.equal(
    flairLine(at(2027, 6, 1), { temporary: true, seasonal: true, seed: 9 }),
    flairLine(at(2026, 1, 1), { temporary: true, seasonal: true, seed: 1 }),
    'the temporary line should not vary with the date or the seed',
  )
})

test('a temporary chat wins over the seasonal line', () => {
  assert.ok(seasonalLine(at(2026, 12, 25)), 'sanity: Christmas should have a line here')
  assert.equal(flairLine(at(2026, 12, 25), { temporary: true, seasonal: true, seed: 3 }), TEMPORARY_FLAIR)
})

test('a permanent chat keeps the seasonal line, then the greeting', () => {
  assert.equal(flairLine(at(2026, 12, 25), { temporary: false, seasonal: true, seed: 1 }), seasonalLine(at(2026, 12, 25)))
  assert.equal(flairLine(at(2026, 12, 25), { temporary: false, seasonal: false, seed: 1 }), greetingFor(at(2026, 12, 25), 1))
  assert.equal(flairLine(at(2026, 3, 15), { temporary: false, seasonal: true, seed: 1 }), greetingFor(at(2026, 3, 15), 1))
})

test('the temporary line is short, playful, and says the chat is temporary', () => {
  assert.ok(TEMPORARY_FLAIR.length <= 44, `the temporary line is too long: ${TEMPORARY_FLAIR}`)
  assert.match(TEMPORARY_FLAIR, /temporary/i)
  assert.doesNotMatch(TEMPORARY_FLAIR, /poof/i, 'the header pill already says poof')
  assert.doesNotMatch(TEMPORARY_FLAIR, /\b(halloween|christmas|holidays|new year|valentine|happy)\b/i)
})

test('quality ids are unique and have short prompt text', () => {
  const ids = PROMPT_QUALITIES.map((q) => q.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const q of PROMPT_QUALITIES) {
    assert.ok(q.label.trim(), `${q.id} needs a label`)
    assert.ok(q.text.trim(), `${q.id} needs prompt text`)
    assert.ok(!q.text.includes('—'), `${q.id} must not use an em dash`)
  }
})

test('stored qualities keep known ids, drop duplicates and junk', () => {
  assert.deepEqual(normQualities(['warm', 'warm', 'nope', null, 'direct']), ['warm', 'direct'])
  assert.deepEqual(normQualities(undefined), [])
  assert.deepEqual(normQualities('warm'), [])
})

test('global prompt normalization supplies safe defaults', () => {
  assert.deepEqual(normGlobalPrompt(undefined), { on: false, text: '', qualities: [] })
  assert.deepEqual(normGlobalPrompt({ on: true, text: 'Base.', qualities: ['playful', 'bad'] }), {
    on: true,
    text: 'Base.',
    qualities: ['playful'],
  })
})

test('quality prompt appends only selected qualities and keeps the base authoritative', () => {
  assert.equal(qualityPrompt([]), '')
  const text = qualityPrompt(['warm', 'practical'])
  assert.match(text, /^# Selected qualities\n/)
  assert.match(text, /- Warm: /)
  assert.match(text, /- Practical: /)
  assert.ok(!text.includes('- Concise: '))
  assert.match(text, /do not override the other instructions/)
})
