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
 * a Fetch API Request, capping it at `max` characters. Returns null when the
 * body exceeds the cap so callers can answer with 413. */
export async function readBodyText(req, max = 16_384) {
  if (typeof req?.text === 'function') {
    const declared = Number(headerValue(req, 'content-length'))
    if (Number.isFinite(declared) && declared > max) return null
    const raw = await req.text()
    return raw.length > max ? null : raw
  }
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > max) return null
  }
  return raw
}

export function clientIp(req) {
  return headerValue(req, 'cf-connecting-ip') || req?.socket?.remoteAddress || 'unknown'
}

/* Same-origin guard for state-changing endpoints. Browsers send Origin on
 * same-origin POSTs; the origin host must match the request host. Requests
 * without an Origin header (curl, workers-to-workers) pass unguarded. */
export function sameOrigin(origin, host) {
  if (!origin) return true
  try { return new URL(origin).host === host } catch { return false }
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
