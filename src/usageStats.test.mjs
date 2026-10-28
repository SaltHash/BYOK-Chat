import test from 'node:test'
import assert from 'node:assert/strict'

const {
  statsRange, inRange, attemptContexts, buildUsageRecords, buildUsageRecordsFrom,
  recordsInRange, tokensOf, summarize, aggregateModels, sortModels, findModel,
  modelKey, chartBuckets, bucketUnitFor, bucketStart, nextBucket, chartSpan,
  seriesTotals, rangeLabel, money, moneyExact, compactTokens, costPerMillion,
  percentOf, sharePct, USAGE_PERIODS,
} = await import('./usageStats.ts')
const { attemptCost, allAttemptLogs, allAttemptAts, SESSION_START } = await import('./usage.ts')

const HOUR = 3_600_000
const DAY = 24 * HOUR

const eps = [
  {
    id: 'e1', name: 'Alpha', on: true, url: 'https://a', model: 'm1',
    models: ['m1', 'shared', 'cheap'],
    modelNames: { m1: 'Alpha One' },
    prices: {
      m1: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2.5 },
      shared: { input: 1, output: 2 },
      cheap: { input: 1, output: 1 },
    },
  },
  { id: 'e2', name: 'Beta', on: true, url: 'https://b', model: 'm1', models: ['m1', 'shared'] },
]

const at = (h) => new Date(2026, 0, 5, 12, 0, 0).getTime() + h * HOUR

const attempt = (over = {}) => ({ n: 'Alpha', m: 'm1', tin: 100, tout: 20, at: at(0), ...over })

const chat = (msgs) => ({ id: 'c1', title: 'First chat', msgs })

test('period ranges cover session, 24h, 7d, 30d, all time and custom', () => {
  const now = 100 * DAY
  assert.deepEqual(statsRange({ period: 'day', now }), { start: now - DAY, end: Infinity, period: 'day', invalid: false })
  assert.deepEqual(statsRange({ period: 'week', now }), { start: now - 7 * DAY, end: Infinity, period: 'week', invalid: false })
  assert.deepEqual(statsRange({ period: 'month', now }), { start: now - 30 * DAY, end: Infinity, period: 'month', invalid: false })
  assert.deepEqual(statsRange({ period: 'all', now }), { start: 0, end: Infinity, period: 'all', invalid: false })
  assert.deepEqual(statsRange({ period: 'session', now }), { start: SESSION_START, end: Infinity, period: 'session', invalid: false })
  assert.deepEqual(USAGE_PERIODS.map(([k]) => k), ['session', 'day', 'week', 'month', 'all', 'custom'])
})

test('custom ranges are inclusive of the Through date and invalid ranges are explicit', () => {
  const r = statsRange({ period: 'custom', from: '1970-01-02', to: '1970-01-03' })
  assert.equal(r.invalid, false)
  assert.equal(r.start, new Date(1970, 0, 2).getTime())
  assert.equal(r.end, new Date(1970, 0, 4).getTime())
  const oneDay = statsRange({ period: 'custom', from: '2026-01-02', to: '2026-01-02' })
  assert.equal(oneDay.end - oneDay.start, DAY, 'a single Through day is included')

  assert.equal(statsRange({ period: 'custom', from: '2026-02-02', to: '2026-02-01' }).invalid, true)
  assert.equal(statsRange({ period: 'custom', from: 'nope', to: '2026-02-01' }).invalid, true)
  assert.equal(statsRange({ period: 'custom', from: '2026-01-01', to: '2026-13-70' }).invalid, true)

  const openFrom = statsRange({ period: 'custom', from: '2026-01-01', to: '' })
  assert.equal(openFrom.invalid, false)
  assert.equal(openFrom.end, Infinity)
  const openTo = statsRange({ period: 'custom', from: '', to: '2026-01-01' })
  assert.equal(openTo.start, 0)
  assert.deepEqual(statsRange({ period: 'bogus', now: 5 }), { start: 0, end: Infinity, period: 'all', invalid: false })
})

test('half-open membership excludes the custom Through boundary', () => {
  const r = statsRange({ period: 'custom', from: '2026-01-02', to: '2026-01-02' })
  assert.equal(inRange(r.start, r), true)
  assert.equal(inRange(r.end - 1, r), true)
  assert.equal(inRange(r.end, r), false)
  assert.equal(inRange(r.start - 1, r), false)
  assert.equal(inRange(0, statsRange({ period: 'custom', from: '2026-02-02', to: '2026-02-01' })), false)
})

test('records fall back to the owning message timestamp', () => {
  const chats = [chat([
    { id: 'a1', r: 'assistant', at: at(3), log: [{ n: 'Alpha', m: 'm1', tin: 10, tout: 1 }] },
    { id: 'u1', r: 'user', at: at(4), t: 'hi' },
  ])]
  const records = buildUsageRecords(chats, eps)
  assert.equal(records.length, 1)
  assert.equal(records[0].at, at(3))
  assert.equal(records[0].chatId, 'c1')
  assert.equal(records[0].chatTitle, 'First chat')
  assert.equal(records[0].messageId, 'a1')

  const logs = allAttemptLogs(chats), ats = allAttemptAts(chats)
  const viaNarrow = buildUsageRecordsFrom(logs, ats, attemptContexts(chats), eps)
  assert.deepEqual(viaNarrow, records)
})

test('only records inside the window survive; failures are counted, not measured', () => {
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [attempt({ at: at(0) })] },
    { id: 'a2', r: 'assistant', at: at(10), log: [attempt({ at: at(10), tin: 500, tout: 50 })] },
    { id: 'a3', r: 'assistant', at: at(8), log: [attempt({ at: at(8), err: 'boom' })] },
  ])], eps)
  const range = statsRange({ period: 'custom', from: '2026-01-05', to: '2026-01-05' })
  const inWindow = recordsInRange(records, range)
  assert.equal(inWindow.length, 3)
  const early = recordsInRange(records, statsRange({ period: 'custom', from: '2026-01-04', to: '2026-01-04' }))
  assert.equal(early.length, 0)
  const s = summarize(inWindow)
  assert.equal(s.attempts, 3)
  assert.equal(s.requests, 2)
  assert.equal(s.failed, 1)
  assert.equal(s.totalTokens, 120 + 550, 'failed attempts are excluded from token totals')
})

test('tokens count cached input exactly once and clamp bad values', () => {
  const t = tokensOf({ n: 'A', m: 'm', tin: 100, cacheRead: 30, cacheWrite: 5, tout: 20 })
  assert.deepEqual(t, { uncached: 100, cacheRead: 30, cacheWrite: 5, output: 20, total: 155 })
  assert.deepEqual(tokensOf({ n: 'A', m: 'm', tin: -5, cacheRead: -1, tout: undefined }), { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 })
  assert.deepEqual(tokensOf({ n: 'A', m: 'm', tin: Infinity, cacheRead: NaN, tout: 2 }), { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 2, total: 2 })
})

test('provider-reported cost wins and price-table costs are marked estimated', () => {
  const reported = attemptCost(eps, attempt({ cost: 0.42, tin: 1_000_000, tout: 1_000_000 }))
  assert.deepEqual(reported, { cost: 0.42, estimated: false })

  // cacheRead and cacheWrite use their own rates; input/output use theirs.
  const priced = attemptCost(eps, attempt({ tin: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, tout: 1_000_000 }))
  assert.equal(priced.cost, 2 + 0.5 + 2.5 + 8)
  assert.equal(priced.estimated, true)

  // A price table without cache rates falls back to the input rate.
  const shared = attemptCost(eps, attempt({ m: 'shared', tin: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, tout: 1_000_000 }))
  assert.equal(shared.cost, 1 + 1 + 1 + 2)

  // No table entry is unavailable, never a fabricated zero.
  const unknown = attemptCost(eps, attempt({ n: 'Beta', m: 'ghost' }))
  assert.deepEqual(unknown, { cost: null, estimated: false })
  const removed = attemptCost(eps, attempt({ n: 'Gone', m: 'm1' }))
  assert.equal(removed.cost, null)

  // Routing helpers are real spend against the configured endpoint.
  const classifier = attemptCost(eps, attempt({ n: 'Alpha (classifier)', tin: 1_000_000, tout: 0 }))
  assert.equal(classifier.cost, 2)
  const effort = attemptCost(eps, attempt({ n: 'Alpha (effort)', tin: 1_000_000, tout: 0 }))
  assert.equal(effort.cost, 2)
})

test('cost records carry endpoint/model identity and unknown rows survive', () => {
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [
      attempt({ at: at(0), cost: 0.25 }),
      attempt({ at: at(0), n: 'Beta', m: 'm1' }),
      attempt({ at: at(0), n: 'Gone', m: 'ghost', tin: 10, tout: 1 }),
      attempt({ at: at(0), n: 'Alpha (effort)', m: 'effort-model', tin: 5, tout: 1 }),
    ] },
  ])], eps)
  assert.equal(records[0].endpointId, 'e1')
  assert.equal(records[0].endpointName, 'Alpha')
  assert.equal(records[0].estimated, false)
  assert.equal(records[1].endpointId, 'e2')
  assert.equal(records[1].cost, null)
  assert.equal(records[2].endpointId, '')
  assert.equal(records[2].endpointName, 'Unknown endpoint')
  assert.equal(records[2].modelLabel, 'ghost')
  assert.equal(records[3].endpointId, 'e1', 'effort helpers resolve to their endpoint')
  assert.equal(records[3].modelId, 'effort-model')
  assert.doesNotThrow(() => summarize(records))
})

test('average cost uses only tokens that contributed a known cost', () => {
  const known = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [attempt({ at: at(0), tin: 1_000_000, tout: 0, cost: 2 })] },
  ])], eps)
  const all = summarize(known)
  assert.equal(all.totalTokens, 1_000_000)
  assert.equal(all.pricedTokens, 1_000_000)
  assert.equal(all.unpricedTokens, 0)
  assert.equal(all.average, 2)
  assert.equal(all.pricedRequests, 1)
  assert.equal(all.estimated, false)

  const partial = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [
      attempt({ at: at(0), tin: 1_000_000, tout: 0, cost: 2 }),
      attempt({ at: at(0), n: 'Beta', m: 'm1', tin: 3_000_000, tout: 0 }),
    ] },
  ])], eps)
  const p = summarize(partial)
  assert.equal(p.totalTokens, 4_000_000)
  assert.equal(p.pricedTokens, 1_000_000)
  assert.equal(p.unpricedTokens, 3_000_000)
  assert.equal(p.average, 2, 'unpriced tokens must not dilute the average')
  assert.equal(p.unpricedRequests, 1)

  const unpriced = summarize(buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [attempt({ at: at(0), n: 'Beta', m: 'm1' })] },
  ])], eps))
  assert.equal(unpriced.pricedTokens, 0)
  assert.equal(unpriced.average, null)
  assert.equal(unpriced.totalCost, 0)
  assert.equal(unpriced.unpricedTokens, 120)

  const empty = summarize([])
  assert.equal(empty.average, null)
  assert.equal(empty.totalTokens, 0)
  assert.equal(empty.mostUsed, undefined)
  assert.equal(costPerMillion(0, 0), null)
  assert.equal(costPerMillion(1, 100), 10_000)
})

test('ranking sorts by tokens, then cost, then label, with shares', () => {
  const rows = [
    { key: 'a', label: 'A · X', tokens: { total: 10 }, cost: 1, average: 0.1, share: 0.25, requests: 1, lastUsed: 1 },
    { key: 'b', label: 'B · X', tokens: { total: 30 }, cost: 1, average: 0.2, share: 0.75, requests: 1, lastUsed: 2 },
    { key: 'c', label: 'C · X', tokens: { total: 10 }, cost: 5, average: 0.3, share: 0.25, requests: 1, lastUsed: 3 },
  ]
  assert.deepEqual(sortModels(rows).map((r) => r.key), ['b', 'c', 'a'])
  assert.deepEqual(sortModels(rows, 'tokens', 'asc').map((r) => r.key), ['c', 'a', 'b'])
  assert.deepEqual(sortModels(rows, 'cost').map((r) => r.key), ['c', 'b', 'a'])
  assert.deepEqual(sortModels(rows, 'model', 'asc').map((r) => r.key), ['a', 'b', 'c'])
  assert.deepEqual(sortModels(rows, 'share', 'desc').map((r) => r.key), ['b', 'c', 'a'])
  assert.deepEqual(sortModels([]), [])
  assert.equal(sharePct(0.333), '33.3%')
  assert.equal(sharePct(null), '—')
  assert.equal(percentOf(1, 3), '33.3%')
  assert.equal(percentOf(0, 0), '—')
})

test('aggregateModels ranks billable usage, ignores failed-only models and computes shares', () => {
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [
      attempt({ at: at(0), tin: 100, tout: 0, cost: 0.1 }),
      attempt({ at: at(0), n: 'Beta', m: 'shared', tin: 300, tout: 0 }),
      attempt({ at: at(1), n: 'Beta', m: 'shared', tin: 300, tout: 0, err: 'no' }),
    ] },
  ])], eps)
  const rows = aggregateModels(records)
  assert.equal(rows.length, 2, 'a model with only failures has no ranking row')
  const alpha = rows.find((r) => r.endpointId === 'e1')
  const beta = rows.find((r) => r.endpointId === 'e2')
  assert.equal(alpha.tokens.total, 100)
  assert.equal(alpha.share, 0.25)
  assert.equal(alpha.average, 1000)
  assert.equal(beta.tokens.total, 300)
  assert.equal(beta.share, 0.75)
  assert.equal(beta.cost, 0)
  assert.equal(beta.average, null)
  assert.equal(summarize(records).failed, 1)
})

test('most-used model is the token leader and is absent for an empty period', () => {
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [
      attempt({ at: at(0), tin: 100, tout: 0 }),
      attempt({ at: at(0), m: 'cheap', tin: 500, tout: 0 }),
    ] },
  ])], eps)
  assert.equal(summarize(records).mostUsed.modelId, 'cheap')
  const empty = summarize(recordsInRange(records, statsRange({ period: 'custom', from: '2020-01-01', to: '2020-01-02' })))
  assert.equal(empty.mostUsed, undefined)
  assert.equal(empty.requests, 0)
})

test('model selection handles all, selected, absent and zero-token models', () => {
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [
      attempt({ at: at(0), tin: 100, tout: 0, cost: 1 }),
      attempt({ at: at(0), m: 'cheap', tin: 0, tout: 0 }),
    ] },
  ])], eps)
  const rows = aggregateModels(records)
  assert.equal(findModel(rows, 'all') , undefined)
  assert.equal(rows.length, 2)
  const zero = rows.find((r) => r.modelId === 'cheap')
  assert.equal(zero.tokens.total, 0)
  assert.equal(zero.share, 0, 'a zero-token row is 0% of a period that has tokens')
  assert.equal(zero.average, null)
  assert.equal(findModel(rows, modelKey('e1', 'm1')).average, 10_000)
})

test('the same model on two endpoints stays distinct and removed endpoints survive', () => {
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: at(0), log: [
      attempt({ at: at(0), tin: 100, tout: 0 }),
      attempt({ at: at(0), n: 'Beta', m: 'm1', tin: 200, tout: 0 }),
      attempt({ at: at(0), n: 'Removed', m: 'm1', tin: 300, tout: 0 }),
    ] },
  ])], eps)
  const rows = aggregateModels(records)
  assert.equal(rows.length, 3)
  assert.notEqual(rows[0].key, rows[1].key)
  const removed = rows.find((r) => r.endpointName === 'Unknown endpoint')
  assert.equal(removed.endpointId, '')
  assert.equal(removed.tokens.total, 300)
  assert.equal(removed.average, null)
})

test('chart buckets cover the period once and series totals match the summary', () => {
  const base = new Date(2026, 0, 5, 10, 0, 0).getTime()
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: base, log: [attempt({ at: base, tin: 10, tout: 1, cost: 0.1 })] },
    { id: 'a2', r: 'assistant', at: base + HOUR, log: [attempt({ at: base + HOUR, tin: 20, tout: 2, cost: 0.2 })] },
    { id: 'a3', r: 'assistant', at: base + 3 * HOUR, log: [attempt({ at: base + 3 * HOUR, tin: 30, tout: 3, err: 'x' })] },
  ])], eps)
  const range = { start: base, end: base + 4 * HOUR, period: 'custom', invalid: false }
  assert.equal(bucketUnitFor(range, base + 4 * HOUR), 'hour')
  const buckets = chartBuckets(records, range, 'hour', base + 4 * HOUR)
  assert.equal(buckets.length, 4)
  assert.equal(buckets[0].start, bucketStart(base, 'hour'))
  assert.equal(nextBucket(buckets[0].start, 'hour'), buckets[1].start)
  assert.equal(buckets[0].tokens.total, 11)
  assert.equal(buckets[1].tokens.total, 22)
  assert.equal(buckets[2].tokens.total, 0)
  assert.deepEqual(seriesTotals(buckets), { tokens: 33, cost: 0.30000000000000004, requests: 2 })
  const s = summarize(recordsInRange(records, range))
  assert.equal(s.totalTokens, 33)
  assert.equal(s.totalCost, 0.30000000000000004)
  assert.equal(s.failed, 1)
})

test('bucketing picks hourly, daily, weekly and monthly across ranges', () => {
  const now = new Date(2026, 5, 1, 12, 0, 0).getTime()
  assert.equal(bucketUnitFor({ start: now - 2 * HOUR, end: Infinity, period: 'day', invalid: false }, now), 'hour')
  assert.equal(bucketUnitFor({ start: now - 20 * DAY, end: Infinity, period: 'month', invalid: false }, now), 'day')
  assert.equal(bucketUnitFor({ start: now - 200 * DAY, end: Infinity, period: 'custom', invalid: false }, now), 'week')
  assert.equal(bucketUnitFor({ start: 0, end: Infinity, period: 'all', invalid: false }, now), 'month')

  const d = new Date(2026, 0, 7, 15, 30).getTime() // Wednesday
  assert.equal(bucketStart(d, 'hour'), new Date(2026, 0, 7, 15, 0).getTime())
  assert.equal(bucketStart(d, 'day'), new Date(2026, 0, 7).getTime())
  assert.equal(bucketStart(d, 'week'), new Date(2026, 0, 5).getTime(), 'weeks start on Monday')
  assert.equal(bucketStart(d, 'month'), new Date(2026, 0, 1).getTime())
  assert.equal(nextBucket(bucketStart(d, 'month'), 'month'), new Date(2026, 1, 1).getTime())
})

test('single-bucket and all-zero ranges render without divide-by-zero', () => {
  const base = new Date(2026, 0, 5, 10, 0, 0).getTime()
  const range = { start: base, end: base + 1000, period: 'custom', invalid: false }
  const empty = chartBuckets([], range, 'hour', base)
  assert.equal(empty.length, 1)
  assert.deepEqual(seriesTotals(empty), { tokens: 0, cost: 0, requests: 0 })

  const zero = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: base, log: [attempt({ at: base, tin: 0, tout: 0 })] },
  ])], eps)
  const buckets = chartBuckets(zero, range, 'hour', base)
  assert.equal(buckets.length, 1)
  assert.deepEqual(seriesTotals(buckets), { tokens: 0, cost: 0, requests: 1 })

  const emptyAll = chartBuckets([], { start: 0, end: Infinity, period: 'all', invalid: false }, 'month', base)
  assert.equal(emptyAll.length, 1)
  assert.deepEqual(seriesTotals(emptyAll), { tokens: 0, cost: 0, requests: 0 })
})

test('all-time charts start at the first record and monthly buckets split by month', () => {
  const jan = new Date(2026, 0, 10).getTime()
  const feb = new Date(2026, 1, 10).getTime()
  const records = buildUsageRecords([chat([
    { id: 'a1', r: 'assistant', at: jan, log: [attempt({ at: jan, tin: 10, tout: 0 })] },
    { id: 'a2', r: 'assistant', at: feb, log: [attempt({ at: feb, tin: 20, tout: 0 })] },
  ])], eps)
  const range = { start: 0, end: Infinity, period: 'all', invalid: false }
  const span = chartSpan(records, range, feb + DAY)
  assert.equal(span.start, jan)
  const buckets = chartBuckets(records, range, 'month', feb + DAY)
  assert.equal(buckets.length, 2)
  assert.equal(buckets[0].tokens.total, 10)
  assert.equal(buckets[1].tokens.total, 20)
  const totals = seriesTotals(buckets)
  assert.equal(totals.tokens, 30)
  assert.equal(totals.requests, 2)
  assert.ok(Math.abs(totals.cost - 0.00006) < 1e-12)
})

test('invalid ranges never chart or filter silently', () => {
  const range = statsRange({ period: 'custom', from: '2026-02-02', to: '2026-02-01' })
  assert.deepEqual(chartBuckets([], range), [])
  assert.deepEqual(recordsInRange([], range), [])
  assert.equal(rangeLabel(range, [], 0), 'Invalid custom range')
})

test('range labels describe the period and its boundaries', () => {
  const now = new Date(2026, 9, 27, 12, 0).getTime()
  const day = statsRange({ period: 'day', now })
  assert.match(rangeLabel(day, [], now), /last 24 hours/)
  const month = statsRange({ period: 'month', now })
  assert.match(rangeLabel(month, [], now), /last 30 days/)
  const custom = statsRange({ period: 'custom', from: '2026-10-01', to: '2026-10-27' })
  assert.match(rangeLabel(custom, [], now), /2026 · custom range$/)
  const openTo = statsRange({ period: 'custom', from: '2026-10-01', to: '' })
  assert.match(rangeLabel(openTo, [], now), /– now · custom range$/)
})

test('formatting helpers keep exact values and readable abbreviations', () => {
  assert.equal(compactTokens(999), '999')
  assert.equal(compactTokens(1_500), '1.5K')
  assert.equal(compactTokens(2_000_000), '2M')
  assert.equal(money(0.00001234, 4), '$0.0000')
  assert.equal(money(null, 4), '—')
  assert.equal(moneyExact(0.00001234), '$0.00001234')
  assert.equal(moneyExact(null), 'Cost unavailable')
})
