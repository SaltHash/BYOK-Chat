import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, isPublicHttp, fetchPageText, fetchPageViaProvider } from './extract.mjs'

test('blocks private and non-http targets', () => {
  assert.equal(isPublicHttp('https://example.com/a'), true)
  for (const u of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://[::1]/']) {
    assert.equal(isPublicHttp(u), false, u)
  }
})

test('only the standard web ports are readable', () => {
  for (const u of ['http://example.com:8443/', 'https://example.com:8443/', 'http://example.com:3000/', 'http://example.com:8080/']) {
    assert.equal(isPublicHttp(u), false, u)
  }
  for (const u of ['http://example.com/', 'https://example.com/', 'http://example.com:80/', 'https://example.com:443/']) {
    assert.equal(isPublicHttp(u), true, u)
  }
})

test('blocks shorthand IPv4 and private, mapped or non-routable IPv6 literals', () => {
  for (const u of [
    'http://127.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://0/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[fec0::1]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[ff02::1]/',
    'http://[2001:db8::1]/', 'http://[100::1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/',
    'http://[::ffff:10.0.0.1]/', 'http://[64:ff9b::a00:1]/', 'http://198.18.0.1/', 'http://192.0.2.5/',
  ]) {
    assert.equal(isPublicHttp(u), false, u)
  }
  for (const u of ['https://example.com/a', 'http://[2606:4700::1111]/', 'http://[64:ff9b::808:808]/', 'http://[2002:808:808::]/', 'http://8.8.8.8/']) {
    assert.equal(isPublicHttp(u), true, u)
  }
})

test('strips scripts and boilerplate, keeps title and text', () => {
  const { title, text } = htmlToText('<html><head><title>  Hello  World </title></head><body><script>evil()</script><nav>Menu</nav><p>Hello <b>there</b></p><p>Second line</p></body></html>')
  assert.equal(title, 'Hello World')
  assert.match(text, /Hello there/)
  assert.match(text, /Second line/)
  assert.doesNotMatch(text, /evil/)
})

test('decodes numeric entities safely, including astral and invalid code points', () => {
  const { text } = htmlToText('<p>a &#128512; b &#x1F600; c &#xD800; d &#1114112; e &hellip;</p>')
  assert.match(text, /a 😀 b 😀 c .*d .*e/)
  assert.ok(!text.includes('\uFFFD'), 'invalid entities must not become replacement characters')
  assert.ok(!/&#/.test(text), 'entities must be decoded')
})

test('stops reading a body that stalls after the headers (timeout)', async () => {
  const stalling = (_url, init = {}) => new Response(new ReadableStream({
    start(controller) {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        controller.error(error)
      })
    },
  }), { headers: { 'content-type': 'text/html' } })
  await assert.rejects(
    () => fetchPageText('https://stall.example/page', { timeoutMs: 20, fetchFn: stalling }),
    (e) => e.code === 'timeout' && e.retryable === true,
  )
})

test('cancels the upstream stream when the HTML cap is reached', async () => {
  let cancelled = false
  const big = (_url) => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode('<p>' + 'x'.repeat(200_000) + '</p>')) },
    cancel() { cancelled = true },
  }), { headers: { 'content-type': 'text/html' } })
  const { text } = await fetchPageText('https://big.example/page', { fetchFn: big })
  assert.ok(text.length > 0)
  assert.equal(cancelled, true)
})

test('fetchPageText honors maxChars and retries transient failures', async () => {
  let calls = 0
  const html = `<html><head><title>Retry</title></head><body><p>${'word '.repeat(5000)}</p></body></html>`
  const fetchFn = async () => {
    calls++
    if (calls === 1) throw Object.assign(Error('temporary network error'), { code: 'network', retryable: true })
    return new Response(html, { headers: { 'content-type': 'text/html' } })
  }
  const page = await fetchPageText('https://retry.example/page', { fetchFn, maxChars: 2000, maxRetries: 1, retryBaseMs: 50 })
  assert.equal(calls, 2)
  assert.equal(page.text.length, 2000)
  assert.equal(page.truncated, true)
})

test('fetchPageText caps text and rejects bad types', async () => {
  const html = `<html><head><title>T</title></head><body><p>${'x '.repeat(20000)}</p></body></html>`
  const ok = await fetchPageText('https://example.com/a', { fetchFn: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) })
  assert.equal(ok.title, 'T')
  assert.ok(ok.text.length <= 12000)
  assert.equal(ok.truncated, true)
  await assert.rejects(
    () => fetchPageText('https://example.com/f.png', { fetchFn: async () => new Response('x', { headers: { 'content-type': 'image/png' } }) }),
    /not a readable page/,
  )
  await assert.rejects(() => fetchPageText('http://10.0.0.1/'), /public http/)
})

test('the Jina reader returns clean markdown with the page title', async () => {
  const fetchFn = async (url) => {
    assert.match(String(url), /^https:\/\/r\.jina\.ai\//)
    return new Response('Title: Jina Page\nURL Source: https://example.com/a\nMarkdown Content:\n\n# Heading\n\nBody text.', { headers: { 'content-type': 'text/plain' } })
  }
  const page = await fetchPageViaProvider('https://example.com/jina', { provider: 'jina', fetchFn })
  assert.equal(page.title, 'Jina Page')
  assert.match(page.text, /# Heading/)
  assert.equal(page.reader, 'jina')
})

test('the Firecrawl reader extracts markdown from its scrape payload', async () => {
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body)
    assert.equal(body.url, 'https://example.com/firecrawl')
    assert.equal(init.headers.authorization, 'Bearer fc-key')
    return new Response(JSON.stringify({ data: { markdown: '# Firecrawl', metadata: { title: 'FC Page' } } }), { headers: { 'content-type': 'application/json' } })
  }
  const page = await fetchPageViaProvider('https://example.com/firecrawl', { provider: 'firecrawl', apiKey: 'fc-key', fetchFn })
  assert.equal(page.text, '# Firecrawl')
  assert.equal(page.title, 'FC Page')
})

test('the Exa reader needs a key and returns the extracted text', async () => {
  const fetchFn = async (_url, init) => {
    assert.equal(init.headers['x-api-key'], 'exa-key')
    return new Response(JSON.stringify({ results: [{ title: 'Exa Page', text: 'exa text' }] }), { headers: { 'content-type': 'application/json' } })
  }
  const page = await fetchPageViaProvider('https://example.com/exa', { provider: 'exa', apiKey: 'exa-key', fetchFn })
  assert.equal(page.text, 'exa text')
  assert.equal(page.title, 'Exa Page')
  await assert.rejects(
    () => fetchPageViaProvider('https://example.com/exa-nokey', { provider: 'exa', fallback: false, fetchFn }),
    (e) => e.code === 'missing_key',
  )
})

test('a custom reader API receives the page address and returns its text', async () => {
  let seen = ''
  const fetchFn = async (url) => {
    seen = String(url)
    return new Response(JSON.stringify({ text: 'custom text' }), { headers: { 'content-type': 'application/json' } })
  }
  const page = await fetchPageViaProvider('https://example.com/custom', { provider: 'custom', baseUrl: 'https://reader.example/read?url={url}', fetchFn })
  assert.match(seen, /^https:\/\/reader\.example\/read\?url=https%3A%2F%2Fexample\.com%2Fcustom$/)
  assert.equal(page.text, 'custom text')
})

test('a failing reader API falls back to the built-in reader', async () => {
  const fetchFn = async (url) => {
    if (String(url).includes('r.jina.ai')) return new Response('nope', { status: 401 })
    return new Response('<html><head><title>Fallback</title></head><body><p>Fallback body</p></body></html>', { headers: { 'content-type': 'text/html' } })
  }
  const page = await fetchPageViaProvider('https://example.com/fallback', { provider: 'jina', fetchFn })
  assert.equal(page.title, 'Fallback')
  assert.equal(page.fallbackUsed, true)
  await assert.rejects(
    () => fetchPageViaProvider('https://example.com/fallback-off', { provider: 'jina', fallback: false, fetchFn }),
    (e) => e.code === 'upstream_auth',
  )
})

test('the reader never targets private addresses', async () => {
  await assert.rejects(() => fetchPageViaProvider('http://127.0.0.1/', { provider: 'jina', fetchFn: async () => new Response('x') }), /public http/)
})

test('a reader API that stalls is cut off by the request timeout', async () => {
  const fetchFn = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init.signal?.addEventListener('abort', () => {
        const e = Error('aborted')
        e.name = 'AbortError'
        controller.error(e)
      })
    },
  }), { headers: { 'content-type': 'text/plain' } })
  await assert.rejects(
    () => fetchPageViaProvider('https://example.com/stall', { provider: 'jina', timeoutMs: 1000, maxRetries: 0, fallback: false, fetchFn }),
    (e) => e.code === 'timeout' || e.code === 'network',
  )
})

test('a reader response that breaks mid-body does not hang the read', async () => {
  const fetchFn = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial text'))
      setTimeout(() => controller.error(Error('connection reset')), 5)
    },
  }), { headers: { 'content-type': 'text/plain' } })
  const page = await fetchPageViaProvider('https://example.com/partial', { provider: 'jina', fallback: false, fetchFn })
  assert.match(page.text, /partial text/)
})
