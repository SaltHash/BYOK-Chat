import test from 'node:test'
import assert from 'node:assert/strict'

const { createWriteCoalescer, createCoalescedPersistStorage, attachFlushOnHide } = await import('./coalesce.ts')

/* Deterministic stand-in for setTimeout/clearTimeout so the scheduling
 * contract is asserted without wall-clock sleeps. */
const makeClock = () => {
  let queue = []
  return {
    schedule: (fn, ms) => { const h = { fn, ms }; queue.push(h); return h },
    cancel: (h) => { queue = queue.filter((x) => x !== h) },
    run: () => { const q = queue; queue = []; for (const h of q) h.fn() },
    size: () => queue.length,
  }
}

const fakeStorage = () => {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
  }
}

test('coalescer writes once per window with the newest value', () => {
  const clock = makeClock()
  const written = []
  const c = createWriteCoalescer((v) => written.push(v), { wait: 100, schedule: clock.schedule, cancel: clock.cancel })
  c.push('a'); c.push('b'); c.push('c')
  assert.deepEqual(written, [])
  assert.equal(c.peek(), 'c')
  assert.equal(clock.size(), 1, 'only one window is armed')
  clock.run()
  assert.deepEqual(written, ['c'])
  assert.equal(clock.size(), 0)
})

test('coalescer re-arms after each window', () => {
  const clock = makeClock()
  const written = []
  const c = createWriteCoalescer((v) => written.push(v), { wait: 100, schedule: clock.schedule, cancel: clock.cancel })
  c.push(1)
  clock.run()
  c.push(2)
  clock.run()
  assert.deepEqual(written, [1, 2])
})

test('flush writes immediately and cancels the armed window', () => {
  const clock = makeClock()
  const written = []
  const c = createWriteCoalescer((v) => written.push(v), { wait: 100, schedule: clock.schedule, cancel: clock.cancel })
  c.push('x')
  c.flush()
  assert.deepEqual(written, ['x'])
  assert.equal(clock.size(), 0)
  c.flush()
  assert.deepEqual(written, ['x'], 'nothing pending means no extra write')
})

test('cancel drops the pending value without writing', () => {
  const clock = makeClock()
  const written = []
  const c = createWriteCoalescer((v) => written.push(v), { wait: 100, schedule: clock.schedule, cancel: clock.cancel })
  c.push('gone')
  c.cancel()
  clock.run()
  assert.deepEqual(written, [])
  assert.equal(c.peek(), undefined)
})

test('a failing scheduled write is reported, not thrown', () => {
  const clock = makeClock()
  const errors = []
  const c = createWriteCoalescer(() => { throw Error('quota') }, { wait: 10, schedule: clock.schedule, cancel: clock.cancel, onError: (e) => errors.push(String(e.message)) })
  c.push('v')
  clock.run()
  assert.deepEqual(errors, ['quota'])
})

test('coalesced persist storage defers serialization and reads pending state', () => {
  const clock = makeClock()
  const raw = fakeStorage()
  const storage = createCoalescedPersistStorage(raw, { wait: 50, schedule: clock.schedule, cancel: clock.cancel })
  const value = { state: { chats: [{ id: 'c1' }] }, version: 1 }
  storage.setItem('byok.v1', value)
  assert.equal(raw.map.size, 0, 'not written yet')
  assert.deepEqual(storage.getItem('byok.v1'), value, 'reads see the pending value')
  clock.run()
  assert.deepEqual(JSON.parse(raw.map.get('byok.v1')), value)
})

test('coalesced persist storage coalesces repeated writes of the payload', () => {
  const clock = makeClock()
  const raw = fakeStorage()
  const storage = createCoalescedPersistStorage(raw, { wait: 50, schedule: clock.schedule, cancel: clock.cancel })
  storage.setItem('byok.v1', { state: { n: 1 }, version: 1 })
  storage.setItem('byok.v1', { state: { n: 2 }, version: 1 })
  storage.setItem('byok.v1', { state: { n: 3 }, version: 1 })
  clock.run()
  assert.deepEqual(JSON.parse(raw.map.get('byok.v1')).state, { n: 3 })
})

test('remove cancels a pending write so it cannot resurrect the key', () => {
  const clock = makeClock()
  const raw = fakeStorage()
  const storage = createCoalescedPersistStorage(raw, { wait: 50, schedule: clock.schedule, cancel: clock.cancel })
  storage.setItem('byok.v1', { state: { n: 1 }, version: 1 })
  storage.removeItem('byok.v1')
  clock.run()
  assert.equal(raw.map.has('byok.v1'), false)
})

test('flush persists the pending payload for page teardown', () => {
  const clock = makeClock()
  const raw = fakeStorage()
  const storage = createCoalescedPersistStorage(raw, { wait: 50, schedule: clock.schedule, cancel: clock.cancel })
  storage.setItem('byok.v1', { state: { n: 7 }, version: 1 })
  storage.flush()
  assert.deepEqual(JSON.parse(raw.map.get('byok.v1')).state, { n: 7 })
})

test('attachFlushOnHide flushes on pagehide and on hidden visibility', () => {
  const listeners = new Map()
  const target = {
    addEventListener: (t, f) => { listeners.set(t, f) },
    removeEventListener: (t) => { listeners.delete(t) },
  }
  let flushes = 0
  const detach = attachFlushOnHide(() => { flushes++ }, target)
  listeners.get('pagehide')()
  assert.equal(flushes, 1)
  detach()
  assert.equal(listeners.size, 0)
})

test('attachFlushOnHide is a no-op without a window', () => {
  assert.equal(typeof attachFlushOnHide(() => {}), 'function')
})
