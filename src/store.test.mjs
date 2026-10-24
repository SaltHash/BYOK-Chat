import test from 'node:test'
import assert from 'node:assert/strict'
import { useS } from './store.ts'

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
