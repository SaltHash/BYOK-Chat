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
  assert.equal(r.tierOf('quick').maxSearches, 8)
  assert.equal(r.tierOf('standard').maxSearches, 24)
  assert.equal(r.tierOf('thorough').maxSearches, 60)
  assert.equal(r.tierOf('bogus').id, 'standard')
  assert.equal(r.normResearch({}).defaultTier, 'standard')
  assert.equal(r.normResearch({ defaultTier: 'thorough' }).defaultTier, 'thorough')
})

test('system note leaves query and page choices to the model', () => {
  const note = r.researchSystemNote('fusion', r.tierOf('standard'))
  assert.match(note, /write each search query/)
  assert.match(note, /pick which result pages/)
  assert.equal(r.decomposeResearch, undefined)
})

test('withStepLead puts a round\u2019s thinking above the searches it produced', () => {
  const base = { id: 'x', query: 'q', tier: null, status: 'running', steps: [], startedAt: 0, note: 'Found A and B.' }
  const step = { id: 's1', kind: 'search', label: 'Search 1', state: 'running' }
  const rs = r.withStepLead(base, step)
  // The narration leads the step it produced, and is consumed so the round's
  // second step does not repeat it.
  assert.equal(rs.steps[0].lead, 'Found A and B.')
  assert.equal(rs.note, '')
  const second = r.withStepLead(rs, { ...step, id: 's2' })
  assert.equal(second.steps[1].lead, undefined)
  assert.deepEqual(second.steps[1], { ...step, id: 's2' })
  // Blank or padded narration attaches nothing.
  assert.deepEqual(r.withStepLead({ ...base, note: '   ' }, step).steps, [step])
  assert.deepEqual(r.withStepLead({ ...base, note: undefined }, step).steps, [step])
  // A later round's narration leads its own first step.
  const next = r.withStepLead({ ...second, note: 'Now check C.' }, { ...step, id: 's3' })
  assert.equal(next.steps[2].lead, 'Now check C.')
  assert.equal(next.steps[0].lead, 'Found A and B.')
})

test('the abstract prefers the closing round and falls back to narration', () => {
  assert.equal(r.researchAbstract({ finalText: 'short abstract', text: 'all of it' }), 'short abstract')
  assert.equal(r.researchAbstract({ finalText: '  ', rounds: [{ text: 'a' }, { text: 'last note' }], text: 'all' }), 'last note')
  assert.equal(r.researchAbstract({ text: 'only text' }), 'only text')
  assert.equal(r.researchAbstract({}), '')
})

test('a closing text that is already a report is kept, not asked for twice', () => {
  assert.equal(r.looksLikeReport('## Summary\n\nIt is complicated.'), true)
  // A long reply with no headings is a runaway abstract, not a report.
  assert.equal(r.looksLikeReport('x'.repeat(3601)), false)
  // A long reply carrying its own headings is kept as the report.
  assert.equal(r.looksLikeReport(`# Findings\n\n${'x'.repeat(3601)}`), true)
  assert.equal(r.looksLikeReport('A short abstract of two sentences. That is all.'), false)
  // A long abstract under the ceiling with no report section is not a report.
  assert.equal(r.looksLikeReport('y'.repeat(3600)), false)
  // A stray heading that is not one of the report sections does not trip it.
  assert.equal(r.looksLikeReport('# Some thoughts\n\nStill just an abstract.'), false)
  assert.equal(r.looksLikeReport(''), false)
  assert.equal(r.countReportSections('## Summary\n\n## Key findings\n\n## Sources note'), 3)
  // The sample text is the report's opening, not its raw head.
  const sample = r.reportSample('# Deep research\n\n## Summary\n\nFusion timelines slipped. Vendors disagree.')
  assert.equal(sample, 'Fusion timelines slipped. Vendors disagree.')
  assert.match(r.reportSample('y'.repeat(900)), /\u2026$/)
  assert.ok(r.reportSample('y'.repeat(900)).length <= 401)
})

test('system note asks for citations and structure, then a short abstract', () => {
  const note = r.researchSystemNote('fusion', r.tierOf('standard'))
  assert.match(note, /deep research on: fusion/)
  assert.match(note, /\[S1\]/)
  assert.match(note, /## Key findings/)
  // The report itself is asked for later; the phase ends on a short abstract.
  assert.match(note, /short 2–3 sentence abstract/)
  assert.match(r.RESEARCH_REPORT_ASK, /## Key findings/)
  assert.match(r.RESEARCH_ABSTRACT_ASK, /abstract/)
})

test('system note pushes small search batches with reasoning between them', () => {
  const note = r.researchSystemNote('fusion', r.tierOf('standard'))
  // The model should reflect between batches rather than fire them all at once.
  assert.match(note, /two or three queries per round/)
  assert.match(note, /never fire five or more searches in parallel/)
  assert.match(note, /search → reflect → refine/)
  assert.match(note, /Do not stop after one or two searches/)
})

test('system note reads one page at a time and reasons immediately after each', () => {
  const note = r.researchSystemNote('fusion', r.tierOf('standard'))
  assert.match(note, /Read one page at a time/)
  assert.match(note, /never fire several fetch_page calls in parallel/)
  assert.match(note, /Never fetch another page until you have reasoned about the one you just read/)
})

test('system note carries date-freshness directives with the current calendar year', () => {
  const now = new Date(Date.UTC(2026, 9, 15))
  const note = r.researchSystemNote('fusion', r.tierOf('standard'), now)
  assert.match(note, /Today's date is 2026-10-15\b/)
  // The cutoff is a real date one year back, so it never jumps a whole year on Jan 1.
  assert.match(note, /published before 2025-10-15 as historical context/)
  assert.equal(r.oneYearAgoStamp(new Date(Date.UTC(2026, 0, 1))), '2025-01-01')
  assert.equal(r.oneYearAgoStamp(new Date(Date.UTC(2026, 9, 15))), '2025-10-15')
  assert.match(note, /current year \(2026\)/)
  assert.match(note, /past 6–12 months/)
  assert.match(note, /publish\/updated timestamps/)
  assert.match(note, /timeline shift/)
  // The date is UTC, not local: an instant late in the UTC day keeps that day
  // even when a negative local offset already rolled over to the next one.
  assert.equal(r.todayStamp(new Date('2026-10-15T23:30:00Z')), '2026-10-15')
})

test('reasoning blocks span the searches the model gathered before it reasoned', () => {
  const step = (id, kind, label, lead) => ({ id, kind, label, state: 'done', ...(lead ? { lead } : {}) })
  // The model reasons only after its first five searches, then again after six
  // more: the blocks must read Searches 1-5 and Searches 6-11.
  const blocks = r.reasoningBlocks([
    step('s1', 'search', 'Search 1'), step('s2', 'search', 'Search 2'), step('s3', 'search', 'Search 3'),
    step('s4', 'search', 'Search 4'), step('s5', 'search', 'Search 5', 'Broad picture emerging.'),
    step('s6', 'search', 'Search 6'), step('s7', 'search', 'Search 7'), step('s8', 'search', 'Search 8'),
    step('s9', 'search', 'Search 9'), step('s10', 'search', 'Search 10'), step('s11', 'search', 'Search 11', 'Primary-source checks done.'),
  ])
  assert.deepEqual(blocks.map((b) => b.label), ['Searches 1-5', 'Searches 6-11'])
  assert.equal(blocks[0].lead, 'Broad picture emerging.')
  assert.equal(blocks[1].lead, 'Primary-source checks done.')
  // Reasoning before every search degrades to single-search labels.
  const each = r.reasoningBlocks([step('a', 'search', 'Search 1', 'one'), step('b', 'search', 'Search 2', 'two')])
  assert.deepEqual(each.map((b) => b.label), ['Search 1', 'Search 2'])
  // A block attached to a read keeps the read's own label.
  const read = r.reasoningBlocks([step('r', 'read', 'Read 1', 'page thought')])
  assert.deepEqual(read.map((b) => b.label), ['Read 1'])
  // Steps without narration produce no block.
  assert.deepEqual(r.reasoningBlocks([step('s1', 'search', 'Search 1')]), [])
})

test('system note absorbs the approved plan and asks for verification', () => {
  const plan = r.fallbackPlan('fusion power')
  const note = r.researchSystemNote('fusion power', r.tierOf('standard'), new Date(Date.UTC(2026, 9, 15)), plan)
  assert.match(note, /# Plan \(already approved by the user\)/)
  assert.match(note, /Research Websites/)
  assert.match(note, /Create Report/)
  assert.match(note, /second, independent source/)
  // Without a plan the plan block is absent, keeping the prompt lean.
  assert.doesNotMatch(r.researchSystemNote('fusion power', r.tierOf('standard')), /already approved/)
})

test('tiers carry search and read budgets with hard-cap wording', () => {
  assert.deepEqual(r.RESEARCH_TIERS.map((t) => t.maxSearches), [8, 24, 60])
  for (const t of r.RESEARCH_TIERS) assert.match(t.blurb, /reads/)
  assert.match(r.researchBudgetNote(r.tierOf('thorough')), /hard cap of 60 searches/)
  assert.match(r.researchBudgetNote(r.tierOf('thorough')), /never a target/)
  const note = r.researchSystemNote('fusion', r.tierOf('thorough'))
  assert.match(note, /holistic/i)
  assert.match(note, /hard cap, not a quota/)
  assert.match(note, /absolute, run-wide source IDs/)
  assert.match(note, /Markdown table/)
})

test('dedupTrace drops round texts already shown as step leads', () => {
  const leads = ['Found A and B. Will check C next.']
  assert.deepEqual(r.dedupTrace(['Found A and B. Will check C next.'], leads), [])
  assert.deepEqual(r.dedupTrace(['  found a AND b. will check c next.  '], leads), [])
  assert.deepEqual(r.dedupTrace(['Something entirely new here.'], leads), ['Something entirely new here.'])
  assert.deepEqual(r.dedupTrace(['', '  '], leads), [])
})

test('plans parse from messy model output and always yield a usable plan', () => {
  const messy = 'Sure!\n```json\n{"title":"Fusion","intro":"Goal.","steps":[{"kind":"search","label":"Research Websites","items":["(1) a","(2) b"]},{"label":"Analyze Results","items":["(4) c"]},{"kind":"report","label":"Create Report","items":[]}]}\n```\nHope that helps.'
  const plan = r.parseResearchPlan(messy)
  assert.equal(plan.title, 'Fusion')
  assert.equal(plan.steps.length, 3)
  assert.equal(plan.steps[0].kind, 'search')
  assert.equal(plan.steps[0].id, 'p1')
  // A step with no kind is inferred from its label.
  assert.equal(plan.steps[1].kind, 'analyze')
  assert.equal(plan.steps[2].kind, 'report')
  // Junk, empty, or step-less payloads are rejected rather than shown blank.
  assert.equal(r.parseResearchPlan('no json here'), null)
  assert.equal(r.parseResearchPlan('{"title":"x","steps":[]}'), null)
  assert.equal(r.parseResearchPlan(''), null)
  // The fallback always covers search → analyze → report.
  const fb = r.fallbackPlan('ocean currents')
  assert.equal(fb.steps[0].kind, 'search')
  assert.ok(fb.steps.some((s) => s.kind === 'analyze'))
  assert.equal(fb.steps[fb.steps.length - 1].kind, 'report')
  assert.match(fb.title, /ocean currents/)
})

test('sanitizeCitations removes ids with no matching source and keeps known ones', () => {
  const src = [{ citeId: 'S1' }, { citeId: 'S2' }]
  const valid = src.map((s) => s.citeId)
  assert.deepEqual(r.sanitizeCitations('Claim [S1] and [S2].', valid), { text: 'Claim [S1] and [S2].', removed: [] })
  const dropped = r.sanitizeCitations('Claim [S1] and [S9].', valid)
  assert.equal(dropped.removed.includes('S9'), true)
  assert.doesNotMatch(dropped.text, /S9/)
  assert.match(dropped.text, /\[S1\]/)
  // Grouped tokens keep the known ids and drop the unknown ones.
  const grouped = r.sanitizeCitations('Both [S1, S9] here.', valid)
  assert.equal(grouped.text.trim(), 'Both [S1] here.')
  assert.deepEqual(grouped.removed, ['S9'])
  // A fully unknown token disappears (with its link) rather than linking nowhere.
  const gone = r.sanitizeCitations('Nope [S9](http://x).', valid)
  assert.equal(gone.text.trim(), 'Nope.')
  assert.deepEqual(gone.removed, ['S9'])
  // Non-citation brackets are untouched.
  assert.equal(r.sanitizeCitations('An [aside] stays.', valid).text, 'An [aside] stays.')
})

test('a usage estimate scales with the tier and only costs when priced', () => {
  const std = r.estimateResearchUsage(r.tierOf('standard'))
  const quick = r.estimateResearchUsage(r.tierOf('quick'))
  assert.equal(std.searches, 24 + r.PLAN_SCOPE_MAX)
  assert.ok(std.inputTokens > quick.inputTokens)
  assert.equal(std.costUsd, null)
  const priced = r.estimateResearchUsage(r.tierOf('quick'), { input: 1, output: 2 })
  assert.ok(priced.costUsd > 0)
})

test('older tool rounds compact while keeping citation ids citable', () => {
  const search = `Web search evidence (tinyfish · 2 sources)\n<search_evidence>\n[Source S1]\nTitle: A\nURL: https://a.test\nSnippet: ${'x'.repeat(600)}\n\n[Source S2]\nTitle: B\nURL: https://b.test\nSnippet: ${'y'.repeat(600)}\n</search_evidence>`
  const compressed = r.compactResult('search', search)
  assert.match(compressed, /\[Source S1\]/)
  assert.match(compressed, /https:\/\/a\.test/)
  assert.match(compressed, /\[Source S2\]/)
  assert.ok(compressed.length < search.length)
  const page = `Page excerpt [Source S3] for https://c.test.\nTitle: C\n<page_excerpt>\n${'z'.repeat(4000)}\n</page_excerpt>`
  const cpage = r.compactResult('fetch_page', page)
  assert.match(cpage, /\[Source S3\]/)
  assert.ok(cpage.length < page.length)
  const rounds = [
    { text: 'r1', calls: [{ name: 'search', result: search }] },
    { text: 'r2', calls: [{ name: 'fetch_page', result: page }] },
    { text: 'r3', calls: [{ name: 'search', result: search }] },
  ]
  const kept = r.compactResearchRounds(rounds, 1)
  // Only the most recent round is left untouched.
  assert.equal(kept[2].calls[0].result, search)
  assert.ok(kept[0].calls[0].result.length < search.length)
  // Keeping everything recent is a no-op.
  assert.equal(r.compactResearchRounds(rounds, 9), rounds)
})

test('the report spec is shared and the citation repair asks exist', () => {
  // Both the system note and the report ask carry every fixed section heading,
  // so the two can never drift apart.
  for (const h of ['## Summary', '## Key findings', '## Evidence', '## Limitations', '## Sources note']) {
    assert.match(r.researchSystemNote('fusion', r.tierOf('standard')), new RegExp(h.replace('#', '\\#')))
    assert.match(r.RESEARCH_REPORT_ASK, new RegExp(h.replace('#', '\\#')))
  }
  assert.match(r.citationRepairAsk(['S9'], ['S1', 'S2']), /do not exist in the evidence: S9/)
  assert.match(r.citationUncitedAsk(['S1', 'S2']), /cites no sources/)
  assert.match(r.citationUncitedAsk(['S1']), /add an inline \[S1\], \[S2\], etc\. citation/)
})

test('the evidence floor nudges a run with too few searches', () => {
  assert.equal(r.RESEARCH_MIN_SEARCHES, 2)
  const ask = r.researchMinAsk(1, 2)
  assert.match(ask, /only run 1 search/)
  assert.match(ask, /at least 1 more search/)
  // Singular/plural and never a non-positive count.
  assert.match(r.researchMinAsk(0, 1), /only run 0 searches/)
  assert.match(r.researchMinAsk(0, 1), /at least 1 more search/)
})

test('a plan followed by a second JSON object still parses the first', () => {
  const p = r.parseResearchPlan('Here: {"title":"Fusion","steps":[{"kind":"search","label":"Research","items":["(1) a"]}]} and also {"other":true}')
  assert.equal(p?.title, 'Fusion')
  assert.equal(p?.steps.length, 1)
  // A first object with no usable steps falls through to the next one.
  const q = r.parseResearchPlan('{"a":1} {"title":"Second","steps":[{"kind":"report","label":"Create Report","items":["(1) done"]}]}')
  assert.equal(q?.title, 'Second')
})
