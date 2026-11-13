import test from 'node:test'
import assert from 'node:assert/strict'

const { readApproximateLocation } = await import('../src/location.ts')

const geo = (getCurrentPosition) => ({ getCurrentPosition })
const jsonResponse = (body) => ({ ok: true, json: async () => body })

test('uses browser coordinates when the location service succeeds', async () => {
  let fetched = false
  const result = await readApproximateLocation({
    geolocation: geo((success) => success({ coords: { latitude: 30.2672, longitude: -97.7431 } })),
    fetch: async () => { fetched = true; return jsonResponse({}) },
  })
  assert.equal(result, '30.2672, -97.7431')
  assert.equal(fetched, false)
})

test('does not bypass an explicitly denied permission with an IP lookup', async () => {
  let fetched = false
  await assert.rejects(
    readApproximateLocation({
      geolocation: geo((_success, error) => error?.({ code: 1, message: 'User denied Geolocation' })),
      fetch: async () => { fetched = true; return jsonResponse({}) },
    }),
    /permission was denied/i,
  )
  assert.equal(fetched, false)
})

test('falls back to an IP estimate when the browser provider response is malformed', async () => {
  const result = await readApproximateLocation({
    geolocation: geo((_success, error) => error?.({ code: 2, message: 'Response was malformed' })),
    fetch: async () => jsonResponse({
      success: true,
      latitude: 30.2672,
      longitude: -97.7431,
      city: 'Austin',
      region: 'Texas',
      country: 'United States',
    }),
  })
  assert.equal(result, '30.2672, -97.7431 (approximate; Austin, Texas, United States)')
})

test('tries the second IP provider when the first one fails', async () => {
  const urls = []
  const result = await readApproximateLocation({
    geolocation: null,
    fetch: async (url) => {
      urls.push(url)
      if (urls.length === 1) return { ok: false, json: async () => ({}) }
      return jsonResponse({ latitude: '51.5074', longitude: '-0.1278', city: 'London', country: 'United Kingdom' })
    },
  })
  assert.equal(urls.length, 2)
  assert.equal(result, '51.5074, -0.1278 (approximate; London, United Kingdom)')
})

test('reports a useful error when both browser and network location fail', async () => {
  await assert.rejects(
    readApproximateLocation({
      geolocation: geo((_success, error) => error?.({ code: 3, message: 'Timeout expired' })),
      fetch: async () => { throw new Error('offline') },
    }),
    /Could not determine an approximate location: Timeout expired\. Share a city or neighborhood instead\./,
  )
})
