/* Authentication and user-supplied request headers for custom endpoints.
 *
 * Known inference routers keep their own auth rules in providerRegistry.ts;
 * this module is for arbitrary OpenAI-compatible and Anthropic-compatible
 * servers, where the copied cURL command is the source of truth. */

export type EndpointAuth = 'bearer' | 'api-key' | 'x-api-key' | 'x-goog-api-key' | 'basic' | 'none'

export const ENDPOINT_AUTH_OPTIONS: [EndpointAuth, string][] = [
  ['bearer', 'Authorization: Bearer'],
  ['api-key', 'api-key header'],
  ['x-api-key', 'x-api-key header'],
  ['x-goog-api-key', 'x-goog-api-key header'],
  ['basic', 'Authorization: Basic'],
  ['none', 'No auth header'],
]

export type AuthEndpoint = {
  key?: string
  auth?: EndpointAuth
  headers?: string
  type?: 'openai' | 'anthropic'
}

export const endpointAuthOf = (e: AuthEndpoint): EndpointAuth =>
  e.auth ?? (e.type === 'anthropic' ? 'x-api-key' : 'bearer')

const basicValue = (raw: string): string => {
  const key = raw.trim()
  if (!key || !key.includes(':')) return key
  try { return btoa(key) } catch { return key }
}

/** Auth header for a custom endpoint. `fallback` is only used when the
 *  endpoint has no explicit choice (older configs and new presets). */
export function endpointAuthHeaders(e: AuthEndpoint, fallback?: EndpointAuth): Record<string, string> {
  const auth = e.auth ?? fallback ?? (e.type === 'anthropic' ? 'x-api-key' : 'bearer')
  const key = String(e.key ?? '').trim()
  if (auth === 'none') return {}
  if (!key) return {}
  switch (auth) {
    case 'api-key': return { 'api-key': key }
    case 'x-api-key': return { 'x-api-key': key }
    case 'x-goog-api-key': return { 'x-goog-api-key': key }
    case 'basic': return { authorization: `Basic ${basicValue(key)}` }
    default: return { authorization: `Bearer ${key}` }
  }
}

const TRANSPORT_HEADERS = /^(host|content-length|content-type|connection|transfer-encoding|upgrade)$/i

/** Parse a `Name: value` block. Transport headers are dropped so a pasted
 *  block cannot set Host or Content-Length; auth headers are allowed so the
 *  user can override a provider quirk, and are applied after the auth method. */
export function parseCustomHeaderBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  let count = 0
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    if (count >= 50) break
    const i = line.indexOf(':')
    if (i < 1) continue
    const name = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (!name || !value || TRANSPORT_HEADERS.test(name)) continue
    if (/[^!#$%&'*+.^_`|~0-9A-Za-z-]/.test(name)) continue
    out[name] = value.slice(0, 4000)
    count++
  }
  return out
}

/** Merge custom headers over an existing header set, case-insensitively. */
export function endpointHeaders(e: AuthEndpoint, base: Record<string, string> = {}): Record<string, string> {
  const out = { ...base }
  for (const [name, value] of Object.entries(parseCustomHeaderBlock(e.headers ?? ''))) {
    for (const key of Object.keys(out)) {
      if (key.toLowerCase() === name.toLowerCase()) delete out[key]
    }
    out[name] = value
  }
  return out
}

/** Serialize a header map back into the editable block used by the UI. */
export function headerBlockOf(headers: Record<string, string>): string {
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n')
}
