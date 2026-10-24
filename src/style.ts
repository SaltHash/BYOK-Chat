/* Visual style system: the "feel" presets and the spacing scale.
 *
 * Two independent axes, both applied to the document root:
 *  - `data-style` picks a radius/shadow scale (Modern, Sharp, Bubbly, Floating).
 *    The values themselves live in index.css so the preset is applied before
 *    React mounts and there is exactly one source for the look.
 *  - density + optional per-area overrides resolve to pixel spacing values,
 *    which this module owns so the math can be tested on its own.
 *
 * The app-wide layout does not change: only corner radii, elevation and the
 * spacing variables the shell reads. The spacing tokens cover every structural
 * surface — the top bar, the conversation, the sidebar, the composer, the
 * workspace and widget panels, and code blocks with their headers.
 */

export type StylePreset = 'modern' | 'sharp' | 'bubbly' | 'floating'
export type Density = 'compact' | 'comfortable' | 'spacious'

/** Optional pixel overrides for the spacing areas a user can tune. */
export type SpacingOverrides = {
  headerPad?: number
  headerPadY?: number
  chatPad?: number
  messageGap?: number
  sidePad?: number
  sideGap?: number
  sideItemPad?: number
  sideItemGap?: number
  composerPad?: number
  panelPad?: number
  codePadX?: number
  codePadY?: number
  codeHeadPadX?: number
  codeHeadPadY?: number
}

export type Spacing = {
  headerPad: number
  headerPadY: number
  chatPad: number
  chatPadY: number
  messageGap: number
  sidePad: number
  sideGap: number
  sideItemPad: number
  sideItemGap: number
  composerPad: number
  panelPad: number
  codePadX: number
  codePadY: number
  codeHeadPadX: number
  codeHeadPadY: number
}

export const STYLE_PRESET_IDS: StylePreset[] = ['modern', 'sharp', 'bubbly', 'floating']

export const STYLE_PRESETS: Record<StylePreset, { label: string; description: string }> = {
  modern: { label: 'Modern', description: 'Medium corners and quiet elevation. The default.' },
  sharp: { label: 'Sharp', description: 'Square corners, hairline edges, flat surfaces.' },
  bubbly: { label: 'Bubbly', description: 'Very generous rounding and soft, friendly shadows.' },
  floating: { label: 'Floating', description: 'Panels detach from the edges and float on deep, diffuse shadows.' },
}

export const DENSITY_IDS: Density[] = ['compact', 'comfortable', 'spacious']

/** Base spacing per density, in CSS pixels.
 *
 * `comfortable` reproduces the original layout: 12px header padding, a 16px
 * conversation gutter, 24px of vertical padding, 32px between messages, a
 * 12px sidebar/composer/panel gutter, the original sidebar item paddings
 * (8px inside rows, no gap between rows), and the original code-block paddings
 * (16/12 body, 16/8 header). The top bar gets no vertical padding until a
 * density asks for it (spacious), so the default header height is unchanged. */
export const DENSITIES: Record<Density, { label: string; description: string; spacing: Spacing }> = {
  compact: {
    label: 'Compact',
    description: 'Tighter gutters and message gaps; more on screen at once.',
    spacing: { headerPad: 8, headerPadY: 4, chatPad: 12, chatPadY: 12, messageGap: 18, sidePad: 8, sideGap: 8, sideItemPad: 6, sideItemGap: 0, composerPad: 8, panelPad: 8, codePadX: 12, codePadY: 8, codeHeadPadX: 12, codeHeadPadY: 5 },
  },
  comfortable: {
    label: 'Comfortable',
    description: 'The default spacing.',
    spacing: { headerPad: 12, headerPadY: 0, chatPad: 16, chatPadY: 24, messageGap: 32, sidePad: 12, sideGap: 12, sideItemPad: 8, sideItemGap: 0, composerPad: 12, panelPad: 12, codePadX: 16, codePadY: 12, codeHeadPadX: 16, codeHeadPadY: 8 },
  },
  spacious: {
    label: 'Spacious',
    description: 'Roomy gutters, more air between messages, and a taller top bar.',
    spacing: { headerPad: 20, headerPadY: 12, chatPad: 28, chatPadY: 32, messageGap: 44, sidePad: 18, sideGap: 16, sideItemPad: 12, sideItemGap: 6, composerPad: 16, panelPad: 18, codePadX: 20, codePadY: 16, codeHeadPadX: 20, codeHeadPadY: 11 },
  },
}

/** Ranges the sliders (and imported configs) may use. */
export const SPACING_LIMITS = {
  headerPad: { min: 0, max: 40 },
  headerPadY: { min: 0, max: 24 },
  chatPad: { min: 0, max: 64 },
  messageGap: { min: 0, max: 96 },
  sidePad: { min: 0, max: 40 },
  sideGap: { min: 0, max: 40 },
  sideItemPad: { min: 0, max: 24 },
  sideItemGap: { min: 0, max: 16 },
  composerPad: { min: 0, max: 40 },
  panelPad: { min: 0, max: 40 },
  codePadX: { min: 0, max: 40 },
  codePadY: { min: 0, max: 40 },
  codeHeadPadX: { min: 0, max: 40 },
  codeHeadPadY: { min: 0, max: 24 },
} as const

const clampNum = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

export const normStylePreset = (v: unknown): StylePreset =>
  typeof v === 'string' && (STYLE_PRESET_IDS as string[]).includes(v) ? v as StylePreset : 'modern'

export const normDensity = (v: unknown): Density =>
  typeof v === 'string' && (DENSITY_IDS as string[]).includes(v) ? v as Density : 'comfortable'

/** Keep only known, finite overrides inside their slider ranges. */
export function normSpacing(v: unknown): SpacingOverrides {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out: SpacingOverrides = {}
  for (const key of Object.keys(SPACING_LIMITS) as (keyof SpacingOverrides)[]) {
    const n = asNumber(src[key])
    if (n == null) continue
    const { min, max } = SPACING_LIMITS[key]
    out[key] = Math.round(clampNum(n, min, max))
  }
  return out
}

/** Whether the user has overridden anything (drives the "custom" hint). */
export const hasSpacingOverrides = (v: SpacingOverrides | undefined): boolean =>
  !!v && Object.values(v).some((n) => typeof n === 'number')

/** Resolve density + overrides into the pixels the shell consumes.
 *
 * The conversation's vertical gutter follows the horizontal one so a custom
 * margin keeps the density's own proportion instead of stretching into a
 * letterbox. The other areas are independent. */
export function resolveSpacing(density: unknown, overrides?: SpacingOverrides): Spacing {
  const base = DENSITIES[normDensity(density)].spacing
  const o = normSpacing(overrides)
  const pick = (k: keyof Spacing): number => {
    const v = (o as Record<keyof Spacing, number | undefined>)[k]
    return v != null ? v : base[k]
  }
  const chatPad = pick('chatPad')
  const ratio = base.chatPad > 0 ? base.chatPadY / base.chatPad : 1
  return {
    headerPad: pick('headerPad'),
    headerPadY: pick('headerPadY'),
    chatPad,
    chatPadY: Math.round(chatPad * ratio),
    messageGap: pick('messageGap'),
    sidePad: pick('sidePad'),
    sideGap: pick('sideGap'),
    sideItemPad: pick('sideItemPad'),
    sideItemGap: pick('sideItemGap'),
    composerPad: pick('composerPad'),
    panelPad: pick('panelPad'),
    codePadX: pick('codePadX'),
    codePadY: pick('codePadY'),
    codeHeadPadX: pick('codeHeadPadX'),
    codeHeadPadY: pick('codeHeadPadY'),
  }
}

/** CSS custom properties for the spacing tokens, ready for the root element. */
export function spacingVars(density: unknown, overrides?: SpacingOverrides): Record<string, string> {
  const s = resolveSpacing(density, overrides)
  return {
    '--ui-header-pad': `${s.headerPad}px`,
    '--ui-header-pad-y': `${s.headerPadY}px`,
    '--ui-chat-pad-x': `${s.chatPad}px`,
    '--ui-chat-pad-y': `${s.chatPadY}px`,
    '--ui-msg-gap': `${s.messageGap}px`,
    '--ui-side-pad': `${s.sidePad}px`,
    '--ui-side-gap': `${s.sideGap}px`,
    '--ui-side-item-py': `${s.sideItemPad}px`,
    '--ui-side-item-gap': `${s.sideItemGap}px`,
    '--ui-composer-pad': `${s.composerPad}px`,
    '--ui-panel-pad': `${s.panelPad}px`,
    '--ui-code-pad-x': `${s.codePadX}px`,
    '--ui-code-pad-y': `${s.codePadY}px`,
    '--ui-code-head-pad-x': `${s.codeHeadPadX}px`,
    '--ui-code-head-pad-y': `${s.codeHeadPadY}px`,
  }
}
