import test from 'node:test'
import assert from 'node:assert/strict'

const { parseModelProviders, fetchModelProviders } = await import('./catalog.ts')
const { buildStreamRequest } = await import('./streamRequest.ts')

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
  await fetchModelProviders('deepseek/deepseek-r1:free', { url: 'https://openrouter.ai/api/v1' }, fetchFn)
  assert.equal(seen[0], 'https://openrouter.ai/api/v1/models/deepseek/deepseek-r1/endpoints')

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
