import test from 'node:test'
import assert from 'node:assert/strict'
import { proxyRoute, proxyTargetOf, proxyTargetAllowed, proxyAllowlist } from './proxy.mjs'

// Unit coverage for the same-origin request relay. These drive proxyRoute with
// real Request/Response objects and a fake upstream fetch, so no network is
// involved: they assert the routing, the SSRF policy, header hygiene and the
// streaming passthrough.

const CHAT = 'https://api.llmtech.eu/v1/chat/completions'

let ipCounter = 0
const relayReq = (target, init = {}) => {
  const headers = new Headers(init.headers || {})
  headers.set('cf-connecting-ip', `proxy-test-${++ipCounter}`)
  return new Request(`https://app.example.com/api/proxy?url=${encodeURIComponent(target)}`, { ...init, headers })
}
const localRelayReq = (target, init = {}) => {
  const headers = new Headers(init.headers || {})
  headers.set('cf-connecting-ip', `proxy-test-local-${++ipCounter}`)
  return new Request(`http://localhost:8787/api/proxy?url=${encodeURIComponent(target)}`, { ...init, headers })
}

test('proxyRoute ignores every other route', async () => {
  assert.equal(await proxyRoute(new Request('https://app.example.com/api/health')), null)
  assert.equal(await proxyRoute(new Request('https://app.example.com/index.html')), null)
})

test('only absolute http(s) targets are accepted', () => {
  // A relative `url` value is not absolute, so it is not a usable target.
  assert.equal(proxyTargetOf(new URL('https://app.example.com/api/proxy?url=%2Fv1%2Fmodels')), null)
  assert.equal(proxyTargetOf(new URL('https://app.example.com/api/proxy')), null)
  const js = proxyTargetOf(new URL('https://app.example.com/api/proxy?url=javascript%3Aalert(1)'))
  assert.equal(js, null)
  const ok = proxyTargetOf(new URL(`https://app.example.com/api/proxy?url=${encodeURIComponent(CHAT)}`))
  assert.equal(ok.href, CHAT)
})

test('SSRF policy: public hosts pass, internal hosts do not', () => {
  const allowed = (raw, env = {}, appHost = 'app.example.com') => proxyTargetAllowed(new URL(raw), env, appHost)

  assert.equal(allowed('https://api.llmtech.eu/v1'), true)
  assert.equal(allowed('http://127.0.0.1:4000/v1'), false)
  assert.equal(allowed('http://localhost:4000/v1'), false)
  assert.equal(allowed('http://169.254.169.254/latest/meta-data'), false)
  assert.equal(allowed('http://[::1]/v1'), false)
  assert.equal(allowed('http://metadata.google.internal/'), false)
  assert.equal(allowed('https://user:pass@api.example.com/v1'), false)
  assert.equal(allowed('file:///etc/passwd'), false)

  // A local app host may reach local gateways (Bifrost, LiteLLM) by default.
  assert.equal(allowed('http://127.0.0.1:4000/v1', {}, 'localhost:8787'), true)
  assert.equal(allowed('http://localhost:4000/v1', {}, '127.0.0.1:8787'), true)
  // ... and PROXY_ALLOW_PRIVATE opts a public deployment in.
  assert.equal(allowed('http://192.168.1.9:8080/v1', { PROXY_ALLOW_PRIVATE: '1' }), true)

  // An explicit allowlist wins over everything, including the private rules.
  assert.equal(allowed('http://127.0.0.1:4000/v1', { PROXY_ALLOWED_HOSTS: '127.0.0.1' }), true)
  assert.equal(allowed('https://api.llmtech.eu/v1', { PROXY_ALLOWED_HOSTS: 'openrouter.ai' }), false)
  assert.equal(allowed('https://router.requesty.ai/v1', { PROXY_ALLOWED_HOSTS: '*.requesty.ai' }), true)
  assert.deepEqual(proxyAllowlist({ PROXY_ALLOWED_HOSTS: ' A.example , .b.example ' }), ['a.example', '*.b.example'])
})

test('forwards method, auth and body; strips browser-only headers', async () => {
  let seen = null
  const fetchFn = async (url, init) => {
    seen = { url: String(url), init }
    return new Response('data: {"ok":true}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'set-cookie': 'a=b', 'access-control-allow-origin': '*', 'x-ratelimit-remaining': '9' },
    })
  }
  const res = await proxyRoute(relayReq(CHAT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer secret-key',
      'anthropic-version': '2023-06-01',
      origin: 'https://app.example.com',
      cookie: 'session=1',
      'x-custom': 'kept',
    },
    body: '{"a":1}',
  }), {}, { fetchFn })

  assert.equal(seen.url, CHAT)
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers.authorization, 'Bearer secret-key')
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01')
  assert.equal(seen.init.headers['x-custom'], 'kept')
  assert.equal(seen.init.headers['content-length'], '7')
  // The upstream hop is not a browser hop.
  assert.equal(seen.init.headers.origin, undefined)
  assert.equal(seen.init.headers.cookie, undefined)
  assert.equal(seen.init.headers.host, undefined)
  // Bodies are forwarded as bytes, not re-serialized.
  assert.equal(Buffer.from(seen.init.body).toString(), '{"a":1}')

  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/event-stream')
  assert.equal(res.headers.get('x-ratelimit-remaining'), '9')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  // No CORS or cookie headers leak from upstream onto the same-origin answer.
  assert.equal(res.headers.get('access-control-allow-origin'), null)
  assert.equal(res.headers.get('set-cookie'), null)
  assert.equal(await res.text(), 'data: {"ok":true}\n\n')
})

test('streams the upstream body instead of buffering it', async () => {
  let closed = false
  const fetchFn = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: one\n\n'))
      // Never closes during this test: the relay must hand the stream over.
    },
    cancel() { closed = true },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })

  const res = await proxyRoute(relayReq(CHAT, { method: 'POST', body: '{}' }), {}, { fetchFn })
  const reader = res.body.getReader()
  const first = await reader.read()
  assert.equal(new TextDecoder().decode(first.value), 'data: one\n\n')
  await reader.cancel()
  assert.equal(closed, true)
})

test('refuses state-changing requests from another origin', async () => {
  const res = await proxyRoute(relayReq(CHAT, {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: '{}',
  }), {}, { fetchFn: async () => new Response('nope') })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'cross_origin')
})

test('refuses a target outside the configured allowlist', async () => {
  const res = await proxyRoute(relayReq(CHAT, { method: 'POST', body: '{}' }), { PROXY_ALLOWED_HOSTS: 'openrouter.ai' }, {
    fetchFn: async () => { throw Error('must not be called') },
  })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'target_not_allowed')
})

test('blocks internal targets on a public deployment', async () => {
  const res = await proxyRoute(relayReq('http://127.0.0.1:4000/v1/models'), {}, {
    fetchFn: async () => { throw Error('must not be called') },
  })
  assert.equal(res.status, 403)
})

test('allows an internal target when the app itself runs on localhost', async () => {
  const res = await proxyRoute(localRelayReq('http://127.0.0.1:4000/v1/models'), {}, {
    fetchFn: async () => new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  assert.equal(res.status, 200)
  assert.equal(await res.text(), '{"data":[]}')
})

test('does not follow a redirect to a disallowed host', async () => {
  const res = await proxyRoute(relayReq(CHAT, { method: 'POST', body: '{}' }), {}, {
    fetchFn: async () => new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
  })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, 'target_not_allowed')
})

test('follows an allowed redirect and records the final URL', async () => {
  const fetchFn = async (url) => String(url) === CHAT
    ? new Response(null, { status: 307, headers: { location: 'https://eu.api.llmtech.eu/v1/chat/completions' } })
    : new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  const res = await proxyRoute(relayReq(CHAT, { method: 'POST', body: '{}' }), {}, { fetchFn })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-proxy-final-url'), 'https://eu.api.llmtech.eu/v1/chat/completions')
  assert.equal(await res.text(), 'ok')
})

test('maps upstream failures to a structured 502 without echoing them', async () => {
  const res = await proxyRoute(relayReq(CHAT, { method: 'POST', body: '{}' }), {}, {
    fetchFn: async () => { throw Error('secret-key leaked in this message') },
  })
  assert.equal(res.status, 502)
  const body = await res.json()
  assert.equal(body.code, 'proxy_failed')
  assert.doesNotMatch(body.error, /secret-key/)
})

test('rejects a missing url and an oversized body', async () => {
  const missing = await proxyRoute(new Request('https://app.example.com/api/proxy', { headers: { 'cf-connecting-ip': 'missing-url' } }), {}, {
    fetchFn: async () => { throw Error('must not be called') },
  })
  assert.equal(missing.status, 400)

  const oversized = await proxyRoute(relayReq(CHAT, {
    method: 'POST',
    headers: { 'content-length': String(64 * 1024 * 1024) },
    body: '{}',
  }), {}, { fetchFn: async () => new Response('nope') })
  assert.equal(oversized.status, 413)
})

test('rejects unsupported methods', async () => {
  // OPTIONS has nothing to preflight here (the relay is same-origin), so it is
  // not a supported verb.
  const res = await proxyRoute(relayReq(CHAT, { method: 'OPTIONS' }), {}, { fetchFn: async () => new Response('nope') })
  assert.equal(res.status, 405)
})
