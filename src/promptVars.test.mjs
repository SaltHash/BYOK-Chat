import test from 'node:test'
import assert from 'node:assert/strict'

const { PROMPT_VARS, promptVarValues, applyPromptVars, dateContext } = await import('./promptVars.ts')

const NOW = new Date('2026-10-21T14:03:11Z')

test('prompt variables resolve in UTC', () => {
  const v = promptVarValues(NOW)
  assert.equal(v.date, '2026-10-21')
  assert.equal(v.time, '14:03:11 UTC')
  assert.equal(v.datetime, '2026-10-21 14:03:11 UTC')
  assert.equal(v.weekday, 'Wednesday')
  assert.equal(v.iso, '2026-10-21T14:03:11Z')
})

test('prompt variables use UTC, not local time', () => {
  // 23:30 UTC is already the next day in CET/CEST — the variable must not
  // drift with the machine timezone.
  const late = new Date('2026-10-21T23:30:00Z')
  assert.equal(promptVarValues(late).date, '2026-10-21')
  assert.equal(promptVarValues(late).time, '23:30:00 UTC')
})

test('applyPromptVars replaces known placeholders only', () => {
  assert.equal(applyPromptVars('Today is {date}.', NOW), 'Today is 2026-10-21.')
  assert.equal(applyPromptVars('{datetime} / {weekday}', NOW), '2026-10-21 14:03:11 UTC / Wednesday')
  // Unknown names and non-variable braces are left alone.
  assert.equal(applyPromptVars('{unknown}', NOW), '{unknown}')
  assert.equal(applyPromptVars('{"json": true}', NOW), '{"json": true}')
  assert.equal(applyPromptVars('{{input}}', NOW), '{{input}}')
  assert.equal(applyPromptVars('{{date}}', NOW), '{{date}}')
  assert.equal(applyPromptVars('no variables here', NOW), 'no variables here')
  assert.equal(applyPromptVars('', NOW), '')
})

test('applyPromptVars never throws on odd input', () => {
  assert.equal(applyPromptVars(undefined, NOW), '')
  assert.equal(applyPromptVars(null, NOW), '')
  assert.equal(applyPromptVars(42, NOW), '')
})

test('dateContext states the current UTC date and time', () => {
  const line = dateContext(NOW)
  assert.match(line, /2026-10-21/)
  assert.match(line, /UTC/)
  assert.match(line, /Wednesday/)
})

test('every advertised variable resolves to a value', () => {
  const values = promptVarValues(NOW)
  for (const v of PROMPT_VARS) {
    assert.ok(values[v.id], `missing value for ${v.id}`)
    assert.ok(applyPromptVars(`{${v.id}}`, NOW) !== `{${v.id}}`, `placeholder ${v.id} was not replaced`)
  }
})
