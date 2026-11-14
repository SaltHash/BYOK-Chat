import test from 'node:test'
import assert from 'node:assert/strict'
import { allOrderedModels, stepModelSelection, stepPromptSelection, nextThemeKey, nextThemePatch } from './selection'

const eps = [
  { id: 'a', model: 'a1', models: ['a1', 'a2'] },
  { id: 'b', model: 'b1', models: ['b1'] },
]

test('orders every model of every endpoint in endpoint order', () => {
  assert.deepEqual(allOrderedModels(eps), [
    { k: 'ep', id: 'a', model: 'a1' },
    { k: 'ep', id: 'a', model: 'a2' },
    { k: 'ep', id: 'b', model: 'b1' },
  ])
})

test('steps forward and wraps past the last model', () => {
  assert.deepEqual(stepModelSelection(eps, { id: 'a', model: 'a1' }, 1), { k: 'ep', id: 'a', model: 'a2' })
  assert.deepEqual(stepModelSelection(eps, { id: 'b', model: 'b1' }, 1), { k: 'ep', id: 'a', model: 'a1' })
})

test('steps backward and wraps before the first model', () => {
  assert.deepEqual(stepModelSelection(eps, { id: 'a', model: 'a2' }, -1), { k: 'ep', id: 'a', model: 'a1' })
  assert.deepEqual(stepModelSelection(eps, { id: 'a', model: 'a1' }, -1), { k: 'ep', id: 'b', model: 'b1' })
})

test('with nothing selected, next starts at the first model and previous at the last', () => {
  assert.deepEqual(stepModelSelection(eps, null, 1), { k: 'ep', id: 'a', model: 'a1' })
  assert.deepEqual(stepModelSelection(eps, null, -1), { k: 'ep', id: 'b', model: 'b1' })
  // A selection pointing at a removed model behaves like no selection.
  assert.deepEqual(stepModelSelection(eps, { id: 'gone', model: 'x' }, 1), { k: 'ep', id: 'a', model: 'a1' })
  assert.deepEqual(stepModelSelection(eps, { id: 'gone', model: 'x' }, -1), { k: 'ep', id: 'b', model: 'b1' })
})

test('a single model stays put in both directions', () => {
  const one = [{ id: 'a', model: 'only', models: ['only'] }]
  assert.deepEqual(stepModelSelection(one, { id: 'a', model: 'only' }, 1), { k: 'ep', id: 'a', model: 'only' })
  assert.deepEqual(stepModelSelection(one, { id: 'a', model: 'only' }, -1), { k: 'ep', id: 'a', model: 'only' })
})

test('no endpoints means no selection to step to', () => {
  assert.equal(stepModelSelection([], null, 1), null)
  assert.equal(stepModelSelection([], null, -1), null)
})

test('prompt stepping cycles through the configured prompts', () => {
  const prompts = [{ id: 'p1' }, { id: 'p2' }]
  assert.equal(stepPromptSelection(prompts, 'p1'), 'p2')
  assert.equal(stepPromptSelection(prompts, 'p2'), 'p1')
  assert.equal(stepPromptSelection(prompts, ''), 'p1')
  assert.equal(stepPromptSelection([], 'p1'), '')
})

test('theme cycling walks the active mode and includes the custom palette', () => {
  assert.equal(nextThemeKey({ themeMode: 'dark', themeDark: 'plum', themeLight: 'paper' }), 'claude')
  assert.equal(nextThemeKey({ themeMode: 'dark', themeDark: 'graphite', themeLight: 'paper' }), 'custom')
  assert.equal(nextThemeKey({ themeMode: 'light', themeDark: 'plum', themeLight: 'sunset' }), 'custom')
  const patch = nextThemePatch({ themeMode: 'dark', themeDark: 'plum', themeLight: 'paper' })
  assert.equal(patch.themeDark, 'claude')
})
