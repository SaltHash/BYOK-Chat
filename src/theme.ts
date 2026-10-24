/* Pure HSL helpers behind the custom theme sliders. Kept free of store/app
 * imports so the colour math can be tested on its own. */

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

/** Parse `#rrggbb` (or `#rgb`) into HSL with h in [0, 360), s/l in [0, 1]. */
export function hexToHsl(hex: string): Hsl {
  let value = hex.trim().replace(/^#/, '')
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

/** The hue a theme reads as: the accent colour, which carries its identity. */
export function accentHue(colors: Record<string, string>): number {
  const hue = hexToHsl(colors.ac ?? '#888888').h
  return Math.round(hue) % 360
}

/** Relative luminance of an `#rrggbb` colour (WCAG coefficients). */
export function luminance(hex: string): number {
  const hsl = hexToHsl(hex)
  // HSL lightness is enough for choosing a readable foreground: the accent's
  // own saturation does not change whether black or white text reads better.
  return hsl.l
}

/** Build a complete palette from one picked accent colour and a base theme.
 *
 * The base supplies each surface's lightness and the fixed syntax/error hues;
 * the picked colour supplies the hue, and lightly tints neutrals so the theme
 * reads as one family rather than a stock theme with a swapped button. The
 * accent is used exactly as picked, and `acx` (text on the accent) flips to
 * black or white for contrast. This is the "accent-only" palette: one choice,
 * a whole theme, no sliders. */
export function accentOnlyColors(base: Record<string, string>, accent: string): Record<string, string> {
  const picked = /^#[0-9a-f]{6}$/i.test(String(accent ?? '').trim()) ? String(accent).trim().toLowerCase() : (base.ac ?? '#888888')
  const a = hexToHsl(picked)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (key === 'ac') { out[key] = picked; continue }
    if (key === 'acx') { out[key] = luminance(picked) > 0.58 ? '#101010' : '#ffffff'; continue }
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
