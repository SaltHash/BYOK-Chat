export function boundedInt(value, fallback, min, max) {
  // Absent/blank/boolean tuning values keep the fallback; only real numbers
  // (or numeric strings, as the settings UI may send) are clamped.
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return fallback
  const n = Number(value)
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function canonicalUrl(value) {
  try {
    const u = new URL(value)
    if (!['http:', 'https:'].includes(u.protocol)) return ''
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = ''
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key)
    return u.toString().replace(/\/$/, '')
  } catch { return '' }
}

export function selectResults(items, { maxResults = 8, maxSnippetChars = 1800, evidenceBudget = 12000 } = {}) {
  let budget = evidenceBudget
  const normalized = (Array.isArray(items) ? items : []).map((x, i) => {
    const url = canonicalUrl(x?.url)
    const title = String(x?.title || 'Untitled result').trim().slice(0, 300)
    const snippet = String(x?.content || x?.snippet || '').replace(/\s+/g, ' ').trim().slice(0, maxSnippetChars)
    return {
      title,
      url,
      host: url ? new URL(url).hostname : '',
      // Some providers return a result with no extract at all. Keeping the
      // title as its text is better than dropping a ranked result.
      snippet: snippet || title,
      engine: String(x?.engine || '').slice(0, 80),
      score: Number.isFinite(Number(x?.score)) ? Number(x.score) : 0,
      order: i,
    }
  }).filter((x) => x.url && x.snippet)
  normalized.sort((a, b) => b.score - a.score || a.order - b.order)
  // Prefer distinct domains in the first pass, then use remaining high-scoring results.
  const ordered = [...normalized.filter((x, i) => normalized.findIndex((y) => y.host === x.host) === i), ...normalized.filter((x, i) => normalized.findIndex((y) => y.host === x.host) !== i)]
  const seen = new Set(), out = []
  for (const x of ordered) {
    if (seen.has(x.url) || out.length >= maxResults || budget <= 0) continue
    seen.add(x.url)
    const allowance = Math.min(maxSnippetChars, budget - x.title.length - x.url.length - 80)
    if (allowance <= 0) continue
    x.snippet = x.snippet.slice(0, allowance)
    budget -= x.title.length + x.url.length + x.snippet.length + 80
    out.push({ id: `S${out.length + 1}`, title: x.title, url: x.url, snippet: x.snippet, ...(x.engine ? { engine: x.engine } : {}) })
  }
  return out
}

/* ---- Multi-provider AI search ---- */

export const SEARCH_API_PROVIDERS = {
  tinyfish: {
    label: 'TinyFish',
    endpoint: 'https://api.search.tinyfish.ai',
    method: 'GET',
    keyHeader: 'X-API-Key',
    envKeys: ['TINYFISH_API_KEY'],
  },
  you: {
    label: 'You.com',
    endpoint: 'https://ydc-index.io/v1/search',
    method: 'POST',
    keyHeader: 'X-API-Key',
    envKeys: ['YOU_API_KEY', 'YDC_API_KEY', 'YOUCOM_API_KEY'],
  },
  exa: {
    label: 'Exa',
    endpoint: 'https://api.exa.ai/search',
    method: 'POST',
    keyHeader: 'x-api-key',
    envKeys: ['EXA_API_KEY'],
  },
  firecrawl: {
    label: 'Firecrawl',
    endpoint: 'https://api.firecrawl.dev/v2/search',
    method: 'POST',
    keyHeader: 'Authorization',
    bearer: true,
    // Per https://docs.firecrawl.dev/features/search the search endpoint has a
    // keyless free tier ("No API key needed to get started"). A key only raises
    // rate limits, so a missing key must not fail the request locally.
    optionalKey: true,
    envKeys: ['FIRECRAWL_API_KEY'],
  },
  brightdata: {
    label: 'Bright Data',
    endpoint: 'https://api.brightdata.com/request',
    method: 'POST',
    keyHeader: 'Authorization',
    bearer: true,
    needsZone: true,
    envKeys: ['BRIGHTDATA_API_KEY', 'BRIGHT_DATA_API_KEY'],
  },
}

const PROVIDER_ALIASES = {
  tinyfish: 'tinyfish', 'tiny-fish': 'tinyfish', tiny: 'tinyfish',
  you: 'you', 'you.com': 'you', ydc: 'you', youcom: 'you',
  exa: 'exa', 'exa.ai': 'exa',
  firecrawl: 'firecrawl',
  brightdata: 'brightdata', 'bright-data': 'brightdata', 'bright data': 'brightdata', bright: 'brightdata',
}

export function normalizeProvider(value, fallback = 'tinyfish') {
  const v = String(value || '').trim().toLowerCase()
  if (PROVIDER_ALIASES[v]) return PROVIDER_ALIASES[v]
  if (SEARCH_API_PROVIDERS[v]) return v
  return fallback
}

export function providerLabel(provider) {
  return SEARCH_API_PROVIDERS[normalizeProvider(provider, '')]?.label || String(provider || '')
}

export function providerNeedsKey(provider) {
  const id = normalizeProvider(provider, '')
  const meta = SEARCH_API_PROVIDERS[id]
  if (!meta) return true
  return !meta.optionalKey
}

export function apiKeyFor(provider, env = process.env) {
  const id = normalizeProvider(provider, '')
  const meta = SEARCH_API_PROVIDERS[id]
  if (!meta) return ''
  const candidates = [...(meta.envKeys || []), 'SEARCH_API_KEY']
  for (const key of candidates) {
    const value = String(env[key] || '').trim()
    if (value) return value
  }
  return ''
}

export function resolveApiKey(provider, clientKey = '', env = process.env) {
  const own = String(clientKey || '').trim()
  if (own) return own
  return apiKeyFor(provider, env)
}

export function resolveZone(clientZone = '', env = process.env) {
  const own = String(clientZone || '').trim()
  if (own) return own
  return String(env.SEARCH_API_ZONE || env.BRIGHTDATA_ZONE || '').trim()
}

export function apiBaseUrlFor(provider, env = process.env) {
  const id = normalizeProvider(provider, '')
  const specific = String(env[`SEARCH_API_URL_${id.toUpperCase()}`] || '').trim()
  if (specific) return specific.replace(/\/+$/, '')
  const generic = String(env.SEARCH_API_URL || '').trim()
  if (generic) return generic.replace(/\/+$/, '')
  return (SEARCH_API_PROVIDERS[id]?.endpoint || '').replace(/\/+$/, '')
}

function joinSnippet(parts, max = 4000) {
  return parts
    .flatMap((x) => (Array.isArray(x) ? x : [x]))
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max)
}

export function buildApiRequest(provider, query, { apiKey = '', zone = '', count = 8, baseUrl = '' } = {}) {
  const id = normalizeProvider(provider)
  const meta = SEARCH_API_PROVIDERS[id]
  if (!meta) throw new Error(`Unknown search API provider: ${provider}`)
  const q = String(query || '').trim()
  if (!q) throw new Error('Enter a search query')
  const key = String(apiKey || '').trim()
  // Firecrawl documents a keyless free tier for search; only attach the header when a key is set.
  if (!key && providerNeedsKey(id)) {
    const error = new Error(`${meta.label} API key is missing. Paste your key in Settings → Tools → Web search (stored only in this browser).`)
    error.code = 'missing_key'
    throw error
  }
  const endpoint = (baseUrl || meta.endpoint).replace(/\/+$/, '')
  const headers = { accept: 'application/json', 'content-type': 'application/json' }
  if (key) {
    if (meta.bearer) headers[meta.keyHeader === 'Authorization' ? 'authorization' : meta.keyHeader] = `Bearer ${key}`
    else headers[meta.keyHeader.toLowerCase() === 'x-api-key' ? 'x-api-key' : meta.keyHeader] = key
  }
  // Normalize header keys to the exact wire format each API expects.
  const wire = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k === 'authorization') wire.Authorization = v
    else if (k === 'x-api-key') wire['X-API-Key'] = v
    else wire[k] = v
  }

  if (id === 'tinyfish') {
    const url = new URL(endpoint)
    url.searchParams.set('query', q)
    return { url: url.toString(), options: { method: 'GET', headers: { accept: 'application/json', ...(key ? { 'X-API-Key': key } : {}) } } }
  }
  if (id === 'you') {
    return { url: endpoint, options: { method: 'POST', headers: wire, body: JSON.stringify({ query: q, count: Math.max(1, Math.min(10, count || 8)) }) } }
  }
  if (id === 'exa') {
    return { url: `${endpoint}`, options: { method: 'POST', headers: wire, body: JSON.stringify({ query: q, type: 'auto', numResults: Math.max(1, Math.min(10, count || 8)), contents: { highlights: true } }) } }
  }
  if (id === 'firecrawl') {
    return { url: endpoint, options: { method: 'POST', headers: wire, body: JSON.stringify({ query: q, limit: Math.max(1, Math.min(10, count || 8)) }) } }
  }
  if (id === 'brightdata') {
    if (!zone) {
      const error = new Error('Bright Data needs a SERP zone. Paste your zone in Settings → Tools → Web search.')
      error.code = 'missing_zone'
      throw error
    }
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us&brd_json=1`
    return { url: endpoint, options: { method: 'POST', headers: wire, body: JSON.stringify({ zone, url: searchUrl, format: 'raw', data_format: 'parsed_light' }) } }
  }
  throw new Error(`Unsupported search API provider: ${provider}`)
}

export function parseApiResponse(provider, body) {
  const id = normalizeProvider(provider, '')
  if (!body || typeof body !== 'object') return []
  if (id === 'tinyfish') {
    const rows = Array.isArray(body.results) ? body.results : []
    return rows.map((x, i) => ({ title: x?.title, url: x?.url, content: x?.snippet || x?.text, engine: 'tinyfish', score: rows.length - i }))
  }
  if (id === 'you') {
    const container = body.results || {}
    const web = Array.isArray(container.web) ? container.web : Array.isArray(container.results) ? container.results : Array.isArray(body.results) ? body.results : []
    const news = Array.isArray(container.news) ? container.news : []
    return [...web, ...news].map((x, i) => ({
      title: x?.title,
      url: x?.url,
      content: joinSnippet([x?.contents?.highlights, x?.snippets, x?.description, x?.contents?.markdown]),
      engine: 'you.com',
      score: web.length + news.length - i,
    }))
  }
  if (id === 'exa') {
    const rows = Array.isArray(body.results) ? body.results : []
    return rows.map((x, i) => ({
      title: x?.title,
      url: x?.url,
      content: joinSnippet([x?.highlights, x?.text, x?.summary, x?.snippet]),
      engine: 'exa',
      score: Number.isFinite(Number(x?.score)) ? Number(x.score) : rows.length - i,
    }))
  }
  if (id === 'firecrawl') {
    const data = body.data || body
    const rows = Array.isArray(data?.web) ? data.web : Array.isArray(data) ? data : Array.isArray(body.results) ? body.results : []
    return rows.map((x, i) => ({
      title: x?.title,
      url: x?.url,
      content: joinSnippet([x?.description, x?.snippet, x?.markdown]),
      engine: 'firecrawl',
      score: rows.length - i,
    }))
  }
  if (id === 'brightdata') {
    const rows = Array.isArray(body.organic) ? body.organic : Array.isArray(body.results) ? body.results : Array.isArray(body.data) ? body.data : []
    return rows.map((x, i) => ({
      title: x?.title,
      url: x?.link || x?.url,
      content: x?.description || x?.snippet || x?.text,
      engine: 'brightdata',
      score: Number.isFinite(Number(x?.global_rank)) ? 100 - Number(x.global_rank) : rows.length - i,
    }))
  }
  return []
}

/* ---- Structured upstream errors ----
 * Every failure thrown from the fetch layer carries:
 *   error.status    HTTP status from the provider (0 for network/timeout)
 *   error.code      stable machine-readable code for the frontend
 *   error.retryable whether retrying later could succeed
 * Codes: missing_key, missing_zone, bad_request, upstream_auth, billing,
 * rate_limited, timeout, network, bad_response, upstream_unavailable.
 */

function searchFailure(message, { status = 0, code = 'upstream_unavailable', retryable = false, provider = '' } = {}) {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.retryable = retryable
  if (provider) error.provider = provider
  return error
}

function retryAfterMs(response, baseMs, attempt) {
  const header = response.headers?.get?.('retry-after')
  if (header) {
    const seconds = Number(String(header).split(',')[0].trim())
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5000, Math.max(0, seconds * 1000))
  }
  return Math.min(4000, baseMs * 2 ** attempt)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function classifyUpstream(provider, status, detail = '') {
  const label = providerLabel(provider)
  const clipped = String(detail || '').slice(0, 200)
  const suffix = clipped ? `: ${clipped}` : '.'
  if (status === 401 || status === 403) {
    return searchFailure(`${label} rejected the API key (HTTP ${status})${suffix} Check the key in Settings → Tools → Web search, or the server key for this provider.`,
      { status, code: 'upstream_auth', retryable: false, provider })
  }
  if (status === 402) {
    return searchFailure(`${label} reported a billing problem (HTTP 402)${suffix} Add credits or check the plan for this provider's key. This is not retried.`,
      { status, code: 'billing', retryable: false, provider })
  }
  if (status === 429) {
    return searchFailure(`${label} is rate-limiting requests (HTTP 429)${suffix} Wait a moment and try again.`,
      { status, code: 'rate_limited', retryable: true, provider })
  }
  if (status === 400 || status === 422) {
    return searchFailure(`${label} rejected the search request (HTTP ${status})${suffix}`,
      { status, code: 'bad_request', retryable: false, provider })
  }
  if (status >= 500) {
    return searchFailure(`${label} is temporarily unavailable (HTTP ${status})${suffix}`,
      { status, code: 'upstream_unavailable', retryable: true, provider })
  }
  return searchFailure(`${label} returned an unexpected response (HTTP ${status})${suffix}`,
    { status, code: 'bad_response', retryable: false, provider })
}

function isTransientStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504
}

/* One attempt, including the body read when `read` is supplied. Failures are
 * thrown already classified (see `classifyUpstream`); retryable ones carry
 * `retryable`, and throttled responses may carry `retryAfterMs`. The caller's
 * abort signal bounds the whole exchange, so a provider that sends headers and
 * then stalls the body is reported as a timeout instead of hanging. */
async function attemptFetch(fetchFn, url, options, signal, { provider = '', base = 300, read = null } = {}) {
  let response
  try {
    response = await fetchFn(url, { ...options, signal })
  } catch (error) {
    const timedOut = error?.name === 'AbortError'
    throw searchFailure(timedOut ? `${providerLabel(provider)} search timed out.` : `${providerLabel(provider)} could not be reached (${error?.message || 'network error'}).`,
      { status: 0, code: timedOut ? 'timeout' : 'network', retryable: true, provider })
  }
  if (!response.ok) {
    // Drain the error body so connections are reused cleanly.
    const detail = await response.text().catch(() => '').then((t) => String(t || '').slice(0, 200))
    const failure = classifyUpstream(provider, response.status, detail)
    if (isTransientStatus(response.status)) failure.retryAfterMs = retryAfterMs(response, base, 0)
    throw failure
  }
  if (!read) return response
  try {
    return await read(response)
  } catch (error) {
    if (error?.name === 'AbortError') throw searchFailure(`${providerLabel(provider)} search timed out.`, { status: 0, code: 'timeout', retryable: true, provider })
    throw searchFailure(`${providerLabel(provider)} returned invalid JSON.`, { status: response.status ?? 200, code: 'bad_response', retryable: false, provider })
  }
}

async function fetchWithRetry(url, options, { provider = '', timeoutMs = 8000, maxRetries = 2, baseMs = 300, fetchFn = fetch, read = null } = {}) {
  const retries = Math.max(0, Math.min(4, Number.isInteger(maxRetries) ? maxRetries : 2))
  const base = Math.max(50, Math.min(2000, Number.isFinite(Number(baseMs)) ? Number(baseMs) : 300))
  let attempt = 0
  for (;;) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      return await attemptFetch(fetchFn, url, options, ac.signal, { provider, base, read })
    } catch (error) {
      // Timeouts, connection errors and throttling/5xx statuses are transient:
      // retry with backoff (honoring Retry-After), then report.
      const status = error?.status ?? 0
      const transient = error?.retryable === true && (status === 0 || isTransientStatus(status))
      if (!transient || attempt >= retries) throw error
      await sleep(Math.min(4000, error.retryAfterMs ?? base * 2 ** attempt))
      attempt++
    } finally {
      clearTimeout(timer)
    }
  }
}

async function fetchJson(url, options, { provider = '', timeoutMs = 8000, retry = {} } = {}, fetchFn = fetch) {
  return fetchWithRetry(url, options, { provider, timeoutMs, ...retry, fetchFn, read: (response) => response.json() })
}

export async function runApiSearch(provider, query, { apiKey, zone, baseUrl, timeoutMs, limits, retry = {}, fetchFn = fetch } = {}) {
  const id = normalizeProvider(provider)
  const { url, options } = buildApiRequest(id, query, { apiKey, zone, count: limits?.maxResults ?? 8, baseUrl })
  const body = await fetchJson(url, options, { provider: id, timeoutMs, retry }, fetchFn)
  return selectResults(parseApiResponse(id, body), limits)
}
