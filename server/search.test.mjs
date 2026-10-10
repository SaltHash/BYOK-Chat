import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedInt, buildSearchUrl, selectResults } from './search.mjs'

test('builds an encoded SearXNG JSON search URL', () => {
  const url = buildSearchUrl('http://127.0.0.1:8080', 'Fedora Linux & Podman')
  assert.equal(url.origin, 'http://127.0.0.1:8080')
  assert.equal(url.pathname, '/search')
  assert.equal(url.searchParams.get('q'), 'Fedora Linux & Podman')
  assert.equal(url.searchParams.get('format'), 'json')
})

test('rejects non-HTTP search service URLs', () => {
  assert.throws(() => buildSearchUrl('file:///tmp', 'query'), /HTTP or HTTPS/)
})

test('normalizes, deduplicates and favors distinct high-scoring sources', () => {
  const results = selectResults([
    { title: 'A', url: 'https://one.example/page?utm_source=x#part', content: 'one', score: 10 },
    { title: 'A duplicate', url: 'https://one.example/page', content: 'duplicate', score: 9 },
    { title: 'B', url: 'https://two.example/story', content: 'two', score: 8, engine: 'test' },
  ])
  assert.deepEqual(results.map((x) => x.id), ['S1', 'S2'])
  assert.deepEqual(results.map((x) => x.url), ['https://one.example/page', 'https://two.example/story'])
  assert.equal(results[1].engine, 'test')
})

test('enforces result, snippet and total evidence limits', () => {
  const results = selectResults(Array.from({ length: 10 }, (_, i) => ({
    title: `Result ${i}`, url: `https://site${i}.example/${i}`, content: 'x'.repeat(1000), score: 10 - i,
  })), { maxResults: 2, maxSnippetChars: 120, evidenceBudget: 500 })
  assert.equal(results.length, 2)
  assert.ok(results.every((x) => x.snippet.length <= 120))
  const evidenceChars = results.reduce((n, x) => n + x.title.length + x.url.length + x.snippet.length + 80, 0)
  assert.ok(evidenceChars <= 500)
})

test('returns no selected results for malformed search result collections', () => {
  assert.deepEqual(selectResults(null), [])
  assert.deepEqual(selectResults([{ title: 'bad URL', url: 'javascript:alert(1)', content: 'x' }]), [])
})

test('bounds configurable integer settings', () => {
  assert.equal(boundedInt('99', 8, 1, 8), 8)
  assert.equal(boundedInt('0', 8, 1, 8), 1)
  assert.equal(boundedInt('invalid', 8, 1, 8), 8)
})
