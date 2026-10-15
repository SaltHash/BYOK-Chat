import { useEffect } from 'react'
import { canUseDOM } from './hooks'

export const GOOGLE_FONTS_HOST = 'fonts.googleapis.com'

/* Allow-listed font names: letters, digits, spaces and common separators.
 * Rejects CSS injection (`;{}url()@import`) and over-long input. */
export function sanitizeFontName(name: string): string | null {
  const clean = name.replace(/["'\\<>;:{}/()@]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!clean || clean.length < 1) return null
  if (!/^[A-Za-z0-9 \-+_.,&]+$/.test(clean)) return null
  return clean
}

function fontFamily(name: string | undefined, fallback: string): string {
  if (!name || name === 'system') return fallback
  const clean = sanitizeFontName(name)
  if (!clean) return fallback
  const loaded = Array.from(document.fonts ?? []).some((face) => face.family.replace(/["']/g, '') === clean)
  if (!loaded) {
    const href = `https://${GOOGLE_FONTS_HOST}/css2?family=${encodeURIComponent(clean).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`
    let url: URL | null = null
    try { url = new URL(href) } catch { url = null }
    if (url && url.host === GOOGLE_FONTS_HOST) {
      const exists = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some((link) => link.href === href)
      if (!exists) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.dataset.googleFont = clean
        document.head.append(link)
      }
    }
  }
  return `"${clean}", ${fallback}`
}

/** Applies body / heading / mono font CSS vars (single source for App). */
export function useFontCss(fontBody: string | undefined, fontHeader: string | undefined, fontMono: string | undefined) {
  useEffect(() => {
    if (!canUseDOM()) return
    document.documentElement.style.setProperty('--font-body', fontFamily(fontBody, 'ui-sans-serif, system-ui, sans-serif'))
    document.documentElement.style.setProperty('--font-heading', fontFamily(fontHeader, 'ui-sans-serif, system-ui, sans-serif'))
    document.documentElement.style.setProperty('--font-mono-custom', fontFamily(fontMono, 'ui-monospace, monospace'))
  }, [fontBody, fontHeader, fontMono])
}
