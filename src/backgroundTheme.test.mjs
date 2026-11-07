import test from 'node:test'
import assert from 'node:assert/strict'

const { DEFAULT_BG_ACCENT, DEFAULT_BG_IMAGE, WALLPAPERS, wallpaperAccent } = await import('./background.ts')
const { tuneAccent, wallpaperPalette } = await import('./backgroundTheme.ts')
const { hexToHsl } = await import('./theme.ts')

test('every bundled wallpaper has a mid-range accent', () => {
  for (const wallpaper of WALLPAPERS) {
    assert.match(wallpaper.accent, /^#[0-9a-f]{6}$/)
    const hsl = hexToHsl(wallpaper.accent)
    assert.ok(hsl.s >= 0.18 && hsl.s <= 0.6, `${wallpaper.label} accent saturation ${hsl.s}`)
    assert.ok(hsl.l >= 0.54 && hsl.l <= 0.72, `${wallpaper.label} accent lightness ${hsl.l}`)
  }
  assert.equal(wallpaperAccent(WALLPAPERS[0].src), WALLPAPERS[0].accent)
  assert.equal(wallpaperAccent('not-a-wallpaper'), WALLPAPERS.find((wallpaper) => wallpaper.src === DEFAULT_BG_IMAGE).accent)
  assert.equal(wallpaperAccent('background:custom'), DEFAULT_BG_ACCENT)
})

test('sampled accents are nudged into the same usable middle range', () => {
  assert.equal(tuneAccent('#ff0000'), '#d25656')
  assert.equal(tuneAccent('#888888'), DEFAULT_BG_ACCENT)
  assert.equal(tuneAccent('not-a-colour'), DEFAULT_BG_ACCENT)
  assert.equal(tuneAccent(undefined), DEFAULT_BG_ACCENT)
  const soft = tuneAccent('#102030')
  const hsl = hexToHsl(soft)
  assert.ok(hsl.s >= 0.28 && hsl.s <= 0.58)
  assert.ok(hsl.l >= 0.575 && hsl.l <= 0.68)
})

test('a wallpaper palette keeps syntax colours and moves the accent and surfaces', () => {
  const base = {
    bg: '#181817', side: '#121211', surf: '#20201f', hov: '#2c2b2a',
    tx: '#ece7db', mu: '#a09891', ac: '#d97757', acx: '#121211', er: '#e46a6a',
    code: '#111110', codeh: '#121211', c2: '#7ec699', c3: '#f4a58a', c4: '#7cace8', c5: '#e8c47c',
  }
  const palette = wallpaperPalette(base, '#7e9ec8')
  assert.equal(palette.c2, base.c2)
  assert.equal(palette.er, base.er)
  assert.notEqual(palette.ac, base.ac)
  assert.notEqual(palette.bg, base.bg)
  assert.match(palette.ac, /^#[0-9a-f]{6}$/)
})
