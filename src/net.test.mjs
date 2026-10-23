import test from 'node:test'
import assert from 'node:assert/strict'
const { providerFetch, proxyUrlFor, isProxyable, setProxyMode, ProxyUnavailableError } = await import('./net.ts')

// Transport selection for provider traffic. A fake `location` and a fake
// global fetch stand in for the browser, so the relay decision (direct vs
// same-origin) is asserted without any network.

const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
const realFetch = globalThis.fetch

const setLocation = (href) => Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { href, origin: new URL(href).origin },
})

test.afterEach(() => {
  if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
  else delete globalThis.location
  globalThis.fetch = realFetch
  setProxyMode('auto')
})

test('cross-origin provider URLs are relayable; same-origin ones are not', () => {
  setLocation('http://localhost:5173/')
  assert.equal(isProxyable('https://api.llmtech.eu/v1/chat/completions'), true)
  assert.equal(isProxyable('/api/search'), false)
  assert.equal(isProxyable('http://localhost:5173/api/search'), false)
  assert.equal(isProxyable('ftp://example.com/x'), false)
  assert.equal(proxyUrlFor('https://api.example.com/v1?x=1'), '/api/proxy?url=https%3A%2F%2Fapi.example.com%2Fv1%3Fx%3D1')
})

test('auto mode uses the direct path when the browser allows it', async () => {
  setLocation('http://localhost:5173/')
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('direct') }
  const res = await providerFetch('https://api.example.com/v1/chat/completions', { method: 'POST', body: '{}' })
  assert.equal(await res.text(), 'direct')
  assert.deepEqual(calls, ['https://api.example.com/v1/chat/completions'])
})

test('auto mode retries through the relay when the browser blocks the request', async () => {
  setLocation('http://localhost:5173/')
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (calls.length === 1) throw new TypeError('Failed to fetch')
    return new Response('relayed', { headers: { 'content-type': 'application/json' } })
  }
  const res = await providerFetch('https://api.llmtech.eu/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer key' },
    body: '{"a":1}',
  })
  assert.equal(await res.text(), 'relayed')
  assert.deepEqual(calls, [
    'https://api.llmtech.eu/v1/chat/completions',
    '/api/proxy?url=https%3A%2F%2Fapi.llmtech.eu%2Fv1%2Fchat%2Fcompletions',
  ])
})

test('auto mode surfaces a clear error when the deployment has no proxy', async () => {
  setLocation('http://localhost:5173/')
  let call = 0
  globalThis.fetch = async () => {
    call++
    if (call === 1) throw new TypeError('Failed to fetch')
    return new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } })
  }
  await assert.rejects(
    providerFetch('https://api.example.com/v1/chat/completions', { method: 'POST', body: '{}' }),
    (error) => error instanceof ProxyUnavailableError && /no request proxy/i.test(error.message),
  )
})

test('always mode skips the direct attempt; off mode never relays', async () => {
  setLocation('http://localhost:5173/')
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('ok') }

  setProxyMode('always')
  await providerFetch('https://api.example.com/v1/models')
  assert.deepEqual(calls, ['/api/proxy?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fmodels'])

  calls.length = 0
  setProxyMode('off')
  await providerFetch('https://api.example.com/v1/models')
  assert.deepEqual(calls, ['https://api.example.com/v1/models'])
})

test('same-origin API calls and aborted requests are never relayed', async () => {
  setLocation('http://localhost:5173/')
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('ok') }

  await providerFetch('/api/health')
  assert.deepEqual(calls, ['/api/health'])

  const ac = new AbortController()
  ac.abort()
  globalThis.fetch = async (url) => { calls.push(String(url)); throw Object.assign(Error('aborted'), { name: 'AbortError' }) }
  await assert.rejects(providerFetch('https://api.example.com/v1/models', { signal: ac.signal }), /aborted/)
  assert.deepEqual(calls.filter((u) => u.startsWith('/api/proxy')), [])
})
