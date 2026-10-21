/* Page-reader extraction: GET /api/extract?url=… → { url, title, text }.
 * SSRF-safe (public http/https only, no private/loopback/link-local hosts),
 * bounded (HTML cap, text cap, timeout), cached 10 min in memory. No extra
 * dependencies: lightweight tag-stripping tuned for article-style pages. */

export const EXTRACT_MAX_HTML = 1_500_000
export const EXTRACT_MAX_TEXT = 12_000
export const EXTRACT_TEXT_MAX = 50_000
const RETRY_MAX_DELAY_MS = 4_000

const clampInt = (value, fallback, min, max) =>
  Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const cache = new Map()

function isPrivateIpv4(p) {
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // documentation (198.51.100.0/24)
  if (a === 203 && b === 0) return true // documentation (203.0.113.0/24)
  return false
}

/* Expand a textual IPv6 address (no IPv4 tail) into 8 groups, or null. */
function ipv6Groups(host) {
  const text = String(host).split('%')[0]
  if (!/^[0-9a-f:]+$/i.test(text)) return null
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = []
  for (const part of [...head, ...tail]) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
    groups.push(parseInt(part, 16))
  }
  if (halves.length === 1) return groups.length === 8 ? groups : null
  if (groups.length > 8) return null
  return [...groups.slice(0, head.length), ...new Array(8 - groups.length).fill(0), ...groups.slice(head.length)]
}

function isPrivateIpv6(g) {
  const [g0, g1] = g
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true // fec0::/10 deprecated site-local
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((g0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (g0 === 0x0100 && g1 === 0) return true // 100::/64 discard-only
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0db0) return true // 2001:db8::/32 documentation
  const firstFiveZero = g.slice(0, 5).every((n) => n === 0)
  // ::, ::1, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d)
  if (firstFiveZero && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0) return true
    return isPrivateIpv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255])
  }
  // NAT64 (64:ff9b::/96, 64:ff9b:1::/48) and 6to4 (2002::/16) embed an IPv4 address.
  if (g0 === 0x0064 && g1 === 0xff9b) return isPrivateIpv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255])
  if (g0 === 0x2002) return isPrivateIpv4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255])
  return false
}

function isPublicHttp(url) {
  let u
  try { u = new URL(url) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  // Only the standard web ports: a public host on an unusual port is almost
  // always an internal service and only widens the SSRF surface.
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  if (port !== '80' && port !== '443') return false
  // URL keeps IPv6 literals bracketed; strip them so the checks below see the address.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  // Literal private/loopback/link-local/reserved IPs (v4 + v6). The URL parser
  // already normalizes shorthand IPv4 (127.1, 0x7f.1, 2130706433, …) and
  // mapped IPv6 forms to their canonical dotted/compressed spelling.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return isPublicIpAddress(host)
  return true
}

/* True when `ip` is a routable public address (v4 dotted or v6 literal).
 * Used by both the URL checks and the Node host's connect-time DNS pinning. */
export function isPublicIpAddress(ip) {
  const host = String(ip ?? '').replace(/^\[|\]$/g, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const p = host.split('.').map(Number)
    return !p.some((n) => !Number.isInteger(n) || n < 0 || n > 255) && !isPrivateIpv4(p)
  }
  if (host.includes(':')) {
    const groups = ipv6Groups(host)
    return !!groups && !isPrivateIpv6(groups)
  }
  return false
}

function decodeEntities(s) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", '#x2F': '/' }
  return String(s)
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#x27|#x2F);/g, (_, e) => named[e] ?? ' ')
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
}

/* Decode one numeric entity, tolerating junk: surrogates, out-of-range and
 * non-finite values become a space instead of a stray/incorrect character. */
function codePoint(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return ' '
  return String.fromCodePoint(n)
}

export function htmlToText(html) {
  let s = String(html ?? '')
  const title = (/<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s)?.[1] ?? /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(s)?.[1] ?? '').trim()
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav\s*>/gi, ' ').replace(/<header[\s\S]*?<\/header\s*>/gi, ' ').replace(/<footer[\s\S]*?<\/footer\s*>/gi, ' ')
  // Keep link text, drop the markup.
  s = s.replace(/<(p|div|br|li|h1|h2|h3|h4|tr)[^>]*>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s).replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n')
  const lines = s.split('\n').map((l) => l.trim()).filter((l) => l && l.length > 1)
  // Drop boilerplate-ish lines (nav crumbs, cookie banners) beyond the head.
  const kept = lines.filter((l, i) => i < 6 || !/^(home|menu|search|login|sign in|subscribe|newsletter|cookie|privacy|terms|advertisement|sponsored)$/i.test(l))
  return { title: decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 300), text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}

/* Redirects are followed by hand so every hop is checked against the same
 * public-address rules. Automatic following would let a public URL bounce the
 * server onto a private address. */
async function fetchFollowingPublic(fetchFn, url, init, maxHops = 5) {
  let current = url
  for (let hop = 0; ; hop++) {
    const res = await fetchFn(current, { ...init, redirect: 'manual' })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get?.('location') : null
    if (!location) return res
    await res.body?.cancel?.().catch(() => {})
    if (hop >= maxHops) throw Object.assign(Error('The page redirected too many times.'), { code: 'bad_response', status: 502, retryable: false })
    const next = new URL(location, current).href
    if (!isPublicHttp(next)) throw Object.assign(Error('The page redirected to a non-public address.'), { code: 'bad_url' })
    current = next
  }
}

/* Fetch and decode one public page. Throws structured errors (with `code`)
 * for HTTP failures, unreadable types and redirect problems; the caller maps
 * aborts and transport errors. The abort signal covers the whole exchange,
 * including the body stream, so a stalled body cannot hang the reader. */
async function readPublicPage(fetchFn, url, signal) {
  const res = await fetchFollowingPublic(fetchFn, url, { signal, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'byok-chat-reader/1.0' } })
  if (!res.ok) {
    try { await res.body?.cancel?.() } catch {}
    const err = Error(`The page returned HTTP ${res.status}.`)
    err.code = res.status >= 500 ? 'upstream_unavailable' : 'bad_response'
    err.status = res.status
    err.retryable = res.status >= 500
    throw err
  }
  const type = res.headers.get?.('content-type') ?? ''
  if (type && !/html|xml|text/i.test(type)) {
    try { await res.body?.cancel?.() } catch {}
    const err = Error('That URL is not a readable page (only HTML/text).')
    err.code = 'bad_type'
    throw err
  }
  const reader = res.body?.getReader?.()
  let html = ''
  if (reader) {
    const dec = new TextDecoder()
    while (html.length <= EXTRACT_MAX_HTML) {
      const { done, value } = await reader.read()
      if (done) break
      html += dec.decode(value, { stream: true })
    }
    if (html.length > EXTRACT_MAX_HTML) {
      html = html.slice(0, EXTRACT_MAX_HTML)
      // Stop the upstream transfer instead of leaving the socket streaming.
      try { await reader.cancel() } catch {}
    }
  } else {
    html = (await res.text().catch(() => '')).slice(0, EXTRACT_MAX_HTML)
  }
  return htmlToText(html)
}

export async function fetchPageText(url, { timeoutMs = 8000, maxChars = EXTRACT_MAX_TEXT, maxRetries = 0, retryBaseMs = 300, fetchFn = fetch } = {}) {
  if (!isPublicHttp(url)) {
    const e = Error('Only public http(s) pages can be read.')
    e.code = 'bad_url'
    throw e
  }
  const limit = clampInt(maxChars, EXTRACT_MAX_TEXT, 1_000, EXTRACT_TEXT_MAX)
  const timeout = clampInt(timeoutMs, 8000, 1_000, 30_000)
  const retries = clampInt(maxRetries, 0, 0, 4)
  const baseDelay = clampInt(retryBaseMs, 300, 50, 2_000)
  const key = `${url}|${limit}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 600_000) return hit.data
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeout)
    try {
      const { title, text } = await readPublicPage(fetchFn, url, ac.signal)
      if (!text) {
        const err = Error('No readable text found on that page.')
        err.code = 'empty'
        throw err
      }
      const truncated = text.length > limit
      const data = { url, title: title || url, text: truncated ? text.slice(0, limit) : text, truncated }
      cache.set(key, { at: Date.now(), data })
      if (cache.size > 200) cache.delete(cache.keys().next().value)
      return data
    } catch (e) {
      if (e?.code) {
        // Structured failures pass through unchanged; only transient ones retry.
        lastError = e
      } else {
        lastError = Error(e?.name === 'AbortError' ? 'The page took too long to respond.' : `Could not reach the page (${e?.message || 'network error'}).`)
        lastError.code = e?.name === 'AbortError' ? 'timeout' : 'network'
        lastError.retryable = true
      }
      if (lastError.retryable !== true || attempt >= retries) throw lastError
    } finally {
      clearTimeout(timer)
    }
    await wait(Math.min(baseDelay * 2 ** attempt, RETRY_MAX_DELAY_MS))
  }
  throw lastError
}

export { isPublicHttp }

/* ---- Optional page-reader APIs ----
 * The built-in reader fetches the page directly. Some users prefer a hosted
 * extraction API instead (Jina, Firecrawl, Exa) or their own service. Those
 * requests go through /api/reader so a reader key never appears in a URL. */

export const READER_PROVIDERS = {
  builtin: { label: 'Built-in reader' },
  jina: { label: 'Jina Reader', endpoint: 'https://r.jina.ai/' },
  firecrawl: { label: 'Firecrawl', endpoint: 'https://api.firecrawl.dev/v2/scrape', optionalKey: true },
  exa: { label: 'Exa', endpoint: 'https://api.exa.ai/contents', requiresKey: true },
  custom: { label: 'Custom reader API' },
}

const READER_ALIASES = {
  builtin: 'builtin', direct: 'builtin', fetch: 'builtin', 'built-in': 'builtin',
  jina: 'jina', 'jina.ai': 'jina', 'jina-reader': 'jina', reader: 'jina',
  firecrawl: 'firecrawl',
  exa: 'exa', 'exa.ai': 'exa',
  custom: 'custom', own: 'custom', self: 'custom',
}

export function normalizeReaderProvider(value, fallback = 'builtin') {
  const v = String(value || '').trim().toLowerCase()
  if (READER_ALIASES[v]) return READER_ALIASES[v]
  if (READER_PROVIDERS[v]) return v
  return fallback
}

export function readerProviderLabel(provider) {
  return READER_PROVIDERS[normalizeReaderProvider(provider, '')]?.label || String(provider || '')
}

function readerFailure(message, { status = 0, code = 'upstream_unavailable', retryable = false } = {}) {
  const error = Error(message)
  error.status = status
  error.code = code
  error.retryable = retryable
  return error
}

function classifyReaderStatus(status, detail = '') {
  const clipped = String(detail || '').slice(0, 200)
  const suffix = clipped ? `: ${clipped}` : '.'
  if (status === 401 || status === 403) return readerFailure(`The reader API rejected the key (HTTP ${status})${suffix} Check the reader key in Settings → Tools.`, { status, code: 'upstream_auth' })
  if (status === 429) return readerFailure(`The reader API is rate-limiting requests (HTTP 429)${suffix} Wait a moment and try again.`, { status, code: 'rate_limited', retryable: true })
  if (status === 402) return readerFailure(`The reader API reported a billing problem (HTTP 402)${suffix}`, { status, code: 'billing' })
  if (status === 400 || status === 404 || status === 422) return readerFailure(`The reader API could not read that page (HTTP ${status})${suffix}`, { status, code: 'bad_response' })
  if (status >= 500) return readerFailure(`The reader API is temporarily unavailable (HTTP ${status})${suffix}`, { status, code: 'upstream_unavailable', retryable: true })
  return readerFailure(`The reader API returned an unexpected response (HTTP ${status})${suffix}`, { status, code: 'bad_response' })
}

const readerSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* Run one reader request with a hard timeout and bounded retries. */
async function withReaderRetry(fn, { timeoutMs, maxRetries, retryBaseMs, label }) {
  const timeout = clampInt(timeoutMs, 8000, 1000, 30_000)
  const retries = clampInt(maxRetries, 0, 0, 4)
  const base = clampInt(retryBaseMs, 300, 50, 2_000)
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeout)
    try {
      return await fn(ac.signal)
    } catch (e) {
      if (e?.code) lastError = e
      else {
        const timedOut = e?.name === 'AbortError'
        lastError = readerFailure(timedOut ? `${label} timed out.` : `${label} could not be reached (${e?.message || 'network error'}).`,
          { code: timedOut ? 'timeout' : 'network', retryable: true })
      }
      if (lastError.retryable !== true || attempt >= retries) throw lastError
    } finally {
      clearTimeout(timer)
    }
    await readerSleep(Math.min(base * 2 ** attempt, RETRY_MAX_DELAY_MS))
  }
  throw lastError
}

/* Read a response body as text with a hard cap. The stream reader is used
 * (not `res.text()`) so an aborted or closed socket ends the read instead of
 * leaving the request hanging, and so a huge body cannot exhaust memory. */
async function readBoundedText(response, cap = 2_000_000) {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const raw = await response.text()
    return String(raw ?? '').slice(0, cap)
  }
  const dec = new TextDecoder()
  let out = ''
  try {
    while (out.length <= cap) {
      const { done, value } = await reader.read()
      if (done) break
      out += dec.decode(value, { stream: true })
    }
    if (out.length > cap) {
      out = out.slice(0, cap)
      await reader.cancel().catch(() => {})
    } else {
      out += dec.decode()
    }
  } catch (e) {
    if (out) return out
    throw e
  }
  return out
}

async function responseText(response) {
  if (!response.ok) {
    const detail = await readBoundedText(response, 4000).catch(() => '')
    throw classifyReaderStatus(response.status, detail)
  }
  return readBoundedText(response)
}

async function responseJson(response) {
  if (!response.ok) {
    const detail = await readBoundedText(response, 4000).catch(() => '')
    throw classifyReaderStatus(response.status, detail)
  }
  const raw = await readBoundedText(response)
  try { return JSON.parse(raw) }
  catch { throw readerFailure('The reader API returned invalid JSON.', { code: 'bad_response' }) }
}

function pickReaderText(body) {
  const candidates = [
    body?.text, body?.content, body?.markdown, body?.data?.text, body?.data?.content, body?.data?.markdown,
    body?.data?.content?.markdown, body?.data?.content?.text, body?.data?.data?.content,
    body?.results?.[0]?.text, body?.results?.[0]?.content, body?.results?.[0]?.markdown,
  ]
  for (const value of candidates) if (typeof value === 'string' && value.trim()) return value
  return ''
}

function pickReaderTitle(body) {
  const candidates = [body?.title, body?.data?.title, body?.data?.metadata?.title, body?.metadata?.title, body?.results?.[0]?.title]
  for (const value of candidates) if (typeof value === 'string' && value.trim()) return value
  return ''
}

function parseJinaText(raw) {
  let text = String(raw || '').trim()
  let title = ''
  const titleMatch = /^Title:\s*(.+)$/m.exec(text)
  if (titleMatch) title = titleMatch[1].trim()
  if (/^Title:\s*/m.test(text)) {
    text = text.replace(/^Title:\s*.*\n?/m, '').replace(/^URL Source:\s*.*\n?/m, '').replace(/^Markdown Content:\s*\n?/m, '')
  }
  return { title, text: text.trim() }
}

function readerTarget(url, base, placeholderMode = false) {
  const baseUrl = String(base || '').trim()
  if (placeholderMode || baseUrl.includes('{url}')) {
    const target = baseUrl.includes('{url}')
      ? baseUrl.replace(/\{url\}/g, encodeURIComponent(url))
      : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`
    return target
  }
  return `${baseUrl.replace(/\/+$/, '')}/${url}`
}

async function runReaderProvider(provider, targetUrl, { apiKey, baseUrl, timeoutMs, maxRetries, retryBaseMs, fetchFn, limit }) {
  const meta = READER_PROVIDERS[provider]
  const key = String(apiKey || '').trim()
  const base = String(baseUrl || '').trim() || meta?.endpoint || ''
  if (provider === 'jina') {
    if (!base) throw readerFailure('Add the Jina Reader URL.', { code: 'missing_key' })
    const endpoint = readerTarget(targetUrl, base)
    if (!isPublicHttp(endpoint)) throw readerFailure('The reader URL must be a public http(s) address.', { code: 'bad_url' })
    return withReaderRetry(async (signal) => {
      const res = await fetchFn(endpoint, {
        signal,
        headers: { accept: 'text/plain', 'x-respond-with': 'markdown', 'user-agent': 'byok-chat-reader/1.0', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      })
      const { title, text } = parseJinaText(await responseText(res))
      return { title, text }
    }, { timeoutMs, maxRetries, retryBaseMs, label: meta.label })
  }
  if (provider === 'firecrawl') {
    if (!base) throw readerFailure('Add the Firecrawl reader URL.', { code: 'missing_key' })
    if (!isPublicHttp(base)) throw readerFailure('The reader URL must be a public http(s) address.', { code: 'bad_url' })
    return withReaderRetry(async (signal) => {
      const res = await fetchFn(base, {
        method: 'POST',
        signal,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'byok-chat-reader/1.0', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ url: targetUrl, formats: ['markdown'], onlyMainContent: true }),
      })
      const body = await responseJson(res)
      return { title: pickReaderTitle(body), text: pickReaderText(body) }
    }, { timeoutMs, maxRetries, retryBaseMs, label: meta.label })
  }
  if (provider === 'exa') {
    if (!key) throw readerFailure('Exa needs a reader API key. Paste one in Settings → Tools → Page reader, or use the Exa search key.', { code: 'missing_key' })
    if (!base) throw readerFailure('Add the Exa reader URL.', { code: 'missing_key' })
    if (!isPublicHttp(base)) throw readerFailure('The reader URL must be a public http(s) address.', { code: 'bad_url' })
    return withReaderRetry(async (signal) => {
      const res = await fetchFn(base, {
        method: 'POST',
        signal,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': key, 'user-agent': 'byok-chat-reader/1.0' },
        body: JSON.stringify({ urls: [targetUrl], text: { maxCharacters: limit } }),
      })
      const body = await responseJson(res)
      return { title: pickReaderTitle(body), text: pickReaderText(body) }
    }, { timeoutMs, maxRetries, retryBaseMs, label: meta.label })
  }
  // Custom service: `{url}` is replaced when present, otherwise ?url= is appended.
  if (!base) throw readerFailure('Add your reader API URL in Settings → Tools → Page reader.', { code: 'missing_key' })
  const endpoint = readerTarget(targetUrl, base, true)
  const check = base.includes('{url}') ? base.replace(/\{url\}/g, 'https://example.com') : base
  if (!isPublicHttp(check)) throw readerFailure('The reader URL must be a public http(s) address.', { code: 'bad_url' })
  return withReaderRetry(async (signal) => {
    const res = await fetchFn(endpoint, {
      signal,
      headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'byok-chat-reader/1.0', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    })
    const type = res.headers?.get?.('content-type') ?? ''
    if (!res.ok) {
      const detail = await readBoundedText(res, 4000).catch(() => '')
      throw classifyReaderStatus(res.status, detail)
    }
    if (/json/i.test(type)) {
      const body = await responseJson(res)
      const text = pickReaderText(body)
      return { title: pickReaderTitle(body), text: typeof text === 'string' ? text : JSON.stringify(body) }
    }
    return parseJinaText(await responseText(res))
  }, { timeoutMs, maxRetries, retryBaseMs, label: meta.label })
}

/* Read a page through a chosen extraction API. Falls back to the built-in
 * reader when configured, so a transient reader-API failure does not break
 * grounding. */
export async function fetchPageViaProvider(url, {
  provider = 'builtin',
  apiKey = '',
  baseUrl = '',
  fallback = true,
  timeoutMs = 8000,
  maxChars = EXTRACT_MAX_TEXT,
  maxRetries = 0,
  retryBaseMs = 300,
  fetchFn = fetch,
} = {}) {
  const id = normalizeReaderProvider(provider)
  if (id === 'builtin') return fetchPageText(url, { timeoutMs, maxChars, maxRetries, retryBaseMs, fetchFn })
  if (!isPublicHttp(url)) {
    const e = Error('Only public http(s) pages can be read.')
    e.code = 'bad_url'
    throw e
  }
  const limit = clampInt(maxChars, EXTRACT_MAX_TEXT, 1_000, EXTRACT_TEXT_MAX)
  const key = `${id}|${baseUrl || ''}|${url}|${limit}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 600_000) return hit.data
  try {
    const { title, text } = await runReaderProvider(id, url, { apiKey, baseUrl, timeoutMs, maxRetries, retryBaseMs, fetchFn, limit })
    const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!clean) {
      const err = Error('The reader API returned no readable text for that page.')
      err.code = 'empty'
      throw err
    }
    const truncated = clean.length > limit
    const data = { url, title: String(title || url).replace(/\s+/g, ' ').trim().slice(0, 300), text: truncated ? clean.slice(0, limit) : clean, truncated, reader: id }
    cache.set(key, { at: Date.now(), data })
    if (cache.size > 200) cache.delete(cache.keys().next().value)
    return data
  } catch (e) {
    if (fallback !== false && e?.code !== 'bad_url') {
      const data = await fetchPageText(url, { timeoutMs, maxChars, maxRetries, retryBaseMs, fetchFn })
      return { ...data, reader: 'builtin', fallbackUsed: true }
    }
    throw e
  }
}
