import test from 'node:test'
import assert from 'node:assert/strict'
import { hexToHsl, hslToHex, accentHue, adjustThemeColors, SYNTAX_COLOR_KEYS, TEXT_COLOR_KEYS } from './theme'

test('hexToHsl reads the accent hues the sliders snap to', () => {
  assert.equal(Math.round(hexToHsl('#dc8ad8').h), 303) // plum accent
  assert.equal(Math.round(hexToHsl('#d97757').h), 15) // claude accent
  assert.equal(hexToHsl('#ffffff').s, 0)
  assert.equal(hexToHsl('#000000').l, 0)
})

test('hslToHex round-trips through hexToHsl', () => {
  for (const hex of ['#dc8ad8', '#17101c', '#f3eaf7', '#ea580c', '#0d9488']) {
    const hsl = hexToHsl(hex)
    const again = hexToHsl(hslToHex(hsl))
    assert.ok(Math.abs(again.h - hsl.h) <= 1, `${hex} hue drift: ${again.h} vs ${hsl.h}`)
    assert.ok(Math.abs(again.s - hsl.s) <= 0.01)
    assert.ok(Math.abs(again.l - hsl.l) <= 0.01)
  }
})

test('accentHue is the base hue and identity adjustments are a no-op', () => {
  const colors = { ac: '#dc8ad8', bg: '#17101c', tx: '#f3eaf7', c2: '#9fe3c5' }
  const base = accentHue(colors)
  const same = adjustThemeColors(colors, { baseHue: base, hue: base, sat: 1, bright: 1 })
  assert.ok(Math.abs(hexToHsl(same.ac).h - base) <= 1, `accent hue stays put: ${hexToHsl(same.ac).h} vs ${base}`)
  assert.equal(hexToHsl(same.bg).s, hexToHsl(colors.bg).s, 'neutral saturation survives a no-op')
})

test('hue rotates everything except syntax colours', () => {
  const colors = { ac: '#dc8ad8', bg: '#17101c', c2: '#9fe3c5', c3: '#f2b98b' }
  const base = accentHue(colors)
  const out = adjustThemeColors(colors, { baseHue: base, hue: base + 90, sat: 1, bright: 1 })
  const delta = (hexToHsl(out.ac).h - base + 360) % 360
  assert.equal(Math.round(delta), 90)
  for (const key of SYNTAX_COLOR_KEYS) if (colors[key]) assert.equal(out[key], colors[key], `${key} untouched`)
})

test('saturation 0 greys out colours but never touches syntax', () => {
  const colors = { ac: '#dc8ad8', tx: '#f3eaf7', c4: '#8fb9ff' }
  const out = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 0, bright: 1 })
  assert.equal(hexToHsl(out.ac).s, 0)
  assert.equal(out.c4, colors.c4)
})

test('brightness scales surfaces and leaves text alone', () => {
  const colors = { bg: '#17101c', tx: '#f3eaf7', mu: '#a893b4', acx: '#1b1020', c5: '#c7a6ff' }
  const out = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 1, bright: 2 })
  assert.ok(hexToHsl(out.bg).l > hexToHsl(colors.bg).l * 1.5, 'surfaces brighten')
  for (const key of TEXT_COLOR_KEYS) assert.equal(out[key], colors[key], `${key} untouched`)
  assert.equal(out.c5, colors.c5)
})

test('normCustomTheme-style clamping keeps extreme slider values in range', () => {
  const colors = { bg: '#17101c', ac: '#dc8ad8' }
  const black = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 1, bright: 0 })
  assert.equal(hexToHsl(black.bg).l, 0)
  const max = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 2, bright: 3 })
  assert.ok(hexToHsl(max.ac).s <= 1)
  assert.ok(hexToHsl(max.bg).l <= 1)
})
