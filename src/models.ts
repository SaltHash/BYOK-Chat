import type { Ep } from './store'

/** Endpoint is enabled with a usable URL + model. */
export const usable = (e: Ep) => e.on && !!e.model.trim() && /^https?:\/\//i.test(e.url.trim())

export const modelsOf = (e: Ep) => [...new Set((e.models?.length ? e.models : [e.model]).map((x) => x?.trim()).filter(Boolean))]

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

export const modelNameOf = (e: Ep, model: string) => {
  const name = e.modelNames?.[model]
  if (name) return stripVendorPrefix(name, [e.name, e.endpointId, model.split('/')[0]])
  return model.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
