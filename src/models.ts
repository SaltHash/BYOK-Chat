import type { Ep } from './store'

/** Endpoint is enabled with a usable URL + model. */
export const usable = (e: Ep) => e.on && !!e.model.trim() && /^https?:\/\//i.test(e.url.trim())

export const modelsOf = (e: Ep) => [...new Set((e.models?.length ? e.models : [e.model]).map((x) => x?.trim()).filter(Boolean))]

export const modelNameOf = (e: Ep, model: string) => {
  const name = e.modelNames?.[model]
  if (name) {
    const colon = name.indexOf(':')
    const prefix = colon >= 0 ? name.slice(0, colon).trim().toLowerCase() : ''
    if (prefix && [e.name, e.endpointId, model.split('/')[0]].some((owner) => owner?.toLowerCase() === prefix)) return name.slice(colon + 1).trim()
    return name
  }
  return model.split('/').pop()!.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
