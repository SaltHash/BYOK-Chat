#!/usr/bin/env node
/* End-to-end smoke test for the Cloudflare Workers + Static Assets
 * deployment model. Boots the real `wrangler dev` runtime (workerd) with
 * wrangler.jsonc, then exercises the deployed HTTP surface over the network:
 * static files, SPA fallback, /api/* routing, error handling and sync.
 *
 * Run with `npm run test:worker` (requires a prior `npm run build`).
 * This is intentionally not part of `npm test` because it boots workerd. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const wranglerBin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
if (!existsSync(wranglerBin)) {
  console.error('wrangler is not installed. Run `npm install` first.')
  process.exit(1)
}
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/ is missing. Run `npm run build` first.')
  process.exit(1)
}

const freePort = () => new Promise((resolvePort, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address()
    s.close(() => resolvePort(port))
  })
})

const port = await freePort()
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, [wranglerBin, 'dev', '--port', String(port), '--ip', '127.0.0.1'], {
  cwd: root,
  env: { ...process.env, CI: '1', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (d) => { output += d })
child.stderr.on('data', (d) => { output += d })

async function waitReady(timeoutMs = 120_000) {
  const start = Date.now()
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch {}
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early (code ${child.exitCode})`)
    if (Date.now() - start > timeoutMs) throw new Error('wrangler dev did not become ready in time')
    await new Promise((r) => setTimeout(r, 250))
  }
}

const results = []
async function check(name, fn) {
  try { await fn(); results.push(name); console.log(`✔ ${name}`) }
  catch (error) { results.push(null); console.log(`✖ ${name}\n  ${error?.message || error}`) }
}
const get = (path, init) => fetch(`${base}${path}`, init)
const postJson = (path, body) => get(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const assert = (cond, message) => { if (!cond) throw new Error(message) }
const assertJson = (res) => assert(/^application\/json/.test(res.headers.get('content-type') || ''), `expected JSON, got ${res.headers.get('content-type')}`)

function wranglerOutputTail(lines = 30) {
  return output.split('\n').slice(-lines).join('\n')
}

try {
  await waitReady()

  await check('GET / serves the built SPA shell as a static asset', async () => {
    const res = await get('/')
    assert(res.status === 200, `status ${res.status}`)
    assert(/text\/html/.test(res.headers.get('content-type') || ''), `content-type ${res.headers.get('content-type')}`)
    assert((await res.text()).includes('id="root"'), 'missing root element')
  })

  await check('SPA fallback serves index.html for unknown client routes', async () => {
    const res = await get('/chats/example-route')
    assert(res.status === 200, `status ${res.status}`)
    assert((await res.text()).includes('id="root"'), 'missing root element')
  })

  await check('missing static assets fall back to the SPA shell on Cloudflare (documented platform behavior)', async () => {
    // Cloudflare's `not_found_handling: single-page-application` answers the
    // SPA shell for unknown paths, including asset-like ones. The Node server
    // (server.mjs) 404s missing asset-like paths instead; this check pins the
    // deployed Worker contract so the difference stays intentional.
    const res = await get('/assets/definitely-missing.js')
    assert(res.status === 200, `status ${res.status}`)
    assert(await res.text(), 'expected the SPA shell body')
  })

  await check('built JS/CSS assets are served with correct types', async () => {
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
    assert(script, 'no hashed script in dist/index.html')
    const res = await get(script)
    assert(res.status === 200, `${script} status ${res.status}`)
    assert(/javascript/.test(res.headers.get('content-type') || ''), `${script} content-type ${res.headers.get('content-type')}`)
    const css = readdirSync(join(root, 'dist', 'assets')).find((f) => f.endsWith('.css'))
    assert(css, 'no css asset found')
    const cssRes = await get(`/assets/${css}`)
    assert(cssRes.status === 200 && /css/.test(cssRes.headers.get('content-type') || ''), `css ${cssRes.status} ${cssRes.headers.get('content-type')}`)
  })

  await check('GET /api/health is served by the Worker', async () => {
    const res = await get('/api/health')
    assert(res.status === 200, `status ${res.status}`)
    assertJson(res)
    const data = await res.json()
    assert(data.ok === true && data.apiProviders?.tinyfish, 'unexpected health body')
  })

  await check('POST /api/health returns 405 JSON with Allow: GET, HEAD', async () => {
    const res = await postJson('/api/health', {})
    assert(res.status === 405, `status ${res.status}`)
    assert(res.headers.get('allow') === 'GET, HEAD', `allow ${res.headers.get('allow')}`)
    assertJson(res)
  })

  await check('POST /api/search rejects malformed JSON and empty queries', async () => {
    const bad = await postJson('/api/search', '{ not json')
    assert(bad.status === 400, `malformed status ${bad.status}`)
    assertJson(bad)
    const empty = await postJson('/api/search', { query: '   ' })
    assert(empty.status === 400, `empty status ${empty.status}`)
    const data = await empty.json()
    assert(/Query must be/.test(data.error), `unexpected error: ${data.error}`)
  })

  await check('POST /api/search reports a missing provider key (no local secrets)', async () => {
    const res = await postJson('/api/search', { query: 'smoke test missing key', provider: 'tinyfish' })
    if (res.status === 400) {
      const data = await res.json()
      assert(data.code === 'missing_key', `expected missing_key, got ${data.code}`)
      assert(data.retryable === false, 'missing_key must not be retryable')
    } else {
      // A local .dev.vars provides a server key; the important part is that
      // the request reached the Worker and got a JSON answer (never HTML).
      assert([200, 429, 502, 503].includes(res.status), `unexpected status ${res.status}`)
      assertJson(res)
      console.log('  (local .dev.vars provides a server key; missing-key assertion skipped)')
    }
  })

  await check('GET /api/search returns 405 JSON with Allow: POST', async () => {
    const res = await get('/api/search')
    assert(res.status === 405, `status ${res.status}`)
    assert(res.headers.get('allow') === 'POST', `allow ${res.headers.get('allow')}`)
    assertJson(res)
  })

  await check('unknown API paths return JSON 404, never index.html', async () => {
    const res = await get('/api/definitely-not-real')
    assert(res.status === 404, `status ${res.status}`)
    assertJson(res)
    const body = await res.text()
    assert(!body.includes('<div id="root">'), 'API fallback returned the SPA HTML')
    const bare = await postJson('/api', {})
    assert(bare.status === 404, `/api status ${bare.status}`)
    assertJson(bare)
  })

  await check('POST /api/extract returns 405 JSON with Allow: GET, HEAD', async () => {
    const res = await postJson('/api/extract', {})
    assert(res.status === 405, `status ${res.status}`)
    assert(res.headers.get('allow') === 'GET, HEAD', `allow ${res.headers.get('allow')}`)
    assertJson(res)
  })

  await check('GET /api/extract blocks private targets with bad_url', async () => {
    const res = await get(`/api/extract?url=${encodeURIComponent('http://127.0.0.1:9/private')}`)
    assert(res.status === 400, `status ${res.status}`)
    const data = await res.json()
    assert(data.code === 'bad_url', `expected bad_url, got ${data.code}`)
  })

  await check('sync push/pull round-trips through the Worker', async () => {
    const id = 'smoketest'.padEnd(16, 'A').slice(0, 16)
    const secret = 'b'.repeat(43)
    const token = `byok1-${id}-${secret}`
    const payload = { v: 4, storeVersion: 18, settings: { themeMode: 'dark' }, chats: [], workspaces: {}, selectedRevision: {} }
    const pushed = await postJson('/api/sync/push', { token, payload })
    assert(pushed.status === 200, `push status ${pushed.status}`)
    assertJson(pushed)
    const pulled = await get('/api/sync/pull', { headers: { authorization: `Bearer ${token}` } })
    assert(pulled.status === 200, `pull status ${pulled.status}`)
    const data = await pulled.json()
    assert(data.payload?.settings?.themeMode === 'dark', 'payload did not round-trip')
    const wrong = await get('/api/sync/pull', { headers: { authorization: `Bearer byok1-${id}-${'x'.repeat(43)}` } })
    assert(wrong.status === 401, `wrong-secret status ${wrong.status}`)
    // Tokens in the URL are refused so they never reach access logs.
    const inUrl = await get(`/api/sync/pull?token=${encodeURIComponent(token)}`)
    assert(inUrl.status === 401, `url-token status ${inUrl.status}`)
  })

  await check('oversized search bodies return 413 JSON', async () => {
    const res = await postJson('/api/search', { query: 'big', pad: 'y'.repeat(20_000) })
    assert(res.status === 413, `status ${res.status}`)
    assertJson(res)
  })
} catch (error) {
  console.error(`\nSmoke test setup failed: ${error?.message || error}`)
  console.error(wranglerOutputTail())
  process.exitCode = 1
} finally {
  child.kill('SIGTERM')
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolveExit() })
  })
}

const failed = results.filter((x) => x === null).length
const passed = results.length - failed
console.log(`\n${passed}/${results.length} worker smoke checks passed${failed ? `, ${failed} failed` : ''}`)
if (failed) {
  console.error('\nwrangler dev output (tail):')
  console.error(wranglerOutputTail())
  process.exitCode = 1
}
