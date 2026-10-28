import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDeltaToBaseline,
  applySyncDelta,
  baselineFromData,
  computeSyncDelta,
  emptyBaseline,
  hashValue,
} from './syncDelta.ts'

const msg = (id, t, at = 1, extra = {}) => ({ id, r: 'user', t, at, ...extra })
const chat = (id, title, msgs) => ({ id, title, msgs })
const empty = () => ({ settings: {}, chats: [], workspaces: {}, selectedRevision: {} })
const token = 'abcdefghijklmnop'

test('hashes ignore object key order and detect real changes', () => {
  assert.equal(hashValue({ a: 1, b: { c: 2, d: 3 } }), hashValue({ b: { d: 3, c: 2 }, a: 1 }))
  assert.notEqual(hashValue({ a: 1 }), hashValue({ a: 2 }))
  assert.notEqual(hashValue([1, 2]), hashValue([2, 1]))
})

test('an unchanged save produces no delta at all', () => {
  const data = {
    settings: { themeMode: 'dark', chat: 'c1' },
    chats: [chat('c1', 'A', [msg('m1', 'hi')])],
    workspaces: { w1: { id: 'w1', name: 'W', revisions: [{ id: 'r1', createdAt: 1, files: [] }] } },
    selectedRevision: { w1: 'r1' },
  }
  assert.equal(computeSyncDelta(baselineFromData(data, token, 3), data), null)
})

test('a settings edit sends only that key, not chats or workspaces', () => {
  const data = {
    settings: { themeMode: 'dark', chat: 'c1', pads: 'kept' },
    chats: [chat('c1', 'A', [msg('m1', 'hi')])],
    workspaces: {},
    selectedRevision: {},
  }
  const base = baselineFromData(data, token, 1)
  const next = { ...data, settings: { ...data.settings, themeMode: 'light' } }
  const delta = computeSyncDelta(base, next)
  assert.deepEqual(delta.settings, { set: { themeMode: 'light' } })
  assert.equal(delta.chats, undefined)
  assert.equal(delta.workspaces, undefined)
  assert.equal(delta.selectedRevision, undefined)
})

test('a new chat and its messages are created once, even if the delta is replayed', () => {
  const data = {
    settings: { chat: 'c1' },
    chats: [chat('c1', 'A', [msg('m1', 'hi'), msg('m2', 'there', 2)])],
    workspaces: {},
    selectedRevision: {},
  }
  const delta = computeSyncDelta(emptyBaseline(token), data)
  const op = delta.chats.ops[0]
  assert.equal(op.id, 'c1')
  assert.deepEqual(op.meta, { id: 'c1', title: 'A' })
  assert.deepEqual(op.add.map((m) => m.id), ['m1', 'm2'])

  const once = applySyncDelta(empty(), delta)
  const twice = applySyncDelta(once, delta)
  assert.equal(once.chats.length, 1)
  assert.equal(twice.chats.length, 1)
  assert.deepEqual(twice.chats[0].msgs.map((m) => m.id), ['m1', 'm2'])
})

test('a new message sends one message rather than the whole chat', () => {
  const before = {
    settings: { chat: 'c1' },
    chats: [chat('c1', 'A', Array.from({ length: 50 }, (_, i) => msg(`m${i}`, 'x'.repeat(500), i)))],
    workspaces: {},
    selectedRevision: {},
  }
  const after = {
    ...before,
    chats: [chat('c1', 'A', [...before.chats[0].msgs, msg('new', 'only this one', 99)])],
  }
  const delta = computeSyncDelta(baselineFromData(before, token, 1), after)
  const op = delta.chats.ops[0]
  assert.equal(op.meta, undefined)
  assert.equal(op.update, undefined)
  assert.deepEqual(op.add.map((m) => m.id), ['new'])
  assert.ok(JSON.stringify(delta).length < 600, `delta should be tiny, was ${JSON.stringify(delta).length} bytes`)

  const applied = applySyncDelta(before, delta)
  assert.equal(applied.chats[0].msgs.length, 51)
  assert.equal(applied.chats[0].msgs[50].id, 'new')
})

test('editing and deleting a message sends only that message id', () => {
  const before = {
    settings: {},
    chats: [chat('c1', 'A', [msg('m1', 'one'), msg('m2', 'two')])],
    workspaces: {},
    selectedRevision: {},
  }
  const base = baselineFromData(before, token, 1)
  const edited = {
    ...before,
    chats: [chat('c1', 'A', [msg('m1', 'one'), msg('m2', 'TWO EDITED')])],
  }
  const edit = computeSyncDelta(base, edited)
  assert.deepEqual(edit.chats.ops[0].update.map((m) => m.id), ['m2'])
  assert.equal(edit.chats.ops[0].add, undefined)
  assert.equal(applySyncDelta(before, edit).chats[0].msgs[1].t, 'TWO EDITED')

  const deleted = { ...before, chats: [chat('c1', 'A', [msg('m1', 'one')])] }
  const del = computeSyncDelta(base, deleted)
  assert.deepEqual(del.chats.ops[0].del, ['m2'])
  assert.deepEqual(applySyncDelta(before, del).chats[0].msgs.map((m) => m.id), ['m1'])
})

test('metadata changes send the chat without its message bodies', () => {
  const before = { settings: {}, chats: [chat('c1', 'Old title', [msg('m1', 'hi')])], workspaces: {}, selectedRevision: {} }
  const after = { ...before, chats: [chat('c1', 'New title', [msg('m1', 'hi')])] }
  const delta = computeSyncDelta(baselineFromData(before, token, 1), after)
  const op = delta.chats.ops[0]
  assert.deepEqual(op.meta, { id: 'c1', title: 'New title' })
  assert.equal(op.add, undefined)
  assert.equal(op.update, undefined)
  assert.equal(applySyncDelta(before, delta).chats[0].title, 'New title')
})

test('a chat delete is a tombstone and does not erase newer local work', () => {
  const old = { settings: {}, chats: [chat('c1', 'A', [msg('m1', 'hi', 10)])], workspaces: {}, selectedRevision: {} }
  const fresher = { ...old, chats: [chat('c1', 'A', [msg('m1', 'hi', 10), msg('m2', 'newer', 99)])] }
  const delta = { v: 1, at: 50, chats: { del: ['c1'] } }
  assert.equal(applySyncDelta(old, delta).chats.length, 0)
  assert.equal(applySyncDelta(fresher, delta).chats.length, 1)
})

test('workspaces merge revisions and delete only when the local copy is not newer', () => {
  const before = {
    settings: {},
    chats: [],
    workspaces: { w1: { id: 'w1', name: 'W', revisions: [{ id: 'r1', createdAt: 10, files: [] }] } },
    selectedRevision: { w1: 'r1' },
  }
  const after = {
    ...before,
    workspaces: { w1: { id: 'w1', name: 'W', revisions: [{ id: 'r2', createdAt: 20, files: [{ path: 'a', content: 'b' }] }] } },
  }
  const delta = computeSyncDelta(baselineFromData(before, token, 1), after)
  assert.deepEqual(Object.keys(delta.workspaces.upsert), ['w1'])
  const applied = applySyncDelta(before, delta)
  assert.deepEqual(applied.workspaces.w1.revisions.map((r) => r.id), ['r1', 'r2'])
  assert.equal(applied.selectedRevision.w1, 'r1')

  // A rename arrives as newer metadata and must survive the revision union.
  const renamed = { ...after, workspaces: { w1: { ...after.workspaces.w1, name: 'Renamed' } } }
  const rename = computeSyncDelta(baselineFromData(after, token, 2), renamed)
  assert.equal(applySyncDelta(applied, rename).workspaces.w1.name, 'Renamed')

  // A deletion made after the newest local revision wins; an older one is
  // ignored so unsynced work is never silently lost.
  assert.equal(applySyncDelta(before, { v: 1, at: 5, workspaces: { del: ['w1'] } }).workspaces.w1.id, 'w1')
  assert.equal(applySyncDelta(before, { v: 1, at: 30, workspaces: { del: ['w1'] } }).workspaces.w1, undefined)
})

test('selected revisions update and invalid pointers are dropped', () => {
  const base = {
    settings: {},
    chats: [],
    workspaces: { w1: { id: 'w1', name: 'W', revisions: [{ id: 'r1', createdAt: 1, files: [] }, { id: 'r2', createdAt: 2, files: [] }] } },
    selectedRevision: { w1: 'r1' },
  }
  const applied = applySyncDelta(base, { v: 1, at: 3, selectedRevision: { set: { w1: 'r2' } } })
  assert.equal(applied.selectedRevision.w1, 'r2')
  const bad = applySyncDelta(base, { v: 1, at: 3, selectedRevision: { set: { w1: 'gone' } } })
  assert.equal(bad.selectedRevision.w1, undefined)
  const cleared = applySyncDelta(base, { v: 1, at: 3, selectedRevision: { del: ['w1'] } })
  assert.equal(cleared.selectedRevision.w1, undefined)
})

test('messages without stable ids fall back to sending the whole chat', () => {
  const chatObj = { id: 'c1', title: 'A', msgs: [{ r: 'user', t: 'no id' }] }
  const before = { settings: {}, chats: [chatObj], workspaces: {}, selectedRevision: {} }
  const after = { ...before, chats: [{ ...chatObj, title: 'B' }] }
  const delta = computeSyncDelta(baselineFromData(before, token, 1), after)
  assert.equal(delta.chats.ops[0].full.title, 'B')
  assert.equal(applySyncDelta(before, delta).chats[0].title, 'B')
})

test('project deltas rename in place and keep local-only projects', () => {
  const local = {
    settings: { projects: [{ id: 'a', name: 'A' }] },
    chats: [],
    workspaces: {},
    selectedRevision: {},
  }
  const delta = { v: 1, at: 1, settings: { set: { projects: [{ id: 'a', name: 'Renamed' }, { id: 'b', name: 'B' }] } } }
  const out = applySyncDelta(local, delta)
  assert.deepEqual(out.settings.projects, [{ id: 'a', name: 'Renamed' }, { id: 'b', name: 'B' }])
  assert.deepEqual(out.settings.folders, out.settings.projects)
})

test('a first delta reconstructs every part of the save', () => {
  // The open-chat pointer is device-local and never travels, so it is not part
  // of the save a delta rebuilds.
  const data = {
    settings: {
      themeMode: 'dark',
      prefs: { showBy: true },
      eps: [{ id: 'e1', name: 'E' }],
      keys: { send: 'Mod+Enter' },
      snips: ['one', 'two'],
    },
    chats: [
      chat('c1', 'A', [msg('m1', 'hi', 1), msg('m2', 'there', 2)]),
      chat('c2', 'B', [msg('m3', 'x', 3)]),
    ],
    workspaces: {
      w1: { id: 'w1', name: 'W', revisions: [{ id: 'r1', createdAt: 1, files: [{ path: 'a.js', content: 'export const a = 1' }] }] },
    },
    selectedRevision: { w1: 'r1' },
  }
  const delta = computeSyncDelta(emptyBaseline(token), data)
  const rebuilt = applySyncDelta(empty(), delta)
  assert.deepEqual(rebuilt, data)
})

test('a legacy delta cannot hand this device the sender\'s open chat', () => {
  const local = { settings: { themeMode: 'light' }, chats: [chat('c1', 'A', [msg('m1', 'hi')])], workspaces: {}, selectedRevision: {} }
  const applied = applySyncDelta(local, { v: 1, at: 5, settings: { set: { chat: 'c1' } } })
  assert.equal('chat' in applied.settings, false)
})

test('advancing the baseline with a delta makes the same change a no-op', () => {
  const data = {
    settings: { themeMode: 'dark', chat: 'c1' },
    chats: [chat('c1', 'A', [msg('m1', 'hi'), msg('m2', 'there', 2)])],
    workspaces: {},
    selectedRevision: {},
  }
  const base = baselineFromData(data, token, 1)
  const next = {
    ...data,
    settings: { ...data.settings, themeMode: 'light' },
    chats: [chat('c1', 'A', [msg('m1', 'hi'), msg('m2', 'there edited', 2), msg('m3', 'new', 3)])],
  }
  const delta = computeSyncDelta(base, next)
  const applied = applySyncDelta(data, delta)
  const advanced = { ...applyDeltaToBaseline(base, delta), seq: 2 }
  assert.equal(computeSyncDelta(advanced, applied), null)
})

test('a pulled change never moves the open chat or switches the search provider', () => {
  const local = {
    ...empty(),
    settings: {
      chat: '',
      search: { provider: 'exa', keys: { exa: 'local-secret' }, readerKey: '' },
    },
    chats: [chat('c1', 'A', [msg('m1', 'hi')]), chat('c2', 'B', [msg('m2', 'yo', 2)])],
  }
  // A peer still syncing its view pointer and its credential-blanked search.
  const delta = {
    v: 1,
    at: 9,
    settings: { set: { chat: 'c2', search: { provider: 'tinyfish', keys: {}, readerKey: '' } } },
  }
  const applied = applySyncDelta(local, delta)
  assert.equal(applied.settings.chat, '', 'the new chat stays open')
  assert.equal(applied.settings.search.provider, 'exa')
  assert.equal(applied.settings.search.keys.exa, 'local-secret')
})

test('a dead open-chat pointer is still repaired after a delete', () => {
  const local = { ...empty(), settings: { chat: 'gone' }, chats: [chat('c1', 'A', [msg('m1', 'hi')])] }
  assert.equal(applySyncDelta(local, { v: 1, at: 4, settings: { set: { themeMode: 'dark' } } }).settings.chat, 'c1')
})

test('a delta only collapses a chat duplicate it actually introduces', () => {
  const twins = () => [chat('a', 'Same', [msg('x1', 'hi')]), chat('b', 'Same', [msg('x1', 'hi')])]
  const local = { ...empty(), chats: twins() }
  // An unrelated change must never delete a chat it did not mention, even when
  // two local chats look identical.
  const unrelated = applySyncDelta(local, { v: 1, at: 5, settings: { set: { themeMode: 'dark' } } })
  assert.equal(unrelated.chats.length, 2)
  // The other device created a twin for one of them: that newcomer is dropped.
  const delta = { v: 1, at: 6, chats: { ops: [{ id: 'c', meta: { title: 'Same' }, add: [msg('x1', 'hi')] }] } }
  const applied = applySyncDelta(local, delta)
  assert.deepEqual(applied.chats.map((c) => c.id), ['a', 'b'])
  // Replaying the same delta is idempotent.
  assert.deepEqual(applySyncDelta(applied, delta).chats.map((c) => c.id), ['a', 'b'])
})
