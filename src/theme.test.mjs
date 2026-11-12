import test from 'node:test'
import assert from 'node:assert/strict'
import { hexToHsl, hslToHex, accentHue, adjustThemeColors, customPalette, CUSTOM_PALETTE_KEYS, isHexColor, inkOn, contrastRatio, colorSuggestions, hexToOklch, oklchToHex, oklchLightness, mixOklch, SYNTAX_COLOR_KEYS, TEXT_COLOR_KEYS, UNADJUSTED_KEYS } from './theme'

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
  // The default step is measured in OKLCH lightness, the axis the eye reads as
  // even: below ~0.04 a surface change stops being reliably visible, which is
  // the regression this guards against.
  const step = (a, b) => oklchLightness(a) - oklchLightness(b)
  assert.ok(step(balanced.side, balanced.bg) >= 0.035, `the sidebar clears the main background (${step(balanced.side, balanced.bg).toFixed(3)})`)
  assert.ok(step(balanced.surf, balanced.side) >= 0.04, `panels clear the sidebar (${step(balanced.surf, balanced.side).toFixed(3)})`)
  assert.ok(step(balanced.hov, balanced.surf) >= 0.04, `hover clears the panel (${step(balanced.hov, balanced.surf).toFixed(3)})`)
  // The ladder is roughly evenly spaced, and the sidebar-to-canvas step is the
  // smallest one: cards, hover and soft buttons need room between themselves,
  // while the sidebar should read as the same room as the conversation.
  for (const palette of [balanced, high]) {
    const gaps = [step(palette.side, palette.bg), step(palette.surf, palette.side), step(palette.hov, palette.surf)]
    assert.ok(gaps[0] <= gaps[1] && gaps[1] <= gaps[2] + 0.005, `surface steps stay in order: ${gaps.map((g) => g.toFixed(3)).join(', ')}`)
    assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.03, `surface steps stay even: ${gaps.map((g) => g.toFixed(3)).join(', ')}`)
  }
  assert.ok(hexToHsl(balanced.surf).l > hexToHsl(flat.surf).l, 'the balanced surface lifts off the background')
  const light = customPalette({ accent: '#3b5bdb', text: '#1d1d1b', background: '#f0f0ee', contrast: 50 })
  // A light canvas has no headroom to lift into without turning white, so it
  // separates downward and the steps stay responsive to 100%.
  assert.ok(oklchLightness(light.side) < oklchLightness(light.bg), 'the light sidebar separates from the canvas')
  assert.ok(oklchLightness(light.surf) < oklchLightness(light.side), 'panels step further from the light canvas than the sidebar')
  assert.ok(oklchLightness(light.bg) - oklchLightness(light.side) < oklchLightness(light.bg) - oklchLightness(light.surf), 'the light sidebar is the smallest step')
  assert.ok(hexToHsl(high.surf).l > hexToHsl(balanced.surf).l, 'higher contrast separates further')
  assert.ok(Math.abs(hexToHsl(high.mu).l - hexToHsl(high.tx).l) < Math.abs(hexToHsl(balanced.mu).l - hexToHsl(balanced.tx).l), 'muted text moves toward the text colour')
})

test('the contrast slider is continuous, ordered and ceiling-limited', () => {
  const opts = { accent: '#7c9cff', text: '#f8f8f8', background: '#141416' }
  const at = (contrast) => customPalette({ ...opts, contrast })

  // No kink at the 50% default: one step either side stays put.
  const below = at(49), centre = at(50), above = at(51)
  for (const key of ['side', 'surf', 'hov', 'code', 'codeh', 'bor']) {
    const step = Math.abs(hexToHsl(centre[key]).l - hexToHsl(below[key]).l)
    const next = Math.abs(hexToHsl(above[key]).l - hexToHsl(centre[key]).l)
    assert.ok(step < 0.01 && next < 0.01, `${key} does not jump across the default`)
  }

  // Surfaces only ever rise as contrast rises, and the hierarchy holds at
  // every position, so dragging never makes a panel sink behind the sidebar.
  let previous = at(0)
  for (let contrast = 5; contrast <= 100; contrast += 5) {
    const current = at(contrast)
    for (const key of ['side', 'surf']) {
      assert.ok(hexToHsl(current[key]).l >= hexToHsl(previous[key]).l, `${key} never falls at ${contrast}%`)
    }
    assert.ok(hexToHsl(current.side).l >= hexToHsl(current.bg).l, `sidebar stays above the canvas at ${contrast}%`)
    assert.ok(hexToHsl(current.surf).l >= hexToHsl(current.side).l, `panels stay above the sidebar at ${contrast}%`)
    assert.ok(hexToHsl(current.hov).l >= hexToHsl(current.surf).l, `hover stays above the panel at ${contrast}%`)
    previous = current
  }
  assert.ok(contrastRatio(at(1).bor, at(1).bg) < contrastRatio(at(100).bor, at(100).bg), 'the border gains weight with contrast')

  // The far end approaches the ceilings without ever reaching pure white or
  // black, and every surface stays distinct from the canvas.
  for (const [background, text] of [['#141416', '#f8f8f8'], ['#f0f0ee', '#1d1d1b']]) {
    const palette = customPalette({ accent: '#7c9cff', text, background, contrast: 100 })
    for (const key of ['side', 'surf', 'hov', 'code', 'codeh', 'mu']) {
      assert.ok(!/^#(ffffff|000000)$/i.test(palette[key]), `${key} stays inside the range on ${background}`)
      assert.ok(contrastRatio(palette[key], palette.bg) > 1.01, `${key} stays distinct from the canvas on ${background}`)
    }
  }
})

test('OKLCH conversions round-trip and give every hue the same surface step', () => {
  for (const hex of ['#141416', '#7c9cff', '#f0f0ee', '#0d9488', '#ea580c', '#ffffff']) {
    const back = oklchToHex(hexToOklch(hex))
    assert.deepEqual([1, 3, 5].map((i) => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= 1), [true, true, true], `${hex} survives the round trip as ${back}`)
  }
  // The whole point of doing the scaling in OKLCH: the same slider value
  // produces the same perceived step whatever the theme hue.
  const steps = ['#141416', '#1b1a14', '#101a18', '#241a1a', '#17122a'].map((background) => {
    const p = customPalette({ accent: '#7c9cff', text: '#f8f8f8', background, contrast: 50 })
    return oklchLightness(p.side) - oklchLightness(p.bg)
  })
  assert.ok(Math.max(...steps) - Math.min(...steps) < 0.004, `steps stay even across hues: ${steps.map((s) => s.toFixed(3)).join(', ')}`)
  assert.ok(mixOklch('#000000', '#ffffff', 0.5) !== '#000000' && mixOklch('#000000', '#ffffff', 1) === '#ffffff')
})

test('light palettes keep responding across the whole contrast range', () => {
  const opts = { accent: '#3b5bdb', text: '#1d1d1b', background: '#f0f0ee' }
  const at = (contrast) => customPalette({ ...opts, contrast })
  const [flat, balanced, high] = [at(0), at(50), at(100)]
  for (const key of ['side', 'surf', 'hov']) {
    const lower = oklchLightness(balanced[key]) - oklchLightness(flat[key])
    const upper = oklchLightness(high[key]) - oklchLightness(balanced[key])
    assert.ok(lower <= -0.02, `${key} separates below the default (${lower.toFixed(3)})`)
    assert.ok(upper <= -0.015, `${key} keeps separating above the default (${upper.toFixed(3)})`)
  }
  assert.ok(oklchLightness(high.surf) < oklchLightness(high.side), 'the light hierarchy holds at 100%')
  assert.ok(oklchLightness(high.hov) < oklchLightness(high.surf), 'hover stays deeper than the panel at 100%')
  assert.ok(!/^#ffffff$/i.test(high.side) && !/^#ffffff$/i.test(high.surf), 'nothing saturates at white')

  // The same holds for a canvas that is already almost white.
  const near = customPalette({ accent: '#3b5bdb', text: '#1d1d1b', background: '#fdfdfc', contrast: 50 })
  assert.ok(oklchLightness(near.side) < oklchLightness(near.bg), `sidebar darkens (${near.side} vs ${near.bg})`)
  assert.ok(oklchLightness(near.surf) < oklchLightness(near.side), `panels step further than the sidebar (${near.surf} vs ${near.side})`)
  assert.ok(oklchLightness(near.hov) < oklchLightness(near.surf), `hover stays visible (${near.hov})`)
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
