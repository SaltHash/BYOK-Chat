import test from 'node:test'
import assert from 'node:assert/strict'

const c = await import('./citations.ts')

const evidence = (id, query = 'climate report', provider = 'TinyFish via api') =>
  `Web search evidence for “${query}” (${provider} · 2 sources · 2026-01-01).\n<search_evidence>\n[Source S1]\nTitle: First\nURL: https://one.example/a\nSnippet: alpha beta\n\n[Source S2]\nTitle: Second\nURL: https://two.example/b\nSnippet: gamma delta\n</search_evidence>`

test('parses evidence blocks with query and provider', () => {
  const { query, provider, sources } = c.parseSearchEvidence(evidence(0))
  assert.equal(query, 'climate report')
  assert.match(provider, /TinyFish/)
  assert.equal(sources.length, 2)
  assert.equal(sources[0].host, 'one.example')
})

test('collects and dedupes sources across rounds with global ids', () => {
  const rounds = [
    { calls: [{ name: 'search', arguments: '{}', result: evidence(0) }] },
    { calls: [{ name: 'search', arguments: '{}', result: evidence(1).replace('https://one.example/a', 'https://one.example/a') }] },
  ]
  const sources = c.collectMessageSources(rounds)
  assert.deepEqual(sources.map((s) => s.citeId), ['S1', 'S2'])
  assert.equal(sources[0].url, 'https://one.example/a')
  assert.deepEqual(c.collectMessageSources(null), [])
  assert.deepEqual(c.collectMessageSources([{ calls: [{ name: 'search', arguments: '{}', error: true, result: 'x' }] }]), [])
})

test('extracts cited ids and checks coverage', () => {
  assert.deepEqual(c.extractCitedIds('see [S2] and [Source s1] plus [S1](https://x)'), ['S1', 'S2'])
  const sources = c.collectMessageSources([{ calls: [{ name: 'search', arguments: '{}', result: evidence(0) }] }])
  const cov = c.citationCoverage('no cites here', sources)
  assert.equal(cov.uncited, true)
  assert.deepEqual(c.citationCoverage('see [S1]', sources).unknown, [])
  assert.deepEqual(c.citationCoverage('see [S9]', sources).unknown, ['S9'])
})

test('linkifies bare tokens but leaves links and unknown ids alone', () => {
  const sources = c.collectMessageSources([{ calls: [{ name: 'search', arguments: '{}', result: evidence(0) }] }])
  const out = c.linkifyCitations('A [S1] and [Source S2] plus [S9] plus [S1](https://one.example/a).', sources)
  assert.match(out, /\[S1\]\(https:\/\/one\.example\/a/)
  assert.match(out, /\[S2\]\(https:\/\/two\.example\/b/)
  assert.match(out, /\[S9\]/)
  assert.equal((out.match(/one\.example\/a/g) || []).length, 2)
  assert.equal(c.linkifyCitations('hi', []), 'hi')
})

test('truncates snippets and hosts safely', () => {
  assert.equal(c.truncateSnippet('a  b\nc', 4), 'a b…')
  assert.equal(c.hostOf('https://www.example.com/x'), 'example.com')
  assert.equal(c.hostOf('junk'), '')
})
