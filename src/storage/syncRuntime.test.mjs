import test from 'node:test'
import assert from 'node:assert/strict'
import { useS } from '../store.ts'
import { applySyncData, readLocalData, SYNC_LIVE_ONLY } from './syncRuntime.ts'

/* Sync is intentionally opt-out: every store field is configuration/content
 * and must reach the encrypted slot, except the explicit live-only list. This
 * guards against a new setting being added without also being synced. */
test('every store setting is included in the sync snapshot except live-only fields', () => {
  useS.setState({ gistToken: 'ghp_test' })
  const state = useS.getState()
  const data = readLocalData()

  assert.equal(data.settings.gistToken, 'ghp_test')

  for (const key of Object.keys(state)) {
    if (typeof state[key] === 'function') continue
    if (key === 'chats' || key === 'workspaces' || key === 'selectedRevision') continue
    if (SYNC_LIVE_ONLY.includes(key)) {
      assert.equal(key in data.settings, false, `${key} must stay device-local`)
      continue
    }
    assert.equal(key in data.settings, true, `${key} is missing from the sync snapshot`)
  }
})

test('legacy snapshots cannot replace the local open view or draft', () => {
  const chats = [{ id: 'one', title: 'One', msgs: [{ id: 'm', r: 'user', t: 'hello' }] }, { id: 'two', title: 'Two', msgs: [{ id: 'n', r: 'user', t: 'hello' }] }]
  useS.setState({ chats, chat: 'one', draft: 'local draft', newChatPending: null, activeProject: '' })
  applySyncData({ settings: { chat: 'two', draft: 'remote draft', newChatPending: 'temporary', activeProject: 'remote-project' }, chats, workspaces: {}, selectedRevision: {} })
  assert.equal(useS.getState().chat, 'one')
  assert.equal(useS.getState().draft, 'local draft')
  assert.equal(useS.getState().newChatPending, null)
  assert.equal(useS.getState().activeProject, '')
})

test('live-only runtime state never rides a sync snapshot', () => {
  useS.setState({
    busy: true,
    draft: 'half typed',
    drafts: { c1: 'draft' },
    notice: { t: 'nope' },
    flashMsg: 'saved',
    researchPanel: { mid: 'm1' },
  })
  const { settings } = readLocalData()
  for (const key of SYNC_LIVE_ONLY) assert.equal(key in settings, false)
})
