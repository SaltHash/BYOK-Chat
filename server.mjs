import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { apiRoute } from './server/api.mjs'
import { jsonResult } from './server/http.mjs'

// An invalid PORT should fail loudly instead of silently listening elsewhere.
const requestedPort = Number(process.env.PORT || 8787)
const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 8787
if (requestedPort !== port) console.warn(`[server] ignored invalid PORT=${process.env.PORT}; using ${port}`)
const root = resolve(process.env.STATIC_DIR || 'dist')
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
}

function sendResult(res, result) {
  res.writeHead(result.status, result.headers)
  res.end(JSON.stringify(result.body))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  try {
    // /api/* is handled by the shared core in server/api.mjs — the same module
    // the Cloudflare Worker (worker/index.mjs) runs — so both hosts behave
    // identically. Everything else falls through to static file serving.
    const result = await apiRoute(req, process.env)
    if (result) return sendResult(res, result)
  } catch (error) {
    console.error(`[api] unhandled error: ${error?.stack || error}`)
    return sendResult(res, jsonResult(500, { error: 'Internal server error' }))
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendResult(res, jsonResult(405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' }))
  let path
  try { path = decodeURIComponent(url.pathname) } catch { return sendResult(res, jsonResult(400, { error: 'Invalid path' })) }
  if (path === '/') path = '/index.html'
  const file = resolve(root, '.' + path)
  if (file !== root && !file.startsWith(root + sep)) return sendResult(res, jsonResult(400, { error: 'Invalid path' }))
  try {
    const info = await stat(file)
    const target = info.isDirectory() ? resolve(file, 'index.html') : file
    const data = await readFile(target)
    res.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' })
    return res.end(req.method === 'HEAD' ? undefined : data)
  } catch {
    // Missing static files (for example a hashed chunk from a previous build)
    // must 404 instead of answering with the HTML shell — a 200 text/html
    // response for a .js request breaks dynamic imports and confuses caches.
    // Extension-less paths keep the SPA fallback, matching the Worker's
    // `not_found_handling: single-page-application` asset routing.
    if (path !== '/index.html' && extname(path)) return sendResult(res, jsonResult(404, { error: 'Not found' }))
    try {
      const data = await readFile(resolve(root, 'index.html'))
      res.writeHead(200, { 'content-type': mime['.html'], 'x-content-type-options': 'nosniff' })
      return res.end(req.method === 'HEAD' ? undefined : data)
    } catch { return sendResult(res, jsonResult(404, { error: 'Application files not found. Run npm run build first.' })) }
  }
})

server.listen(port, '0.0.0.0', () => console.log(`BYOK Chat listening on :${port}`))
