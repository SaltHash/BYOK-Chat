import test from 'node:test'
import assert from 'node:assert/strict'

const { createFrameThrottle } = await import('./throttle.ts')

const makeFrames = () => {
  let queue = []
  return {
    request: (fn) => { const h = { fn }; queue.push(h); return queue.length },
    cancelFrame: (handle) => { queue[handle - 1] = null },
    pump: () => { const q = queue.filter(Boolean); queue = []; for (const h of q) h.fn() },
    pending: () => queue.filter(Boolean).length,
  }
}

test('frame throttle applies the latest value once per frame', () => {
  const frames = makeFrames()
  const seen = []
  const t = createFrameThrottle((x) => seen.push(x), { request: frames.request, cancelFrame: frames.cancelFrame })
  t.call(1); t.call(2); t.call(3)
  assert.deepEqual(seen, [], 'nothing runs before the frame')
  assert.equal(frames.pending(), 1, 'one frame scheduled for the burst')
  frames.pump()
  assert.deepEqual(seen, [3], 'only the newest value is applied')
})

test('frame throttle re-arms for the next frame', () => {
  const frames = makeFrames()
  const seen = []
  const t = createFrameThrottle((x) => seen.push(x), { request: frames.request, cancelFrame: frames.cancelFrame })
  t.call('a')
  frames.pump()
  t.call('b')
  frames.pump()
  assert.deepEqual(seen, ['a', 'b'])
})

test('flush applies immediately and cancels the pending frame', () => {
  const frames = makeFrames()
  const seen = []
  const t = createFrameThrottle((x) => seen.push(x), { request: frames.request, cancelFrame: frames.cancelFrame })
  t.call('final')
  t.flush()
  assert.deepEqual(seen, ['final'])
  assert.equal(frames.pending(), 0)
  frames.pump()
  assert.deepEqual(seen, ['final'], 'the cancelled frame does not run twice')
})

test('flush without pending work is a no-op', () => {
  const frames = makeFrames()
  const seen = []
  const t = createFrameThrottle((x) => seen.push(x), { request: frames.request, cancelFrame: frames.cancelFrame })
  t.flush()
  assert.deepEqual(seen, [])
})

test('cancel drops the pending value', () => {
  const frames = makeFrames()
  const seen = []
  const t = createFrameThrottle((x) => seen.push(x), { request: frames.request, cancelFrame: frames.cancelFrame })
  t.call('dropped')
  t.cancel()
  frames.pump()
  assert.deepEqual(seen, [])
})
