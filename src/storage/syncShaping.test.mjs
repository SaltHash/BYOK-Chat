import test from 'node:test'
import assert from 'node:assert/strict'
import { shapeChatForSync, shapeSyncData } from './syncShaping.ts'

test('remote shaping keeps the user-facing reply and drops uploads and tool output', () => {
  const chat = {
    id: 'c1',
    title: 'A talk',
    msgs: [
      {
        id: 'u1', r: 'user', t: 'see this', at: 1,
        att: [{ name: 'report.pdf', kind: 'pdf', size: '2 KB', data: 'BASE64', text: 'EXTRACTED' }],
      },
      {
        id: 'a1', r: 'assistant', t: 'Here is the answer', at: 2,
        toolFinal: 'Here is the answer', sys: 'SYSTEM PROMPT', reasoning: 'THINKING',
        log: [{ n: 'model' }],
        toolRounds: [{ text: 'Searching', calls: [{ id: 't1', name: 'search', arguments: '{"query":"x"}', result: 'HUGE EVIDENCE', error: false }] }],
      },
    ],
  }
  const [u, a] = shapeChatForSync(chat).msgs
  assert.equal(u.t, 'see this')
  assert.equal(u.att[0].name, 'report.pdf')
  assert.equal('data' in u.att[0], false)
  assert.equal('text' in u.att[0], false)
  assert.equal(a.t, 'Here is the answer')
  assert.equal(a.toolFinal, 'Here is the answer')
  assert.equal('sys' in a, false)
  assert.equal('reasoning' in a, false)
  assert.equal('log' in a, false)
  assert.equal('result' in a.toolRounds[0].calls[0], false)
  assert.equal(a.toolRounds[0].calls[0].arguments, '{"query":"x"}')
})

test('remote shaping removes endpoint keys, search keys and MCP headers', () => {
  const data = {
    settings: {
      eps: [{ id: 'e', name: 'E', key: 'SECRET' }],
      search: { keys: { exa: 'SEARCHSECRET' }, readerKey: 'READERSECRET' },
      mcps: [{ id: 'm', headers: 'Authorization: Bearer x' }],
      prefs: { showBy: true },
    },
    chats: [],
    workspaces: { w: { name: 'W', revisions: [{ id: 'r1', files: [{ path: 'a', content: 'x'.repeat(30000) }] }, { id: 'r2', files: [{ path: 'b', content: 'new' }] }] } },
    selectedRevision: { w: 'r2' },
  }
  const shaped = shapeSyncData(data)
  assert.equal(shaped.settings.eps[0].key, '')
  assert.deepEqual(shaped.settings.search.keys, {})
  assert.equal(shaped.settings.search.readerKey, '')
  assert.equal(shaped.settings.mcps[0].headers, '')
  assert.equal(shaped.settings.prefs.showBy, true)
  assert.equal(shaped.workspaces.w.revisions.length, 1)
  assert.equal(shaped.workspaces.w.revisions[0].id, 'r2')
})
