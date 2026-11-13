import test from 'node:test'
import assert from 'node:assert/strict'

const { outputTokensOf, messageCostOf, formatCost, exactCost } = await import('../src/replyMetrics.ts')

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
