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

export const inkOn = (hex: string): string => relativeLuminance(hex) > 0.42 ? '#101010' : '#ffffff'

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
 *  custom theme stays coherent without making the user tune every token. */
export function customPalette(opts: CustomPaletteOptions): Record<CustomPaletteKey, string> {
  const accent = normalizeHex(opts.accent, '#dc8ad8')
  const text = normalizeHex(opts.text, '#f3eaf7')
  const background = normalizeHex(opts.background, '#17101c')
  const c = clamp(Number.isFinite(opts.contrast) ? opts.contrast : 50, 0, 100) / 100
  const bg = hexToHsl(background)
  const light = bg.l > 0.58

  const side = light
    ? mixHex(background, text, 0.035 + 0.035 * c)
    : mixHex(background, '#000000', 0.20 - 0.06 * c)
  const surf = light
    ? mixHex(background, '#ffffff', 0.72)
    : mixHex(background, '#ffffff', 0.065 + 0.09 * c)
  const hov = mixHex(surf, text, 0.075 + 0.09 * c)
  const mu = mixHex(text, background, 0.44 - 0.14 * c)
  const code = light
    ? mixHex(background, text, 0.035 + 0.025 * c)
    : mixHex(background, '#000000', 0.26 - 0.08 * c)
  const codeh = mixHex(code, surf, 0.55)
  const er = hslToHex({ h: 2, s: light ? 0.62 : 0.68, l: light ? 0.40 : 0.64 })
  const accentHueValue = hexToHsl(accent).h
  // Syntax keeps recognisable semantic families (strings green, numbers warm,
  // titles blue, types violet) while leaning slightly toward the accent hue.
  const semanticHues = [146, 32, 212, 282]
  const syntax = semanticHues.map((hue) => hslToHex({
    h: hue * 0.82 + accentHueValue * 0.18,
    s: light ? 0.52 + c * 0.22 : 0.55 + c * 0.25,
    l: light ? 0.40 - c * 0.10 : 0.66 + c * 0.10,
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
  return out
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
