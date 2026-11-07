import test from 'node:test'
import assert from 'node:assert/strict'
import { bookmarkEntries, isBookmarked, toggleBookmark } from './bookmarks.ts'

const chat = (over = {}) => ({
  id: 'c1',
  title: 'Pricing research',
  msgs: [
    { id: 'm1', r: 'user', t: 'Compare the plans', at: 10 },
    { id: 'm2', r: 'assistant', t: 'Raw answer', toolFinal: 'The **Standard** plan is cheaper.', at: 20, by: 'GPT' },
    { id: 'm3', r: 'assistant', t: 'A second reply', at: 30 },
  ],
  ...over,
})

test('toggleBookmark adds newest first and removes on a second toggle', () => {
  const first = toggleBookmark(undefined, 'm2')
  assert.deepEqual(first, ['m2'])
  const second = toggleBookmark(first, 'm3')
  assert.deepEqual(second, ['m3', 'm2'])
  assert.deepEqual(toggleBookmark(second, 'm2'), ['m3'])
})

test('toggleBookmark tolerates corrupt and duplicate ids', () => {
  assert.deepEqual(toggleBookmark(['m1', null, 'm1', ''], 'm2'), ['m2', 'm1', 'm1'])
  assert.deepEqual(toggleBookmark(null, 'm1'), ['m1'])
})

test('isBookmarked answers only for real ids', () => {
  assert.equal(isBookmarked(['m1'], 'm1'), true)
  assert.equal(isBookmarked(['m1'], 'm2'), false)
  assert.equal(isBookmarked(undefined, 'm1'), false)
})

test('bookmarkEntries resolves chat title, preferred final text and author', () => {
  const entries = bookmarkEntries([chat({ bookmarks: ['m2', 'm1'] })])
  assert.equal(entries.length, 2)
  const reply = entries.find((entry) => entry.msgId === 'm2')
  assert.equal(reply.chatTitle, 'Pricing research')
  assert.equal(reply.text, 'The **Standard** plan is cheaper.')
  assert.equal(reply.by, 'GPT')
  assert.equal(reply.reply, true)
  assert.equal(reply.at, 20)
})

test('bookmarkEntries sorts newest first and skips deleted messages', () => {
  const entries = bookmarkEntries([chat({ bookmarks: ['m2', 'gone', 'm3'] })])
  assert.deepEqual(entries.map((entry) => entry.msgId), ['m3', 'm2'])
})

test('bookmarkEntries normalizes whitespace and caps long excerpts', () => {
  const long = `${'a'.repeat(179)}   b`.replace(/a/g, 'word ')
  const entries = bookmarkEntries([chat({
    bookmarks: ['m2'],
    msgs: [{ id: 'm2', r: 'assistant', t: `  ${'word '.repeat(60)}  `, at: 1 }],
  })])
  assert.equal(entries[0].text.endsWith('…'), true)
  assert.ok(entries[0].text.length <= 181)
  assert.equal(entries[0].text.includes('  '), false)
  assert.equal(long.length > 0, true)
})

test('bookmarkEntries ignores chats with no bookmarks', () => {
  assert.deepEqual(bookmarkEntries([chat()]), [])
})
