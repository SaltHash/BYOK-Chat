/* Single source of truth for resizable panel clamps.
 * All pixel / fraction clamps go through here so App, Chat, Sidebar and
 * Workspace panels stay consistent. */

export const SIDEBAR_WIDTH = { min: 220, max: 520, fallback: 288 } as const
export const WIDGET_WIDTH = { min: 220, max: 520, fallback: 320 } as const
export const WORKSPACE_FRAC = { min: 0.15, max: 0.7, fallback: 0.4 } as const
export const WORKSPACE_SPLIT = { min: 0.1, max: 0.9, fallback: 0.2 } as const

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export const clampSidebarWidth = (v: unknown): number =>
  Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, num(v, SIDEBAR_WIDTH.fallback)))

export const clampWidgetWidth = (v: unknown): number =>
  Math.max(WIDGET_WIDTH.min, Math.min(WIDGET_WIDTH.max, num(v, WIDGET_WIDTH.fallback)))

export const clampWorkspaceFrac = (v: unknown): number => {
  const n = num(v, WORKSPACE_FRAC.fallback)
  return n > 0 && n <= 1
    ? Math.max(WORKSPACE_FRAC.min, Math.min(WORKSPACE_FRAC.max, n))
    : WORKSPACE_FRAC.fallback
}

export const clampWorkspaceSplit = (v: unknown): number => {
  const n = num(v, WORKSPACE_SPLIT.fallback)
  return Math.max(WORKSPACE_SPLIT.min, Math.min(WORKSPACE_SPLIT.max, n))
}

export const roundFrac = (v: number): number => Math.round(v * 1000) / 1000

/* Chat column widths (message list) and the composer, which is slightly wider. */
export const CHAT_WIDTH = { narrow: 640, standard: 768, wide: 1024 } as const
export const COMPOSER_EXTRA = 64
export const composerWidth = (w: keyof typeof CHAT_WIDTH): number => CHAT_WIDTH[w] + COMPOSER_EXTRA
