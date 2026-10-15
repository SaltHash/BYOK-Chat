import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSyncPush, handleSyncPull, parseToken } from './sync.mjs'
import { memStore, sha256Hex } from './syncStore.mjs'

const req = (body, query = '') => {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return { method: 'POST', url: `/api/sync/push${query}`, headers: {}, [Symbol.asyncIterator]: async function* () { yield text } }
}
const getReq = (token) => ({ method: 'GET', url: `/api/sync/pull?token=${encodeURIComponent(token)}`, headers: {} })

test('token parsing accepts generated shape and rejects junk', () => {
  assert.throws(() => parseToken('nope'), /Invalid sync token/)
  assert.throws(() => parseToken('byok1-short-x'), /Invalid sync token/)
})

test('push then pull round-trips with auth, wrong secret rejected', async () => {
  const backend = memStore()
  const id = 'abcdefghijklmnop'.slice(0, 16)
  const secret = 's'.repeat(43)
  const token = `byok1-${id}-${secret}`
  const payload = { v: 4, storeVersion: 18, settings: { themeMode: 'dark' }, chats: [], workspaces: {}, selectedRevision: {} }
  const pushed = await handleSyncPush(req({ token, payload }), backend)
  assert.equal(pushed.ok, true)
  const stored = await backend.get(id)
  assert.equal(stored.secretHash, sha256Hex(secret))
  assert.notEqual(stored.secretHash, secret)
  const pulled = await handleSyncPull(getReq(token), backend)
  assert.deepEqual(pulled.payload.settings, { themeMode: 'dark' })
  await assert.rejects(() => handleSyncPull(getReq(`byok1-${id}-${'x'.repeat(43)}`), backend), /Unknown or incorrect/)
})

test('payload size limit enforced', async () => {
  const backend = memStore()
  const big = 'y'.repeat(9_000_000)
  await assert.rejects(() => handleSyncPush(req({ token: `byok1-${'a'.repeat(16)}-${'b'.repeat(43)}`, payload: { big } }), backend), /too large/)
})
