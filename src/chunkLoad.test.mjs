import test from 'node:test'
import assert from 'node:assert/strict'
import { loadChunk } from './chunkLoad'

// The helper reads these two globals at call time, so plain stand-ins are enough.
const cache = new Map()
globalThis.sessionStorage = {
  getItem: (k) => (cache.has(k) ? cache.get(k) : null),
  setItem: (k, v) => { cache.set(k, String(v)) },
  removeItem: (k) => { cache.delete(k) },
}
globalThis.location = { reloads: 0, reload() { this.reloads++ } }

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))

/* A failing dynamic import, as a browser reports a chunk the new build
 * replaced. */
const gone = () => Promise.reject(Error('Failed to fetch dynamically imported module: /assets/Rich-old.js'))

test('a chunk that loads first time is returned without touching the shell', async () => {
  cache.clear()
  globalThis.location.reloads = 0
  assert.equal(await loadChunk(() => Promise.resolve('rich')), 'rich')
  assert.equal(globalThis.location.reloads, 0)
})

test('a request that fails once is retried before anything heavier', async () => {
  cache.clear()
  globalThis.location.reloads = 0
  let calls = 0
  const value = await loadChunk(() => (++calls === 1 ? Promise.reject(new Error('network')) : Promise.resolve('rich')))
  assert.equal(value, 'rich')
  assert.equal(calls, 2)
  assert.equal(globalThis.location.reloads, 0)
})

test('a chunk that is really gone reloads once for the fresh shell', async () => {
  cache.clear()
  globalThis.location.reloads = 0
  let settled = null
  const pending = loadChunk(gone)
  void pending.then(() => { settled = 'resolved' }, () => { settled = 'rejected' })
  await settle()
  assert.equal(globalThis.location.reloads, 1)
  // The reload gets a grace period: the renderer must not settle into a React
  // tree that is about to be thrown away with the document.
  assert.equal(settled, null)
  assert.ok(cache.get('byok:chunk-reload'))
  // ...and then it does settle, so a reload the browser refuses to perform
  // cannot leave whatever was Suspense-waiting pending forever.
  await assert.rejects(pending, /Failed to fetch/)
})

test('a failure right after the reload is surfaced instead of looping', async () => {
  cache.set('byok:chunk-reload', String(Date.now()))
  globalThis.location.reloads = 0
  await assert.rejects(loadChunk(() => Promise.reject(new Error('still 404'))), /still 404/)
  assert.equal(globalThis.location.reloads, 0)
})

/* The page can refuse to unload: App.tsx registers a `beforeunload` handler
 * while a research run is in flight, so `location.reload()` returns and the
 * document stays. The load must still settle, or whatever was Suspense-waiting
 * (Settings, the palette, the share view) waits forever. */
test('a blocked reload still settles instead of hanging', async () => {
  cache.clear()
  globalThis.location.reloads = 0
  // Race against a timer so a regression fails this test instead of wedging
  // the whole run (which is exactly what it did before the fix).
  const settled = await Promise.race([
    loadChunk(gone).then(() => 'resolved', (error) => error),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 4000)),
  ])
  assert.notEqual(settled, 'hung', 'loadChunk must settle when the reload is blocked')
  assert.match(String(settled?.message), /Failed to fetch/)
  assert.equal(globalThis.location.reloads, 1, 'the recovery reload is still attempted')
})

test('storage that throws leaves the page alone and surfaces the error', async () => {
  const storage = globalThis.sessionStorage
  globalThis.sessionStorage = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') } }
  globalThis.location.reloads = 0
  try {
    await assert.rejects(loadChunk(gone), /Failed to fetch/)
    assert.equal(globalThis.location.reloads, 0)
  } finally {
    globalThis.sessionStorage = storage
  }
})
