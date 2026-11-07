import test from 'node:test'
import assert from 'node:assert/strict'

const {
  DEFAULT_BG_BLUR,
  DEFAULT_BG_IMAGE,
  DEFAULT_BG_SATURATION,
  DEFAULT_BG_TINT,
  WALLPAPERS,
  isCustomBg,
  normBgBlur,
  normBgDim,
  normBgSaturation,
  normBgTint,
  safeBgSource,
  wallpaperLabel,
  wallpaperThumb,
} = await import('./background.ts')

test('background blur, dim, saturation and tint clamp to their supported ranges', () => {
  assert.equal(DEFAULT_BG_BLUR, 10)
  assert.equal(DEFAULT_BG_SATURATION, 100)
  assert.equal(DEFAULT_BG_TINT, 0)
  assert.equal(normBgBlur(-10), 0)
  assert.equal(normBgBlur(100.4), 100)
  assert.equal(normBgBlur(45.6), 46)
  assert.equal(normBgBlur(Number.NaN), 0)
  assert.equal(normBgDim(-1), 0)
  assert.equal(normBgDim(95.4), 95)
  assert.equal(normBgDim(120), 95)
  assert.equal(normBgDim(undefined), 0)
  assert.equal(normBgSaturation(-1), 0)
  assert.equal(normBgSaturation(149.6), 150)
  assert.equal(normBgSaturation(240), 200)
  assert.equal(normBgSaturation(undefined), 100)
  assert.equal(normBgTint(-1), 0)
  assert.equal(normBgTint(49.6), 50)
  assert.equal(normBgTint(120), 100)
  assert.equal(normBgTint(undefined), 0)
})

test('only the bundled assets and local paths are valid background sources', () => {
  assert.equal(safeBgSource(DEFAULT_BG_IMAGE), DEFAULT_BG_IMAGE)
  assert.equal(safeBgSource('/images/photo.jpg'), '/images/photo.jpg')
  assert.equal(safeBgSource('https://example.com/photo.jpg'), DEFAULT_BG_IMAGE)
  assert.equal(safeBgSource('//example.com/photo.jpg'), DEFAULT_BG_IMAGE)
  assert.equal(safeBgSource('background:abc'), DEFAULT_BG_IMAGE)
})

test('the old root-level default moves into the wallpaper folder', () => {
  assert.equal(safeBgSource('/clay-banks-u27Rrbs9Dwc-unsplash.jpg'), DEFAULT_BG_IMAGE)
})

test('custom background ids are recognized without treating other strings as blobs', () => {
  assert.equal(isCustomBg('background:abc'), true)
  assert.equal(isCustomBg(DEFAULT_BG_IMAGE), false)
  assert.equal(isCustomBg(undefined), false)
})

test('every bundled wallpaper has a distinct thumbnail and readable label', () => {
  assert.ok(WALLPAPERS.some((wallpaper) => wallpaper.src === DEFAULT_BG_IMAGE))
  assert.equal(new Set(WALLPAPERS.map((wallpaper) => wallpaper.src)).size, WALLPAPERS.length)
  assert.equal(new Set(WALLPAPERS.map((wallpaper) => wallpaperThumb(wallpaper.src))).size, WALLPAPERS.length)
  assert.equal(wallpaperThumb(DEFAULT_BG_IMAGE), '/wallpapers/thumbs/clay-banks-u27Rrbs9Dwc-unsplash.jpg')
  assert.equal(wallpaperLabel(DEFAULT_BG_IMAGE), 'Clay Banks')
  assert.equal(wallpaperLabel('background:one'), 'Custom image')
})
