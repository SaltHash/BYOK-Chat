/* Pure model-catalog helpers (no React). Fetch orchestration stays thin in Settings. */
import { stripVendorPrefix } from './models'

export type CatalogEntry = {
  id: string
  efforts: string[]
  source: 'auto' | 'manual'
  providerId: string
  name: string
  context?: number
  inputPrice?: number
  outputPrice?: number
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Normalize OpenRouter / LiteLLM / /models payloads into CatalogEntries. */
export function parseCatalogModels(body: unknown, opts: { endpointId?: string; endpointName?: string } = {}): CatalogEntry[] {
  const b = body as { data?: unknown; models?: unknown; model_catalog?: unknown }
  const rows = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : Array.isArray(b?.model_catalog) ? b.model_catalog : Array.isArray(body) ? body : []
  const endpointId = opts.endpointId ?? ''
  const endpointName = opts.endpointName ?? ''
  return (rows as Record<string, unknown>[]).map((x) => {
    const r = x as Record<string, unknown> & {
      supported_parameters?: unknown; reasoning?: { supported_efforts?: unknown }
      supported_efforts?: unknown; supported_reasoning_efforts?: unknown
      supports_reasoning?: unknown; supports_reasoning_effort?: unknown
      id?: unknown; model_id?: unknown; model_name?: unknown
      name?: unknown; display_name?: unknown
      provider?: unknown; litellm_provider?: unknown; provider_name?: unknown
      context_length?: unknown; context_window?: unknown; max_input_tokens?: unknown
      pricing?: { prompt?: unknown; completion?: unknown }
    }
    const params = Array.isArray(r.supported_parameters) ? r.supported_parameters : []
    const supportedEfforts = r.reasoning?.supported_efforts ?? r.supported_efforts ?? r.supported_reasoning_efforts
    const efforts = Array.isArray(supportedEfforts) ? supportedEfforts.map(String) : []
    const claimsReasoning = (params as unknown[]).includes('reasoning') || (params as unknown[]).includes('reasoning_effort') || r.supports_reasoning || r.supports_reasoning_effort
    const effortKnown = efforts.length > 0 || (!claimsReasoning && (Array.isArray(r.supported_parameters) || r.supports_reasoning === false))
    const id = String(r.id ?? r.model_id ?? r.model_name ?? '')
    const name = String(r.name ?? r.display_name ?? '')
    const providerId = String(r.provider ?? r.litellm_provider ?? r.provider_name ?? '')
    const modelLabel = stripVendorPrefix(name, [providerId, endpointId, endpointName, id.split('/')[0]])
    const context = Number(r.context_length ?? r.context_window ?? r.max_input_tokens)
    const inputPrice = Number(r.pricing?.prompt)
    const outputPrice = Number(r.pricing?.completion)
    return {
      id, efforts, source: effortKnown ? 'auto' as const : 'manual' as const, providerId, name: modelLabel,
      ...(context > 0 ? { context } : {}),
      ...(Number.isFinite(inputPrice) && inputPrice > 0 ? { inputPrice: round2(inputPrice * 1e6) } : {}),
      ...(Number.isFinite(outputPrice) && outputPrice > 0 ? { outputPrice: round2(outputPrice * 1e6) } : {}),
    }
  }).filter((x) => x.id && !/batch/i.test(x.id) && !/batch/i.test(x.name))
}

/** Limit catalog to one endpoint brand / provider. */
export function filterCatalogByEndpoint(entries: CatalogEntry[], endpointId: string, endpointFilter: string): CatalogEntry[] {
  if (!endpointId) return entries
  const id = endpointId.toLowerCase()
  return entries.filter((x) => endpointFilter === 'provider'
    ? x.providerId.toLowerCase() === id || (!x.id.includes('/') && x.id.toLowerCase().startsWith(`${id}-`))
    : x.id.toLowerCase().startsWith(`${id}/`))
}

/** Pin provider rows to the top for OpenRouter (same heuristic as before). */
export function prioritizeProviderRows(entries: CatalogEntry[], endpointId: string, endpointFilter: string): CatalogEntry[] {
  if (!endpointId) return entries
  const rows = filterCatalogByEndpoint(entries, endpointId, endpointFilter)
  const topCount = Math.min(rows.length, 10, Math.max(3, Math.floor(rows.length * 0.2)))
  const top = rows.slice(0, topCount)
  return [...top, ...entries.filter((x) => !top.includes(x))]
}

export type CatalogEndpoint = { url?: string; key?: string; preset?: string; name?: string; endpointId?: string; endpointFilter?: string }

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

/** Fetch catalog with the same fallback chain: OpenRouter → provider /models → LiteLLM → base /models. */
export async function fetchModelCatalog(
  e: CatalogEndpoint,
  fetchFn: typeof fetch = fetch,
): Promise<{ entries: CatalogEntry[]; error?: string }> {
  const base = String(e.url || '').trim().replace(/\/+$/, '')
  const headers: Record<string, string> = e.key ? { authorization: `Bearer ${e.key}` } : {}
  const openRouterHeaders: Record<string, string> = /openrouter\.ai/i.test(base) && e.key ? headers : {}
  const endpointId = e.endpointId ?? ''
  const endpointFilter = e.endpointFilter ?? 'author'
  const q = endpointId ? `?${endpointFilter === 'provider' ? 'providers' : 'model_authors'}=${encodeURIComponent(endpointId)}` : ''
  let found: CatalogEntry[] = []
  let firstError = ''
  try {
    const r = await fetchFn(`https://openrouter.ai/api/v1/models${q}`, { headers: openRouterHeaders })
    if (!r.ok) throw Error(`OpenRouter catalog HTTP ${r.status}`)
    found = parseCatalogModels(await r.json(), { endpointId, endpointName: e.name })
  } catch (err: unknown) { firstError = (err as Error)?.message || 'OpenRouter lookup failed.' }
  const generalProvider = ['Groq', 'Together', 'Fireworks', 'Ollama (local)', 'Other OpenAI-compatible'].includes(e.preset ?? '')
  if (generalProvider && base) {
    try { const r = await fetchFn(`${base}/models`, { headers }); if (r.ok) found = parseCatalogModels(await r.json(), { endpointId, endpointName: e.name }) } catch { /* fall back */ }
  }
  if (!found.length) {
    try {
      const r = await fetchFn('https://models.litellm.ai/model_catalog')
      if (!r.ok) throw Error(`LiteLLM catalog HTTP ${r.status}`)
      found = parseCatalogModels(await r.json(), { endpointId, endpointName: e.name })
    } catch (err: unknown) {
      if (base) try { const r = await fetchFn(`${base}/models`, { headers }); if (r.ok) found = parseCatalogModels(await r.json(), { endpointId, endpointName: e.name }) } catch { /* keep error */ }
      if (!found.length) return { entries: [], error: `${firstError}; ${(err as Error)?.message || 'LiteLLM lookup failed.'}` }
    }
  }
  return { entries: found }
}
