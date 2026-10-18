import test from 'node:test'
import assert from 'node:assert/strict'

const { flipDelta, insertionIndex, rowMidpoints, dndDirection } = await import('./dndShared.ts')

test('flipDelta is a plain FLIP when the row was at rest', () => {
  // Layout moved 40px down; the row starts 40px above its new slot.
  assert.equal(flipDelta(100, 140, 140), -40)
})

test('flipDelta continues an interrupted animation from its visual position', () => {
  // Previous layout 100, current layout 150, 30px of translate left over.
  const previous = 100
  const target = 150
  const visual = target - 30
  const delta = flipDelta(previous, visual, target)
  assert.equal(delta, -80, 'start = previous visual (70) - target (150)')
  assert.equal(target + delta, previous + (visual - target), 'no jump on interruption')
})

test('rapid layout changes never snap a row off its visual track', () => {
  // Fast drag: the placeholder crosses five rows (200px) every frame while the
  // previous 180ms easing is still only ~20% done. Each commit must start the
  // row exactly where the user last saw it.
  const STEP = -200
  let layout = 1000
  let residual = 0 // current translate relative to `layout` (0 = settled)

  for (let frame = 0; frame < 10; frame++) {
    const currentVisual = layout + residual
    const target = layout + STEP
    // Measured after the commit with the in-flight transform still applied.
    const visual = target + residual
    const delta = flipDelta(layout, visual, target)
    assert.ok(
      Math.abs(target + delta - currentVisual) < 1e-9,
      `frame ${frame}: animation must start at the current visual position, not the previous slot`,
    )
    // Ease toward the new slot: leftover after one frame of a 180ms transition.
    residual = delta * 0.8
    layout = target
  }
})

test('insertionIndex keeps midpoint hysteresis in both directions', () => {
  const mids = rowMidpoints([{ top: 0, height: 40 }, { top: 40, height: 40 }])
  assert.deepEqual(mids, [20, 60])
  // Moving down needs to clear the midpoint by 4px; moving up must clear it the
  // other way, which is what stops flicker right on a boundary.
  assert.equal(insertionIndex(mids, 22, dndDirection(22, 10)), 1)
  assert.equal(insertionIndex(mids, 14, dndDirection(14, 10)), 0)
  assert.equal(insertionIndex(mids, 26, dndDirection(26, 30)), 1)
  assert.equal(insertionIndex(mids, 22, dndDirection(22, 30)), 0)
})
