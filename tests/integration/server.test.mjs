import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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

test('extract blocks private targets at the HTTP layer', async () => {
  const res = await fetch(`${base}/api/extract?url=${encodeURIComponent('http://127.0.0.1:9/private')}`)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.code, 'bad_url')
})
