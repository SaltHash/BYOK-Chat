/* Shared /api request handling for both hosts: the Node server (server.mjs)
 * and the Cloudflare Worker (worker/index.mjs). Handlers return plain
 * { status, headers, body } descriptors; each host adapts them to its
 * response type. Secrets are read from the `env` argument only (process.env
 * for the Node server, Worker bindings for Cloudflare) and never logged. */
import { boundedInt, normalizeProvider, providerLabel, providerNeedsKey, apiKeyFor, resolveApiKey, resolveZone, apiBaseUrlFor, runApiSearch, SEARCH_API_PROVIDERS } from './search.mjs'
import { fetchPageText } from './extract.mjs'
import { handleSyncPush, handleSyncPull } from './sync.mjs'
import { syncBackend, redact } from './syncStore.mjs'
import { shareBackend } from './shareStore.mjs'
import { handleShareCreate, handleShareGet, shareIdOf } from './share.mjs'
import { clientIp, headerValue, jsonResult, readBodyText, requestHost, sameOrigin } from './http.mjs'

// Hard server-side caps. Per-request tuning arrives from the user's search
// settings in Settings → Tools → Web search and is bounded below.
const MAX_RESULTS = 8
const MAX_SNIPPET_CHARS = 3000
const EVIDENCE_BUDGET = 16000
const SEARCH_BODY_LIMIT = 16_384
const EXTRACT_TIMEOUT_MS = 8000
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000

/* Rate limits and caches live in module scope. On Cloudflare Workers each
 * isolate keeps its own copy, so limits are approximate — a burst can exceed
 * RATE_LIMIT per window by the number of live isolates — and caches are
 * per-isolate and short-lived. On the Node host there is a single process, so
 * both are exact. */
const searchLimit = new Map()
const extractLimit = new Map()
const syncLimit = new Map()
const shareLimit = new Map()
const searchCache = new Map()

/* Sliding window: a fixed window lets a client send RATE_LIMIT requests at
 * the end of one window and RATE_LIMIT more at the start of the next. */
function hitsInWindow(bucket, ip, now) {
  const times = bucket.get(ip)
  if (!times) return []
  while (times.length && now - times[0] >= RATE_WINDOW_MS) times.shift()
  return times
}

export function overRateLimit(bucket, ip, now) {
  return hitsInWindow(bucket, ip, now).length >= RATE_LIMIT
}

export function bumpRateLimit(bucket, ip, now) {
  const times = hitsInWindow(bucket, ip, now)
  times.push(now)
  bucket.set(ip, times)
  if (bucket.size > 1000) bucket.delete(bucket.keys().next().value)
}

export function searchStatus(env = {}) {
  const apiKeys = Object.fromEntries(Object.keys(SEARCH_API_PROVIDERS).map((id) => [id, Boolean(apiKeyFor(id, env))]))
  const apiConfigured = Object.values(apiKeys).some(Boolean)
  return {
    ok: true,
    searchConfigured: true,
    apiProviders: Object.fromEntries(Object.entries(SEARCH_API_PROVIDERS).map(([id, meta]) => [id, { label: meta.label, configured: apiKeys[id], needsZone: Boolean(meta.needsZone) }])),
    apiConfigured,
  }
}

export function apiHealth(req, env = process.env) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return jsonResult(405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' })
  return jsonResult(200, searchStatus(env))
}

/* Map a search failure to an HTTP status and a structured body.
 * Only genuine upstream outages/timeouts surface as 503. Configuration
 * problems (missing key/zone) are 400, rate limits propagate as 429, and
 * upstream auth/billing/request problems are 502 with a stable `code`. */
export function searchFailureStatus(error) {
  const code = error?.code || ''
  if (code === 'missing_key' || code === 'missing_zone') return 400
  if (code === 'rate_limited') return 429
  if (code === 'timeout' || code === 'network' || code === 'upstream_unavailable') return 503
  if (typeof error?.status === 'number' && error.status >= 400 && error.status < 600) return 502
  if (/missing/i.test(error?.message || '')) return 400
  return 502
}

// Codes whose retry semantics are fixed; anything else defers to the error.
const NEVER_RETRYABLE = new Set(['missing_key', 'missing_zone', 'bad_request', 'upstream_auth', 'billing', 'bad_response'])
const ALWAYS_RETRYABLE = new Set(['rate_limited', 'timeout', 'network', 'upstream_unavailable'])

export function searchFailureBody(error, provider) {
  const code = error?.code || 'upstream_unavailable'
  const retryable = NEVER_RETRYABLE.has(code) ? false : ALWAYS_RETRYABLE.has(code) ? true : error?.retryable !== false
  return {
    error: error?.message || 'Could not reach the search provider.',
    code,
    provider,
    retryable,
  }
}

// Server-side diagnostics: provider, mode, code and upstream status only.
// Never log API keys, zones, authorization headers, or full queries.
function logSearchFailure(provider, mode, queryLength, error, ms) {
  console.error(`[search] provider=${provider} mode=${mode} code=${error?.code || 'unknown'} upstream=${error?.status ?? 0} queryChars=${queryLength} ms=${ms}`)
}

export async function apiSearch(req, env = process.env) {
  if (req.method !== 'POST') return jsonResult(405, { error: 'Method not allowed' }, { allow: 'POST' })
  if (!sameOrigin(headerValue(req, 'origin'), requestHost(req))) return jsonResult(403, { error: 'Cross-origin request refused' })
  const ip = clientIp(req, env)
  const now = Date.now()
  if (overRateLimit(searchLimit, ip, now)) return jsonResult(429, { error: 'Search limit reached. Try again in a minute.' }, { 'retry-after': '60' })
  // Every request counts against the limit — invalid payloads must not be a
  // free way to keep hammering the endpoint.
  bumpRateLimit(searchLimit, ip, now)
  const raw = await readBodyText(req, SEARCH_BODY_LIMIT)
  if (raw === null) return jsonResult(413, { error: 'Request is too large' })
  let parsed
  try { parsed = JSON.parse(raw) } catch { return jsonResult(400, { error: 'Expected JSON with a query field' }) }
  const q = parsed?.query
  if (typeof q !== 'string' || !q.trim() || q.trim().length > 400) return jsonResult(400, { error: 'Query must be 1 to 400 characters' })
  const provider = normalizeProvider(parsed?.provider ?? 'tinyfish', 'tinyfish')
  const clientKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.slice(0, 500) : ''
  const clientZone = typeof parsed?.zone === 'string' ? parsed.zone.slice(0, 200) : ''
  const query = q.trim()
  // Per-request tuning from the user's search settings, bounded by hard caps.
  const requested = boundedInt(parsed?.count, MAX_RESULTS, 1, MAX_RESULTS)
  const maxSnippetChars = boundedInt(parsed?.maxSnippetChars, 1800, 200, MAX_SNIPPET_CHARS)
  const evidenceBudget = boundedInt(parsed?.evidenceBudget, 12000, 1000, EVIDENCE_BUDGET)
  const timeoutMs = boundedInt(parsed?.timeoutMs, 8000, 1000, 30000)
  const maxRetries = boundedInt(parsed?.maxRetries, 2, 0, 4)
  const retryBaseMs = boundedInt(parsed?.retryBaseMs, 300, 50, 2000)
  // The zone scopes Bright Data searches (and is part of the query result),
  // so two zones must never share a cache entry.
  const cacheKey = `${provider}:${clientZone}:${requested}:${maxSnippetChars}:${evidenceBudget}:${query.toLowerCase()}`
  const limits = { maxResults: requested, maxSnippetChars, evidenceBudget }
  const retry = { maxRetries, baseMs: retryBaseMs }
  const apiKey = resolveApiKey(provider, clientKey, env)
  const zone = resolveZone(clientZone, env)
  const baseUrl = apiBaseUrlFor(provider, env)
  const missingKeyError = () => {
    const error = new Error(`${providerLabel(provider)} API key is missing. Paste your key in Settings → Tools → Web search${SEARCH_API_PROVIDERS[provider].needsZone && !zone ? ' and add your SERP zone' : ''}.`)
    error.code = 'missing_key'
    return error
  }
  try {
    if (providerNeedsKey(provider) && !apiKey) throw missingKeyError()
    // Checked after credential validation so a request without a key still gets its configuration error.
    const cached = searchCache.get(cacheKey)
    if (cached && now - cached.at < 60_000) return jsonResult(200, cached.data, { 'cache-control': 'private, max-age=30' })
    const results = await runApiSearch(provider, query, { apiKey, zone, baseUrl, timeoutMs, limits, retry })
    const data = { query, results, searchedAt: new Date().toISOString(), provider, mode: 'api' }
    searchCache.set(cacheKey, { at: now, data })
    if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value)
    return jsonResult(200, data, { 'cache-control': 'private, max-age=30' })
  } catch (error) {
    logSearchFailure(provider, 'api', query.length, error, Date.now() - now)
    const headers = error?.code === 'rate_limited' ? { 'retry-after': '5' } : {}
    return jsonResult(searchFailureStatus(error), searchFailureBody(error, provider), headers)
  }
}

export async function apiExtract(req, env = process.env, opts = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return jsonResult(405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' })
  if (!sameOrigin(headerValue(req, 'origin'), requestHost(req))) return jsonResult(403, { error: 'Cross-origin request refused' })
  const ip = clientIp(req, env)
  const now = Date.now()
  if (overRateLimit(extractLimit, ip, now)) return jsonResult(429, { error: 'Reader limit reached. Try again in a minute.' }, { 'retry-after': '60' })
  bumpRateLimit(extractLimit, ip, now)
  const url = new URL(req.url || '/', 'http://localhost')
  const target = (url.searchParams.get('url') || '').trim().slice(0, 2000)
  if (!target) return jsonResult(400, { error: 'Missing url parameter' })
  try {
    // The Node host passes a fetch that pins the resolved address at connect
    // time (DNS-rebinding guard); the Worker uses its default fetch.
    const data = await fetchPageText(target, { timeoutMs: EXTRACT_TIMEOUT_MS, fetchFn: opts.fetchFn })
    return jsonResult(200, { ...data, fetchedAt: new Date().toISOString() }, { 'cache-control': 'private, max-age=300' })
  } catch (e) {
    const code = e.code || 'upstream_unavailable'
    const status = code === 'bad_url' || code === 'bad_type' ? 400
      : code === 'timeout' || code === 'network' ? 503
      : code === 'empty' ? 422
      : e.status === 404 ? 404 : 502
    console.error(`[extract] code=${code} upstream=${e.status ?? 0} urlChars=${target.length}`)
    return jsonResult(status, { error: e.message || 'Could not read the page.', code, retryable: e.retryable === true })
  }
}

/* Map a sync failure to a response body. Configuration/auth/payload problems
 * (4xx) keep their message; backend failures (5xx) become a stable code and a
 * generic message so driver/database internals never reach the client. */
export function syncFailureResult(error) {
  const status = typeof error?.status === 'number' ? error.status : 503
  const code = error?.code || 'sync_unavailable'
  if (status >= 500) return jsonResult(status, { error: 'Sync storage is unavailable. Try again in a moment.', code })
  return jsonResult(status, { error: error?.message || 'Sync failed.', code })
}

export async function apiSync(req, env = process.env) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/sync/')) return null
  // Sync payloads are large; count every request so anonymous pushes cannot
  // hammer the endpoint (and the database) unchecked.
  const ip = clientIp(req, env)
  const now = Date.now()
  if (overRateLimit(syncLimit, ip, now)) return jsonResult(429, { error: 'Sync limit reached. Try again in a minute.' }, { 'retry-after': '60' })
  bumpRateLimit(syncLimit, ip, now)
  // State-changing sync calls are same-origin only. Pulls authenticate with a
  // bearer token, which cross-origin pages cannot attach without a CORS
  // preflight, so GET /api/sync/pull stays available to browsers as-is.
  if (req.method !== 'GET' && !sameOrigin(headerValue(req, 'origin'), requestHost(req))) {
    return jsonResult(403, { error: 'Cross-origin request refused' })
  }
  try {
    if (url.pathname === '/api/sync/status' && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const backend = await syncBackend(env)
        return jsonResult(200, { ok: true, backend: backend.kind, configured: Boolean(env.DATABASE_URL) })
      } catch {
        // Keep status cheap and always 200 so the UI can show that sync is
        // configured but currently unreachable.
        return jsonResult(200, { ok: false, backend: 'unavailable', configured: Boolean(env.DATABASE_URL) })
      }
    }
    const backend = await syncBackend(env)
    if (url.pathname === '/api/sync/push' && req.method === 'POST') return jsonResult(200, await handleSyncPush(req, backend))
    if (url.pathname === '/api/sync/pull' && (req.method === 'GET' || req.method === 'POST' || req.method === 'HEAD')) return jsonResult(200, await handleSyncPull(req, backend))
    return jsonResult(404, { error: 'Unknown sync route.' })
  } catch (e) {
    if ((typeof e?.status !== 'number' ? 503 : e.status) >= 500) {
      console.error(`[sync] ${e?.code || 'sync_unavailable'}: ${redact(e?.stack || e)}`)
    }
    return syncFailureResult(e)
  }
}

/* Route if pathname is /api or /api/…; returns null for everything else so
 * each host can fall through to its static asset handling. Unknown API paths
 * always answer with JSON instead of the frontend's index.html. */
/* Public chat snapshots: POST /api/share creates one, GET /api/share/<id>
 * reads it. Reads are unauthenticated on purpose (the link is the capability),
 * so both methods count against the per-IP limit and the create path is
 * same-origin only. */
export async function apiShare(req, env = process.env) {
  const url = new URL(req.url || '/', 'http://localhost')
  const isCreate = url.pathname === '/api/share'
  const id = url.pathname.startsWith('/api/share/') ? shareIdOf(url.pathname.slice('/api/share/'.length)) : ''
  if (!isCreate && !id) return jsonResult(404, { error: 'Unknown share route.' })
  const ip = clientIp(req, env)
  const now = Date.now()
  if (overRateLimit(shareLimit, ip, now)) return jsonResult(429, { error: 'Share limit reached. Try again in a minute.' }, { 'retry-after': '60' })
  bumpRateLimit(shareLimit, ip, now)
  if (isCreate && req.method !== 'POST') return jsonResult(405, { error: 'Method not allowed' }, { allow: 'POST' })
  if (isCreate && !sameOrigin(headerValue(req, 'origin'), requestHost(req))) return jsonResult(403, { error: 'Cross-origin request refused' })
  if (!isCreate && req.method !== 'GET' && req.method !== 'HEAD') return jsonResult(405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' })
  try {
    const backend = await shareBackend(env)
    if (isCreate) return jsonResult(200, await handleShareCreate(req, backend, shareId))
    return jsonResult(200, await handleShareGet(id, backend), { 'cache-control': 'public, max-age=300' })
  } catch (e) {
    const status = typeof e?.status === 'number' ? e.status : 503
    const code = e?.code || 'share_unavailable'
    if (status >= 500) console.error(`[share] ${code}: ${redact(e?.message)}`)
    return jsonResult(status, { error: status >= 500 ? 'Share storage is unavailable. Try again in a moment.' : (e?.message || 'Sharing failed.'), code })
  }
}

/* URL-safe random id for share links (12 chars from 9 random bytes). */
function shareId() {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function apiRoute(req, env = process.env, opts = {}) {
  const url = new URL(req.url || '/', 'http://localhost')
  let result = null
  if (url.pathname === '/api/health') result = apiHealth(req, env)
  else if (url.pathname === '/api/search') result = await apiSearch(req, env)
  else if (url.pathname === '/api/extract') result = await apiExtract(req, env, opts)
  else if (url.pathname === '/api/share' || url.pathname.startsWith('/api/share/')) result = await apiShare(req, env)
  else if (url.pathname.startsWith('/api/sync/')) result = await apiSync(req, env)
  else if (url.pathname === '/api' || url.pathname.startsWith('/api/')) result = jsonResult(404, { error: 'Not found' })
  if (!result) return null
  // HEAD mirrors the GET route it targets: same status and headers, no body.
  if (req.method === 'HEAD') return { status: result.status, headers: result.headers, body: null }
  return result
}
