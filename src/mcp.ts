/* Model Context Protocol client over Streamable HTTP.
 *
 * The app has no backend bridge for MCP, so servers are reached directly from
 * the browser. That keeps credentials (user-provided headers, usually an
 * Authorization bearer) on the device, exactly like model keys. The tradeoff
 * is CORS: a remote MCP server must allow this origin, which most hosted
 * servers do and some self-hosted ones do not. Tools are listed and called
 * with the normal Streamable HTTP transport (JSON-RPC 2.0 over POST, with
 * JSON or SSE responses). Nothing is stored on a server.
 */

export type McpTool = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpServer = {
  id: string
  name: string
  url: string
  headers: string
  on: boolean
  /** Last successful tools/list result, cached for display and registration. */
  tools?: McpTool[]
  toolsAt?: number
  /** Last connection error, cleared by a successful probe. */
  error?: string
}

export const MCP_PROTOCOL_VERSION = '2025-06-18'
const MAX_TOOLS = 200
const MAX_TOOL_CHARS = 40_000

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Parse a simple `Name: value` header block. Unsafe/transport headers are
 *  dropped so a pasted block can never set Host or Content-Length. */
export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 1) continue
    const key = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (!key || !value || /[^!#$%&'*+.^_`|~0-9A-Za-z-]/.test(key)) continue
    if (/^(host|content-length|content-type|accept|connection|transfer-encoding|upgrade)$/i.test(key)) continue
    out[key] = value.slice(0, 4000)
  }
  return out
}

/** Lowercase, underscore-separated slug usable in a provider tool name. */
export const toolSlug = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x'

/** Provider-facing tool name. OpenAI-compatible APIs allow a-z 0-9 _ - and a
 *  64 character limit, so both parts are slugged and the whole is truncated. */
export const mcpToolName = (server: Pick<McpServer, 'name'>, tool: string): string =>
  `mcp_${toolSlug(server.name)}_${toolSlug(tool)}`.slice(0, 64)

export type McpBinding = { name: string; server: McpServer; tool: McpTool }

/** Deterministic tool registrations for every enabled server with cached
 *  tools. Name collisions (two servers or tools that slug the same) get a
 *  numeric suffix instead of silently overwriting each other. */
export function mcpBindings(servers: McpServer[]): McpBinding[] {
  const used = new Set<string>()
  const out: McpBinding[] = []
  for (const server of servers) {
    if (!server?.on || !isMcpUrl(server.url)) continue
    for (const tool of server.tools ?? []) {
      if (!tool?.name) continue
      let name = mcpToolName(server, tool.name)
      if (used.has(name)) {
        const base = name.slice(0, 60)
        let n = 2
        while (used.has(`${base}_${n}`)) n++
        name = `${base}_${n}`
      }
      used.add(name)
      out.push({ name, server, tool })
    }
  }
  return out
}

export const isMcpUrl = (url: unknown): boolean => /^https?:\/\//i.test(str(url, 4000).trim())

/** Normalize persisted/imported server entries; malformed entries are dropped
 *  rather than breaking the settings tab or the tool registry. */
export function normMcpServers(v: unknown): McpServer[] {
  if (!Array.isArray(v)) return []
  const out: McpServer[] = []
  const ids = new Set<string>()
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = str(r.id, 80) || `mcp-${out.length + 1}`
    if (ids.has(id)) continue
    ids.add(id)
    const url = str(r.url, 2000).trim()
    const tools = Array.isArray(r.tools) ? r.tools.flatMap((t): McpTool[] => {
      if (!t || typeof t !== 'object') return []
      const rt = t as Record<string, unknown>
      const name = str(rt.name, 200).trim()
      if (!name) return []
      const schema = rt.inputSchema && typeof rt.inputSchema === 'object' && !Array.isArray(rt.inputSchema)
        ? rt.inputSchema as Record<string, unknown>
        : undefined
      return [{ name, ...(str(rt.title, 200) ? { title: str(rt.title, 200) } : {}), ...(str(rt.description, 4000) ? { description: str(rt.description, 4000) } : {}), ...(schema ? { inputSchema: schema } : {}) }]
    }).slice(0, MAX_TOOLS) : []
    out.push({
      id,
      name: str(r.name, 80).trim() || 'MCP server',
      url,
      headers: str(r.headers, 8000),
      on: r.on !== false,
      ...(tools.length ? { tools } : {}),
      ...(Number.isFinite(Number(r.toolsAt)) ? { toolsAt: Number(r.toolsAt) } : {}),
    })
  }
  return out
}

/** Pick the JSON-RPC response with a matching id out of one parsed payload. */
function pickMessage(payload: unknown, id: number | string): any {
  if (Array.isArray(payload)) return payload.find((m) => m && (m.id === id || String(m.id) === String(id))) ?? null
  if (payload && typeof payload === 'object' && ((payload as any).id === id || String((payload as any).id) === String(id))) return payload
  return null
}

/** Parse an SSE body and return the JSON-RPC message matching `id`. */
export function parseMcpSse(text: string, id: number | string): any | null {
  for (const event of String(text ?? '').split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
      .trim()
    if (!data) continue
    try {
      const msg = pickMessage(JSON.parse(data), id)
      if (msg) return msg
    } catch { /* another event may still match */ }
  }
  return null
}

/** Flatten an MCP tools/call result into text the model can read. Binary
 *  content is summarized rather than inlined, so a screenshot tool does not
 *  blow up the context window. */
export function formatMcpContent(result: any): string {
  const parts: string[] = []
  const content = Array.isArray(result?.content) ? result.content : []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
    else if (item.type === 'image') parts.push(`[image ${str(item.mimeType) || 'image'} returned by the tool; binary content is not shown in the transcript]`)
    else if (item.type === 'audio') parts.push(`[audio ${str(item.mimeType) || 'audio'} returned by the tool]`)
    else if (item.type === 'resource_link') parts.push(`[resource] ${str(item.name) || 'link'}: ${str(item.uri)}`)
    else if (item.type === 'resource') {
      const r = item.resource ?? {}
      if (typeof r.text === 'string') parts.push(r.text)
      else parts.push(`[resource] ${str(r.uri) || 'embedded resource'}`)
    } else parts.push(JSON.stringify(item).slice(0, 800))
  }
  if (!parts.length && result?.structuredContent && typeof result.structuredContent === 'object') {
    parts.push(JSON.stringify(result.structuredContent, null, 2))
  }
  const text = parts.join('\n\n').trim()
  if (!text) return 'The MCP tool returned no content.'
  return text.length > MAX_TOOL_CHARS ? `${text.slice(0, MAX_TOOL_CHARS)}\n[truncated at ${MAX_TOOL_CHARS.toLocaleString()} characters]` : text
}

type FetchLike = typeof fetch

/** One Streamable HTTP MCP session. A fresh client is created per operation;
 *  the session header is kept only for the lifetime of that operation. */
export class McpClient {
  private nextId = 1
  private sessionId = ''
  private init: Promise<void> | null = null
  private readonly fetchFn: FetchLike
  serverInfo: { name?: string; version?: string } = {}

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    fetchFn: FetchLike = fetch,
    private readonly timeoutMs = 20_000,
  ) {
    // `fetch` is a window method: calling it as `this.fetchFn(...)` rebinds
    // `this` to the client and Chromium throws "Illegal invocation", so wrap
    // it once to keep the call window-bound.
    this.fetchFn = (input, init) => fetchFn(input, init)
  }

  private async post(body: Record<string, unknown>, expectId?: number): Promise<any> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...this.headers,
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      })
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? `timed out after ${Math.round(this.timeoutMs / 1000)}s` : String(e?.message ?? e)
      throw Error(`Could not reach the MCP server (${reason}). Check the URL, the network, and whether the server allows browser requests (CORS).`)
    } finally {
      clearTimeout(timer)
    }
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    if (res.status === 202 || res.status === 204) return null
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      const detail = text.replace(/\s+/g, ' ').slice(0, 300)
      throw Error(`MCP server returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    if (expectId == null) return null
    const type = res.headers.get('content-type') || ''
    let msg: any = null
    if (type.includes('text/event-stream') || /^\s*(event|data):/m.test(text)) msg = parseMcpSse(text, expectId)
    if (!msg) {
      try { msg = pickMessage(JSON.parse(text), expectId) } catch { /* SSE or empty body */ }
    }
    if (!msg) throw Error('The MCP server sent no matching JSON-RPC response.')
    if (msg.error) throw Error(`MCP error${msg.error.code != null ? ` ${msg.error.code}` : ''}: ${str(msg.error.message) || 'request failed'}`)
    return msg.result
  }

  initialize(): Promise<void> {
    if (!this.init) {
      this.init = (async () => {
        const result = await this.post({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'BYOK Chat', version: '1.0.0' },
          },
        }, 1)
        this.serverInfo = { name: str(result?.serverInfo?.name, 120), version: str(result?.serverInfo?.version, 60) }
        // The initialized notification is required by the spec before any
        // other request. Servers answer 202/204; some answer 200 and ignore it.
        await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {})
      })()
    }
    return this.init
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize()
    const out: McpTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20 && out.length < MAX_TOOLS; page++) {
      const id = this.nextId++
      const result = await this.post({
        jsonrpc: '2.0',
        id,
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      }, id)
      for (const t of Array.isArray(result?.tools) ? result.tools : []) {
        if (!t || typeof t.name !== 'string' || !t.name) continue
        const schema = t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema) ? t.inputSchema : undefined
        out.push({
          name: t.name,
          ...(typeof t.title === 'string' && t.title ? { title: t.title.slice(0, 200) } : {}),
          ...(typeof t.description === 'string' && t.description ? { description: t.description.slice(0, 4000) } : {}),
          ...(schema ? { inputSchema: schema } : {}),
        })
        if (out.length >= MAX_TOOLS) break
      }
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined
      if (!cursor) break
    }
    return out
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    await this.initialize()
    const id = this.nextId++
    const result = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    }, id)
    const text = formatMcpContent(result)
    if (result?.isError) throw Error(`MCP tool reported an error: ${text}`)
    return text
  }
}

/** List a server's tools. Used by the Test button in Settings. */
export async function probeMcpServer(url: string, headerBlock: string, fetchFn: FetchLike = fetch) {
  if (!isMcpUrl(url)) throw Error('Enter an http(s) URL for the MCP server.')
  const client = new McpClient(url.trim(), parseHeaders(headerBlock), fetchFn)
  const tools = await client.listTools()
  return { tools, serverInfo: client.serverInfo }
}

/** Call one MCP tool for the chat tool loop. */
export async function callMcpTool(server: McpServer, tool: McpTool, args: Record<string, unknown>): Promise<string> {
  if (!server.on) throw Error(`MCP server “${server.name}” is turned off.`)
  if (!isMcpUrl(server.url)) throw Error(`MCP server “${server.name}” has no valid URL.`)
  const client = new McpClient(server.url.trim(), parseHeaders(server.headers))
  return client.callTool(tool.name, args)
}

/** JSON Schema to send to the model. Unknown shapes degrade to a permissive
 *  object so a malformed server schema never makes the whole tool list invalid. */
export function toolParameters(tool: McpTool): Record<string, unknown> {
  const schema = tool.inputSchema
  if (schema && (schema as { type?: unknown }).type === 'object') return schema
  return { type: 'object', properties: {}, additionalProperties: true }
}
