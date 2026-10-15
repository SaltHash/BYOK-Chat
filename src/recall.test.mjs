import test from 'node:test'
import assert from 'node:assert/strict'

const r = await import('./recall.ts')

test('tokenize lowercases, splits and drops stopwords', () => {
  assert.deepEqual(r.tokenize('The Quick, brown fox!'), ['quick', 'brown', 'fox'])
  assert.deepEqual(r.tokenize('a I xy'), ['xy'])
  assert.deepEqual(r.tokenize(''), [])
})

test('rankDocs scores term matches best-first and ignores zero scores', () => {
  const docs = [
    { id: 'a', text: 'unrelated words here' },
    { id: 'b', text: 'climate report shows warming trends in the climate data' },
    { id: 'c', text: 'climate' },
  ]
  const ranked = r.rankDocs('climate report', docs, 8)
  assert.ok(ranked.length >= 2)
  assert.equal(ranked[0].id, 'b')
  assert.ok(ranked.every((x) => x.score > 0))
  assert.deepEqual(r.rankDocs('', docs), [])
  assert.deepEqual(r.rankDocs('zzzqqq', docs), [])
})

test('rankMemories respects holistic, contextual and specific modes', () => {
  const mems = [
    { id: '1', text: 'user likes dark mode themes', category: 'Preferences' },
    { id: '2', text: 'project deadline is friday the 13th', category: 'Work' },
    { id: '3', text: 'favorite pizza topping is mushrooms', category: 'Food' },
  ]
  assert.equal(r.rankMemories(mems, 'q', 'holistic').length, 3)
  const ctx = r.rankMemories(mems, 'what is my project deadline', 'contextual')
  assert.ok(ctx.some((m) => m.id === '2'))
  assert.ok(!ctx.some((m) => m.id === '3'))
  const spec = r.rankMemories(mems, 'project deadline friday', 'specific')
  assert.ok(spec.some((m) => m.id === '2'))
  assert.deepEqual(r.rankMemories([], 'q', 'contextual'), [])
})

test('similarity and duplicate pairs detect near-duplicates', () => {
  assert.equal(r.similarity('same text here', 'same text here'), 1)
  assert.equal(r.similarity('totally different words', 'nothing alike here xyz'), 0)
  const mems = [
    { id: 'a', text: 'user prefers dark mode interface themes' },
    { id: 'b', text: 'user prefers dark mode interface themes always' },
    { id: 'c', text: 'deadline friday release notes' },
  ]
  const pairs = r.findDuplicatePairs(mems, 0.75)
  assert.equal(pairs.length, 1)
  assert.deepEqual([pairs[0].a, pairs[0].b], ['a', 'b'])
  const merged = r.mergeMemory(mems.map((m) => ({ ...m, category: 'General' })), { id: 'n', text: 'user prefers dark mode interface themes!', category: 'Prefs', createdAt: 1, updatedAt: 2 })
  assert.equal(merged.merged, true)
  assert.equal(merged.memories.length, 3)
  const fresh = r.mergeMemory(mems.map((m) => ({ ...m, category: 'General' })), { id: 'n', text: 'completely unrelated fact xyzzy', category: 'G', createdAt: 1, updatedAt: 2 })
  assert.equal(fresh.merged, false)
  assert.equal(fresh.memories.length, 4)
})

test('searchChats ranks title hits first with snippets', () => {
  const chats = [
    { id: 'c1', title: 'Gardening tips', msgs: [{ id: 'm1', r: 'user', t: 'how do I prune roses in spring season' }] },
    { id: 'c2', title: 'Rose pruning guide', msgs: [{ id: 'm2', r: 'user', t: 'hello there' }] },
    { id: 'c3', title: 'Cooking', msgs: [{ id: 'm3', r: 'user', t: 'unrelated dinner plans' }] },
  ]
  const hits = r.searchChats(chats, 'rose pruning')
  assert.equal(hits.length, 2)
  assert.equal(hits[0].chatId, 'c2')
  assert.equal(hits[0].title, true)
  assert.equal(hits[1].chatId, 'c1')
  assert.equal(hits[1].msgId, 'm1')
  assert.match(hits[1].match.toLowerCase(), /rose|pruning/)
  assert.deepEqual(r.searchChats(chats, '   '), [])
  assert.deepEqual(r.searchChats(chats, 'zzzqqq'), [])
})

test('RouteCache keys, expires and evicts', () => {
  const c = new r.RouteCache(1000, 2)
  c.set('pl', '  Hello   WORLD ', 'm1', 0)
  assert.equal(c.get('pl', 'hello world', 500), 'm1')
  assert.equal(c.get('pl', 'hello world', 1500), null)
  assert.equal(c.get('pl', 'other', 500), null)
  c.set('pl', 'a', 'm1', 0); c.set('pl', 'b', 'm2', 0); c.set('pl', 'c', 'm3', 0)
  assert.equal(c.size, 2)
})

test('routing scores prefer fast, cheap and unknown endpoints', () => {
  const slow = { calls: 10, fails: 0, ms: 50000 }
  const flaky = { calls: 10, fails: 5, ms: 10000 }
  assert.ok(r.routeScore({ calls: 10, fails: 0, ms: 10000 }) < r.routeScore(slow))
  assert.ok(r.routeScore(slow) < r.routeScore(flaky))
  assert.equal(r.routeScore(undefined), -1)
  const cands = [
    { id: 'e1', model: 'slow' },
    { id: 'e2', model: 'fast' },
    { id: 'e3', model: 'new' },
  ]
  const prices = { 'e1::slow': 30, 'e2::fast': 5 }
  const priceOf = (c) => prices[`${c.id}::${c.model}`]
  assert.deepEqual(r.orderEndpoints(cands, {}, 'ordered', priceOf).map((c) => c.model), ['slow', 'fast', 'new'])
  const stats = { 'e1::slow': slow, 'e2::fast': { calls: 10, fails: 0, ms: 5000 } }
  assert.deepEqual(r.orderEndpoints(cands, stats, 'fastest', priceOf).map((c) => c.model), ['new', 'fast', 'slow'])
  assert.deepEqual(r.orderEndpoints(cands, stats, 'cheapest', priceOf).map((c) => c.model), ['fast', 'slow', 'new'])
  const next = r.recordRoute(undefined, 120, false)
  assert.deepEqual(next, { calls: 1, fails: 0, ms: 120 })
  assert.deepEqual(r.recordRoute(next, 80, true), { calls: 2, fails: 1, ms: 200 })
})
