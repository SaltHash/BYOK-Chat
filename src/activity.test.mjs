import test from 'node:test'
import assert from 'node:assert/strict'

const { activityOf, formatElapsed } = await import('./activity.ts')

const call = (name, args = {}, result) => ({ name, arguments: JSON.stringify(args), ...(result == null ? {} : { result }) })

test('no calls reads as thinking, in both tenses', () => {
  const a = activityOf([])
  assert.equal(a.kind, 'thinking')
  assert.equal(a.present, 'Thinking')
  assert.equal(a.past, 'Thought')
})

test('searches count the websites that came back', () => {
  const result = 'results\n[Source 1: a](https://a.test)\n[Source 2: b](https://b.test)\n[Source 3: c](https://c.test)'
  const a = activityOf([call('search', { query: 'x' }, result)])
  assert.equal(a.kind, 'search')
  assert.equal(a.count, 3)
  assert.equal(a.present, 'Searching 3 websites')
  assert.equal(a.past, 'Searched 3 websites')
})

test('a search without results falls back to one website per call', () => {
  const a = activityOf([call('search', { query: 'x' })])
  assert.equal(a.present, 'Searching 1 website')
  assert.equal(a.past, 'Searched 1 website')
})

test('pending searches count the sites each call fetches', () => {
  const a = activityOf([call('search', { query: 'x' }), call('search', { query: 'y' })], { perSearch: 8 })
  assert.equal(a.present, 'Searching 16 websites')
  // The model may ask for fewer sites than the user's maximum.
  const fewer = activityOf([call('search', { query: 'x', count: 3 }), call('search', { query: 'y' })], {
    perSearch: (c) => (c.arguments.includes('"count"') ? 3 : 8),
  })
  assert.equal(fewer.present, 'Searching 11 websites')
  // A failed call fetched nothing.
  const failed = activityOf([{ name: 'search', arguments: '{"query":"x"}', error: true }], { perSearch: 8 })
  assert.equal(failed.present, 'Searching 1 website')
})

test('page reads say pages', () => {
  const a = activityOf([call('fetch_page', { url: 'https://a.test' })])
  assert.equal(a.kind, 'read')
  assert.equal(a.present, 'Reading 1 page')
  assert.equal(a.past, 'Read 1 page')
})

test('one file write names the file, several count them', () => {
  assert.equal(activityOf([call('workspace_upsert', { action: 'patch', path: 'src/app.tsx' })]).present, 'Writing app.tsx')
  const two = activityOf([
    call('workspace_upsert', { action: 'create', path: 'a.ts' }),
    call('workspace_upsert', { action: 'create', path: 'b.ts' }),
  ])
  assert.equal(two.present, 'Writing 2 files')
  assert.equal(two.past, 'Wrote 2 files')
})

test('the newest call decides the line', () => {
  const a = activityOf([call('search', { query: 'x' }), call('run_code', { language: 'python', code: 'print(1)' })])
  assert.equal(a.kind, 'code')
  assert.equal(a.present, 'Running code')
  assert.equal(a.past, 'Ran code')
})

test('MCP calls use their exposed tool name', () => {
  const a = activityOf([call('mcp_filesystem_read_file', { path: '/tmp/a' })])
  assert.equal(a.kind, 'mcp')
  assert.equal(a.present, 'Calling filesystem read file')
  assert.equal(a.past, 'Called filesystem read file')
})

test('elapsed time has no decimals and rolls up to minutes and hours', () => {
  assert.equal(formatElapsed(0), '0s')
  assert.equal(formatElapsed(999), '0s')
  assert.equal(formatElapsed(4300), '4s')
  assert.equal(formatElapsed(59_900), '59s')
  assert.equal(formatElapsed(60_000), '1m 00s')
  assert.equal(formatElapsed(132_000), '2m 12s')
  assert.equal(formatElapsed(3_600_000), '1h 00m')
  assert.equal(formatElapsed(5_430_000), '1h 30m')
  assert.equal(formatElapsed(Number.NaN), '0s')
  assert.equal(formatElapsed(-5000), '0s')
})
