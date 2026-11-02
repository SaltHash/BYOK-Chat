import test from 'node:test'
import assert from 'node:assert/strict'

// The helper reads these two globals at call time, so plain stand-ins are enough.
const cache = new Map()
globalThis.sessionStorage = {
  getItem: (k) => (cache.has(k) ? cache.get(k) : null),
  setItem: (k, v) => { cache.set(k, String(v)) },
  removeItem: (k) => { cache.delete(k) },
}
globalThis.location = { reloads: 0, reload() { this.reloads++ } }

const { loadChunk } = await import('./chunkLoad.ts')
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))

test('a chunk that loads first time is returned without touching the shell', async () => {
  assert.equal(await loadChunk(() => Promise.resolve('rich')), 'rich')
  assert.equal(globalThis.location.reloads, 0)
})

test('a request that fails once is retried before anything heavier', async () => {
  let calls = 0
  const value = await loadChunk(() => (++calls === 1 ? Promise.reject(new Error('network')) : Promise.resolve('rich')))
  assert.equal(value, 'rich')
  assert.equal(calls, 2)
  assert.equal(globalThis.location.reloads, 0)
})

test('a chunk that is really gone reloads once for the fresh shell', async () => {
  let settled = null
  const pending = loadChunk(() => Promise.reject(new Error('404')))
  void pending.then(() => { settled = 'resolved' }, () => { settled = 'rejected' })
  await settle()
  assert.equal(globalThis.location.reloads, 1)
  // The document is unloading: the renderer must not resolve or reject into a
  // React tree that is about to be thrown away.
  assert.equal(settled, null)
  assert.ok(globalThis.sessionStorage.getItem('byok:chunk-reload'))
})

test('a failure right after the reload is surfaced instead of looping', async () => {
  await assert.rejects(loadChunk(() => Promise.reject(new Error('still 404'))), /still 404/)
  assert.equal(globalThis.location.reloads, 1)
})
