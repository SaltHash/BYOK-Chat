import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { boundedInt, buildSearchUrl, selectResults } from './server/search.mjs'

const port = Number(process.env.PORT || 8787)
const root = resolve(process.env.STATIC_DIR || 'dist')
const searxngBaseUrl = process.env.SEARXNG_BASE_URL || 'http://127.0.0.1:8080'
const searchTimeoutMs = boundedInt(process.env.SEARCH_TIMEOUT_MS, 8000, 1000, 30000)
const maxResults = boundedInt(process.env.SEARCH_MAX_RESULTS, 8, 1, 8)
const maxSnippetChars = boundedInt(process.env.SEARCH_MAX_SNIPPET_CHARS, 1800, 200, 3000)
const evidenceBudget = boundedInt(process.env.SEARCH_EVIDENCE_BUDGET, 12000, 1000, 16000)
const limit = new Map()
const cache = new Map()
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(JSON.stringify(data))
}

function allowedOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const u = new URL(origin)
    return u.host === req.headers.host
  } catch { return false }
}

async function search(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { allow: 'POST' })
  if (!allowedOrigin(req)) return send(res, 403, { error: 'Cross-origin request refused' })
  const ip = req.socket.remoteAddress || 'unknown'
  const now = Date.now(), entry = limit.get(ip)
  if (entry && now - entry.start < 60_000 && entry.count >= 30) return send(res, 429, { error: 'Search limit reached. Try again in a minute.' }, { 'retry-after': '60' })
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 16_384) return send(res, 413, { error: 'Request is too large' })
  }
  let q
  try { q = JSON.parse(raw).query } catch { return send(res, 400, { error: 'Expected JSON with a query field' }) }
  if (typeof q !== 'string' || !q.trim() || q.trim().length > 400) return send(res, 400, { error: 'Query must be 1 to 400 characters' })
  if (!entry || now - entry.start >= 60_000) limit.set(ip, { start: now, count: 1 }); else entry.count++
  const query = q.trim(), cached = cache.get(query.toLowerCase())
  if (cached && now - cached.at < 60_000) return send(res, 200, cached.data, { 'cache-control': 'private, max-age=30' })
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), searchTimeoutMs)
  try {
    const endpoint = buildSearchUrl(searxngBaseUrl, query)
    const response = await fetch(endpoint, { headers: { accept: 'application/json' }, signal: ac.signal })
    if (!response.ok) return send(res, 502, { error: `SearXNG returned HTTP ${response.status}.` })
    let body
    try { body = await response.json() } catch { return send(res, 502, { error: 'SearXNG returned invalid JSON.' }) }
    if (!body || !Array.isArray(body.results)) return send(res, 502, { error: 'SearXNG returned malformed search results.' })
    const results = selectResults(body.results, { maxResults, maxSnippetChars, evidenceBudget })
    const data = { query, results, searchedAt: new Date().toISOString() }
    cache.set(query.toLowerCase(), { at: now, data })
    if (cache.size > 200) cache.delete(cache.keys().next().value)
    return send(res, 200, data, { 'cache-control': 'private, max-age=30' })
  } catch (error) {
    return send(res, 502, { error: error?.name === 'AbortError' ? 'Search timed out.' : 'Could not reach the search provider.' })
  } finally { clearTimeout(timer) }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, searchConfigured: true, searchProvider: 'SearXNG' })
  if (url.pathname === '/api/search') return search(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' })
  let path = decodeURIComponent(url.pathname)
  if (path === '/') path = '/index.html'
  const file = resolve(root, '.' + path)
  if (file !== root && !file.startsWith(root + sep)) return send(res, 400, { error: 'Invalid path' })
  try {
    const info = await stat(file)
    const target = info.isDirectory() ? resolve(file, 'index.html') : file
    const data = await readFile(target)
    res.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' })
    return res.end(req.method === 'HEAD' ? undefined : data)
  } catch {
    try {
      const data = await readFile(resolve(root, 'index.html'))
      res.writeHead(200, { 'content-type': mime['.html'], 'x-content-type-options': 'nosniff' })
      return res.end(req.method === 'HEAD' ? undefined : data)
    } catch { return send(res, 404, { error: 'Application files not found. Run npm run build first.' }) }
  }
})

server.listen(port, '0.0.0.0', () => console.log(`BYOK Chat listening on :${port}`))
