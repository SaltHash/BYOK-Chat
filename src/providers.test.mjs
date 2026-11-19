import test from 'node:test'
import assert from 'node:assert/strict'

const { parseModelProviders, fetchModelProviders, providerTier } = await import('./catalog.ts')
const { buildStreamRequest, tieredModelId } = await import('./streamRequest.ts')

const jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('parseModelProviders normalizes an OpenRouter endpoints payload', () => {
  const providers = parseModelProviders({ data: { endpoints: [
    { provider_name: 'Amazon Bedrock', tag: 'amazon-bedrock', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003' }, throughput_last_30m: 84.7, quantization: 'fp8' },
    { provider_name: 'Google | some/model', tag: 'google-vertex/us-east5', context_length: 0, pricing: {} },
    { provider_name: 'No tag here' },
  ] } })
  assert.equal(providers.length, 2)
  assert.deepEqual(providers[0], { tag: 'amazon-bedrock', name: 'Amazon Bedrock', context: 200000, inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, throughput: 84.7, quantization: 'fp8' })
  // Missing/invalid numbers are omitted rather than stored as 0.
  assert.deepEqual(providers[1], { tag: 'google-vertex/us-east5', name: 'Google' })
  assert.deepEqual(parseModelProviders({ data: {} }), [])
  assert.deepEqual(parseModelProviders(null), [])
})

test('tier endpoints carry their service tier and the provider word for it', () => {
  const providers = parseModelProviders({ data: { endpoints: [
    { provider_name: 'OpenAI', tag: 'openai/fast', service_tier: 'priority', pricing: { prompt: '0.000004', completion: '0.00002' } },
    { provider_name: 'OpenAI', tag: 'openai/flex', service_tier: 'flex' },
    { provider_name: 'Groq', tag: 'groq/ultrafast', service_tier: 'ultrafast' },
    { provider_name: 'DeepInfra', tag: 'deepinfra/turbo' },
    { provider_name: 'OpenAI', tag: 'openai' },
    { provider_name: 'Google', tag: 'google-vertex/us-east5' },
  ] } })
  assert.equal(providers[0].tierLabel, 'Fast')
  assert.equal(providers[1].tier, 'flex')
  assert.equal(providers[1].tierLabel, 'Flex')
  assert.equal(providers[2].tier, 'ultrafast')
  assert.equal(providers[3].tier, 'priority')
  assert.equal(providers[3].tierLabel, 'Turbo')
  assert.equal(providers[4].tier, undefined)
  assert.equal(providers[5].tier, undefined)
  // Prices keep the precision a cheap model needs.
  assert.equal(providers[0].inputPrice, 4)
  assert.equal(providerTier('scale', 'x/scale').tier, 'other')
  assert.deepEqual(providerTier(null, 'openai'), {})
})

test('sub-cent prices keep up to four decimals', () => {
  const providers = parseModelProviders({ data: { endpoints: [
    { provider_name: 'Cheap', tag: 'cheap', pricing: { prompt: '0.00000125', completion: '0.0000000375' } },
  ] } })
  assert.equal(providers[0].inputPrice, 1.25)
  assert.equal(providers[0].outputPrice, 0.0375)
})

test('fetchModelProviders queries OpenRouter endpoints and forwards the key', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return jsonResponse({ data: { endpoints: [{ provider_name: 'Amazon Bedrock', tag: 'amazon-bedrock' }] } })
  }
  const { providers, error } = await fetchModelProviders('anthropic/claude-sonnet-4.5', { url: 'https://openrouter.ai/api/v1', key: 'sk-test' }, fetchFn)
  assert.equal(error, undefined)
  assert.deepEqual(providers, [{ tag: 'amazon-bedrock', name: 'Amazon Bedrock' }])
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-4.5/endpoints')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
})

test('fetchModelProviders strips OpenRouter routing variants and rejects non-OpenRouter bases', async () => {
  const seen = []
  const fetchFn = async (url) => { seen.push(url); return jsonResponse({ data: { endpoints: [] } }) }
  // A routing variant is dropped; the catalog variant (`:free`) is kept,
  // because it names a different entry with its own endpoints.
  await fetchModelProviders('deepseek/deepseek-r1:free:nitro', { url: 'https://openrouter.ai/api/v1' }, fetchFn)
  assert.equal(seen[0], 'https://openrouter.ai/api/v1/models/deepseek/deepseek-r1:free/endpoints')

  const off = await fetchModelProviders('anthropic/claude-sonnet-4.5', { url: 'https://api.openai.com/v1' }, fetchFn)
  assert.equal(off.providers.length, 0)
  assert.match(off.error, /OpenRouter/)
})

test('buildStreamRequest pins an OpenRouter model to its chosen provider', () => {
  const base = { id: 'e1', name: 'OR', type: 'openai', url: 'https://openrouter.ai/api/v1', key: 'k', model: 'anthropic/claude-sonnet-4.5', on: true }
  const pinned = buildStreamRequest({ ...base, modelProviders: { 'anthropic/claude-sonnet-4.5': { tag: 'amazon-bedrock', name: 'Amazon Bedrock' } } }, '', [{ role: 'user', content: 'hi' }])
  assert.deepEqual(pinned.body.provider, { order: ['amazon-bedrock'], allow_fallbacks: false })

  // No pin -> OpenRouter's default routing (no provider field).
  const auto = buildStreamRequest(base, '', [{ role: 'user', content: 'hi' }])
  assert.equal(auto.body.provider, undefined)

  // A pin on a non-OpenRouter base must not leak the OpenRouter-only field.
  const other = buildStreamRequest({ ...base, url: 'https://api.openai.com/v1', modelProviders: { 'anthropic/claude-sonnet-4.5': { tag: 'amazon-bedrock', name: 'Amazon Bedrock' } } }, '', [{ role: 'user', content: 'hi' }])
  assert.equal(other.body.provider, undefined)
})

test('an OpenRouter routing tier rides on the model id as a variant suffix', () => {
  const base = { id: 'e1', name: 'OR', type: 'openai', url: 'https://openrouter.ai/api/v1', key: 'k', model: 'openai/gpt-5', on: true }
  const tiered = (tier, e = base) => buildStreamRequest({ ...e, modelTiers: { 'openai/gpt-5': tier } }, '', [{ role: 'user', content: 'hi' }]).body.model
  assert.equal(tiered('nitro'), 'openai/gpt-5:nitro')
  assert.equal(tiered('floor'), 'openai/gpt-5:floor')
  // Standard routing and non-OpenRouter bases send the bare id.
  assert.equal(tiered(undefined), 'openai/gpt-5')
  assert.equal(tiered('nitro', { ...base, url: 'https://api.openai.com/v1' }), 'openai/gpt-5')
  // A variant already on the id is kept rather than doubled, and a tier is
  // refused when it is not one OpenRouter defines.
  assert.equal(tieredModelId('openai/gpt-5:floor', 'nitro'), 'openai/gpt-5:floor')
  // Free endpoints have no priority/flex tier to admit, so no tier is sent.
  assert.equal(tieredModelId('openai/gpt-5:free', 'floor'), 'openai/gpt-5:free')
  assert.equal(tieredModelId('openai/gpt-5', undefined), 'openai/gpt-5')
})
