import test from 'node:test'
import assert from 'node:assert/strict'
import { shapeChatForSync, shapeSyncData, WORKSPACE_FILE_MAX_CHARS } from './syncShaping.ts'

test('remote shaping keeps the visible conversation and drops every payload', () => {
  const chat = {
    id: 'c1',
    title: 'A talk',
    msgs: [
      {
        id: 'u1', r: 'user', t: 'see this', at: 1, full: 'COMPOSED PROMPT', fx: 'FILE APPENDIX',
        att: [{ name: 'report.pdf', kind: 'pdf', size: '2 KB', data: 'BASE64', text: 'EXTRACTED' }],
      },
      {
        id: 'a1', r: 'assistant', t: 'Here is the answer', at: 2,
        toolFinal: 'Here is the answer', sys: 'SYSTEM PROMPT', reasoning: 'THINKING', log: [{ n: 'model' }],
        toolRounds: [{ text: 'Searching', calls: [{ id: 't1', name: 'search', arguments: '{"query":"x"}', result: 'HUGE EVIDENCE', error: false, ms: 12 }] }],
      },
    ],
  }
  const [u, a] = shapeChatForSync(chat).msgs
  assert.equal(u.t, 'see this')
  assert.deepEqual(u.att[0], { name: 'report.pdf', kind: 'pdf', size: '2 KB' })
  assert.equal('full' in u, false)
  assert.equal('fx' in u, false)
  assert.equal(a.t, 'Here is the answer')
  // The reply text is stored once, under `t`.
  assert.equal('toolFinal' in a, false)
  assert.equal('sys' in a, false)
  assert.equal('log' in a, false)
  assert.equal(a.reasoning, 'THINKING')
  // A tool call is stored as an indicator, never with its arguments or result.
  assert.deepEqual(a.toolRounds[0].calls[0], { id: 't1', name: 'search', error: false, ms: 12 })
})

test('research narration survives, its evidence does not', () => {
  const chat = {
    id: 'c1', title: 'Research',
    msgs: [{
      id: 'a1', r: 'assistant', t: 'Report [S1]', at: 2, reasoning: 'THINKING',
      toolRounds: [{ text: '', calls: [{ id: 't1', name: 'search', arguments: '{}', result: '[Source S1] Title: X\nURL: https://x.test\nbody evidence' }] }],
      research: {
        id: 'r1', query: 'q', tier: 'standard', status: 'done', startedAt: 1,
        steps: [{ id: 's1', kind: 'search', label: 'Search', state: 'done', lead: 'NARRATION' }],
        note: 'NARRATION', reasoning: 'PLAN THINKING',
        agents: [{ id: 'a', label: 'Agent', brief: 'LONG BRIEF', answer: 'LONG ANSWER', sources: [{ title: 'X', url: 'https://x.test' }] }],
      },
    }],
  }
  const [a] = shapeChatForSync(chat).msgs
  assert.equal(a.reasoning, 'THINKING')
  assert.equal(a.research.reasoning, 'PLAN THINKING')
  assert.equal(a.research.note, 'NARRATION')
  assert.equal(a.research.steps[0].lead, 'NARRATION')
  assert.equal(a.toolRounds[0].calls[0].result, undefined)
  // Delegated agents keep their source list, not their transcripts.
  assert.deepEqual(a.research.agents[0].sources, [{ title: 'X', url: 'https://x.test' }])
  assert.equal(a.research.agents[0].answer, undefined)
})

test('share edit tokens never travel unless credentials are opted in', () => {
  const data = {
    settings: { shares: [{ id: 's1', chatId: 'c1', url: 'https://x/s/1', token: 'owner-secret', at: 1 }] },
    chats: [], workspaces: {}, selectedRevision: {},
  }
  assert.equal(shapeSyncData(data).settings.shares[0].token, '')
  assert.equal(shapeSyncData(data).settings.shares[0].url, 'https://x/s/1')
  assert.equal(shapeSyncData(data, { includeKeys: true }).settings.shares[0].token, 'owner-secret')
})

test('the slot holds settings only unless chats are requested', () => {
  const data = {
    settings: { themeMode: 'dark', projects: [{ id: 'p', name: 'P', context: [{ id: 'f', name: 'a.txt', size: '2 KB', text: 'FILE TEXT' }] }] },
    chats: [{ id: 'c1', title: 'A', msgs: [{ id: 'm1', r: 'user', t: 'hi' }] }],
    workspaces: { w: { name: 'W', revisions: [{ id: 'r1', files: [{ path: 'a', content: 'x' }] }] } },
    selectedRevision: { w: 'r1' },
  }
  const off = shapeSyncData(data)
  assert.deepEqual(off.chats, [])
  assert.deepEqual(off.workspaces, {})
  assert.deepEqual(off.selectedRevision, {})
  // Project context is extracted file text: names travel, text does not.
  assert.deepEqual(off.settings.projects[0].context[0], { id: 'f', name: 'a.txt', size: '2 KB' })

  const on = shapeSyncData(data, { chats: true })
  assert.equal(on.chats.length, 1)
  assert.equal(on.workspaces.w.revisions.length, 1)
})

test('credentials stay on the device unless explicitly included', () => {
  const data = {
    settings: {
      eps: [{ id: 'e', name: 'E', key: 'SECRET' }],
      search: { keys: { exa: 'SEARCHSECRET' }, readerKey: 'READERSECRET' },
      mcps: [{ id: 'm', headers: 'Authorization: Bearer x', env: { TOKEN: 'SECRET' } }],
      prefs: { showBy: true },
    },
    chats: [], workspaces: {}, selectedRevision: {},
  }
  const stripped = shapeSyncData(data)
  assert.equal(stripped.settings.eps[0].key, '')
  assert.deepEqual(stripped.settings.search.keys, {})
  assert.equal(stripped.settings.search.readerKey, '')
  assert.equal(stripped.settings.mcps[0].headers, '')
  // A local MCP server's env block is a credential store, like the headers.
  assert.deepEqual(stripped.settings.mcps[0].env, { TOKEN: '' })
  assert.equal(stripped.settings.prefs.showBy, true)

  const kept = shapeSyncData(data, { includeKeys: true })
  assert.equal(kept.settings.eps[0].key, 'SECRET')
  assert.deepEqual(kept.settings.search.keys, { exa: 'SEARCHSECRET' })
  assert.equal(kept.settings.mcps[0].headers, 'Authorization: Bearer x')
  assert.deepEqual(kept.settings.mcps[0].env, { TOKEN: 'SECRET' })
})

test('only the newest workspace revision travels, and a huge file says it was cut', () => {
  const data = {
    settings: {},
    chats: [],
    workspaces: {
      w: {
        name: 'W',
        revisions: [
          { id: 'r1', files: [{ path: 'old', content: 'x' }] },
          { id: 'r2', files: [{ path: 'huge', content: 'x'.repeat(WORKSPACE_FILE_MAX_CHARS + 500) }, { path: 'new', content: 'ok' }] },
        ],
      },
    },
    selectedRevision: { w: 'r2' },
  }
  const shaped = shapeSyncData(data, { chats: true })
  assert.equal(shaped.workspaces.w.revisions.length, 1)
  assert.equal(shaped.workspaces.w.revisions[0].id, 'r2')
  const huge = shaped.workspaces.w.revisions[0].files[0]
  assert.equal(huge.truncated, true)
  assert.ok(huge.content.length <= WORKSPACE_FILE_MAX_CHARS + 1)
})
