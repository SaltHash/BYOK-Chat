import test from 'node:test'
import assert from 'node:assert/strict'

const {
  DEFAULT_BG_IMAGE,
  isCustomBg,
  normBgBlur,
  normBgDim,
  safeBgSource,
} = await import('./background.ts')

test('background blur and dim clamp to their supported ranges', () => {
  assert.equal(normBgBlur(-10), 0)
  assert.equal(normBgBlur(100.4), 100)
  assert.equal(normBgBlur(45.6), 46)
  assert.equal(normBgBlur(Number.NaN), 0)
  assert.equal(normBgDim(-1), 0)
  assert.equal(normBgDim(95.4), 95)
  assert.equal(normBgDim(120), 95)
  assert.equal(normBgDim(undefined), 0)
})

test('only the bundled asset and local paths are valid background sources', () => {
  assert.equal(safeBgSource(DEFAULT_BG_IMAGE), DEFAULT_BG_IMAGE)
  assert.equal(safeBgSource('/images/photo.jpg'), '/images/photo.jpg')
  assert.equal(safeBgSource('https://example.com/photo.jpg'), DEFAULT_BG_IMAGE)
  assert.equal(safeBgSource('//example.com/photo.jpg'), DEFAULT_BG_IMAGE)
  assert.equal(safeBgSource('background:abc'), DEFAULT_BG_IMAGE)
})

test('custom background ids are recognized without treating other strings as blobs', () => {
  assert.equal(isCustomBg('background:abc'), true)
  assert.equal(isCustomBg(DEFAULT_BG_IMAGE), false)
  assert.equal(isCustomBg(undefined), false)
})
