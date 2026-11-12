import test from 'node:test'
import assert from 'node:assert/strict'
const { summarizeToolCalls, splitToolTrail } = await import('./toolSummary.ts')

const sources = (n) => Array.from({ length: n }, (_, i) => `[Source S${i + 1}]`).join('\n')
const call = (name, args = {}, result = '') => ({ name, arguments: JSON.stringify(args), result })
const write = (path, action = 'create') => call('workspace_upsert', { action, path, content: 'x' })

test('web searches count the sources they brought back', () => {
  const out = summarizeToolCalls([call('search', { query: 'a' }, sources(2)), call('search', { query: 'b' }, sources(3)), call('search', { query: 'c' }, sources(3))])
  assert.equal(out.title, 'Searched 8 websites')
  assert.deepEqual(out.clauses.map((c) => c.kind), ['search'])
})

test('writes name one or two files and count more', () => {
  assert.equal(summarizeToolCalls([write('index.html')]).title, 'Wrote index.html')
  assert.equal(summarizeToolCalls([write('index.html'), write('style.css')]).title, 'Wrote index.html and style.css')
  assert.equal(summarizeToolCalls([write('a.html'), write('b.css'), write('c.js')]).title, 'Wrote 3 files')
  assert.equal(summarizeToolCalls([write('src/app/main.ts')]).title, 'Wrote main.ts')
})

test('mixed tools collapse into one sentence', () => {
  const out = summarizeToolCalls([
    call('search', { query: 'x' }, sources(3)),
    call('fetch_page', { url: 'https://example.com' }, JSON.stringify({ title: 'Example', url: 'https://example.com' })),
    write('index.html'),
    write('style.css'),
  ])
  assert.equal(out.title, 'Searched 3 websites, read 1 page, wrote index.html and style.css')
})

test('reads and deletes stay distinct from writes', () => {
  const out = summarizeToolCalls([write('old.txt', 'delete'), call('workspace_upsert', { action: 'read', path: 'a.txt' })])
  assert.equal(out.title, 'Deleted old.txt, read 1 workspace file')
})

test('other tools read as actions, not tool ids', () => {
  assert.equal(summarizeToolCalls([call('run_code', { language: 'python', code: 'print(1)' })]).title, 'Ran code')
  assert.equal(summarizeToolCalls([call('run_code', {}), call('generate_image', {})]).title, 'Used 2 tools')
  assert.equal(summarizeToolCalls([]).title, 'Tool calls')
})

test('the reply splits at its tool rounds and merges silent ones', () => {
  const rounds = [
    { text: 'Let me check the docs.\n\n', calls: [call('search', { query: 'x' }, sources(2))] },
    { text: '', calls: [write('index.html')] },
    { text: '', calls: [write('style.css')] },
  ]
  const text = 'Let me check the docs.\n\n\n\nHere is the result.'
  const segs = splitToolTrail(text, rounds)
  assert.ok(segs)
  assert.equal(segs.length, 2)
  assert.equal(segs[0].text, 'Let me check the docs.')
  assert.equal(segs[0].calls.length, 3, 'silent rounds join the previous run')
  assert.equal(segs[1].text, 'Here is the result.')
  assert.deepEqual(segs[1].calls, [])
})

test('a reply with no preamble keeps one tool run before its answer', () => {
  const rounds = [{ text: '', calls: [call('search', { query: 'x' }, sources(1))] }]
  const segs = splitToolTrail('Answer.', rounds)
  assert.ok(segs)
  assert.equal(segs[0].text, '')
  assert.equal(segs[0].calls.length, 1)
  assert.equal(segs[1].text, 'Answer.')
})

test('unmatched rounds fall back to plain rendering', () => {
  assert.equal(splitToolTrail('Rewritten answer.', [{ text: 'Original preamble.', calls: [call('search')] }]), null)
  assert.equal(splitToolTrail('Answer.', []), null)
})
