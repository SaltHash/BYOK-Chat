/* Parse a copied cURL command into the small amount of connection data this
 * app needs. The goal is a forgiving importer for docs and "copy as cURL"
 * output, not a shell interpreter: the URL, auth method/key, extra headers,
 * JSON body, and model are used, and no header value is ever persisted except
 * the API key and the explicitly kept extra headers. */

import type { EndpointAuth } from './endpointAuth'

export type CurlProvider = {
  name: string
  baseUrl: string
  type: 'openai' | 'anthropic'
  auth: EndpointAuth
  key: string
  model: string
  headers: Record<string, string>
  warnings: string[]
}

export type CurlParseResult =
  | { ok: true; provider: CurlProvider }
  | { ok: false; error: string }

const VALUE_FLAGS = new Set([
  '-h', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode',
  '--json', '-x', '--request', '--url', '-u', '--user', '-a', '--user-agent',
  '-e', '--referer', '-b', '--cookie', '--connect-timeout', '--max-time',
  '-o', '--output', '-f', '--form', '--form-string', '--retry', '--retry-delay',
  '--cacert', '--cert', '--key', '--proxy', '-w', '--write-out',
])

/** Shell-ish tokenizer for the subset cURL commands use. Supports single and
 *  double quotes, backslash escapes, and backslash-newline continuations. */
export function curlTokens(input: string): string[] {
  // Linux/macOS copies use a trailing backslash; PowerShell uses a backtick
  // and Windows cmd uses a caret. Normalize all three before tokenizing.
  const text = String(input ?? '')
    .replace(/\\\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote === "'") {
      if (ch === "'") quote = null
      else cur += ch
      started = true
      continue
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue }
      if (ch === '\\') {
        const next = text[++i] ?? ''
        if (next === '\n') continue
        if (next === '\r' && text[i + 1] === '\n') { i++; continue }
        if (next === '"' || next === '\\' || next === '$' || next === '`') cur += next
        else cur += `\\${next}`
        started = true
        continue
      }
      cur += ch
      started = true
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue }
    if (ch === '\\') {
      const next = text[++i] ?? ''
      if (next === '\n') continue
      if (next === '\r' && text[i + 1] === '\n') { i++; continue }
      cur += next
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started || cur) { out.push(cur); cur = ''; started = false }
      continue
    }
    cur += ch
    started = true
  }
  if (quote) throw Error(`The command has an unclosed ${quote === "'" ? 'single' : 'double'} quote.`)
  if (started || cur) out.push(cur)
  return out
}

const headerMap = (pairs: [string, string][]): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [name, value] of pairs) {
    const key = name.trim().toLowerCase()
    if (!key) continue
    out[key] = value.trim()
  }
  return out
}

const stripBearer = (value: string): string => value.replace(/^bearer\s+/i, '').trim()

const decodeBasic = (value: string): string => {
  try {
    const decoded = atob(value.trim())
    return decoded.includes(':') ? decoded : value.trim()
  } catch { return value.trim() }
}

const AUTH_HEADER_NAMES = new Set(['authorization', 'x-api-key', 'api-key', 'x-goog-api-key'])
const IGNORED_IMPORT_HEADERS = new Set([
  'content-type', 'content-length', 'host', 'connection', 'transfer-encoding', 'upgrade',
  'accept', 'accept-encoding', 'user-agent', 'anthropic-version',
])

const hostLabel = (url: URL): string => {
  const host = url.hostname.replace(/^www\./i, '')
  const known: Record<string, string> = {
    'api.openai.com': 'OpenAI',
    'api.anthropic.com': 'Anthropic',
    'openrouter.ai': 'OpenRouter',
    'api.deepseek.com': 'DeepSeek',
    'api.x.ai': 'xAI',
    'api.mistral.ai': 'Mistral',
    'api.groq.com': 'Groq',
    'api.together.xyz': 'Together',
    'api.fireworks.ai': 'Fireworks',
    'api.cerebras.ai': 'Cerebras',
    'api.perplexity.ai': 'Perplexity',
    'generativelanguage.googleapis.com': 'Google',
  }
  if (known[host]) return known[host]
  const bare = host.replace(/^api\./i, '')
  return bare || host
}

const trimPath = (path: string): string => path.replace(/\/+$/, '')

/** Split a chat URL into a base URL the app can append its own path to. */
export function curlBaseUrl(raw: string): { baseUrl: string; type: 'openai' | 'anthropic'; warning?: string } {
  const url = new URL(raw)
  const path = trimPath(url.pathname)
  const suffixes: [RegExp, 'openai' | 'anthropic', string][] = [
    [/\/chat\/completions$/i, 'openai', ''],
    [/\/messages$/i, 'anthropic', ''],
    [/\/completions$/i, 'openai', 'The legacy /completions path was converted to /chat/completions.'],
    [/\/responses$/i, 'openai', 'The Responses API path was converted to /chat/completions; this provider must accept the OpenAI chat format.'],
    [/\/embeddings$/i, 'openai', 'The embeddings path is not a chat endpoint; check the base URL before sending messages.'],
  ]
  let type: 'openai' | 'anthropic' = 'openai'
  let warning = ''
  let basePath = path
  for (const [suffix, kind, note] of suffixes) {
    if (suffix.test(path)) {
      basePath = path.replace(suffix, '')
      type = kind
      warning = note
      break
    }
  }
  return {
    baseUrl: `${url.origin}${trimPath(basePath)}`,
    type,
    ...(warning ? { warning } : {}),
  }
}

const maskWarnings = (auth: EndpointAuth, key: string, type: 'openai' | 'anthropic', authorization: string): string[] => {
  const warnings: string[] = []
  if (authorization && !/^(bearer|basic)\s+/i.test(authorization)) warnings.push('Only Bearer and Basic authorization are supported; put the raw token in the key field.')
  if (type === 'anthropic' && !key && auth === 'none') warnings.push('Anthropic endpoints usually need an x-api-key header or a bearer token.')
  return warnings
}

/** Parse a copied cURL command. Returns a readable error instead of throwing. */
export function parseCurlCommand(input: string): CurlParseResult {
  let tokens: string[]
  try { tokens = curlTokens(input) } catch (err: unknown) {
    return { ok: false, error: (err as Error)?.message || 'The command could not be read.' }
  }
  if (!tokens.length) return { ok: false, error: 'Paste a cURL command first.' }
  const start = tokens.findIndex((token) => /(^|[/\\])curl(?:\.exe)?$/i.test(token))
  if (start < 0) return { ok: false, error: 'The command must start with curl.' }

  let url = ''
  let user = ''
  const headers: [string, string][] = []
  const bodies: string[] = []
  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i]
    const eq = token.startsWith('--') ? token.indexOf('=') : -1
    const flag = eq > 0 ? token.slice(0, eq).toLowerCase() : token.toLowerCase()
    const inline = eq > 0 ? token.slice(eq + 1) : ''
    if (flag === '--url') {
      url = inline || tokens[++i] || url
      continue
    }
    if (flag === '-u' || flag === '--user') {
      user = inline || tokens[++i] || user
      continue
    }
    if (flag === '-h' || flag === '--header') {
      const value = inline || tokens[++i] || ''
      const colon = value.indexOf(':')
      if (colon > 0) headers.push([value.slice(0, colon), value.slice(colon + 1)])
      continue
    }
    if (flag === '-d' || flag === '--data' || flag === '--data-raw' || flag === '--data-binary' || flag === '--data-urlencode' || flag === '--json') {
      const value = inline || tokens[++i] || ''
      if (value.startsWith('@')) return { ok: false, error: 'Reading a request body from a file is not supported. Paste the JSON body inline instead.' }
      bodies.push(value)
      if (flag === '--json') headers.push(['content-type', 'application/json'])
      continue
    }
    if (flag === '-f' || flag === '--form' || flag === '--form-string') return { ok: false, error: 'Multipart form uploads are not chat requests. Copy the JSON cURL command instead.' }
    if (flag.startsWith('-')) {
      if (VALUE_FLAGS.has(flag) && !inline) i++
      continue
    }
    if (!url) url = token
  }

  if (!url) return { ok: false, error: 'No URL was found in the cURL command.' }
  let parsedUrl: URL
  try { parsedUrl = new URL(url) } catch { return { ok: false, error: `The URL is not valid: ${url}` } }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return { ok: false, error: 'Only http and https endpoints can be imported.' }
  if (parsedUrl.search) parsedUrl.search = ''

  const header = headerMap(headers)
  const base = curlBaseUrl(parsedUrl.toString())
  const authorization = header.authorization || ''
  let auth: EndpointAuth = 'bearer'
  let key = ''
  let unsupportedAuth = ''
  if (/^bearer\s+/i.test(authorization)) {
    auth = 'bearer'
    key = stripBearer(authorization)
  } else if (/^basic\s+/i.test(authorization)) {
    auth = 'basic'
    key = decodeBasic(authorization.replace(/^basic\s+/i, ''))
  } else if (authorization) {
    // Preserve an unusual scheme as-is in the extra headers rather than
    // silently converting it to a Bearer token.
    auth = 'none'
    unsupportedAuth = authorization
  } else if (header['x-api-key']) {
    auth = 'x-api-key'
    key = header['x-api-key']
  } else if (header['api-key']) {
    auth = 'api-key'
    key = header['api-key']
  } else if (header['x-goog-api-key']) {
    auth = 'x-goog-api-key'
    key = header['x-goog-api-key']
  } else if (user) {
    auth = 'basic'
    key = user
  }
  const bodyText = bodies.join('&')
  let body: Record<string, unknown> = {}
  if (bodyText) {
    try {
      const value = JSON.parse(bodyText)
      if (value && typeof value === 'object' && !Array.isArray(value)) body = value as Record<string, unknown>
      else return { ok: false, error: 'The request body must be a JSON object.' }
    } catch {
      return { ok: false, error: 'The request body is not valid JSON.' }
    }
  }
  // x-api-key alone is also used by some OpenAI-compatible servers, so only
  // treat it as an Anthropic signal when the URL or body agrees.
  const type = header['anthropic-version'] || (header['x-api-key'] && (base.type === 'anthropic' || /anthropic/i.test(parsedUrl.hostname)))
    ? 'anthropic'
    : base.type
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  const keptHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(header)) {
    if (AUTH_HEADER_NAMES.has(name) || IGNORED_IMPORT_HEADERS.has(name)) continue
    keptHeaders[name] = value
  }
  if (unsupportedAuth) keptHeaders.Authorization = unsupportedAuth
  const warnings = maskWarnings(auth, key, type, authorization)
  if (unsupportedAuth) warnings.push('The unusual authorization scheme was kept as a custom header; check it before sending.')
  if (base.warning) warnings.push(base.warning)
  if (!key && !unsupportedAuth) warnings.push('No API key was found. You can add one after importing.')
  if (!model) warnings.push('No model id was found in the JSON body. Enter one after importing.')

  return {
    ok: true,
    provider: {
      name: hostLabel(parsedUrl),
      baseUrl: base.baseUrl,
      type,
      auth,
      key,
      model,
      headers: keptHeaders,
      warnings,
    },
  }
}
