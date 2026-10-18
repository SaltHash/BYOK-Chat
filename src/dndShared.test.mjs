import test from 'node:test'
import assert from 'node:assert/strict'

const { flipDelta, stepInsertion, rowMidpoints, parseTranslateY } = await import('./dndShared.ts')

test('flipDelta is a plain FLIP when the row was at rest', () => {
  // Layout moved 40px down; the row starts 40px above its new slot.
  assert.equal(flipDelta(100, 0, 140), -40)
})

test('flipDelta continues an interrupted animation from its visual position', () => {
  // Row laid out at 100, mid-animation 30px lower (visual 130), then the layout
  // moves to 150. It must start at 130, not jump back to 100.
  const delta = flipDelta(100, 30, 150)
  assert.equal(150 + delta, 130)
})

test('repeated commits during a fast drag never teleport a row', () => {
  // Each commit: the row's visual position is layout + running animation. The
  // next commit must start exactly where the row is on screen.
  let layout = 1000
  let anim = 0
  for (let frame = 0; frame < 10; frame++) {
    const visualBefore = layout + anim
    const nextLayout = layout - 200
    const delta = flipDelta(layout, anim, nextLayout)
    assert.equal(nextLayout + delta, visualBefore, `frame ${frame}`)
    anim = delta * 0.8 // 80% through an easing step
    layout = nextLayout
  }
})

test('stepInsertion only moves past a midpoint by the bias band', () => {
  const mids = rowMidpoints([{ top: 0, height: 40 }, { top: 40, height: 40 }])
  assert.deepEqual(mids, [20, 60])
  assert.equal(stepInsertion(mids, 22, 0), 0, 'inside band: stays')
  assert.equal(stepInsertion(mids, 26, 0), 1, 'past midpoint + bias: moves down')
  assert.equal(stepInsertion(mids, 22, 1), 1, 'reversing inside band: stays')
  assert.equal(stepInsertion(mids, 14, 1), 0, 'past midpoint - bias: moves up')
})

test('stepInsertion jumps several rows in one step when the pointer races', () => {
  const mids = [20, 60, 100, 140]
  assert.equal(stepInsertion(mids, 130, 0), 3)
  assert.equal(stepInsertion(mids, 10, 3), 0)
})

test('parseTranslateY reads matrix and matrix3d transforms', () => {
  assert.equal(parseTranslateY('none'), 0)
  assert.equal(parseTranslateY('matrix(1, 0, 0, 1, 0, 42.5)'), 42.5)
  assert.equal(parseTranslateY('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,3,-7.25,0,1)'), -7.25)
})
