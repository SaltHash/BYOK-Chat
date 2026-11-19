import test from 'node:test'
import assert from 'node:assert/strict'
import { helperAutoEffort, helperEffortOf, normHelperEffort } from './store.ts'

const ep = (modelEfforts) => ({ id: 'e', name: 'E', model: 'gpt', modelEfforts })

/* Nothing configured must behave exactly as before: the decision helpers pin
 * the cheapest level their model reports, while titles and handoffs leave the
 * effort to the provider. */
test('helpers keep their automatic level when nothing is configured', () => {
  const e = ep({ gpt: ['medium', 'low', 'high'] })
  assert.equal(helperAutoEffort('cls', e), 'low')
  assert.equal(helperAutoEffort('recall', e), 'low')
  assert.equal(helperAutoEffort('title', e), '')
  assert.equal(helperAutoEffort('compact', e), '')
  assert.equal(helperAutoEffort('page', e), 'low')
  for (const task of ['cls', 'recall', 'title', 'compact', 'page']) {
    assert.equal(helperEffortOf(task, e, ''), helperAutoEffort(task, e))
    assert.equal(helperEffortOf(task, e, undefined), helperAutoEffort(task, e))
  }
})

/* A configured level wins, and is matched against the model's own spelling so
 * a config written lower-case still sends the id the provider reports. */
test('a configured level wins when the model reports it', () => {
  const e = ep({ gpt: ['Low', 'Medium', 'High'] })
  assert.equal(helperEffortOf('title', e, 'High'), 'High')
  assert.equal(helperEffortOf('cls', e, 'high'), 'High')
  assert.equal(helperEffortOf('compact', e, ' Medium '), 'Medium')
})

/* A level the model does not report cannot be sent, so the call falls back to
 * the task's automatic level instead of an invalid request. */
test('an unsupported level falls back to the automatic level', () => {
  const e = ep({ gpt: ['low', 'high'] })
  assert.equal(helperEffortOf('title', e, 'max'), '')
  assert.equal(helperEffortOf('recall', e, 'max'), 'low')
  assert.equal(helperEffortOf('title', ep(undefined), 'high'), '')
})

test('the stored helper levels are normalized', () => {
  assert.deepEqual(normHelperEffort({ cls: ' high ', title: 'low' }), { cls: 'high', title: 'low' })
  assert.deepEqual(normHelperEffort({ cls: '', title: 'auto', recall: 'off', compact: 7, page: 'medium' }), { page: 'medium' })
  assert.deepEqual(normHelperEffort(null), {})
  assert.deepEqual(normHelperEffort('nope'), {})
  assert.deepEqual(normHelperEffort({ unknown: 'high' }), {})
})
