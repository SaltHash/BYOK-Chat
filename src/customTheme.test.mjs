import test from 'node:test'
import assert from 'node:assert/strict'
import { normCustomTheme } from './store.ts'

const fallback = {
  base: 'plum',
  accent: '#dc8ad8',
  text: '#f3eaf7',
  background: '#17101c',
  contrast: 50,
  overrides: {},
}

test('current custom themes keep 1% and 2% contrast as percentages', () => {
  for (const contrast of [0, 1, 2, 3, 50, 100]) {
    assert.equal(normCustomTheme({ ...fallback, contrast }, fallback).contrast, contrast)
  }
})

test('legacy custom themes still migrate their 1–2 contrast slider', () => {
  const legacy = { base: 'plum', hue: 303, sat: 1, bright: 1, contrast: 1.5, overrides: {} }
  assert.equal(normCustomTheme(legacy, fallback).contrast, 75)
  assert.equal(normCustomTheme({ ...legacy, contrast: 1 }, fallback).contrast, 50)
  assert.equal(normCustomTheme({ ...legacy, contrast: 2 }, fallback).contrast, 100)
})
