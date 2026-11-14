import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Moon, Sun } from 'lucide-react'
import {
  useSConfig, THEMES, DARK_THEMES, LIGHT_THEMES, THEME_COLOR_KEYS, THEME_COLOR_LABELS, THEME_COLORS,
  defaultCustomTheme, customThemeColors, normCustomTheme, splitHelperRef, modelNameOf,
} from '../store'
import { DENSITIES, DENSITY_IDS, SPACING_LIMITS, STYLE_PRESETS, STYLE_PRESET_IDS, hasSpacingOverrides, resolveSpacing } from '../style'
import { Btn, RangeSlider, Seg, Toggle, cx } from './ui'
import { Anchor, Panel, Section, SettingRow } from './settingsPrimitives'
import { ColorPicker } from './ColorPicker'

const FONT_OPTIONS: [string, string][] = [['system', 'System default'], ['Arial', 'Arial'], ['Verdana', 'Verdana'], ['Georgia', 'Georgia'], ['Trebuchet MS', 'Trebuchet MS'], ['Times New Roman', 'Times New Roman'], ['Inter', 'Inter'], ['Roboto', 'Roboto'], ['Open Sans', 'Open Sans'], ['Segoe UI', 'Segoe UI'], ['Helvetica Neue', 'Helvetica Neue']]
const MONO_OPTIONS: [string, string][] = [['system', 'System monospace'], ['Consolas', 'Consolas'], ['Menlo', 'Menlo'], ['Monaco', 'Monaco'], ['Courier New', 'Courier New'], ['Cascadia Code', 'Cascadia Code'], ['JetBrains Mono', 'JetBrains Mono'], ['Fira Code', 'Fira Code']]

/** Font picker with an inline, right-aligned trigger in settings rows. */
function FontPicker({ value, set, options }: { value: string; set: (v: string) => void; options: [string, string][] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const selected = options.find(([font]) => font === value)?.[1] ?? value
  const matches = options.filter(([font, label]) => `${font} ${label}`.toLowerCase().includes(query.trim().toLowerCase()))
  const choose = (font: string) => { set(font); setOpen(false); setQuery('') }
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return
      setOpen(false)
      setQuery('')
    }
    addEventListener('pointerdown', close)
    return () => removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div ref={root} className="relative w-56 max-w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-end gap-1.5 rounded-md px-1.5 py-1 text-sm text-mu transition-colors hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ac/40"
      >
        <span className="truncate">{selected}</span>
        <ChevronDown size={14} className={cx('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="menu-surface absolute right-0 z-30 mt-1 w-64 max-w-[min(16rem,80vw)] rounded-xl bg-surf p-1.5">
          <input
            autoFocus
            value={query}
            placeholder="Search fonts or type a name"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const q = query.trim()
                if (!q) return
                const exact = options.find(([font, label]) => font.toLowerCase() === q.toLowerCase() || label.toLowerCase() === q.toLowerCase())
                choose(exact?.[0] ?? q)
              }
              if (e.key === 'Escape') setOpen(false)
            }}
            className="mb-1 w-full rounded-lg bg-bg px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40"
          />
          <div role="listbox" className="dd-list max-h-52 overflow-y-auto overscroll-contain">
            {matches.map(([font, label]) => (
              <button key={font} type="button" role="option" aria-selected={font === value} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(font)} className={cx('block w-full rounded-lg px-2.5 py-2 text-left text-sm', font === value ? 'bg-hov text-tx' : 'text-mu hover:bg-hov hover:text-tx')}>{label}</button>
            ))}
            {!matches.length && query.trim() && <p className="px-2.5 py-2 text-xs text-mu">Press Enter to use “{query.trim()}”.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function SpacingSlider({ label, value, min, max, set }: { label: string; value: number; min: number; max: number; set: (n: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate">{label}</span>
        <span className="text-xs tabular-nums text-mu">{value}px</span>
      </div>
      <RangeSlider label={label} min={min} max={max} step={1} value={value} set={set} className="w-full" />
    </div>
  )
}

/** Appearance settings. Kept in its own module so the heavy settings editor
 *  stays out of the initial chunk. */
export function AppearanceSettings() {
  const s = useSConfig()
  const row = (anchor: string, label: string, control: ReactNode) => (
    <Anchor id={anchor}><SettingRow label={label}>{control}</SettingRow></Anchor>
  )
  const mode = s.themeMode === 'light' ? 'light' : 'dark'
  const custom = mode === 'light' ? s.customLightTheme : s.customDarkTheme
  const customColors = mode === 'light' ? s.customLightColors : s.customDarkColors
  const customActive = (mode === 'light' ? s.themeLight : s.themeDark) === 'custom'
  const pickerTheme = { accent: custom.accent, text: custom.text, background: custom.background }
  const advancedKeys = THEME_COLOR_KEYS.filter((key) => key !== 'ac' && key !== 'tx' && key !== 'bg')
  const roleFor = (key: typeof advancedKeys[number]): 'accent' | 'text' | 'background' | 'onAccent' =>
    key === 'acx' ? 'onAccent' : key === 'mu' ? 'text' : key === 'er' || key.startsWith('c') ? 'accent' : 'background'
  const setCustomTheme = (next: typeof custom) => {
    const norm = normCustomTheme(next, defaultCustomTheme(custom.base))
    s.patch(mode === 'light' ? { customLightTheme: norm, customLightColors: customThemeColors(norm) } : { customDarkTheme: norm, customDarkColors: customThemeColors(norm) })
  }
  const setOverride = (key: typeof advancedKeys[number], value: string | null) => {
    const overrides = { ...custom.overrides }
    if (value) overrides[key] = value
    else delete overrides[key]
    setCustomTheme({ ...custom, overrides })
  }
  const spacing = resolveSpacing(s.prefs.density, s.prefs.uiSpacing)
  const customSpacing = hasSpacingOverrides(s.prefs.uiSpacing)
  const setSpacing = (patch: Partial<NonNullable<typeof s.prefs.uiSpacing>>) =>
    s.patch({ prefs: { ...s.prefs, uiSpacing: { ...(s.prefs.uiSpacing ?? {}), ...patch } } })

  return (
    <Panel id="look">
      <Section>
        {row('appearance-mode', 'Theme', <Seg v={s.themeMode} set={(themeMode) => s.patch({ themeMode: themeMode as 'dark' | 'light' })} opts={[['dark', 'Dark', Moon], ['light', 'Light', Sun]]} />)}
        <Anchor id="theme-picker">
          <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-3 lg:grid-cols-5">
            {[...(mode === 'light' ? LIGHT_THEMES : DARK_THEMES), 'custom'].map((k) => {
              const name = THEMES[k as keyof typeof THEMES]
              const active = (mode === 'light' ? s.themeLight : s.themeDark) === k
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const before = mode === 'light' ? s.themeLight : s.themeDark
                    if (k === 'custom' && before !== 'custom') {
                      const source = THEME_COLORS[before]
                      const seed = mode === 'light' ? s.customLightTheme : s.customDarkTheme
                      const next = normCustomTheme({ ...seed, accent: source.ac, text: source.tx, background: source.bg, overrides: {} }, defaultCustomTheme(before as typeof seed.base))
                      s.patch(mode === 'light' ? { themeLight: 'custom' as const, customLightTheme: next, customLightColors: customThemeColors(next) } : { themeDark: 'custom' as const, customDarkTheme: next, customDarkColors: customThemeColors(next) })
                    } else {
                      s.patch(mode === 'light' ? { themeLight: k as typeof s.themeLight } : { themeDark: k as typeof s.themeDark })
                    }
                  }}
                  className={cx('space-y-2 rounded-lg border bg-surf p-2 text-left text-sm transition-colors', active ? 'border-ac ring-1 ring-ac' : 'border-bor hover:bg-hov')}
                >
                  <span className="flex h-14 overflow-hidden rounded-md">
                    <span className="w-1/4" style={{ background: k === 'custom' ? customColors.side : THEME_COLORS[k].side }} />
                    <span className="flex-1 p-2" style={{ background: k === 'custom' ? customColors.bg : THEME_COLORS[k].bg }}>
                      <span className="block h-2 w-2/3 rounded-sm" style={{ background: k === 'custom' ? customColors.ac : THEME_COLORS[k].ac }} />
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2 px-0.5">{name}</span>
                </button>
              )
            })}
          </div>
        </Anchor>
        {customActive && (
          <Anchor id="custom-colors">
            <div className="space-y-4 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {([['accent', 'Accent'], ['text', 'Text'], ['background', 'Background']] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <span className="block text-sm">{label}</span>
                    <ColorPicker
                      value={custom[key]}
                      onChange={(color) => setCustomTheme(key === 'accent' ? { ...custom, accent: color } : key === 'text' ? { ...custom, text: color } : { ...custom, background: color })}
                      label={`${label} color`}
                      role={key}
                      theme={pickerTheme}
                    />
                  </div>
                ))}
              </div>
              <SettingRow label={`Contrast · ${custom.contrast}%`}>
                <RangeSlider label="Custom theme contrast" min={0} max={100} step={1} value={custom.contrast} set={(v) => setCustomTheme({ ...custom, contrast: Math.round(v) })} className="w-52 max-w-full" />
              </SettingRow>
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span>Advanced colors</span>
                  <ChevronDown size={16} className="text-mu transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid gap-2 pb-4 sm:grid-cols-2 lg:grid-cols-3">
                  {advancedKeys.map((key) => {
                    const overridden = Object.prototype.hasOwnProperty.call(custom.overrides, key)
                    return (
                      <div key={key} className="space-y-1.5 rounded-lg bg-surf p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{THEME_COLOR_LABELS[key]}</span>
                          <button type="button" disabled={!overridden} onClick={() => setOverride(key, null)} className={cx('rounded px-1.5 py-0.5 text-[11px]', overridden ? 'bg-ac/15 text-ac hover:bg-ac/25' : 'text-mu/60')}>{overridden ? 'Reset' : 'Auto'}</button>
                        </div>
                        <ColorPicker value={customColors[key]} onChange={(color) => setOverride(key, color)} label={`${THEME_COLOR_LABELS[key]} color`} role={roleFor(key)} theme={pickerTheme} />
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-end pb-2">
                  <Btn v="ghost" className="px-2 py-1" disabled={!Object.keys(custom.overrides).length} onClick={() => setCustomTheme({ ...custom, overrides: {} })}>Reset advanced colors</Btn>
                </div>
              </details>
              <div className="flex justify-end">
                <Btn v="ghost" className="px-2 py-1" onClick={() => setCustomTheme(defaultCustomTheme(custom.base))}>Reset to defaults</Btn>
              </div>
            </div>
          </Anchor>
        )}
        {row('seasonal', 'Seasonal touches', <Toggle on={s.prefs.seasonal !== false} set={(seasonal) => s.patch({ prefs: { ...s.prefs, seasonal } })} label="Seasonal touches" />)}
        {row('completion-cues', 'Completion cues', <Toggle on={!!s.prefs.cues} set={(cues) => s.patch({ prefs: { ...s.prefs, cues } })} label="Completion cues" />)}
      </Section>

      <Section title="Style">
        <Anchor id="style-preset">
          <div className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-4">
            {STYLE_PRESET_IDS.map((id) => {
              const active = (s.prefs.stylePreset ?? 'modern') === id
              return (
                <button key={id} type="button" aria-pressed={active} onClick={() => s.patch({ prefs: { ...s.prefs, stylePreset: id } })} className={cx('space-y-2 rounded-lg border p-2 text-left text-sm transition-colors', active ? 'border-ac ring-1 ring-ac' : 'border-bor hover:bg-hov')}>
                  <span data-style={id} aria-hidden="true" className="flex h-14 items-center gap-1.5 rounded-md bg-bg p-2">
                    <i className="size-6 shrink-0 rounded-md bg-hov" />
                    <i className="h-6 flex-1 rounded-lg bg-surf shadow-md" />
                    <i className="h-6 w-3 shrink-0 rounded-2xl bg-ac/40" />
                  </span>
                  <span className="flex items-center justify-between gap-1 font-medium">{STYLE_PRESETS[id].label}{active && <span className="text-ac">✓</span>}</span>
                  <span className="block text-xs font-normal leading-4 text-mu">{STYLE_PRESETS[id].description}</span>
                </button>
              )
            })}
          </div>
        </Anchor>
        {row('density', 'Density', <Seg v={s.prefs.density ?? 'comfortable'} set={(density) => s.patch({ prefs: { ...s.prefs, density, uiSpacing: customSpacing ? s.prefs.uiSpacing : {} } })} opts={DENSITY_IDS.map((id) => [id, DENSITIES[id].label] as [typeof id, string])} />)}
        <Anchor id="density-advanced">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
              <span>Advanced spacing</span>
              <ChevronDown size={16} className="text-mu transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-5 pb-4 pt-1">
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div className="col-span-full text-xs font-medium text-mu">Top bar</div>
                <SpacingSlider label="Horizontal padding" value={spacing.headerPad} min={SPACING_LIMITS.headerPad.min} max={SPACING_LIMITS.headerPad.max} set={(headerPad) => setSpacing({ headerPad })} />
                <SpacingSlider label="Vertical padding" value={spacing.headerPadY} min={SPACING_LIMITS.headerPadY.min} max={SPACING_LIMITS.headerPadY.max} set={(headerPadY) => setSpacing({ headerPadY })} />
                <div className="col-span-full text-xs font-medium text-mu">Conversation</div>
                <SpacingSlider label="Container margins" value={spacing.chatPad} min={SPACING_LIMITS.chatPad.min} max={SPACING_LIMITS.chatPad.max} set={(chatPad) => setSpacing({ chatPad })} />
                <SpacingSlider label="Message spacing" value={spacing.messageGap} min={SPACING_LIMITS.messageGap.min} max={SPACING_LIMITS.messageGap.max} set={(messageGap) => setSpacing({ messageGap })} />
                <div className="col-span-full text-xs font-medium text-mu">Sidebar</div>
                <SpacingSlider label="Outer padding" value={spacing.sidePad} min={SPACING_LIMITS.sidePad.min} max={SPACING_LIMITS.sidePad.max} set={(sidePad) => setSpacing({ sidePad })} />
                <SpacingSlider label="Section gap" value={spacing.sideGap} min={SPACING_LIMITS.sideGap.min} max={SPACING_LIMITS.sideGap.max} set={(sideGap) => setSpacing({ sideGap })} />
                <SpacingSlider label="Item padding" value={spacing.sideItemPad} min={SPACING_LIMITS.sideItemPad.min} max={SPACING_LIMITS.sideItemPad.max} set={(sideItemPad) => setSpacing({ sideItemPad })} />
                <SpacingSlider label="Item spacing" value={spacing.sideItemGap} min={SPACING_LIMITS.sideItemGap.min} max={SPACING_LIMITS.sideItemGap.max} set={(sideItemGap) => setSpacing({ sideItemGap })} />
                <div className="col-span-full text-xs font-medium text-mu">Composer and panels</div>
                <SpacingSlider label="Composer padding" value={spacing.composerPad} min={SPACING_LIMITS.composerPad.min} max={SPACING_LIMITS.composerPad.max} set={(composerPad) => setSpacing({ composerPad })} />
                <SpacingSlider label="Side panel padding" value={spacing.panelPad} min={SPACING_LIMITS.panelPad.min} max={SPACING_LIMITS.panelPad.max} set={(panelPad) => setSpacing({ panelPad })} />
                <div className="col-span-full text-xs font-medium text-mu">Code blocks</div>
                <SpacingSlider label="Body padding X" value={spacing.codePadX} min={SPACING_LIMITS.codePadX.min} max={SPACING_LIMITS.codePadX.max} set={(codePadX) => setSpacing({ codePadX })} />
                <SpacingSlider label="Body padding Y" value={spacing.codePadY} min={SPACING_LIMITS.codePadY.min} max={SPACING_LIMITS.codePadY.max} set={(codePadY) => setSpacing({ codePadY })} />
                <SpacingSlider label="Header padding X" value={spacing.codeHeadPadX} min={SPACING_LIMITS.codeHeadPadX.min} max={SPACING_LIMITS.codeHeadPadX.max} set={(codeHeadPadX) => setSpacing({ codeHeadPadX })} />
                <SpacingSlider label="Header padding Y" value={spacing.codeHeadPadY} min={SPACING_LIMITS.codeHeadPadY.min} max={SPACING_LIMITS.codeHeadPadY.max} set={(codeHeadPadY) => setSpacing({ codeHeadPadY })} />
              </div>
              <div className="flex justify-end">
                <Btn v="ghost" className="px-2 py-1" disabled={!customSpacing} onClick={() => s.patch({ prefs: { ...s.prefs, uiSpacing: {} } })}>Reset spacing</Btn>
              </div>
            </div>
          </details>
        </Anchor>
      </Section>

      <Section title="Messages">
        {row('message-times', 'Message times', <Toggle on={!!s.prefs.showTimestamps} set={(showTimestamps) => s.patch({ prefs: { ...s.prefs, showTimestamps } })} label="Message times" />)}
        {row('message-actions', 'Always show message actions', <Toggle on={!!s.prefs.alwaysShowActions} set={(alwaysShowActions) => s.patch({ prefs: { ...s.prefs, alwaysShowActions } })} label="Always show message actions" />)}
        {row('user-markdown', 'Markdown in your messages', <Toggle on={s.prefs.userMarkdown !== false} set={(userMarkdown) => s.patch({ prefs: { ...s.prefs, userMarkdown } })} label="Markdown in your messages" />)}
        {row('revert-send', 'Revert send button', <Toggle on={s.prefs.revertSend === true} set={(revertSend) => s.patch({ prefs: { ...s.prefs, revertSend } })} label="Revert send button" />)}
        {row('reply-picker', 'Response picker', <Toggle on={s.prefs.showReplyPicker !== false} set={(showReplyPicker) => s.patch({ prefs: { ...s.prefs, showReplyPicker } })} label="Response picker" />)}
        {row('reply-copy', 'Copy button', <Toggle on={s.prefs.showCopyAction !== false} set={(showCopyAction) => s.patch({ prefs: { ...s.prefs, showCopyAction } })} label="Copy button" />)}
        {row('reply-pin', 'Pin button', <Toggle on={s.prefs.showPinAction === true} set={(showPinAction) => s.patch({ prefs: { ...s.prefs, showPinAction } })} label="Pin button" />)}
        {row('reply-bookmark', 'Bookmark button', <Toggle on={s.prefs.showBookmarkAction === true} set={(showBookmarkAction) => s.patch({ prefs: { ...s.prefs, showBookmarkAction } })} label="Bookmark button" />)}
        {row('reply-retry', 'Retry button', <Toggle on={s.prefs.showRetryAction !== false} set={(showRetryAction) => s.patch({ prefs: { ...s.prefs, showRetryAction } })} label="Retry button" />)}
        {row('reply-branch', 'New path button', <Toggle on={s.prefs.showBranchAction === true} set={(showBranchAction) => s.patch({ prefs: { ...s.prefs, showBranchAction } })} label="New path button" />)}
        {row('reply-delete', 'Delete button', <Toggle on={s.prefs.showDeleteAction !== false} set={(showDeleteAction) => s.patch({ prefs: { ...s.prefs, showDeleteAction } })} label="Delete button" />)}
      </Section>

      <Section title="Model picker">
        {row('model-picker-labels', 'Primary label', <Seg v={s.prefs.modelPrimary ?? 'name'} set={(modelPrimary) => {
          const secondary = s.prefs.modelSecondary ?? 'none'
          s.patch({ prefs: { ...s.prefs, modelPrimary, modelSecondary: secondary === modelPrimary ? (modelPrimary === 'name' ? 'id' : 'name') : secondary } })
        }} opts={[["name", "Model name"], ["id", "Model ID"]]} />)}
        {row('model-picker-labels-secondary', 'Secondary label', <Seg v={s.prefs.modelSecondary ?? 'none'} set={(modelSecondary) => s.patch({ prefs: { ...s.prefs, modelSecondary } })} opts={(s.prefs.modelPrimary ?? 'name') === 'name' ? [["provider", "Provider"], ["id", "Model ID"], ["none", "None"]] : [["provider", "Provider"], ["name", "Model name"], ["none", "None"]]} />)}
        {row('model-picker-height', `Menu height · ${s.prefs.modelPickerHeight}px`, <RangeSlider label="Model picker height" min={320} max={720} step={20} value={s.prefs.modelPickerHeight ?? 480} set={(modelPickerHeight) => s.patch({ prefs: { ...s.prefs, modelPickerHeight } })} className="w-52 max-w-full" />)}
        {row('model-favorites', 'Show Favorites section', <Toggle on={s.prefs.favoritesSection !== false} set={(favoritesSection) => s.patch({ prefs: { ...s.prefs, favoritesSection } })} label="Show Favorites section" />)}
        <Anchor id="model-favorites-provider">
          <SettingRow label="Hide favorites from provider lists"><Toggle on={s.prefs.hideFavoritesInProviders !== false} set={(hideFavoritesInProviders) => s.patch({ prefs: { ...s.prefs, hideFavoritesInProviders } })} label="Hide favorites from provider lists" /></SettingRow>
        </Anchor>
        <SettingRow label="Show provider beside favorite names"><Toggle on={s.prefs.hideFavoriteProvider !== true} set={(show) => s.patch({ prefs: { ...s.prefs, hideFavoriteProvider: !show } })} label="Show provider beside favorite names" /></SettingRow>
        {(s.favs?.length ?? 0) > 0 && (
          <div className="space-y-2 py-3">
            {(s.favs ?? []).map((ref) => {
              const [id, model] = splitHelperRef(ref)
              const e = s.eps.find((x) => x.id === id)
              return (
                <div key={ref} className="flex items-center gap-2 rounded-lg bg-surf px-2.5 py-2 text-sm">
                  <span className="text-ac">★</span>
                  <span className="min-w-0 flex-1 truncate">{e ? `${e.name} · ${modelNameOf(e, model)}` : 'Removed endpoint'}</span>
                  <button type="button" onClick={() => s.patch({ favs: (s.favs ?? []).filter((x) => x !== ref) })} title="Remove from favorites" aria-label="Remove from favorites" className="grid size-6 shrink-0 place-items-center rounded-md text-mu hover:bg-hov hover:text-tx">×</button>
                </div>
              )
            })}
            <button type="button" onClick={() => s.patch({ favs: [] })} className="text-xs text-mu hover:text-er">Clear all favorites</button>
          </div>
        )}
      </Section>

      <Section title="Layout">
        {row('palette-height', `Command palette height · ${s.prefs.paletteMax}px`, <RangeSlider label="Command palette maximum height" min={200} max={720} step={20} value={s.prefs.paletteMax} set={(paletteMax) => s.patch({ prefs: { ...s.prefs, paletteMax } })} className="w-52 max-w-full" />)}
        {row('chat-width', 'Message width', <Seg v={s.prefs.chatWidth} set={(chatWidth) => s.patch({ prefs: { ...s.prefs, chatWidth } })} opts={[["narrow", "Narrow"], ["standard", "Standard"], ["wide", "Wide"]]} />)}
        {row('glass-composer', 'Glass composer', <Toggle on={s.prefs.glassComposer !== false} set={(glassComposer) => s.patch({ prefs: { ...s.prefs, glassComposer } })} label="Glass composer" />)}
        {s.prefs.glassComposer !== false && <>
          {row('glass-blur', `Composer blur · ${s.prefs.glassBlur ?? 14}px`, <RangeSlider label="Glass composer blur" min={0} max={40} step={1} value={s.prefs.glassBlur ?? 14} set={(v) => s.patch({ prefs: { ...s.prefs, glassBlur: Math.round(v) } })} className="w-52 max-w-full" />)}
          {row('glass-opacity', `Composer opacity · ${s.prefs.glassOpacity ?? 80}%`, <RangeSlider label="Glass composer opacity" min={20} max={100} step={5} value={s.prefs.glassOpacity ?? 80} set={(v) => s.patch({ prefs: { ...s.prefs, glassOpacity: Math.round(v) } })} className="w-52 max-w-full" />)}
        </>}
        {row('reduce-transparency', 'Reduce transparency', <Toggle on={s.prefs.reduceTransparency === true} set={(reduceTransparency) => s.patch({ prefs: { ...s.prefs, reduceTransparency } })} label="Reduce transparency" />)}
        {row('high-contrast', 'High contrast', <Toggle on={s.prefs.highContrast === true} set={(highContrast) => s.patch({ prefs: { ...s.prefs, highContrast } })} label="High contrast" />)}
        {row('settings-size', `Settings window width · ${s.prefs.settingsWidth ?? 1024}px`, <RangeSlider label="Settings window width" min={720} max={1440} step={40} value={s.prefs.settingsWidth ?? 1024} set={(settingsWidth) => s.patch({ prefs: { ...s.prefs, settingsWidth } })} className="w-52 max-w-full" />)}
        {row('settings-height', `Settings window height · ${s.prefs.settingsHeight ?? 780}px`, <RangeSlider label="Settings window height" min={520} max={1000} step={20} value={s.prefs.settingsHeight ?? 780} set={(settingsHeight) => s.patch({ prefs: { ...s.prefs, settingsHeight } })} className="w-52 max-w-full" />)}
        {row('overlay', `Overlay blur · ${s.prefs.modalBlur}px`, <RangeSlider label="Modal background blur" min={0} max={24} step={1} value={s.prefs.modalBlur} set={(modalBlur) => s.patch({ prefs: { ...s.prefs, modalBlur } })} className="w-52 max-w-full" />)}
        {row('settings-opacity', `Overlay dimming · ${s.prefs.settingsOpacity}%`, <RangeSlider label="Settings background opacity" min={0} max={100} step={5} value={s.prefs.settingsOpacity} set={(settingsOpacity) => s.patch({ prefs: { ...s.prefs, settingsOpacity } })} className="w-52 max-w-full" />)}
      </Section>

      <Section title="Typography">
        {row('fonts', 'Body font', <FontPicker value={s.prefs.fontBody} set={(fontBody) => s.patch({ prefs: { ...s.prefs, fontBody } })} options={FONT_OPTIONS} />)}
        {row('fonts-heading', 'Heading font', <FontPicker value={s.prefs.fontHeader} set={(fontHeader) => s.patch({ prefs: { ...s.prefs, fontHeader } })} options={FONT_OPTIONS} />)}
        {row('fonts-mono', 'Monospace font', <FontPicker value={s.prefs.fontMono} set={(fontMono) => s.patch({ prefs: { ...s.prefs, fontMono } })} options={MONO_OPTIONS} />)}
        {row('text-size', `Text size · ${s.prefs.textScale ?? 100}%`, <RangeSlider label="Text size" min={85} max={135} step={5} value={s.prefs.textScale ?? 100} set={(textScale) => s.patch({ prefs: { ...s.prefs, textScale } })} className="w-52 max-w-full" />)}
        {row('code-wrap', 'Wrap long code lines', <Toggle on={!!s.prefs.codeWrap} set={(codeWrap) => s.patch({ prefs: { ...s.prefs, codeWrap } })} label="Wrap long code lines" />)}
        {row('code-line-numbers', 'Code line numbers', <Toggle on={s.prefs.codeLines === true} set={(codeLines) => s.patch({ prefs: { ...s.prefs, codeLines } })} label="Code line numbers" />)}
        {row('code-max-height', `Code block height · ${s.prefs.codeMaxHeight ? `${s.prefs.codeMaxHeight}px` : 'No cap'}`, <RangeSlider label="Code block maximum height" min={0} max={1200} step={40} value={s.prefs.codeMaxHeight ?? 0} set={(codeMaxHeight) => s.patch({ prefs: { ...s.prefs, codeMaxHeight } })} className="w-52 max-w-full" />)}
      </Section>
    </Panel>
  )
}
