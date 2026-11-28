/* Inference-router registry.
 *
 * Every entry is configuration only: base URL, auth header, discovery paths,
 * and behavioural flags. The generic adapter in providerAdapter.ts reads
 * these fields, so adding a provider means adding an entry here (and nothing
 * in the picker, request builder, or send flow).
 *
 * Keys are never stored here. They live in the endpoint object in the
 * browser's localStorage, exactly like every other endpoint key in this app.
 */

export type ProviderCors = 'confirmed' | 'unverified' | 'blocked' | 'configurable'

export type ProviderDiscovery = {
  /** Relative to the endpoint base URL (or `base` when set). */
  path?: string
  /** Absolute root when discovery lives on a different path/host. */
  base?: string
  /** Auth prefix override for discovery (for example Basic for Inworld). */
  authPrefix?: string
  /** Combine a row's `provider` with its model id (Inworld). */
  providerPrefix?: boolean
  /** Optional single-model lookup. `{id}` is replaced with the encoded id. */
  singlePath?: string
  /** Absolute origin for a single lookup that lives outside the API root. */
  singleBase?: string
  /** Send `If-None-Match` and treat `304` as the cached list. */
  etag?: boolean
  /** Values the provider accepts in addition to the discovered list. */
  extraModels?: string[]
  /** Only offer rows whose capability flags are not explicitly false. */
  requireCapabilities?: string[]
  /** Keep rows whose `type` is one of these values. Rows without a type stay. */
  chatTypes?: string[]
  /** Machine-readable explanation when discovery is not available. */
  unavailable?: string
}

export type ProviderConfig = {
  id: string
  name: string
  /** Settings → Endpoints preset label. */
  preset: string
  baseURL: string
  chatPath: string
  authHeader: string
  authPrefix: string
  /** Whether a request is expected to carry a key. Local servers can be keyless. */
  authRequired: boolean
  discovery: ProviderDiscovery | null
  cors: ProviderCors
  corsNote?: string
  /** Follow 3xx responses explicitly (The Grid redirects to its router). */
  followRedirects: boolean
  /** Alternate hosts that belong to the same provider (for example Requesty EU). */
  hosts?: string[]
  /** The base URL is account-scoped and contains `{ACCOUNT_ID}`. */
  accountScoped?: boolean
  /** Extra header required for this provider, read from the endpoint settings. */
  gatewayHeader?: { header: string; field: 'gatewayId'; label: string; modelPrefix?: string }
  /** Provider-specific guidance shown with 401/403 errors. */
  authHint?: string
  docs?: string
}

export type ProviderEndpoint = {
  url?: string
  key?: string
  accountId?: string
  gatewayId?: string
  [key: string]: unknown
}

const CONFIG: ProviderConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    preset: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: { path: '/models' },
    cors: 'confirmed',
    corsNote: 'Preflight previously returned 204 with Access-Control-Allow-Origin: *.',
    followRedirects: false,
    docs: 'https://openrouter.ai/docs',
  },
  {
    id: 'aihubmix',
    name: 'AIHubMix',
    preset: 'AIHubMix',
    baseURL: 'https://aihubmix.com/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: { path: '/models' },
    cors: 'confirmed',
    corsNote: 'Preflight returned 204, echoing the origin with Access-Control-Allow-Headers: authorization,content-type.',
    followRedirects: false,
    authHint: 'AIHubMix keys are created in the console and can be restricted to a model list, an IP allowlist, a spend cap, and an expiry date.',
    docs: 'https://docs.aihubmix.com',
  },
  {
    id: 'thegrid',
    name: 'The Grid',
    preset: 'The Grid',
    baseURL: 'https://api.thegrid.ai/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: { path: '/models' },
    cors: 'confirmed',
    corsNote: 'Preflight returned 204 with Access-Control-Allow-Origin: *.',
    followRedirects: true,
    authHint: 'The Grid model values are instruments such as text-prime, code-max, or claude-opus-latest.',
    docs: 'https://thegrid.ai/docs',
  },
  {
    id: 'compactifai',
    name: 'CompactifAI',
    preset: 'CompactifAI',
    baseURL: 'https://api.compactif.ai/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: { path: '/models', singlePath: '/models/{id}', requireCapabilities: ['supports_messages'] },
    cors: 'confirmed',
    corsNote: 'Preflight echoed the origin with Access-Control-Allow-Origin.',
    followRedirects: false,
    authHint: 'CompactifAI keys are issued through AWS Marketplace and can take about 24 hours to approve.',
    docs: 'https://compactif.ai',
  },
  {
    id: 'aimlapi',
    name: 'AI/ML API',
    preset: 'AI/ML API',
    baseURL: 'https://api.aimlapi.com/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: {
      path: '/models',
      singlePath: '/model/{id}',
      singleBase: 'https://api.aimlapi.com',
      etag: true,
      chatTypes: ['openai/chat-completions', 'anthropic/messages'],
    },
    cors: 'confirmed',
    corsNote: 'Preflight echoed the origin with Access-Control-Allow-Origin.',
    followRedirects: false,
    docs: 'https://docs.aimlapi.com',
  },
  {
    id: 'requesty',
    name: 'Requesty',
    preset: 'Requesty',
    baseURL: 'https://router.requesty.ai/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: { path: '/models', extraModels: ['smart-task'] },
    cors: 'confirmed',
    corsNote: 'Preflight returned 204 with Access-Control-Allow-Origin: *.',
    followRedirects: false,
    hosts: ['router.eu.requesty.ai'],
    authHint: 'Authenticated discovery returns only models approved for your organization. The smart-task model lets Requesty choose.',
    docs: 'https://docs.requesty.ai',
  },
  {
    id: 'inworld',
    name: 'Inworld',
    preset: 'Inworld',
    baseURL: 'https://api.inworld.ai/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: {
      base: 'https://api.inworld.ai/llm/v1alpha',
      path: '/models',
      authPrefix: 'Basic ',
      providerPrefix: true,
      extraModels: ['auto'],
    },
    cors: 'confirmed',
    corsNote: 'Preflight to the chat endpoint echoed the origin; the models list endpoint also returns CORS headers.',
    followRedirects: false,
    hosts: ['api.eu.inworld.ai', 'api.in.inworld.ai'],
    authHint: 'Inworld Router API keys are Base64 credentials copied from the Inworld portal; the same key works with Bearer auth.',
    docs: 'https://docs.inworld.ai',
  },
  {
    id: 'vercel',
    name: 'Vercel AI Gateway',
    preset: 'Vercel AI Gateway',
    baseURL: 'https://ai-gateway.vercel.sh/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: { path: '/models', chatTypes: ['language'] },
    cors: 'confirmed',
    corsNote: 'Preflight returned 200, echoing the origin; GET /v1/models works without a key. The legacy api.vercel.com/v1/ai path redirects without CORS headers.',
    followRedirects: false,
    docs: 'https://vercel.com/docs/ai-gateway',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    preset: 'Cloudflare Workers AI',
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: null,
    cors: 'blocked',
    corsNote: 'Preflight to the account-scoped API returned 405 without Access-Control-Allow-* headers.',
    followRedirects: false,
    accountScoped: true,
    gatewayHeader: { header: 'cf-aig-gateway-id', field: 'gatewayId', label: 'AI Gateway ID', modelPrefix: '@cf/' },
    authHint: 'Create a Cloudflare API token with Account → Workers AI → Read. A token with only AI Gateway permission returns HTTP 401 with error code 10000.',
    docs: 'https://developers.cloudflare.com/workers-ai/',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    preset: 'DigitalOcean',
    baseURL: 'https://inference.do-ai.run/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: null,
    cors: 'confirmed',
    corsNote: 'Preflight returned 200 with Access-Control-Allow-Origin: *.',
    followRedirects: false,
    authHint: 'DigitalOcean publishes its model catalog in the console, not through an API. Enter the model id manually.',
    docs: 'https://docs.digitalocean.com/products/inference/',
  },
  {
    id: 'portkey',
    name: 'Portkey',
    preset: 'Portkey',
    baseURL: 'https://api.portkey.ai/v1',
    chatPath: '/chat/completions',
    authHeader: 'x-portkey-api-key',
    authPrefix: '',
    authRequired: true,
    discovery: { path: '/models' },
    cors: 'confirmed',
    corsNote: 'Preflight returned 200 with Access-Control-Allow-Origin: *.',
    followRedirects: false,
    docs: 'https://portkey.ai/docs',
  },
  {
    id: 'bifrost',
    name: 'Bifrost',
    preset: 'Bifrost (self-hosted)',
    baseURL: 'http://localhost:8080/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'configurable',
    corsNote: 'Self-hosted: set allowed_origins in Bifrost (defaults to ["*"]).',
    followRedirects: false,
    docs: 'https://docs.getbifrost.ai',
  },
  {
    id: 'litellm',
    name: 'LiteLLM',
    preset: 'LiteLLM (self-hosted)',
    baseURL: 'http://localhost:4000/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'configurable',
    corsNote: 'Self-hosted: configure allowed origins on the LiteLLM proxy.',
    followRedirects: false,
    docs: 'https://docs.litellm.ai',
  },
  /* Local inference servers. They speak the same OpenAI-compatible protocol as
   * the routers above, so they need no request code: a loopback base URL, a
   * `/models` list, and a key only when the server was started with one.
   * Unsloth Studio and vLLM both default to port 8000, so the preset label is
   * what tells them apart; the base URL stays editable in Advanced. */
  {
    id: 'lmstudio',
    name: 'LM Studio',
    preset: 'LM Studio (local)',
    baseURL: 'http://localhost:1234/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'configurable',
    corsNote: 'Self-hosted: turn on Enable CORS in LM Studio (Developer → Server Settings, or lms server start --cors); it is off by default.',
    followRedirects: false,
    docs: 'https://lmstudio.ai/docs/developer/rest/quickstart',
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp',
    preset: 'llama.cpp (local)',
    baseURL: 'http://localhost:8080/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'configurable',
    corsNote: 'Self-hosted: llama-server sends permissive CORS headers by default; pass --cors-origins to restrict them.',
    followRedirects: false,
    docs: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    preset: 'vLLM (local)',
    baseURL: 'http://localhost:8000/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'unverified',
    corsNote: 'Self-hosted: vLLM’s OpenAI server accepts browser origins by default.',
    followRedirects: false,
    authHint: 'Start vLLM with --api-key to require a key; without it the server accepts any request.',
    docs: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
  },
  {
    id: 'unsloth',
    name: 'Unsloth',
    preset: 'Unsloth (local)',
    baseURL: 'http://localhost:8000/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: true,
    discovery: { path: '/models' },
    cors: 'unverified',
    corsNote: 'Self-hosted: Unsloth Studio binds 127.0.0.1 by default; the port is printed at startup (8000 or 8888).',
    followRedirects: false,
    authHint: 'Unsloth Studio requires a key created under Settings → API; it is shown once and starts with sk-unsloth.',
    docs: 'https://unsloth.ai/docs/basics/api',
  },
  {
    id: 'jan',
    name: 'Jan',
    preset: 'Jan (local)',
    baseURL: 'http://127.0.0.1:1337/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'unverified',
    corsNote: 'Self-hosted: Jan’s local API server runs on 127.0.0.1:1337 with an empty key unless you set one.',
    followRedirects: false,
    docs: 'https://docs.jan.ai/desktop/api-server',
  },
  {
    id: 'freetoken',
    name: 'FreeToken',
    preset: 'FreeToken (local)',
    baseURL: 'http://127.0.0.1:1919/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'unverified',
    corsNote: 'Self-hosted: FreeToken binds 127.0.0.1:1919; pass --api-key (or set FREETOKEN_API_KEY) to require a key.',
    followRedirects: false,
    docs: 'https://github.com/FlashML-org/FreeToken',
  },
  {
    id: 'docker',
    name: 'Docker Model Runner',
    preset: 'Docker Model Runner (local)',
    baseURL: 'http://localhost:12434/engines/v1',
    chatPath: '/chat/completions',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    authRequired: false,
    discovery: { path: '/models' },
    cors: 'unverified',
    corsNote: 'Self-hosted: enable TCP access with docker desktop enable model-runner --tcp 12434 before connecting from the host.',
    followRedirects: false,
    docs: 'https://docs.docker.com/ai/model-runner/',
  },
]

export const PROVIDERS: readonly ProviderConfig[] = CONFIG
export const PROVIDER_IDS = CONFIG.map((p) => p.id)

const byId = new Map(CONFIG.map((p) => [p.id, p]))
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const hostOf = (url: string): string => {
  const raw = String(url ?? '').replace(/\{[^}]+\}/g, 'account')
  try { return new URL(raw).host.toLowerCase() } catch { /* not a full URL */ }
  try { return new URL(`https://${raw}`).host.toLowerCase() } catch { return '' }
}

const hostMap = new Map<string, ProviderConfig>()
for (const provider of CONFIG) {
  for (const host of [provider.baseURL, ...(provider.hosts ?? [])]) {
    const h = hostOf(host)
    if (h && !hostMap.has(h)) hostMap.set(h, provider)
  }
}

/** Look up a provider by id, preset label, or endpoint URL/host. */
export function getProvider(id: string): ProviderConfig | undefined {
  return byId.get(String(id).toLowerCase())
}

export function resolveProvider(input: string | { id?: string; preset?: string; name?: string; url?: string } | null | undefined): ProviderConfig | undefined {
  if (!input) return undefined
  if (typeof input === 'string') return getProvider(input) ?? CONFIG.find((p) => norm(p.preset) === norm(input) || norm(p.name) === norm(input))
  if (input.id) { const hit = getProvider(input.id); if (hit) return hit }
  const labels = [input.preset, input.name].filter(Boolean)
  for (const label of labels) {
    const hit = CONFIG.find((p) => norm(p.preset) === norm(label) || norm(p.name) === norm(label))
    if (hit) return hit
  }
  if (input.url) {
    const host = hostOf(input.url)
    if (host && hostMap.has(host)) return hostMap.get(host)
  }
  return undefined
}

/** Preset rows consumed by the existing Settings endpoint picker. Each entry
 *  is `[label, [type, baseURL, endpointId, endpointFilter]]` so it can be
 *  passed straight to `Object.fromEntries`. */
export function providerPresetEntries(): [string, ['openai', string, string, 'author' | 'provider']][] {
  return CONFIG.map((p) => [p.preset, ['openai', p.baseURL, p.id === 'openrouter' ? '' : p.id, 'author']])
}

export const extractAccountId = (url: string | undefined): string => {
  const m = /\/accounts\/([^/?#]+)/i.exec(String(url ?? ''))
  return m && m[1] !== '{ACCOUNT_ID}' ? decodeURIComponent(m[1]) : ''
}

/** Resolve an endpoint's base URL, including the account-scoped placeholder. */
export function providerBaseUrl(provider: ProviderConfig, endpoint: ProviderEndpoint = {}): string {
  const configured = String(endpoint.url ?? '').trim()
  let base = configured || provider.baseURL
  const accountId = String(endpoint.accountId ?? '').trim() || extractAccountId(base)
  // Leave the placeholder in place when it cannot be filled, so callers can
  // report a specific "Account ID required" error instead of sending
  // `accounts//` to the provider.
  if (provider.accountScoped && accountId) base = base.replace(/\{ACCOUNT_ID\}|\{accountId\}/gi, accountId)
  return base.replace(/\/+$/, '')
}

export function hasUnresolvedPlaceholder(url: string): boolean {
  return /\{[^}]+\}/.test(url)
}

export function providerChatUrl(provider: ProviderConfig, endpoint: ProviderEndpoint = {}): string {
  return providerBaseUrl(provider, endpoint) + provider.chatPath
}

export function providerAuthHeaders(provider: ProviderConfig, key: string | undefined): Record<string, string> {
  const value = String(key ?? '').trim()
  if (!value) return {}
  return { [provider.authHeader]: `${provider.authPrefix}${value}` }
}

/** Headers every request to this provider needs, including gateway selectors. */
export function providerHeaders(provider: ProviderConfig, endpoint: ProviderEndpoint = {}): Record<string, string> {
  const headers = providerAuthHeaders(provider, endpoint.key)
  if (provider.gatewayHeader) {
    const value = String(endpoint[provider.gatewayHeader.field] ?? '').trim()
    if (value) headers[provider.gatewayHeader.header] = value
  }
  return headers
}

/** Discovery URL for the list endpoint (single-model helpers use discoveryUrlFor). */
export function providerModelsUrl(provider: ProviderConfig, endpoint: ProviderEndpoint = {}): string {
  if (!provider.discovery?.path) return ''
  const root = provider.discovery.base ?? providerBaseUrl(provider, endpoint)
  return root.replace(/\/+$/, '') + provider.discovery.path
}

export function providerSingleModelUrl(provider: ProviderConfig, endpoint: ProviderEndpoint, modelId: string): string {
  const single = provider.discovery?.singlePath
  if (!single) return ''
  const root = provider.discovery?.singleBase ?? providerBaseUrl(provider, endpoint)
  return root.replace(/\/+$/, '') + single.replace('{id}', encodeURIComponent(modelId))
}
