import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptSyncPayload, decryptSyncPayload, decryptSyncDelta, buildSyncPayload, SYNC_PLAINTEXT_MAX_BYTES } from './sync.ts'
import { encryptBackup } from './backupCrypto.ts'

const TOKEN = 'byok1-abcdefghijklmnop-' + 'Q'.repeat(43)
const OTHER = 'byok1-zyxwvutsrqponmlk-' + 'R'.repeat(43)
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
  assert.ok(env.encrypted.startsWith('v2.'), env.encrypted.slice(0, 40))
  assert.ok(!env.encrypted.includes('themeMode'), 'ciphertext must not leak settings')
  assert.ok(!env.encrypted.includes('sk-secret'), 'ciphertext must not leak keys')
  assert.deepEqual(await decryptSyncPayload(env, TOKEN), payload)
})

test('legacy plaintext payloads still pull', async () => {
  assert.deepEqual(await decryptSyncPayload(payload, TOKEN), payload)
})

test('an envelope from another token is rejected, not silently accepted', async () => {
  const env = await encryptSyncPayload(payload, TOKEN)
  await assert.rejects(() => decryptSyncPayload(env, OTHER))
})

test('an envelope is bound to its purpose and cannot be replayed as a delta', async () => {
  const env = await encryptSyncPayload(payload, TOKEN)
  // Same key material, different associated data: a payload cannot be passed
  // off as a delta (or a message) even by a server that swaps the fields.
  await assert.rejects(() => decryptSyncDelta(env, TOKEN))
})

test('envelopes written by older builds (PBKDF2) still decrypt', async () => {
  const legacy = await encryptBackup(JSON.stringify(payload), TOKEN)
  assert.deepEqual(await decryptSyncPayload({ encrypted: legacy }, TOKEN), payload)
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
