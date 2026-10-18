import { useEffect } from 'react'
import { THEME_COLOR_KEYS, themeKeyOf, themeCustomOf } from './store'
import { clampSidebarWidth, clampWidgetWidth, roundFrac } from './layout'
import { createFrameThrottle } from './throttle'
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

/** Run a horizontal pointer drag. `onMove(clientX)` fires at most once per
 *  frame plus once more on release, and text selection is locked for the
 *  duration. Returns a function that ends the drag. */
export function startPointerDrag(e: { preventDefault: () => void; clientX: number; pointerId?: number; currentTarget?: EventTarget | null }, onMove: (clientX: number) => void): () => void {
  e.preventDefault()
  const frames = createFrameThrottle(onMove)
  const target = e.currentTarget as (Element & { releasePointerCapture?: (id: number) => void }) | null | undefined
  const release = () => {
    if (target && typeof e.pointerId === 'number') { try { target.releasePointerCapture?.(e.pointerId) } catch { /* already released */ } }
  }
  const move = (ev: PointerEvent) => {
    // A pointerup that happened outside the window (or on another element)
    // leaves `buttons` at 0: stop the drag instead of tracking the cursor.
    if (ev.buttons === 0) { stop(ev); return }
    frames.call(ev.clientX)
  }
  const stop = (ev?: PointerEvent) => {
    if (ev) frames.call(ev.clientX)
    frames.flush()
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop as EventListener)
    window.removeEventListener('pointercancel', stop as EventListener)
    release()
    if (canUseDOM() && document.body) document.body.style.userSelect = ''
  }
  if (canUseDOM() && document.body) document.body.style.userSelect = 'none'
  // Capture keeps the drag alive when the pointer leaves the handle.
  if (target && typeof e.pointerId === 'number') { try { target.setPointerCapture?.(e.pointerId) } catch { /* unsupported */ } }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop as EventListener)
  window.addEventListener('pointercancel', stop as EventListener)
  return stop
}

/** Pointer-drag resizer for sidebar / widget panels (single clamp source).
 *  Live updates are frame-throttled and the final position is committed on
 *  pointerup/pointercancel, so a drag costs at most one store write per frame
 *  instead of one per pointer event. */
export function usePanelResize() {
  return (key: 'sidebarWidth' | 'widgetWidth', invert = false) => (e: { preventDefault: () => void; clientX: number }) => {
    const clamp = key === 'sidebarWidth' ? clampSidebarWidth : clampWidgetWidth
    const startX = e.clientX
    const startWidth = clamp(useS.getState().prefs[key])
    startPointerDrag(e, (clientX) => {
      const next = roundFrac(clamp(startWidth + (clientX - startX) * (invert ? -1 : 1)))
      const s = useS.getState()
      if (s.prefs[key] === next) return
      s.patch({ prefs: { ...s.prefs, [key]: next } })
    })
  }
}
