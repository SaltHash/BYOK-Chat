/* Pure model-catalog helpers (no React). Fetch orchestration stays thin in Settings. */
import { stripVendorPrefix } from './models'
import { discoverProviderModels, resolveProvider } from './providerAdapter'

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

export type CatalogEndpoint = { url?: string; key?: string; preset?: string; name?: string; endpointId?: string; endpointFilter?: string; accountId?: string; gatewayId?: string }

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
  e: { url?: string; key?: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ providers: CatalogProvider[]; error?: string }> {
  const base = String(e.url || '').trim().replace(/\/+$/, '')
  if (!/openrouter\.ai/i.test(base)) return { providers: [], error: 'Provider selection needs an OpenRouter endpoint.' }
  const id = baseModelId(model)
  if (!id) return { providers: [], error: 'Enter a model ID first.' }
  const headers: Record<string, string> = e.key ? { authorization: `Bearer ${e.key}` } : {}
  try {
    const r = await fetchFn(`https://openrouter.ai/api/v1/models/${id}/endpoints`, { headers })
    if (!r.ok) throw Error(`OpenRouter provider lookup HTTP ${r.status}`)
    return { providers: parseModelProviders(await r.json()) }
  } catch (err: unknown) {
    return { providers: [], error: (err as Error)?.message || 'Provider lookup failed.' }
  }
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

const bearerHeaders = (e: CatalogEndpoint): Record<string, string> => e.key ? { authorization: `Bearer ${e.key}` } : {}

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
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  if (e.key) headers['x-api-key'] = e.key
  const entries: CatalogEntry[] = []
  let after = ''
  for (let page = 0; page < 20; page++) {
    const url = `${base}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`
    const r = await fetchFn(url, { headers })
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
  const headers: Record<string, string> = e.key ? { 'x-goog-api-key': e.key } : {}
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
  fetchFn: typeof fetch = fetch,
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
    const direct = await fetchDirect(provider, e, fetchFn)
    if (direct.entries.length) return { entries: direct.entries, source: provider === 'openrouter' ? 'openrouter' : 'provider' }
    if (direct.error) errors.push(direct.error)
    if (provider === 'ollama' && direct.error) errors.push('Ollama blocks requests from other origins unless OLLAMA_ORIGINS includes this app.')
  }

  // The direct OpenRouter attempt already queried this catalog; do not retry.
  if (provider !== 'openrouter' || !base) {
    try {
      const q = endpointId ? `?${endpointFilter === 'provider' ? 'providers' : 'model_authors'}=${encodeURIComponent(endpointId)}` : ''
      const headers: Record<string, string> = /openrouter\.ai/i.test(base) && e.key ? { authorization: `Bearer ${e.key}` } : {}
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
