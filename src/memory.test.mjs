import test from 'node:test'
import assert from 'node:assert/strict'

const m = await import('../src/memory.ts')

const prefs = (patch = {}) => ({ ...m.DEFAULT_MEMORY_PREFS, enabled: true, ...patch })

test('memory applies to normal chats and follows the temporary-chat setting', () => {
  assert.equal(m.memoryEnabledFor(prefs(), true, false), true)
  assert.equal(m.memoryEnabledFor(prefs(), true, true), true)
  assert.equal(m.memoryEnabledFor(prefs({ tempChats: false }), true, true), false)
  assert.equal(m.memoryEnabledFor(prefs(), false, false), false)
  assert.equal(m.memoryEnabledFor(prefs({ enabled: false }), true, false), false)
})

test('normalization defaults memory to off and temporary chats to on', () => {
  const p = m.normMemoryPrefs(null)
  assert.equal(p.enabled, false)
  assert.equal(p.tempChats, true)
  assert.equal(p.intent, 'balanced')
  assert.equal(m.normMemoryPrefs({ enabled: true, tempChats: false, intent: 'aggressive' }).tempChats, false)
  assert.equal(m.normMemoryPrefs({ intent: 'sometimes' }).intent, 'balanced')
})

test('policy asks the model to save proactively in aggressive mode', () => {
  const text = m.memoryPolicyText(prefs({ intent: 'aggressive' }), { count: 3 })
  assert.match(text, /proactive/i)
  assert.match(text, /3 saved memories/)
  assert.doesNotMatch(text, /No memories are saved yet/)
})

test('policy respects intentional mode and nudges an empty store otherwise', () => {
  const intentional = m.memoryPolicyText(prefs({ intent: 'intentional' }), { count: 0 })
  assert.match(intentional, /Only save when the user explicitly asks/i)
  assert.doesNotMatch(intentional, /likely a useful first memory/i)
  const empty = m.memoryPolicyText(prefs({ intent: 'balanced' }), { count: 0 })
  assert.match(empty, /No memories are saved yet/)
  assert.match(empty, /likely a useful first memory/i)
})

test('policy explains that temporary chats keep memory through the setting', () => {
  const text = m.memoryPolicyText(prefs(), { count: 1, temporary: true })
  assert.match(text, /temporary chat/i)
  assert.match(text, /transcript itself expires/i)
})

test('search ranks relevant memories and caps the result', () => {
  const memories = [
    { id: 'a', text: 'Prefers TypeScript and React', category: 'Programming interests' },
    { id: 'b', text: 'Vegetarian diet with no nuts', category: 'Dietary restrictions' },
    { id: 'c', text: 'Lives in Kyoto', category: 'Location' },
  ]
  const hits = m.searchMemories(memories, 'typescript react')
  assert.equal(hits[0].id, 'a')
  assert.equal(m.searchMemories(memories, '').length, 3)
  assert.equal(m.searchMemories(memories, 'typescript react', 1).length, 1)
})

test('memory results stay compact and say when entries are hidden', () => {
  const rows = [{ id: 'a', text: 'Likes tea', category: 'Preferences' }]
  assert.match(m.formatMemoryResults(rows, 9), /8 more not shown/)
  assert.match(m.formatMemoryResults([], 0), /No memories are stored/)
  assert.match(m.formatMemoryResults([], 3, 'coffee'), /No memories matched “coffee”/)
})
