/* Cloudflare Worker entry point (Workers + Static Assets).
 *
 * API routes (/api/health, /api/search, /api/extract, /api/sync/*) run here,
 * on the Worker.
 * Every other request is served from the frontend build in ./dist as a
 * static asset — see `assets` in wrangler.jsonc. Only /api/* runs the Worker
 * first (`run_worker_first`), so static asset requests do not count against
 * the Workers request quota, and API requests never fall back to index.html.
 *
 * Deployment secrets (set with `wrangler secret put <NAME>`):
 *   TINYFISH_API_KEY, YOU_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY,
 *   BRIGHTDATA_API_KEY, SEARCH_API_KEY, SEARCH_API_ZONE, DATABASE_URL
 */
import { apiRoute } from '../server/api.mjs'
import { proxyRoute } from '../server/proxy.mjs'
import { jsonResult } from '../server/http.mjs'

function toResponse(result) {
  // HEAD (and any route that answers without content) must send no body at all.
  return new Response(result.body === null ? null : JSON.stringify(result.body), { status: result.status, headers: result.headers })
}

/* Extension of a URL path ("" when none). Mirrors node:path.extname for the
 * static-asset decision below without depending on node:path. */
function pathExtension(pathname) {
  const i = pathname.lastIndexOf('/')
  const name = i < 0 ? pathname : pathname.slice(i + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

export default {
  async fetch(request, env) {
    try {
      // Provider relay first: it answers with a streaming Response rather than
      // the JSON result descriptor apiRoute returns. Same-origin from the
      // browser's point of view, so no provider CORS headers are needed.
      const proxied = await proxyRoute(request, env)
      if (proxied) return proxied
      const result = await apiRoute(request, env)
      if (result) return toResponse(result)
    } catch (error) {
      // Never leak internals to the client; details go to `wrangler tail`.
      console.error(`[api] unhandled error: ${error?.stack || error}`)
      return toResponse(jsonResult(500, { error: 'Internal server error' }))
    }
    // Non-API requests are normally served before the Worker runs; this
    // fallback keeps direct Worker hits and `run_worker_first: true` working.
    // It mirrors server.mjs: with `not_found_handling: "none"` the asset layer
    // 404s missing files, so a missing asset-like path must 404 (a 200
    // text/html answer breaks dynamic imports and confuses caches) while an
    // extensionless path still gets the SPA shell.
    if (env?.ASSETS?.fetch) {
      const assetResponse = await env.ASSETS.fetch(request)
      if (assetResponse.status !== 404) return assetResponse
      const { pathname } = new URL(request.url)
      if (pathExtension(pathname) && pathname !== '/index.html') {
        return toResponse(jsonResult(404, { error: 'Not found' }))
      }
      const shell = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), { headers: request.headers }))
      if (shell.status === 404) {
        return toResponse(jsonResult(404, { error: 'Application files not found. Run npm run build first.' }))
      }
      return shell
    }
    return toResponse(jsonResult(404, { error: 'Not found' }))
  },
}
