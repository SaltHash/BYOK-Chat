/* The wallpaper is its own theme.
 *
 * Bundled photos carry a hand-picked accent. An uploaded photo is sampled on
 * a tiny canvas and the result is pulled toward the middle of the brightness
 * and saturation ranges: enough colour to identify the theme, never a neon
 * button or a grey slab. The accent then feeds the same palette builder used
 * by custom themes, so every surface and the text on buttons move together.
 */

import { DEFAULT_BG_ACCENT } from './background'
import { accentOnlyColors, hexToHsl, hslToHex } from './theme'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const HEX = /^#[0-9a-f]{6}$/i

/** Keep a sampled colour recognisable but UI-safe. */
export function tuneAccent(value: unknown, fallback = DEFAULT_BG_ACCENT): string {
  if (typeof value !== 'string' || !HEX.test(value.trim())) return fallback
  const hsl = hexToHsl(value.trim())
  if (hsl.s < 0.04) return fallback
  return hslToHex({
    h: hsl.h,
    s: clamp(hsl.s, 0.28, 0.58),
    l: clamp(hsl.l, 0.58, 0.68),
  })
}

/** A wallpaper accent applied to the active theme's base palette. */
export function wallpaperPalette(base: Record<string, string>, accent: string): Record<string, string> {
  return accentOnlyColors(base, tuneAccent(accent))
}

/** Sample a photo's saturation-weighted mean, then tune it for the UI. */
export async function accentFromImage(src: string): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || !src) return DEFAULT_BG_ACCENT
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 48
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return DEFAULT_BG_ACCENT
    ctx.drawImage(image, 0, 0, 48, 48)
    const pixels = ctx.getImageData(0, 0, 48, 48).data
    let r = 0, g = 0, b = 0, weight = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3] / 255
      if (alpha < 0.5) continue
      const pr = pixels[i] / 255, pg = pixels[i + 1] / 255, pb = pixels[i + 2] / 255
      const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb)
      const light = (max + min) / 2
      const delta = max - min
      if (light < 0.08 || light > 0.92 || delta < 0.035) continue
      const sat = delta / (1 - Math.abs(2 * light - 1))
      // Colourful, mid-tone pixels say more about the photo's identity than
      // blown highlights or a large black foreground.
      const w = alpha * sat * sat * (1 - Math.abs(light - 0.55) * 1.3)
      r += pr * w
      g += pg * w
      b += pb * w
      weight += w
    }
    if (weight < 0.05) return DEFAULT_BG_ACCENT
    const hex = `#${[r, g, b].map((channel) => Math.round(channel / weight * 255).toString(16).padStart(2, '0')).join('')}`
    return tuneAccent(hex)
  } catch {
    return DEFAULT_BG_ACCENT
  }
}
