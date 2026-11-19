import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARENA_BENCHMARKS, ARENA_HISTORY_MAX, ARENA_NEEDLE, arenaBenchmarkOf, arenaUrlFor, contestantLabel,
  customTask, generalTask, judgeAsk, normArena, pageSummaryTask, parseVerdict, plantNeedle, verdictWinner,
} from './arena.ts'

test('the benchmarks are distinct and safe to look up by id', () => {
  const ids = ARENA_BENCHMARKS.map((b) => b.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(arenaBenchmarkOf('custom').id, 'custom')
  assert.equal(arenaBenchmarkOf('nope').id, 'general')
  assert.equal(arenaBenchmarkOf(undefined).id, 'general')
  // Real page content for the two reading benchmarks, real search for the web one.
  assert.equal(arenaBenchmarkOf('long-context').needs, 'page')
  assert.equal(arenaBenchmarkOf('page-summary').needs, 'page')
  assert.equal(arenaBenchmarkOf('web').needs, 'search')
  assert.match(arenaUrlFor('page-summary', 1), /^https:\/\//)
  assert.match(arenaUrlFor('long-context', 0), /^https:\/\//)
})

test('the needle is planted once, on a paragraph break, and the task asks for a quote', () => {
  const doc = 'Para one.\n\n' + 'filler '.repeat(400) + '\n\nPara three.'
  const planted = plantNeedle(doc, ARENA_NEEDLE, 0.5)
  assert.equal(planted.split(ARENA_NEEDLE).length - 1, 1)
  assert.ok(planted.length > doc.length)
  assert.ok(planted.indexOf(ARENA_NEEDLE) > doc.length * 0.3)
  // Planting the same needle again changes nothing.
  assert.equal(plantNeedle(planted, ARENA_NEEDLE, 0.9), planted)
  // An empty document still carries the needle rather than losing it.
  assert.equal(plantNeedle('', ARENA_NEEDLE), ARENA_NEEDLE)

  const task = { prompt: `The document below is complete.\n\n<document>\n${planted}\n</document>`, system: 'read it', material: planted }
  const ask = judgeAsk(task, [{ label: 'A', ref: 'e::m', name: 'M', text: 'It says rack 7 needs AZURE-4192.' }])
  assert.match(ask, /# Task given to every model/)
  assert.match(ask, /Reference material/)
  assert.ok(ask.includes(ARENA_NEEDLE))
  assert.match(ask, /## Model A/)
  assert.match(ask, /AZURE-4192/)
})

test('general runs rotate their prompts and a custom run carries the reader text', () => {
  assert.notEqual(generalTask(0).prompt, generalTask(1).prompt)
  assert.equal(generalTask(4).prompt, generalTask(0).prompt)
  const custom = customTask('  Summarize the plot of Hamlet in ten words.  ')
  assert.equal(custom.prompt, 'Summarize the plot of Hamlet in ten words.')
  assert.match(pageSummaryTask('https://e.test/p', 'page body').prompt, /Caveats, contradictions and risks/)
})

test('a judge reply is parsed into structured scores and a complete ranking', () => {
  const raw = 'Here you go:\n```json\n{"scores":[{"label":"A","accuracy":8,"completeness":7,"clarity":9,"notes":"  solid  "},{"label":"b","accuracy":4,"completeness":3,"clarity":6,"notes":"thin"}],"ranking":["B"],"verdict":"A was complete."}\n```'
  const v = parseVerdict(raw, ['A', 'B'])
  assert.equal(v.error, undefined)
  assert.deepEqual(v.scores.map((s) => s.label), ['A', 'B'])
  assert.equal(v.scores[0].score, 7.9) // 8*.5 + 7*.3 + 9*.2
  assert.equal(v.scores[0].notes, 'solid')
  // A partial ranking is completed from the scores, best first.
  assert.deepEqual(v.ranking, ['B', 'A'])
  assert.equal(v.verdict, 'A was complete.')
})

test('unusable judge replies say why instead of inventing a verdict', () => {
  assert.match(parseVerdict('no json here', ['A']).error ?? '', /JSON/)
  assert.match(parseVerdict('{"scores":[]}', ['A']).error ?? '', /score/)
  // Unknown labels and duplicates are dropped, and impossible values clamp.
  const v = parseVerdict('{"scores":[{"label":"Z","accuracy":9},{"label":"A","accuracy":99,"completeness":-3,"clarity":"nope"},{"label":"A","accuracy":5}]}', ['A', 'B'])
  assert.deepEqual(v.scores.map((s) => s.label), ['A'])
  assert.equal(v.scores[0].accuracy, 10)
  assert.equal(v.scores[0].completeness, 0)
  assert.equal(v.scores[0].clarity, 0)
  assert.equal(verdictWinner(v), 'A')
  assert.equal(verdictWinner(null), '')
})

test('arena state normalizes to a safe, bounded shape', () => {
  const blank = normArena(undefined)
  assert.deepEqual(blank.contestants, [])
  assert.deepEqual(blank.history, [])
  assert.equal(blank.benchmark, 'general')
  assert.equal(blank.judgeEp, '')

  const many = Array.from({ length: ARENA_HISTORY_MAX + 5 }, (_, i) => ({ id: `r${i}`, at: i, benchmark: 'general', prompt: 'p', answers: [] }))
  const state = normArena({ judgeEp: 'e1', judgeModel: 'm1', contestants: ['a::1', 'b::2', 7], benchmark: 'page-summary', customPrompt: 'x'.repeat(9000), history: many })
  assert.equal(state.judgeEp, 'e1')
  assert.deepEqual(state.contestants, ['a::1', 'b::2'])
  assert.equal(state.benchmark, 'page-summary')
  assert.equal(state.customPrompt.length, 4000)
  assert.equal(state.history.length, ARENA_HISTORY_MAX)
  assert.equal(state.history[0].id, 'r0')
})

test('contestants are lettered in order', () => {
  assert.deepEqual([0, 1, 2].map(contestantLabel), ['A', 'B', 'C'])
})
