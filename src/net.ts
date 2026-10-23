/* Provider request transport.
 *
 * Every model, image, catalog and MCP call goes straight from this page to the
 * provider, which means the browser's CORS rules apply. Plenty of APIs simply
 * never send `Access-Control-Allow-Origin` (Cloudflare Workers AI, llmtech.eu,
 * countless self-hosted gateways), so those requests can never succeed in a
 * browser no matter which origin the app is served from.
 *
 * `providerFetch` keeps the direct path as the default and, when the browser
 * blocks it, retries the exact same request through this app's own server
 * (`/api/proxy`). That hop is same-origin, so CORS is out of the picture, and
 * the key is still supplied per request and never stored server-side.
 *
 * Modes (Settings → Endpoints → Request routing):
 *   auto   - direct first, relay only when the browser blocks the request
 *   always - every provider request goes through this app's server
 *   off    - direct only; providers without CORS stay unreachable
 */

export const PROXY_PATH = '/api/proxy'

export type ProxyMode = 'auto' | 'always' | 'off'
export const PROXY_MODES: ProxyMode[] = ['auto', 'always', 'off']

let mode: ProxyMode = 'auto'

export const proxyModeOf = (): ProxyMode => mode
export const setProxyMode = (next: unknown): void => {
  mode = PROXY_MODES.includes(next as ProxyMode) ? (next as ProxyMode) : 'auto'
}

/** Absolute URL for a request target, or null when it cannot be parsed. */
function absolute(target: string | URL): string | null {
  if (target instanceof URL) return target.href
  const raw = String(target ?? '').trim()
  if (!raw) return null
  try { return new URL(raw, typeof location !== 'undefined' ? location.href : undefined).href } catch { return null }
}

/** True when `target` is a cross-origin http(s) URL that the relay can reach. */
export function isProxyable(target: string | URL): boolean {
  if (typeof location === 'undefined') return false
  const abs = absolute(target)
  if (!abs) return false
  let u: URL
  try { u = new URL(abs) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  // Same-origin requests (this app's own /api routes) are never relayed.
  if (u.origin === location.origin) return false
  return true
}

/** The same-origin relay URL for a provider target. */
export function proxyUrlFor(target: string | URL): string {
  const abs = absolute(target) ?? String(target)
  return `${PROXY_PATH}?url=${encodeURIComponent(abs)}`
}

/* Only bodies that can be sent twice may be retried through the relay: the
 * first (blocked) attempt may already have consumed a stream. */
function reusableBody(body: BodyInit | null | undefined): boolean {
  return body == null || typeof body === 'string' || body instanceof URLSearchParams
    || (typeof Blob !== 'undefined' && body instanceof Blob)
    || body instanceof ArrayBuffer || ArrayBuffer.isView(body)
}

/* A static-only deployment (no Node server, no Worker) answers /api/proxy with
 * the SPA shell or a 404 page. Surface that instead of a confusing upstream
 * parse error. */
function proxyMissing(res: Response): boolean {
  // The relay always answers with JSON (or the provider's own content type).
  // An HTML/empty 404 is the host's asset layer, i.e. no backend at all.
  const type = (res.headers.get('content-type') || '').toLowerCase()
  if (type.includes('text/html')) return true
  return res.status === 404 && !type
}

export class ProxyUnavailableError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'TypeError'
  }
}

/**
 * `fetch` for provider traffic with an automatic same-origin relay fallback.
 * Behaves exactly like the global fetch apart from the transport choice.
 */
export async function providerFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const raw = request ? request.url : (input as string | URL)
  const target = absolute(raw) ?? String(raw)
  // A Request object carries its own options (and possibly a stream body that
  // the blocked attempt already consumed), so it is always sent directly.
  // Every provider call site passes a URL string plus init instead.
  const canRelay = !request && isProxyable(target) && reusableBody(init.body)
  if (!canRelay || mode === 'off') return fetch(input, init)
  if (mode === 'always') return relay(target, init)

  try {
    return await fetch(input, init)
  } catch (error: any) {
    if (error?.name === 'AbortError' || init.signal?.aborted) throw error
    try {
      return await relay(target, init)
    } catch (relayError: any) {
      // Keep the original browser error (it is what the caller maps to a CORS
      // message) unless the relay gave us something more specific.
      throw relayError instanceof ProxyUnavailableError ? relayError : error
    }
  }
}

async function relay(target: string, init: RequestInit): Promise<Response> {
  const res = await fetch(proxyUrlFor(target), init)
  if (proxyMissing(res)) {
    throw new ProxyUnavailableError(
      'This deployment has no request proxy, so providers that block browser (CORS) requests cannot be reached. Run the Node server or the Cloudflare Worker, or pick a provider that allows browser requests.',
    )
  }
  return res
}
