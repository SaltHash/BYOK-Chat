import test from 'node:test'
import assert from 'node:assert/strict'
import { hexToHsl, hslToHex, accentHue, adjustThemeColors, customPalette, CUSTOM_PALETTE_KEYS, isHexColor, inkOn, contrastRatio, colorSuggestions, SYNTAX_COLOR_KEYS, TEXT_COLOR_KEYS, UNADJUSTED_KEYS } from './theme'

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

test('hue rotates everything except syntax and error colours', () => {
  const colors = { ac: '#dc8ad8', bg: '#17101c', c2: '#9fe3c5', c3: '#f2b98b' }
  const base = accentHue(colors)
  const out = adjustThemeColors(colors, { baseHue: base, hue: base + 90, sat: 1, bright: 1 })
  const delta = (hexToHsl(out.ac).h - base + 360) % 360
  assert.equal(Math.round(delta), 90)
  for (const key of UNADJUSTED_KEYS) if (colors[key]) assert.equal(out[key], colors[key], `${key} untouched`)
})

test('saturation 0 greys out colours but never touches syntax or error', () => {
  const colors = { ac: '#dc8ad8', tx: '#f3eaf7', c4: '#8fb9ff', er: '#f95353' }
  const out = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 0, bright: 1 })
  assert.equal(hexToHsl(out.ac).s, 0)
  assert.equal(out.c4, colors.c4)
  assert.equal(out.er, colors.er)
})

test('brightness scales surfaces and leaves text and error alone', () => {
  const colors = { bg: '#17101c', tx: '#f3eaf7', mu: '#a893b4', acx: '#1b1020', c5: '#c7a6ff', er: '#f95353' }
  const out = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 1, bright: 2 })
  assert.ok(hexToHsl(out.bg).l > hexToHsl(colors.bg).l * 1.5, 'surfaces brighten')
  for (const key of TEXT_COLOR_KEYS) assert.equal(out[key], colors[key], `${key} untouched`)
  assert.equal(out.c5, colors.c5)
  assert.equal(out.er, colors.er)
})

test('normCustomTheme-style clamping keeps extreme slider values in range', () => {
  const colors = { bg: '#17101c', ac: '#dc8ad8' }
  const black = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 1, bright: 0 })
  assert.equal(hexToHsl(black.bg).l, 0)
  const max = adjustThemeColors(colors, { baseHue: 303, hue: 303, sat: 2, bright: 3 })
  assert.ok(hexToHsl(max.ac).s <= 1)
  assert.ok(hexToHsl(max.bg).l <= 1)
})

test('a custom palette is generated from accent, text and background', () => {
  const palette = customPalette({ accent: '#7c9cff', text: '#f8f8f8', background: '#141416', contrast: 55 })
  assert.deepEqual(Object.keys(palette).filter((key) => key !== 'bor').sort(), [...CUSTOM_PALETTE_KEYS].sort())
  assert.equal(palette.ac, '#7c9cff')
  assert.equal(palette.tx, '#f8f8f8')
  assert.equal(palette.bg, '#141416')
  for (const key of CUSTOM_PALETTE_KEYS) assert.ok(isHexColor(palette[key]), `${key} is a hex colour`)
  assert.ok(isHexColor(palette.bor), 'the derived border is a hex colour')
  assert.ok(palette.er !== palette.c2, 'error and syntax colours are distinct')
})

test('contrast 50 is the balanced default, 0 is genuinely flat, and 100 separates further', () => {
  const opts = { accent: '#7c9cff', text: '#f8f8f8', background: '#141416' }
  const flat = customPalette({ ...opts, contrast: 0 })
  const balanced = customPalette({ ...opts, contrast: 50 })
  const high = customPalette({ ...opts, contrast: 100 })
  for (const key of ['side', 'surf', 'hov', 'code', 'codeh']) assert.equal(flat[key], flat.bg, `${key} disappears at 0%`)
  assert.equal(flat.bor, flat.bg, 'the border disappears at 0%')
  assert.equal(balanced.side, '#101012', '50% keeps the old 0% sidebar')
  assert.equal(balanced.surf, '#232325', '50% keeps the old 0% surface')
  assert.ok(hexToHsl(balanced.surf).l > hexToHsl(flat.surf).l, 'the balanced surface lifts off the background')
  assert.ok(hexToHsl(high.surf).l > hexToHsl(balanced.surf).l, 'higher contrast separates further')
  assert.ok(Math.abs(hexToHsl(high.mu).l - hexToHsl(high.tx).l) < Math.abs(hexToHsl(balanced.mu).l - hexToHsl(balanced.tx).l), 'muted text moves toward the text colour')
})

test('accent ink restores dark text on mid-tone accents and stays readable', () => {
  for (const accent of ['#d97757', '#dc8ad8', '#0d9488', '#16a34a', '#ea580c', '#ef4444', '#eab308']) {
    assert.equal(inkOn(accent), '#101010', `${accent} uses dark ink`)
    assert.ok(contrastRatio(inkOn(accent), accent) >= 4.5, `${accent} keeps readable ink`)
  }
  for (const accent of ['#3b5bdb', '#2563eb', '#111827']) {
    assert.equal(inkOn(accent), '#ffffff', `${accent} keeps white ink`)
    assert.ok(contrastRatio(inkOn(accent), accent) >= 4.5, `${accent} keeps readable ink`)
  }
})

test('color suggestions follow the role and the active theme', () => {
  const dark = { accent: '#7c9cff', text: '#f8f8f8', background: '#141416' }
  const light = { accent: '#3b5bdb', text: '#1d1d1b', background: '#fbfbf9' }
  const roles = ['accent', 'text', 'background', 'onAccent']
  for (const role of roles) {
    const onDark = colorSuggestions({ role, ...dark })
    const onLight = colorSuggestions({ role, ...light })
    assert.equal(new Set(onDark).size, 8, `${role} suggestions stay distinct`)
    assert.equal(new Set(onLight).size, 8, `${role} suggestions stay distinct on light`)
    assert.ok(onDark.every(isHexColor) && onLight.every(isHexColor))
    assert.notDeepEqual(onDark, onLight, `${role} suggestions follow the theme`)
  }
  for (const color of colorSuggestions({ role: 'accent', ...dark })) assert.ok(contrastRatio(color, dark.background) >= 4.5)
  for (const color of colorSuggestions({ role: 'text', ...dark })) assert.ok(contrastRatio(color, dark.background) >= 4.5)
  for (const color of colorSuggestions({ role: 'text', ...light })) assert.ok(contrastRatio(color, light.background) >= 4.5)
  for (const color of colorSuggestions({ role: 'background', ...dark })) assert.ok(contrastRatio(color, dark.text) >= 4.5)
  for (const color of colorSuggestions({ role: 'background', ...light })) assert.ok(contrastRatio(color, light.text) >= 4.5)
  for (const color of colorSuggestions({ role: 'onAccent', ...dark })) assert.ok(contrastRatio(color, dark.accent) >= 4.5)
  const spread = (role) => {
    const values = colorSuggestions({ role, ...dark }).map((color) => hexToHsl(color).l)
    return Math.max(...values) - Math.min(...values)
  }
  assert.ok(spread('text') >= 0.12, 'text suggestions vary visibly in lightness')
  assert.ok(spread('background') >= 0.08, 'background suggestions vary visibly in lightness')
})

test('advanced overrides win only when they are valid colours', () => {
  const palette = customPalette({
    accent: '#7c9cff', text: '#f8f8f8', background: '#141416', contrast: 50,
    overrides: { c2: '#00ff99', er: '#ff3355', tx: 'not-a-colour' },
  })
  assert.equal(palette.c2, '#00ff99')
  assert.equal(palette.er, '#ff3355')
  assert.equal(palette.tx, '#f8f8f8')
})
