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
import { jsonResult } from '../server/http.mjs'

function toResponse(result) {
  // HEAD (and any route that answers without content) must send no body at all.
  return new Response(result.body === null ? null : JSON.stringify(result.body), { status: result.status, headers: result.headers })
}

export default {
  async fetch(request, env) {
    try {
      const result = await apiRoute(request, env)
      if (result) return toResponse(result)
    } catch (error) {
      // Never leak internals to the client; details go to `wrangler tail`.
      console.error(`[api] unhandled error: ${error?.stack || error}`)
      return toResponse(jsonResult(500, { error: 'Internal server error' }))
    }
    // Non-API requests are normally served before the Worker runs; this
    // fallback keeps direct Worker hits and `run_worker_first: true` working.
    if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request)
    return toResponse(jsonResult(404, { error: 'Not found' }))
  },
}
