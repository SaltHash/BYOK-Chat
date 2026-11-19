import test from 'node:test'
import assert from 'node:assert/strict'
import { helperFlowModelsOf, helperPlRef, isPlaylistRef, readerSummaryModelsOf, compactionModelsOf, recallClassifiersOf, playlistClassifiersOf } from './store.ts'

const ep = (id, model, models, on = true) => ({ id, name: id.toUpperCase(), model, models, url: 'https://x.test/v1', on, modelEfforts: {} })
const eps = [ep('e1', 'a1', ['a1', 'a2']), ep('e2', 'b1', ['b1']), ep('off', 'c1', ['c1'], false)]
const pls = [{ id: 'p1', name: 'P', sys: '', e: ['e1::a2', 'e2'], cls: '', rule: '' }]
const s = { eps, pls, prefs: {}, memoryPrefs: { classifierEp: '', classifierModel: '' } }

/* A playlist ref is stored as `pl` plus the playlist id, so it rides in the
 * endpoint/model pair every helper setting already has. */
test('a playlist ref is recognizable next to an endpoint ref', () => {
  assert.equal(helperPlRef('p1'), 'pl::p1')
  assert.equal(isPlaylistRef('pl'), true)
  assert.equal(isPlaylistRef('e1'), false)
})

test('a helper flow resolves one model, or every usable playlist entry in order', () => {
  assert.deepEqual(helperFlowModelsOf(s, 'e1', 'a2').map((e) => `${e.id}|${e.model}`), ['e1|a2'])
  assert.deepEqual(helperFlowModelsOf(s, 'e1', '').map((e) => `${e.id}|${e.model}`), ['e1|a1'])
  assert.deepEqual(helperFlowModelsOf(s, 'pl', 'p1').map((e) => `${e.id}|${e.model}`), ['e1|a2', 'e2|b1'])
  // A disabled endpoint, a missing playlist and an empty slot all yield nothing.
  assert.deepEqual(helperFlowModelsOf(s, 'off', '').map((e) => e.model), [])
  assert.deepEqual(helperFlowModelsOf(s, 'pl', 'nope'), [])
  assert.deepEqual(helperFlowModelsOf(s, '', ''), [])
})

test('the context handoff reads main, none, a playlist and an old combined save', () => {
  assert.deepEqual(compactionModelsOf({ ...s, prefs: { compactEp: 'main' } }), [])
  assert.deepEqual(compactionModelsOf({ ...s, prefs: { compactEp: 'none' } }), [])
  assert.deepEqual(compactionModelsOf({ ...s, prefs: { compactEp: 'pl', compactModel: 'p1' } }).map((e) => e.model), ['a2', 'b1'])
  // Older saves put the whole `endpoint::model` ref in this slot.
  assert.deepEqual(compactionModelsOf({ ...s, prefs: { compactEp: 'e1::a2' } }).map((e) => e.model), ['a2'])
})

test('recall and routing helpers accept a playlist flow and keep their fallbacks', () => {
  const recall = recallClassifiersOf({ ...s, prefs: { recallEp: 'pl', recallModel: 'p1' } })
  assert.deepEqual(recall.map((e) => e.model), ['a2', 'b1'])
  // The dedicated slot wins; the classification slot only fills in when it is empty.
  assert.deepEqual(recallClassifiersOf({ ...s, prefs: { recallEp: '' }, memoryPrefs: { classifierEp: 'e2', classifierModel: '' } }).map((e) => e.model), ['b1'])
  const playlist = { ...pls[0], cls: 'pl', clsModel: 'p1' }
  assert.deepEqual(playlistClassifiersOf(s, playlist).map((e) => e.model), ['a2', 'b1'])
  // An explicit opt-out still keeps the list order, even with helpers configured.
  assert.deepEqual(playlistClassifiersOf({ ...s, memoryPrefs: { classifierEp: 'e1', classifierModel: '' } }, { ...playlist, cls: 'none' }), [])
})

test('a page summary flow can be set as a playlist ref', () => {
  const models = readerSummaryModelsOf(s, { readerSummaryEp: 'pl', readerSummaryModel: 'p1' })
  assert.deepEqual(models.map((e) => `${e.id}|${e.model}`), ['e1|a2', 'e2|b1'])
  assert.deepEqual(readerSummaryModelsOf(s, { readerSummaryEp: 'pl', readerSummaryModel: 'nope' }), [])
})
