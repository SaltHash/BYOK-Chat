import test from 'node:test'
import assert from 'node:assert/strict'
import { apiRoute, searchFailureBody, searchFailureStatus, syncFailureResult } from './api.mjs'

test('apiRoute hands non-API paths back to the host and answers API 404s as JSON', async () => {
  const req = (url, method = 'GET') => ({ method, url, headers: {} })
  assert.equal(await apiRoute(req('/index.html')), null)
  assert.equal(await apiRoute(req('/apiary')), null)
  const unknown = await apiRoute(req('/api/nope'))
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.error, 'Not found')
  const bare = await apiRoute(req('/api'))
  assert.equal(bare.status, 404)
})

test('search failures map to stable codes and statuses', () => {
  assert.equal(searchFailureStatus({ code: 'missing_key' }), 400)
  assert.equal(searchFailureStatus({ code: 'missing_zone' }), 400)
  assert.equal(searchFailureStatus({ code: 'rate_limited' }), 429)
  assert.equal(searchFailureStatus({ code: 'timeout' }), 503)
  assert.equal(searchFailureStatus({ code: 'network' }), 503)
  assert.equal(searchFailureStatus({ code: 'upstream_unavailable' }), 503)
  assert.equal(searchFailureStatus({ code: 'upstream_auth', status: 401 }), 502)
  assert.equal(searchFailureStatus({ status: 500 }), 502)
  assert.equal(searchFailureStatus({ message: 'API key is missing' }), 400)
  assert.equal(searchFailureStatus({}), 502)
  const body = searchFailureBody({ code: 'upstream_auth', message: 'bad key', status: 401 }, 'exa')
  assert.equal(body.provider, 'exa')
  assert.equal(body.retryable, false)
  const missing = searchFailureBody({ code: 'missing_key', message: 'no key' }, 'exa')
  assert.equal(missing.retryable, false)
  assert.equal(searchFailureBody({ code: 'timeout', message: 'slow' }, 'exa').retryable, true)
})

test('sync failures keep client errors but never leak backend internals', () => {
  const badToken = syncFailureResult({ status: 401, code: 'bad_token', message: 'Unknown or incorrect sync token.' })
  assert.equal(badToken.status, 401)
  assert.equal(badToken.body.code, 'bad_token')
  assert.match(badToken.body.error, /Unknown or incorrect sync token/)
  const tooLarge = syncFailureResult({ status: 413, code: 'too_large', message: 'Sync payload is too large (8 MB limit).' })
  assert.equal(tooLarge.status, 413)
  const driver = syncFailureResult(new Error('connection to postgres://user:secret@db.example/neon failed'))
  assert.equal(driver.status, 503)
  assert.equal(driver.body.code, 'sync_unavailable')
  assert.ok(!JSON.stringify(driver.body).includes('secret'))
  const coded = syncFailureResult(Object.assign(Error('Sync database is unavailable'), { status: 503, code: 'sync_unavailable' }))
  assert.equal(coded.status, 503)
  assert.equal(coded.body.code, 'sync_unavailable')
})
