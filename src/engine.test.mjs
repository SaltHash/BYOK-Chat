import test from 'node:test'
import assert from 'node:assert/strict'

const { TOOLS } = await import('./meta.ts')
const { executeTool, runToolLoop, stream, toolsFor, wire } = await import('./engine.ts')
const jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const openai = { type: 'openai', url: 'https://provider.example/v1', key: 'test-key', model: 'test-model' }
const anthropic = { ...openai, type: 'anthropic' }
const enabled = Object.fromEntries(TOOLS.map(([name]) => [name, true]))

test('every registered tool is exposed from the same enabled registry for both providers', () => {
  const names = TOOLS.map(([name]) => name)
  assert.deepEqual(toolsFor(enabled, 'openai').map((x) => x.function.name), names)
  assert.deepEqual(toolsFor(enabled, 'anthropic').map((x) => x.name), names)
  assert.deepEqual(toolsFor({ time: true }, 'openai').map((x) => x.function.name), ['time'])
  assert.equal(toolsFor({}, 'openai').length, 0)
})

test('registered handlers execute with validated arguments and return structured errors safely', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { readText: async () => 'clipboard text' },
    geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 12.34567, longitude: -23.45678 } }) },
  } })
  const searchFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({ query: 'Fedora', results: [{ id: 'S1', title: 'Fedora', url: 'https://fedoraproject.org', snippet: 'Linux distribution' }] })
  try {
    const cases = [
      ['time', {}, /\d{4}/], ['date', {}, /\d{4}/], ['clipboard', {}, /clipboard text/], ['calc', { expression: '2*(3+4)' }, /^14$/],
      ['count', { text: 'one two' }, /Words: 2/], ['json', { text: '{"ok":true}' }, /"ok": true/], ['base64', { text: 'hello' }, /^aGVsbG8=$/],
      ['search', { query: 'Fedora' }, /https:\/\/fedoraproject\.org/], ['uuid', {}, /^[\da-f-]{36}$/i], ['random', { min: 4, max: 4 }, /^4$/],
      ['hash', { text: 'hello' }, /^2cf24dba/], ['location', {}, /^12\.3457, -23\.4568$/],
      ['navigate', { destination: 'theme' }, /^\[Appearance · Theme\]\(#settings\/look\)$/],
    ]
    for (const [name, args, expected] of cases) {
      const result = await executeTool({ id: `call-${name}`, name, arguments: JSON.stringify(args) }, enabled)
      assert.equal(result.id, `call-${name}`)
      assert.match(result.result, expected, name)
      assert.equal(result.error, undefined)
    }
    assert.match((await executeTool({ id: 'bad-json', name: 'calc', arguments: '{' }, enabled)).result, /valid JSON/)
    assert.match((await executeTool({ id: 'bad-args', name: 'calc', arguments: '{"expression":3}' }, enabled)).result, /Invalid argument/)
    assert.match((await executeTool({ id: 'unknown', name: 'not-registered', arguments: '{}' }, enabled)).result, /Unknown tool/)
    assert.match((await executeTool({ id: 'disabled', name: 'time', arguments: '{}' }, {})).result, /disabled/)
    assert.match((await executeTool({ id: 'bad-destination', name: 'navigate', arguments: '{"destination":"secret page"}' }, enabled)).result, /Unknown app destination/)
  } finally { globalThis.fetch = searchFetch }
})

test('provider wire history retains multiple rounds, arguments, results and call IDs', () => {
  const msg = { id: 'a', r: 'assistant', t: 'The answer is 14.', toolFinal: 'The answer is 14.', toolRounds: [
    { text: '', calls: [{ id: 'c1', name: 'calc', arguments: '{"expression":"2*7"}', result: '14' }] },
    { text: '', calls: [{ id: 'c2', name: 'count', arguments: '{"text":"hi"}', result: 'Characters: 2' }] },
  ] }
  const ow = wire(openai, [msg])
  assert.equal(ow[0].tool_calls[0].id, 'c1')
  assert.equal(ow[1].tool_call_id, 'c1')
  assert.equal(ow[2].tool_calls[0].id, 'c2')
  assert.equal(ow[3].tool_call_id, 'c2')
  assert.deepEqual(ow[4], { role: 'assistant', content: 'The answer is 14.' })
  const aw = wire(anthropic, [msg])
  assert.equal(aw[0].content[0].id, 'c1')
  assert.equal(aw[1].content[0].tool_use_id, 'c1')
  assert.equal(aw[2].content[0].id, 'c2')
  assert.equal(aw[3].content[0].tool_use_id, 'c2')
})

test('OpenAI-compatible streaming request includes tools and parses structured call deltas', async () => {
  let request
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body)
    return jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'call-1', type: 'function', extra_content: { google: { thought_signature: 'signature-123' } }, function: { name: 'time', arguments: '{}' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2 } })
  }
  try {
    const result = await stream(openai, '', [{ role: 'user', content: 'What time is it?' }], () => {}, new AbortController(), {}, () => {}, toolsFor({ time: true }, 'openai'))
    assert.equal(request.tool_choice, 'auto')
    assert.equal(request.tools[0].function.name, 'time')
    assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'time', arguments: '{}', extra_content: { google: { thought_signature: 'signature-123' } } }])
    const history = wire(openai, [{ id: 'a', r: 'assistant', t: '', toolRounds: [{ text: '', calls: [{ ...result.toolCalls[0], result: '10:00' }] }] }])
    assert.deepEqual(history[0].tool_calls[0].extra_content, { google: { thought_signature: 'signature-123' } })
  } finally { globalThis.fetch = original }
})

test('streaming OpenAI tool-call fragments are accumulated before execution', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"frag-1","extra_content":{"google":{"thought_signature":"sig-stream"}},"function":{"name":"cal"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"c","arguments":"{\\\"expression\\\":"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"3*3\\\"}"}}]}}]}',
    'data: [DONE]', '',
  ].join('\n'), { headers: { 'content-type': 'text/event-stream' } })
  try {
    const result = await stream(openai, '', [{ role: 'user', content: '3*3' }], () => {}, new AbortController(), {}, () => {}, toolsFor({ calc: true }, 'openai'))
    assert.deepEqual(result.toolCalls, [{ id: 'frag-1', name: 'calc', arguments: '{"expression":"3*3"}', extra_content: { google: { thought_signature: 'sig-stream' } } }])
  } finally { globalThis.fetch = original }
})

test('Anthropic requests use native tool schemas and parse native tool-use responses', async () => {
  let request
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body)
    return jsonResponse({ type: 'message', content: [{ type: 'tool_use', id: 'anth-1', name: 'calc', input: { expression: '6*7' } }], usage: { input_tokens: 4, output_tokens: 1 } })
  }
  try {
    const result = await stream(anthropic, '', [{ role: 'user', content: 'Calculate 6 times 7' }], () => {}, new AbortController(), {}, () => {}, toolsFor({ calc: true }, 'anthropic'))
    assert.equal(request.tools[0].name, 'calc')
    assert.equal(request.tools[0].input_schema.type, 'object')
    assert.deepEqual(result.toolCalls, [{ id: 'anth-1', name: 'calc', arguments: '{"expression":"6*7"}' }])
  } finally { globalThis.fetch = original }
})

test('tool loop executes calls and sends their results back before final generation', async () => {
  const requests = []
  const originalFetch = globalThis.fetch, originalRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    if (requests.length === 1) return jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'calc-1', type: 'function', function: { name: 'calc', arguments: '{"expression":"6*7"}' } }] } }] })
    return jsonResponse({ choices: [{ message: { content: 'The result is 42.' } }] })
  }
  try {
    const result = await runToolLoop(openai, '', (rounds) => wire(openai, [
      { id: 'u', r: 'user', t: 'What is 6 times 7?' },
      { id: 'a', r: 'assistant', t: '', toolRounds: rounds },
    ]), { calc: true }, () => {}, new AbortController())
    assert.equal(result.text, 'The result is 42.')
    assert.equal(result.rounds[0].calls[0].result, '42')
    assert.equal(requests.length, 2)
    assert.equal(requests[1].messages[1].tool_calls[0].id, 'calc-1')
    assert.deepEqual(requests[1].messages[2], { role: 'tool', tool_call_id: 'calc-1', content: '42' })
    assert.equal(requests[1].messages[0].content, 'What is 6 times 7?')
  } finally { globalThis.fetch = originalFetch; globalThis.requestAnimationFrame = originalRaf }
})

test('tool loop supports several calls from one response and enforces its round limit', async () => {
  const originalFetch = globalThis.fetch, originalRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount++
    return jsonResponse({ choices: [{ message: requestCount === 1 ? { tool_calls: [
      { id: 'a', type: 'function', function: { name: 'calc', arguments: '{"expression":"1+1"}' } },
      { id: 'b', type: 'function', function: { name: 'calc', arguments: '{"expression":"2+2"}' } },
    ] } : { content: 'Done.' } }] })
  }
  try {
    const result = await runToolLoop(openai, '', (rounds) => wire(openai, [{ id: 'a', r: 'assistant', t: '', toolRounds: rounds }]), { calc: true }, () => {}, new AbortController())
    assert.deepEqual(result.rounds[0].calls.map((x) => x.result), ['2', '4'])
    assert.equal(result.rounds[0].calls.length, 2)
    globalThis.fetch = async () => jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'again', type: 'function', function: { name: 'time', arguments: '{}' } }] } }] })
    await assert.rejects(() => runToolLoop(openai, '', (rounds) => wire(openai, [{ id: 'a', r: 'assistant', t: '', toolRounds: rounds }]), { time: true }, () => {}, new AbortController(), {}, () => {}, () => {}, 1), /limit reached \(1 rounds\)/)
  } finally { globalThis.fetch = originalFetch; globalThis.requestAnimationFrame = originalRaf }
})

test('sequential tool rounds are sent back in order for dependent calls', async () => {
  const requests = [], originalFetch = globalThis.fetch, originalRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    if (requests.length === 1) return jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'first', type: 'function', function: { name: 'calc', arguments: '{"expression":"5+2"}' } }] } }] })
    if (requests.length === 2) return jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'second', type: 'function', function: { name: 'count', arguments: '{"text":"seven"}' } }] } }] })
    return jsonResponse({ choices: [{ message: { content: 'Seven has five characters.' } }] })
  }
  try {
    const result = await runToolLoop(openai, '', (rounds) => wire(openai, [{ id: 'a', r: 'assistant', t: '', toolRounds: rounds }]), { calc: true, count: true }, () => {}, new AbortController())
    assert.equal(result.rounds.length, 2)
    assert.equal(result.rounds[0].calls[0].result, '7')
    assert.equal(result.rounds[1].calls[0].result, 'Characters: 5\nWords: 1\nLines: 1')
    assert.equal(requests.length, 3)
    assert.equal(requests[2].messages[0].tool_calls[0].id, 'first')
    assert.equal(requests[2].messages[1].tool_call_id, 'first')
    assert.equal(requests[2].messages[2].tool_calls[0].id, 'second')
    assert.equal(requests[2].messages[3].tool_call_id, 'second')
  } finally { globalThis.fetch = originalFetch; globalThis.requestAnimationFrame = originalRaf }
})

test('provider rejection of tool definitions surfaces an explicit error', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('tool calling is unsupported', { status: 400, statusText: 'Bad Request' })
  try { await assert.rejects(() => stream(openai, '', [{ role: 'user', content: 'time?' }], () => {}, new AbortController(), {}, () => {}, toolsFor({ time: true }, 'openai')), /HTTP 400/) }
  finally { globalThis.fetch = original }
})

test('workspace_upsert executes locally, coerces bad paths, and truncates oversized content', async () => {
  const { WORKSPACE_MAX_CONTENT } = await import('./workspace.ts')
  const ok = await executeTool({ id: 'ws-1', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', workspaceId: 'ws-1', revisionName: 'Initial', path: 'src/app.py', language: 'python', content: 'print(1)' }) }, enabled)
  assert.equal(JSON.parse(ok.result).status, 'ready')
  assert.equal(JSON.parse(ok.result).path, 'src/app.py')
  assert.equal(ok.error, undefined)
  const evil = await executeTool({ id: 'ws-2', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', workspaceId: 'ws-1', revisionName: 'Initial', path: '../../evil.sh', content: 'x' }) }, enabled)
  assert.equal(JSON.parse(evil.result).status, 'ready')
  assert.equal(JSON.parse(evil.result).path, 'evil.sh')
  const gone = await executeTool({ id: 'ws-3', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'delete', workspaceId: 'ws-1', revisionName: 'Delete', path: '/tmp/old.txt' }) }, enabled)
  assert.equal(JSON.parse(gone.result).status, 'deleted')
  assert.equal(JSON.parse(gone.result).path, 'tmp/old.txt')
  const big = await executeTool({ id: 'ws-4', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', workspaceId: 'ws-1', revisionName: 'Big', path: 'big.txt', content: 'x'.repeat(WORKSPACE_MAX_CONTENT + 5) }) }, enabled)
  assert.match(big.result, /"status":"ready"/)
  assert.match(big.result, /"path":"big\.txt"/)
  assert.match((await executeTool({ id: 'ws-5', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'explode', workspaceId: 'ws-1', revisionName: 'Test', path: 'a.txt' }) }, enabled)).result, /action must be/)
  assert.match((await executeTool({ id: 'ws-6', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', workspaceId: 'ws-1', revisionName: 'Test' }) }, enabled)).result, /Missing required argument: path/)
  assert.match((await executeTool({ id: 'ws-7', name: 'workspace_upsert', arguments: '{}' }, {})).result, /disabled/)
})

test('streaming tool deltas fire per chunk with the accumulated workspace arguments', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"cv-1","function":{"name":"workspace_upsert","arguments":"{\\"action\\":\\"create\\""}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":",\\"path\\":\\"a.py\\",\\"content\\":\\"print("}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1)\\"}"}}]}}]}',
    'data: [DONE]', '',
  ].join('\n'), { headers: { 'content-type': 'text/event-stream' } })
  try {
    const seen = []
    const result = await stream(openai, '', [{ role: 'user', content: 'make a file' }], () => {}, new AbortController(), {}, () => {}, toolsFor({ workspace_upsert: true }, 'openai'), (calls) => seen.push(structuredClone(calls)))
    assert.equal(result.toolCalls[0].name, 'workspace_upsert')
    assert.ok(seen.length >= 3)
    // Each snapshot reflects the full accumulated string so far (rewrites re-render).
    assert.ok(seen[0][0].arguments.length < seen[seen.length - 1][0].arguments.length)
    const { parseWorkspaceArgsPartial } = await import('./workspace.ts')
    assert.equal(parseWorkspaceArgsPartial(result.toolCalls[0].arguments).content, 'print(1)')
    assert.equal(parseWorkspaceArgsPartial(seen[0][0].arguments).action, 'create')
  } finally { globalThis.fetch = original }
})

test('runToolLoop forwards live tool deltas to its callback', async () => {
  const originalFetch = globalThis.fetch, originalRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  let n = 0
  globalThis.fetch = async () => {
    n++
    if (n === 1) return jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'cv-9', type: 'function', function: { name: 'workspace_upsert', arguments: '{"action":"create","workspaceId":"ws-1","revisionName":"Initial","path":"a.py","content":"x"}' } }] } }] })
    return jsonResponse({ choices: [{ message: { content: 'Done.' } }] })
  }
  try {
    const seen = []
    const result = await runToolLoop(openai, '', (rounds) => wire(openai, [{ id: 'a', r: 'assistant', t: '', toolRounds: rounds }]), { workspace_upsert: true }, () => {}, new AbortController(), {}, () => {}, () => {}, 8, {}, (calls) => seen.push(calls))
    assert.equal(JSON.parse(result.rounds[0].calls[0].result).status, 'ready')
    assert.equal(JSON.parse(result.rounds[0].calls[0].result).path, 'a.py')
    assert.ok(seen.length >= 1)
    assert.equal(seen[0][0].name, 'workspace_upsert')
  } finally { globalThis.fetch = originalFetch; globalThis.requestAnimationFrame = originalRaf }
})

const { estimateHistoryTokens, trimHistory, readAtt } = await import('./engine.ts')
const { prunePersisted } = await import('./store.ts')

test('trimHistory drops oldest-first, always keeps the latest message, and fits the budget', () => {
  const msgs = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, r: i % 2 ? 'assistant' : 'user', t: 'x'.repeat(4000) }))
  const full = estimateHistoryTokens(msgs, 'sys', 4)
  const budget = Math.floor(full / 2)
  const { msgs: kept, dropped, estimated } = trimHistory(msgs, { limit: budget + 8000, reserve: 8000, charsPerToken: 4, sys: 'sys' })
  assert.ok(dropped > 0)
  assert.equal(kept.length, msgs.length - dropped)
  assert.equal(kept[kept.length - 1].id, 'm5')
  assert.ok(estimated <= budget)
  const single = trimHistory([{ id: 'only', r: 'user', t: 'hi' }], { limit: 128000 })
  assert.equal(single.dropped, 0)
})

test('OpenAI wire omits PDFs with a note instead of an image_url block', () => {
  const pdf = { id: 'u', r: 'user', t: 'read this', att: [{ name: 'doc.pdf', kind: 'pdf', size: '1 KB', mime: 'application/pdf', data: 'AAA' }] }
  const ow = wire(openai, [pdf])
  assert.equal(ow.length, 1)
  assert.equal(typeof ow[0].content, 'string')
  assert.match(ow[0].content, /cannot process PDFs/)
  const aw = wire(anthropic, [pdf])
  assert.equal(typeof aw[0].content, 'object')
  assert.ok(aw[0].content.some((c) => c.type === 'document'))
})

test('readAtt rejects office, media, and archive files with guidance and caps text budgets', async () => {
  const file = (name, type, text = 'hello') => new File([text], name, { type })
  assert.match(await readAtt(file('deck.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), /Office documents/)
  assert.match(await readAtt(file('song.mp3', 'audio/mpeg')), /not transcribed/)
  assert.match(await readAtt(file('bundle.zip', 'application/zip')), /not unpacked/)
  assert.match(await readAtt(file('notes.txt', 'text/plain'), 500000), /budget/)
  const big = await readAtt(file('big.md', 'text/markdown', 'y'.repeat(200005)))
  assert.equal(big.kind, 'txt')
  assert.match(big.text, /truncated at 200,000/)
  const csv = await readAtt(file('data.csv', 'text/csv', 'a,b\n1,2'))
  assert.equal(csv.kind, 'txt')
})

test('prunePersisted compacts bulky tool results and workspace history', () => {
  const raw = JSON.stringify({ state: { chats: [{ id: 'c', msgs: [{ id: 'm', r: 'assistant', t: 'ok', reasoning: 'r'.repeat(6000), toolRounds: [{ text: '', calls: [{ id: 'x', name: 'calc', arguments: '{}', result: 'z'.repeat(9000) }] }] }] }], workspaces: { w: { revisions: [{ id: '1', files: [{ path: 'a', content: 'q'.repeat(25000) }] }, { id: '2', files: [] }, { id: '3', files: [] }] } } } })
  const out = prunePersisted(raw)
  assert.ok(out && out.length < raw.length)
  const v = JSON.parse(out).state
  assert.match(v.chats[0].msgs[0].toolRounds[0].calls[0].result, /compacted/)
  assert.equal(v.workspaces.w.revisions.length, 2)
})
