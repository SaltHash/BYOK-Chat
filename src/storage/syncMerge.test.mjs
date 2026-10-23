import test from 'node:test'
import assert from 'node:assert/strict'
import { maskSyncToken } from './sync.ts'
import { mergeSyncData } from './syncMerge.ts'

const TOKEN = 'byok1-abcdefghijklmnop-' + 'Q'.repeat(43)

test('the token mask keeps the prefix and last three characters only', () => {
  const masked = maskSyncToken(TOKEN)
  assert.equal(masked.slice(0, 9), 'byok1-abc')
  assert.equal(masked.slice(-3), TOKEN.slice(-3))
  assert.equal(masked.slice(9, -3), '*'.repeat(TOKEN.length - 12))
  assert.ok(!masked.includes('defghijklmnop'))
  assert.ok(!masked.includes('Q'.repeat(10)))
})

test('a malformed or short token is returned untouched', () => {
  assert.equal(maskSyncToken('nodash'), 'nodash')
  assert.equal(maskSyncToken('byok1-ab'), 'byok1-ab')
})

const chat = (id, at, project, msgs = 1) => ({
  id, title: `chat ${id}`, project,
  msgs: Array.from({ length: msgs }, (_, i) => ({ id: `${id}-m${i}`, r: 'user', t: 'hi', at })),
})
const empty = (local = {}) => ({ settings: {}, chats: [], workspaces: {}, selectedRevision: {}, ...local })

test('chats union by id and the richer copy wins', () => {
  const local = empty({ chats: [chat('a', 100), chat('b', 100)] })
  const remote = empty({ chats: [chat('a', 200, undefined, 3), chat('c', 100)] })
  const out = mergeSyncData(local, remote)
  assert.deepEqual(out.chats.map((c) => c.id), ['a', 'b', 'c'])
  assert.equal(out.chats[0].msgs.length, 3)
})

test('identical chats under different ids collapse, empty chats never do', () => {
  const twin = { ...chat('remote-id', 100), title: 'Same talk', msgs: [{ id: 'm1', r: 'user', t: 'hi', at: 100 }] }
  const orig = { ...chat('local-id', 100), title: 'Same talk', msgs: [{ id: 'm1', r: 'user', t: 'hi', at: 100 }] }
  const out = mergeSyncData(empty({ chats: [orig] }), empty({ chats: [twin] }))
  assert.equal(out.chats.length, 1)
  const empties = mergeSyncData(empty({ chats: [{ id: 'x', title: 'New chat', msgs: [] }] }), empty({ chats: [{ id: 'y', title: 'New chat', msgs: [] }] }))
  assert.equal(empties.chats.length, 2)
})

test('same-named projects merge and their chats are repointed at one project', () => {
  const local = empty({
    settings: { projects: [{ id: 'lf', name: 'Work', open: false }] },
    chats: [chat('a', 100, 'lf')],
  })
  const remote = empty({
    settings: { projects: [{ id: 'rf', name: 'work', open: true }] },
    chats: [chat('b', 100, 'rf')],
  })
  const out = mergeSyncData(local, remote)
  const projects = out.settings.projects
  assert.equal(projects.length, 1)
  assert.equal(projects[0].id, 'lf')
  assert.equal(projects[0].open, true)
  for (const c of out.chats) assert.equal(c.project, 'lf')
  // Legacy alias stays in lockstep for older clients.
  assert.equal(out.settings.folders, projects)
})

test('legacy folder payloads merge through the project path', () => {
  const local = empty({ settings: { folders: [{ id: 'lf', name: 'Work', open: false }] }, chats: [chat('a', 100, 'lf')] })
  const remote = empty({ settings: { projects: [{ id: 'rf', name: 'work', open: true }] }, chats: [chat('b', 100, 'rf')] })
  const out = mergeSyncData(local, remote)
  assert.equal(out.settings.projects.length, 1)
  assert.equal(out.settings.projects[0].id, 'lf')
  for (const c of out.chats) assert.equal(c.project, 'lf')
})

test('id-keyed collections, maps and strings union without losing either side', () => {
  const local = empty({ settings: { eps: [{ id: 'e1', key: 'k1' }], keys: { a: '1' }, snips: ['one'] } })
  const remote = empty({ settings: { eps: [{ id: 'e2' }], keys: { b: '2' }, snips: ['one', 'two'] } })
  const out = mergeSyncData(local, remote)
  assert.deepEqual(out.settings.eps.map((e) => e.id), ['e1', 'e2'])
  assert.deepEqual(out.settings.keys, { a: '1', b: '2' })
  assert.deepEqual(out.settings.snips, ['one', 'two'])
})

test('workspaces union by id and their revisions union by id in time order', () => {
  const local = empty({ workspaces: { w: { id: 'w', name: 'W', revisions: [{ id: 'r2', createdAt: 2, files: [] }] } } })
  const remote = empty({ workspaces: { w: { id: 'w', name: 'W', revisions: [{ id: 'r1', createdAt: 1, files: [] }] }, x: { id: 'x', name: 'X', revisions: [] } } })
  const out = mergeSyncData(local, remote)
  assert.deepEqual(out.workspaces.w.revisions.map((r) => r.id), ['r1', 'r2'])
  assert.ok(out.workspaces.x)
})

test('remote and local modes take one side while merge keeps both', () => {
  const local = empty({ chats: [chat('a', 1)], settings: { projects: [] } })
  const remote = empty({ chats: [chat('b', 1)], settings: { projects: [] } })
  assert.deepEqual(mergeSyncData(local, remote, 'remote').chats.map((c) => c.id), ['b'])
  assert.deepEqual(mergeSyncData(local, remote, 'local').chats.map((c) => c.id), ['a'])
  assert.deepEqual(mergeSyncData(local, remote).chats.map((c) => c.id), ['a', 'b'])
})

test('memories de-duplicate by text across different ids', () => {
  const local = empty({ settings: { memories: [{ id: 'm1', text: 'Likes tea', updatedAt: 1 }] } })
  const remote = empty({ settings: { memories: [{ id: 'm2', text: 'likes tea ', updatedAt: 2 }, { id: 'm3', text: 'Speaks French', updatedAt: 2 }] } })
  const out = mergeSyncData(local, remote)
  assert.deepEqual(out.settings.memories.map((m) => m.text), ['Likes tea', 'Speaks French'])
})

test('the open-chat pointer is repaired when the chat is gone', () => {
  const local = empty({ chats: [chat('a', 1)], settings: { chat: 'a' } })
  const remote = empty({ chats: [], settings: { chat: 'gone' } })
  const out = mergeSyncData(local, remote)
  assert.equal(out.settings.chat, 'a')
})

test('the local open chat survives the merge even when the remote had a different one open', () => {
  // The app opened to a freshly-created temporary chat; a sync pull arrives
  // moments later. The view must stay on the local chat, not jump to the
  // remote's open chat.
  const local = empty({ chats: [{ id: 'tmp', title: 'Temporary chat', temporary: true, expiresAt: Date.now() + 3600000, msgs: [] }], settings: { chat: 'tmp' } })
  const remote = empty({ chats: [chat('perm', 100)], settings: { chat: 'perm' } })
  const out = mergeSyncData(local, remote)
  assert.equal(out.settings.chat, 'tmp')
  assert.deepEqual(out.chats.map((c) => c.id), ['tmp', 'perm'])
})
