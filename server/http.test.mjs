import test from 'node:test'
import assert from 'node:assert/strict'
import { clientIp, readBodyText, sameOrigin, bearerToken, headerValue } from './http.mjs'

// Node-style request stand-in: async-iterable body plus a socket address.
const nodeReq = (chunks, headers = {}) => ({
  headers,
  socket: { remoteAddress: '203.0.113.9' },
  [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk },
})

test('readBodyText decodes multi-byte characters across chunk boundaries', async () => {
  const bytes = Buffer.from('{"text":"😀 and more"}')
  // Split inside the 4-byte emoji so a naive per-chunk toString() would corrupt it.
  const cut = bytes.indexOf(Buffer.from('😀')) + 2
  const raw = await readBodyText(nodeReq([bytes.subarray(0, cut), bytes.subarray(cut)]), 1000)
  assert.equal(raw, '{"text":"😀 and more"}')
  const viaRequest = await readBodyText(new Request('https://app.example.com/', { method: 'POST', body: '{"text":"😀"}' }), 1000)
  assert.equal(viaRequest, '{"text":"😀"}')
})

test('readBodyText returns null when a body exceeds the cap', async () => {
  assert.equal(await readBodyText(nodeReq([Buffer.alloc(200, 0x61)]), 100), null)
  // Declared length short-circuit.
  assert.equal(await readBodyText(nodeReq([Buffer.alloc(0)], { 'content-length': '99999' }), 100), null)
  // Fetch Request path (streamed reader).
  assert.equal(await readBodyText(new Request('https://app.example.com/', { method: 'POST', body: 'x'.repeat(5000) }), 1000), null)
  // Fetch Request path with a declared length.
  assert.equal(await readBodyText(new Request('https://app.example.com/', { method: 'POST', body: 'x', headers: { 'content-length': '99999' } }), 1000), null)
  assert.equal(await readBodyText(nodeReq([Buffer.from('{}')]), 100), '{}')
})

test('clientIp only trusts proxy headers where they cannot be spoofed', () => {
  const spoof = { headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' } }
  assert.equal(clientIp(nodeReq([], spoof.headers), {}), '203.0.113.9')
  assert.equal(clientIp(nodeReq([], spoof.headers), { TRUST_PROXY: '1' }), '1.1.1.1')
  // Worker requests have no socket, so Cloudflare's header is authoritative.
  assert.equal(clientIp({ headers: new Headers({ 'cf-connecting-ip': '9.9.9.9' }) }, {}), '9.9.9.9')
  assert.equal(clientIp({ headers: new Headers({ 'x-forwarded-for': '8.8.8.8, 4.4.4.4' }) }, {}), '8.8.8.8')
  assert.equal(clientIp({ headers: new Headers() }, {}), 'unknown')
})

test('same-origin and header helpers handle both request shapes', () => {
  assert.equal(sameOrigin('', 'app.example.com'), true)
  assert.equal(sameOrigin('https://app.example.com', 'app.example.com'), true)
  assert.equal(sameOrigin('https://evil.example', 'app.example.com'), false)
  assert.equal(sameOrigin('null', 'app.example.com'), false)
  assert.equal(bearerToken({ headers: { authorization: 'Bearer abc' } }), 'abc')
  assert.equal(bearerToken({ headers: new Headers({ authorization: 'Basic abc' }) }), '')
  assert.equal(headerValue({ headers: { host: ['one.example', 'two.example'] } }, 'host'), 'one.example')
})
