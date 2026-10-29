import test from 'node:test'
import assert from 'node:assert/strict'

const g = await import('../src/graph.ts')

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} should be close to ${b}`)

test('arithmetic respects precedence, implicit multiplication, powers, and functions', () => {
  assert.equal(g.compileExpression('2(3+4)').evaluate(0, 0), 14)
  assert.equal(g.compileExpression('2x + 1').evaluate(3, 0), 7)
  assert.equal(g.compileExpression('x^2').evaluate(3, 0), 9)
  assert.equal(g.compileExpression('-x^2').evaluate(2, 0), -4)
  assert.equal(g.compileExpression('2^3^2').evaluate(0, 0), 512)
  close(g.compileExpression('sin(pi/2)').evaluate(0, 0), 1)
  assert.equal(g.compileExpression('sqrt(16)').evaluate(0, 0), 4)
  close(g.compileExpression('e^0').evaluate(0, 0), 1)
})

test('explicit, implicit, and inequality relations compile correctly', () => {
  const line = g.compileRelation('y = x + 1')
  assert.equal(line.kind, 'explicit')
  assert.equal(line.f(2), 3)
  assert.equal(line.relation, '=')

  const circle = g.compileRelation('x^2 + y^2 = 1')
  assert.equal(circle.kind, 'implicit')
  close(circle.residual(1, 0), 0)
  close(circle.residual(0, 0), -1)

  const above = g.compileRelation('y > x^2')
  assert.equal(above.kind, 'implicit')
  assert.equal(above.relation, '>')
  assert.equal(above.test(0, 1), true)
  assert.equal(above.test(0, -1), false)

  const vertical = g.compileRelation('x = 2')
  assert.equal(vertical.kind, 'implicit')
  close(vertical.residual(2, 7), 0)
})

test('bare expressions become functions and f(x)= is accepted', () => {
  close(g.compileRelation('sin(x)').f(Math.PI / 2), 1)
  close(g.compileRelation('f(x) = x^2 - 1').f(3), 8)
  close(g.compileRelation('x^2 + y^2 - 1').residual(1, 0), 0)
})

test('invalid equations produce a useful parse error instead of throwing unexpectedly', () => {
  assert.throws(() => g.compileRelation('y = '), /empty|ended/i)
  assert.throws(() => g.compileRelation('y = x $ 2'), /unexpected/i)
  assert.throws(() => g.compileRelation('y = mystery(x)'), /unknown/i)
})

test('sampleExplicit breaks at asymptotes and keeps finite points', () => {
  const segs = g.sampleExplicit((x) => 1 / x, [-4, 4], [-4, 4], 400)
  assert.ok(segs.length >= 2, '1/x should produce two branches')
  for (const seg of segs) for (const p of seg) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
  }
  assert.ok(segs.every((s) => s.every((p) => Math.abs(p.y) <= 28)))
})

test('marching squares traces a unit circle and its bounds', () => {
  const circle = g.compileRelation('x^2 + y^2 = 1')
  const segs = g.contourSegments(circle.residual, [-2, 2], [-2, 2], 80, 80)
  assert.ok(segs.length > 40, 'expected a closed contour')
  for (const [p, q] of segs) {
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 1) < 0.05)
    assert.ok(Math.abs(Math.hypot(q.x, q.y) - 1) < 0.05)
  }
})

test('inequality regions merge into rows and include the right half-plane', () => {
  const rel = g.compileRelation('y > x^2')
  const runs = g.regionRuns(rel.test, [-2, 2], [-1, 3], 80, 60)
  assert.ok(runs.length > 0)
  assert.ok(runs.some((r) => r.y + r.h / 2 > 1.5 && r.x <= 0 && r.x + r.w >= 0))
  assert.ok(!runs.some((r) => r.y + r.h / 2 < -0.5))
})

test('view fitting keeps equal scale for a circle', () => {
  const spec = g.normalizeGraphSpec({ equations: ['x^2 + y^2 = 1'] })
  const d = g.computeGraphDomain(spec, 1.8)
  const spanX = d.x[1] - d.x[0], spanY = d.y[1] - d.y[0]
  close(spanX / spanY, 1.8, 0.02)
  assert.ok(d.x[0] < -1.5 && d.x[1] > 1.5)
  assert.ok(d.y[0] < -1.02 && d.y[1] > 1.02)
})

test('a mixed geometry and function graph uses the geometry extent, not the default window', () => {
  const mixed = g.normalizeGraphSpec({
    equations: ['y = x + 1', 'x^2 + y^2 = 1'],
    points: [[0, 0]],
  })
  const d = g.computeGraphDomain(mixed, 1.8)
  assert.ok(d.x[1] - d.x[0] < 14, `x span should stay near the circle, got ${d.x[1] - d.x[0]}`)
  assert.ok(d.y[0] < -1.05 && d.y[1] > 1.05, 'the circle must stay inside the y view')
})

test('a function-only graph keeps the familiar default window', () => {
  const fn = g.normalizeGraphSpec({ equations: ['y = x^2'] })
  const d = g.computeGraphDomain(fn, 1.8)
  assert.ok(d.x[0] <= -9 && d.x[1] >= 9)
  assert.equal(fn.aspect, 'auto')
})

test('normalization accepts pairs, objects, colors and flexible series', () => {
  const spec = g.normalizeGraphSpec({
    title: 'Sales',
    equations: [{ expression: 'y = 2x + 1', color: 'red', label: 'Trend' }],
    series: [
      { points: [[0, 1], [1, 3], { x: 2, y: 7, label: 'peak' }], connect: true, color: 'green' },
      { points: [{ x: 0, y: 2 }], type: 'bar', color: 'purple' },
    ],
    points: [[4, 2]],
    shapes: [{ type: 'circle', center: [1, 1], radius: 2, color: 'blue' }],
    xRange: [0, 5],
  })
  assert.equal(spec.title, 'Sales')
  assert.equal(spec.curves.length, 1)
  assert.equal(spec.curves[0].color, 'red')
  assert.equal(spec.series.length, 2)
  assert.equal(spec.series[0].kind, 'line')
  assert.equal(spec.series[0].points[2].label, 'peak')
  assert.equal(spec.series[1].kind, 'bar')
  assert.equal(spec.points.length, 1)
  assert.equal(spec.shapes.length, 1)
  assert.deepEqual(spec.xRange, [0, 5])
})

test('paired columns, labels and a circle given x/y both normalize', () => {
  const spec = g.normalizeGraphSpec({
    series: [{ x: [0, 1, 2], y: [4, 5, 9], labels: ['a', 'b', 'c'], kind: 'bar', color: 'teal' }],
    shapes: [{ type: 'circle', x: 1, y: 2, radius: 1 }],
  })
  assert.deepEqual(spec.series[0].points.map((p) => [p.x, p.y, p.label]), [[0, 4, 'a'], [1, 5, 'b'], [2, 9, 'c']])
  assert.deepEqual(spec.shapes[0], { type: 'circle', center: { x: 1, y: 2 }, radius: 1, color: 'black', width: 2, pattern: 'solid', opacity: 1, fill: false })
})

test('unicode inequalities and superscripts are accepted', () => {
  const rel = g.compileRelation('y ≥ x²')
  assert.equal(rel.relation, '>=')
  assert.equal(rel.test(2, 5), true)
  assert.equal(rel.test(1, 0.5), false)
})

test('unspecified and unknown colors fall back to black', () => {
  const spec = g.normalizeGraphSpec({ equations: ['y = x', { expression: 'y = 2x', color: 'chartreuse' }] })
  assert.equal(spec.curves[0].color, 'black')
  assert.equal(spec.curves[1].color, 'black')
})

test('bad entries are reported without dropping the rest of the graph', () => {
  const spec = g.normalizeGraphSpec({ equations: ['y = x', 'y = )'] })
  assert.equal(spec.curves.length, 1)
  assert.equal(spec.errors.length, 1)
  assert.match(g.summarizeGraphSpec(spec), /skipped/i)
})

test('summary counts content and tells the model not to repeat coordinates', () => {
  const spec = g.normalizeGraphSpec({ title: 'Parabola', equations: ['y = x^2'], points: [[0, 0]] })
  const text = g.summarizeGraphSpec(spec)
  assert.match(text, /Parabola/)
  assert.match(text, /1 equation/)
  assert.match(text, /1 point/)
  assert.match(text, /Do not repeat/)
})

test('nice ticks use readable steps and include zero exactly once', () => {
  const { ticks, step } = g.niceTicks(-1, 1, 4)
  assert.equal(step, 0.5)
  assert.ok(ticks.includes(0))
  assert.equal(ticks.filter((t) => t === 0).length, 1)
  assert.equal(g.formatTick(-0.0000001, 0.5), '0')
})

test('series connect by default, while scatter, connect:false and a lone point stay dots', () => {
  const spec = g.normalizeGraphSpec({
    series: [
      { points: [[0, 0], [1, 1]] },
      { points: [[0, 0], [1, 1]], kind: 'scatter' },
      { points: [[2, 3]] },
      { points: [[0, 0], [1, 1]], connect: false },
      { x: [0, 1, 2], y: [1, 2, 4], labels: ['A', 'B', 'C'], kind: 'bar' },
    ],
  })
  assert.deepEqual(spec.series.map((s) => s.kind), ['line', 'scatter', 'scatter', 'scatter', 'bar'])
  assert.deepEqual(spec.series[4].points.map((p) => p.label), ['A', 'B', 'C'])
})

test('placement defaults to inline-left and accepts right and below', () => {
  const at = (raw) => g.normalizeGraphSpec({ equations: ['y = x'], ...raw }).placement
  assert.equal(at({}), 'left')
  assert.equal(at({ placement: 'left' }), 'left')
  assert.equal(at({ placement: 'right' }), 'right')
  assert.equal(at({ placement: 'below' }), 'below')
  assert.equal(at({ placement: 'bottom' }), 'below')
  assert.equal(at({ side: 'right' }), 'right')
  assert.equal(at({ placement: 'somewhere odd' }), 'left')
})

test('the tool summary tells the model which side the figure took', () => {
  const spec = g.normalizeGraphSpec({ equations: ['y = x'], placement: 'right' })
  const text = g.summarizeGraphSpec(spec)
  assert.match(text, /to the right of the reply text/)
  assert.match(text, /prose wrapping beside it/)
  const below = g.summarizeGraphSpec(g.normalizeGraphSpec({ equations: ['y = x'], placement: 'below' }))
  assert.match(below, /below the reply text/)
})

test('marks resolve y from the only function and keep an explicit pair', () => {
  const spec = g.normalizeGraphSpec({
    equations: ['y = x^2'],
    marks: [{ x: 2, label: 'vertex' }, [-1, 4, 'B']],
  })
  assert.equal(spec.marks.length, 2)
  assert.deepEqual(
    [spec.marks[0].x, spec.marks[0].y, spec.marks[0].label, spec.marks[0].curve],
    [2, 4, 'vertex', 0],
  )
  assert.deepEqual(
    [spec.marks[1].x, spec.marks[1].y, spec.marks[1].label, spec.marks[1].curve],
    [-1, 4, 'B', undefined],
  )
})

test('an x-only mark needs a named curve when several exist, and cannot guess y on a circle', () => {
  const ambiguous = g.normalizeGraphSpec({ equations: ['y = x', 'y = -x'], marks: [{ x: 2 }] })
  assert.equal(ambiguous.marks.length, 0)
  assert.match(ambiguous.errors.join(' '), /ambiguous/i)

  const named = g.normalizeGraphSpec({ equations: ['y = x', 'y = -x'], marks: [{ x: 2, on: 'y = x', label: 'P' }] })
  assert.equal(named.marks.length, 1)
  assert.equal(named.marks[0].y, 2)

  const byIndex = g.normalizeGraphSpec({ equations: ['y = x', 'y = -x'], marks: [{ x: 3, on: 2 }] })
  assert.equal(byIndex.marks[0].y, -3)

  const circle = g.normalizeGraphSpec({ equations: ['x^2 + y^2 = 1'], marks: [{ x: 0, label: 'top' }] })
  assert.equal(circle.marks.length, 0)
  assert.match(circle.errors.join(' '), /more than one y/i)
})

test('line patterns and translucency normalize for curves, series and shapes', () => {
  const spec = g.normalizeGraphSpec({
    equations: [
      { expression: 'x = 2', pattern: 'dash-dot', translucent: true },
      { expression: 'y = 1/x', style: 'dotted', opacity: 0.3 },
      { expression: 'y = x', dashed: true },
    ],
    series: [{ points: [[0, 0], [1, 1]], pattern: 'dashed', translucent: true }],
    shapes: [{ type: 'segment', from: [0, 0], to: [1, 1], dashed: true }],
  })
  assert.deepEqual(spec.curves.map((c) => c.pattern), ['dashdot', 'dotted', 'dashed'])
  assert.deepEqual(spec.curves.map((c) => c.opacity), [0.45, 0.3, 1])
  assert.equal(spec.series[0].pattern, 'dashed')
  assert.equal(spec.series[0].opacity, 0.45)
  assert.equal(spec.shapes[0].pattern, 'dashed')
})

test('hover snapping prefers the nearest point, then the closest point on a line', () => {
  const anchors = [{ x: 10, y: 10, kind: 'point', label: 'A' }]
  const lines = [{ points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], label: 'y = x' }]
  const onPoint = g.snapTo(anchors, lines, { x: 12, y: 11 }, 14)
  assert.equal(onPoint.kind, 'point')
  assert.equal(onPoint.label, 'A')

  const onLine = g.snapTo(anchors, lines, { x: 60, y: 66 }, 14)
  assert.equal(onLine.kind, 'curve')
  close(onLine.x, 63)
  close(onLine.y, 63)

  assert.equal(g.snapTo(anchors, lines, { x: 200, y: 200 }, 14), null)
  // A labeled point wins a near-tie against a line a couple of pixels closer.
  const biased = g.snapTo(anchors, [{ points: [{ x: 0, y: 12 }, { x: 100, y: 12 }] }], { x: 10, y: 13 }, 14)
  assert.equal(biased.kind, 'point')
})

test('closestOnPolyline projects onto the segment instead of a vertex', () => {
  const hit = g.closestOnPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 4, y: 5 })
  close(hit.x, 4)
  close(hit.y, 0)
  close(hit.distance, 5)
})

test('only single-valued function graphs get the vertical cursor guide', () => {
  assert.equal(g.isSingleValuedGraph(g.normalizeGraphSpec({ equations: ['y = x^2'] })), true)
  assert.equal(g.isSingleValuedGraph(g.normalizeGraphSpec({ equations: ['f(x) = sin(x)', 'y = x'] })), true)
  assert.equal(g.isSingleValuedGraph(g.normalizeGraphSpec({ equations: ['x^2 + y^2 = 1'] })), false)
  assert.equal(g.isSingleValuedGraph(g.normalizeGraphSpec({ equations: ['y > x^2'] })), false)
  assert.equal(g.isSingleValuedGraph(g.normalizeGraphSpec({
    equations: ['y = x'],
    series: [{ points: [[0, 1], [1, 2]], kind: 'bar' }],
  })), false)
  assert.equal(g.isSingleValuedGraph(g.normalizeGraphSpec({ equations: ['y = x'] }), () => false), false)
})

test('marks stay visible in an automatic view and are counted in the summary', () => {
  const spec = g.normalizeGraphSpec({ equations: ['y = x^2'], marks: [{ x: 12, label: 'far' }] })
  const d = g.computeGraphDomain(spec, 1.8)
  assert.ok(d.x[1] >= 12, `mark x should fit, got ${d.x[1]}`)
  assert.ok(d.y[1] >= 144, `mark y should fit, got ${d.y[1]}`)
  assert.match(g.summarizeGraphSpec(spec), /1 marked point/)
})
