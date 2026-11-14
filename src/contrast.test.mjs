import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { oklchLightness } from './theme'

/* The stylesheet is the runtime source of the built-in palettes, so this
 * reads the real values rather than a duplicate table. Muted text is body
 * copy in several places (byline, help text, timestamps), which makes 4.5:1
 * against every surface it can sit on the bar — not 3:1 for incidental
 * decoration. */
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

const luminance = (hex) => {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Raw CSS text of every shipped palette block. `neutral` is the pre-paint
 *  fallback and `custom` is user-defined; only the eight built-in palettes
 *  have values this app guarantees. */
const paletteBlocks = () => {
  const found = new Map()
  for (const match of css.matchAll(/\[data-t=([a-z]+)\]\s*\{\s*color-scheme:[^}]*\}/g)) {
    if (match[1] === 'neutral' || match[1] === 'custom') continue
    found.set(match[1], match[0])
  }
  return found
}

const themes = () => {
  const found = new Map()
  for (const [name, block] of paletteBlocks()) {
    const value = (key) => block.match(new RegExp(`--${key}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
    found.set(name, { bg: value('bg'), side: value('side'), surf: value('surf'), hov: value('hov'), mu: value('mu') })
  }
  return found
}

test('muted text meets WCAG AA on every built-in surface', () => {
  const all = themes()
  assert.ok(all.size >= 8, `expected every built-in theme, found ${all.size}`)
  for (const [name, value] of all) {
    for (const surface of ['bg', 'side', 'surf']) {
      assert.ok(value[surface], `${name} is missing --${surface}`)
      assert.ok(value.mu, `${name} is missing --mu`)
      const contrast = ratio(value.mu, value[surface])
      assert.ok(
        contrast >= 4.5,
        `${name}: --mu on --${surface} is ${contrast.toFixed(2)}:1, below 4.5:1`,
      )
    }
  }
})

test('the main background sits darker than the sidebar on every built-in theme', () => {
  for (const [name, value] of themes()) {
    assert.ok(value.side, `${name} is missing --side`)
    assert.ok(
      luminance(value.side) > luminance(value.bg),
      `${name}: --side ${value.side} should be lighter than --bg ${value.bg}`,
    )
  }
})

test('sidebar, surface and hover steps stay perceptible on every built-in theme', () => {
  // OKLCH lightness is perceptually even, so these are steps the eye actually
  // sees. The previous lightened sidebar left hover and panel edges below the
  // visible threshold on the dark themes; this keeps that from regressing.
  for (const [name, value] of themes()) {
    const step = (a, b) => Math.abs(oklchLightness(a) - oklchLightness(b))
    assert.ok(step(value.side, value.bg) >= 0.03, `${name}: --side only ${step(value.side, value.bg).toFixed(3)} L from --bg`)
    assert.ok(step(value.surf, value.bg) >= 0.03, `${name}: --surf only ${step(value.surf, value.bg).toFixed(3)} L from --bg`)
    assert.ok(step(value.hov, value.surf) >= 0.04, `${name}: --hov only ${step(value.hov, value.surf).toFixed(3)} L from --surf`)
  }
})

/* Every token, not just the muted text: the store table seeds the custom-theme
 * editor and the pickers, the stylesheet paints the built-in palettes, and a
 * token that differs between them makes "start from <theme>" produce a palette
 * that does not match the theme it was copied from. It did (error reds), so the
 * assertion now covers all fifteen keys. */
const TOKENS = ['bg', 'side', 'surf', 'hov', 'tx', 'mu', 'ac', 'acx', 'er', 'code', 'codeh', 'c2', 'c3', 'c4', 'c5']

test('every theme token stays in sync with the runtime palette export', () => {
  const source = readFileSync(new URL('./store.ts', import.meta.url), 'utf8')
  for (const [name, block] of paletteBlocks()) {
    const row = source.match(new RegExp(`\\b${name}: \\{[^}]*\\}`))?.[0]
    assert.ok(row, `${name} is missing from THEME_COLORS`)
    for (const key of TOKENS) {
      const cssValue = block.match(new RegExp(`--${key}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
      assert.ok(cssValue, `${name} is missing --${key} in index.css`)
      assert.match(row, new RegExp(`\\b${key}: '${cssValue}'`, 'i'), `${name}: ${key} is ${cssValue} in CSS but differs in THEME_COLORS`)
    }
  }
})
