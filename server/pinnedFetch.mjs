/* Node-only fetch with connect-time DNS pinning.
 *
 * `isPublicHttp` validates a URL before the request starts, but the hostname
 * is resolved again when the socket connects — a hostile DNS server can answer
 * "public" for the check and "127.0.0.1" for the connection (DNS rebinding).
 * This wrapper resolves the host once, verifies every candidate address
 * against the same public-address rules, and then hands the verified address
 * to the socket layer through Node's `lookup` hook: the connection can only go
 * to an address that passed the check. TLS/SNI and the Host header still use
 * the original hostname, so certificates keep validating as usual.
 *
 * Only server.mjs (the Node host) imports this module; the Cloudflare Worker
 * uses the runtime's own fetch and its egress guarantees.
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup } from 'node:dns'
import { isPublicIpAddress } from './extract.mjs'

const abortError = () => {
  const e = Error('The request was aborted.')
  e.name = 'AbortError'
  return e
}

const normalizeError = (error, signal) => (
  error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || signal?.aborted ? abortError() : error
)

/* Minimal Fetch-API Response adapter for node:http. Implements only what the
 * page reader uses: ok/status/headers.get, body.getReader()/cancel(). */
function adaptResponse(res, signal) {
  const status = res.statusCode || 0
  const queue = []
  let ended = false
  let failure = null
  let parked = null
  const settle = () => {
    if (!parked) return
    const p = parked
    parked = null
    if (failure) p.reject(failure)
    else if (queue.length) p.resolve({ done: false, value: queue.shift() })
    else if (ended) p.resolve({ done: true, value: undefined })
  }
  res.on('data', (chunk) => { queue.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length)); settle() })
  res.on('end', () => { ended = true; settle() })
  res.on('close', () => { ended = true; settle() })
  res.on('error', (error) => { failure = normalizeError(error, signal); ended = true; settle() })
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        const value = res.headers[String(name).toLowerCase()]
        return Array.isArray(value) ? value.join(', ') : (value ?? null)
      },
    },
    body: {
      cancel: async () => { res.destroy() },
      getReader: () => ({
        read: () => {
          if (queue.length) return Promise.resolve({ done: false, value: queue.shift() })
          if (failure) return Promise.reject(failure)
          if (ended) return Promise.resolve({ done: true, value: undefined })
          return new Promise((resolve, reject) => { parked = { resolve, reject } })
        },
        cancel: async () => { res.destroy() },
      }),
    },
    text: () => new Promise((resolve, reject) => {
      const chunks = []
      let settled = false
      const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
      // A closed socket ends the body too (abort, reset, or a server that
      // never sends the last chunk). Without this the promise would hang
      // forever, because `end` never fires for a destroyed response.
      res.on('close', () => finish(Buffer.concat(chunks).toString('utf8')))
      res.on('error', (error) => { if (!settled) { settled = true; reject(normalizeError(error, signal)) } })
    }),
  }
}

/** Fetch a URL with the resolved (and verified) IP pinned for the connection. */
export function pinnedFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch { return reject(Object.assign(Error('Invalid URL.'), { code: 'bad_url' })) }
    const badUrl = () => Object.assign(Error('The page resolved to a non-public address.'), { code: 'bad_url' })
    // The socket layer skips `lookup` for IP literals, so check those here.
    const literal = u.hostname.replace(/^\[|\]$/g, '')
    if ((/^\d+\.\d+\.\d+\.\d+$/.test(literal) || literal.includes(':')) && !isPublicIpAddress(literal)) {
      return reject(badUrl())
    }
    const requestFn = u.protocol === 'https:' ? httpsRequest : httpRequest
    let pinned = null
    // Node calls this instead of dns.lookup when connecting; returning the
    // already-verified address closes the check/connect race. With happy
    // eyeballs (`all: true`) the socket layer expects an array of candidates.
    const lookup = (hostname, options, cb) => {
      const respond = (address, family) => (options?.all ? cb(null, [{ address, family }]) : cb(null, address, family))
      if (pinned) return respond(pinned.address, pinned.family)
      dnsLookup(hostname, { all: true }, (error, addresses) => {
        if (error) return cb(error)
        const ok = (addresses || []).find((a) => isPublicIpAddress(a.address))
        if (!ok) return cb(Object.assign(Error('The page resolved to a non-public address.'), { code: 'bad_url' }))
        pinned = { address: ok.address, family: ok.family }
        respond(ok.address, ok.family)
      })
    }
    const req = requestFn({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: `${u.pathname}${u.search}`,
      method: init.method || 'GET',
      headers: init.headers,
      signal: init.signal,
      lookup,
    }, (res) => resolve(adaptResponse(res, init.signal)))
    req.on('error', (error) => reject(normalizeError(error, init.signal)))
    req.end()
  })
}
