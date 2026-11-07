import assert from 'node:assert/strict'
import test from 'node:test'
import { chatHash, chatIdFromHash } from './chatRoute.ts'

test('chat hashes round-trip ordinary and encoded ids', () => {
  assert.equal(chatHash('chat-abc_123'), '#chat/chat-abc_123')
  assert.equal(chatIdFromHash(chatHash('chat-abc_123')), 'chat-abc_123')
  assert.equal(chatIdFromHash(chatHash('chat/with space')), 'chat/with space')
})

test('only dedicated chat routes are treated as chat links', () => {
  assert.equal(chatIdFromHash('#chat'), '')
  assert.equal(chatIdFromHash('#settings/eps'), '')
  assert.equal(chatIdFromHash('#share/abcdefghijkl'), '')
  assert.equal(chatIdFromHash('#chat/'), '')
  assert.equal(chatIdFromHash('#chat/bad%'), '')
  assert.equal(chatIdFromHash(`#chat/${'x'.repeat(129)}`), '')
})
