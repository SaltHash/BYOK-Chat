import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { apiRoute } from './server/api.mjs'
import { jsonResult } from './server/http.mjs'
import { pinnedFetch } from './server/pinnedFetch.mjs'

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
  res.end(result.body === null ? undefined : JSON.stringify(result.body))
}

/* Static responses: hashed build chunks are immutable, the HTML shell always
 * revalidates, and compressible payloads are encoded per request (brotli
 * preferred, gzip fallback) with a small cache keyed by file stat so repeated
 * requests reuse the encoded copy. The Worker serves dist through Cloudflare's
 * asset layer instead, which caches and compresses on its own. */
const encodedAssets = new Map()
const compressible = (type) => /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/.test(type)

function sendStatic(req, res, reqPath, target, data, info) {
  const type = mime[extname(target)] || 'application/octet-stream'
  const headers = {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'cache-control': target.endsWith('index.html') ? 'no-cache'
      : reqPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
  }
  let body = data
  if (compressible(type) && data.length >= 1024) {
    const accept = String(req.headers['accept-encoding'] || '')
    const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : ''
    if (encoding) {
      const key = `${target}:${info.mtimeMs}:${encoding}`
      let buf = encodedAssets.get(key)
      if (!buf) {
        buf = encoding === 'br' ? brotliCompressSync(data) : gzipSync(data)
        encodedAssets.set(key, buf)
        if (encodedAssets.size > 64) encodedAssets.delete(encodedAssets.keys().next().value)
      }
      headers['content-encoding'] = encoding
      headers.vary = 'accept-encoding'
      body = buf
    }
  }
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}

async function sendIndexFallback(req, res) {
  const indexFile = resolve(root, 'index.html')
  const [data, info] = await Promise.all([readFile(indexFile), stat(indexFile)])
  return sendStatic(req, res, '/index.html', indexFile, data, info)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  try {
    // /api/* is handled by the shared core in server/api.mjs — the same module
    // the Cloudflare Worker (worker/index.mjs) runs — so both hosts behave
    // identically. Everything else falls through to static file serving.
    const result = await apiRoute(req, process.env, { fetchFn: pinnedFetch })
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
    if (info.isDirectory()) {
      const indexFile = resolve(file, 'index.html')
      const [data, idxInfo] = await Promise.all([readFile(indexFile), stat(indexFile)])
      return sendStatic(req, res, path, indexFile, data, idxInfo)
    }
    const data = await readFile(file)
    return sendStatic(req, res, path, file, data, info)
  } catch {
    // Missing static files (for example a hashed chunk from a previous build)
    // must 404 instead of answering with the HTML shell — a 200 text/html
    // response for a .js request breaks dynamic imports and confuses caches.
    // Extension-less paths keep the SPA fallback, matching the Worker's
    // `not_found_handling: single-page-application` asset routing.
    if (path !== '/index.html' && extname(path)) return sendResult(res, jsonResult(404, { error: 'Not found' }))
    try {
      return await sendIndexFallback(req, res)
    } catch { return sendResult(res, jsonResult(404, { error: 'Application files not found. Run npm run build first.' })) }
  }
})

server.listen(port, '0.0.0.0', () => console.log(`BYOK Chat listening on :${port}`))
