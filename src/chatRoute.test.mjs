import assert from 'node:assert/strict'
import test from 'node:test'
import { chatHash, chatIdFromHash, historyAction } from './chatRoute.ts'

test('chat hashes round-trip ordinary and encoded ids', () => {
  assert.equal(chatHash('chat-abc_123'), '#chat/chat-abc_123')
  assert.equal(chatIdFromHash(chatHash('chat-abc_123')), 'chat-abc_123')
  assert.equal(chatIdFromHash(chatHash('chat/with space')), 'chat/with space')
})

test('history only pushes meaningful route changes', () => {
  const base = { ready: true, sameHash: false, prevChat: 'a', chat: 'a', prevSettingsOpen: false, settingsOpen: false }
  assert.equal(historyAction({ ...base, ready: false, chat: 'b' }), 'replace')
  assert.equal(historyAction({ ...base, sameHash: true, chat: 'b' }), 'none')
  assert.equal(historyAction({ ...base, chat: 'b' }), 'push')
  assert.equal(historyAction({ ...base, settingsOpen: true }), 'push')
  assert.equal(historyAction({ ...base, prevSettingsOpen: true, settingsOpen: true }), 'replace')
})

test('only dedicated chat routes are treated as chat links', () => {
  assert.equal(chatIdFromHash('#chat'), '')
  assert.equal(chatIdFromHash('#settings/eps'), '')
  assert.equal(chatIdFromHash('#share/abcdefghijkl'), '')
  assert.equal(chatIdFromHash('#chat/'), '')
  assert.equal(chatIdFromHash('#chat/bad%'), '')
  assert.equal(chatIdFromHash(`#chat/${'x'.repeat(129)}`), '')
})
