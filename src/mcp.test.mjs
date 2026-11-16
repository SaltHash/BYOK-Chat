import test from 'node:test'
import assert from 'node:assert/strict'

const {
  parseHeaders, toolSlug, mcpToolName, mcpBindings, isMcpUrl, normMcpServers,
  parseMcpSse, formatMcpContent, McpClient, McpStdioClient, toolParameters, MCP_PROTOCOL_VERSION,
  parseMcpConfig, isStdioMcp, isMcpReady, envBlockOf, parseEnvBlock,
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
  // The protocol version is required once initialize has established it.
  assert.equal(calls[0].headers['mcp-protocol-version'], undefined)
  assert.equal(calls[2].headers['mcp-protocol-version'], MCP_PROTOCOL_VERSION)
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

test('imports the Claude Desktop / Cursor shape, including local commands', () => {
  const text = JSON.stringify({
    mcpServers: {
      Roblox_Studio: { command: '/home/me/.local/bin/roblox-studio-mcp.sh', args: ['--stdio'] },
      Files: { url: 'https://files.example/mcp', headers: { Authorization: 'Bearer t' } },
    },
  })
  const { servers, skipped, notes } = parseMcpConfig(text)
  assert.equal(skipped.length, 0)
  assert.deepEqual(notes, [])
  assert.equal(servers.length, 2)
  const roblox = servers.find((s) => s.name === 'Roblox_Studio')
  assert.equal(roblox.transport, 'stdio')
  assert.equal(roblox.command, '/home/me/.local/bin/roblox-studio-mcp.sh')
  assert.deepEqual(roblox.args, ['--stdio'])
  assert.equal(roblox.url, '')
  assert.equal(isStdioMcp(roblox), true)
  assert.equal(isMcpReady(roblox), true)
  const files = servers.find((s) => s.name === 'Files')
  assert.equal(files.transport, 'http')
  assert.equal(files.headers, 'Authorization: Bearer t')
  assert.match(roblox.id, /^mcp-/)
})

test('understands VS Code, Zed, bare maps, single objects, arrays and header lists', () => {
  const vscode = parseMcpConfig(JSON.stringify({ mcp: { servers: { Gh: { type: 'http', url: 'https://gh.example/mcp' } } } }))
  assert.deepEqual(vscode.servers.map((s) => s.name), ['Gh'])

  const zed = parseMcpConfig(JSON.stringify({ context_servers: { Local: { source: 'custom', command: { path: '/bin/server', args: ['--x'], env: { TOKEN: 'abc' } } } } }))
  assert.equal(zed.servers[0].transport, 'stdio')
  assert.equal(zed.servers[0].command, '/bin/server')
  assert.deepEqual(zed.servers[0].args, ['--x'])
  assert.deepEqual(zed.servers[0].env, { TOKEN: 'abc' })

  const bare = parseMcpConfig(JSON.stringify({ Remote: { serverUrl: 'https://r.example/mcp' } }))
  assert.equal(bare.servers[0].url, 'https://r.example/mcp')

  const single = parseMcpConfig(JSON.stringify({ name: 'One', url: 'https://one.example/mcp' }))
  assert.deepEqual(single.servers.map((s) => s.name), ['One'])

  const list = parseMcpConfig(JSON.stringify([{ name: 'A', url: 'https://a.example/mcp' }, 'https://b.example/mcp']))
  assert.deepEqual(list.servers.map((s) => s.name), ['A', 'b.example'])

  const headers = parseMcpConfig(JSON.stringify({ mcpServers: { A: { url: 'https://a.example/mcp', headers: [{ name: 'X-Env', value: 'prod' }, { name: 'Host', value: 'evil' }] } } }))
  assert.equal(headers.servers[0].headers, 'X-Env: prod')
})

test('import skips duplicates and explains unusable entries', () => {
  const existing = [{ id: 'x', name: 'Files', transport: 'http', url: 'https://files.example/mcp', headers: '', on: true }]
  const result = parseMcpConfig(JSON.stringify({
    mcpServers: {
      Files: { url: 'https://files.example/mcp/' },
      Broken: { type: 'stdio' },
      Other: { url: 'ftp://x.example/mcp' },
      NoScheme: { url: 'example.com/mcp' },
    },
  }), existing)
  assert.equal(result.servers.length, 0)
  const reasons = result.skipped.map((s) => `${s.name}:${s.reason}`).join('|')
  assert.match(reasons, /Files:already in the list/)
  assert.match(reasons, /Broken:a local server needs a "command"/)
  assert.match(reasons, /Other:the URL is not http\(s\)/)
  assert.match(reasons, /NoScheme:the URL is not http\(s\)/)
  assert.throws(() => parseMcpConfig('not json'), /not valid JSON/)
  assert.throws(() => parseMcpConfig('   '), /Paste an MCP configuration/)
  assert.equal(parseMcpConfig(JSON.stringify({ unrelated: true })).servers.length, 0)
})

test('import keeps disabled entries off and flags placeholders', () => {
  const result = parseMcpConfig(JSON.stringify({
    mcpServers: {
      Off: { url: 'https://off.example/mcp', disabled: true },
      Auth: { url: 'https://auth.example/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
    },
  }))
  assert.equal(result.servers.find((s) => s.name === 'Off').on, false)
  assert.ok(result.notes.some((note) => /placeholder/.test(note)))
  assert.ok(result.notes.some((note) => /disabled/.test(note)))
})

test('environment editor round-trips KEY=value lines', () => {
  assert.equal(envBlockOf({ A: '1', B: 'two' }), 'A=1\nB=two')
  assert.deepEqual(parseEnvBlock('A=1\n# comment\nBAD KEY=2\nB = two = three\n'), { A: '1', B: 'two = three' })
  assert.deepEqual(parseEnvBlock(''), {})
})

test('a schema with properties but no type is repaired', () => {
  const schema = { properties: { q: { type: 'string' } }, required: ['q'] }
  assert.deepEqual(toolParameters({ name: 'x', inputSchema: schema }), { ...schema, type: 'object' })
  assert.deepEqual(toolParameters({ name: 'x', inputSchema: { type: 'string' } }), { type: 'object', properties: {}, additionalProperties: true })
})

test('stdio client keeps one bridge session and closes it when done', async () => {
  const calls = []
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null })
    if (init.method === 'DELETE') return new Response(null, { status: 204 })
    const body = JSON.parse(init.body)
    if (body.message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const reply = body.message.method === 'initialize'
      ? { jsonrpc: '2.0', id: body.message.id, result: { protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: 'Local' } } }
      : { jsonrpc: '2.0', id: body.message.id, result: { tools: [{ name: 'ping' }] } }
    return new Response(JSON.stringify({ sessionId: 'sess-9', message: reply }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const client = new McpStdioClient({ command: '/bin/server', args: ['--stdio'], env: { A: '1' } }, 5000, fetchFn)
  const tools = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name), ['ping'])
  assert.equal(client.serverInfo.name, 'Local')
  assert.equal(calls[0].body.server.command, '/bin/server')
  assert.equal(calls[0].body.sessionId, undefined)
  assert.equal(calls[1].body.sessionId, 'sess-9')
  await client.close()
  assert.equal(calls.at(-1).method, 'DELETE')
  assert.match(calls.at(-1).url, /session=sess-9/)
})

test('stdio client explains a deployment without the local bridge', async () => {
  const client = new McpStdioClient({ command: '/bin/server', args: [], env: {} }, 5000, async () => new Response(null, { status: 404, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(() => client.listTools(), /Node host/)
})
