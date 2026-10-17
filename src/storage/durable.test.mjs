import test from 'node:test'
import assert from 'node:assert/strict'

const { splitPersistedForDurable, joinPersistedForSync, compactChatsForDurable, blobPut, blobGet } = await import('./durable.ts')
const sync = await import('./sync.ts')

test('split/join round-trips settings vs durable payloads', () => {
  const { settings, chats, workspaces, selectedRevision } = splitPersistedForDurable({ eps: [], chats: [{ id: 'c' }], workspaces: { w: 1 }, selectedRevision: { w: 'r' }, themeMode: 'dark' })
  assert.deepEqual(chats, [{ id: 'c' }])
  assert.equal(settings.themeMode, 'dark')
  assert.ok(!('chats' in settings))
  const joined = joinPersistedForSync(settings, chats, workspaces, selectedRevision)
  assert.deepEqual(joined.chats, [{ id: 'c' }])
})

test('compact drops expired temp chats and old reasoning', () => {
  const chats = [
    { id: 'a', temporary: true, expiresAt: Date.now() - 1000, msgs: [{ id: 'm', r: 'user', reasoning: 'x' }] },
    { id: 'b', msgs: [{ id: 'm1', r: 'assistant', reasoning: 'old' }, { id: 'm2', r: 'assistant', reasoning: 'keep' }] },
  ]
  const { chats: out, droppedChats } = compactChatsForDurable(chats)
  assert.equal(droppedChats, 1)
  assert.equal(out.length, 1)
  assert.equal(out[0].msgs[1].reasoning, 'keep')
  assert.equal(out[0].msgs[0].reasoning, undefined)
})

test('blob memory fallback stores and retrieves', async () => {
  await blobPut('test-id', 'hello-blob')
  assert.equal(await blobGet('test-id'), 'hello-blob')
})

test('sync tokens generate/parse and reject junk', () => {
  const t = sync.generateSyncToken()
  assert.match(t, /^byok1-/)
  const p = sync.parseSyncToken(t)
  assert.ok(p.id.length >= 16 && p.secret.length >= 43)
  assert.throws(() => sync.parseSyncToken('junk'), /invalid/)
})

test('sync compat flags newer/older/corrupt payloads', () => {
  assert.equal(sync.checkSyncCompat({ v: 4, storeVersion: 18 }, 18).ok, true)
  assert.match(sync.checkSyncCompat({ v: 4, storeVersion: 99 }, 18).warning, /newer/)
  assert.equal(sync.checkSyncCompat({ v: 99, storeVersion: 18 }, 18).ok, false)
  assert.equal(sync.checkSyncCompat({}, 18).ok, false)
})
