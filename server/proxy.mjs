/* Same-origin request proxy: `/api/proxy?url=<encoded absolute URL>`.
 *
 * Many inference APIs (and plenty of MCP servers) answer browsers with no
 * `Access-Control-Allow-Origin` header at all, so a page can never call them
 * directly — from localhost or from production, the browser blocks the
 * response regardless of origin. Routing those requests through the app's own
 * origin removes the browser's cross-origin check without touching the
 * provider: the hop from this server to the provider is not subject to CORS.
 *
 * This is a true fix, not a workaround: the provider is reached at its real
 * URL with the real key, streaming (SSE) responses are passed through
 * unbuffered, and the browser keeps its BYOK behaviour because the key is
 * forwarded per request and never stored.
 *
 * Security posture (it is an egress path, so it must not become an open
 * relay):
 *  - only http(s) targets, never with embedded credentials;
 *  - private/loopback/link-local/metadata hosts are refused unless the app
 *    itself is being served from localhost (local self-hosted gateways such as
 *    Bifrost or LiteLLM) or PROXY_ALLOW_PRIVATE=1 is set;
 *  - PROXY_ALLOWED_HOSTS (comma-separated, `*.suffix` allowed) turns the proxy
 *    into a strict allowlist and takes precedence over the rules above;
 *  - state-changing requests must be same-origin, like every other /api route;
 *  - its own sliding-window rate limit, independent of the search routes;
 *  - the Node host passes pinnedFetch, which pins DNS at connect time
 *    (see pinnedFetch.mjs), so a rebinding DNS answer cannot reach an
 *    internal address after the check above;
 *  - hop-by-hop, cookie and CORS headers are stripped in both directions.
 */

import { clientIp, headerValue, readBodyBytes, requestHeaders, requestHost, sameOrigin } from './http.mjs'
import { isPublicIpAddress } from './extract.mjs'
import { overRateLimit, bumpRateLimit } from './ratelimit.mjs'

export const PROXY_PATH = '/api/proxy'

const MAX_BODY_BYTES = 32 * 1024 * 1024
const MAX_REDIRECTS = 3
// Chat turns (including tool loops) are frequent; searches are not. This is a
// separate bucket with a higher ceiling than the 30/min API default.
const PROXY_RATE_LIMIT = 120
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])

const proxyLimit = new Map()

/* Headers that describe the browser↔this-server hop and must never be
 * forwarded upstream. Everything else (authorization, api-key, x-api-key,
 * anthropic-*, user-supplied extras) is passed through unchanged. */
const DROP_REQUEST = /^(?:host|connection|keep-alive|proxy-authenticate|proxy-authorization|te|trailer|transfer-encoding|upgrade|content-length|origin|referer|cookie|accept-encoding|priority|cdn-loop)$/i
const DROP_REQUEST_PREFIX = /^(?:sec-|cf-|x-forwarded-|x-real-ip|x-proxy)/i

/* Response headers that belong to the upstream hop, to the browser's CORS
 * layer, or to a cookie jar this proxy deliberately does not have. */
const DROP_RESPONSE = /^(?:set-cookie|set-cookie2|content-encoding|content-length|transfer-encoding|connection|keep-alive|access-control-|vary|alt-svc|server|strict-transport-security|expect-ct|report-to|nel|date)$/i

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    // The marker lets the client tell a relay refusal apart from a provider
    // answer, so "host not allowed" is never reported as a bad API key.
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-byok-proxy-error': '1', ...headers },
  })
}

/** Configured allowlist, lowercased. Empty means "no strict allowlist". */
export function proxyAllowlist(env = {}) {
  return String(env?.PROXY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^\./, '*.'))
    .filter(Boolean)
}

function allowlistMatches(host, entry) {
  if (entry === '*') return true
  if (entry.startsWith('*.')) return host.endsWith(entry.slice(1))
  return host === entry || host.endsWith(`.${entry}`)
}

function isLocalAppHost(host) {
  const name = String(host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name.endsWith('.localhost')
}

/* Hostnames that always mean "the machine this server runs on" or a cloud
 * metadata service, whatever the DNS answer says. */
function isInternalName(host) {
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host === 'metadata.google.internal'
    || host === 'metadata'
    || host === 'instance-data'
}

/** Whether `target` (a URL object) may be fetched by this proxy. */
export function proxyTargetAllowed(target, env = {}, appHost = '') {
  if (!(target instanceof URL)) return false
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
  if (target.username || target.password) return false
  if (target.port && !/^\d+$/.test(target.port)) return false
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  const allow = proxyAllowlist(env)
  if (allow.length) return allow.some((entry) => allowlistMatches(host, entry))
  const privateAllowed = String(env?.PROXY_ALLOW_PRIVATE ?? '') === '1' || isLocalAppHost(appHost)
  const ipLike = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')
  if (ipLike) {
    const publicIp = isPublicIpAddress(host)
    return privateAllowed ? true : publicIp
  }
  if (isInternalName(host)) return privateAllowed
  return true
}

/** Parse the `url` query parameter; null when missing or not absolute http(s). */
export function proxyTargetOf(url) {
  const raw = url.searchParams.get('url') || ''
  if (!raw) return null
  try {
    const target = new URL(raw)
    return target.protocol === 'https:' || target.protocol === 'http:' ? target : null
  } catch { return null }
}

/* Copy a Headers-like object into a plain Headers instance. `pinnedFetch`
 * exposes only get/entries/forEach (it is not a real Headers), so this avoids
 * depending on the constructor. */
function headersFrom(source, filter) {
  const out = new Headers()
  if (!source) return out
  const pairs = typeof source.entries === 'function'
    ? [...source.entries()]
    : typeof source.forEach === 'function'
      ? (() => { const list = []; source.forEach((value, name) => list.push([name, value])); return list })()
      : []
  for (const pair of pairs) {
    const [name, raw] = pair
    const key = String(name).toLowerCase()
    if (filter(key)) continue
    try { out.set(key, Array.isArray(raw) ? raw.join(', ') : String(raw ?? '')) } catch { /* invalid header */ }
  }
  return out
}

/* A plain object, not a Headers instance: the Node host relays through
 * pinnedFetch, which hands the map to node:http (a Headers object would look
 * empty there and silently drop Authorization). Global fetch accepts both. */
function forwardRequestHeaders(req, body) {
  const source = requestHeaders(req)
  const out = headersFrom(source, (name) => DROP_REQUEST.test(name) || DROP_REQUEST_PREFIX.test(name))
  if (body != null) out.set('content-length', String(body.length))
  // The proxy speaks for itself upstream; a browser UA is not useful there and
  // some APIs gate on it.
  out.delete('user-agent')
  return Object.fromEntries(out.entries())
}

function responseHeaders(res) {
  return headersFrom(res?.headers, (name) => DROP_RESPONSE.test(name))
}

/* `pinnedFetch` hands back a reader-only body; a real Response body is a
 * ReadableStream. Wrap only when needed. */
function webBodyOf(res, status) {
  if (status === 204 || status === 304) return null
  const body = res?.body
  if (!body) return null
  if (typeof body.tee === 'function') return body
  const reader = body.getReader()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel(reason) { return reader.cancel?.(reason) },
  })
}

/** One upstream request, following redirects only through allowed hosts. */
async function fetchUpstream(target, init, env, appHost, fetchFn) {
  let current = target
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!proxyTargetAllowed(current, env, appHost)) return { blocked: true, target: current }
    const res = await fetchFn(current.toString(), { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const location = res.headers?.get?.('location')
      if (location) {
        try { await res.body?.cancel?.() } catch { /* already closed */ }
        let next
        try { next = new URL(location, current) } catch { return { res, finalUrl: current } }
        current = next
        continue
      }
    }
    return { res, finalUrl: current }
  }
  return { tooManyRedirects: true, target: current }
}

/**
 * Handles `/api/proxy` and returns a Fetch API `Response`, or null when the
 * request is for another route. Each host adapts the Response: the Worker
 * returns it as-is, the Node server streams it onto `res`.
 */
export async function proxyRoute(req, env = {}, opts = {}) {
  let url
  try { url = new URL(req.url || '/', 'http://localhost') } catch { return null }
  if (url.pathname !== PROXY_PATH) return null
  const fetchFn = opts.fetchFn ?? fetch

  const method = String(req.method || 'GET').toUpperCase()
  if (!METHODS.has(method)) return jsonResponse(405, { error: 'Method not allowed', code: 'method_not_allowed' }, { allow: [...METHODS].join(', ') })

  // Same-origin guard for state-changing requests, as elsewhere in /api.
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(headerValue(req, 'origin'), requestHost(req))) {
    return jsonResponse(403, { error: 'Cross-origin request refused', code: 'cross_origin' })
  }

  const ip = clientIp(req, env)
  const now = Date.now()
  if (overRateLimit(proxyLimit, ip, now, PROXY_RATE_LIMIT)) {
    return jsonResponse(429, { error: 'Proxy limit reached. Try again in a minute.', code: 'rate_limited' }, { 'retry-after': '60' })
  }
  bumpRateLimit(proxyLimit, ip, now)

  const target = proxyTargetOf(url)
  if (!target) return jsonResponse(400, { error: 'The "url" query parameter must be an absolute http(s) URL.', code: 'bad_target' })
  const appHost = requestHost(req)
  if (!proxyTargetAllowed(target, env, appHost)) {
    return jsonResponse(403, { error: `The proxy may not reach ${target.hostname}. Add it to PROXY_ALLOWED_HOSTS to allow it.`, code: 'target_not_allowed' })
  }

  let body
  if (method !== 'GET' && method !== 'HEAD') {
    body = await readBodyBytes(req, MAX_BODY_BYTES)
    if (body === null) return jsonResponse(413, { error: 'Request is too large', code: 'too_large' })
  }

  // Every hop is re-checked by proxyTargetAllowed; this flag only tells the
  // Node host's DNS-pinning fetch that a private address is expected (local
  // app or explicit allowlist), so it should pin whatever resolves instead of
  // demanding a public address.
  const allowPrivate = String(env?.PROXY_ALLOW_PRIVATE ?? '') === '1'
    || isLocalAppHost(appHost)
    || proxyAllowlist(env).length > 0
  const init = { method, headers: forwardRequestHeaders(req, body), allowPrivate, ...(body != null ? { body } : {}) }
  let upstream
  try {
    upstream = await fetchUpstream(target, init, env, appHost, fetchFn)
  } catch (error) {
    // Never echo the upstream message: it can contain a key echoed by a
    // misconfigured server, and it is not actionable for the page.
    return jsonResponse(502, { error: `The proxy could not reach ${target.hostname}.`, code: 'proxy_failed' })
  }
  if (upstream.blocked) return jsonResponse(403, { error: `The proxy may not reach ${upstream.target.hostname}.`, code: 'target_not_allowed' })
  if (upstream.tooManyRedirects) return jsonResponse(502, { error: `The proxy gave up after ${MAX_REDIRECTS} redirects.`, code: 'too_many_redirects' })

  const { res, finalUrl } = upstream
  const headers = responseHeaders(res)
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  if (finalUrl !== target) headers.set('x-proxy-final-url', finalUrl.toString())
  const outBody = method === 'HEAD' ? null : webBodyOf(res, res.status)
  try {
    return new Response(outBody, { status: res.status, headers })
  } catch {
    return jsonResponse(502, { error: 'The upstream response could not be relayed.', code: 'proxy_failed' })
  }
}
