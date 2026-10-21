#!/usr/bin/env node
/* Smoke-test every provider in the inference-router registry.
 *
 *   npm run smoke:providers
 *   npm run smoke:providers -- --provider=openrouter --model=openai/gpt-4o-mini
 *
 * Keys are read from the environment (or the gitignored .env loaded by the
 * dev entry) and are never printed. Providers without a key still get their
 * public discovery and CORS preflight checked; streaming is skipped.
 */
try { process.loadEnvFile() } catch { /* no .env file */ }

const { PROVIDERS, discoverProviderModels, streamChatCompletion, probeProviderCors } = await import('../src/providerAdapter.ts')

const KEY_ENV = {
  openrouter: ['OPENROUTER_API_KEY'],
  thegrid: ['THEGRID_API_KEY', 'THE_GRID_API_KEY'],
  compactifai: ['COMPACTIFAI_API_KEY'],
  aimlapi: ['AIMLAPI_API_KEY', 'AIML_API_KEY'],
  requesty: ['REQUESTY_API_KEY'],
  inworld: ['INWORLD_API_KEY'],
  vercel: ['VERCEL_AI_GATEWAY_API_KEY', 'VERCEL_API_KEY'],
  cloudflare: ['CLOUDFLARE_API_TOKEN'],
  digitalocean: ['DIGITALOCEAN_API_KEY', 'DIGITALOCEAN_TOKEN'],
  portkey: ['PORTKEY_API_KEY'],
  bifrost: ['BIFROST_API_KEY'],
  litellm: ['LITELLM_API_KEY'],
}
const BASE_ENV = {
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID'],
  bifrost: ['BIFROST_BASE_URL'],
  litellm: ['LITELLM_BASE_URL'],
}
const MODEL_ENV = {
  openrouter: ['OPENROUTER_MODEL'],
  thegrid: ['THEGRID_MODEL', 'THE_GRID_MODEL'],
  compactifai: ['COMPACTIFAI_MODEL'],
  aimlapi: ['AIMLAPI_MODEL'],
  requesty: ['REQUESTY_MODEL'],
  inworld: ['INWORLD_MODEL'],
  vercel: ['VERCEL_MODEL'],
  cloudflare: ['CLOUDFLARE_MODEL'],
  digitalocean: ['DIGITALOCEAN_MODEL'],
  portkey: ['PORTKEY_MODEL'],
  bifrost: ['BIFROST_MODEL'],
  litellm: ['LITELLM_MODEL'],
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [k, ...rest] = arg.replace(/^--/, '').split('=')
  return [k, rest.join('=')]
}))
const only = args.get('provider') || ''
const forcedModel = args.get('model') || ''
const timeoutMs = Number(args.get('timeout') || 25000)

const firstEnv = (names) => names.map((name) => process.env[name]).find((v) => v && v.trim()) || ''

async function withTimeout(promise, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try { return await promise(controller.signal) } finally { clearTimeout(timer) }
}

let failures = 0
for (const provider of PROVIDERS) {
  if (only && provider.id !== only && provider.preset.toLowerCase() !== only.toLowerCase()) continue
  const key = firstEnv(KEY_ENV[provider.id] ?? [])
  const base = firstEnv(BASE_ENV[provider.id] ?? [])
  const endpoint = {
    key,
    ...(base ? provider.id === 'cloudflare' ? { accountId: base } : { url: base } : {}),
  }
  console.log(`\n=== ${provider.name} (${provider.id}) ===`)
  console.log(`auth: ${key ? 'present' : provider.authRequired ? 'missing' : 'not required'} · registry CORS: ${provider.cors}`)
  if (provider.baseURL.includes('{ACCOUNT_ID}') && !process.env.CLOUDFLARE_ACCOUNT_ID) console.log('account ID: missing (set CLOUDFLARE_ACCOUNT_ID)')
  if (provider.cors === 'configurable' && !base) {
    const envName = (BASE_ENV[provider.id] ?? ['a base URL'])[0]
    console.log(`skip: self-hosted provider — set ${envName} to smoke-test it`)
    continue
  }
  const timedFetch = (signal) => (url, init = {}) => fetch(url, { ...init, signal })

  let model = forcedModel || (MODEL_ENV[provider.id] ?? []).map((n) => process.env[n]).find(Boolean) || ''
  let discovered = []
  if (provider.discovery) {
    try {
      const result = await withTimeout((signal) => {
        return discoverProviderModels(provider, endpoint, timedFetch(signal))
      }, timeoutMs)
      discovered = result.entries
      console.log(`discover: ${result.entries.length} models${result.stale ? ' (stale cache)' : ''}${result.cached ? ' (304 cache)' : ''}${result.error ? ` · ${result.error}` : ''}`)
      if (result.error && key) failures++
      if (!model && discovered.length) model = discovered[0].id
    } catch (error) {
      failures++
      console.log(`discover: FAILED · ${error?.message || error}`)
    }
  } else {
    console.log('discover: not available (enter a model id manually)')
  }

  try {
    const cors = await withTimeout((signal) => {
      return probeProviderCors(provider, endpoint, { fetchFn: timedFetch(signal) })
    }, timeoutMs)
    console.log(`cors: ${cors.ok ? 'ALLOWED' : 'BLOCKED'} · HTTP ${cors.status}${cors.allowOrigin ? ` · ACAO ${cors.allowOrigin}` : ''}${cors.error ? ` · ${cors.error}` : ''}`)
  } catch (error) {
    console.log(`cors: failed · ${error?.message || error}`)
  }

  if (!model) {
    console.log('stream: skipped (no model id)')
    continue
  }
  if (provider.authRequired && !key) {
    console.log(`stream: skipped (set ${(KEY_ENV[provider.id] ?? ['a key'])[0]})`)
    continue
  }
  let text = ''
  try {
    const result = await withTimeout((signal) => streamChatCompletion(provider, {
      endpoint,
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      maxTokens: 24,
      signal,
    }, (chunk) => { text += chunk }), timeoutMs)
    console.log(`stream: OK · ${result.text.length} chars${result.fallback ? ' (non-streaming fallback)' : ''}${result.truncated ? ' · truncated cleanly' : ''} · ${JSON.stringify(result.text.slice(0, 80))}`)
  } catch (error) {
    failures++
    console.log(`stream: FAILED · ${error?.message || error}`)
  }
  if (!text && discovered.length) console.log('stream: no text received; discovery succeeded so the key/model may be wrong')
}

if (only && !PROVIDERS.some((p) => p.id === only || p.preset.toLowerCase() === only.toLowerCase())) {
  console.error(`Unknown provider "${only}". Known: ${PROVIDERS.map((p) => p.id).join(', ')}`)
  process.exitCode = 2
} else if (failures) {
  process.exitCode = 1
}
