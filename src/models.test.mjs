import test from 'node:test'
import assert from 'node:assert/strict'
import { discoveredModelPatch, modelsOf } from './models.ts'

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
