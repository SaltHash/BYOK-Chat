import test from 'node:test'
import assert from 'node:assert/strict'

const { parseCurlCommand, curlTokens } = await import('./curlImport.ts')
const { discoverEndpointModels, clearModelDiscoveryCache, modelDiscoveryCandidates } = await import('./catalog.ts')

const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('curlTokens handles quotes, continuations, and escaped characters', () => {
  assert.deepEqual(
    curlTokens(`curl https://example.com/v1/chat/completions \\\n  -H "Authorization: Bearer sk-test" \\\n  -d '{"model":"m","text":"hi"}'`),
    ['curl', 'https://example.com/v1/chat/completions', '-H', 'Authorization: Bearer sk-test', '-d', '{"model":"m","text":"hi"}'],
  )
  assert.deepEqual(curlTokens(`curl "https://example.com/a b" -H "X-Test: one\\"two"`), ['curl', 'https://example.com/a b', '-H', 'X-Test: one"two'])
  assert.deepEqual(curlTokens('curl https://example.com ^\n  -H "A: b"'), ['curl', 'https://example.com', '-H', 'A: b'])
})

test('parseCurlCommand imports the URL, key, format, and model', () => {
  const result = parseCurlCommand(`curl https://api.llmtech.eu/v1/chat/completions \\
  -H "Authorization: Bearer lt-trial-ba1ef28c6d32ed6980678d8d" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "nvidia/Qwen3.8-27B-NVFP4",
    "messages": [{"role": "user", "content": "Say hello"}],
    "stream": true
  }'`)
  assert.equal(result.ok, true)
  assert.equal(result.provider.baseUrl, 'https://api.llmtech.eu/v1')
  assert.equal(result.provider.type, 'openai')
  assert.equal(result.provider.key, 'lt-trial-ba1ef28c6d32ed6980678d8d')
  assert.equal(result.provider.auth, 'bearer')
  assert.equal(result.provider.model, 'nvidia/Qwen3.8-27B-NVFP4')
  assert.equal(result.provider.name, 'llmtech.eu')
  assert.deepEqual(result.provider.headers, {})
})

test('parseCurlCommand detects Anthropic Messages endpoints and x-api-key auth', () => {
  const result = parseCurlCommand(`curl https://api.anthropic.com/v1/messages?beta=true \\
  -H "x-api-key: sk-ant-test" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  --data-raw '{"model":"claude-sonnet-4-5","max_tokens":32,"messages":[]}'`)
  assert.equal(result.ok, true)
  assert.equal(result.provider.baseUrl, 'https://api.anthropic.com/v1')
  assert.equal(result.provider.type, 'anthropic')
  assert.equal(result.provider.auth, 'x-api-key')
  assert.equal(result.provider.key, 'sk-ant-test')
  assert.equal(result.provider.model, 'claude-sonnet-4-5')
  assert.equal(result.provider.name, 'Anthropic')
})

test('x-api-key alone does not turn an OpenAI-compatible endpoint into Anthropic', () => {
  const result = parseCurlCommand(`curl https://api.example.com/v1/chat/completions -H "x-api-key: key" -d '{"model":"m","messages":[]}'`)
  assert.equal(result.ok, true)
  assert.equal(result.provider.type, 'openai')
  assert.equal(result.provider.auth, 'x-api-key')
  assert.equal(result.provider.key, 'key')
})

test('parseCurlCommand imports custom auth headers and keeps extra headers', () => {
  const apiKey = parseCurlCommand(`curl https://api.example.com/v1/chat/completions \\\n  -H "api-key: azure-key" \\\n  -H "HTTP-Referer: https://app.example" \\\n  -H "X-Title: BYOK Chat" \\\n  -d '{"model":"m","messages":[]}'`)
  assert.equal(apiKey.ok, true)
  assert.equal(apiKey.provider.auth, 'api-key')
  assert.equal(apiKey.provider.key, 'azure-key')
  assert.deepEqual(apiKey.provider.headers, { 'http-referer': 'https://app.example', 'x-title': 'BYOK Chat' })

  const basic = parseCurlCommand(`curl https://api.example.com/v1/chat/completions -u 'user:pass' -d '{"model":"m"}'`)
  assert.equal(basic.ok, true)
  assert.equal(basic.provider.auth, 'basic')
  assert.equal(basic.provider.key, 'user:pass')

  const encoded = parseCurlCommand(`curl https://api.example.com/v1/chat/completions -H "Authorization: Basic ${btoa('user:pass')}" -d '{"model":"m"}'`)
  assert.equal(encoded.ok, true)
  assert.equal(encoded.provider.auth, 'basic')
  assert.equal(encoded.provider.key, 'user:pass')
})

test('an unusual authorization scheme is preserved as a custom header', () => {
  const result = parseCurlCommand(`curl https://api.example.com/v1/chat/completions -H "Authorization: Token abc" -d '{"model":"m"}'`)
  assert.equal(result.ok, true)
  assert.equal(result.provider.auth, 'none')
  assert.equal(result.provider.key, '')
  assert.equal(result.provider.headers.Authorization, 'Token abc')
  assert.match(result.provider.warnings.join(' '), /unusual authorization/)
})

test('parseCurlCommand reports unusable input instead of adding a partial provider', () => {
  assert.equal(parseCurlCommand('').ok, false)
  assert.equal(parseCurlCommand('wget https://example.com').ok, false)
  const badBody = parseCurlCommand(`curl https://example.com/v1/chat/completions -d 'not json'`)
  assert.equal(badBody.ok, false)
  assert.match(badBody.error, /valid JSON/)
  const noUrl = parseCurlCommand('curl -H "Authorization: Bearer x"')
  assert.equal(noUrl.ok, false)
})

test('model discovery tries common paths, remembers the winner, and skips cached failures', async () => {
  clearModelDiscoveryCache()
  const calls = []
  const fetchFn = async (url) => {
    calls.push(url)
    if (url === 'https://discovery-ok.example/models') return new Response('', { status: 404 })
    if (url === 'https://discovery-ok.example/v1/models') return json({ data: [{ id: 'model-a' }] })
    return new Response('', { status: 404 })
  }
  const first = await discoverEndpointModels({ url: 'https://discovery-ok.example', type: 'openai', key: 'k' }, fetchFn)
  assert.equal(first.entries.length, 1)
  assert.equal(first.workingUrl, 'https://discovery-ok.example/v1/models')
  assert.deepEqual(calls, ['https://discovery-ok.example/models', 'https://discovery-ok.example/v1/models'])

  calls.length = 0
  const second = await discoverEndpointModels({ url: 'https://discovery-ok.example', type: 'openai', key: 'k' }, fetchFn)
  assert.equal(second.entries.length, 1)
  assert.deepEqual(calls, ['https://discovery-ok.example/v1/models'])
})

test('all permanent model-list failures are cached and never retried', async () => {
  clearModelDiscoveryCache()
  const calls = []
  const fetchFn = async (url) => { calls.push(url); return new Response('', { status: 404 }) }
  const first = await discoverEndpointModels({ url: 'https://discovery-dead.example', type: 'openai' }, fetchFn)
  assert.equal(first.entries.length, 0)
  assert.equal(calls.length, modelDiscoveryCandidates('https://discovery-dead.example', 'openai').length)
  calls.length = 0
  const second = await discoverEndpointModels({ url: 'https://discovery-dead.example', type: 'openai' }, fetchFn)
  assert.equal(second.entries.length, 0)
  assert.equal(calls.length, 0)
  assert.match(second.error, /skipped/)
})

test('Anthropic discovery sends x-api-key and never a bearer token', async () => {
  clearModelDiscoveryCache()
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return json({ data: [{ id: 'claude-test' }] })
  }
  const result = await discoverEndpointModels({ url: 'https://anthropic-proxy.example/v1', type: 'anthropic', key: 'sk-ant' }, fetchFn)
  assert.equal(result.entries[0].id, 'claude-test')
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant')
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01')
})

test('discovery uses the chosen auth method and extra headers', async () => {
  clearModelDiscoveryCache()
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return json({ data: [{ id: 'model-a' }] })
  }
  const result = await discoverEndpointModels({
    url: 'https://discovery-auth.example/v1',
    type: 'openai',
    key: 'custom-key',
    auth: 'api-key',
    headers: 'X-Catalog: yes',
  }, fetchFn)
  assert.equal(result.entries.length, 1)
  assert.equal(calls[0].init.headers['api-key'], 'custom-key')
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.equal(calls[0].init.headers['X-Catalog'], 'yes')
})

test('clearing a cached endpoint makes discovery probe it again', async () => {
  clearModelDiscoveryCache()
  const calls = []
  const fetchFn = async (url) => { calls.push(url); return new Response('', { status: 404 }) }
  const url = 'https://discovery-retry.example'
  await discoverEndpointModels({ url, type: 'openai' }, fetchFn)
  const first = calls.length
  await discoverEndpointModels({ url, type: 'openai' }, fetchFn)
  assert.equal(calls.length, first)
  clearModelDiscoveryCache(url)
  await discoverEndpointModels({ url, type: 'openai' }, fetchFn)
  assert.equal(calls.length, first * 2)
})

test('a changed key clears cached auth failures', async () => {
  clearModelDiscoveryCache()
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return init?.headers?.authorization === 'Bearer good' ? json({ data: [{ id: 'ok' }] }) : new Response('', { status: 401 })
  }
  const bad = await discoverEndpointModels({ url: 'https://discovery-key.example', type: 'openai', key: 'bad' }, fetchFn)
  assert.equal(bad.entries.length, 0)
  const good = await discoverEndpointModels({ url: 'https://discovery-key.example', type: 'openai', key: 'good' }, fetchFn)
  assert.equal(good.entries[0].id, 'ok')
})
