import test from 'node:test'
import assert from 'node:assert/strict'
import { chatsInDateRange } from './configIO.ts'

const chat = (id, ats) => ({ id, msgs: ats.map((at, i) => ({ id: `${id}-${i}`, at })) })
const at = (iso) => new Date(iso).getTime()
const chats = [
  chat('before', [at('2026-01-01T12:00:00')]),
  chat('inside', [at('2026-05-10T12:00:00'), at('2026-05-20T12:00:00')]),
  chat('after', [at('2026-09-01T12:00:00')]),
  { id: 'empty', msgs: [] },
]

test('no range keeps every chat, including empty ones', () => {
  assert.equal(chatsInDateRange(chats).length, 4)
})

test('a date range keeps chats with any message inside it', () => {
  assert.deepEqual(chatsInDateRange(chats, '2026-05-01', '2026-05-31').map((c) => c.id), ['inside'])
  assert.deepEqual(chatsInDateRange(chats, '2026-01-01', '2026-05-10').map((c) => c.id), ['before', 'inside'])
  assert.deepEqual(chatsInDateRange(chats, '', '2026-05-09').map((c) => c.id), ['before'])
  assert.deepEqual(chatsInDateRange(chats, '2026-06-01').map((c) => c.id), ['after'])
})
