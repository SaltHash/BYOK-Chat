import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PREFS, useS } from './store.ts'

const mk = (id) => ({ id, title: id, msgs: [] })
const seed = () => useS.setState({ chats: [mk('a'), mk('b')], chat: 'a', draft: '', drafts: {} })

/* A half-typed message belongs to the chat it was typed in: switching chats
 * must stash it, restore the other chat's draft, and never blend the two. */
test('drafts are remembered per chat and never leak across chats', () => {
  const s = () => useS.getState()
  seed()
  s().patch({ draft: 'half-typed a' })
  assert.equal(s().drafts.a, 'half-typed a')
  s().patch({ chat: 'b' })
  assert.equal(s().draft, '')
  s().patch({ draft: 'b draft' })
  s().patch({ chat: 'a' })
  assert.equal(s().draft, 'half-typed a')
  s().patch({ chat: 'b' })
  assert.equal(s().draft, 'b draft')
})

/* "Never" must not keep a draft anywhere: the in-memory stash is dropped too,
 * so a chat switch cannot resurrect text typed in a previous chat (a reload
 * used to be the only thing that cleared it). */
test('keeping no drafts also drops the in-memory stash on chat switches', () => {
  const s = () => useS.getState()
  seed()
  s().patch({ prefs: { ...s().prefs, draftSurvive: 'off' } })
  s().patch({ draft: 'temp text' })
  assert.equal(s().drafts.a ?? '', '')
  s().patch({ chat: 'b' })
  assert.equal(s().draft, '')
  s().patch({ chat: 'a' })
  assert.equal(s().draft, '')
  // Turning it back on stages the draft that is currently being typed.
  s().patch({ draft: 'typed now' })
  s().patch({ prefs: { ...s().prefs, draftSurvive: 'both' } })
  assert.equal(s().draft, 'typed now')
  assert.equal(s().drafts.a, undefined)
})

test('the draft of a deleted chat is dropped with it', () => {
  const s = () => useS.getState()
  seed()
  s().patch({ draft: 'doomed' })
  s().chatOp('a', 'del')
  assert.equal(s().chat, 'b')
  assert.equal(s().drafts.a, undefined)
  assert.equal(s().draft, '')
})

/* Project workspace sharing: a chat with no workspace of its own picks up the
 * latest workspace from the project's other chats when sharing is on, and
 * stays untouched when it is off. Projects never read each other's work. */
test('project workspace sharing resolves across chats and can be turned off', async () => {
  const { activeWorkspaceForChat } = await import('./store.ts')
  const base = {
    chats: [
      { id: 'a', title: 'A', project: 'p1', msgs: [] },
      { id: 'b', title: 'B', project: 'p1', msgs: [{ id: 'm1', r: 'assistant', t: 'x', workspaceIds: ['ws1'] }] },
      { id: 'c', title: 'C', project: 'p2', msgs: [{ id: 'm2', r: 'assistant', t: 'x', workspaceIds: ['ws2'] }] },
    ],
    projects: [{ id: 'p1', name: 'One', open: true }, { id: 'p2', name: 'Two', open: true }],
  }
  // No workspace in chat a yet, sharing on by default -> the project's other chat lends its workspace.
  assert.deepEqual({ id: activeWorkspaceForChat(base, 'a').id, shared: activeWorkspaceForChat(base, 'a').shared }, { id: 'ws1', shared: true })
  // Sharing off falls back to nothing.
  const off = { ...base, projects: [{ id: 'p1', name: 'One', open: true, shareWorkspaces: false }, base.projects[1]] }
  assert.deepEqual(activeWorkspaceForChat(off, 'a'), {})
  // A chat with its own workspace never borrows.
  const own = { ...base, chats: [...base.chats, { id: 'd', title: 'D', project: 'p1', msgs: [{ id: 'm3', r: 'assistant', t: 'x', workspaceIds: ['ws9'] }] }] }
  assert.deepEqual(activeWorkspaceForChat(own, 'd'), { id: 'ws9' })
  // Workspaces stay separate between projects.
  assert.notEqual(activeWorkspaceForChat(base, 'c').id, 'ws1')
})

/* Retrying a failed reply is deliberately narrow: it resends the request
 * behind a trailing failure and never rewrites history that follows it. */
test('retrying refuses to touch a failure older than the last message', () => {
  const s = () => useS.getState()
  const msgs = [
    { id: 'u1', r: 'user', t: 'hi' },
    { id: 'e1', r: 'assistant', t: 'boom', err: true },
    { id: 'u2', r: 'user', t: 'again' },
  ]
  useS.setState({ chats: [{ id: 'a', title: 'A', msgs }], chat: 'a', busy: false, notice: null })
  s().retryMsg('e1')
  assert.match(s().notice?.t ?? '', /most recent reply/)
  assert.deepEqual(s().chats[0].msgs.map((m) => m.id), ['u1', 'e1', 'u2'])
})

test('retrying a reply that did not fail is a no-op', () => {
  const s = () => useS.getState()
  const msgs = [
    { id: 'u1', r: 'user', t: 'hi' },
    { id: 'a1', r: 'assistant', t: 'fine' },
  ]
  useS.setState({ chats: [{ id: 'a', title: 'A', msgs }], chat: 'a', busy: false, notice: null })
  s().retryMsg('a1')
  assert.equal(s().notice, null)
  assert.deepEqual(s().chats[0].msgs.map((m) => m.id), ['u1', 'a1'])
})

test('permanent deletion can be undone with its position, draft and selection', () => {
  const s = () => useS.getState()
  useS.setState({ chats: [mk('a'), mk('b'), mk('c')], chat: 'b', drafts: {}, draft: '', notice: null, undo: null })
  s().patch({ draft: 'half-typed b' })
  s().chatOp('b', 'del')
  assert.deepEqual(s().chats.map((c) => c.id), ['a', 'c'])
  assert.equal(s().chat, 'a')
  assert.equal(s().notice?.undo, true)
  s().undoDelete()
  assert.deepEqual(s().chats.map((c) => c.id), ['a', 'b', 'c'])
  assert.equal(s().chat, 'b')
  assert.equal(s().drafts.b, 'half-typed b')
  assert.equal(s().draft, 'half-typed b')
  assert.equal(s().notice, null)
  assert.equal(s().undo, null)
})

test('a second permanent delete closes the previous undo window', () => {
  const s = () => useS.getState()
  useS.setState({ chats: [mk('a'), mk('b')], chat: 'a', drafts: {}, draft: '', notice: null, undo: null })
  s().chatOp('a', 'del')
  s().chatOp('b', 'del')
  s().undoDelete()
  assert.deepEqual(s().chats.map((c) => c.id), ['b'])
  assert.equal(s().chat, 'b')
})

/* Revert-send loads a message back into the composer. Arming alone never
 * touches the transcript, and cancelling restores the draft and every message. */
test('revert send arms the composer and cancel restores the thread', async () => {
  const s = () => useS.getState()
  useS.setState({
    chats: [{ id: 'a', title: 'A', msgs: [
      { id: 'u1', r: 'user', t: 'first' },
      { id: 'a1', r: 'assistant', t: 'reply' },
      { id: 'u2', r: 'user', t: 'second' },
    ] }],
    chat: 'a', draft: '', drafts: {}, busy: false, busyChats: {}, notice: null, revert: null, eps: [],
  })
  s().patch({ draft: 'unsent' })
  assert.equal(s().armRevert('u1'), true)
  assert.equal(s().draft, 'first')
  assert.equal(s().revert?.mid, 'u1')
  assert.equal(s().chats[0].msgs.length, 3, 'arming does not delete anything')
  // A refused send must not drop the messages either.
  assert.equal(await s().send('first', []), false)
  assert.equal(s().chats[0].msgs.length, 3)
  assert.equal(s().revert?.mid, 'u1')
  s().cancelRevert()
  assert.equal(s().draft, 'unsent')
  assert.equal(s().revert, null)
  assert.equal(s().chats[0].msgs.length, 3)
})

test('switching chats disarms a revert without touching the transcript', () => {
  const s = () => useS.getState()
  useS.setState({
    chats: [
      { id: 'a', title: 'A', msgs: [{ id: 'u1', r: 'user', t: 'first' }] },
      { id: 'b', title: 'B', msgs: [] },
    ],
    chat: 'a', draft: '', drafts: {}, busy: false, busyChats: {}, notice: null, revert: null,
  })
  assert.equal(s().armRevert('u1'), true)
  s().patch({ chat: 'b' })
  assert.equal(s().revert, null)
  assert.equal(s().chats[0].msgs.length, 1)
})

/* Reply actions are opt-in only where they clutter the footer: pin, bookmark
 * and new path start hidden, while the everyday picker, copy, retry and
 * delete stay visible. */
test('reply action defaults show the everyday buttons and hide the extras', () => {
  assert.equal(DEFAULT_PREFS.showReplyPicker, true)
  assert.equal(DEFAULT_PREFS.showCopyAction, true)
  assert.equal(DEFAULT_PREFS.showRetryAction, true)
  assert.equal(DEFAULT_PREFS.showDeleteAction, true)
  assert.equal(DEFAULT_PREFS.showPinAction, false)
  assert.equal(DEFAULT_PREFS.showBookmarkAction, false)
  assert.equal(DEFAULT_PREFS.showBranchAction, false)
  assert.equal(DEFAULT_PREFS.userMarkdown, true)
})
