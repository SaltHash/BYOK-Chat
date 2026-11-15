import test from 'node:test'
import assert from 'node:assert/strict'

const m = await import('./mentions.ts')

const cmds = [
  { id: 'c1', name: 'help', desc: 'Explains how the app works.', on: true },
  { id: 'c2', name: 'off', desc: '', on: false },
]
const opts = { cmds }

test('tokenizes a leading slash command and keeps the rest as text', () => {
  const segs = m.tokenizeMentions('/help what is this', opts)
  assert.equal(segs.length, 2)
  assert.deepEqual(segs[0], { kind: 'mention', m: {
    kind: 'command', name: 'help', label: '/help', start: 0, end: 5, enabled: true, desc: 'Explains how the app works.',
  } })
  assert.equal(segs[1].text, ' what is this')
})

test('commits a command at the end of the message and marks disabled ones', () => {
  const [seg] = m.tokenizeMentions('/off', opts)
  assert.equal(seg.kind, 'mention')
  assert.equal(seg.m.enabled, false)
  assert.equal(seg.m.desc, 'Runs one of your saved commands.')
})

test('slash commands only count at the very start', () => {
  const segs = m.tokenizeMentions('say /help', opts)
  assert.ok(segs.every((s) => s.kind === 'text'))
})

test('feature switches suppress command pills', () => {
  const off = { ...opts, commandsOn: false }
  assert.ok(m.tokenizeMentions('/help now', off).every((s) => s.kind === 'text'))
})

/* Search and deep research travel with the message as a request, so the @
 * forms that used to open them are ordinary text again. */
test('search, research and tool names stay ordinary text', () => {
  for (const v of ['@search tomorrow', 'add it @search(2*(3+4)) please', '@research fusion progress', '@date tomorrow', '@nope hello']) {
    assert.ok(m.tokenizeMentions(v, opts).every((s) => s.kind === 'text'), v)
  }
})

// '/help used @calc now' — a command pill and a tool pill from an older draft.
// Tools are no longer mentionable, but stored drafts and sent messages can
// still carry them, so the atomic pill rules must keep working.
const atomic = [
  { kind: 'mention', m: { kind: 'command', name: 'help', label: '/help', start: 0, end: 5, enabled: true, desc: '' } },
  { kind: 'text', text: ' used ', start: 5, end: 11 },
  { kind: 'mention', m: { kind: 'tool', name: 'calc', label: '@calc', start: 11, end: 16, enabled: true, desc: '' } },
  { kind: 'text', text: ' now', start: 16, end: 20 },
]

test('arrow keys step over a whole pill instead of into it', () => {
  assert.deepEqual(m.pillEdit(atomic, 'ArrowLeft', 16, 16), { kind: 'caret', pos: 11 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowLeft', 14, 14), { kind: 'caret', pos: 11 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowRight', 11, 11), { kind: 'caret', pos: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowRight', 13, 13), { kind: 'caret', pos: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'ArrowLeft', 5, 5), { kind: 'caret', pos: 0 })
  // Just outside a pill: the browser keeps its normal single-character step.
  assert.equal(m.pillEdit(atomic, 'ArrowLeft', 11, 11), null)
  assert.equal(m.pillEdit(atomic, 'ArrowRight', 16, 16), null)
  assert.equal(m.pillEdit(atomic, 'ArrowLeft', 17, 17), null)
})

test('backspace and delete remove a pill in one step, never a fragment', () => {
  assert.deepEqual(m.pillEdit(atomic, 'Backspace', 16, 16), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Backspace', 14, 14), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Delete', 11, 11), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Delete', 13, 13), { kind: 'delete', start: 11, end: 16 })
  assert.deepEqual(m.pillEdit(atomic, 'Backspace', 11, 16), { kind: 'delete', start: 11, end: 16 })
  // Text plus a pill selected: hand it back to the browser.
  assert.equal(m.pillEdit(atomic, 'Backspace', 10, 16), null)
  assert.equal(m.pillEdit(atomic, 'Backspace', 11, 11), null)
  assert.equal(m.pillEdit(atomic, 'Delete', 16, 16), null)
})

test('atomic rules ignore unrelated keys and plain text', () => {
  assert.equal(m.pillEdit(atomic, 'Enter', 13, 13), null)
  assert.equal(m.pillEdit(atomic, 'a', 13, 13), null)
  const plain = m.tokenizeMentions('nothing to see', opts)
  assert.equal(m.pillEdit(plain, 'Backspace', 8, 8), null)
})
