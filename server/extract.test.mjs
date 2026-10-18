import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, isPublicHttp, fetchPageText } from './extract.mjs'

test('blocks private and non-http targets', () => {
  assert.equal(isPublicHttp('https://example.com/a'), true)
  for (const u of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://[::1]/']) {
    assert.equal(isPublicHttp(u), false, u)
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
