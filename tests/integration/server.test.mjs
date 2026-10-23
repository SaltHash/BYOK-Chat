import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// Full-stack integration: boots the real server.mjs as a child process and
// exercises HTTP routing, search error mapping, sync push/pull and
// extract SSRF guards. No mocks: failures here mean the wiring is broken.
// Uses an ephemeral port and empty static dir; forces memory sync backend by
// unsetting DATABASE_URL in the child.

function freePort() {
  return new Promise((resolve, reject) => {
    import('node:net').then(({ createServer }) => {
      const s = createServer()
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address()
        s.close(() => resolve(port))
      })
    }, reject)
  })
}

async function waitForHealth(base, timeoutMs = 10_000) {
  const start = Date.now()
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) return await res.json()
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('server did not become healthy in time')
    await new Promise((r) => setTimeout(r, 100))
  }
}

const staticDir = mkdtempSync(join(tmpdir(), 'byok-static-'))
writeFileSync(join(staticDir, 'index.html'), '<html><body>byok</body></html>')

const port = await freePort()
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    STATIC_DIR: staticDir,
    DATABASE_URL: '',
    TINYFISH_API_KEY: '',
    SEARCH_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stderr.on('data', () => {})
await waitForHealth(base)

test.after(() => {
  child.kill('SIGTERM')
})

const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('health reports search status', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.searchConfigured, true)
})

test('search rejects empty query before touching providers', async () => {
  const res = await post('/api/search', { query: '   ' })
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.match(data.error, /Query must be/)
})

test('search surfaces missing-key as 400 with stable code', async () => {
  const res = await post('/api/search', { query: 'hello', provider: 'tinyfish' })
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.code, 'missing_key')
  assert.equal(data.provider, 'tinyfish')
  assert.equal(data.retryable, false)
})

test('search accepts per-request tuning bounds', async () => {
  const res = await post('/api/search', { query: 'hello', provider: 'tinyfish', count: 99, maxSnippetChars: 99, evidenceBudget: 99, timeoutMs: 99, maxRetries: 99 })
  // Still a missing-key 400: tuning must not bypass key checks or crash.
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.code, 'missing_key')
})

test('sync push then pull round-trips over HTTP; wrong secret rejected', async () => {
  const id = randomBytes(12).toString('base64url').slice(0, 16).padEnd(16, 'A')
  const secret = randomBytes(33).toString('base64url').slice(0, 43).padEnd(43, 'a')
  const token = `byok1-${id}-${secret}`
  const payload = { v: 4, storeVersion: 18, settings: { themeMode: 'dark' }, chats: [], workspaces: {}, selectedRevision: {} }
  const pushed = await post('/api/sync/push', { token, payload })
  assert.equal(pushed.status, 200)
  assert.equal((await pushed.json()).ok, true)
  const pulled = await fetch(`${base}/api/sync/pull`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(pulled.status, 200)
  assert.deepEqual((await pulled.json()).payload.settings, { themeMode: 'dark' })
  const wrong = await fetch(`${base}/api/sync/pull`, { headers: { authorization: `Bearer byok1-${id}-${'x'.repeat(43)}` } })
  assert.equal(wrong.status, 401)
  // Tokens in the URL are refused so they never reach access logs.
  const inUrl = await fetch(`${base}/api/sync/pull?token=${encodeURIComponent(token)}`)
  assert.equal(inUrl.status, 401)
})

test('sync pull without token is 401, not 500', async () => {
  const res = await fetch(`${base}/api/sync/pull`)
  assert.equal(res.status, 401)
  const data = await res.json()
  assert.equal(data.code, 'bad_token')
})

test('share create then get round-trips over HTTP; cross-origin writes refused', async () => {
  const created = await post('/api/share', { chat: { title: 'Shared over HTTP', msgs: [{ r: 'user', t: 'hello' }, { r: 'assistant', t: 'hi', by: 'model' }] } })
  assert.equal(created.status, 200)
  const { id, url, token } = await created.json()
  assert.match(id, /^[A-Za-z0-9_-]{12}$/)
  assert.equal(url, `/api/share/${id}`)
  assert.equal(typeof token, 'string')
  const got = await fetch(`${base}${url}`)
  assert.equal(got.status, 200)
  const snap = await got.json()
  assert.equal(snap.title, 'Shared over HTTP')
  assert.deepEqual(snap.msgs.map((m) => m.r), ['user', 'assistant'])
  assert.equal(snap.private, false)
  const evil = await fetch(`${base}/api/share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ chat: { msgs: [{ r: 'user', t: 'x' }] } }),
  })
  assert.equal(evil.status, 403)
  const missing = await fetch(`${base}/api/share/aaaaaaaaaaaa`)
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).code, 'not_found')
})

test('private shares need the owner token; owners can update their link', async () => {
  const created = await post('/api/share', { chat: { title: 'Private', msgs: [{ r: 'user', t: 'one' }] }, private: true })
  assert.equal(created.status, 200)
  const { id, token } = await created.json()
  const denied = await fetch(`${base}/api/share/${id}`)
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).code, 'private')
  const allowed = await fetch(`${base}/api/share/${id}`, { headers: { 'x-share-token': token } })
  assert.equal(allowed.status, 200)
  assert.equal((await allowed.json()).title, 'Private')
  // A stranger cannot update the snapshot without the token.
  const stranger = await fetch(`${base}/api/share/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat: { msgs: [{ r: 'user', t: 'hijack' }] } }),
  })
  assert.equal(stranger.status, 403)
  // The owner can update and make it public again.
  const updated = await fetch(`${base}/api/share/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-share-token': token },
    body: JSON.stringify({ chat: { title: 'Updated', msgs: [{ r: 'user', t: 'two' }] }, private: false }),
  })
  assert.equal(updated.status, 200)
  const after = await fetch(`${base}/api/share/${id}`)
  assert.equal(after.status, 200)
  const snap = await after.json()
  assert.equal(snap.title, 'Updated')
  assert.equal(snap.private, false)
})

test('extract blocks private targets at the HTTP layer', async () => {
  const res = await fetch(`${base}/api/extract?url=${encodeURIComponent('http://127.0.0.1:9/private')}`)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.code, 'bad_url')
})

test('sync status reports the backend; unknown sync routes 404 as JSON', async () => {
  const status = await fetch(`${base}/api/sync/status`)
  assert.equal(status.status, 200)
  assert.deepEqual(await status.json(), { ok: true, backend: 'memory', configured: false, neonConfigured: false, shared: false })
  const unknown = await fetch(`${base}/api/sync/not-a-route`)
  assert.equal(unknown.status, 404)
  assert.match(unknown.headers.get('content-type') || '', /application\/json/)
})

test('cross-origin sync writes are refused before any storage happens', async () => {
  const token = `byok1-${'a'.repeat(16)}-${'b'.repeat(43)}`
  const res = await fetch(`${base}/api/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ token, payload: { v: 4 } }),
  })
  assert.equal(res.status, 403)
  assert.match((await res.json()).error, /Cross-origin/)
})

// --- /api/proxy -----------------------------------------------------------
// A real upstream HTTP server, reached only through the relay: this is the
// path that makes a provider with no CORS headers usable from a browser.
let lastRelay = null
const upstream = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  lastRelay = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream=1' })
    return res.end(JSON.stringify({ data: [{ id: 'mock/model' }] }))
  }
  if (req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' })
    res.write('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n')
    res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n')
    return res.end('data: [DONE]\n\n')
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{"error":"no mock route"}')
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`
test.after(() => { upstream.close() })

const relayUrl = (target) => `${base}/api/proxy?url=${encodeURIComponent(target)}`

test('proxy relays a POST to a provider with no CORS support, streaming SSE', async () => {
  const res = await fetch(relayUrl(`${upstreamOrigin}/v1/chat/completions`), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer relay-key',
      origin: base,
      cookie: 'should=not-forward',
    },
    body: JSON.stringify({ model: 'mock', stream: true }),
  })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/)
  // Same-origin answer: upstream CORS headers and cookies must not leak.
  assert.equal(res.headers.get('access-control-allow-origin'), null)
  assert.equal(res.headers.get('set-cookie'), null)
  const text = await res.text()
  assert.match(text, /"hel"/)
  assert.match(text, /\[DONE\]/)
  assert.equal(lastRelay.method, 'POST')
  assert.equal(lastRelay.headers.authorization, 'Bearer relay-key')
  assert.equal(lastRelay.headers.origin, undefined)
  assert.equal(lastRelay.headers.cookie, undefined)
  assert.equal(lastRelay.body, JSON.stringify({ model: 'mock', stream: true }))
})

test('proxy relays GET discovery requests', async () => {
  const res = await fetch(relayUrl(`${upstreamOrigin}/v1/models`))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { data: [{ id: 'mock/model' }] })
})

test('proxy refuses cross-origin writes and non-http targets', async () => {
  const evil = await fetch(relayUrl(`${upstreamOrigin}/v1/chat/completions`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: '{}',
  })
  assert.equal(evil.status, 403)
  assert.equal((await evil.json()).code, 'cross_origin')

  const bad = await fetch(relayUrl('file:///etc/passwd'))
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).code, 'bad_target')
})

test('spoofing proxy headers cannot bypass the per-IP search rate limit', async () => {
  // The Node server must key the limit on the socket address, not on a header
  // any client can set. Requests carry a fresh cf-connecting-ip every time.
  let retryAfter = ''
  for (let i = 0; i < 60 && !retryAfter; i++) {
    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `spoof-${i}` },
      body: JSON.stringify({ query: `rate limit probe ${i}` }),
    })
    if (res.status === 429) retryAfter = res.headers.get('retry-after') || ''
    else assert.equal(res.status, 400) // missing_key: no search key is configured
  }
  assert.equal(retryAfter, '60')
})
