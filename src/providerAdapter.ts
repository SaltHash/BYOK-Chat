/* Generic OpenAI-compatible adapter used by every inference-router entry in
 * providerRegistry.ts. There is deliberately no per-provider request code:
 * URLs, auth, discovery quirks, redirects, and capability filters all come
 * from configuration. */

import { withCode, type CodedError, type ErrorCode } from './errors'
import { providerFetch } from './net'
import {
  hasUnresolvedPlaceholder,
  providerBaseUrl,
  providerChatUrl,
  providerHeaders,
  providerModelsUrl,
  providerSingleModelUrl,
  resolveProvider,
  type ProviderConfig,
  type ProviderEndpoint,
} from './providerRegistry'

export { PROVIDERS, PROVIDER_IDS, getProvider, resolveProvider, providerPresetEntries, providerBaseUrl, providerChatUrl, providerHeaders, providerModelsUrl, providerSingleModelUrl, extractAccountId, hasUnresolvedPlaceholder } from './providerRegistry'
export type { ProviderConfig, ProviderCors, ProviderEndpoint, ProviderDiscovery } from './providerRegistry'

/* ------------------------------------------------------------------------ *
 * SSE parsing
 * ------------------------------------------------------------------------ */

export type SseEvent = { data: string }
export type SseParseResult = { done: boolean; data?: string; malformed?: boolean }

/** Incremental SSE line parser. Chunks may split anywhere, including in the
 *  middle of `data:` or `[DONE]`; line endings may be LF or CRLF. Comments
 *  and non-data fields are ignored. */
export function createSseParser() {
  let buffer = ''
  const events: SseEvent[] = []
  const consume = (line: string) => {
    const l = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!l.startsWith('data:')) return // blank lines, comments, event:, id:, retry:
    events.push({ data: l.slice(5).replace(/^ /, '') })
  }
  const drain = (final = false) => {
    const parts = buffer.split('\n')
    buffer = final ? '' : parts.pop() ?? ''
    for (const part of parts) consume(part)
    if (final && buffer) consume(buffer)
  }
  return {
    push(chunk: string): SseEvent[] {
      if (!chunk) return []
      buffer += chunk
      drain(false)
      return events.splice(0)
    },
    end(): SseEvent[] {
      drain(true)
      return events.splice(0)
    },
  }
}

/** Parse one `data:` payload. `[DONE]` is a sentinel, malformed JSON is
 *  reported so callers can skip it without ending the stream. */
export function parseSseData(data: string): SseParseResult {
  const value = String(data ?? '').trim()
  if (!value) return { done: false }
  if (value === '[DONE]') return { done: true }
  try {
    JSON.parse(value)
    return { done: false, data: value }
  } catch {
    return { done: false, malformed: true }
  }
}

type ChatUsage = { input: number; output: number; total: number; cacheRead: number; cacheWrite: number; cost?: number }
export type StreamedChat = {
  text: string
  usage: ChatUsage
  finish?: string | null
  done: boolean
  truncated: boolean
  malformed: number
  fallback?: boolean
}

const jsonHeaders = { 'content-type': 'application/json' }

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>
        if (typeof p.text === 'string') return p.text
        if (typeof p.content === 'string') return p.content
      }
      return ''
    }).join('')
  }
  return ''
}

const usageNumbers = (value: unknown): ChatUsage => {
  const u = value && typeof value === 'object' ? value as Record<string, any> : {}
  const n = (...values: unknown[]) => {
    for (const v of values) {
      const x = Number(v)
      if (Number.isFinite(x) && x >= 0) return x
    }
    return 0
  }
  return {
    input: n(u.prompt_tokens, u.input_tokens),
    output: n(u.completion_tokens, u.output_tokens),
    total: n(u.total_tokens),
    cacheRead: n(u.prompt_tokens_details?.cached_tokens, u.cache_read_input_tokens, u.cached_tokens),
    cacheWrite: n(u.cache_creation_input_tokens, u.prompt_tokens_details?.cache_creation),
    ...(n(u.cost, u.total_cost) > 0 ? { cost: n(u.cost, u.total_cost) } : {}),
  }
}

const errorMessageFromBody = (body: string): string => {
  const text = String(body ?? '')
  try {
    const j = JSON.parse(text) as Record<string, any>
    const candidate = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 300)
    if (candidate && typeof candidate === 'object') {
      const nested = candidate.message ?? candidate.detail
      if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 300)
    }
  } catch { /* plain-text provider error */ }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

const redact = (text: string, key?: string): string => {
  let out = String(text ?? '')
  if (key) out = out.split(key).join('•••')
  return out.replace(/\b(sk|gsk|pk|xai|AIza)[-\w]{12,}/g, '•••')
}

function retryAfterMs(headers?: HeadersInit): number | undefined {
  if (!headers) return undefined
  let h: Headers
  try { h = new Headers(headers) } catch { return undefined }
  const raw = h.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

export type MappedProviderError = {
  code: ErrorCode
  message: string
  retryable: boolean
  status?: number
  retryAfterMs?: number
}

export type MapErrorOptions = {
  hasKey?: boolean
  headers?: HeadersInit
  key?: string
}

/** Turn a provider HTTP failure into a readable, provider-named message and a
 *  stable error code. No key ever appears in the result. */
export function mapProviderError(provider: ProviderConfig, status: number, body = '', opts: MapErrorOptions = {}): MappedProviderError {
  const name = provider.name
  const detail = redact(errorMessageFromBody(body), opts.key)
  const suffix = detail && !/^https?:\/\//i.test(detail) ? ` ${detail}` : ''
  const retry = retryAfterMs(opts.headers)
  const retryText = retry == null ? '' : ` Try again in about ${Math.max(1, Math.ceil(retry / 1000))} seconds.`
  if (status === 401 || status === 403) {
    const cause = opts.hasKey === false ? 'no API key is configured' : 'the API key was rejected or lacks permission'
    return {
      code: 'upstream_auth',
      status,
      retryable: false,
      message: `${name}: ${cause} (HTTP ${status}).${provider.authHint ? ` ${provider.authHint}` : ''}${suffix}`,
    }
  }
  if (status === 402) {
    return { code: 'billing', status, retryable: false, message: `${name}: the account cannot be billed for this request (HTTP 402). Check credits and plan.${suffix}` }
  }
  if (status === 429) {
    return {
      code: 'rate_limited',
      status,
      retryable: false,
      ...(retry != null ? { retryAfterMs: retry } : {}),
      message: `${name}: rate limit or quota reached (HTTP 429).${retryText || ' Wait a moment before trying again.'}${suffix}`,
    }
  }
  if (status === 307 || status === 308) {
    return {
      code: 'bad_response',
      status,
      retryable: false,
      message: `${name}: the provider returned a redirect (HTTP ${status}) that was not followed. Check the base URL.${suffix}`,
    }
  }
  if (status === 404) {
    return { code: 'not_found', status, retryable: false, message: `${name}: the endpoint or model was not found (HTTP 404). Check the base URL and model id.${suffix}` }
  }
  if (status === 400 || status === 422) {
    return {
      code: 'bad_request',
      status,
      retryable: false,
      message: `${name}: the request was rejected by the provider (HTTP ${status}). This is a provider-side request error; check the selected model and connection settings.${suffix}`,
    }
  }
  if (status >= 500) {
    return { code: 'upstream_unavailable', status, retryable: true, message: `${name}: the provider is temporarily unavailable (HTTP ${status}). Try again shortly.${suffix}` }
  }
  return { code: 'bad_response', status, retryable: false, message: `${name}: unexpected response (HTTP ${status}).${suffix}` }
}

export function providerError(provider: ProviderConfig, status: number, body = '', opts: MapErrorOptions = {}): CodedError {
  const mapped = mapProviderError(provider, status, body, opts)
  return withCode(mapped.message, mapped.code, { retryable: mapped.retryable, status })
}

export function mapNetworkError(provider: ProviderConfig, url: string): MappedProviderError {
  let host = url
  try { host = new URL(url).host || url } catch { /* keep raw */ }
  const cors = provider.cors === 'blocked'
    ? ' This provider does not send browser CORS headers, so its requests have to travel through this app\'s same-origin proxy (Settings → Endpoints → Request routing).'
    : provider.cors === 'unverified'
      ? ' Browser CORS for this provider is unverified.'
      : ''
  return {
    code: 'cors',
    retryable: true,
    message: `${provider.name}: network or CORS error contacting ${host}. Check the connection and whether the provider allows browser requests.${cors}`,
  }
}

/* ------------------------------------------------------------------------ *
 * Request construction
 * ------------------------------------------------------------------------ */

export type ChatMessage = { role: string; content: unknown; [key: string]: unknown }
export type ChatRequestOptions = {
  endpoint?: ProviderEndpoint
  model: string
  messages: ChatMessage[]
  stream?: boolean
  maxTokens?: number
  temperature?: number
  topP?: number
  tools?: unknown[]
  extraBody?: Record<string, unknown>
  signal?: AbortSignal
}

export type BuiltChatRequest = {
  url: string
  init: RequestInit
  provider: ProviderConfig
}

/** Build URL, request init, auth headers, and redirect policy for a chat call. */
export function buildChatRequest(provider: ProviderConfig, opts: ChatRequestOptions): BuiltChatRequest {
  const endpoint = opts.endpoint ?? {}
  const base = providerBaseUrl(provider, endpoint)
  if (!base) throw withCode(`${provider.name} needs a base URL.`, 'bad_request')
  if (hasUnresolvedPlaceholder(base)) {
    throw withCode(`${provider.name} needs an Account ID before it can build the request URL.`, 'bad_request')
  }
  const headers: Record<string, string> = { ...jsonHeaders, ...providerHeaders(provider, endpoint) }
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.topP != null ? { top_p: opts.topP } : {}),
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    ...(opts.extraBody ?? {}),
  }
  body.stream = opts.stream !== false
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
    // The Grid answers with a 307 to its routing layer. Browsers follow by
    // default, but being explicit keeps this correct in every transport.
    ...(provider.followRedirects ? { redirect: 'follow' as RequestRedirect } : {}),
  }
  return { url: providerChatUrl(provider, endpoint), init, provider }
}

const assertResponse = async (provider: ProviderConfig, res: Response, key?: string) => {
  if (res.ok) return
  const body = await res.text().catch(() => '')
  throw providerError(provider, res.status, body, { hasKey: !!key, headers: res.headers, key })
}

/** Non-streaming chat completion. */
export async function chatCompletion(provider: ProviderConfig, opts: ChatRequestOptions, fetchFn: typeof fetch = providerFetch): Promise<Record<string, any>> {
  const { url, init } = buildChatRequest(provider, { ...opts, stream: false })
  const res = await fetchFn(url, init)
  await assertResponse(provider, res, opts.endpoint?.key)
  return await res.json() as Record<string, any>
}

const textOfChoice = (choice: any): string => contentText(choice?.delta?.content ?? choice?.message?.content)

/** Read an OpenAI-compatible streamed response. A stream that ends before
 *  `[DONE]` is returned with `truncated: true` and whatever text arrived, so
 *  the caller can finish the message instead of hanging. Malformed events are
 *  skipped and counted. */
export async function readChatStream(
  provider: ProviderConfig,
  res: Response,
  onText: (text: string) => void = () => {},
): Promise<StreamedChat> {
  const usage: ChatUsage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 }
  let text = ''
  let finish: string | null = null
  let done = false
  let malformed = 0
  const add = (t: unknown) => {
    const s = contentText(t)
    if (!s) return
    text += s
    onText(s)
  }
  const accept = (payload: any): boolean => {
    if (payload && typeof payload === 'object') {
      if (payload.error) {
        const msg = errorMessageFromBody(JSON.stringify(payload.error))
        throw withCode(`${provider.name}: ${msg || 'the provider reported an error.'}`, 'bad_response')
      }
      if (payload.usage) Object.assign(usage, usageNumbers(payload.usage))
      const choice = payload.choices?.[0]
      if (choice?.finish_reason) finish = String(choice.finish_reason)
      add(textOfChoice(choice))
    }
    return false
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('json')) {
    const payload = await res.json()
    accept(payload)
    done = true
    return { text, usage, finish, done, truncated: false, malformed }
  }
  if (!res.body) throw withCode(`${provider.name}: the response had no body.`, 'bad_response')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let pending: string | null = null
  const handle = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    if (value === '[DONE]') { done = true; return }
    if (pending == null) {
      let payload: any
      try { payload = JSON.parse(value) } catch {
        // The SSE spec permits one event to span several data: lines, so hold
        // this line and try joining it with the next one before giving up.
        pending = value
        return
      }
      accept(payload)
      return
    }
    const joined = `${pending}\n${value}`
    let joinedPayload: any
    let joinedOk = false
    try { joinedPayload = JSON.parse(joined); joinedOk = true } catch { /* not a continuation */ }
    if (joinedOk) {
      pending = null
      accept(joinedPayload)
      return
    }
    try {
      // The new line stands alone, so the held line was genuinely malformed.
      const payload = JSON.parse(value)
      malformed++
      pending = null
      accept(payload)
    } catch {
      pending = joined
    }
  }
  for (;;) {
    const { done: ended, value } = await reader.read()
    if (ended) break
    for (const event of parser.push(decoder.decode(value, { stream: true }))) handle(event.data)
  }
  for (const event of parser.push(decoder.decode())) handle(event.data)
  for (const event of parser.end()) handle(event.data)
  if (pending != null) {
    let payload: any
    let usable = false
    try { payload = JSON.parse(pending); usable = true } catch { malformed++ }
    // Parse and accept separately so an error event at the end of the stream
    // still surfaces instead of being counted as malformed JSON.
    if (usable) accept(payload)
  }
  // An incomplete final line is normal on truncation; never throw away text.
  return { text, usage, finish, done, truncated: !done, malformed }
}

/** Streamed chat with a one-shot non-streaming fallback when the transport
 *  cannot stream. The fallback is only used before any text has arrived. */
export async function streamChatCompletion(
  provider: ProviderConfig,
  opts: ChatRequestOptions,
  onText: (text: string) => void = () => {},
  fetchFn: typeof fetch = providerFetch,
): Promise<StreamedChat> {
  const { url, init } = buildChatRequest(provider, { ...opts, stream: true })
  let res: Response
  try { res = await fetchFn(url, init) }
  catch (x: any) {
    if (x?.name === 'AbortError') throw withCode('Stopped', 'stopped')
    const mapped = mapNetworkError(provider, url)
    throw withCode(mapped.message, mapped.code, { retryable: mapped.retryable })
  }
  await assertResponse(provider, res, opts.endpoint?.key)
  let produced = ''
  const emit = (text: string) => { produced += text; onText(text) }
  const nonStreamingFallback = async (): Promise<StreamedChat> => {
    const payload = await chatCompletion(provider, opts, fetchFn)
    const choice = payload?.choices?.[0]
    const text = contentText(choice?.message?.content)
    if (text) emit(text)
    return {
      text,
      usage: usageNumbers(payload?.usage),
      finish: choice?.finish_reason ? String(choice.finish_reason) : null,
      done: true,
      truncated: false,
      malformed: 0,
      fallback: true,
    }
  }
  try {
    const result = await readChatStream(provider, res, emit)
    // A stream that ends without any text (truncated transport, or nothing but
    // malformed events) means streaming is unusable here; retry once without it.
    if (!result.text && (result.truncated || result.malformed > 0)) return await nonStreamingFallback()
    return result
  } catch (error) {
    const code = (error as CodedError)?.code
    const fallbackable = !produced && (code === 'bad_response' || code === 'bad_request' || code === 'empty_response')
    if (!fallbackable) throw error
    return await nonStreamingFallback()
  }
}

/* ------------------------------------------------------------------------ *
 * Model discovery
 * ------------------------------------------------------------------------ */

export type ProviderModel = {
  id: string
  name?: string
  context?: number
  type?: string
  inputPrice?: number
  outputPrice?: number
  cacheReadPrice?: number
  providerId?: string
  capabilities?: Record<string, unknown>
}

export type DiscoveryResult = {
  entries: ProviderModel[]
  error?: string
  stale?: boolean
  cached?: boolean
  etag?: string
}

type CacheEntry = { entries: ProviderModel[]; etag?: string; at: number }
const discoveryCache = new Map<string, CacheEntry>()

/** Exposed for tests and for "clear cached model list" UI affordances. */
export function clearProviderDiscoveryCache(id?: string) {
  if (!id) { discoveryCache.clear(); return }
  for (const key of discoveryCache.keys()) if (key.startsWith(`${id}:`)) discoveryCache.delete(key)
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const perMillion = (value: unknown, alreadyPerMillion = false): number | undefined => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return round2(alreadyPerMillion ? n : n * 1e6)
}

const rowsOf = (body: any): Record<string, any>[] => {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.models)) return body.models
  if (Array.isArray(body?.model_catalog)) return body.model_catalog
  return []
}

function normalizeModel(row: Record<string, any>): ProviderModel | null {
  const id = String(row?.id ?? row?.model_id ?? row?.model_name ?? row?.model ?? row?.name ?? '').trim()
  if (!id || /batch/i.test(id)) return null
  const name = String(row?.display_name ?? row?.displayName ?? row?.name ?? row?.info?.name ?? '').trim()
  const context = Number(row?.context_length ?? row?.context_window ?? row?.max_input_tokens ?? row?.max_context_length ?? row?.spec?.contextLength ?? row?.info?.contextLength)
  const pricing = row?.pricing ?? {}
  const input = perMillion(pricing.prompt ?? pricing.input ?? pricing.promptToken ?? row?.input_price ?? row?.prompt_text_token_price ?? row?.info?.inputPrice)
  const output = perMillion(pricing.completion ?? pricing.output ?? pricing.completionToken ?? row?.output_price ?? row?.completion_text_token_price ?? row?.info?.outputPrice)
  const cached = perMillion(pricing.input_cache_read ?? pricing.cached_input ?? row?.cached_price ?? row?.cached_prompt_text_token_price)
  const capabilities = row?.capabilities && typeof row.capabilities === 'object'
    ? row.capabilities as Record<string, unknown>
    : row?.info?.capabilities && typeof row.info.capabilities === 'object'
      ? row.info.capabilities as Record<string, unknown>
      : undefined
  const type = String(row?.type ?? row?.info?.type ?? '').trim().toLowerCase()
  return {
    id,
    ...(name ? { name } : {}),
    ...(context > 0 ? { context } : {}),
    ...(type ? { type } : {}),
    ...(input !== undefined ? { inputPrice: input } : {}),
    ...(output !== undefined ? { outputPrice: output } : {}),
    ...(cached !== undefined ? { cacheReadPrice: cached } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(typeof (row?.owned_by ?? row?.provider) === 'string' ? { providerId: String(row.owned_by ?? row.provider) } : {}),
  }
}

/** Capability and type fields are only used to exclude models that explicitly
 *  say they are not chat models. A missing field is not treated as a failure. */
export function filterChatModels(provider: ProviderConfig, rows: ProviderModel[]): ProviderModel[] {
  const required = provider.discovery?.requireCapabilities ?? []
  const types = provider.discovery?.chatTypes ?? []
  return rows.filter((row) => {
    if (required.length && row.capabilities) {
      for (const capability of required) if (row.capabilities[capability] === false) return false
    }
    if (types.length && row.type && !types.includes(row.type)) return false
    return true
  })
}

const cacheKey = (provider: ProviderConfig, endpoint: ProviderEndpoint): string =>
  `${provider.id}:${providerBaseUrl(provider, endpoint) || provider.baseURL}`

/** Discover the models available to this key. On failure, returns the last
 *  known list for this provider marked `stale`, so one failing provider never
 *  blanks the picker. */
export async function discoverProviderModels(
  provider: ProviderConfig,
  endpoint: ProviderEndpoint = {},
  fetchFn: typeof fetch = providerFetch,
): Promise<DiscoveryResult> {
  if (!provider.discovery) {
    return { entries: [], error: `${provider.name}: model discovery is not available for this provider. Enter a model id manually.` }
  }
  const key = cacheKey(provider, endpoint)
  const cached = discoveryCache.get(key)
  const base = providerBaseUrl(provider, endpoint)
  if (hasUnresolvedPlaceholder(base)) return { entries: cached?.entries ?? [], ...(cached ? { stale: true } : {}), error: `${provider.name} needs an Account ID before models can be listed.` }
  const url = providerModelsUrl(provider, endpoint)
  if (!url) return { entries: [], error: `${provider.name}: model discovery is not available.` }
  const secret = String(endpoint.key ?? '').trim()
  const auth = provider.discovery.authPrefix && secret
    ? { [provider.authHeader]: `${provider.discovery.authPrefix}${secret}` }
    : providerHeaders(provider, endpoint)
  const headers: Record<string, string> = { accept: 'application/json', ...auth }
  if (provider.discovery.etag && cached?.etag) headers['if-none-match'] = cached.etag
  try {
    const res = await fetchFn(url, { headers, ...(provider.followRedirects ? { redirect: 'follow' as RequestRedirect } : {}) })
    if (res.status === 304 && cached) {
      return { entries: cached.entries, cached: true, etag: cached.etag }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const mapped = mapProviderError(provider, res.status, body, { hasKey: !!endpoint.key, headers: res.headers, key: endpoint.key })
      return { entries: cached?.entries ?? [], ...(cached ? { stale: true } : {}), error: mapped.message }
    }
    const body = await res.json()
    let entries = rowsOf(body).map(normalizeModel).filter((x): x is ProviderModel => !!x)
    entries = filterChatModels(provider, entries)
    if (provider.discovery.providerPrefix) {
      entries = entries.map((row) => row.providerId && !row.id.startsWith(`${row.providerId}/`)
        ? { ...row, id: `${row.providerId}/${row.id}` }
        : row)
    }
    const seen = new Set<string>()
    entries = entries.filter((row) => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })
    for (const id of provider.discovery.extraModels ?? []) {
      if (!entries.some((x) => x.id === id)) entries.unshift({ id, name: id })
    }
    if (!entries.length) {
      return { entries: cached?.entries ?? [], ...(cached ? { stale: true } : {}), error: `${provider.name}: the model list was empty.` }
    }
    const etag = res.headers.get('etag') ?? undefined
    discoveryCache.set(key, { entries, ...(etag ? { etag } : {}), at: Date.now() })
    return { entries, ...(etag ? { etag } : {}) }
  } catch (x: any) {
    const mapped = x?.code
      ? { message: String(x.message), code: x.code }
      : mapNetworkError(provider, url)
    return { entries: cached?.entries ?? [], ...(cached ? { stale: true } : {}), error: mapped.message }
  }
}

/* ------------------------------------------------------------------------ *
 * Browser CORS check
 * ------------------------------------------------------------------------ */

export type CorsProbe = {
  ok: boolean
  status: number
  allowOrigin: string
  allowHeaders: string
  error?: string
}

/** On-demand preflight against the provider's chat endpoint. The registry has
 *  a static confidence value, but the browser can be behind a different
 *  origin, so this measures the real answer instead of assuming. */
export async function probeProviderCors(
  provider: ProviderConfig,
  endpoint: ProviderEndpoint = {},
  opts: { origin?: string; fetchFn?: typeof fetch } = {},
): Promise<CorsProbe> {
  const fetchFn = opts.fetchFn ?? fetch
  const url = providerChatUrl(provider, endpoint)
  const origin = opts.origin ?? (typeof location !== 'undefined' ? location.origin : 'https://localhost')
  const requested = ['content-type']
  if (provider.authRequired) requested.unshift(provider.authHeader)
  if (provider.gatewayHeader && String(endpoint[provider.gatewayHeader.field] ?? '').trim()) requested.push(provider.gatewayHeader.header)
  const requestHeaders = [...new Set(requested.map((h) => h.toLowerCase()))].join(',')
  try {
    const res = await fetchFn(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': requestHeaders,
      },
    })
    const allowOrigin = res.headers.get('access-control-allow-origin') ?? ''
    const allowHeaders = res.headers.get('access-control-allow-headers') ?? ''
    // A browser only resolves this fetch when the provider's CORS check passed.
    // `Access-Control-Allow-*` is not readable from page JS, so the headers are
    // best-effort detail (they are visible in Node, which the smoke test uses).
    const ok = res.ok
    return {
      ok,
      status: res.status,
      allowOrigin,
      allowHeaders,
      ...(ok ? {} : { error: `${provider.name} rejected the browser preflight (HTTP ${res.status}).` }),
    }
  } catch (x: any) {
    return {
      ok: false,
      status: 0,
      allowOrigin: '',
      allowHeaders: '',
      error: `${provider.name}: preflight failed (${String(x?.message ?? x)}). The provider may not allow browser requests from this origin.`,
    }
  }
}

/** Resolve a provider from an endpoint-like object and build the chat request,
 *  so callers never have to duplicate the registry lookup. */
export function chatRequestForEndpoint(endpoint: ProviderEndpoint & { model: string; preset?: string; providerId?: string }, opts: Omit<ChatRequestOptions, 'endpoint' | 'model' | 'messages'> & { messages: ChatMessage[] }): BuiltChatRequest | null {
  const provider = resolveProvider({ id: endpoint.providerId, preset: endpoint.preset, url: endpoint.url })
  if (!provider) return null
  return buildChatRequest(provider, { ...opts, endpoint, model: endpoint.model })
}
