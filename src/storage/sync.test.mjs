import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptSyncPayload, decryptSyncPayload, buildSyncPayload, SYNC_PLAINTEXT_MAX_BYTES } from './sync.ts'

const TOKEN = 'byok1-abcdefghijklmnop-' + 'Q'.repeat(43)
const payload = buildSyncPayload({
  storeVersion: 18,
  settings: { themeMode: 'dark', apiKeyHint: 'sk-secret' },
  chats: [],
  workspaces: [],
  selectedRevision: null,
})

/* The server must never hold readable state: what leaves the device is an
 * envelope whose ciphertext only a token holder can open. */
test('sync payloads round-trip through the token-encrypted envelope', async () => {
  const env = await encryptSyncPayload(payload, TOKEN)
  assert.equal(typeof env.encrypted, 'string')
  assert.ok(env.encrypted.startsWith('{'), env.encrypted.slice(0, 40))
  assert.ok(!env.encrypted.includes('themeMode'), 'ciphertext must not leak settings')
  assert.ok(!env.encrypted.includes('sk-secret'), 'ciphertext must not leak keys')
  assert.deepEqual(await decryptSyncPayload(env, TOKEN), payload)
})

test('legacy plaintext payloads still pull', async () => {
  assert.deepEqual(await decryptSyncPayload(payload, TOKEN), payload)
})

test('an envelope from another token is rejected, not silently accepted', async () => {
  const env = await encryptSyncPayload(payload, TOKEN)
  await assert.rejects(() => decryptSyncPayload(env, TOKEN.replace(/Q{5}$/, 'RRRRR')))
})

test('oversized payloads are refused before upload', async () => {
  const big = buildSyncPayload({
    storeVersion: 18,
    settings: { blob: 'x'.repeat(SYNC_PLAINTEXT_MAX_BYTES) },
    chats: [],
    workspaces: [],
    selectedRevision: null,
  })
  await assert.rejects(() => encryptSyncPayload(big, TOKEN), /too large/i)
})
