/* Pure colour helpers behind custom themes. Kept free of store/app imports so
 * the colour math can be tested on its own. */

export type Hsl = { h: number; s: number; l: number }
export type ThemeAdjustment = { hue: number; sat: number; bright: number; contrast: number }

/** Syntax colours stay fixed: hue, saturation and brightness never touch them. */
export const SYNTAX_COLOR_KEYS = ['c2', 'c3', 'c4', 'c5'] as const
/** Error keeps its original colour: hue rotation must not repaint the failure cue,
 * and saturation/brightness must not gray it out or dim it off-screen. */
export const UNADJUSTED_KEYS = [...SYNTAX_COLOR_KEYS, 'er'] as const
/** Brightness must not wash out text, including the label colour on accents. */
export const TEXT_COLOR_KEYS = ['tx', 'mu', 'acx'] as const

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const HEX = /^#[0-9a-f]{6}$/i

/** Parse `#rrggbb` (or `#rgb`) into HSL with h in [0, 360), s/l in [0, 1]. */
export function hexToHsl(hex: string): Hsl {
  let value = String(hex ?? '').trim().replace(/^#/, '')
  if (value.length === 3) value = value.split('').map((c) => c + c).join('')
  const int = Number.parseInt(value.slice(0, 6), 16)
  if (!Number.isFinite(int) || value.length !== 6) return { h: 0, s: 0, l: 0 }
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

/** Format HSL back to a lowercase `#rrggbb` string. */
export function hslToHex({ h, s, l }: Hsl): string {
  const hn = ((h % 360) + 360) % 360
  const sn = clamp(s, 0, 1)
  const ln = clamp(l, 0, 1)
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = ln - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hn < 60) [r, g, b] = [c, x, 0]
  else if (hn < 120) [r, g, b] = [x, c, 0]
  else if (hn < 180) [r, g, b] = [0, c, x]
  else if (hn < 240) [r, g, b] = [0, x, c]
  else if (hn < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && HEX.test(value.trim())

/** Normalize #rgb/#rrggbb to lowercase #rrggbb, or return the fallback. */
export function normalizeHex(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim()
  if (HEX.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase()
  return isHexColor(fallback) ? fallback.toLowerCase() : '#888888'
}

const rgb = (hex: string): [number, number, number] => {
  const value = normalizeHex(hex, '#888888').slice(1)
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as [number, number, number]
}

/** Linear RGB mix; amount 0 returns a, 1 returns b. */
export function mixHex(a: string, b: string, amount: number): string {
  const t = clamp(amount, 0, 1)
  const ca = rgb(a)
  const cb = rgb(b)
  const channel = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * t).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

/** WCAG relative luminance, used to pick black or white text on a fill. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((n) => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The black/white ink crossover sits near 0.179 in relative luminance. A
 *  small bias above it keeps genuinely dark accents white while restoring the
 *  dark ink that mid-tone accents (Claude orange, green, red) need. */
export const INK_THRESHOLD = 0.185
export const inkOn = (hex: string): string => relativeLuminance(hex) > INK_THRESHOLD ? '#101010' : '#ffffff'

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export type ColorRole = 'accent' | 'text' | 'background' | 'onAccent'

const ensureContrast = (color: string, against: string, target: number, direction: 1 | -1): string => {
  const hsl = hexToHsl(color)
  for (let i = 0; i < 60 && contrastRatio(hslToHex(hsl), against) < target; i++) {
    hsl.l = clamp(hsl.l + direction * 0.015, 0, 1)
  }
  return hslToHex(hsl)
}

const uniqueColors = (colors: string[]): string[] => {
  const out: string[] = []
  for (const color of colors) {
    const hex = color.toLowerCase()
    if (!out.includes(hex)) out.push(hex)
  }
  return out
}

/** Theme-aware picks for the three primary custom-theme fields and the text
 *  that sits on an accent fill. These are deliberately role-specific: an
 *  accent needs to stand off the canvas, foreground text needs to be readable
 *  on it, and a background needs to preserve the current text contrast. */
export function colorSuggestions(opts: { role: ColorRole; accent: string; text: string; background: string }): string[] {
  const accent = normalizeHex(opts.accent, '#dc8ad8')
  const text = normalizeHex(opts.text, '#f3eaf7')
  const background = normalizeHex(opts.background, '#17101c')
  const hue = hexToHsl(accent).h
  const backgroundLum = relativeLuminance(background)
  const accentLum = relativeLuminance(accent)
  const offsets = [0, 31, 67, 142, 181, 216, 271, 314]

  if (opts.role === 'accent') {
    const light = backgroundLum < 0.18
    const direction = light ? 1 : -1
    return uniqueColors(offsets.map((offset, i) => ensureContrast(hslToHex({
      h: hue + offset,
      s: light ? 0.72 : 0.74,
      l: clamp((light ? 0.68 : 0.4) + ((i % 3) - 1) * 0.035, 0.18, 0.84),
    }), background, 4.5, direction)))
  }

  if (opts.role === 'text') {
    const light = backgroundLum < 0.18
    const direction = light ? 1 : -1
    return uniqueColors(offsets.map((offset, i) => ensureContrast(hslToHex({
      h: hue + offset,
      s: i === 0 ? 0.05 : 0.22,
      l: clamp((light ? 0.88 : 0.12) + (light ? -1 : 1) * i * 0.03, 0.04, 0.96),
    }), background, 4.5, direction)))
  }

  if (opts.role === 'background') {
    const lightText = relativeLuminance(text) > 0.18
    const direction = lightText ? -1 : 1
    return uniqueColors(offsets.map((offset, i) => ensureContrast(hslToHex({
      h: hue + offset,
      s: i === 0 ? 0.10 : 0.22,
      l: clamp((lightText ? 0.17 : 0.79) + (lightText ? -1 : 1) * i * 0.016, 0.03, 0.97),
    }), text, 4.5, direction)))
  }

  const darkInk = accentLum > INK_THRESHOLD
  const direction = darkInk ? -1 : 1
  const lightness = darkInk
    ? [0.08, 0.055, 0.03, 0.105, 0.13, 0.155, 0.18, 0.205]
    : [0.96, 0.975, 0.99, 0.945, 0.93, 0.915, 0.90, 0.885]
  return uniqueColors(lightness.map((l) => ensureContrast(hslToHex({ h: hue, s: 0.03, l }), accent, 4.5, direction)))
}

/** The hue a theme reads as: the accent colour, which carries its identity. */
export function accentHue(colors: Record<string, string>): number {
  const hue = hexToHsl(colors.ac ?? '#888888').h
  return Math.round(hue) % 360
}

/** Relative luminance of an `#rrggbb` colour (WCAG coefficients). */
export function luminance(hex: string): number {
  return hexToHsl(hex).l
}

/** The complete palette generated for a custom theme. */
export const CUSTOM_PALETTE_KEYS = ['bg', 'side', 'surf', 'hov', 'tx', 'mu', 'ac', 'acx', 'er', 'code', 'codeh', 'c2', 'c3', 'c4', 'c5'] as const
export type CustomPaletteKey = typeof CUSTOM_PALETTE_KEYS[number]

export type CustomPaletteOptions = {
  accent: string
  text: string
  background: string
  /** 0–100. Higher pushes surfaces and text further apart. */
  contrast: number
  /** Individual advanced overrides, applied after generation. */
  overrides?: Partial<Record<string, string>>
}

/** Build a complete palette from three primary colours and one contrast knob.
 *  Surfaces, muted text, code blocks and syntax colours are derived so a
 *  custom theme stays coherent without making the user tune every token.
 *  Surfaces always sit above the chosen background; the sidebar is the first
 *  step up, so the main background is darker than it.
 *
 *  One curve drives every derived colour: `reach` is 0 at 0% (every surface
 *  is the canvas), exactly 1 at the balanced 50% default and 2 at 100%. Each
 *  half eases into the joint, so its slope is zero on both sides of 50% and
 *  dragging across the default never reverses direction abruptly. Surface
 *  amounts scale with diminishing returns toward a per-surface ceiling rather
 *  than overshooting it, which keeps the hierarchy (canvas < sidebar < panel <
 *  hover, code block below the canvas) intact at every position and stops
 *  surfaces from saturating at white or black. */
export function customPalette(opts: CustomPaletteOptions): Record<CustomPaletteKey, string> & { bor: string } {
  const accent = normalizeHex(opts.accent, '#dc8ad8')
  const text = normalizeHex(opts.text, '#f3eaf7')
  const background = normalizeHex(opts.background, '#17101c')
  const requested = clamp(Number.isFinite(opts.contrast) ? opts.contrast : 50, 0, 100) / 100
  const bg = hexToHsl(background)
  const light = bg.l > 0.58

  // Smoothstep is flat at both ends, so the halves meet at 50% without a kink
  // and the slider has no dead step exactly at its default.
  const ease = (x: number) => x * x * (3 - 2 * x)
  const reach = requested <= 0.5
    ? ease(requested / 0.5)
    : 1 + ease((requested - 0.5) / 0.5)

  /* A balanced mix amount scaled by the contrast knob: 0 at 0%, the balanced
   * amount at 50%, easing toward `ceiling` above it. Nothing overshoots the
   * ceiling, so a surface never flips past white or black. */
  const spread = (amount: number, ceiling: number) =>
    ceiling * (1 - Math.pow(1 - clamp(amount / ceiling, 0, 0.999), reach))
  const lift = (amount: number, ceiling: number) => mixHex(background, '#ffffff', spread(amount, ceiling))

  // The sidebar is the first step above the canvas and panels the second, so
  // the main background always reads darker than the sidebar. A user-chosen
  // sidebar override still wins, applied with the rest below.
  const side = lift(light ? 0.6 : 0.05, light ? 0.88 : 0.12)
  const surf = lift(light ? 0.72 : 0.065, light ? 0.94 : 0.16)
  // Hover and selection are a tint of the panel, so they track the panel's own
  // lift at this position instead of a fixed colour.
  const hov = mixHex(surf, text, spread(0.075, 0.18))
  // Code blocks sink below the canvas (dark themes) or shade away from it
  // (light themes); the header is the midpoint between the block and the
  // canvas, so it stays a readable band even when panels sit near white.
  const code = light
    ? mixHex(background, text, spread(0.035, 0.12))
    : mixHex(background, '#000000', spread(0.26, 0.5))
  const codeh = mixHex(code, background, 0.55)
  // Muted text keeps its footing below the default; it only starts closing on
  // the text colour once surfaces separate, never merging into the canvas.
  const textReach = Math.max(1, reach)
  const mu = mixHex(text, background, 0.44 - 0.14 * (textReach - 1))
  const er = hslToHex({ h: 2, s: light ? 0.62 : 0.68, l: light ? 0.40 : 0.64 })
  const accentHueValue = hexToHsl(accent).h
  // Syntax keeps recognisable semantic families (strings green, numbers warm,
  // titles blue, types violet) while leaning slightly toward the accent hue.
  // The ramp is clamped at the default, which is smooth because the curve has
  // zero slope there; syntax only strengthens above 50%.
  const syntaxSpread = Math.max(0, reach - 1)
  const semanticHues = [146, 32, 212, 282]
  const syntax = semanticHues.map((hue) => hslToHex({
    h: hue * 0.82 + accentHueValue * 0.18,
    s: light ? 0.52 + syntaxSpread * 0.22 : 0.55 + syntaxSpread * 0.25,
    l: light ? 0.40 - syntaxSpread * 0.10 : 0.66 + syntaxSpread * 0.10,
  }))

  const out: Record<CustomPaletteKey, string> = {
    bg: background,
    side,
    surf,
    hov,
    tx: text,
    mu,
    ac: accent,
    acx: inkOn(accent),
    er,
    code,
    codeh,
    c2: syntax[0],
    c3: syntax[1],
    c4: syntax[2],
    c5: syntax[3],
  }

  for (const [key, value] of Object.entries(opts.overrides ?? {})) {
    if ((CUSTOM_PALETTE_KEYS as readonly string[]).includes(key) && isHexColor(value)) out[key as CustomPaletteKey] = value.toLowerCase()
  }
  // The app's border is normally a mix of hover and muted text. Its weight
  // follows the same curve, so it fades out of the canvas continuously instead
  // of stepping to the background only at the very end of the slider.
  const bor = mixHex(out.hov, out.mu, spread(0.2, 0.36))
  return { ...out, bor }
}

/** Build a complete palette from one picked accent colour and a base theme.
 *
 * The base supplies each surface's lightness and the fixed syntax/error hues;
 * the picked colour supplies the hue, and lightly tints neutrals so the theme
 * reads as one family rather than a stock theme with a swapped button. The
 * accent is used exactly as picked, and `acx` (text on the accent) flips to
 * black or white for contrast. */
export function accentOnlyColors(base: Record<string, string>, accent: string): Record<string, string> {
  const picked = normalizeHex(accent, base.ac ?? '#888888')
  const a = hexToHsl(picked)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (key === 'ac') { out[key] = picked; continue }
    if (key === 'acx') { out[key] = inkOn(picked); continue }
    // Syntax and error colours keep the base theme's identity (and stay
    // legible); everything else picks up a restrained amount of the accent hue.
    if ((UNADJUSTED_KEYS as readonly string[]).includes(key)) { out[key] = value; continue }
    const hsl = hexToHsl(value)
    const text = (TEXT_COLOR_KEYS as readonly string[]).includes(key)
    const tint = key === 'bg' || key === 'side' || key === 'surf' || key === 'hov'
      ? Math.min(0.18, a.s * 0.22)
      : text ? Math.min(0.16, a.s * 0.18) : Math.min(0.3, a.s * 0.4)
    out[key] = hslToHex({ h: a.h, s: tint, l: hsl.l })
  }
  // The accent itself may be very light or very dark; keep the hover surface
  // distinct from it so a pressed control still reads as pressed.
  if (out.hov === out.ac) out.hov = hslToHex({ h: a.h, s: Math.min(1, a.s * 0.9), l: a.l > 0.5 ? Math.max(0, a.l - 0.12) : Math.min(1, a.l + 0.12) })
  return out
}

/** Apply a hue rotation, saturation multiplier and brightness multiplier.
 *
 * `hue` is the target hue; the rotation is relative to `baseHue` so a freshly
 * selected base theme sits at 0° of adjustment. Syntax and error colours are
 * untouched entirely, and text keeps its lightness so brightness cannot make it unreadable. */
export function adjustThemeColors(
  colors: Record<string, string>,
  opts: { baseHue: number; hue: number; sat: number; bright: number; contrast?: number },
): Record<string, string> {
  const delta = ((opts.hue - opts.baseHue) % 360 + 360) % 360
  const sat = clamp(opts.sat, 0, 2)
  const bright = clamp(opts.bright, 0, 3)
  const contrast = Number.isFinite(opts.contrast) ? clamp(opts.contrast as number, 1, 2) : 1
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(colors)) {
    if ((UNADJUSTED_KEYS as readonly string[]).includes(key) || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) {
      out[key] = value
      continue
    }
    const hsl = hexToHsl(value)
    const text = (TEXT_COLOR_KEYS as readonly string[]).includes(key)
    out[key] = hslToHex({
      h: hsl.h + delta,
      s: hsl.s * sat,
      // Contrast spreads every non-text surface around mid brightness after
      // the brightness scale: lights get brighter, darks get darker.
      l: text ? hsl.l : clamp(0.5 + (hsl.l * bright - 0.5) * contrast, 0, 1),
    })
  }
  return out
}
