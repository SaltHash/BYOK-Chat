import { TOOLS } from './meta'
import { can } from './engine'
import { enabledSkills, normSkills, composeSystemPrompt } from './skills'
import { modelsOf, usable } from './models'
import type { Ep, Pl, Cmd, Msg, Notice, FeatureId } from './store'

export const splitEntry = (ref: string) => {
  const i = ref.indexOf('::')
  return i < 0 ? [ref, ''] : [ref.slice(0, i), ref.slice(i + 2)]
}

type PlanState = {
  eps: Ep[]; pls: Pl[]; cmds: Cmd[]
  prompts: { id: string; text: string }[]
  pr: string; sel: { k: 'ep' | 'pl'; id: string; model?: string } | null
  globalPrompt: { on: boolean; text: string }
  features?: Record<FeatureId, boolean>
  tools: Record<string, boolean>
  skills: unknown
}

export const playlistEntries = (s: Pick<PlanState, 'eps'>, p: Pl) =>
  p.e.flatMap((ref) => {
    const [id, model] = splitEntry(ref)
    const e = s.eps.find((x) => x.id === id)
    if (!e) return []
    return (model ? [model] : modelsOf(e)).map((m) => ({ ...e, model: m }))
  })

export const applyCommandTemplate = (c: Cmd | undefined, t: string) =>
  (!c?.tpl ? t : c.tpl.includes('{{input}}') ? c.tpl.split('{{input}}').join(t) : c.tpl + (t ? '\n\n' + t : ''))

export const composeFullInput = (b: string, ctx: string[] = [], fx = '') =>
  b + (ctx.length ? '\n\n[tool results]\n' + ctx.join('\n') : '') + fx

/** Pure request planner: picks pool/candidates/system prompt/validation error. */
export function planRequest(s: PlanState, um: Msg, defaultFeatures: Record<FeatureId, boolean>) {
  const F = s.features ?? defaultFeatures
  const cmd = F.commands && um.cmd ? s.cmds.find((c) => c.id === um.cmd) : undefined
  const rawSel = s.sel ? (s.sel.k === 'pl' && !F.playlists ? undefined : (s.sel.k === 'pl' ? s.pls : s.eps).find((x) => x.id === s.sel!.id)) : undefined
  const sel = rawSel
  let pool: Ep[]
  let pl: Pl | null = null
  let ex = false
  let tgt: string
  if (cmd) { pl = F.playlists ? s.pls.find((p) => p.id === cmd.pl) ?? null : null; pool = pl ? playlistEntries(s, pl) : s.eps; tgt = '/' + cmd.name }
  else if (sel && s.sel!.k === 'ep') { pool = [sel as Ep]; ex = true; tgt = (sel as Ep).name }
  else if (sel) { pl = sel as Pl; pool = playlistEntries(s, pl); tgt = 'playlist ' + pl.name }
  else { pool = s.eps; tgt = 'your endpoints' }
  const need = [...new Set((um.att ?? []).filter((a) => a.kind !== 'txt').map((a) => a.kind as 'img' | 'pdf'))]
  const ready = pool.filter(usable)
  const cand = ready.filter((e) => need.every((n) => can(e, n))).flatMap((e) => modelsOf(e)
    .filter((model) => !(s.sel?.k === 'ep' && s.sel.id === e.id && s.sel.model) || s.sel?.model === model)
    .map((model) => ({ ...e, model })))
  const scoped = F.prompts ? cmd?.sys || s.prompts.find((x) => x.id === s.pr)?.text || (pl && !cmd ? pl.sys : '') || '' : ''
  const globalSys = F.prompts && s.globalPrompt?.on && s.globalPrompt.text.trim() ? s.globalPrompt.text.trim() : ''
  const baseSys = [globalSys, scoped].filter(Boolean).join('\n\n')
  const enabledTools = F.tools ? TOOLS.filter(([name]) => s.tools[name] === true).map(([name]) => name) : []
  const toolSys = enabledTools.length ? `${baseSys}${baseSys ? '\n\n' : ''}You may use the enabled tools when needed to answer the user. Call a tool for requests that need its actual result, then base your answer on the returned result.` : baseSys
  const skills = F.skills ? enabledSkills(normSkills(s.skills).skills) : []
  const sys = composeSystemPrompt(toolSys, skills)
  let err: Notice = null
  if (!s.eps.length) err = { t: 'You have not added a model endpoint yet. Open Settings → Endpoints, choose a provider preset, paste your API key and the model id, then press Test connection. After that, send your message again.', tab: 'eps', label: 'Add an endpoint' }
  else if (!ready.length) err = { t: ex ? `${tgt} is disabled or incomplete. An endpoint must be enabled and have a base URL and a model id.` : `No endpoint in ${tgt} is ready. Enable one and make sure it has a base URL and a model id.`, tab: pl ? 'pls' : 'eps', label: 'Fix endpoints' }
  else if (!cand.length) err = { t: `Not sent: no ready endpoint in ${tgt} can process ${need.map((n) => (n === 'img' ? 'images' : 'PDFs')).join(' and ')}. Your attachments are still in the message box. Choose a compatible endpoint or model.`, tab: 'eps', label: 'Open endpoints' }
  else if (s.sel && !sel && (s.sel.k === 'ep' || F.playlists)) err = { t: `The selected ${s.sel.k === 'pl' ? 'playlist' : 'endpoint'} is no longer available. Choose another model${s.sel.k === 'pl' ? ' or playlist' : ''}, then send again.`, tab: s.sel.k === 'pl' ? 'pls' : 'eps', label: 'Fix selection' }
  return { cmd, pl, ex, sys, cand, err, tgt, skills }
}
