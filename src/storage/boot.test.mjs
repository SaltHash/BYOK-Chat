import test from 'node:test'
import assert from 'node:assert/strict'
import { hydrateDurable, blobIdFor } from './boot.ts'
import { durableEraseAll, durableGetChats, durablePutChats, durableSetMeta, blobPut } from './durable.ts'
import { planPersistShards, QUOTA_FLAG } from '../persistence.ts'

const originalStorage = globalThis.localStorage
const memoryStorage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), key: index => [...values.keys()][index] ?? null, get length() { return values.size } }
}
const chat = (id, messages = 1) => ({ id, title: id, msgs: Array.from({ length: messages }, (_, i) => ({ id: `${id}-${i}`, r: 'user', t: `${id} ${i}` })) })
const putSharded = chats => {
  const plan = planPersistShards(JSON.stringify({ version: 22, state: { chats, workspaces: {}, chat: chats[0]?.id ?? '' } }), new Map())
  localStorage.setItem('byok.v1', plan.main)
  for (const write of plan.writes) localStorage.setItem(write.key, write.value)
}

test('durable hydration reconciles sharded storage without resurrecting deleted chats', async () => {
  globalThis.localStorage = memoryStorage()
  try {
    await durableEraseAll()
    const local = [chat('kept')]
    putSharded(local)
    await durablePutChats([chat('kept'), chat('deleted', 3)])
    // Missing migration metadata must not overwrite the existing mirror.
    let patch = {}
    await hydrateDurable(p => { patch = p })
    assert.equal(patch.chats, undefined)
    assert.deepEqual((await durableGetChats()).map(c => c.id), ['kept', 'deleted'])

    // Quota recovery must not restore a chat absent from the local index.
    localStorage.setItem(QUOTA_FLAG, '1')
    patch = {}
    await hydrateDurable(p => { patch = p })
    assert.deepEqual(patch.chats.map(c => c.id), ['kept'])
  } finally { await durableEraseAll(); globalThis.localStorage = originalStorage }
})

test('quota recovery retains newer local chats while restoring richer matching chats', async () => {
  globalThis.localStorage = memoryStorage()
  try {
    await durableEraseAll()
    putSharded([chat('kept'), chat('new-local', 2)])
    await durablePutChats([chat('kept', 4), chat('deleted', 5)])
    await durableSetMeta({ migratedAt: 1 })
    localStorage.setItem(QUOTA_FLAG, '1')
    let patch = {}
    await hydrateDurable(p => { patch = { ...patch, ...p } })
    assert.deepEqual(patch.chats.map(c => c.id), ['kept', 'new-local'])
    assert.equal(patch.chats[0].msgs.length, 4)
  } finally { await durableEraseAll(); globalThis.localStorage = originalStorage }
})

test('missing local shards recover only indexed chats, not deleted durable chats', async () => {
  globalThis.localStorage = memoryStorage()
  try {
    await durableEraseAll()
    putSharded([chat('kept'), chat('missing')])
    localStorage.removeItem('byok.v1:chat:missing')
    await durablePutChats([chat('kept'), chat('missing'), chat('deleted')])
    await durableSetMeta({ migratedAt: 1 })
    let patch = {}
    await hydrateDurable(p => { patch = { ...patch, ...p } })
    assert.deepEqual(patch.chats.map(c => c.id), ['kept', 'missing'])
  } finally { await durableEraseAll(); globalThis.localStorage = originalStorage }
})

test('missing local shards block boot when no durable copy exists', async () => {
  globalThis.localStorage = memoryStorage()
  try {
    await durableEraseAll()
    putSharded([chat('missing')])
    localStorage.removeItem('byok.v1:chat:missing')
    await durableSetMeta({ migratedAt: 1 })
    await assert.rejects(hydrateDurable(() => {}), /missing/)
  } finally { await durableEraseAll(); globalThis.localStorage = originalStorage }
})

test('corrupt local snapshots stop recovery without replacing durable history', async () => {
  globalThis.localStorage = memoryStorage()
  try {
    await durableEraseAll()
    await durablePutChats([chat('recover')])
    for (const raw of ['{broken', 'null', '{"state":null}', '{"state":{"__byokSharded":true,"__byokChatIds":"bad"}}']) {
      localStorage.setItem('byok.v1', raw)
      await assert.rejects(hydrateDurable(() => assert.fail('must not patch')))
      assert.deepEqual((await durableGetChats()).map(c => c.id), ['recover'])
      assert.equal(localStorage.getItem('byok.v1'), raw)
    }
  } finally { await durableEraseAll(); globalThis.localStorage = originalStorage }
})

test('blocked local storage does not look like a fresh install', async () => {
  globalThis.localStorage = { getItem() { throw Error('permission denied') } }
  try {
    await assert.rejects(hydrateDurable(() => assert.fail('must not patch')), /permission denied/)
  } finally { globalThis.localStorage = originalStorage }
})

test('a missing local snapshot falls back to durable chats', async () => {
  globalThis.localStorage = memoryStorage()
  try {
    await durableEraseAll()
    await durablePutChats([chat('recover')])
    await durableSetMeta({ migratedAt: 1 })
    let patch = {}
    await hydrateDurable(p => { patch = p })
    assert.deepEqual(patch.chats.map(c => c.id), ['recover'])
  } finally { await durableEraseAll(); globalThis.localStorage = originalStorage }
})

test('first migration reads chat shards and restores attachment bytes onto local chats', async () => {
  globalThis.localStorage = memoryStorage()
  try {
    await durableEraseAll()
    const c = chat('first')
    c.msgs[0].att = [{ name: 'notes.txt', kind: 'txt', size: '2 B' }]
    putSharded([c])
    await blobPut(blobIdFor(c.msgs[0].id, 0, 'notes.txt'), 'attachment content')
    let patch = {}
    const result = await hydrateDurable(p => { patch = p })
    assert.equal(result.migrated, true)
    assert.equal(patch.chats[0].msgs[0].att[0].text, 'attachment content')
    assert.equal((await durableGetChats())[0].id, 'first')
    await durableSetMeta({ migratedAt: 1 })
  } finally { await durableEraseAll(); globalThis.localStorage = originalStorage }
})
