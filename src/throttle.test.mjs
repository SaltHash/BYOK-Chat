import test from 'node:test'
import assert from 'node:assert/strict'

const { createFrameThrottle, followStep, stickAfterScroll } = await import('./throttle.ts')

const makeFrames = () => {
  let queue = []
  return {
    request: (fn) => { const h = { fn }; queue.push(h); return queue.length },
    cancelFrame: (handle) => { queue[handle - 1] = null },
    pump: () => { const q = queue.filter(Boolean); queue = []; for (const h of q) h.fn() },
    pending: () => queue.filter(Boolean).length,
  }
}

test('follow step eases toward the end without overshooting', () => {
  assert.equal(followStep(0, 100), 30, 'moves a share of the remaining gap')
  assert.equal(followStep(99, 100), 100, 'the floor reaches a tiny gap exactly')
  assert.equal(followStep(100, 100), 100, 'already at the end')
  assert.equal(followStep(120, 100), 100, 'a shorter container lands on its end')
  let y = 0
  for (let i = 0; i < 40; i++) y = followStep(y, 500)
  assert.equal(y, 500, 'repeated steps converge on the end')
})

test('any upward scroll ends the follow, however small', () => {
  // 1000 is where the eased follow left the view; a 5px nudge up is still
  // inside the old 80px near-bottom band, and it must release the reader.
  assert.equal(stickAfterScroll(995, 1000, 2000, 900), false)
  assert.equal(stickAfterScroll(930, 1000, 2000, 900), false)
  assert.equal(stickAfterScroll(0, 1000, 2000, 900), false)
})

test('the follow keeps its own scroll events', () => {
  // The eased follow trails the end on purpose, and content can grow past the
  // band between frames: its own write must not look like the reader leaving.
  assert.equal(stickAfterScroll(1000, 1000, 2000, 900), null)
  assert.equal(stickAfterScroll(1001.5, 1000, 2000, 900), null)
})

test('scrolling back to the end resumes the follow, stopping short does not', () => {
  assert.equal(stickAfterScroll(1100, 1000, 2000, 900), true, 'at the end')
  assert.equal(stickAfterScroll(1090, 1000, 2000, 900), true, 'within the band')
  assert.equal(stickAfterScroll(1010, 1000, 2000, 900), false, 'moved down but still reading back')
})

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
