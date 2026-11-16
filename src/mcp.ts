/* Model Context Protocol client over Streamable HTTP and local stdio.
 *
 * Remote servers are normally reached directly from the browser, which keeps
 * credentials (user-provided headers, usually an Authorization bearer) on the
 * device, exactly like model keys. When a server blocks browser origins the
 * call is retried through this app's same-origin relay (see net.ts); the
 * headers are forwarded per request and never stored.
 *
 * Local servers describe a process (`command`, `args`, `env`) instead of a URL.
 * A browser cannot start one, so the Node host runs it behind the loopback-only
 * `/api/mcp/stdio` bridge (see server/mcpStdio.mjs). Both transports speak the
 * same JSON-RPC 2.0 conversation to the model, so tool bindings, approvals and
 * formatting are shared.
 *
 * Configurations are imported from the JSON shapes other clients use (Claude
 * Desktop, Claude Code, Cursor, VS Code, Zed, or a plain list of servers); see
 * parseMcpConfig.
 */

import { providerFetch } from './net'

export type McpTool = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpTransport = 'http' | 'stdio'

export type McpServer = {
  id: string
  name: string
  /** `stdio` runs a local process through the Node bridge; default is HTTP. */
  transport?: McpTransport
  url: string
  /** `Name: value` lines, one per line. */
  headers: string
  /** Local (stdio) process settings. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  on: boolean
  /** Last successful tools/list result, cached for display and registration. */
  tools?: McpTool[]
  toolsAt?: number
  /** Last connection error, cleared by a successful probe. */
  error?: string
}

export const MCP_PROTOCOL_VERSION = '2025-06-18'
/** Loopback-only bridge the Node host exposes for local command servers. */
export const MCP_STDIO_PATH = '/api/mcp/stdio'
const MAX_TOOLS = 200
const MAX_TOOL_CHARS = 40_000
const MAX_ARGS = 100
const MAX_ENV_KEYS = 64

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Header names the transport owns. A pasted block can never override them. */
const RESERVED_HEADERS = /^(host|content-length|content-type|accept|connection|transfer-encoding|upgrade|mcp-session-id|mcp-protocol-version)$/i

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
    if (RESERVED_HEADERS.test(key)) continue
    out[key] = value.slice(0, 4000)
  }
  return out
}

/** `KEY=value` lines for the stdio environment editor. */
export function envBlockOf(env: unknown): string {
  const map = envMap(env)
  return Object.entries(map).map(([key, value]) => `${key}=${value}`).join('\n')
}

/** Parse `KEY=value` lines (blank lines and `#` comments ignored). */
export function parseEnvBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const i = text.indexOf('=')
    if (i < 1) continue
    const key = text.slice(0, i).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) continue
    out[key] = text.slice(i + 1).trim().slice(0, 4000)
    if (Object.keys(out).length >= MAX_ENV_KEYS) break
  }
  return out
}

function envMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ENV_KEYS) break
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) continue
    if (typeof raw === 'string') out[key] = raw.slice(0, 4000)
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = String(raw)
  }
  return out
}

function argList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (out.length >= MAX_ARGS) break
    if (typeof item === 'string') out.push(item.slice(0, 2000))
    else if (typeof item === 'number' && Number.isFinite(item)) out.push(String(item))
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

export const isMcpUrl = (url: unknown): boolean => /^https?:\/\//i.test(str(url, 4000).trim())

/** A server entry starts a local process rather than answering over HTTP. */
export const isStdioMcp = (server: Pick<McpServer, 'transport' | 'url' | 'command'>): boolean =>
  server.transport === 'stdio' || (!isMcpUrl(server.url) && !!str(server.command, 2000).trim())

/** Whether the entry has what its transport needs to connect. */
export const isMcpReady = (server: Pick<McpServer, 'transport' | 'url' | 'command'>): boolean =>
  isStdioMcp(server) ? !!str(server.command, 2000).trim() : isMcpUrl(server.url)

export type McpBinding = { name: string; server: McpServer; tool: McpTool }

/** Deterministic tool registrations for every enabled, connectable server with
 *  cached tools. Name collisions (two servers or tools that slug the same) get
 *  a numeric suffix instead of silently overwriting each other. */
export function mcpBindings(servers: McpServer[]): McpBinding[] {
  const used = new Set<string>()
  const out: McpBinding[] = []
  for (const server of servers) {
    if (!server?.on || !isMcpReady(server)) continue
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

/** Normalize persisted/imported server entries; malformed entries are dropped
 *  rather than breaking the settings tab or the tool registry. */
export function normMcpServers(v: unknown): McpServer[] {
  if (!Array.isArray(v)) return []
  const out: McpServer[] = []
  const ids = new Set<string>()
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = str(r.id, 80) || nextMcpId(ids)
    if (ids.has(id)) continue
    ids.add(id)
    const url = str(r.url, 2000).trim()
    const command = str(r.command, 2000).trim()
    const args = argList(r.args)
    const env = envMap(r.env)
    const cwd = str(r.cwd, 1000).trim()
    const transport: McpTransport = r.transport === 'stdio' || r.transport === 'http'
      ? r.transport
      : command && !url ? 'stdio' : 'http'
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
      transport,
      url,
      headers: str(r.headers, 8000),
      ...(command ? { command } : {}),
      ...(args.length ? { args } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(cwd ? { cwd } : {}),
      on: r.on !== false,
      ...(tools.length ? { tools } : {}),
      ...(Number.isFinite(Number(r.toolsAt)) ? { toolsAt: Number(r.toolsAt) } : {}),
    })
  }
  return out
}

/** Fresh id that does not collide with ids already in this batch. */
function nextMcpId(taken: Set<string>): string {
  for (;;) {
    const id = `mcp-${Math.random().toString(36).slice(2, 10)}`
    if (!taken.has(id)) return id
  }
}

/* ---- importing other clients' configuration files ---------------------- */

export type McpImportSkip = { name: string; reason: string }
export type McpImportResult = {
  /** Entries ready to append to `mcps`; already normalized with fresh ids. */
  servers: McpServer[]
  skipped: McpImportSkip[]
  /** Non-fatal remarks: placeholders, legacy transports, disabled entries. */
  notes: string[]
}

type McpDraft = {
  name: string
  transport: McpTransport
  url: string
  headers: Record<string, string>
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  on: boolean
}

/** Import one JSON document. Accepts the wrapper keys used by Claude Desktop,
 *  Claude Code, Cursor, Windsurf and Cline (`mcpServers`), VS Code (`servers`
 *  or `mcp.servers`), Zed (`context_servers`), a bare array of server objects,
 *  or a single server object. Entries already present (same URL, or same local
 *  command) are reported as skipped instead of duplicated.
 *
 *  Throws only for input that is not JSON at all; per-entry problems are
 *  reported in `skipped` so one bad entry never loses the rest. */
export function parseMcpConfig(text: string, existing: McpServer[] = []): McpImportResult {
  const raw = String(text ?? '').replace(/^\uFEFF/, '').trim()
  if (!raw) throw Error('Paste an MCP configuration, or choose a JSON file, first.')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch {
    throw Error('That is not valid JSON. Copy the whole file, including the outer braces.')
  }
  // A config pasted with its JSON string escaping still parses once more.
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { /* keep the string */ }
  }

  const entries: { name: string; entry: unknown }[] = []
  collectEntries(parsed, entries)

  const skipped: McpImportSkip[] = []
  const notes: string[] = []
  const drafts: McpDraft[] = []
  for (const { name, entry } of entries) {
    const draft = draftOf(name, entry, skipped, notes)
    if (draft) drafts.push(draft)
  }

  const seen = new Set(existing.map(identityOf))
  const servers: McpServer[] = []
  const ids = new Set(existing.map((m) => m.id))
  for (const draft of drafts) {
    const key = identityOf(draft)
    if (seen.has(key)) {
      skipped.push({ name: draft.name, reason: 'already in the list' })
      continue
    }
    seen.add(key)
    const id = nextMcpId(ids)
    ids.add(id)
    const [server] = normMcpServers([{ ...draft, id, headers: headerBlockOf(draft.headers) }])
    if (server) servers.push(server)
  }
  if (!servers.length && !skipped.length) skipped.push({ name: 'This JSON', reason: 'contains no MCP servers' })
  return { servers, skipped, notes: [...new Set(notes)] }
}

/** Stable identity for duplicate detection. */
function identityOf(server: Pick<McpServer, 'transport' | 'url' | 'command' | 'args'>): string {
  if (isStdioMcp(server)) {
    const command = str(server.command, 2000).trim()
    const args = Array.isArray(server.args) ? server.args.join(' ') : ''
    return `stdio:${command} ${args}`.trim()
  }
  return `http:${str(server.url, 2000).trim().toLowerCase().replace(/\/+$/, '')}`
}

function headerBlockOf(headers: Record<string, string>): string {
  return Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')
}

/** Wrap keys other clients use, and collect `{ name, entry }` pairs. */
function collectEntries(node: unknown, out: { name: string; entry: unknown }[], depth = 0): void {
  if (depth > 3 || node == null) return
  if (typeof node === 'string') {
    const url = node.trim()
    if (isMcpUrl(url)) out.push({ name: hostOf(url) || 'MCP server', entry: { url } })
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === 'string') {
        const url = item.trim()
        if (isMcpUrl(url)) out.push({ name: hostOf(url) || 'MCP server', entry: { url } })
        continue
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const obj = item as Record<string, unknown>
      if (hasWrapper(obj)) collectEntries(obj, out, depth + 1)
      else if (isServerEntry(obj)) out.push({ name: entryName(obj), entry: obj })
    }
    return
  }
  if (typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  let wrapped = false
  for (const key of ['mcpServers', 'mcp_servers', 'servers', 'context_servers']) {
    const value = obj[key]
    if (value == null || typeof value !== 'object') continue
    wrapped = true
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entry = item as Record<string, unknown>
          out.push({ name: entryName(entry), entry })
        }
      }
    } else {
      for (const [name, entry] of Object.entries(value as Record<string, unknown>)) out.push({ name, entry })
    }
  }
  if (wrapped) return
  // VS Code keeps MCP settings under `"mcp": { "servers": { … } }`.
  if (obj.mcp && typeof obj.mcp === 'object' && !Array.isArray(obj.mcp)) {
    collectEntries(obj.mcp, out, depth + 1)
    return
  }
  if (isServerEntry(obj)) {
    out.push({ name: entryName(obj), entry: obj })
    return
  }
  // A bare map of `{ "Name": { …server… } }` with no wrapper key.
  const values = Object.values(obj)
  if (values.length && values.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    for (const [name, entry] of Object.entries(obj)) out.push({ name, entry })
  }
}

function hasWrapper(obj: Record<string, unknown>): boolean {
  return ['mcpServers', 'mcp_servers', 'servers', 'context_servers'].some((key) => obj[key] != null && typeof obj[key] === 'object')
    || (!!obj.mcp && typeof obj.mcp === 'object')
}

function isServerEntry(obj: Record<string, unknown>): boolean {
  return ['url', 'serverUrl', 'httpUrl', 'command'].some((key) => typeof obj[key] === 'string' || Array.isArray(obj[key]))
    || (!!obj.command && typeof obj.command === 'object')
}

function entryName(obj: Record<string, unknown>): string {
  return str(obj.name, 80).trim() || str(obj.title, 80).trim() || str(obj.serverName, 80).trim()
}

function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

/** Turn one config entry into a draft, or record why it cannot be used. */
function draftOf(
  name: string,
  raw: unknown,
  skipped: McpImportSkip[],
  notes: string[],
): McpDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    skipped.push({ name: name || 'Entry', reason: 'not a server object' })
    return null
  }
  const o = raw as Record<string, unknown>
  const label = name.trim() || entryName(o) || 'MCP server'
  const typeRaw = str(o.type ?? o.transport, 40).trim().toLowerCase()
  const urlRaw = str(o.url, 2000).trim()
    || str(o.serverUrl, 2000).trim()
    || str(o.httpUrl, 2000).trim()
    || str(o.endpoint, 2000).trim()

  let headers = headerMap(o.headers)
  let args = argList(o.args)
  let env = envMap(o.env)
  let cwd = str(o.cwd, 1000).trim() || str(o.workingDirectory, 1000).trim()
  let command = typeof o.command === 'string' ? o.command.trim() : ''

  // Zed nests the process under `command: { path, args, env }`.
  if (o.command && typeof o.command === 'object' && !Array.isArray(o.command)) {
    const c = o.command as Record<string, unknown>
    command = str(c.path, 2000).trim() || str(c.command, 2000).trim() || str(c.commandLine, 2000).trim()
    if (!args.length) args = argList(c.args)
    if (!Object.keys(env).length) env = envMap(c.env)
    if (!Object.keys(headers).length) headers = headerMap(c.headers)
    if (!cwd) cwd = str(c.cwd, 1000).trim()
  }
  // A few clients put the whole command line in one array.
  if (!command && Array.isArray(o.command)) {
    const parts = argList(o.command)
    command = parts[0] ?? ''
    if (!args.length) args = parts.slice(1)
  }

  const wantsStdio = typeRaw === 'stdio' || typeRaw === 'local'
  const transport: McpTransport = wantsStdio || (!urlRaw && !!command) ? 'stdio' : 'http'

  if (transport === 'stdio') {
    if (!command) {
      skipped.push({ name: label, reason: 'a local server needs a "command"' })
      return null
    }
  } else {
    if (!urlRaw) {
      skipped.push({ name: label, reason: 'needs a "url" or a "command"' })
      return null
    }
    if (!isMcpUrl(urlRaw)) {
      skipped.push({ name: label, reason: 'the URL is not http(s)' })
      return null
    }
    if (typeRaw === 'sse') {
      notes.push(`“${label}” declares the legacy SSE transport. It is imported as Streamable HTTP, which most SSE servers also offer; a server that only speaks legacy SSE must be reached through a bridge URL.`)
    }
  }

  const placeholder = [urlRaw, command, ...args, ...Object.values(headers), ...Object.values(env)].some((v) => /\$\{[^}]*\}/.test(v))
  if (placeholder) notes.push(`“${label}” contains \${…} placeholders; fill them in after import.`)

  const on = o.disabled !== true && o.enabled !== false && o.on !== false
  if (!on) notes.push(`“${label}” was disabled in the config, so it is imported switched off.`)

  const fallback = transport === 'stdio'
    ? command.split(/[\\/]/).pop() ?? ''
    : hostOf(urlRaw)
  return {
    name: (label || fallback || 'MCP server').slice(0, 80),
    transport,
    url: transport === 'http' ? urlRaw : '',
    headers,
    command: transport === 'stdio' ? command : '',
    args,
    env,
    cwd,
    on,
  }
}

function headerMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const pair = item as Record<string, unknown>
      const key = str(pair.name, 200).trim()
      const val = str(pair.value, 4000).trim()
      if (key && val && !RESERVED_HEADERS.test(key)) out[key] = val
    }
    return out
  }
  if (!value || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (RESERVED_HEADERS.test(key)) continue
    if (typeof raw === 'string' && raw.trim()) out[key] = raw.trim().slice(0, 4000)
  }
  return out
}

/* ---- JSON-RPC session -------------------------------------------------- */

/** Pick the JSON-RPC response with a matching id out of one parsed payload. */
function pickMessage(payload: any, id: number | string): any {
  if (Array.isArray(payload)) return payload.find((m) => m && (m.id === id || String(m.id) === String(id))) ?? null
  if (payload && typeof payload === 'object' && (payload.id === id || String(payload.id) === String(id))) return payload
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

/** JSON Schema to send to the model. Unknown shapes degrade to a permissive
 *  object so a malformed server schema never makes the whole tool list invalid,
 *  and a schema that lists `properties` without `"type": "object"` (common from
 *  hand-written servers) is repaired instead of losing its parameters. */
export function toolParameters(tool: McpTool): Record<string, unknown> {
  const schema = tool.inputSchema
  if (schema && typeof schema === 'object') {
    const type = (schema as { type?: unknown }).type
    if (type === 'object') return schema
    if (type == null && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
      return { ...schema, type: 'object' }
    }
  }
  return { type: 'object', properties: {}, additionalProperties: true }
}

type FetchLike = typeof fetch

/** Provider-style transport: direct when the server allows this origin, via
 *  this app's relay when the browser blocks it. */
const mcpFetch: FetchLike = providerFetch

function resultOf(msg: any): any {
  if (!msg) throw Error('The MCP server sent no matching JSON-RPC response.')
  if (msg.error) throw Error(`MCP error${msg.error.code != null ? ` ${msg.error.code}` : ''}: ${str(msg.error.message) || 'request failed'}`)
  return msg.result
}

/** Shared JSON-RPC conversation (initialize, tools/list, tools/call) over a
 *  transport supplied by the subclass. One session is used per operation. */
export abstract class McpSession {
  protected nextId = 1
  private init: Promise<void> | null = null
  serverInfo: { name?: string; version?: string } = {}

  /** Send one JSON-RPC message; resolve to the response message with the same
   *  id, or null for a notification (which has no response). */
  protected abstract send(body: Record<string, unknown>, expectId?: number): Promise<any>

  initialize(): Promise<void> {
    if (!this.init) {
      this.init = (async () => {
        const id = this.nextId++
        const result = resultOf(await this.send({
          jsonrpc: '2.0',
          id,
          method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'BYOK Chat', version: '1.0.0' },
          },
        }, id))
        this.serverInfo = { name: str(result?.serverInfo?.name, 120), version: str(result?.serverInfo?.version, 60) }
        // The initialized notification is required by the spec before any
        // other request. Servers answer 202/204; some answer 200 and ignore it.
        await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {})
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
      const result = resultOf(await this.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      }, id))
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
    const result = resultOf(await this.send({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    }, id))
    const text = formatMcpContent(result)
    if (result?.isError) throw Error(`MCP tool reported an error: ${text}`)
    return text
  }

  /** Release the underlying session (process or HTTP session). Safe to call
   *  more than once and never throws. */
  async close(): Promise<void> {}
}

/** One Streamable HTTP MCP session. A fresh client is created per operation;
 *  the session header is kept only for the lifetime of that operation. */
export class McpClient extends McpSession {
  private sessionId = ''
  private protocolReady = false
  private readonly fetchFn: FetchLike

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    fetchFn: FetchLike = mcpFetch,
    private readonly timeoutMs = 20_000,
  ) {
    super()
    // `fetch` is a window method: calling it as `this.fetchFn(...)` rebinds
    // `this` to the client and Chromium throws "Illegal invocation", so wrap
    // it once to keep the call window-bound.
    this.fetchFn = (input, init) => fetchFn(input, init)
  }

  protected async send(body: Record<string, unknown>, expectId?: number): Promise<any> {
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
          ...(this.protocolReady || this.sessionId ? { 'mcp-protocol-version': MCP_PROTOCOL_VERSION } : {}),
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
    if (res.ok && body.method === 'initialize') this.protocolReady = true
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
    return msg
  }

  /** End the HTTP session so the server can free it. Best effort: servers that
   *  do not implement DELETE answer 405 and are ignored. */
  override async close(): Promise<void> {
    const sessionId = this.sessionId
    this.sessionId = ''
    if (!sessionId) return
    try {
      await this.fetchFn(this.url, {
        method: 'DELETE',
        headers: { ...this.headers, 'mcp-session-id': sessionId, 'mcp-protocol-version': MCP_PROTOCOL_VERSION },
      })
    } catch { /* the session expires on its own */ }
  }
}

/** JSON-RPC over the Node host's loopback stdio bridge. Each session starts one
 *  local process; `close` ends it. */
export class McpStdioClient extends McpSession {
  private sessionId = ''
  private readonly fetchFn: FetchLike

  constructor(
    private readonly server: { command: string; args: string[]; env: Record<string, string>; cwd?: string },
    private readonly timeoutMs = 30_000,
    fetchFn: FetchLike = mcpFetch,
  ) {
    super()
    this.fetchFn = (input, init) => fetchFn(input, init)
  }

  protected async send(body: Record<string, unknown>, expectId?: number): Promise<any> {
    let res: Response
    try {
      res = await this.fetchFn(MCP_STDIO_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(this.sessionId ? { sessionId: this.sessionId } : { server: this.server }),
          message: body,
          timeoutMs: this.timeoutMs,
        }),
      })
    } catch (e: any) {
      throw Error(`Could not reach the local MCP bridge (${String(e?.message ?? e)}). Local command servers need the app's Node host: run npm start or npm run dev and open the app from localhost.`)
    }
    const type = (res.headers.get('content-type') || '').toLowerCase()
    if (res.status === 404 || type.includes('text/html')) {
      throw Error('Local (stdio) MCP servers can only run on the app’s Node host. This deployment has no stdio bridge — run npm start or npm run dev and open the app from localhost.')
    }
    const text = await res.text().catch(() => '')
    let data: any = null
    try { data = JSON.parse(text) } catch { /* handled below */ }
    if (!res.ok) {
      const detail = str(data?.error, 500) || text.replace(/\s+/g, ' ').slice(0, 300)
      throw Error(`The local MCP bridge returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    if (!data || typeof data !== 'object') throw Error('The local MCP bridge sent an unreadable response.')
    if (typeof data.sessionId === 'string' && data.sessionId) this.sessionId = data.sessionId
    if (expectId == null) return null
    return data.message ?? null
  }

  override async close(): Promise<void> {
    const sessionId = this.sessionId
    this.sessionId = ''
    if (!sessionId) return
    try {
      await this.fetchFn(`${MCP_STDIO_PATH}?session=${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
    } catch { /* the bridge kills idle sessions on its own */ }
  }
}

/** Connection details accepted by `probeMcpServer`/`callMcpTool`. */
export type McpConnection = Pick<McpServer, 'url' | 'headers'> & Partial<Pick<McpServer, 'transport' | 'command' | 'args' | 'env' | 'cwd'>>

/** Open a session for a stored server, with the right transport. */
export function mcpSessionFor(server: McpConnection, fetchFn: FetchLike = mcpFetch, timeoutMs = 20_000): McpSession {
  if (isStdioMcp(server)) {
    const command = str(server.command, 2000).trim()
    if (!command) throw Error('Enter the command for this local MCP server.')
    return new McpStdioClient({
      command,
      args: argList(server.args),
      env: envMap(server.env),
      ...(str(server.cwd, 1000).trim() ? { cwd: str(server.cwd, 1000).trim() } : {}),
    }, Math.max(timeoutMs, 30_000), fetchFn)
  }
  if (!isMcpUrl(server.url)) throw Error('Enter an http(s) URL for the MCP server.')
  return new McpClient(server.url.trim(), parseHeaders(server.headers), fetchFn, timeoutMs)
}

/** List a server's tools. Used by the Test button in Settings. */
export async function probeMcpServer(server: McpConnection, fetchFn: FetchLike = mcpFetch) {
  const session = mcpSessionFor(server, fetchFn)
  try {
    const tools = await session.listTools()
    return { tools, serverInfo: session.serverInfo }
  } finally {
    await session.close()
  }
}

/** Call one MCP tool for the chat tool loop. */
export async function callMcpTool(
  server: Pick<McpServer, 'name' | 'on'> & McpConnection,
  tool: McpTool,
  args: Record<string, unknown>,
  fetchFn: FetchLike = mcpFetch,
): Promise<string> {
  if (!server.on) throw Error(`MCP server “${server.name}” is turned off.`)
  if (!isMcpReady(server)) throw Error(`MCP server “${server.name}” has no valid ${isStdioMcp(server) ? 'command' : 'URL'}.`)
  const session = mcpSessionFor(server, fetchFn)
  try {
    return await session.callTool(tool.name, args)
  } finally {
    await session.close()
  }
}
