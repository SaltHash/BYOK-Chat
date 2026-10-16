import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { apiRoute } from './server/api.mjs'
import { jsonResult } from './server/http.mjs'

const port = Number(process.env.PORT || 8787)
const root = resolve(process.env.STATIC_DIR || 'dist')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

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
    try {
      const data = await readFile(resolve(root, 'index.html'))
      res.writeHead(200, { 'content-type': mime['.html'], 'x-content-type-options': 'nosniff' })
      return res.end(req.method === 'HEAD' ? undefined : data)
    } catch { return sendResult(res, jsonResult(404, { error: 'Application files not found. Run npm run build first.' })) }
  }
})

server.listen(port, '0.0.0.0', () => console.log(`BYOK Chat listening on :${port}`))
