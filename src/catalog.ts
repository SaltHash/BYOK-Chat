/* Pure model-catalog helpers (no React). Fetch orchestration stays thin in Settings. */
import { stripVendorPrefix } from './models'
import { discoverProviderModels, resolveProvider } from './providerAdapter'
import { endpointAuthHeaders, endpointHeaders, type EndpointAuth } from './endpointAuth'
import { providerFetch } from './net'

export type CatalogEntry = {
  id: string
  efforts: string[]
  source: 'auto' | 'manual'
  providerId: string
  name: string
  context?: number
  inputPrice?: number
  outputPrice?: number
  /** USD per 1M cached input tokens, when the provider publishes it. */
  cacheReadPrice?: number
}

/** Where a catalog response came from. `openrouter` and `litellm` are
 *  aggregated catalogs that still need endpoint-brand filtering; `provider`,
 *  `base`, and (for branded endpoints) `openrouter` are already scoped. */
export type CatalogSource = 'provider' | 'openrouter' | 'litellm' | 'base'

export type CatalogEndpoint = { id?: string; url?: string; key?: string; type?: 'openai' | 'anthropic'; auth?: EndpointAuth; headers?: string; preset?: string; name?: string; endpointId?: string; endpointFilter?: string; accountId?: string; gatewayId?: string }

/** Unit used by a provider's pricing fields, normalized to USD per 1M tokens. */
type PriceUnit = 'perToken' | 'perMillion' | 'centsPer100M' | 'none'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const toPerMillion = (value: unknown, unit: PriceUnit): number | undefined => {
  if (unit === 'none') return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  const perMillion = unit === 'perMillion' ? n : unit === 'centsPer100M' ? n / 1e4 : n * 1e6
  return round2(perMillion)
}

export type CatalogParseOptions = {
  endpointId?: string
  endpointName?: string
  /** Defaults to per-token pricing (the OpenRouter/LiteLLM shape). */
  priceUnit?: PriceUnit
}

/** Normalize OpenRouter / LiteLLM / OpenAI-style / Together / xAI payloads into
 *  CatalogEntries. Provider-specific fields (context length, pricing, reasoning
 *  efforts) are read when present and ignored otherwise. */
export function parseCatalogModels(body: unknown, opts: CatalogParseOptions = {}): CatalogEntry[] {
  const b = body as { data?: unknown; models?: unknown; model_catalog?: unknown }
  const rows = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : Array.isArray(b?.model_catalog) ? b.model_catalog : Array.isArray(body) ? body : []
  const endpointId = opts.endpointId ?? ''
  const endpointName = opts.endpointName ?? ''
  const priceUnit = opts.priceUnit ?? 'perToken'
  return (rows as Record<string, unknown>[]).map((x) => {
    const r = x as Record<string, unknown> & {
      supported_parameters?: unknown; reasoning?: { supported_efforts?: unknown }
      supported_efforts?: unknown; supported_reasoning_efforts?: unknown
      supports_reasoning?: unknown; supports_reasoning_effort?: unknown
      capabilities?: { reasoning_effort?: unknown }
      id?: unknown; model_id?: unknown; model_name?: unknown
      name?: unknown; display_name?: unknown; displayName?: unknown
      provider?: unknown; litellm_provider?: unknown; provider_name?: unknown; organization?: unknown; owned_by?: unknown
      context_length?: unknown; context_window?: unknown; max_input_tokens?: unknown; max_context_length?: unknown
      pricing?: {
        prompt?: unknown; completion?: unknown; input?: unknown; output?: unknown
        input_cache_read?: unknown; input_cache_write?: unknown; cached_input?: unknown
      }
      prompt_text_token_price?: unknown; completion_text_token_price?: unknown; cached_prompt_text_token_price?: unknown
      input_cost_per_token?: unknown; output_cost_per_token?: unknown
    }
    const params = Array.isArray(r.supported_parameters) ? r.supported_parameters : []
    const supportedEfforts = r.reasoning?.supported_efforts ?? r.supported_efforts ?? r.supported_reasoning_efforts ?? r.capabilities?.reasoning_effort
    const efforts = Array.isArray(supportedEfforts) ? supportedEfforts.map(String) : []
    const claimsReasoning = (params as unknown[]).includes('reasoning') || (params as unknown[]).includes('reasoning_effort') || r.supports_reasoning || r.supports_reasoning_effort
    const effortKnown = efforts.length > 0 || (!claimsReasoning && (Array.isArray(r.supported_parameters) || r.supports_reasoning === false))
    const id = String(r.id ?? r.model_id ?? r.model_name ?? '')
    const name = String(r.name ?? r.display_name ?? r.displayName ?? '')
    const providerId = String(r.provider ?? r.litellm_provider ?? r.provider_name ?? r.organization ?? r.owned_by ?? '')
    const modelLabel = stripVendorPrefix(name, [providerId, endpointId, endpointName, id.split('/')[0]])
    const context = Number(r.context_length ?? r.context_window ?? r.max_input_tokens ?? r.max_context_length)
    const inputPrice = toPerMillion(r.pricing?.prompt ?? r.pricing?.input ?? r.prompt_text_token_price ?? r.input_cost_per_token, priceUnit)
    const outputPrice = toPerMillion(r.pricing?.completion ?? r.pricing?.output ?? r.completion_text_token_price ?? r.output_cost_per_token, priceUnit)
    const cacheReadPrice = toPerMillion(r.pricing?.input_cache_read ?? r.pricing?.cached_input ?? r.cached_prompt_text_token_price, priceUnit)
    return {
      id, efforts, source: effortKnown ? 'auto' as const : 'manual' as const, providerId, name: modelLabel,
      ...(context > 0 ? { context } : {}),
      ...(inputPrice !== undefined ? { inputPrice } : {}),
      ...(outputPrice !== undefined ? { outputPrice } : {}),
      ...(cacheReadPrice !== undefined ? { cacheReadPrice } : {}),
    }
  }).filter((x) => x.id && !/batch/i.test(x.id) && !/batch/i.test(x.name))
}

/** Limit catalog to one endpoint brand / provider. */
export function filterCatalogByEndpoint(entries: CatalogEntry[], endpointId: string, endpointFilter: string): CatalogEntry[] {
  if (!endpointId) return entries
  const id = endpointId.toLowerCase()
  if (endpointFilter === 'provider') {
    // A provider-scoped catalog (`?providers=` on OpenRouter, or a local
    // /models list) returns rows without a `providerId`: the response is
    // already filtered, so keep it as-is instead of returning nothing.
    if (entries.length && entries.every((x) => !x.providerId)) return entries
    return entries.filter((x) => x.providerId.toLowerCase() === id || (!x.id.includes('/') && x.id.toLowerCase().startsWith(`${id}-`)))
  }
  return entries.filter((x) => x.id.toLowerCase().startsWith(`${id}/`))
}

/** Pin provider rows to the top for OpenRouter (same heuristic as before). */
export function prioritizeProviderRows(entries: CatalogEntry[], endpointId: string, endpointFilter: string): CatalogEntry[] {
  if (!endpointId) return entries
  const rows = filterCatalogByEndpoint(entries, endpointId, endpointFilter)
  const topCount = Math.min(rows.length, 10, Math.max(3, Math.floor(rows.length * 0.2)))
  const top = rows.slice(0, topCount)
  return [...top, ...entries.filter((x) => !top.includes(x))]
}

/** One inference provider (endpoint) serving a model: `tag` is the exact
 *  OpenRouter provider slug sent in `provider.order`, `name` is its label. */
export type CatalogProvider = {
  tag: string
  name: string
  context?: number
  inputPrice?: number
  outputPrice?: number
  cacheReadPrice?: number
  throughput?: number
  quantization?: string
}

/** Normalize an OpenRouter `/models/{id}/endpoints` payload into providers.
 *  The `tag` is the routing slug (e.g. `amazon-bedrock`, `google-vertex/us-east5`). */
export function parseModelProviders(body: unknown): CatalogProvider[] {
  const rows = (body as { data?: { endpoints?: unknown } })?.data?.endpoints
  if (!Array.isArray(rows)) return []
  return (rows as Record<string, any>[]).map((r) => {
    const tag = String(r?.tag ?? '').trim()
    const name = String(r?.provider_name ?? r?.name ?? tag).replace(/\s*\|\s*.*$/, '').trim()
    const context = Number(r?.context_length)
    const inputPrice = Number(r?.pricing?.prompt)
    const outputPrice = Number(r?.pricing?.completion)
    const cacheReadPrice = Number(r?.pricing?.input_cache_read)
    const throughput = Number(r?.throughput_last_30m)
    const quantization = typeof r?.quantization === 'string' ? r.quantization : ''
    return {
      tag, name,
      ...(context > 0 ? { context } : {}),
      ...(Number.isFinite(inputPrice) && inputPrice > 0 ? { inputPrice: round2(inputPrice * 1e6) } : {}),
      ...(Number.isFinite(outputPrice) && outputPrice > 0 ? { outputPrice: round2(outputPrice * 1e6) } : {}),
      ...(Number.isFinite(cacheReadPrice) && cacheReadPrice > 0 ? { cacheReadPrice: round2(cacheReadPrice * 1e6) } : {}),
      ...(Number.isFinite(throughput) && throughput > 0 ? { throughput } : {}),
      ...(quantization ? { quantization } : {}),
    }
  }).filter((p) => p.tag)
}

/** Strip routing variant suffixes (`:free`, `:nitro`, …) OpenRouter adds to ids. */
const baseModelId = (id: string) => id.replace(/^~+/, '').replace(/:(free|nitro|floor|beta|extended|thinking)$/i, '').trim()

/** List the providers currently serving `model`, using OpenRouter's public
 *  endpoints API. Only meaningful for OpenRouter endpoints; other bases get a
 *  clear message instead of a silent empty list. */
export async function fetchModelProviders(
  model: string,
  e: CatalogEndpoint,
  fetchFn: typeof fetch = providerFetch,
): Promise<{ providers: CatalogProvider[]; error?: string }> {
  const base = String(e.url || '').trim().replace(/\/+$/, '')
  if (!/openrouter\.ai/i.test(base)) return { providers: [], error: 'Provider selection needs an OpenRouter endpoint.' }
  const id = baseModelId(model)
  if (!id) return { providers: [], error: 'Enter a model ID first.' }
  const headers = endpointHeaders(e, e.key ? { authorization: `Bearer ${e.key}` } : {})
  try {
    const r = await fetchFn(`https://openrouter.ai/api/v1/models/${id}/endpoints`, { headers })
    if (!r.ok) throw Error(`OpenRouter provider lookup HTTP ${r.status}`)
    return { providers: parseModelProviders(await r.json()) }
  } catch (err: unknown) {
    return { providers: [], error: (err as Error)?.message || 'Provider lookup failed.' }
  }
}

/* ------------------------------------------------------------------------ *
 * Generic model-list discovery
 *
 * Custom OpenAI-compatible servers do not advertise where their catalog lives.
 * Probe the handful of common locations once, remember which URL worked, and
 * remember permanent failures so later catalog loads skip them instead of
 * repeating the same dead requests. The cache is local to this browser and
 * keyed by base URL + a non-reversible fingerprint of the API key.
 * ------------------------------------------------------------------------ */

export type DiscoveryCandidate = { url: string; auth: 'bearer' | 'anthropic' }
export type DiscoveryAttempt = { url: string; ok: boolean; status: number; at: number; error?: string; skipped?: boolean }
export type DiscoveryResult = {
  entries: CatalogEntry[]
  workingUrl?: string
  error?: string
  checked: DiscoveryAttempt[]
}

type DiscoveryMemo = {
  base: string
  keyTag: string
  workingUrl?: string
  attempts: Record<string, { ok: boolean; status: number; at: number; error?: string }>
}

const DISCOVERY_STORE = 'byok:model-discovery:v1'
const DISCOVERY_FAILURE_TTL = 30 * 24 * 60 * 60 * 1000
let discoveryMemos: Record<string, DiscoveryMemo> | null = null

const discoveryStore = (): Record<string, DiscoveryMemo> => {
  if (discoveryMemos) return discoveryMemos
  discoveryMemos = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DISCOVERY_STORE) : ''
    if (!raw) return discoveryMemos
    const parsed = JSON.parse(raw) as Record<string, DiscoveryMemo>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) discoveryMemos = parsed
  } catch { /* malformed or unavailable storage starts fresh */ }
  return discoveryMemos
}

const saveDiscoveryStore = (): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DISCOVERY_STORE, JSON.stringify(discoveryStore()))
  } catch { /* quota or privacy mode: the in-memory copy still works */ }
}

/** FNV-1a fingerprint: lets a changed key start a fresh set of probes without
 *  storing the key itself in the discovery cache. */
const keyFingerprint = (key: string): string => {
  let hash = 0x811c9dc5
  const value = String(key ?? '')
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const memoFor = (base: string, key: string): DiscoveryMemo => {
  const store = discoveryStore()
  const memo = store[base] ?? (store[base] = { base, keyTag: '', attempts: {} })
  const tag = keyFingerprint(key)
  if (memo.keyTag !== tag) {
    memo.keyTag = tag
    memo.attempts = {}
  }
  return memo
}

const attemptFresh = (attempt: { ok: boolean; at: number } | undefined): boolean =>
  !!attempt && !attempt.ok && Date.now() - attempt.at < DISCOVERY_FAILURE_TTL

/** Common catalog locations, most likely first. Order is stable so cached
 *  failures and successes survive reloads. */
export function modelDiscoveryCandidates(url: string, type: 'openai' | 'anthropic' = 'openai'): DiscoveryCandidate[] {
  const base = trimBase(url)
  if (!base) return []
  let parsed: URL
  try { parsed = new URL(base) } catch { return [] }
  const origin = parsed.origin
  const path = parsed.pathname.replace(/\/+$/, '')
  const urls: string[] = []
  const add = (value: string) => {
    const clean = value.replace(/\/+$/, '')
    if (clean && !urls.includes(clean)) urls.push(clean)
  }
  add(`${base}/models`)
  if (/\/openai$/i.test(path)) add(`${base.replace(/\/openai$/i, '')}/models`)
  if (!/\/v\d+[a-z]*\d*$/i.test(path)) add(`${base}/v1/models`)
  add(`${origin}/v1/models`)
  add(`${origin}/models`)
  add(`${base}/api/models`)
  add(`${origin}/api/v1/models`)
  add(`${origin}/api/tags`)
  return urls.map((candidate) => ({ url: candidate, auth: type === 'anthropic' ? 'anthropic' : 'bearer' }))
}

const discoveryHeaders = (e: CatalogEndpoint, auth: DiscoveryCandidate['auth']): Record<string, string> => {
  const base: Record<string, string> = {
    accept: 'application/json',
    ...endpointAuthHeaders(e, auth === 'anthropic' ? 'x-api-key' : 'bearer'),
  }
  if (auth === 'anthropic') {
    base['anthropic-version'] = '2023-06-01'
    base['anthropic-dangerous-direct-browser-access'] = 'true'
  }
  return endpointHeaders(e, base)
}

const isPermanentDiscoveryFailure = (status: number): boolean =>
  status === 400 || status === 401 || status === 403 || status === 404 || status === 405 || status === 410 || status === 501

/** Probe this endpoint's likely catalog URLs, skipping failures recorded by an
 *  earlier load. `force` rechecks everything and replaces the memo. */
export async function discoverEndpointModels(
  e: CatalogEndpoint,
  fetchFn: typeof fetch = providerFetch,
  opts: { force?: boolean } = {},
): Promise<DiscoveryResult> {
  const base = trimBase(e.url)
  if (!base) return { entries: [], checked: [], error: 'This endpoint needs a base URL before models can be listed.' }
  const memo = opts.force ? { base, keyTag: keyFingerprint(String(e.key ?? '')), attempts: {} } as DiscoveryMemo : memoFor(base, String(e.key ?? ''))
  const candidates = modelDiscoveryCandidates(base, e.type ?? 'openai')
  if (memo.workingUrl) {
    const index = candidates.findIndex((x) => x.url === memo.workingUrl)
    if (index > 0) candidates.unshift(candidates.splice(index, 1)[0])
    else if (index < 0) candidates.unshift({ url: memo.workingUrl, auth: e.type === 'anthropic' ? 'anthropic' : 'bearer' })
  }
  const checked: DiscoveryAttempt[] = []
  let lastError = ''
  for (const candidate of candidates) {
    const known = memo.attempts[candidate.url]
    if (!opts.force && attemptFresh(known)) {
      checked.push({ url: candidate.url, ok: false, status: known.status, at: known.at, error: known.error, skipped: true })
      continue
    }
    try {
      const res = await fetchFn(candidate.url, { headers: discoveryHeaders(e, candidate.auth) })
      if (!res.ok) {
        const detail = `HTTP ${res.status}`
        const attempt = { url: candidate.url, ok: false, status: res.status, at: Date.now(), error: detail }
        checked.push(attempt)
        lastError = `${candidate.url}: ${detail}`
        // Cache permanent "this is not a model list" answers. Auth and
        // transient failures are retried after the endpoint/key changes or on
        // the next load, so fixing a key never leaves a permanent dead end.
        if (isPermanentDiscoveryFailure(res.status) && res.status !== 401 && res.status !== 403) {
          memo.attempts[candidate.url] = attempt
        }
        continue
      }
      const body = await res.json().catch(() => null)
      const entries = parseCatalogModels(body, { endpointName: e.name, priceUnit: 'none' })
      if (!entries.length) {
        const attempt = { url: candidate.url, ok: false, status: res.status, at: Date.now(), error: 'No models in the response' }
        checked.push(attempt)
        memo.attempts[candidate.url] = attempt
        lastError = `${candidate.url}: no models`
        continue
      }
      const attempt = { url: candidate.url, ok: true, status: res.status, at: Date.now() }
      checked.push(attempt)
      memo.workingUrl = candidate.url
      memo.attempts[candidate.url] = attempt
      discoveryStore()[base] = memo
      saveDiscoveryStore()
      return { entries, workingUrl: candidate.url, checked }
    } catch (err: unknown) {
      const detail = (err as Error)?.message || 'Network error'
      checked.push({ url: candidate.url, ok: false, status: 0, at: Date.now(), error: detail })
      lastError = `${candidate.url}: ${detail}`
      // Network errors are transient; do not poison the cache with them.
    }
  }
  discoveryStore()[base] = memo
  saveDiscoveryStore()
  const skipped = checked.filter((x) => x.skipped).length
  const suffix = skipped ? ` ${skipped} previously failed URL${skipped === 1 ? ' was' : 's were'} skipped.` : ''
  return { entries: [], checked, error: lastError ? `No model list was found. Last error: ${lastError}.${suffix}` : `No model list was found.${suffix}` }
}

/** Forget cached discovery results. Omit the URL to clear every endpoint. */
export function clearModelDiscoveryCache(url?: string): void {
  const store = discoveryStore()
  if (url) delete store[trimBase(url)]
  else discoveryMemos = {}
  saveDiscoveryStore()
}

/* ------------------------------------------------------------------------ *
 * Direct provider catalogs
 *
 * Each supported preset exposes its own model-list endpoint. These adapters
 * fetch that list first so the picker shows the provider's actual, current
 * models (with as much metadata as the provider publishes) instead of always
 * going through OpenRouter. Aggregated public catalogs remain as fallbacks.
 * ------------------------------------------------------------------------ */

type DirectProvider =
  | 'anthropic' | 'google' | 'ollama' | 'openai' | 'deepseek' | 'xai' | 'mistral'
  | 'together' | 'fireworks' | 'cerebras' | 'groq' | 'openrouter' | 'generic'

type DirectResult = { entries: CatalogEntry[]; error?: string }

const PROVIDER_LABEL: Record<DirectProvider, string> = {
  anthropic: 'Anthropic', google: 'Google', ollama: 'Ollama', openai: 'OpenAI', deepseek: 'DeepSeek',
  xai: 'xAI', mistral: 'Mistral', together: 'Together', fireworks: 'Fireworks', cerebras: 'Cerebras',
  groq: 'Groq', openrouter: 'OpenRouter', generic: 'Provider',
}

/** Presets with a native model-list endpoint. Perplexity has none, so it is
 *  deliberately absent and falls back to the public catalogs. */
const PRESET_PROVIDER: Record<string, DirectProvider | null> = {
  Anthropic: 'anthropic',
  Google: 'google',
  DeepSeek: 'deepseek',
  xAI: 'xai',
  Mistral: 'mistral',
  Together: 'together',
  Fireworks: 'fireworks',
  Cerebras: 'cerebras',
  Perplexity: null,
  Groq: 'groq',
  'Ollama (local)': 'ollama',
  OpenAI: 'openai',
  OpenRouter: 'openrouter',
  'Other OpenAI-compatible': 'generic',
}

const trimBase = (url?: string) => String(url ?? '').trim().replace(/\/+$/, '')

/** Infer the direct adapter from the saved preset, then from the base URL for
 *  legacy endpoints that predate presets. */
export function catalogProviderOf(e: CatalogEndpoint): DirectProvider | null {
  const preset = e.preset?.trim() ?? ''
  if (preset && Object.hasOwn(PRESET_PROVIDER, preset)) return PRESET_PROVIDER[preset]
  const base = trimBase(e.url)
  if (!base) return preset ? 'generic' : null
  let host = ''
  let port = ''
  try { const u = new URL(base); host = u.hostname.toLowerCase(); port = u.port } catch { return 'generic' }
  if (host === 'openrouter.ai') return 'openrouter'
  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return 'anthropic'
  if (host === 'generativelanguage.googleapis.com') return 'google'
  if (host === 'api.openai.com') return 'openai'
  if (host === 'api.deepseek.com' || host.endsWith('.deepseek.com')) return 'deepseek'
  if (host === 'api.x.ai' || host.endsWith('.x.ai')) return 'xai'
  if (host === 'api.mistral.ai' || host.endsWith('.mistral.ai')) return 'mistral'
  if (host === 'api.together.xyz' || host === 'api.together.ai' || host.endsWith('.together.ai')) return 'together'
  if (host === 'api.fireworks.ai' || host.endsWith('.fireworks.ai')) return 'fireworks'
  if (host === 'api.cerebras.ai' || host.endsWith('.cerebras.ai')) return 'cerebras'
  if (host === 'api.groq.com' || host.endsWith('.groq.com')) return 'groq'
  if ((host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') && (port === '11434' || base.includes(':11434'))) return 'ollama'
  if (host === 'api.perplexity.ai' || host.endsWith('.perplexity.ai')) return null
  return 'generic'
}

const bearerHeaders = (e: CatalogEndpoint): Record<string, string> =>
  endpointHeaders(e, e.key ? { authorization: `Bearer ${e.key}` } : {})

async function fetchOpenAiStyle(provider: DirectProvider, e: CatalogEndpoint, fetchFn: typeof fetch): Promise<DirectResult> {
  const base = trimBase(e.url)
  if (!base) return { entries: [], error: `${PROVIDER_LABEL[provider]} needs a base URL.` }
  let url = `${base}/models`
  if (provider === 'openrouter') {
    const endpointId = e.endpointId ?? ''
    const endpointFilter = e.endpointFilter ?? 'author'
    const q = endpointId ? `?${endpointFilter === 'provider' ? 'providers' : 'model_authors'}=${encodeURIComponent(endpointId)}` : ''
    url += q
  }
  // Only OpenRouter and Together/xAI publish pricing in their list endpoint;
  // every other direct list is id-only, so do not invent prices for them.
  const priceUnit: PriceUnit = provider === 'openrouter' ? 'perToken' : provider === 'together' ? 'perMillion' : provider === 'xai' ? 'centsPer100M' : 'none'
  const r = await fetchFn(url, { headers: bearerHeaders(e) })
  if (!r.ok) throw Error(`${PROVIDER_LABEL[provider]} model list HTTP ${r.status}`)
  return { entries: parseCatalogModels(await r.json(), { endpointId: e.endpointId, endpointName: e.name, priceUnit }) }
}

/** Anthropic lists models with x-api-key auth, a required version header, and
 *  cursor pagination (20 items by default). */
async function fetchAnthropicModels(e: CatalogEndpoint, fetchFn: typeof fetch): Promise<DirectResult> {
  const base = trimBase(e.url)
  if (!base) return { entries: [], error: 'Anthropic needs a base URL.' }
  const headers: Record<string, string> = {
    ...endpointAuthHeaders(e, 'x-api-key'),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  const requestHeaders = endpointHeaders(e, headers)
  const entries: CatalogEntry[] = []
  let after = ''
  for (let page = 0; page < 20; page++) {
    const url = `${base}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`
    const r = await fetchFn(url, { headers: requestHeaders })
    if (!r.ok) throw Error(`Anthropic model list HTTP ${r.status}`)
    const body = await r.json() as { data?: unknown; has_more?: boolean; last_id?: string }
    entries.push(...parseCatalogModels(body, { endpointId: e.endpointId, endpointName: e.name, priceUnit: 'none' }))
    const last = typeof body?.last_id === 'string' ? body.last_id : ''
    if (!body?.has_more || !last) break
    after = last
  }
  return { entries }
}

/** Native Gemini list endpoint. Richer than the OpenAI-compatible route: it
 *  includes display names, input token limits, and generation methods. */
const googleModelsUrl = (url?: string) => {
  const base = trimBase(url)
  const root = base.replace(/\/openai$/i, '')
  return /\/v\d+(?:beta|alpha)?\d*$/i.test(root) ? `${root}/models` : `${root}/v1beta/models`
}

function parseGoogleModels(body: unknown, opts: CatalogParseOptions = {}): CatalogEntry[] {
  const rows = (body as { models?: unknown })?.models
  if (!Array.isArray(rows)) return []
  return (rows as Record<string, unknown>[]).flatMap((r) => {
    const methods = Array.isArray(r.supportedGenerationMethods) ? r.supportedGenerationMethods.map(String) : []
    // The picker adds chat models; skip embedding-only rows when the API says
    // which methods a model supports.
    if (methods.length && !methods.includes('generateContent')) return []
    const rawId = String(r.name ?? r.id ?? '')
    const id = rawId.replace(/^models\//, '').trim()
    if (!id) return []
    const context = Number(r.inputTokenLimit)
    return [{
      id, efforts: [], source: 'manual' as const, providerId: 'google',
      name: String(r.displayName ?? ''),
      ...(context > 0 ? { context } : {}),
    }]
  }).filter((x) => !/batch/i.test(x.id) && !/batch/i.test(x.name))
}

async function fetchGoogleModels(e: CatalogEndpoint, fetchFn: typeof fetch): Promise<DirectResult> {
  const root = googleModelsUrl(e.url)
  if (!root) return { entries: [], error: 'Google needs a base URL.' }
  const headers = endpointHeaders(e, e.key ? { 'x-goog-api-key': e.key } : {})
  const entries: CatalogEntry[] = []
  let token = ''
  for (let page = 0; page < 20; page++) {
    const url = `${root}?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`
    const r = await fetchFn(url, { headers })
    if (!r.ok) throw Error(`Google model list HTTP ${r.status}`)
    const body = await r.json() as { nextPageToken?: string }
    entries.push(...parseGoogleModels(body, { endpointId: e.endpointId, endpointName: e.name }))
    token = typeof body?.nextPageToken === 'string' ? body.nextPageToken : ''
    if (!token) break
  }
  return { entries }
}

/** Ollama's OpenAI-compatible `/v1/models` omits context length, so use the
 *  native tags list and hydrate each entry with `/api/show`. */
const ollamaRoot = (url?: string) => trimBase(url).replace(/\/v1$/i, '')

function parseOllamaTags(body: unknown): CatalogEntry[] {
  const rows = (body as { models?: unknown })?.models
  if (!Array.isArray(rows)) return []
  return (rows as Record<string, unknown>[]).flatMap((r) => {
    const id = String(r.model ?? r.name ?? '').trim()
    if (!id) return []
    return [{ id, efforts: [], source: 'manual' as const, providerId: 'ollama', name: id }]
  })
}

async function hydrateOllamaModels(entries: CatalogEntry[], root: string, e: CatalogEndpoint, fetchFn: typeof fetch): Promise<void> {
  const queue = entries.slice(0, 200)
  const worker = async () => {
    for (;;) {
      const entry = queue.shift()
      if (!entry) return
      try {
        const r = await fetchFn(`${root}/api/show`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...bearerHeaders(e) },
          body: JSON.stringify({ model: entry.id }),
        })
        if (!r.ok) continue
        const info = (await r.json() as { model_info?: Record<string, unknown> })?.model_info
        if (!info || typeof info !== 'object') continue
        const key = Object.keys(info).find((k) => k.endsWith('.context_length'))
        const context = key ? Number(info[key]) : NaN
        if (context > 0) entry.context = context
      } catch { /* the local server may not expose details */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
}

async function fetchOllamaModels(e: CatalogEndpoint, fetchFn: typeof fetch): Promise<DirectResult> {
  const root = ollamaRoot(e.url)
  if (!root) return { entries: [], error: 'Ollama needs a base URL.' }
  const r = await fetchFn(`${root}/api/tags`, { headers: bearerHeaders(e) })
  if (!r.ok) throw Error(`Ollama model list HTTP ${r.status}`)
  const entries = parseOllamaTags(await r.json())
  await hydrateOllamaModels(entries, root, e, fetchFn)
  return { entries }
}

async function fetchDirect(provider: DirectProvider, e: CatalogEndpoint, fetchFn: typeof fetch): Promise<DirectResult> {
  try {
    if (provider === 'anthropic') return await fetchAnthropicModels(e, fetchFn)
    if (provider === 'google') return await fetchGoogleModels(e, fetchFn)
    if (provider === 'ollama') return await fetchOllamaModels(e, fetchFn)
    return await fetchOpenAiStyle(provider, e, fetchFn)
  } catch (err: unknown) {
    return { entries: [], error: (err as Error)?.message || `${PROVIDER_LABEL[provider]} model lookup failed.` }
  }
}

/** Fetch the picker catalog. Order:
 *  1. the endpoint's own provider list (when it has one),
 *  2. OpenRouter's public catalog (optionally brand-filtered),
 *  3. LiteLLM's public catalog,
 *  4. a generic `${base}/models` for unknown OpenAI-compatible servers. */
export async function fetchModelCatalog(
  e: CatalogEndpoint,
  fetchFn: typeof fetch = providerFetch,
): Promise<{ entries: CatalogEntry[]; error?: string; source?: CatalogSource; stale?: boolean }> {
  const base = trimBase(e.url)
  const endpointId = e.endpointId ?? ''
  const endpointFilter = e.endpointFilter ?? 'author'
  const provider = catalogProviderOf(e)
  const errors: string[] = []

  /* Inference routers have their own registry entry, including auth header,
   * discovery path, redirect policy, ETag handling, and capability filters.
   * OpenRouter keeps the existing brand-filter path below so the picker can
   * still prioritize the endpoint's own models. */
  const router = resolveProvider({ preset: e.preset, url: base })
  if (router && router.id !== 'openrouter') {
    const found = await discoverProviderModels(router, {
      url: base,
      key: e.key,
      accountId: e.accountId,
      gatewayId: e.gatewayId,
    }, fetchFn)
    const entries = found.entries.map((m) => ({
      id: m.id,
      name: m.name ?? '',
      efforts: [],
      source: 'manual' as const,
      providerId: m.providerId ?? router.id,
      ...(m.context && m.context > 0 ? { context: m.context } : {}),
      ...(m.inputPrice !== undefined ? { inputPrice: m.inputPrice } : {}),
      ...(m.outputPrice !== undefined ? { outputPrice: m.outputPrice } : {}),
      ...(m.cacheReadPrice !== undefined ? { cacheReadPrice: m.cacheReadPrice } : {}),
    }))
    return { entries, error: found.error, source: 'provider', ...(found.stale ? { stale: true } : {}) }
  }

  if (provider && base) {
    if (provider === 'generic') {
      const generic = await discoverEndpointModels(e, fetchFn)
      if (generic.entries.length) return { entries: generic.entries, source: 'provider' }
      if (generic.error) errors.push(generic.error)
    } else {
      const direct = await fetchDirect(provider, e, fetchFn)
      if (direct.entries.length) return { entries: direct.entries, source: provider === 'openrouter' ? 'openrouter' : 'provider' }
      if (direct.error) errors.push(direct.error)
      if (provider === 'ollama' && direct.error) errors.push('Ollama blocks requests from other origins unless OLLAMA_ORIGINS includes this app.')
    }
  }

  // The direct OpenRouter attempt already queried this catalog; do not retry.
  if (provider !== 'openrouter' || !base) {
    try {
      const q = endpointId ? `?${endpointFilter === 'provider' ? 'providers' : 'model_authors'}=${encodeURIComponent(endpointId)}` : ''
      const headers = endpointHeaders(e, /openrouter\.ai/i.test(base) && e.key ? { authorization: `Bearer ${e.key}` } : {})
      const r = await fetchFn(`https://openrouter.ai/api/v1/models${q}`, { headers })
      if (!r.ok) throw Error(`OpenRouter catalog HTTP ${r.status}`)
      const entries = parseCatalogModels(await r.json(), { endpointId, endpointName: e.name })
      if (entries.length) return { entries, source: 'openrouter' }
    } catch (err: unknown) {
      errors.push((err as Error)?.message || 'OpenRouter lookup failed.')
    }
  }

  try {
    const r = await fetchFn('https://models.litellm.ai/model_catalog')
    if (!r.ok) throw Error(`LiteLLM catalog HTTP ${r.status}`)
    const entries = parseCatalogModels(await r.json(), { endpointId, endpointName: e.name })
    if (entries.length) return { entries, source: 'litellm' }
  } catch (err: unknown) {
    errors.push((err as Error)?.message || 'LiteLLM lookup failed.')
  }

  // Unknown servers (or presets without a native list) get one last generic try.
  if (base && provider !== 'generic') {
    try {
      const r = await fetchFn(`${base}/models`, { headers: bearerHeaders(e) })
      if (r.ok) {
        const entries = parseCatalogModels(await r.json(), { endpointId, endpointName: e.name, priceUnit: 'none' })
        if (entries.length) return { entries, source: 'base' }
      }
    } catch { /* keep the accumulated error */ }
  }

  return { entries: [], error: errors.filter(Boolean).join('; ') || 'No model catalog was available.' }
}

/* ---- session cache + idle prefetch ----
 * Opening Endpoints used to wait for a live catalog request every time. The
 * catalog is stable for minutes, and the picker is the only consumer, so a
 * short-lived session cache plus an idle prefetch makes the open instant while
 * still refreshing when the user asks. Keys include a non-reversible hint of
 * the key (length + last four characters) so changing credentials cannot serve
 * another key's catalog. */
export const CATALOG_CACHE_TTL_MS = 10 * 60_000

type CatalogResult = { entries: CatalogEntry[]; error?: string; source?: CatalogSource; stale?: boolean }
type CacheRow = { at: number; result: CatalogResult }
const cache = new Map<string, CacheRow>()
const inflight = new Map<string, Promise<CatalogResult>>()

const keyHint = (e: CatalogEndpoint): string => {
  const key = String(e.key ?? '')
  return `${key.length}:${key.slice(-4)}`
}

/** Stable cache key for an endpoint's catalog. */
export function catalogCacheKey(e: CatalogEndpoint): string {
  return [e.id ?? '', e.url ?? '', e.preset ?? '', e.endpointId ?? '', e.endpointFilter ?? '', e.accountId ?? '', e.gatewayId ?? '', keyHint(e)].join('|')
}

/** Drop one endpoint's cached catalog (or all of them). The "Retry model-list
 *  checks" button clears this too, so a refresh really refetches. */
export function clearCatalogCache(id?: string): void {
  if (!id) { cache.clear(); return }
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}|`)) cache.delete(k)
}

/** Catalog request shared by the picker and the idle prefetch, with a short
 *  TTL. Concurrent callers for the same endpoint share one request. */
export async function fetchModelCatalogCached(
  e: CatalogEndpoint,
  fetchFn: typeof fetch = providerFetch,
  opts: { force?: boolean } = {},
): Promise<CatalogResult> {
  const key = catalogCacheKey(e)
  const hit = cache.get(key)
  if (!opts.force && hit && Date.now() - hit.at < CATALOG_CACHE_TTL_MS) return hit.result
  const running = inflight.get(key)
  if (running) return running
  const p = fetchModelCatalog(e, fetchFn)
    .then((result) => { cache.set(key, { at: Date.now(), result }); return result })
    .finally(() => { inflight.delete(key) })
  inflight.set(key, p)
  return p
}

/** Warm an endpoint's catalog during idle time. Safe to call repeatedly: a
 *  cached or in-flight request is a no-op. Errors are ignored — prefetching is
 *  a convenience, never a requirement. */
export function prefetchModelCatalog(e: CatalogEndpoint): void {
  if (!e?.url?.trim()) return
  const key = catalogCacheKey(e)
  if (cache.has(key) || inflight.has(key)) return
  const run = () => { void fetchModelCatalogCached(e).catch(() => {}) }
  const idle = (globalThis as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
  if (typeof idle === 'function') idle(run, { timeout: 4000 })
  else if (typeof setTimeout === 'function') setTimeout(run, 1200)
}
