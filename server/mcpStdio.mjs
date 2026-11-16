/* Local stdio MCP bridge: `/api/mcp/stdio`.
 *
 * MCP servers come in two shapes. Remote ones answer over Streamable HTTP and
 * the browser can call them (through /api/proxy when CORS blocks it). Local
 * ones describe a process (`command`, `args`, `env`) that speaks JSON-RPC over
 * stdin/stdout, which a browser obviously cannot start — so when the app is
 * served by its Node host, this route runs the process and relays messages.
 *
 * Security posture (this route spawns processes, so it must be narrow):
 *  - only reachable from a loopback socket (the machine running the app), so a
 *    browser on another device on the LAN — let alone a deployed Worker — can
 *    never start anything;
 *  - state-changing requests must be same-origin, like every other /api route,
 *    so a web page cannot drive it through the user's browser;
 *  - the command, arguments, environment and working directory are validated
 *    and capped before spawn;
 *  - sessions are capped, killed after 60s idle, and killed on a timeout or
 *    when the client says it is done;
 *  - stdout is framed as newline-delimited JSON (the current spec) or
 *    LSP-style `Content-Length` frames (older servers), with a hard buffer cap.
 *
 * The Cloudflare Worker does not import this module: it has no child_process.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { bumpRateLimit, overRateLimit } from './ratelimit.mjs'
import { clientIp, headerValue, jsonResult, readBodyText, requestHost, sameOrigin } from './http.mjs'

export const MCP_STDIO_PATH = '/api/mcp/stdio'

const BODY_LIMIT = 1_000_000
const MAX_SESSIONS = 8
const IDLE_MS = 60_000
const MAX_TIMEOUT_MS = 120_000
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_BUFFER = 4 * 1024 * 1024
const MAX_STDERR = 4000
const RATE_LIMIT = 120

/** sessionId -> live session. */
const sessions = new Map()
const limit = new Map()

// A host shutdown (Ctrl-C, supervisor restart) must not orphan child servers.
process.once('exit', () => {
  for (const session of sessions.values()) {
    try { session.child.kill('SIGTERM') } catch { /* already gone */ }
  }
})

function isLoopback(address) {
  const value = String(address || '').toLowerCase()
  return value === '::1' || value === '::ffff:127.0.0.1' || value.startsWith('127.')
}

function written(session, message) {
  const child = session.child
  if (!child?.stdin || child.stdin.destroyed) throw Error('The local MCP server has stopped.')
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

/** Resolve with the response matching `message.id`; notifications resolve
 *  immediately with null. Serialised: one in-flight request per session. */
function request(session, message, timeoutMs) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return Promise.reject(Object.assign(Error('The message must be a JSON-RPC object.'), { code: 'bad_message' }))
  }
  if (message.id == null) {
    return new Promise((resolve, reject) => {
      try { written(session, message); resolve(null) } catch (error) { reject(error) }
    })
  }
  if (session.pending) {
    return Promise.reject(Object.assign(Error('The local MCP server still has a request in flight.'), { code: 'busy' }))
  }
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (session.pending && session.pending.id === message.id) session.pending = null
      fn(value)
    }
    const timer = setTimeout(() => {
      finish(reject, Object.assign(
        Error(`The local MCP server did not answer within ${Math.round(timeoutMs / 1000)}s.`),
        { code: 'timeout' },
      ))
      close(session, true)
    }, timeoutMs)
    timer.unref?.()
    session.pending = {
      id: message.id,
      resolve: (response) => finish(resolve, response),
      reject: (error) => finish(reject, error),
    }
    try { written(session, message) } catch (error) { session.pending.reject(error) }
  })
}

function safeParse(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** One parsed message from the server, or a notification it is safe to drop. */
function deliver(session, payload) {
  for (const message of Array.isArray(payload) ? payload : [payload]) {
    if (!message || typeof message !== 'object' || message.id == null) continue
    const pending = session.pending
    if (pending && String(pending.id) === String(message.id)) pending.resolve(message)
  }
}

/** Read as many complete messages as the buffer holds (newline or LSP frame). */
function readMessages(session) {
  for (;;) {
    const buffer = session.buffer
    if (!buffer) return
    if (/^content-length:/i.test(buffer)) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      const altEnd = buffer.indexOf('\n\n')
      const at = headerEnd >= 0 ? headerEnd : altEnd
      if (at < 0) return
      const length = Number((/content-length:\s*(\d+)/i.exec(buffer.slice(0, at)) || [])[1])
      if (!Number.isFinite(length) || length <= 0 || length > MAX_BUFFER) {
        session.buffer = ''
        session.pending?.reject(Object.assign(Error('The local MCP server sent a malformed frame.'), { code: 'bad_frame' }))
        close(session, true)
        return
      }
      const start = at + (headerEnd >= 0 ? 4 : 2)
      if (buffer.length < start + length) return
      const body = buffer.slice(start, start + length)
      session.buffer = buffer.slice(start + length)
      const parsed = safeParse(body)
      if (parsed) deliver(session, parsed)
      continue
    }
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline).replace(/\r$/, '')
    session.buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    const parsed = safeParse(line)
    // Servers that print banners to stdout must not break the protocol stream.
    if (parsed) deliver(session, parsed)
  }
}

function touch(session) {
  session.usedAt = Date.now()
  if (session.idle) clearTimeout(session.idle)
  session.idle = setTimeout(() => {
    if (!session.pending) close(session, true)
  }, IDLE_MS)
  session.idle.unref?.()
}

/** End a session and free its process. `killProcess` terminates a child that
 *  did not exit (timeout, protocol error, client DELETE). */
function close(session, killProcess = false) {
  sessions.delete(session.id)
  if (session.idle) clearTimeout(session.idle)
  session.idle = null
  if (session.pending) {
    session.pending.reject(Object.assign(Error('The local MCP session closed.'), { code: 'session_closed' }))
  }
  try { session.child.stdin?.end() } catch { /* already closed */ }
  if (!killProcess || session.exited) return
  try { session.child.kill('SIGTERM') } catch { /* already gone */ }
  const timer = setTimeout(() => {
    if (!session.exited) {
      try { session.child.kill('SIGKILL') } catch { /* already gone */ }
    }
  }, 2000)
  timer.unref?.()
}

function fail(session, message) {
  if (session.pending) {
    session.pending.reject(Object.assign(Error(message), { code: 'server_failed' }))
  }
}

function spawnSession(server) {
  const child = spawn(server.command, server.args, {
    cwd: server.cwd || undefined,
    env: { ...process.env, ...server.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const session = { id: randomUUID(), child, buffer: '', stderr: '', pending: null, idle: null, exited: false, usedAt: Date.now() }
  // A process that dies immediately can emit EPIPE on stdin; without a listener
  // that event would take the whole API server down.
  child.stdin?.on('error', () => {})
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    session.buffer += chunk
    if (session.buffer.length > MAX_BUFFER) {
      session.buffer = ''
      fail(session, 'The local MCP server sent too much data without a complete message.')
      close(session, true)
      return
    }
    readMessages(session)
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => { session.stderr = (session.stderr + chunk).slice(-MAX_STDERR) })
  child.on('error', (error) => {
    session.exited = true
    fail(session, `Could not start “${server.command}”: ${error?.message || 'spawn failed'}`)
    close(session, false)
  })
  child.on('exit', (code, signal) => {
    session.exited = true
    const tail = session.stderr.trim().slice(0, 500)
    fail(session, `The local MCP server exited (${signal || code})${tail ? `: ${tail}` : ''}`)
    close(session, false)
  })
  touch(session)
  sessions.set(session.id, session)
  return session
}

/** Validate the process description sent by the client. */
export function stdioServerSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Missing the local server description.' }
  const command = typeof value.command === 'string' ? value.command.trim() : ''
  if (!command) return { error: 'A local MCP server needs a command.' }
  if (command.length > 2000 || command.includes('\0')) return { error: 'That command cannot be run.' }
  let args = []
  if (value.args != null) {
    if (!Array.isArray(value.args)) return { error: 'Arguments must be an array of strings.' }
    if (value.args.length > 100) return { error: 'A local MCP server may take at most 100 arguments.' }
    args = value.args.map((arg) => (typeof arg === 'string' ? arg : null))
    if (args.some((arg) => arg == null || arg.length > 2000 || arg.includes('\0'))) return { error: 'Every argument must be a short string.' }
  }
  const env = {}
  if (value.env != null) {
    if (typeof value.env !== 'object' || Array.isArray(value.env)) return { error: 'Environment variables must be an object.' }
    const entries = Object.entries(value.env)
    if (entries.length > 64) return { error: 'A local MCP server may take at most 64 environment variables.' }
    for (const [key, raw] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) return { error: `“${key}” is not a valid environment variable name.` }
      if (typeof raw !== 'string' || raw.length > 4000) return { error: `The environment value for ${key} must be a short string.` }
      env[key] = raw
    }
  }
  const cwd = typeof value.cwd === 'string' ? value.cwd.trim().slice(0, 1000) : ''
  if (cwd.includes('\0')) return { error: 'That working directory cannot be used.' }
  return { server: { command, args, env, ...(cwd ? { cwd } : {}) } }
}

function timeoutOf(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(1000, Math.round(ms)))
}

/**
 * Handles `/api/mcp/stdio`, or returns null for another route. Answers with the
 * same plain descriptor shape as server/api.mjs so server.mjs can reuse its
 * response adapter.
 */
export async function mcpStdioRoute(req, env = {}, opts = {}) {
  let url
  try { url = new URL(req.url || '/', 'http://localhost') } catch { return null }
  if (url.pathname !== MCP_STDIO_PATH) return null

  const peer = opts.peerAddress ?? req?.socket?.remoteAddress
  if (!isLoopback(peer)) {
    return jsonResult(403, {
      error: 'Local MCP servers can only be started from the machine running this server.',
      code: 'not_local',
    })
  }
  if (!sameOrigin(headerValue(req, 'origin'), requestHost(req))) {
    return jsonResult(403, { error: 'Cross-origin request refused', code: 'cross_origin' })
  }

  const ip = clientIp(req, env)
  const now = Date.now()
  if (overRateLimit(limit, ip, now, RATE_LIMIT)) {
    return jsonResult(429, { error: 'Local MCP limit reached. Try again in a minute.', code: 'rate_limited' }, { 'retry-after': '60' })
  }
  bumpRateLimit(limit, ip, now)

  const method = String(req.method || 'GET').toUpperCase()
  if (method === 'DELETE') {
    const id = url.searchParams.get('session') || ''
    if (!id) return jsonResult(400, { error: 'Missing the session id.', code: 'bad_session' })
    const session = sessions.get(id)
    if (session) close(session, true)
    return { status: 204, headers: { 'cache-control': 'no-store' }, body: null }
  }
  if (method !== 'POST') {
    return jsonResult(405, { error: 'Method not allowed', code: 'method_not_allowed' }, { allow: 'POST, DELETE' })
  }

  const raw = await readBodyText(req, BODY_LIMIT)
  if (raw === null) return jsonResult(413, { error: 'Request is too large', code: 'too_large' })
  let body
  try { body = JSON.parse(raw) } catch { return jsonResult(400, { error: 'Expected a JSON body.', code: 'bad_body' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResult(400, { error: 'Expected a JSON object.', code: 'bad_body' })
  }

  let session
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (sessionId) {
    session = sessions.get(sessionId)
    if (!session) {
      return jsonResult(404, { error: 'That local MCP session has ended. Reconnect the server.', code: 'no_session' })
    }
  } else {
    const spec = stdioServerSpec(body.server)
    if (spec.error) return jsonResult(400, { error: spec.error, code: 'bad_server' })
    if (sessions.size >= MAX_SESSIONS) {
      return jsonResult(429, { error: `At most ${MAX_SESSIONS} local MCP servers can run at once. Remove one, or wait for an idle one to stop.`, code: 'too_many_sessions' })
    }
    try {
      session = spawnSession(spec.server)
    } catch (error) {
      return jsonResult(502, { error: `Could not start the local MCP server: ${error?.message || 'spawn failed'}`, code: 'spawn_failed' })
    }
  }

  touch(session)
  try {
    const reply = await request(session, body.message, timeoutOf(body.timeoutMs))
    touch(session)
    return jsonResult(200, { sessionId: session.id, message: reply })
  } catch (error) {
    const code = error?.code || 'bridge_failed'
    return jsonResult(code === 'timeout' ? 504 : 502, {
      error: String(error?.message || 'The local MCP server failed.'),
      code,
    })
  }
}
