import test from 'node:test'
import assert from 'node:assert/strict'

const { endpointAuthHeaders, parseCustomHeaderBlock, endpointHeaders, endpointAuthOf } = await import('./endpointAuth.ts')
const { buildStreamRequest } = await import('./streamRequest.ts')

test('custom header blocks keep safe headers and drop transport headers', () => {
  const headers = parseCustomHeaderBlock(`HTTP-Referer: https://example.com
X-Title: BYOK Chat
Host: evil.example
Content-Length: 12
Bad Header: nope
Authorization: Token abc`)
  assert.deepEqual(headers, {
    'HTTP-Referer': 'https://example.com',
    'X-Title': 'BYOK Chat',
    Authorization: 'Token abc',
  })
})

test('custom headers override auth headers case-insensitively', () => {
  const headers = endpointHeaders(
    { headers: 'authorization: Token custom\nX-Test: one' },
    { Authorization: 'Bearer default' },
  )
  assert.deepEqual(headers, { 'X-Test': 'one', authorization: 'Token custom' })
})

test('endpointAuthHeaders supports every imported auth method', () => {
  assert.deepEqual(endpointAuthHeaders({ key: 'sk', auth: 'bearer' }), { authorization: 'Bearer sk' })
  assert.deepEqual(endpointAuthHeaders({ key: 'sk', auth: 'api-key' }), { 'api-key': 'sk' })
  assert.deepEqual(endpointAuthHeaders({ key: 'sk', auth: 'x-api-key' }), { 'x-api-key': 'sk' })
  assert.deepEqual(endpointAuthHeaders({ key: 'sk', auth: 'x-goog-api-key' }), { 'x-goog-api-key': 'sk' })
  assert.deepEqual(endpointAuthHeaders({ key: '', auth: 'bearer' }), {})
  assert.deepEqual(endpointAuthHeaders({ key: 'sk', auth: 'none' }), {})
  assert.equal(endpointAuthHeaders({ key: 'user:pass', auth: 'basic' }).authorization, `Basic ${btoa('user:pass')}`)
  assert.equal(endpointAuthOf({ type: 'anthropic' }), 'x-api-key')
  assert.equal(endpointAuthOf({ type: 'openai' }), 'bearer')
})

test('buildStreamRequest uses the selected auth and custom headers', () => {
  const ep = { type: 'openai', url: 'https://custom.example/v1', key: 'k', auth: 'api-key', headers: 'X-Custom: yes', model: 'm', preset: 'Other OpenAI-compatible' }
  const req = buildStreamRequest(ep, '', [{ role: 'user', content: 'hi' }])
  assert.equal(req.headers['api-key'], 'k')
  assert.equal(req.headers.authorization, undefined)
  assert.equal(req.headers['X-Custom'], 'yes')
})

test('Anthropic requests can use a bearer token instead of x-api-key', () => {
  const ep = { type: 'anthropic', url: 'https://proxy.example/v1', key: 'token', auth: 'bearer', model: 'claude' }
  const req = buildStreamRequest(ep, '', [{ role: 'user', content: 'hi' }])
  assert.equal(req.headers.authorization, 'Bearer token')
  assert.equal(req.headers['x-api-key'], undefined)
})
