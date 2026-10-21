import test from 'node:test'
import assert from 'node:assert/strict'

const { fetchModelCatalog, parseCatalogModels, catalogProviderOf } = await import('./catalog.ts')

const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('parseCatalogModels keeps the OpenRouter per-token price default', () => {
  const [entry] = parseCatalogModels({
    data: [{ id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o', context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001', input_cache_read: '0.00000125' }, supported_parameters: ['reasoning'] }],
  })
  assert.equal(entry.id, 'openai/gpt-4o')
  assert.equal(entry.name, 'GPT-4o')
  assert.equal(entry.context, 128000)
  assert.equal(entry.inputPrice, 2.5)
  assert.equal(entry.outputPrice, 10)
  assert.equal(entry.cacheReadPrice, 1.25)
  // Evidence of reasoning support without explicit effort levels stays manual.
  assert.equal(entry.source, 'manual')
})

test('Anthropic uses native headers, paginates, and never sends an OpenAI bearer token', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    if (calls.length === 1) return json({ data: [{ id: 'claude-a', display_name: 'Claude A' }], has_more: true, last_id: 'claude-a' })
    return json({ data: [{ id: 'claude-b', display_name: 'Claude B' }], has_more: false })
  }
  const result = await fetchModelCatalog({ url: 'https://api.anthropic.com/v1', key: 'sk-ant', preset: 'Anthropic', endpointId: 'anthropic' }, fetchFn)
  assert.equal(result.source, 'provider')
  assert.deepEqual(result.entries.map((x) => x.id), ['claude-a', 'claude-b'])
  assert.deepEqual(result.entries.map((x) => x.name), ['Claude A', 'Claude B'])
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant')
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01')
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.match(calls[0].url, /\/v1\/models\?limit=1000$/)
  assert.match(calls[1].url, /after_id=claude-a/)
})

test('Google uses the native models endpoint and normalizes names, ids, and token limits', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return json({ models: [
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/text-embedding-004', displayName: 'Text Embedding', inputTokenLimit: 2048, supportedGenerationMethods: ['embedContent'] },
    ] })
  }
  const result = await fetchModelCatalog({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/', key: 'AIza-test', preset: 'Google', endpointId: 'google' }, fetchFn)
  assert.equal(result.source, 'provider')
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-test')
  assert.deepEqual(result.entries, [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', efforts: [], source: 'manual', providerId: 'google', context: 1048576 },
  ])
})

test('xAI prices are converted from cents per 100M tokens and efforts are read', async () => {
  const fetchFn = async () => json({ data: [{
    id: 'grok-4',
    owned_by: 'xai',
    context_length: 256000,
    prompt_text_token_price: 20000,
    completion_text_token_price: 80000,
    cached_prompt_text_token_price: 2000,
    capabilities: { reasoning_effort: ['low', 'medium', 'high'] },
  }] })
  const result = await fetchModelCatalog({ url: 'https://api.x.ai/v1', key: 'xai-key', preset: 'xAI', endpointId: 'xai' }, fetchFn)
  assert.equal(result.source, 'provider')
  assert.deepEqual(result.entries[0], {
    id: 'grok-4', name: '', providerId: 'xai', efforts: ['low', 'medium', 'high'], source: 'auto',
    context: 256000, inputPrice: 2, outputPrice: 8, cacheReadPrice: 0.2,
  })
})

test('Together prices stay per-million and cached input is kept', async () => {
  const fetchFn = async () => json([{
    id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    display_name: 'Llama 3.3 70B Instruct Turbo',
    organization: 'Meta',
    context_length: 131072,
    pricing: { input: 0.88, output: 0.88, cached_input: 0.18 },
  }])
  const result = await fetchModelCatalog({ url: 'https://api.together.xyz/v1', key: 't-key', preset: 'Together', endpointId: 'Together', endpointFilter: 'provider' }, fetchFn)
  assert.equal(result.source, 'provider')
  const entry = result.entries[0]
  assert.equal(entry.id, 'meta-llama/Llama-3.3-70B-Instruct-Turbo')
  assert.equal(entry.name, 'Llama 3.3 70B Instruct Turbo')
  assert.equal(entry.context, 131072)
  assert.equal(entry.inputPrice, 0.88)
  assert.equal(entry.outputPrice, 0.88)
  assert.equal(entry.cacheReadPrice, 0.18)
})

test('Mistral reads max_context_length from its native list', async () => {
  const fetchFn = async () => json({ data: [
    { id: 'mistral-large-latest', name: 'Mistral Large', max_context_length: 131072, capabilities: { completion_chat: true } },
  ] })
  const result = await fetchModelCatalog({ url: 'https://api.mistral.ai/v1', key: 'm-key', preset: 'Mistral', endpointId: 'mistralai' }, fetchFn)
  assert.equal(result.source, 'provider')
  assert.equal(result.entries[0].context, 131072)
  assert.equal(result.entries[0].inputPrice, undefined)
})

test('Ollama uses the native tags list and hydrates context from /api/show', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] })
    if (url.endsWith('/api/show')) return json({ model_info: { 'llama.context_length': 131072 } })
    return json({})
  }
  const result = await fetchModelCatalog({ url: 'http://localhost:11434/v1', preset: 'Ollama (local)', endpointId: 'ollama', endpointFilter: 'provider' }, fetchFn)
  assert.equal(result.source, 'provider')
  assert.deepEqual(result.entries, [{ id: 'llama3.2:latest', name: 'llama3.2:latest', efforts: [], source: 'manual', providerId: 'ollama', context: 131072 }])
  assert.equal(calls[0].url, 'http://localhost:11434/api/tags')
  assert.equal(calls[1].url, 'http://localhost:11434/api/show')
  assert.equal(calls[1].init.method, 'POST')
})

test('Perplexity has no native list, so the picker falls back to OpenRouter', async () => {
  const calls = []
  const fetchFn = async (url) => {
    calls.push(url)
    return json({ data: [{ id: 'perplexity/sonar', name: 'Sonar', context_length: 127072 }] })
  }
  const result = await fetchModelCatalog({ url: 'https://api.perplexity.ai', key: 'pplx', preset: 'Perplexity', endpointId: 'perplexity', name: 'Perplexity' }, fetchFn)
  assert.equal(result.source, 'openrouter')
  assert.deepEqual(calls, ['https://openrouter.ai/api/v1/models?model_authors=perplexity'])
  assert.equal(result.entries[0].id, 'perplexity/sonar')
})

test('OpenRouter stays direct and keeps its optional brand query', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return json({ data: [{ id: 'openai/gpt-4o', name: 'GPT-4o' }] })
  }
  const result = await fetchModelCatalog({ url: 'https://openrouter.ai/api/v1', key: 'or-key', preset: 'OpenRouter', endpointId: 'openai' }, fetchFn)
  assert.equal(result.source, 'openrouter')
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/models?model_authors=openai')
  assert.equal(calls[0].init.headers.authorization, 'Bearer or-key')
})

test('unknown OpenAI-compatible servers are listed directly before public fallbacks', async () => {
  const calls = []
  const fetchFn = async (url) => {
    calls.push(url)
    return json({ data: [{ id: 'local-model', owned_by: 'local' }] })
  }
  const result = await fetchModelCatalog({ url: 'https://llm.example.com/v1', key: 'k' }, fetchFn)
  assert.equal(result.source, 'provider')
  assert.deepEqual(calls, ['https://llm.example.com/v1/models'])
  assert.equal(result.entries[0].id, 'local-model')
})

test('catalogProviderOf recognizes presets and legacy URLs', () => {
  assert.equal(catalogProviderOf({ preset: 'Anthropic' }), 'anthropic')
  assert.equal(catalogProviderOf({ preset: 'Perplexity' }), null)
  assert.equal(catalogProviderOf({ url: 'https://api.groq.com/openai/v1' }), 'groq')
  assert.equal(catalogProviderOf({ url: 'http://localhost:11434/v1' }), 'ollama')
  assert.equal(catalogProviderOf({ url: 'https://api.perplexity.ai' }), null)
  assert.equal(catalogProviderOf({ url: 'https://example.com/v1' }), 'generic')
})
