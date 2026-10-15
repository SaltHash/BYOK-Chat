import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, isPublicHttp, fetchPageText } from './extract.mjs'

test('blocks private and non-http targets', () => {
  assert.equal(isPublicHttp('https://example.com/a'), true)
  for (const u of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://[::1]/']) {
    assert.equal(isPublicHttp(u), false, u)
  }
})

test('strips scripts and boilerplate, keeps title and text', () => {
  const { title, text } = htmlToText('<html><head><title>  Hello  World </title></head><body><script>evil()</script><nav>Menu</nav><p>Hello <b>there</b></p><p>Second line</p></body></html>')
  assert.equal(title, 'Hello World')
  assert.match(text, /Hello there/)
  assert.match(text, /Second line/)
  assert.doesNotMatch(text, /evil/)
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
