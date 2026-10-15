import { useEffect } from 'react'
import { THEME_COLOR_KEYS, themeKeyOf, themeCustomOf } from './store'
import { clampSidebarWidth, clampWidgetWidth, roundFrac } from './layout'
import { useS } from './store'

export const canUseDOM = () => typeof window !== 'undefined' && typeof document !== 'undefined'

/** Applies `data-t`, custom colors, luminance color-scheme and modal blur. */
export function useThemeCss(opts: {
  themeMode: Parameters<typeof themeKeyOf>[0]['themeMode']
  themeDark: Parameters<typeof themeKeyOf>[0]['themeDark']
  themeLight: Parameters<typeof themeKeyOf>[0]['themeLight']
  customDarkColors: Parameters<typeof themeCustomOf>[0]['customDarkColors']
  customLightColors: Parameters<typeof themeCustomOf>[0]['customLightColors']
  modalBlur: number
}) {
  const theme = themeKeyOf(opts)
  const customColors = themeCustomOf(opts)
  useEffect(() => {
    if (!canUseDOM()) return
    const root = document.documentElement
    root.dataset.t = theme
    root.style.setProperty('--modal-blur', `${opts.modalBlur ?? 12}px`)
    for (const key of THEME_COLOR_KEYS) {
      if (theme === 'custom' && customColors) root.style.setProperty(`--${key}`, customColors[key])
      else root.style.removeProperty(`--${key}`)
    }
    if (theme === 'custom' && customColors) {
      const hex = customColors.bg.slice(1)
      const luminance = hex.length === 6 ? (parseInt(hex.slice(0, 2), 16) * 0.299 + parseInt(hex.slice(2, 4), 16) * 0.587 + parseInt(hex.slice(4, 6), 16) * 0.114) : 40
      root.style.colorScheme = luminance > 145 ? 'light' : 'dark'
    } else root.style.removeProperty('color-scheme')
  }, [theme, customColors, opts.modalBlur])
}

/** Pointer-drag resizer for sidebar / widget panels (single clamp source). */
export function usePanelResize() {
  return (key: 'sidebarWidth' | 'widgetWidth', invert = false) => (e: { preventDefault: () => void; clientX: number }) => {
    e.preventDefault()
    const clamp = key === 'sidebarWidth' ? clampSidebarWidth : clampWidgetWidth
    const x = e.clientX, start = clamp(useS.getState().prefs[key])
    const move = (ev: globalThis.PointerEvent) => {
      const value = clamp(start + (ev.clientX - x) * (invert ? -1 : 1))
      const s = useS.getState()
      s.patch({ prefs: { ...s.prefs, [key]: roundFrac(value) } })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }
}
