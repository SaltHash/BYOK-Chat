import type { Ep, Pl, Prompt } from './store'
import type { ToolMode } from './toolApprovals'
import { modelNameOf, prettyModelId } from './models'

/* A profile is a named bundle of the settings that change how a model behaves:
 * which endpoint/model answers, how it samples, which prompt steers it, which
 * tools it may use and how freely those tools run. Theme, keys and layout are
 * deliberately excluded — a profile is a way of working, not a look.
 *
 * Profiles are pure data. Everything here is a function of its input so the
 * store actions and the settings editor share one definition of what a profile
 * captures, what it applies and when it counts as the active one.
 */
export type ProfileSelection = { k: 'ep' | 'pl'; id: string; model?: string } | null

export type ProfileParams = { def: boolean; temp: number; topp: number; max: number; maxToolRounds: number; highToolsUnlocked: boolean }

export type Profile = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  sel: ProfileSelection
  params: ProfileParams
  effort: Record<string, string>
  /** Prompt preset id (`''` means the general prompt). */
  pr: string
  /** Enabled tools at capture time, as explicit booleans. */
  tools: Record<string, boolean>
  toolMode: ToolMode
  toolApproval: Record<string, boolean>
}

export type ProfileState = {
  sel: ProfileSelection
  params: ProfileParams
  effort: Record<string, string>
  pr: string
  tools: Record<string, boolean>
  toolMode: ToolMode
  toolApproval: Record<string, boolean>
}

const MODES: ToolMode[] = ['full', 'standard', 'restricted', 'off']

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const bools = (v: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {}
  for (const [k, on] of Object.entries(obj(v))) if (on === true) out[k] = true
  return out
}
const strings = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, s] of Object.entries(obj(v))) if (typeof s === 'string' && s) out[k] = s
  return out
}
const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

export const DEFAULT_PROFILE_PARAMS: ProfileParams = { def: true, temp: 0.7, topp: 1, max: 4096, maxToolRounds: 8, highToolsUnlocked: false }

/** Read only explicit values, so a profile cannot inherit junk from a stored
 *  object or an imported file. */
export function normProfile(value: unknown, now = Date.now()): Profile | null {
  const v = obj(value)
  const rawSel = obj(v.sel)
  const sel: ProfileSelection = (rawSel.k === 'ep' || rawSel.k === 'pl') && typeof rawSel.id === 'string' && rawSel.id
    ? { k: rawSel.k, id: rawSel.id, ...(typeof rawSel.model === 'string' && rawSel.model ? { model: rawSel.model } : {}) }
    : null
  const params = obj(v.params)
  return {
    id: typeof v.id === 'string' && v.id ? v.id : '',
    name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 60) : 'Profile',
    createdAt: typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) ? v.createdAt : now,
    updatedAt: typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : now,
    sel,
    params: {
      def: params.def !== false,
      temp: num(params.temp, DEFAULT_PROFILE_PARAMS.temp, 0, 2),
      topp: num(params.topp, DEFAULT_PROFILE_PARAMS.topp, 0, 1),
      max: Math.round(num(params.max, DEFAULT_PROFILE_PARAMS.max, 1, 1_000_000)),
      maxToolRounds: Math.round(num(params.maxToolRounds, DEFAULT_PROFILE_PARAMS.maxToolRounds, 0, 200)),
      highToolsUnlocked: params.highToolsUnlocked === true,
    },
    effort: strings(v.effort),
    pr: typeof v.pr === 'string' ? v.pr : '',
    tools: bools(v.tools),
    toolMode: MODES.includes(v.toolMode as ToolMode) ? v.toolMode as ToolMode : 'standard',
    toolApproval: bools(v.toolApproval),
  }
}

export function normProfiles(value: unknown, now = Date.now()): Profile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Profile[] = []
  for (const raw of value) {
    const p = normProfile(raw, now)
    if (!p || !p.id || seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  return out.slice(0, 50)
}

/** What applying a profile writes back into the live settings. */
export function profilePatch(p: Profile): ProfileState {
  return {
    sel: p.sel ? { ...p.sel } : null,
    params: { ...p.params },
    effort: { ...p.effort },
    pr: p.pr,
    tools: { ...p.tools },
    toolMode: p.toolMode,
    toolApproval: { ...p.toolApproval },
  }
}

export function captureProfile(state: ProfileState, name: string, opts: { id: string; now?: number; createdAt?: number }): Profile {
  const now = opts.now ?? Date.now()
  const clean = normProfile({
    id: opts.id,
    name,
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
    ...state,
  }, now)
  // normProfile only returns null for structural input, which we always build.
  return clean ?? {
    id: opts.id, name: name.trim().slice(0, 60) || 'Profile', createdAt: now, updatedAt: now,
    ...profilePatch({ ...(state as unknown as Profile), id: opts.id, name, createdAt: now, updatedAt: now }),
  }
}

const sameSelection = (a: ProfileSelection, b: ProfileSelection) =>
  a?.k === b?.k && a?.id === b?.id && (a?.model ?? '') === (b?.model ?? '')

const sameMap = (a: Record<string, boolean>, b: Record<string, boolean>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if ((a[k] === true) !== (b[k] === true)) return false
  return true
}

/** True when the live settings are exactly what this profile would apply.
 *  Used to mark the active profile without storing a second source of truth:
 *  editing the model manually simply means no profile matches any more. */
export function profileMatches(state: ProfileState, p: Profile): boolean {
  return sameSelection(state.sel, p.sel)
    && state.params.def === p.params.def
    && state.params.temp === p.params.temp
    && state.params.topp === p.params.topp
    && state.params.max === p.params.max
    && state.params.maxToolRounds === p.params.maxToolRounds
    && state.params.highToolsUnlocked === p.params.highToolsUnlocked
    && state.pr === p.pr
    && sameMap(state.tools, p.tools)
    && state.toolMode === p.toolMode
    && sameMap(state.toolApproval, p.toolApproval)
    && Object.keys(state.effort).sort().join('|') === Object.keys(p.effort).sort().join('|')
    && Object.entries(p.effort).every(([k, v]) => state.effort[k] === v)
}

export type ProfileContext = { eps: Ep[]; pls: Pl[]; prompts: Prompt[] }

/** Human summary parts: which model answers, which prompt steers it, how
 *  freely tools run and how many are enabled. */
export function describeProfile(p: Profile, ctx: ProfileContext): { model: string; prompt: string; mode: string; tools: string } {
  let model = 'No model chosen'
  if (p.sel?.k === 'ep') {
    const ep = ctx.eps.find((e) => e.id === p.sel!.id)
    const id = p.sel.model || ep?.model || ''
    if (id) model = ep ? modelNameOf(ep, id) : prettyModelId(id)
    else if (ep) model = ep.name
    else model = 'Model not configured'
  } else if (p.sel?.k === 'pl') {
    const pl = ctx.pls.find((x) => x.id === p.sel!.id)
    model = pl ? `Playlist · ${pl.name}` : 'Playlist not found'
  }
  const prompt = ctx.prompts.find((x) => x.id === p.pr)?.name ?? 'General'
  const mode = { full: 'Full access', standard: 'Standard', restricted: 'Restricted', off: 'Tools off' }[p.toolMode]
  const n = Object.values(p.tools).filter(Boolean).length
  return { model, prompt, mode, tools: `${n} tool${n === 1 ? '' : 's'}` }
}

export function freshProfileName(profiles: Profile[], base = 'New profile'): string {
  if (!profiles.some((p) => p.name === base)) return base
  for (let i = 2; i < 100; i++) if (!profiles.some((p) => p.name === `${base} ${i}`)) return `${base} ${i}`
  return `${base} ${Date.now().toString(36)}`
}
