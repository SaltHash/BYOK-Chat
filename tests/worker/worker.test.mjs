import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import worker from '../../worker/index.mjs'

// Worker-level tests: drive worker.fetch with real Request/Response objects,
// a stubbed ASSETS binding and a local mock search provider. These assert the
// deployed routing contract: JSON API answers, no HTML fallback, no secret
// leakage, and structured upstream failure mapping.

let lastProviderRequest = null
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) }

const mock = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  lastProviderRequest = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }
  const path = new URL(req.url || '/', 'http://mock').pathname
  if (path === '/search-ok') return json(res, 200, { results: [{ title: 'Mock result', url: 'https://example.com/mock', snippet: 'Mock snippet text' }] })
  if (path === '/search-auth') return json(res, 401, { error: 'invalid credentials' })
  if (path === '/search-billing') return json(res, 402, { error: 'payment required' })
  if (path === '/search-500') return json(res, 500, { error: 'boom' })
  if (path === '/search-429') return json(res, 429, { error: 'slow down' })
  if (path === '/search-badjson') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('not json') }
  return json(res, 404, { error: 'no mock route' })
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const mockOrigin = `http://127.0.0.1:${mock.address().port}`

test.after(() => { mock.close() })

let ipCounter = 0
function call(path, init = {}, env = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', `worker-test-${++ipCounter}`)
  return worker.fetch(new Request(`https://app.example.com${path}`, { ...init, headers }), env)
}
const post = (path, body, env = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }, env)
const searchEnv = (url) => ({ SEARCH_API_URL: `${mockOrigin}${url}` })
const isJson = (res) => assert.match(res.headers.get('content-type') || '', /^application\/json/)

test('health returns provider status from worker bindings', async () => {
  const res = await call('/api/health')
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.searchConfigured, true)
  assert.equal(data.apiConfigured, false)
  assert.equal(data.apiProviders.tinyfish.configured, false)
  const configured = await (await call('/api/health', {}, { EXA_API_KEY: 'secret-exa' })).json()
  assert.equal(configured.apiConfigured, true)
  assert.equal(configured.apiProviders.exa.configured, true)
})

test('health rejects non-GET methods with 405 and Allow', async () => {
  const res = await post('/api/health', {})
  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'GET, HEAD')
  isJson(res)
})

test('proxy relays through the Worker for providers without CORS', async () => {
  const target = `${mockOrigin}/search-ok`
  const res = await call(`/api/proxy?url=${encodeURIComponent(target)}`, {}, { PROXY_ALLOWED_HOSTS: '127.0.0.1' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).results[0].title, 'Mock result')
  assert.equal(lastProviderRequest.url, '/search-ok')
})

test('proxy refuses a target outside its allowlist', async () => {
  const target = `${mockOrigin}/search-ok`
  const res = await call(`/api/proxy?url=${encodeURIComponent(target)}`, {}, { PROXY_ALLOWED_HOSTS: 'openrouter.ai' })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'target_not_allowed')
})

test('unknown API paths return JSON 404, never the SPA HTML', async () => {
  for (const init of [{}, { method: 'POST' }]) {
    const res = await call('/api/definitely-not-real', init)
    assert.equal(res.status, 404)
    isJson(res)
    assert.equal((await res.json()).error, 'Not found')
  }
})

test('GET /api/search returns 405 with Allow: POST', async () => {
  const res = await call('/api/search')
  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'POST')
  isJson(res)
})

test('search rejects malformed JSON, empty queries and oversized bodies', async () => {
  const badJson = await post('/api/search', '{ not json', {})
  assert.equal(badJson.status, 400)
  assert.equal((await badJson.json()).error, 'Expected JSON with a query field')
  const empty = await post('/api/search', { query: '   ' }, {})
  assert.equal(empty.status, 400)
  assert.match((await empty.json()).error, /Query must be/)
  const long = await post('/api/search', { query: 'x'.repeat(401) }, {})
  assert.equal(long.status, 400)
  const big = await post('/api/search', { query: 'hello', pad: 'y'.repeat(20_000) }, {})
  assert.equal(big.status, 413)
})

test('search without any configured key reports missing_key, not an outage', async () => {
  const res = await post('/api/search', { query: 'returns missing key' }, searchEnv('/search-ok'))
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.code, 'missing_key')
  assert.equal(data.provider, 'tinyfish')
  assert.equal(data.retryable, false)
})

test('search succeeds with a server-side key and matches the frontend contract', async () => {
  const env = { ...searchEnv('/search-ok'), TINYFISH_API_KEY: 'server-side-key' }
  const res = await post('/api/search', { query: 'worker search contract', provider: 'tinyfish', count: 3 }, env)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.query, 'worker search contract')
  assert.equal(data.provider, 'tinyfish')
  assert.equal(data.mode, 'api')
  assert.ok(!Number.isNaN(Date.parse(data.searchedAt)))
  assert.deepEqual(data.results.map((x) => x.id), ['S1'])
  assert.equal(data.results[0].url, 'https://example.com/mock')
  assert.equal(lastProviderRequest.headers['x-api-key'], 'server-side-key')
  // The key must never be echoed back to the client.
  assert.ok(!JSON.stringify(data).includes('server-side-key'))
})

test('a browser-supplied key takes precedence over the server key', async () => {
  const env = { ...searchEnv('/search-ok'), TINYFISH_API_KEY: 'server-side-key' }
  const res = await post('/api/search', { query: 'bring your own key', provider: 'tinyfish', apiKey: 'browser-key' }, env)
  assert.equal(res.status, 200)
  assert.equal(lastProviderRequest.headers['x-api-key'], 'browser-key')
})

test('search maps upstream failures to structured statuses', async () => {
  const cases = [
    ['/search-auth', 502, 'upstream_auth', false],
    ['/search-billing', 502, 'billing', false],
    ['/search-500', 503, 'upstream_unavailable', true],
    ['/search-badjson', 502, 'bad_response', false],
  ]
  for (const [route, status, code, retryable] of cases) {
    const env = { ...searchEnv(route), TINYFISH_API_KEY: 'server-side-key' }
    const res = await post('/api/search', { query: `upstream ${route}`, provider: 'tinyfish', maxRetries: 0 }, env)
    assert.equal(res.status, status, `${route} status`)
    const data = await res.json()
    assert.equal(data.code, code, `${route} code`)
    assert.equal(data.retryable, retryable, `${route} retryable`)
    assert.equal(data.provider, 'tinyfish')
    assert.ok(!String(data.error).includes('server-side-key'))
  }
})

test('search maps rate limits to 429 with a retry hint', async () => {
  const env = { ...searchEnv('/search-429'), TINYFISH_API_KEY: 'server-side-key' }
  const res = await post('/api/search', { query: 'upstream rate limit', provider: 'tinyfish', maxRetries: 0 }, env)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('retry-after'), '5')
  assert.equal((await res.json()).code, 'rate_limited')
})

test('search reports unreachable providers as a 503 network failure', async () => {
  const env = { TINYFISH_API_KEY: 'server-side-key', SEARCH_API_URL: 'http://127.0.0.1:1' }
  const res = await post('/api/search', { query: 'network down', provider: 'tinyfish', maxRetries: 0 }, env)
  assert.equal(res.status, 503)
  assert.equal((await res.json()).code, 'network')
})

test('cross-origin search requests are refused', async () => {
  const res = await call('/api/search', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ query: 'cross origin' }) }, searchEnv('/search-ok'))
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, 'Cross-origin request refused')
})

test('search cache serves a repeated query without touching the provider', async () => {
  const env = { ...searchEnv('/search-ok'), TINYFISH_API_KEY: 'server-side-key' }
  const body = { query: 'cache round trip', provider: 'tinyfish' }
  assert.equal((await post('/api/search', body, env)).status, 200)
  lastProviderRequest = null
  const second = await post('/api/search', body, env)
  assert.equal(second.status, 200)
  assert.equal(lastProviderRequest, null)
})

test('extract rejects unsupported methods, missing urls and private targets', async () => {
  const wrongMethod = await post('/api/extract', {})
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET, HEAD')
  const missing = await call('/api/extract')
  assert.equal(missing.status, 400)
  assert.equal((await missing.json()).error, 'Missing url parameter')
  const privateTarget = await call(`/api/extract?url=${encodeURIComponent('http://127.0.0.1:9/private')}`)
  assert.equal(privateTarget.status, 400)
  assert.equal((await privateTarget.json()).code, 'bad_url')
})

test('the reader route refuses private targets and the wrong method', async () => {
  const wrong = await call('/api/reader')
  assert.equal(wrong.status, 405)
  assert.equal(wrong.headers.get('allow'), 'POST')
  const privateTarget = await post('/api/reader', { url: 'http://127.0.0.1:9/private' })
  assert.equal(privateTarget.status, 400)
  assert.equal((await privateTarget.json()).code, 'bad_url')
})

test('extract reads a public page through the worker', async () => {
  // The extract SSRF guard blocks loopback hosts, so stub the outbound fetch
  // (as server/search.mjs tests do) while the request still flows through
  // the real worker routing and response adaptation.
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('example.com')) {
      return new Response('<html><head><title>Mock Article</title></head><body><p>First paragraph of the mock article.</p></body></html>', { headers: { 'content-type': 'text/html' } })
    }
    return realFetch(url, init)
  }
  try {
    const res = await call(`/api/extract?url=${encodeURIComponent('https://example.com/article')}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.title, 'Mock Article')
    assert.match(data.text, /First paragraph/)
    assert.ok(!Number.isNaN(Date.parse(data.fetchedAt)))
  } finally { globalThis.fetch = realFetch }
})

test('sync reports the memory backend without DATABASE_URL and 404s unknown routes', async () => {
  const status = await call('/api/sync/status')
  assert.equal(status.status, 200)
  const data = await status.json()
  assert.deepEqual(data, { ok: true, backend: 'memory', configured: false, neonConfigured: false, shared: false })
  const unknown = await call('/api/sync/not-a-route')
  assert.equal(unknown.status, 404)
  isJson(unknown)
})

test('sync push then pull round-trips through the worker', async () => {
  const id = randomBytes(12).toString('base64url').slice(0, 16).padEnd(16, 'A')
  const secret = randomBytes(33).toString('base64url').slice(0, 43).padEnd(43, 'a')
  const token = `byok1-${id}-${secret}`
  const payload = { v: 4, storeVersion: 18, settings: { themeMode: 'dark' }, chats: [], workspaces: {}, selectedRevision: {} }
  const pushed = await post('/api/sync/push', { token, payload })
  assert.equal(pushed.status, 200)
  assert.equal((await pushed.json()).ok, true)
  const pulled = await call('/api/sync/pull', { headers: { authorization: `Bearer ${token}` } })
  assert.equal(pulled.status, 200)
  assert.deepEqual((await pulled.json()).payload.settings, { themeMode: 'dark' })
  const wrong = await call('/api/sync/pull', { headers: { authorization: `Bearer byok1-${id}-${'x'.repeat(43)}` } })
  assert.equal(wrong.status, 401)
  // Tokens in the URL are refused so they never reach access logs.
  const inUrl = await call(`/api/sync/pull?token=${encodeURIComponent(token)}`)
  assert.equal(inUrl.status, 401)
  const noToken = await call('/api/sync/pull')
  assert.equal(noToken.status, 401)
  assert.equal((await noToken.json()).code, 'bad_token')
  const badJson = await post('/api/sync/push', '{ nope')
  assert.equal(badJson.status, 400)
  assert.equal((await badJson.json()).code, 'bad_json')
})

test('non-API requests fall back to the ASSETS binding', async () => {
  const env = { ASSETS: { fetch: async () => new Response('<div id="root"></div>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) } }
  const res = await call('/some/spa/route', {}, env)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
  assert.match(await res.text(), /id="root"/)
})

test('a missing asset-like path 404s while extensionless paths get the shell', async () => {
  // Mirrors server.mjs: `not_found_handling: "none"` makes the asset layer 404
  // missing files, and the Worker must not answer a missing .js with HTML.
  const env = {
    ASSETS: {
      fetch: async (req) => {
        const path = new URL(req.url).pathname
        if (path === '/index.html') return new Response('<div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
        return new Response('not found', { status: 404 })
      },
    },
  }
  const asset = await call('/assets/missing.js', {}, env)
  assert.equal(asset.status, 404)
  isJson(asset)
  assert.equal((await asset.json()).error, 'Not found')

  const route = await call('/some/spa/route', {}, env)
  assert.equal(route.status, 200)
  assert.match(route.headers.get('content-type') || '', /text\/html/)
  assert.match(await route.text(), /id="root"/)
})

test('cross-origin sync writes are refused, token or not', async () => {
  const token = `byok1-${'a'.repeat(16)}-${'b'.repeat(43)}`
  const crossOrigin = (path, body) => call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify(body),
  })
  const push = await crossOrigin('/api/sync/push', { token, payload: { v: 4 } })
  assert.equal(push.status, 403)
  assert.match((await push.json()).error, /Cross-origin/)
  const pull = await crossOrigin('/api/sync/pull', { token })
  assert.equal(pull.status, 403)
})

test('sync routes are rate limited per IP', async () => {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': 'sync-limit-squad' }
  const body = JSON.stringify({ token: `byok1-${'c'.repeat(16)}-${'d'.repeat(43)}`, payload: { v: 4, storeVersion: 18, settings: {}, chats: [], workspaces: {}, selectedRevision: {} } })
  for (let i = 0; i < 30; i++) {
    const res = await worker.fetch(new Request('https://app.example.com/api/sync/push', { method: 'POST', headers, body }), {})
    assert.equal(res.status, 200, `push ${i} status`)
  }
  const blocked = await worker.fetch(new Request('https://app.example.com/api/sync/push', { method: 'POST', headers, body }), {})
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('retry-after'), '60')
})

test('per-IP rate limit eventually answers 429', async () => {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': 'rate-limit-squad' }
  const env = { ...searchEnv('/search-ok'), TINYFISH_API_KEY: 'server-side-key' }
  for (let i = 0; i < 30; i++) {
    const res = await worker.fetch(new Request('https://app.example.com/api/search', { method: 'POST', headers, body: JSON.stringify({ query: `rate limit ${i}`, provider: 'tinyfish' }) }), env)
    assert.equal(res.status, 200)
  }
  const blocked = await worker.fetch(new Request('https://app.example.com/api/search', { method: 'POST', headers, body: JSON.stringify({ query: 'rate limit final', provider: 'tinyfish' }) }), env)
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get('retry-after'), '60')
})
