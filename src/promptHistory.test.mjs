import test from 'node:test'
import assert from 'node:assert/strict'

const { pushPromptHistory, getPromptHistory, promptHistoryDepth } = await import('./promptHistory.ts')

test('records sent messages newest-last and never exposes its internals', () => {
  pushPromptHistory('first')
  pushPromptHistory('second')
  const h = getPromptHistory()
  assert.deepEqual(h, ['first', 'second'])
  h.push('mutated')
  assert.deepEqual(getPromptHistory(), ['first', 'second'])
})

test('empty and whitespace-only drafts are not recorded', () => {
  const depth = promptHistoryDepth()
  pushPromptHistory('')
  pushPromptHistory('   ')
  assert.equal(promptHistoryDepth(), depth)
})

test('an immediate resend of the newest entry does not duplicate it', () => {
  pushPromptHistory('same')
  pushPromptHistory('same')
  const h = getPromptHistory()
  assert.equal(h[h.length - 1], 'same')
  assert.notEqual(h[h.length - 2], 'same')
})

test('a re-sent older message moves to the newest position', () => {
  pushPromptHistory('older')
  pushPromptHistory('newer')
  pushPromptHistory('older')
  const h = getPromptHistory()
  assert.equal(h[h.length - 1], 'older')
  assert.notEqual(h[h.length - 2], 'older')
})

test('trimming happens before storage, so trimmed duplicates collapse', () => {
  pushPromptHistory('  spaced  ')
  pushPromptHistory('spaced')
  const h = getPromptHistory()
  assert.equal(h[h.length - 1], 'spaced')
  assert.notEqual(h[h.length - 2], 'spaced')
})

test('the history stays bounded at 100 entries', () => {
  for (let i = 0; i < 120; i++) pushPromptHistory(`msg-${i}`)
  const h = getPromptHistory()
  assert.equal(h.length, 100)
  assert.equal(h[h.length - 1], 'msg-119') // newest kept
  assert.equal(h[0], 'msg-20') // oldest dropped
})
