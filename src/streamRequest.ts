import type { Ep } from './store'
import type { Wire } from './engine'
import { withCode } from './errors'
import { hasUnresolvedPlaceholder, providerBaseUrl, providerHeaders, resolveProvider } from './providerRegistry'
import { endpointAuthHeaders, endpointHeaders } from './endpointAuth'

export type StreamOptions = { cap?: number; max?: number; temp?: number; topp?: number; effort?: string }

/** Whether the model reports reasoning-effort levels (single source of truth). */
export const supportsEffort = (_model: string, _type: Ep['type'], detected?: string[]) =>
  Array.isArray(detected) && detected.length > 0

/** Pure request builder for stream(): no fetch, no side effects, unit-testable. */
export function buildStreamRequest(
  e: Ep,
  sys: string,
  ms: Wire[],
  availableTools: unknown[] = [],
  o: StreamOptions = {},
): { url: string; headers: Record<string, string>; body: unknown; isAnthropic: boolean; redirect?: RequestRedirect; providerId?: string } {
  const an = e.type === 'anthropic'
  const b = e.url.trim().replace(/\/+$/, '')
  const provider = an ? undefined : resolveProvider({ preset: e.preset, url: b })
  const base = provider ? providerBaseUrl(provider, e) : b
  if (provider && hasUnresolvedPlaceholder(base)) throw withCode(`${provider.name} needs an Account ID before it can send a request. Add it in Settings → Endpoints.`, 'bad_request')
  const h: Record<string, string> = { 'content-type': 'application/json' }
  let u: string
  let body: Record<string, unknown>
  if (an) {
    u = b + '/messages'
    Object.assign(h, endpointAuthHeaders(e, 'x-api-key'))
    h['anthropic-version'] = '2023-06-01'
    h['anthropic-dangerous-direct-browser-access'] = 'true'
    body = { model: e.model, max_tokens: o.max ?? o.cap ?? 4096, stream: true, messages: ms }
    if (availableTools.length) body.tools = availableTools
    if (sys) body.system = sys
    const reported = e.modelEffortSource?.[e.model] ? e.modelEfforts?.[e.model] ?? [] : undefined
    if (o.effort && o.effort.toLowerCase() !== 'off' && reported?.includes(o.effort) && supportsEffort(e.model, 'anthropic', reported)) {
      body.thinking = { type: 'adaptive' }
      body.output_config = { effort: o.effort }
    } else if (o.temp != null) body.temperature = o.temp
  } else {
    u = base + (provider?.chatPath ?? '/chat/completions')
    if (provider) Object.assign(h, providerHeaders(provider, e))
    else Object.assign(h, endpointAuthHeaders(e))
    body = { model: e.model, stream: true, messages: sys ? [{ role: 'system', content: sys }, ...ms] : ms }
    // Ask providers to include token usage (and, for OpenRouter, cost) in
    // the final streamed chunk. Without this most OpenAI-compatible APIs
    // omit `usage`, forcing token estimates and a $0 cost.
    body.stream_options = { include_usage: true }
    // OpenRouter reports per-request cost in `usage.cost`, but only when
    // explicitly requested. Harmless to other providers; only send there.
    if (/openrouter\.ai/i.test(base)) {
      body.usage = { include: true }
      // Per-model provider pin (Settings → Endpoints → model → Provider).
      // `order` alone only prioritizes, so also block fallbacks: picking a
      // provider must mean that provider. Absent = OpenRouter's default routing.
      const providerTag = e.modelProviders?.[e.model]?.tag
      if (providerTag) body.provider = { order: [providerTag], allow_fallbacks: false }
    }
    if (availableTools.length) { body.tools = availableTools; body.tool_choice = 'auto' }
    if (o.max != null) body.max_tokens = o.max
    if (o.temp != null) body.temperature = o.temp
    if (o.topp != null) body.top_p = o.topp
    const reportedOpen = e.modelEffortSource?.[e.model] ? e.modelEfforts?.[e.model] ?? [] : undefined
    if (o.effort && o.effort.toLowerCase() !== 'off' && reportedOpen?.includes(o.effort) && supportsEffort(e.model, 'openai', reportedOpen)) body.reasoning_effort = o.effort
  }
  return {
    url: u,
    headers: endpointHeaders(e, h),
    body,
    isAnthropic: an,
    ...(provider?.followRedirects ? { redirect: 'follow' as RequestRedirect } : {}),
    ...(provider ? { providerId: provider.id } : {}),
  }
}

/** Split one SSE text buffer into complete lines + remainder (pure). */
export function splitSseBuffer(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}

/** Parse one `data:` line payload; returns null for keep-alives / [DONE] / invalid JSON. */
export function parseSseLine(line: string): unknown | null {
  if (!line.startsWith('data:')) return null
  const s = line.slice(5).trim()
  if (!s || s === '[DONE]') return null
  try { return JSON.parse(s) } catch { return null }
}
