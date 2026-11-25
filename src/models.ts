import type { Ep } from './store'

/** Endpoint is enabled with a usable URL + model. */
export const usable = (e: Ep) => e.on && !!e.model.trim() && /^https?:\/\//i.test(e.url.trim())

export const modelsOf = (e: Ep) => [...new Set((e.models?.length ? e.models : [e.model]).map((x) => x?.trim()).filter(Boolean))]

export type DiscoveredModels = {
  models: string[]
  model: string
  modelNames?: Record<string, string>
  modelContext?: Record<string, number>
  /** Input modalities the provider published per model (e.g. `text`,
   *  `image`, `file`), used to decide what each model can actually take. */
  modelModalities?: Record<string, string[]>
}

/** What a model-list discovery contributes to a new endpoint. The whole list
 *  is kept, not just the model the user picked: the endpoint then offers every
 *  model it advertised, with the picked one first so it stays the default.
 *  Names, context lengths and input modalities ride along when the provider
 *  published them. */
export function discoveredModelPatch(found: { id: string; name?: string; context?: number; inputModalities?: string[] }[], picked: string): DiscoveredModels {
  const chosen = String(picked ?? '').trim()
  const models = [...new Set([...(chosen ? [chosen] : []), ...found.map((f) => f.id).filter(Boolean)])]
  const names: Record<string, string> = {}
  const contexts: Record<string, number> = {}
  const modalities: Record<string, string[]> = {}
  for (const f of found) {
    if (!f.id) continue
    if (f.name) names[f.id] = f.name
    if (f.context && f.context > 0) contexts[f.id] = f.context
    if (f.inputModalities?.length) modalities[f.id] = f.inputModalities
  }
  const out: DiscoveredModels = { models: models.length ? models : [''], model: chosen || models[0] || '' }
  if (Object.keys(names).length) out.modelNames = names
  if (Object.keys(contexts).length) out.modelContext = contexts
  if (Object.keys(modalities).length) out.modelModalities = modalities
  return out
}

/** Whether a model can take a file kind natively, from the input modalities
 *  the provider published (OpenRouter's `architecture.input_modalities`, and
 *  the equivalent `input_modalities`/`modalities` fields other catalogs use).
 *  When the provider said nothing, assume it can: the send path lets the
 *  provider decide, the same default images already rely on. */
export function modelSupports(e: Ep, model: string, kind: 'img' | 'pdf'): boolean {
  const mods = e.modelModalities?.[model]
  if (!mods?.length) return true
  if (kind === 'img') return mods.includes('image')
  // File/PDF input is published as `file` (OpenRouter), sometimes `pdf` or
  // `document`.
  return mods.includes('file') || mods.includes('pdf') || mods.includes('document')
}

/** Apply an edit to an endpoint's model list and stamp it.
 *
 * The list itself cannot express a deletion to a merge: a model missing from
 * one copy looks the same as a model that copy never had. `modelsAt` alone
 * also loses to any later unrelated edit. Each added or removed model id gets
 * its own add/delete time instead, so a stale copy cannot bring a deleted row
 * back and a real re-add beats the old delete. Pure. */
export function modelListEdit(
  prev: Pick<Ep, 'models' | 'modelAdds' | 'modelDrops'>,
  next: string[],
  now = Date.now(),
  model = next.find((m) => m.trim())?.trim() ?? '',
) {
  const before = (prev.models ?? []).map((m) => m?.trim()).filter(Boolean)
  const after = next.map((m) => m?.trim()).filter(Boolean)
  const modelAdds = { ...(prev.modelAdds ?? {}) }
  const modelDrops = { ...(prev.modelDrops ?? {}) }
  for (const m of after) if (!before.includes(m)) { modelAdds[m] = now; delete modelDrops[m] }
  for (const m of before) if (!after.includes(m)) { modelDrops[m] = now; delete modelAdds[m] }
  return { models: next, model, modelsAt: now, modelAdds, modelDrops }
}

const normVendor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/** True when a `Vendor:` display-name prefix names one of the owners
 * (endpoint, provider, or id slug). Fuzzy on purpose: the OpenRouter label
 * "Meta: Llama 3.1 8B Instruct" uses `Meta` while the id slug is
 * `meta-llama`, so a normalized prefix also matches when one side starts
 * with the other (minimum 3 shared characters). */
export const vendorPrefixOf = (name: string, owners: (string | undefined)[]): boolean => {
  const m = name.replace(/^~+/, '').match(/^([^:]+):\s*/)
  if (!m) return false
  const prefix = normVendor(m[1])
  if (!prefix) return false
  return owners.some((o) => {
    const owner = normVendor(o ?? '')
    if (!owner) return false
    if (owner === prefix) return true
    const short = prefix.length < owner.length ? prefix : owner
    return short.length >= 3 && (owner.startsWith(prefix) || prefix.startsWith(owner))
  })
}
/** Drop a `Vendor:` prefix that names one of the owners, if present. */
export const stripVendorPrefix = (name: string, owners: (string | undefined)[]): string => {
  const clean = name.replace(/^~+/, '')
  return vendorPrefixOf(clean, owners) ? clean.replace(/^([^:]+):\s*/, '') : clean
}

/** A readable label derived from the model id alone, for usage rows whose
 *  endpoint (or catalog entry) is no longer configured: "openai/gpt-4o-mini"
 *  reads as "Gpt 4o mini" instead of leaking the raw id into a stat. */
export const prettyModelId = (model: string) =>
  model.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const modelNameOf = (e: Ep, model: string) => {
  const name = e.modelNames?.[model]
  if (name) return stripVendorPrefix(name, [e.name, e.endpointId, model.split('/')[0]])
  return prettyModelId(model)
}

/** Free (`:free`) endpoints are not served on the priority or flex tiers that
 *  OpenRouter's `:nitro`/`:floor` variants admit, so a routing tier is refused
 *  for them. Kept here (not in the store) so request building never imports the
 *  store and creates a module cycle. */
export const tierAllowed = (model: string): boolean =>
  !String(model ?? '').split(':').slice(1).some((s) => /^free$/i.test(s.trim()))

/** A price per million tokens: four decimals when the value carries that much
 *  precision, never fewer than two ("$0.27", "$0.0125", "$3.00"). */
export const priceText = (n: number): string => {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  const [whole, decimals = ''] = abs.toFixed(4).split('.')
  const trimmed = decimals.replace(/0+$/, '')
  const keep = trimmed.length >= 2 ? trimmed : decimals.slice(0, 2)
  return `${n < 0 ? '-' : ''}${whole}.${keep}`
}
