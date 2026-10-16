import test from 'node:test'
import assert from 'node:assert/strict'

const r = await import('./research.ts')

test('parses explicit @research forms and deep-research follow-ups', () => {
  assert.deepEqual(r.parseResearchRequest('@research(climate adaptation)'), { query: 'climate adaptation', tier: null })
  assert.deepEqual(r.parseResearchRequest('@research[quick](fusion progress)'), { query: 'fusion progress', tier: 'quick' })
  assert.deepEqual(r.parseResearchRequest('@research thorough: battery recycling'), { query: 'battery recycling', tier: 'thorough' })
  assert.deepEqual(r.parseResearchRequest('@research ocean currents'), { query: 'ocean currents', tier: null })
  assert.deepEqual(r.parseResearchRequest('Deep research on solar geoengineering'), { query: 'solar geoengineering', tier: null })
  assert.deepEqual(r.parseResearchRequest('Perform deep research on mRNA vaccines'), { query: 'mRNA vaccines', tier: null })
  assert.equal(r.parseResearchRequest('hello world'), null)
  assert.equal(r.parseResearchRequest('@research()'), null)
})

test('tiers resolve with a safe default and budgets', () => {
  assert.equal(r.tierOf('quick').maxSearches, 5)
  assert.equal(r.tierOf('bogus').id, 'standard')
  assert.equal(r.normResearch({}).defaultTier, 'standard')
  assert.equal(r.normResearch({ defaultTier: 'thorough' }).defaultTier, 'thorough')
})

test('decomposition stays within budget and keeps the original query first', () => {
  const subs = r.decomposeResearch('quantum batteries', 5)
  assert.equal(subs[0], 'quantum batteries')
  assert.ok(subs.length >= 3 && subs.length <= 5)
  assert.deepEqual([...new Set(subs)].length, subs.length)
  const steps = r.researchStepsFor('quantum batteries', r.tierOf('quick'))
  assert.equal(steps[steps.length - 1].kind, 'synthesize')
  assert.ok(steps.every((s) => s.state === 'queued'))
})

test('system note asks for citations and structure', () => {
  const note = r.researchSystemNote('fusion', r.tierOf('standard'))
  assert.match(note, /deep research on: fusion/)
  assert.match(note, /\[S1\]/)
  assert.match(note, /## Key findings/)
})
