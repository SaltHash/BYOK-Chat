/* Environment-neutral request helpers shared by the Node server (server.mjs)
 * and the Cloudflare Worker (worker/index.mjs). Both receive their requests
 * as Node IncomingMessage objects and Fetch API Request objects respectively,
 * so every helper here accepts either shape. */

export function headerValue(req, name) {
  const headers = req?.headers
  if (!headers) return ''
  if (typeof headers.get === 'function') return String(headers.get(name) ?? '')
  const value = headers[name.toLowerCase()]
  return String(Array.isArray(value) ? value[0] : value ?? '')
}

export function requestHost(req) {
  const host = headerValue(req, 'host')
  if (host) return host
  try { return new URL(req.url).host } catch { return '' }
}

export function bearerToken(req) {
  const m = /^Bearer (.+)$/.exec(headerValue(req, 'authorization').trim())
  return m ? m[1] : ''
}

/* Reads a request body as text from either an async-iterable Node stream or
 * a Fetch API Request, capping it at `max` (characters; bytes for Node
 * streams, which is at least as strict). Returns null when the body exceeds
 * the cap so callers can answer with 413. Bodies are decoded as UTF-8 across
 * chunk boundaries (a multi-byte character split between two chunks would
 * otherwise be corrupted) and oversized bodies are dropped as soon as the cap
 * is crossed instead of being buffered whole. */
export async function readBodyText(req, max = 16_384) {
  const declared = Number(headerValue(req, 'content-length'))
  if (Number.isFinite(declared) && declared > max) return null
  if (typeof req?.text === 'function') {
    if (typeof req.body?.getReader === 'function') {
      const reader = req.body.getReader()
      const decoder = new TextDecoder()
      let raw = ''
      let overflow = false
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          raw += decoder.decode(value, { stream: true })
          if (raw.length > max) { overflow = true; break }
        }
      } finally {
        if (overflow) await reader.cancel().catch(() => {})
      }
      return overflow ? null : raw + decoder.decode()
    }
    const raw = await req.text()
    return raw.length > max ? null : raw
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > max) return null
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/* Best-effort client identifier for rate limiting. Proxy headers decide the
 * address only where they cannot be spoofed: Cloudflare always rewrites
 * `cf-connecting-ip` (and Worker requests have no socket), while a Node
 * deployment must opt in with TRUST_PROXY=1 when it sits behind a trusted
 * reverse proxy. Otherwise the socket address wins, so a client cannot forge
 * a fresh identity per request to bypass the rate limits. */
export function clientIp(req, env = {}) {
  const socket = req?.socket?.remoteAddress
  const forwarded = headerValue(req, 'cf-connecting-ip') || headerValue(req, 'x-forwarded-for').split(',')[0].trim()
  if (!socket) return forwarded || 'unknown'
  return env.TRUST_PROXY ? forwarded || socket : socket
}

/* Same-origin guard for state-changing endpoints. Browsers send Origin on
 * same-origin POSTs; the origin host must match the request host. Requests
 * without an Origin header (curl, workers-to-workers) pass unguarded. */
export function sameOrigin(origin, host) {
  if (!origin) return true
  try { return new URL(origin).host.toLowerCase() === String(host || '').toLowerCase() } catch { return false }
}

/* Plain response descriptor produced by server/api.mjs. Each host adapts it:
 * node:http via writeHead/end, the Worker via new Response(). */
export function jsonResult(status, body, headers = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
    body,
  }
}
