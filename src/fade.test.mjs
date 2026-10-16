import test from 'node:test'
import assert from 'node:assert/strict'

const { activeFadeEvents } = await import('./fade.ts')

test('activeFadeEvents keeps only current-session events inside the window', () => {
  const events = [
    { text: 'recent', at: 1_000 },
    { text: 'expired', at: 100 },
    { text: 'future (stale from a previous session)', at: 50_000 },
  ]
  const out = activeFadeEvents(events, 1_200, 400).map((e) => e.text)
  assert.deepEqual(out, ['recent'])
})

test('activeFadeEvents ignores all events when the fade is disabled or empty', () => {
  assert.deepEqual(activeFadeEvents([{ text: 'x', at: 10 }], 20, 0), [])
  assert.deepEqual(activeFadeEvents(null, 20, 400), [])
  assert.deepEqual(activeFadeEvents([], 20, 400), [])
})
