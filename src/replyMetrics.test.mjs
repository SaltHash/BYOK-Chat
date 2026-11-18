import test from 'node:test'
import assert from 'node:assert/strict'

const { outputTokensOf, messageCostOf, formatCost, exactCost, replySpeed, MIN_SPEED_MS } = await import('../src/replyMetrics.ts')

test('generation speed uses streamed text over active generation time only', () => {
  // 400 chars over 2s of actual generation = 50 tokens/s at 4 chars/token.
  assert.equal(replySpeed(400, 2000), 50)
  // Character counts round up to whole tokens before the rate is taken.
  assert.equal(replySpeed(401, 2000), 50.5)
  // Nothing to measure: a one-shot response or an empty reply reports no speed
  // instead of inventing one from the provider's usage figure.
  assert.equal(replySpeed(0, 2000), null)
  assert.equal(replySpeed(400, 0), null)
  assert.equal(replySpeed(400, MIN_SPEED_MS - 1), null)
  assert.equal(replySpeed(Number.NaN, 2000), null)
})

test('output token stats prefer the persisted output count', () => {
  assert.equal(outputTokensOf({ tokensOut: 42, log: [{ n: 'x', m: 'm', tout: 99 }] }), 42)
  assert.equal(outputTokensOf({ log: [{ n: 'x', m: 'm', tout: 20 }, { n: 'x', m: 'm', tout: 99 }] }), 99)
  assert.equal(outputTokensOf({ log: [{ n: 'x', m: 'm', contextTout: 30 }] }), 30)
  assert.equal(outputTokensOf({}), 0)
})

test('message cost sums provider-reported spend across attempts', () => {
  const cost = messageCostOf([], [
    { n: 'Test', m: 'model', cost: 0.002 },
    { n: 'Test', m: 'model', cost: 0.003 },
  ])
  assert.deepEqual(cost, { total: 0.005, estimated: false })
})

test('message cost falls back to the endpoint price table and marks it estimated', () => {
  const eps = [{ name: 'Test', prices: { model: { input: 2, output: 4 } } }]
  const cost = messageCostOf(eps, [{ n: 'Test', m: 'model', tin: 1_000_000, tout: 500_000 }])
  assert.deepEqual(cost, { total: 4, estimated: true })
})

test('message cost is unavailable without a reported cost or a price', () => {
  assert.equal(messageCostOf([], [{ n: 'Test', m: 'model', tin: 10, tout: 20 }]), null)
  assert.equal(messageCostOf([], []), null)
})

test('footer cost formatting stays compact but exact in the title', () => {
  assert.equal(formatCost(0), '$0')
  assert.equal(formatCost(0.01234), '$0.012')
  assert.equal(formatCost(0.00042), '$0.0004')
  assert.equal(formatCost(1.234), '$1.23')
  assert.equal(exactCost(0.00042), '$0.00042')
})
