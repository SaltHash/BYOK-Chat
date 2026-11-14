import { DARK_THEMES, LIGHT_THEMES, themePatch, type ThemeMode, type DarkTheme, type LightTheme, THEMES } from './store'
import { modelsOf } from './models'

type ThemeState = { themeMode: ThemeMode; themeDark: DarkTheme; themeLight: LightTheme }

/** Next theme key in the active palette (shared by App shortcuts + Palette). */
export function nextThemeKey(s: ThemeState): keyof typeof THEMES {
  const keys = s.themeMode === 'light' ? [...LIGHT_THEMES, 'custom'] : [...DARK_THEMES, 'custom']
  const cur = s.themeMode === 'light' ? s.themeLight : s.themeDark
  return keys[(keys.indexOf(cur) + 1) % keys.length] as keyof typeof THEMES
}

/** Patch object that advances the theme (wraps themePatch). */
export function nextThemePatch(s: ThemeState) {
  return themePatch(s, nextThemeKey(s))
}

type ModelSel = { k: 'ep'; id: string; model: string }
type EpLike = { id: string; models?: string[]; model: string }

/** Ordered model list across endpoints (shared by App + Palette). */
export function allOrderedModels(eps: EpLike[]): ModelSel[] {
  return eps.flatMap((ep) => modelsOf(ep as Parameters<typeof modelsOf>[0]).map((model) => ({ k: 'ep' as const, id: ep.id, model })))
}

/** Step model selection by delta (+1 next, -1 prev), wrapping around.
 *
 * With no usable selection (nothing chosen yet, or the selected endpoint or
 * model was deleted) the step starts from the edge opposite the direction:
 * next lands on the first model, previous on the last. Treating -1 as the
 * index made "previous" land one short of the end. */
export function stepModelSelection(
  eps: EpLike[],
  sel: { id?: string; model?: string } | null | undefined,
  delta: 1 | -1,
): ModelSel | null {
  const list = allOrderedModels(eps)
  if (!list.length) return null
  const found = list.findIndex((m) => m.id === sel?.id && m.model === sel?.model)
  const from = found >= 0 ? found : delta > 0 ? -1 : 0
  return list[(from + delta + list.length) % list.length]
}

type PromptLike = { id: string }

/** Next prompt id, wrapping around (empty string clears when no prompts). */
export function stepPromptSelection(prompts: PromptLike[], currentId: string): string {
  if (!prompts.length) return ''
  const at = prompts.findIndex((p) => p.id === currentId)
  return prompts[(at + 1) % prompts.length].id
}
