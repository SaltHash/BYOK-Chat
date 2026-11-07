import type { Ep } from './store'

/** Endpoint is enabled with a usable URL + model. */
export const usable = (e: Ep) => e.on && !!e.model.trim() && /^https?:\/\//i.test(e.url.trim())

export const modelsOf = (e: Ep) => [...new Set((e.models?.length ? e.models : [e.model]).map((x) => x?.trim()).filter(Boolean))]

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
