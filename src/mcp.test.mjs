import test from 'node:test'
import assert from 'node:assert/strict'

const {
  parseHeaders, toolSlug, mcpToolName, mcpBindings, isMcpUrl, normMcpServers,
  parseMcpSse, formatMcpContent, McpClient, toolParameters, MCP_PROTOCOL_VERSION,
} = await import('./mcp.ts')

const json = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
})

test('header blocks parse one pair per line and drop transport headers', () => {
  const h = parseHeaders('Authorization: Bearer abc:def\nX-Env: prod\nHost: evil\nContent-Type: text/plain\nbad line\n: nope')
  assert.deepEqual(h, { Authorization: 'Bearer abc:def', 'X-Env': 'prod' })
  assert.deepEqual(parseHeaders(''), {})
})

test('tool names are provider-safe, stable, and collision-free', () => {
  assert.equal(toolSlug('My Server!'), 'my_server')
  assert.equal(toolSlug('***'), 'x')
  const long = mcpToolName({ name: 'a'.repeat(80) }, 'b'.repeat(80))
  assert.ok(long.length <= 64)
  assert.match(long, /^mcp_[a-z0-9_]+$/)
  const servers = [
    { id: '1', name: 'Files', url: 'https://a.example/mcp', headers: '', on: true, tools: [{ name: 'read' }, { name: 'write' }] },
    { id: '2', name: 'Files', url: 'https://b.example/mcp', headers: '', on: true, tools: [{ name: 'read' }] },
    { id: '3', name: 'Off', url: 'https://c.example/mcp', headers: '', on: false, tools: [{ name: 'read' }] },
  ]
  const names = mcpBindings(servers).map((b) => b.name)
  assert.deepEqual(names, ['mcp_files_read', 'mcp_files_write', 'mcp_files_read_2'])
  assert.equal(isMcpUrl('ftp://x'), false)
  assert.equal(isMcpUrl('http://localhost:3000/mcp'), true)
})

test('stored servers normalize junk without throwing', () => {
  const list = normMcpServers([
    null,
    { id: 'a', name: ' Alpha ', url: 'https://x.example/mcp', headers: 'A: b', on: false, tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } }, { nope: 1 }] },
    { id: 'a', name: 'Duplicate id' },
    { id: 'b', url: 42 },
  ])
  assert.equal(list.length, 2, 'duplicate ids are dropped instead of shadowing the first server')
  assert.equal(list[0].name, 'Alpha')
  assert.equal(list[0].on, false)
  assert.equal(list[0].tools.length, 1)
  assert.equal(list[0].tools[0].inputSchema.properties.x.type, 'string')
  assert.equal(list[1].url, '')
  assert.equal(normMcpServers('nope').length, 0)
})

test('SSE parsing picks the matching id and ignores notifications', () => {
  const body = [
    ': ping',
    'event: message',
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
    '',
    'event: message',
    'data: {"jsonrpc":"2.0",',
    'data: "id":4,"result":{"ok":true}}',
    '',
  ].join('\n')
  assert.deepEqual(parseMcpSse(body, 4).result, { ok: true })
  assert.equal(parseMcpSse(body, 5), null)
})

test('tool results flatten text, summarize binary, and surface structure', () => {
  assert.equal(formatMcpContent({ content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] }), 'hello\n\nworld')
  assert.match(formatMcpContent({ content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] }), /image image\/png returned/)
  assert.match(formatMcpContent({ content: [{ type: 'resource_link', name: 'Doc', uri: 'https://x' }] }), /\[resource\] Doc: https:\/\/x/)
  assert.equal(formatMcpContent({ structuredContent: { ok: 1 } }), '{\n  "ok": 1\n}')
  assert.equal(formatMcpContent({}), 'The MCP tool returned no content.')
})

test('malformed tool schemas degrade to a permissive object', () => {
  assert.deepEqual(toolParameters({ name: 'x' }), { type: 'object', properties: {}, additionalProperties: true })
  const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
  assert.deepEqual(toolParameters({ name: 'x', inputSchema: schema }), schema)
})

test('client initializes once, keeps the session id, paginates, and calls tools', async () => {
  const calls = []
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ body, headers: init.headers })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (body.method === 'initialize') {
      assert.equal(body.params.protocolVersion, MCP_PROTOCOL_VERSION)
      return json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: 'Fake', version: '1.0' } } }, { headers: { 'mcp-session-id': 'sess-1' } })
    }
    if (body.method === 'tools/list') {
      if (!body.params.cursor) return json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'ping', description: 'Ping' }], nextCursor: 'p2' } })
      return json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } })
    }
    if (body.method === 'tools/call') {
      return json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `pong:${body.params.arguments.text}` }] } })
    }
    throw Error(`unexpected method ${body.method}`)
  }
  const client = new McpClient('https://mcp.example/mcp', { Authorization: 'Bearer t' }, fetchFn)
  const tools = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name), ['ping', 'echo'])
  assert.equal(client.serverInfo.name, 'Fake')
  // initialize once, notification once, two list pages
  assert.equal(calls.filter((c) => c.body.method === 'initialize').length, 1)
  assert.equal(calls[0].headers.Authorization, 'Bearer t')
  assert.ok(calls.every((c, i) => i < 2 || c.headers['mcp-session-id'] === 'sess-1'))
  const text = await client.callTool('echo', { text: 'hi' })
  assert.equal(text, 'pong:hi')
})

test('client throws MCP errors and tool error results', async () => {
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: body.id, result: {} })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (body.method === 'tools/call') return json({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: 'bad input' }] } })
    return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'no such method' } })
  }
  const client = new McpClient('https://mcp.example/mcp', {}, fetchFn)
  await assert.rejects(() => client.callTool('x', {}), /reported an error: bad input/)
  await assert.rejects(() => client.listTools(), /no such method/)
})

test('network failure explains the likely CORS cause', async () => {
  const client = new McpClient('https://mcp.example/mcp', {}, async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(() => client.listTools(), /CORS/)
})
