import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { boundedInt, normalizeMode, normalizeFallback, normalizeProvider, providerLabel, providerNeedsKey, apiKeyFor, resolveApiKey, resolveZone, apiBaseUrlFor, runSearxng, runApiSearch, SEARCH_API_PROVIDERS } from './server/search.mjs'
import { routeSync } from './server/sync.mjs'
import { fetchPageText } from './server/extract.mjs'

const port = Number(process.env.PORT || 8787)
const root = resolve(process.env.STATIC_DIR || 'dist')
const searxngBaseUrl = process.env.SEARXNG_BASE_URL || 'http://127.0.0.1:8080'
const searchTimeoutMs = boundedInt(process.env.SEARCH_TIMEOUT_MS, 8000, 1000, 30000)
const maxResults = boundedInt(process.env.SEARCH_MAX_RESULTS, 8, 1, 8)
const maxSnippetChars = boundedInt(process.env.SEARCH_MAX_SNIPPET_CHARS, 1800, 200, 3000)
const evidenceBudget = boundedInt(process.env.SEARCH_EVIDENCE_BUDGET, 12000, 1000, 16000)
const defaultMode = normalizeMode(process.env.SEARCH_MODE || 'api', 'api')
const defaultFallback = normalizeFallback(process.env.SEARCH_FALLBACK ?? process.env.SEARCH_API_FALLBACK ?? 'true', true)
const defaultProvider = normalizeProvider(process.env.SEARCH_API_PROVIDER || 'tinyfish')
const maxRetries = boundedInt(process.env.SEARCH_MAX_RETRIES, 2, 0, 4)
const retryBaseMs = boundedInt(process.env.SEARCH_RETRY_BASE_MS, 300, 50, 2000)
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

/* Map a search failure to an HTTP status and a structured body.
 * Only genuine upstream outages/timeouts surface as 503. Configuration
 * problems (missing key/zone) are 400, rate limits propagate as 429, and
 * upstream auth/billing/request problems are 502 with a stable `code`. */
function searchFailureStatus(error) {
  const code = error?.code || ''
  if (code === 'missing_key' || code === 'missing_zone') return 400
  if (code === 'rate_limited') return 429
  if (code === 'timeout' || code === 'network' || code === 'upstream_unavailable') return 503
  if (typeof error?.status === 'number' && error.status >= 400 && error.status < 600) return 502
  if (/missing/i.test(error?.message || '')) return 400
  return 502
}

function searchFailureBody(error, provider) {
  return {
    error: error?.message || 'Could not reach the search provider.',
    code: error?.code || 'upstream_unavailable',
    provider,
    retryable: error?.retryable !== false && error?.code !== 'missing_key' && error?.code !== 'missing_zone',
  }
}

// Server-side diagnostics: provider, mode, code and upstream status only.
// Never log API keys, zones, authorization headers, or full queries.
function logSearchFailure(provider, mode, queryLength, error, ms) {
  console.error(`[search] provider=${provider} mode=${mode} code=${error?.code || 'unknown'} upstream=${error?.status ?? 0} queryChars=${queryLength} ms=${ms}`)
}

function searchStatus() {
  const apiKeys = Object.fromEntries(Object.keys(SEARCH_API_PROVIDERS).map((id) => [id, Boolean(apiKeyFor(id))]))
  const apiConfigured = Object.values(apiKeys).some(Boolean)
  return {
    ok: true,
    searchConfigured: true,
    searchProvider: defaultMode === 'searxng' ? 'SearXNG' : providerLabel(defaultProvider),
    searchMode: defaultMode,
    searchFallback: defaultFallback,
    apiProvider: defaultProvider,
    apiProviders: Object.fromEntries(Object.entries(SEARCH_API_PROVIDERS).map(([id, meta]) => [id, { label: meta.label, configured: apiKeys[id], needsZone: Boolean(meta.needsZone) }])),
    apiConfigured,
    searxngConfigured: true,
  }
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
  let parsed
  try { parsed = JSON.parse(raw) } catch { return send(res, 400, { error: 'Expected JSON with a query field' }) }
  const q = parsed?.query
  if (typeof q !== 'string' || !q.trim() || q.trim().length > 400) return send(res, 400, { error: 'Query must be 1 to 400 characters' })
  const mode = normalizeMode(parsed?.mode ?? defaultMode, defaultMode)
  const provider = normalizeProvider(parsed?.provider ?? defaultProvider, defaultProvider)
  const fallback = normalizeFallback(parsed?.fallback ?? parsed?.apiFallback ?? defaultFallback, defaultFallback)
  const clientKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.slice(0, 500) : ''
  const clientZone = typeof parsed?.zone === 'string' ? parsed.zone.slice(0, 200) : ''
  if (!entry || now - entry.start >= 60_000) limit.set(ip, { start: now, count: 1 }); else entry.count++
  const query = q.trim()
  const cacheKey = `${mode}:${mode === 'searxng' ? 'searxng' : provider}:${fallback ? 'fb' : 'nofb'}:${query.toLowerCase()}`
  const cached = cache.get(cacheKey)
  if (cached && now - cached.at < 60_000) return send(res, 200, cached.data, { 'cache-control': 'private, max-age=30' })
  const limits = { maxResults, maxSnippetChars, evidenceBudget }
  const retry = { maxRetries, baseMs: retryBaseMs }
  const apiKey = resolveApiKey(provider, clientKey)
  const zone = resolveZone(clientZone)
  const baseUrl = apiBaseUrlFor(provider)
  const attemptSearxng = () => runSearxng(query, { baseUrl: searxngBaseUrl, timeoutMs: searchTimeoutMs, limits, retry })
  const attemptApi = () => runApiSearch(provider, query, { apiKey, zone, baseUrl, timeoutMs: searchTimeoutMs, limits, retry })
  const fail = (res, error, failedProvider) => {
    logSearchFailure(failedProvider, mode, query.length, error, Date.now() - now)
    const headers = error?.code === 'rate_limited' ? { 'retry-after': '5' } : {}
    return send(res, searchFailureStatus(error), searchFailureBody(error, failedProvider), headers)
  }
  const missingKeyError = () => {
    const error = new Error(`${providerLabel(provider)} API key is missing. Paste your key in Settings → Tools → Web search${SEARCH_API_PROVIDERS[provider].needsZone && !zone ? ' and add your SERP zone' : ''}.`)
    error.code = 'missing_key'
    return error
  }
  const needsKey = providerNeedsKey(provider) && !apiKey
  try {
    let results, usedProvider = provider, usedMode = mode
    if (mode === 'api') {
      try {
        if (needsKey) throw missingKeyError()
        results = await attemptApi()
      } catch (apiError) {
        if (!fallback) return fail(res, apiError, provider)
        try {
          results = await attemptSearxng()
          usedProvider = 'searxng'
          usedMode = 'api (SearXNG fallback)'
        } catch (fallbackError) {
          logSearchFailure('searxng', mode, query.length, fallbackError, Date.now() - now)
          return fail(res, apiError, provider)
        }
      }
    } else {
      try {
        results = await attemptSearxng()
        usedProvider = 'searxng'
      } catch (searxngError) {
        if (!fallback) return fail(res, searxngError, 'searxng')
        try {
          if (needsKey) throw missingKeyError()
          results = await attemptApi()
          usedMode = 'searxng (API fallback)'
        } catch (apiError) {
          logSearchFailure('searxng', mode, query.length, searxngError, Date.now() - now)
          return fail(res, apiError, provider)
        }
      }
    }
    const data = { query, results, searchedAt: new Date().toISOString(), provider: usedProvider, mode: usedMode }
    cache.set(cacheKey, { at: now, data })
    if (cache.size > 200) cache.delete(cache.keys().next().value)
    return send(res, 200, data, { 'cache-control': 'private, max-age=30' })
  } catch (error) {
    return fail(res, error, provider)
  }
}

const extractTimeoutMs = boundedInt(process.env.EXTRACT_TIMEOUT_MS, 8000, 1000, 30000)
const extractLimit = new Map()

async function extract(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, { allow: 'GET' })
  if (!allowedOrigin(req)) return send(res, 403, { error: 'Cross-origin request refused' })
  const ip = req.socket.remoteAddress || 'unknown'
  const now = Date.now(), entry = extractLimit.get(ip)
  if (entry && now - entry.start < 60_000 && entry.count >= 30) return send(res, 429, { error: 'Reader limit reached. Try again in a minute.' }, { 'retry-after': '60' })
  const url = new URL(req.url || '/', 'http://localhost')
  const target = (url.searchParams.get('url') || '').trim().slice(0, 2000)
  if (!target) return send(res, 400, { error: 'Missing url parameter' })
  if (!entry || now - entry.start >= 60_000) extractLimit.set(ip, { start: now, count: 1 }); else entry.count++
  try {
    const data = await fetchPageText(target, { timeoutMs: extractTimeoutMs })
    return send(res, 200, { ...data, fetchedAt: new Date().toISOString() }, { 'cache-control': 'private, max-age=300' })
  } catch (e) {
    const code = e.code || 'upstream_unavailable'
    const status = code === 'bad_url' || code === 'bad_type' ? 400 : code === 'timeout' || code === 'network' ? 503 : e.status === 404 ? 404 : 502
    console.error(`[extract] code=${code} upstream=${e.status ?? 0} urlChars=${target.length}`)
    return send(res, status, { error: e.message || 'Could not read the page.', code, retryable: e.retryable === true })
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/api/health') return send(res, 200, searchStatus())
  if (url.pathname === '/api/search') return search(req, res)
  if (url.pathname === '/api/extract') return extract(req, res)
  if (url.pathname.startsWith('/api/sync/')) return routeSync(req, res, send)
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
