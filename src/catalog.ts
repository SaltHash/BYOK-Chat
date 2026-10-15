/* Pure model-catalog helpers (no React). Fetch orchestration stays thin in Settings. */

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
    const modelLabel = name.replace(/^~+/, '').replace(/^([^:]+):\s*/, (full: string, prefix: string) =>
      [providerId, endpointId, endpointName, id.split('/')[0]].some((owner) => owner && owner.toLowerCase() === prefix.trim().toLowerCase()) ? '' : full)
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
