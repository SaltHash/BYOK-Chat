import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedInt, selectResults, normalizeProvider, providerNeedsKey, classifyUpstream, buildApiRequest, parseApiResponse, runApiSearch, apiKeyFor, resolveApiKey, resolveZone } from './search.mjs'

test('normalizes, deduplicates and favors distinct high-scoring sources', () => {
  const results = selectResults([
    { title: 'A', url: 'https://one.example/page?utm_source=x#part', content: 'one', score: 10 },
    { title: 'A duplicate', url: 'https://one.example/page', content: 'duplicate', score: 9 },
    { title: 'B', url: 'https://two.example/story', content: 'two', score: 8, engine: 'test' },
  ])
  assert.deepEqual(results.map((x) => x.id), ['S1', 'S2'])
  assert.deepEqual(results.map((x) => x.url), ['https://one.example/page', 'https://two.example/story'])
  assert.equal(results[1].engine, 'test')
})

test('enforces result and per-result snippet limits without a total cap', () => {
  const results = selectResults(Array.from({ length: 10 }, (_, i) => ({
    title: `Result ${i}`, url: `https://site${i}.example/${i}`, content: 'x'.repeat(1000), score: 10 - i,
  })), { maxResults: 2, maxSnippetChars: 120 })
  assert.equal(results.length, 2)
  assert.ok(results.every((x) => x.snippet.length <= 120))
})

test('returns no selected results for malformed search result collections', () => {
  assert.deepEqual(selectResults(null), [])
  assert.deepEqual(selectResults([{ title: 'bad URL', url: 'javascript:alert(1)', content: 'x' }]), [])
})

test('bounds configurable integer settings', () => {
  assert.equal(boundedInt('99', 8, 1, 8), 8)
  assert.equal(boundedInt('0', 8, 1, 8), 1)
  assert.equal(boundedInt('invalid', 8, 1, 8), 8)
  // Absent/blank/boolean tuning values keep the default instead of clamping to 0/1.
  assert.equal(boundedInt(undefined, 8, 1, 8), 8)
  assert.equal(boundedInt(null, 8, 1, 8), 8)
  assert.equal(boundedInt('', 8, 1, 8), 8)
  assert.equal(boundedInt(true, 8, 1, 8), 8)
  assert.equal(boundedInt(0, 8, 1, 8), 1)
})

test('normalizes provider aliases', () => {
  assert.equal(normalizeProvider('TinyFish'), 'tinyfish')
  assert.equal(normalizeProvider('you.com'), 'you')
  assert.equal(normalizeProvider('exa.ai'), 'exa')
  assert.equal(normalizeProvider('Firecrawl'), 'firecrawl')
  assert.equal(normalizeProvider('Bright Data'), 'brightdata')
  assert.equal(normalizeProvider('jina.ai'), 'jina')
  assert.equal(normalizeProvider('Jina AI'), 'jina')
})

test('Jina AI searches work with or without a key', () => {
  assert.equal(normalizeProvider('jina'), 'jina')
  // Jina Search runs keyless at a lower rate limit, so no key is not an error.
  assert.equal(providerNeedsKey('jina'), false)
  const anon = buildApiRequest('jina', 'hello world', { apiKey: '' })
  assert.match(anon.url, /s\.jina\.ai\/\?q=hello\+world/)
  assert.equal(anon.options.headers.Authorization, undefined)
  const keyed = buildApiRequest('jina', 'hello', { apiKey: 'jk' })
  assert.match(String(keyed.options.headers.Authorization), /^Bearer jk$/)
})

test('parses Jina AI search results into grounded sources', () => {
  const rows = parseApiResponse('jina', { code: 200, data: [
    { title: 'J', url: 'https://j.example/', description: 'jd', content: 'jc' },
    { title: 'K', url: 'https://k.example/', description: 'kd' },
  ] })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].url, 'https://j.example/')
  assert.equal(rows[0].engine, 'jina.ai')
  assert.match(rows[0].content, /jd/)
  assert.match(rows[0].content, /jc/)
  assert.deepEqual(parseApiResponse('jina', { data: 'nope' }), [])
})

test('builds authenticated API requests per provider', () => {
  const tiny = buildApiRequest('tinyfish', 'hello', { apiKey: 'k1' })
  assert.match(tiny.url, /api\.search\.tinyfish\.ai.*query=hello/)
  assert.equal(tiny.options.headers['X-API-Key'], 'k1')
  const you = buildApiRequest('you', 'hello', { apiKey: 'k2', count: 5 })
  assert.equal(JSON.parse(you.options.body).count, 5)
  assert.equal(you.options.headers['X-API-Key'], 'k2')
  const exa = buildApiRequest('exa', 'hello', { apiKey: 'k3', snippetChars: 900 })
  assert.equal(JSON.parse(exa.options.body).numResults, 8)
  assert.equal(JSON.parse(exa.options.body).contents.text.maxCharacters, 900)
  const fire = buildApiRequest('firecrawl', 'hello', { apiKey: 'k4' })
  assert.match(String(fire.options.headers.Authorization), /^Bearer k4$/)
  const bright = buildApiRequest('brightdata', 'pizza', { apiKey: 'k5', zone: 'z1' })
  assert.match(JSON.parse(bright.options.body).url, /google\.com\/search\?q=pizza/)
  assert.throws(() => buildApiRequest('tinyfish', 'x', { apiKey: '' }), /API key is missing/)
  assert.throws(() => buildApiRequest('brightdata', 'x', { apiKey: 'k', zone: '' }), /zone/i)
})

test('parses each provider response into normalized results', () => {
  assert.deepEqual(parseApiResponse('tinyfish', { results: [{ title: 'T', url: 'https://a.example/', snippet: 's' }] })[0].url, 'https://a.example/')
  const you = parseApiResponse('you', { results: { web: [{ title: 'Y', url: 'https://b.example/', description: 'd', snippets: ['s1'] }] } })
  assert.equal(you[0].engine, 'you.com')
  assert.match(you[0].content, /s1/)
  const exa = parseApiResponse('exa', { results: [{ title: 'E', url: 'https://c.example/', highlights: ['h1', 'h2'] }] })
  assert.match(exa[0].content, /h1/)
  const fire = parseApiResponse('firecrawl', { success: true, data: { web: [{ title: 'F', url: 'https://d.example/', description: 'desc' }] } })
  assert.equal(fire[0].engine, 'firecrawl')
  const bright = parseApiResponse('brightdata', { organic: [{ title: 'B', link: 'https://e.example/', description: 'bd' }] })
  assert.equal(bright[0].url, 'https://e.example/')
  assert.deepEqual(parseApiResponse('exa', null), [])
})

test('classifies upstream failures instead of masking them as generic errors', () => {
  const auth = classifyUpstream('tinyfish', 401, 'bad key')
  assert.equal(auth.code, 'upstream_auth')
  assert.equal(auth.retryable, false)
  assert.equal(auth.status, 401)
  assert.match(auth.message, /rejected the API key/)
  assert.equal(classifyUpstream('you', 402, 'payment_required').code, 'billing')
  assert.equal(classifyUpstream('you', 402, 'payment_required').retryable, false)
  assert.equal(classifyUpstream('exa', 429, '').code, 'rate_limited')
  assert.equal(classifyUpstream('exa', 429, '').retryable, true)
  const down = classifyUpstream('tinyfish', 503, 'unavailable')
  assert.equal(down.code, 'upstream_unavailable')
  assert.equal(down.retryable, true)
  assert.match(down.message, /temporarily unavailable/)
  assert.equal(classifyUpstream('you', 400, '').code, 'bad_request')
  assert.equal(classifyUpstream('you', 400, '').retryable, false)
})

test('retries transient failures with backoff but never permanent errors', async () => {
  const limits = { maxResults: 8, maxSnippetChars: 100 }
  let calls = 0
  const flaky = async () => (++calls <= 2
    ? new Response('busy', { status: 503 })
    : new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.example/', snippet: 's' }] }), { headers: { 'content-type': 'application/json' } }))
  const out = await runApiSearch('tinyfish', 'q', { apiKey: 'k', timeoutMs: 5000, limits, retry: { maxRetries: 3, baseMs: 1 }, fetchFn: flaky })
  assert.equal(calls, 3)
  assert.equal(out[0].title, 'T')
  let authCalls = 0
  const denied = async () => { authCalls++; return new Response('no', { status: 401 }) }
  await assert.rejects(
    () => runApiSearch('tinyfish', 'q', { apiKey: 'bad', timeoutMs: 5000, limits, retry: { maxRetries: 3, baseMs: 1 }, fetchFn: denied }),
    (error) => error.code === 'upstream_auth',
  )
  assert.equal(authCalls, 1)
  let limitedCalls = 0
  const limited = async () => { limitedCalls++; return new Response('slow', { status: 429 }) }
  await assert.rejects(
    () => runApiSearch('you', 'q', { apiKey: 'k', timeoutMs: 5000, limits, retry: { maxRetries: 0, baseMs: 1 }, fetchFn: limited }),
    (error) => error.code === 'rate_limited' && error.retryable === true,
  )
  assert.equal(limitedCalls, 1)
})

test('reports timeouts as retryable instead of generic failures', async () => {
  const hanging = (_url, { signal } = {}) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error) })
  })
  await assert.rejects(
    () => runApiSearch('tinyfish', 'q', { apiKey: 'k', timeoutMs: 20, limits: { maxResults: 8, maxSnippetChars: 100 }, retry: { maxRetries: 0 }, fetchFn: hanging }),
    (error) => error.code === 'timeout' && error.retryable === true,
  )
})

test('bounds a response body that stalls after the headers and retries it', async () => {
  // Providers that answer 200 and then stream forever must not pin the request
  // open past the timeout: the abort signal covers the body read too, and a
  // body timeout is transient just like a header timeout.
  let calls = 0
  const stalling = (_url, init = {}) => {
    calls++
    if (calls === 1) {
      return new Response(new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            controller.error(error)
          })
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ results: [{ title: 'Recovered', url: 'https://recovered.example/', snippet: 's' }] }), { headers: { 'content-type': 'application/json' } })
  }
  const out = await runApiSearch('tinyfish', 'q', { apiKey: 'k', timeoutMs: 20, limits: { maxResults: 8, maxSnippetChars: 100 }, retry: { maxRetries: 2, baseMs: 1 }, fetchFn: stalling })
  assert.equal(calls, 2)
  assert.equal(out[0].title, 'Recovered')
  let single = 0
  const alwaysStalls = (_url, init = {}) => {
    single++
    return new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          controller.error(error)
        })
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  await assert.rejects(
    () => runApiSearch('tinyfish', 'q', { apiKey: 'k', timeoutMs: 20, limits: { maxResults: 8, maxSnippetChars: 100 }, retry: { maxRetries: 0 }, fetchFn: alwaysStalls }),
    (error) => error.code === 'timeout' && error.retryable === true,
  )
  assert.equal(single, 1)
})

test('firecrawl search works without an API key', () => {
  assert.equal(providerNeedsKey('firecrawl'), false)
  assert.equal(providerNeedsKey('tinyfish'), true)
  assert.equal(providerNeedsKey('you'), true)
  const req = buildApiRequest('firecrawl', 'hello', {})
  assert.equal(req.options.headers.Authorization, undefined)
  assert.match(req.options.body, /hello/)
  const keyed = buildApiRequest('firecrawl', 'hello', { apiKey: 'k4' })
  assert.match(String(keyed.options.headers.Authorization), /^Bearer k4$/)
})

test('missing keys and zones carry machine-readable codes', () => {
  assert.throws(() => buildApiRequest('tinyfish', 'x', { apiKey: '' }), (error) => error.code === 'missing_key')
  assert.throws(() => buildApiRequest('brightdata', 'x', { apiKey: 'k', zone: '' }), (error) => error.code === 'missing_zone')
})

test('prefers provider-specific API keys with shared fallback', () => {
  assert.equal(apiKeyFor('exa', { EXA_API_KEY: 'specific', SEARCH_API_KEY: 'shared' }), 'specific')
  assert.equal(apiKeyFor('exa', { SEARCH_API_KEY: 'shared' }), 'shared')
  assert.equal(apiKeyFor('exa', {}), '')
})

test('prefers browser BYOK keys and zones over server env', () => {
  assert.equal(resolveApiKey('exa', '  own  ', { EXA_API_KEY: 'server' }), 'own')
  assert.equal(resolveApiKey('exa', '', { EXA_API_KEY: 'server' }), 'server')
  assert.equal(resolveZone('my-zone', { SEARCH_API_ZONE: 'server-zone' }), 'my-zone')
  assert.equal(resolveZone('', { SEARCH_API_ZONE: 'server-zone' }), 'server-zone')
})

test('runs API searches through selectResults', async () => {
  const apiFetch = async () => new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.example/', snippet: 'hello' }] }), { headers: { 'content-type': 'application/json' } })
  const aResults = await runApiSearch('tinyfish', 'q', { apiKey: 'k', timeoutMs: 5000, limits: { maxResults: 8, maxSnippetChars: 100 }, fetchFn: apiFetch })
  assert.equal(aResults[0].title, 'T')
})

test('passes the snippet length to providers that accept one', () => {
  const opts = { apiKey: 'k', snippetChars: 900 }
  const exa = JSON.parse(buildApiRequest('exa', 'q', opts).options.body)
  assert.equal(exa.contents.text.maxCharacters, 900)
  const tavily = JSON.parse(buildApiRequest('tavily', 'q', opts).options.body)
  assert.equal(tavily.chunks_per_source, 2)
  const parallel = JSON.parse(buildApiRequest('parallel', 'q', opts).options.body)
  assert.equal(parallel.advanced_settings.excerpt_settings.max_chars_per_result, 900)
  const valyu = JSON.parse(buildApiRequest('valyu', 'q', opts).options.body)
  assert.equal(valyu.response_length, 900)
  const perplexity = JSON.parse(buildApiRequest('perplexity', 'q', opts).options.body)
  assert.equal(perplexity.max_tokens_per_page, 225)
  // The server cap wins over an out-of-range request.
  const capped = JSON.parse(buildApiRequest('exa', 'q', { apiKey: 'k', snippetChars: 9999 }).options.body)
  assert.equal(capped.contents.text.maxCharacters, 3000)
})

test('expands TinyFish search snippets through Fetch highlights', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    if (String(url).includes('api.search.tinyfish.ai')) {
      return new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.example/page', snippet: 'short' }] }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ results: [{ url: 'https://t.example/page', highlights: [{ text: 'x'.repeat(1000) }] }] }), { headers: { 'content-type': 'application/json' } })
  }
  const out = await runApiSearch('tinyfish', 'q', { apiKey: 'k', timeoutMs: 5000, limits: { maxResults: 8, maxSnippetChars: 1000 }, fetchFn })
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /api\.search\.tinyfish\.ai/)
  assert.match(calls[1].url, /api\.fetch\.tinyfish\.ai/)
  assert.equal(calls[1].body.highlights.max_chars, 1000)
  assert.deepEqual(calls[1].body.urls, ['https://t.example/page'])
  assert.equal(out[0].snippet, 'x'.repeat(1000))
})

test('builds authenticated requests for every added grounding provider', () => {
  const post = (id, key = 'k') => buildApiRequest(id, 'hello world', { apiKey: key, count: 5 })
  const tavily = post('tavily')
  assert.equal(tavily.options.headers.Authorization, 'Bearer k')
  assert.equal(JSON.parse(tavily.options.body).max_results, 5)
  const parallel = post('parallel')
  assert.equal(parallel.options.headers['X-API-Key'], 'k')
  assert.deepEqual(JSON.parse(parallel.options.body).search_queries, ['hello world'])
  const valyu = post('valyu')
  assert.equal(valyu.options.headers['X-API-Key'], 'k')
  assert.equal(JSON.parse(valyu.options.body).max_num_results, 5)
  const perplexity = post('perplexity')
  assert.equal(perplexity.options.headers.Authorization, 'Bearer k')
  assert.equal(JSON.parse(perplexity.options.body).max_results, 5)
  const serper = post('serper')
  assert.equal(serper.options.headers['X-API-Key'], 'k')
  assert.equal(JSON.parse(serper.options.body).num, 5)
  const brave = post('brave')
  assert.equal(brave.options.headers['X-Subscription-Token'], 'k')
  assert.match(brave.url, /count=5/)
  const serpapi = post('serpapi')
  assert.match(serpapi.url, /api_key=k/)
  assert.equal(serpapi.options.headers.Authorization, undefined)
  const linkup = post('linkup')
  assert.equal(linkup.options.headers.Authorization, 'Bearer k')
  assert.equal(JSON.parse(linkup.options.body).outputType, 'searchResults')
  const octen = post('octen')
  assert.equal(octen.options.headers.Authorization, 'Bearer k')
  assert.equal(JSON.parse(octen.options.body).count, 5)
  const google = post('google')
  assert.equal(google.options.headers['x-goog-api-key'], 'k')
  assert.ok(JSON.parse(google.options.body).tools[0].google_search)
  const openai = post('openai')
  assert.equal(openai.options.headers.Authorization, 'Bearer k')
  assert.equal(JSON.parse(openai.options.body).tools[0].type, 'web_search')
  const anthropic = post('anthropic')
  assert.equal(anthropic.options.headers['X-API-Key'], 'k')
  assert.equal(anthropic.options.headers['anthropic-version'], '2023-06-01')
  assert.equal(JSON.parse(anthropic.options.body).tools[0].type, 'web_search_20250305')
  const azure = post('azure')
  assert.equal(azure.options.headers['Ocp-Apim-Subscription-Key'], 'k')
  assert.match(azure.url, /responseFilter=Webpages/)
})

test('parses results from every added grounding provider', () => {
  const tavily = parseApiResponse('tavily', { results: [{ title: 'T', url: 'https://t.example/', content: 'tav', score: 0.9 }] })
  assert.equal(tavily[0].engine, 'tavily')
  assert.equal(tavily[0].content, 'tav')
  const parallel = parseApiResponse('parallel', { results: [{ title: 'P', url: 'https://p.example/', excerpts: ['p1', 'p2'] }] })
  assert.match(parallel[0].content, /p1/)
  const valyu = parseApiResponse('valyu', { results: [{ title: 'V', url: 'https://v.example/', content: 'val', relevance_score: 0.8 }] })
  assert.equal(valyu[0].content, 'val')
  const perplexity = parseApiResponse('perplexity', { results: [{ title: 'X', url: 'https://x.example/', snippet: 'px' }] })
  assert.equal(perplexity[0].content, 'px')
  const serper = parseApiResponse('serper', { organic: [{ title: 'S', link: 'https://s.example/', snippet: 'serp', position: 1 }] })
  assert.equal(serper[0].url, 'https://s.example/')
  const brave = parseApiResponse('brave', { web: { results: [{ title: 'B', url: 'https://b.example/', description: 'brave', extra_snippets: ['more'] }] } })
  assert.match(brave[0].content, /more/)
  const serpapi = parseApiResponse('serpapi', { organic_results: [{ title: 'A', link: 'https://a.example/', snippet: 'api', position: 2 }] })
  assert.equal(serpapi[0].url, 'https://a.example/')
  const linkup = parseApiResponse('linkup', { results: [{ name: 'L', url: 'https://l.example/', content: 'link' }] })
  assert.equal(linkup[0].title, 'L')
  const octen = parseApiResponse('octen', { data: { results: [{ title: 'O', url: 'https://o.example/', highlight: 'oct' }] } })
  assert.equal(octen[0].content, 'oct')
  const google = parseApiResponse('google', { candidates: [{ groundingMetadata: {
    groundingChunks: [{ web: { uri: 'https://g.example/', title: 'G' } }],
    groundingSupports: [{ groundingChunkIndices: [0], segment: { text: 'gemini evidence' } }],
  } }] })
  assert.equal(google[0].content, 'gemini evidence')
  const openai = parseApiResponse('openai', { output: [{ type: 'message', content: [{ type: 'output_text', text: 'openai answer', annotations: [{ type: 'url_citation', url: 'https://oa.example/', title: 'OA' }] }] }] })
  assert.equal(openai[0].content, 'openai answer')
  const anthropic = parseApiResponse('anthropic', { content: [
    { type: 'text', text: 'answer', citations: [{ url: 'https://cl.example/', title: 'CL', cited_text: 'claude evidence' }] },
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://cl2.example/', title: 'CL2' }] },
  ] })
  assert.equal(anthropic[0].content, 'claude evidence')
  assert.equal(anthropic[1].url, 'https://cl2.example/')
  const azure = parseApiResponse('azure', { webPages: { value: [{ name: 'AZ', url: 'https://az.example/', snippet: 'bing' }] } })
  assert.equal(azure[0].content, 'bing')
})

test('normalizes the added provider aliases', () => {
  assert.equal(normalizeProvider('Google Gemini grounding'), 'google')
  assert.equal(normalizeProvider('Gemini'), 'google')
  assert.equal(normalizeProvider('OpenAI web search'), 'openai')
  assert.equal(normalizeProvider('Claude web search'), 'anthropic')
  assert.equal(normalizeProvider('Azure Grounding with Bing'), 'azure')
  assert.equal(normalizeProvider('Azure Bing grounding'), 'azure')
  assert.equal(normalizeProvider('Brave Search API'), 'brave')
  assert.equal(normalizeProvider('Serp API'), 'serpapi')
  assert.equal(providerNeedsKey('tavily'), true)
  assert.equal(providerNeedsKey('jina'), false)
})
