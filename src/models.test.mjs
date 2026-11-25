import test from 'node:test'
import assert from 'node:assert/strict'
import { discoveredModelPatch, modelSupports, modelsOf, priceText } from './models.ts'

test('a per-million price shows at least two decimals and at most four', () => {
  assert.equal(priceText(3), '3.00')
  assert.equal(priceText(0.3), '0.30')
  assert.equal(priceText(1.25), '1.25')
  assert.equal(priceText(0.0125), '0.0125')
  assert.equal(priceText(0.0375), '0.0375')
  assert.equal(priceText(12.1), '12.10')
  assert.equal(priceText(0), '0.00')
  assert.equal(priceText(Number.NaN), '')
})

test('a discovered list is carried into the endpoint with the picked model first', () => {
  const patch = discoveredModelPatch(
    [
      { id: 'acme-large', name: 'Acme Large', context: 200000 },
      { id: 'acme-small', name: 'Acme Small' },
      { id: 'acme-fast', context: 0 },
    ],
    'acme-small',
  )
  assert.deepEqual(patch.models, ['acme-small', 'acme-large', 'acme-fast'])
  assert.equal(patch.model, 'acme-small')
  assert.deepEqual(patch.modelNames, { 'acme-large': 'Acme Large', 'acme-small': 'Acme Small' })
  assert.deepEqual(patch.modelContext, { 'acme-large': 200000 })
})

test('a model the list already contains is not duplicated', () => {
  const patch = discoveredModelPatch([{ id: 'a' }, { id: 'b' }], 'a')
  assert.deepEqual(patch.models, ['a', 'b'])
  assert.equal(patch.model, 'a')
})

test('a typed model still lands when discovery found nothing', () => {
  const patch = discoveredModelPatch([], 'my-model')
  assert.deepEqual(patch.models, ['my-model'])
  assert.equal(patch.model, 'my-model')
  assert.equal(patch.modelNames, undefined)
  assert.equal(patch.modelContext, undefined)
})

test('nothing picked and nothing found leaves the blank model row', () => {
  const patch = discoveredModelPatch([], '  ')
  assert.deepEqual(patch.models, [''])
  assert.equal(patch.model, '')
})

test('the first discovered model is the default when none was picked', () => {
  const patch = discoveredModelPatch([{ id: 'first' }, { id: 'second' }], '')
  assert.deepEqual(patch.models, ['first', 'second'])
  assert.equal(patch.model, 'first')
  assert.deepEqual(modelsOf({ models: patch.models, model: patch.model }), ['first', 'second'])
})

test('modelSupports reads per-model input modalities and assumes support when unknown', () => {
  const e = { modelModalities: { 'text-only': ['text'], vision: ['text', 'image'], full: ['text', 'image', 'file'], doc: ['text', 'file'] } }
  assert.equal(modelSupports(e, 'text-only', 'img'), false)
  assert.equal(modelSupports(e, 'text-only', 'pdf'), false)
  assert.equal(modelSupports(e, 'vision', 'img'), true)
  assert.equal(modelSupports(e, 'vision', 'pdf'), false)
  assert.equal(modelSupports(e, 'full', 'img'), true)
  assert.equal(modelSupports(e, 'full', 'pdf'), true)
  assert.equal(modelSupports(e, 'doc', 'pdf'), true)
  assert.equal(modelSupports(e, 'doc', 'img'), false)
  // No metadata for the model: assume capable and let the provider decide.
  assert.equal(modelSupports(e, 'unknown', 'pdf'), true)
  assert.equal(modelSupports({}, 'x', 'img'), true)
})

test('discoveredModelPatch carries input modalities per model', () => {
  const out = discoveredModelPatch([
    { id: 'a', inputModalities: ['text', 'image'] },
    { id: 'b', inputModalities: ['text', 'image', 'file'] },
    { id: 'c' },
  ], 'b')
  assert.deepEqual(out.modelModalities, { a: ['text', 'image'], b: ['text', 'image', 'file'] })
})
