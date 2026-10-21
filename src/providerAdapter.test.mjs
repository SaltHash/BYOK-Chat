import test from 'node:test'
import assert from 'node:assert/strict'

const {
  PROVIDERS, resolveProvider, providerBaseUrl, providerHeaders, providerModelsUrl,
  createSseParser, parseSseData, readChatStream, streamChatCompletion, chatCompletion,
  buildChatRequest, mapProviderError, mapNetworkError,
  discoverProviderModels, clearProviderDiscoveryCache, filterChatModels, probeProviderCors,
  providerPresetEntries,
} = await import('./providerAdapter.ts')
const { buildStreamRequest } = await import('./streamRequest.ts')

const json = (value, init = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...init })

const sseResponse = (chunks, init = {}) => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    controller.close()
  },
}), { headers: { 'content-type': 'text/event-stream' }, ...init })

const chunk = (id, text, extra = '') =>
  `data: ${JSON.stringify({ id, choices: [{ delta: { content: text } }] })}${extra}\n\n`

test('resolveProvider understands ids, preset labels, and hosts', () => {
  assert.equal(resolveProvider('openrouter').id, 'openrouter')
  assert.equal(resolveProvider('The Grid').id, 'thegrid')
  assert.equal(resolveProvider({ preset: 'CompactifAI' }).id, 'compactifai')
  assert.equal(resolveProvider({ url: 'https://api.aimlapi.com/v1' }).id, 'aimlapi')
  assert.equal(resolveProvider({ url: 'https://router.requesty.ai/v1' }).id, 'requesty')
  assert.equal(resolveProvider({ url: 'https://router.eu.requesty.ai/v1' }).id, 'requesty')
  assert.equal(resolveProvider({ url: 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1' }).id, 'cloudflare')
  assert.equal(resolveProvider({ url: 'https://example.com/v1' }), undefined)
})

test('every registry entry is config-only and complete', () => {
  for (const provider of PROVIDERS) {
    assert.ok(provider.id && provider.name && provider.preset)
    assert.match(provider.baseURL, /^https?:\/\//)
    assert.match(provider.chatPath, /^\//)
    assert.ok(provider.authHeader)
    assert.ok(['confirmed', 'unverified', 'blocked', 'configurable'].includes(provider.cors))
  }
})

test('preset entries become label → [type, url, endpointId, filter] rows', () => {
  const presets = Object.fromEntries(providerPresetEntries())
  assert.deepEqual(presets['OpenRouter'], ['openai', 'https://openrouter.ai/api/v1', '', 'author'])
  assert.deepEqual(presets['Vercel AI Gateway'], ['openai', 'https://ai-gateway.vercel.sh/v1', 'vercel', 'author'])
  assert.deepEqual(presets['Cloudflare Workers AI'], ['openai', 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1', 'cloudflare', 'author'])
})

test('Portkey authenticates with x-portkey-api-key, never Authorization', () => {
  const provider = resolveProvider('portkey')
  const headers = providerHeaders(provider, { key: 'pk-secret' })
  assert.equal(headers['x-portkey-api-key'], 'pk-secret')
  assert.equal(headers.authorization, undefined)
  const req = buildChatRequest(provider, { endpoint: { key: 'pk-secret' }, model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(req.url, 'https://api.portkey.ai/v1/chat/completions')
  assert.equal(req.init.headers['x-portkey-api-key'], 'pk-secret')
})

test('Cloudflare builds the account-scoped URL and sends the gateway header', () => {
  const provider = resolveProvider('cloudflare')
  const endpoint = { key: 'cf-token', accountId: 'acct-123', gatewayId: 'gw-456' }
  const req = buildChatRequest(provider, { endpoint, model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(req.url, 'https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1/chat/completions')
  assert.equal(req.init.headers.authorization, 'Bearer cf-token')
  assert.equal(req.init.headers['cf-aig-gateway-id'], 'gw-456')
})

test('Cloudflare account ID is extracted from a pasted URL', () => {
  const provider = resolveProvider('cloudflare')
  const base = providerBaseUrl(provider, { url: 'https://api.cloudflare.com/client/v4/accounts/from-url/ai/v1' })
  assert.equal(base, 'https://api.cloudflare.com/client/v4/accounts/from-url/ai/v1')
})

test('The Grid follows redirects explicitly', () => {
  const provider = resolveProvider('thegrid')
  const req = buildChatRequest(provider, { endpoint: { key: 'grid-key' }, model: 'text-prime', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(req.init.redirect, 'follow')
  assert.equal(req.url, 'https://api.thegrid.ai/v1/chat/completions')
})

test('SSE parser handles split chunks, CRLF, DONE, and malformed data', () => {
  const parser = createSseParser()
  assert.deepEqual(parser.push('data: {"a"'), [])
  assert.deepEqual(parser.push(':1}\r\ndata: [DONE\r\n').map((e) => e.data), ['{"a":1}', '[DONE'])
  assert.deepEqual(parser.end(), [])

  assert.deepEqual(parseSseData('[DONE]'), { done: true })
  assert.deepEqual(parseSseData(''), { done: false })
  assert.equal(parseSseData('{"choices":[]}').data, '{"choices":[]}')
  assert.equal(parseSseData('{not json').malformed, true)
})

test('readChatStream streams deltas, stops at DONE, and reports truncation cleanly', async () => {
  const provider = resolveProvider('openrouter')
  let text = ''
  const normal = await readChatStream(provider, sseResponse([
    chunk('1', 'Hel'),
    chunk('2', 'lo'),
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ]), (t) => { text += t })
  assert.equal(normal.text, 'Hello')
  assert.equal(text, 'Hello')
  assert.equal(normal.done, true)
  assert.equal(normal.truncated, false)
  assert.equal(normal.finish, 'stop')

  let fallbackText = ''
  const truncated = await readChatStream(provider, sseResponse([chunk('1', 'partial')]), (t) => { fallbackText += t })
  assert.equal(truncated.text, 'partial')
  assert.equal(fallbackText, 'partial')
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.done, false)

  let malformedText = ''
  const malformed = await readChatStream(provider, sseResponse([
    'data: {broken json\n\n',
    chunk('1', 'still here'),
    'data: [DONE]\n\n',
  ]), (t) => { malformedText += t })
  assert.equal(malformed.malformed, 1)
  assert.equal(malformedText, 'still here')

  let keep = ''
  const kept = await readChatStream(provider, sseResponse([chunk('1', 'almost'), chunk('2', ' finished')]), (t) => { keep += t })
  assert.equal(kept.text, 'almost finished')
  assert.equal(kept.truncated, true)
  assert.equal(keep, 'almost finished')
})

test('streamChatCompletion falls back to a non-streaming request when no text arrived', async () => {
  const provider = resolveProvider('openrouter')
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push(JSON.parse(init.body))
    if (calls.length === 1) return sseResponse(['data: {not json\n\n'])
    return json({ choices: [{ message: { content: 'from fallback' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })
  }
  const result = await streamChatCompletion(provider, {
    endpoint: { key: 'sk-test' },
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
  }, () => {}, fetchFn)
  assert.equal(result.text, 'from fallback')
  assert.equal(result.fallback, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].stream, true)
  assert.equal(calls[1].stream, false)
})

test('mapProviderError names the provider and the auth problem', () => {
  const provider = resolveProvider('cloudflare')
  const auth = mapProviderError(provider, 401, JSON.stringify({ errors: [{ code: 10000, message: 'Authentication error' }] }), { hasKey: true, key: 'cf-secret' })
  assert.equal(auth.code, 'upstream_auth')
  assert.match(auth.message, /Cloudflare Workers AI/)
  assert.match(auth.message, /Workers AI → Read/)
  assert.doesNotMatch(auth.message, /cf-secret/)

  const noKey = mapProviderError(resolveProvider('portkey'), 403, '', { hasKey: false })
  assert.match(noKey.message, /Portkey/)
  assert.match(noKey.message, /no API key/)

  const rate = mapProviderError(resolveProvider('requesty'), 429, '', { headers: { 'retry-after': '7' } })
  assert.equal(rate.code, 'rate_limited')
  assert.match(rate.message, /Requesty/)
  assert.match(rate.message, /rate limit or quota/)
  assert.match(rate.message, /7 seconds/)
  assert.equal(rate.retryable, false)

  const server = mapProviderError(resolveProvider('thegrid'), 503, 'upstream down')
  assert.equal(server.code, 'upstream_unavailable')
  assert.equal(server.retryable, true)
  assert.match(server.message, /The Grid/)

  const bad = mapProviderError(resolveProvider('aimlapi'), 400, '{"error":{"message":"bad model"}}')
  assert.equal(bad.code, 'bad_request')
  assert.match(bad.message, /provider-side request error/)

  const redirect = mapProviderError(resolveProvider('thegrid'), 307, '')
  assert.equal(redirect.code, 'bad_response')
  assert.match(redirect.message, /redirect/)
})

test('mapNetworkError mentions CORS for browser-blocked providers', () => {
  const mapped = mapNetworkError(resolveProvider('cloudflare'), 'https://api.cloudflare.com/client/v4/accounts/a/ai/v1/chat/completions')
  assert.equal(mapped.code, 'cors')
  assert.match(mapped.message, /Cloudflare Workers AI/)
  assert.match(mapped.message, /proxy/)
})

test('CompactifAI discovery filters models whose capabilities say they cannot chat', async () => {
  clearProviderDiscoveryCache()
  const provider = resolveProvider('compactifai')
  const fetchFn = async () => json({ data: [
    { id: 'chat-model', capabilities: { supports_messages: true } },
    { id: 'image-only', capabilities: { supports_messages: false, supports_image: true } },
    { id: 'unknown-caps' },
  ] })
  const found = await discoverProviderModels(provider, { key: 'c-key' }, fetchFn)
  assert.deepEqual(found.entries.map((x) => x.id), ['chat-model', 'unknown-caps'])
  assert.equal(filterChatModels(provider, found.entries).length, 2)
})

test('discovery keeps chat-capable types and dedupes repeated ids', async () => {
  clearProviderDiscoveryCache()
  const vercel = resolveProvider('vercel')
  const v = await discoverProviderModels(vercel, {}, async () => json({ data: [
    { id: 'openai/gpt-6', type: 'language' },
    { id: 'openai/embed', type: 'embedding' },
    { id: 'untyped' },
  ] }))
  assert.deepEqual(v.entries.map((x) => x.id), ['openai/gpt-6', 'untyped'])

  clearProviderDiscoveryCache()
  const aiml = resolveProvider('aimlapi')
  const a = await discoverProviderModels(aiml, { key: 'k' }, async () => json({ data: [
    { id: 'm1', type: 'openai/chat-completions' },
    { id: 'm1', type: 'anthropic/messages' },
    { id: 'img', type: 'openai/image-generations' },
  ] }))
  assert.deepEqual(a.entries.map((x) => x.id), ['m1'])
})

test('AI/ML API honors ETag, 304 uses the cached list, and single lookup stays outside /v1', async () => {
  clearProviderDiscoveryCache()
  const provider = resolveProvider('aimlapi')
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers })
    if (calls.length === 1) return json({ data: [{ id: 'gpt-4o-mini', context_length: 128000 }] }, { headers: { 'content-type': 'application/json', etag: '"abc"' } })
    return new Response(null, { status: 304, headers: { etag: '"abc"' } })
  }
  const first = await discoverProviderModels(provider, { key: 'k' }, fetchFn)
  assert.deepEqual(first.entries.map((x) => x.id), ['gpt-4o-mini'])
  assert.equal(first.etag, '"abc"')
  const second = await discoverProviderModels(provider, { key: 'k' }, fetchFn)
  assert.equal(second.cached, true)
  assert.deepEqual(second.entries.map((x) => x.id), ['gpt-4o-mini'])
  assert.equal(calls[1].headers['if-none-match'], '"abc"')
  const { providerSingleModelUrl } = await import('./providerRegistry.ts')
  assert.equal(providerSingleModelUrl(provider, {}, 'gpt-4o-mini'), 'https://api.aimlapi.com/model/gpt-4o-mini')
})

test('a failed discovery keeps the last known list and marks it stale', async () => {
  clearProviderDiscoveryCache()
  const provider = resolveProvider('thegrid')
  let mode = 'ok'
  const fetchFn = async () => {
    if (mode === 'ok') return json({ data: [{ id: 'text-prime' }] })
    return new Response('nope', { status: 500 })
  }
  const first = await discoverProviderModels(provider, { key: 'grid' }, fetchFn)
  assert.deepEqual(first.entries.map((x) => x.id), ['text-prime'])
  mode = 'fail'
  const second = await discoverProviderModels(provider, { key: 'grid' }, fetchFn)
  assert.equal(second.stale, true)
  assert.deepEqual(second.entries.map((x) => x.id), ['text-prime'])
  assert.match(second.error, /The Grid/)
})

test('providers without discovery explain the manual path instead of falling back', async () => {
  const provider = resolveProvider('cloudflare')
  const found = await discoverProviderModels(provider, { accountId: 'a' })
  assert.deepEqual(found.entries, [])
  assert.match(found.error, /Cloudflare Workers AI/)
  assert.match(found.error, /manually/)
})

test('Requesty appends smart-task and Inworld appends auto', async () => {
  clearProviderDiscoveryCache()
  const requesty = resolveProvider('requesty')
  const inworld = resolveProvider('inworld')
  const fetchFn = async () => json({ data: [{ id: 'approved-model' }] })
  const r = await discoverProviderModels(requesty, { key: 'k' }, fetchFn)
  clearProviderDiscoveryCache('inworld')
  const i = await discoverProviderModels(inworld, { key: 'k' }, fetchFn)
  assert.deepEqual(r.entries.map((x) => x.id), ['smart-task', 'approved-model'])
  assert.deepEqual(i.entries.map((x) => x.id), ['auto', 'approved-model'])
})

test('Inworld discovery uses its real list endpoint, Basic auth, and prefixed ids', async () => {
  clearProviderDiscoveryCache()
  const inworld = resolveProvider('inworld')
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers })
    return json({ models: [
      { model: 'gemini-2.5-flash', provider: 'google', modelCreator: 'Google', pricing: { promptToken: 3e-7, completionToken: 2.5e-6 }, spec: { contextLength: 1048576 } },
      { model: 'models/gemma-4-26b', provider: 'inworld', modelCreator: 'Inworld' },
    ] })
  }
  const found = await discoverProviderModels(inworld, { key: 'base64-credential' }, fetchFn)
  assert.equal(calls[0].url, 'https://api.inworld.ai/llm/v1alpha/models')
  assert.equal(calls[0].headers.authorization, 'Basic base64-credential')
  assert.deepEqual(found.entries.map((x) => x.id), ['auto', 'google/gemini-2.5-flash', 'inworld/models/gemma-4-26b'])
  const gemini = found.entries.find((x) => x.id === 'google/gemini-2.5-flash')
  assert.equal(gemini.context, 1048576)
  assert.equal(gemini.inputPrice, 0.3)
  assert.equal(gemini.outputPrice, 2.5)
})

test('probeProviderCors reports the origin decision from the preflight response', async () => {
  const provider = resolveProvider('openrouter')
  const allowed = await probeProviderCors(provider, {}, {
    origin: 'https://app.example',
    fetchFn: async () => new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' } }),
  })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.allowOrigin, '*')

  // Browsers hide Access-Control-* headers from page JS; a resolved preflight
  // still means the origin was allowed.
  const opaque = await probeProviderCors(provider, {}, {
    origin: 'https://app.example',
    fetchFn: async () => new Response(null, { status: 200 }),
  })
  assert.equal(opaque.ok, true)
  assert.equal(opaque.allowOrigin, '')

  const rejected = await probeProviderCors(resolveProvider('cloudflare'), { accountId: 'a' }, {
    origin: 'https://app.example',
    fetchFn: async () => new Response(null, { status: 405 }),
  })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /Cloudflare Workers AI/)
})

test('the real send flow follows The Grid redirect and uses provider auth headers', () => {
  const ep = (patch) => ({ id: 'e', name: 'E', type: 'openai', url: '', key: '', model: 'm', on: true, ...patch })
  const msgs = [{ role: 'user', content: 'hi' }]

  const grid = buildStreamRequest(ep({ preset: 'The Grid', url: 'https://api.thegrid.ai/v1', key: 'gk', model: 'text-prime' }), '', msgs)
  assert.equal(grid.url, 'https://api.thegrid.ai/v1/chat/completions')
  assert.equal(grid.redirect, 'follow')

  const portkey = buildStreamRequest(ep({ preset: 'Portkey', url: 'https://api.portkey.ai/v1', key: 'pk-secret' }), '', msgs)
  assert.equal(portkey.headers['x-portkey-api-key'], 'pk-secret')
  assert.equal(portkey.headers.authorization, undefined)

  const cloudflare = buildStreamRequest(ep({
    preset: 'Cloudflare Workers AI',
    url: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1',
    key: 'cf-token', accountId: 'acct-123', gatewayId: 'gw-456',
  }), '', msgs)
  assert.equal(cloudflare.url, 'https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1/chat/completions')
  assert.equal(cloudflare.headers.authorization, 'Bearer cf-token')
  assert.equal(cloudflare.headers['cf-aig-gateway-id'], 'gw-456')

  assert.throws(
    () => buildStreamRequest(ep({
      preset: 'Cloudflare Workers AI',
      url: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1',
      key: 'cf-token',
    }), '', msgs),
    /needs an Account ID/,
  )
})

test('AIHubMix resolves by preset and host and uses Bearer auth', () => {
  assert.equal(resolveProvider('AIHubMix').id, 'aihubmix')
  assert.equal(resolveProvider({ url: 'https://aihubmix.com/v1' }).id, 'aihubmix')
  const provider = resolveProvider('aihubmix')
  assert.equal(providerModelsUrl(provider), 'https://aihubmix.com/v1/models')
  const headers = providerHeaders(provider, { key: 'mix-key' })
  assert.equal(headers.authorization, 'Bearer mix-key')
  const req = buildChatRequest(provider, { endpoint: { key: 'mix-key' }, model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(req.url, 'https://aihubmix.com/v1/chat/completions')
})

test('AIHubMix discovery lists the gateway models with their upstream owner', async () => {
  clearProviderDiscoveryCache()
  const provider = resolveProvider('aihubmix')
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers })
    return json({ data: [
      { id: 'gpt-4o-mini', owned_by: 'OpenAI' },
      { id: 'claude-sonnet-5', owned_by: 'Anthropic' },
    ] })
  }
  const found = await discoverProviderModels(provider, { key: 'mix-key' }, fetchFn)
  assert.equal(calls[0].url, 'https://aihubmix.com/v1/models')
  assert.equal(calls[0].headers.authorization, 'Bearer mix-key')
  assert.deepEqual(found.entries.map((x) => x.id), ['gpt-4o-mini', 'claude-sonnet-5'])
  assert.equal(found.entries[0].providerId, 'OpenAI')
})

test('the real send flow reaches AIHubMix over both wire formats', () => {
  const ep = (patch) => ({ id: 'e', name: 'E', type: 'openai', url: '', key: '', model: 'm', on: true, ...patch })
  const msgs = [{ role: 'user', content: 'hi' }]

  const openai = buildStreamRequest(ep({
    preset: 'AIHubMix', url: 'https://aihubmix.com/v1', key: 'mix-key', model: 'gpt-4o-mini',
  }), '', msgs)
  assert.equal(openai.url, 'https://aihubmix.com/v1/chat/completions')
  assert.equal(openai.headers.authorization, 'Bearer mix-key')

  // AIHubMix also speaks the Anthropic Messages protocol, which authenticates
  // with x-api-key instead of a bearer token.
  const anthropic = buildStreamRequest(ep({
    preset: 'AIHubMix', type: 'anthropic', url: 'https://aihubmix.com/v1', key: 'mix-key', model: 'claude-sonnet-5',
  }), '', msgs)
  assert.equal(anthropic.url, 'https://aihubmix.com/v1/messages')
  assert.equal(anthropic.headers['x-api-key'], 'mix-key')
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01')
})

test('chatCompletion maps non-OK responses through the provider mapper', async () => {
  const provider = resolveProvider('portkey')
  await assert.rejects(
    () => chatCompletion(provider, { endpoint: { key: 'pk' }, model: 'm', messages: [{ role: 'user', content: 'hi' }] }, async () => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 })),
    /Portkey.*API key/s,
  )
})
