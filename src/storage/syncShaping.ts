/* What actually travels to the remote sync slot.
 *
 * Local storage keeps the full conversation; a sync payload keeps the
 * user-facing story: message text, the final answer, research reports and
 * narration, reasoning summaries, the search evidence behind citations,
 * projects, settings and workspaces. Uploaded file bytes, system prompts, raw
 * request/response bodies, full tool arguments and other tool output stay
 * local. Caps keep snapshots small enough to stay cheap in Neon and limit what
 * a remote copy can reveal.
 *
 * Shapes are plain data, so the module is pure and unit-testable.
 */

import { compactSearchEvidence } from '../persistence'
import { extractCitedIds } from '../citations'
import type { SyncData } from './syncMerge'

type Obj = Record<string, unknown>

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const clip = (v: unknown, n: number): unknown => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}…` : v)

const shapeAttachment = (a: unknown): unknown => {
  const x = obj(a)
  const { data, text, ...rest } = x
  return rest
}

const shapeCall = (c: unknown, cited: Set<string>): unknown => {
  const x = obj(c)
  const { result, arguments: args, ...rest } = x
  // A short argument string keeps the process log readable ("search: cats");
  // the full tool input stays local.
  const out: Obj = { ...rest, ...(typeof args === 'string' && args.length <= 500 ? { arguments: args } : {}) }
  // The evidence behind a citation is user-facing: without it a synced copy
  // renders the report with no sources panel and dead [S<n>] links. Keep
  // search evidence (cited blocks first) and read pages, capped.
  if (typeof result === 'string' && result) {
    if (x.name === 'search') out.result = compactSearchEvidence(result, cited, 12000)
    else if (x.name === 'fetch_page') out.result = clip(result, 12000)
  }
  return out
}

const shapeMsg = (m: unknown): unknown => {
  const x = obj(m)
  const { full, sys, log, historyTokens, explicitTokens, ...rest } = x
  const out: Obj = { ...rest }
  // The model's reasoning summary is shown in the thinking panel, so it is
  // part of the saved conversation; the raw request bodies and process logs
  // stay local. Cap it so a long trace cannot bloat a snapshot.
  if (typeof x.reasoning === 'string' && x.reasoning) out.reasoning = clip(x.reasoning, 8000)
  if (Array.isArray(x.att)) out.att = x.att.map(shapeAttachment)
  if (Array.isArray(x.toolRounds)) {
    const cited = new Set(extractCitedIds(`${String(x.toolFinal ?? '')}\n${String(x.t ?? '')}`))
    out.toolRounds = x.toolRounds.map((round) => {
      const r = obj(round)
      return { ...r, text: clip(r.text, 4000), calls: arr(r.calls).map((call) => shapeCall(call, cited)) }
    })
  }
  if (Array.isArray(x.alts)) out.alts = x.alts.map((alt) => {
    const a = obj(alt)
    const { att, toolRounds, log, full: f, sys: s, reasoning: rs, ...keep } = a
    return keep
  })
  if (x.research && typeof x.research === 'object') {
    const rs = obj(x.research)
    out.research = {
      ...rs,
      ...(typeof rs.note === 'string' ? { note: rs.note.slice(0, 4000) } : {}),
      ...(typeof rs.reasoning === 'string' ? { reasoning: rs.reasoning.slice(0, 8000) } : {}),
      ...(typeof rs.steer === 'string' ? { steer: rs.steer.slice(0, 800) } : {}),
      // Delegated agents and their reports are user-facing (the run card and
      // report panel show them), so they travel, capped like other narration.
      ...(Array.isArray(rs.agents) ? {
        agents: (rs.agents as Obj[]).slice(-24).map((a) => ({
          ...a,
          brief: clip(a.brief, 1200),
          answer: clip(a.answer, 4000),
          error: clip(a.error, 600),
          sources: Array.isArray(a.sources) ? a.sources.slice(0, 40) : a.sources,
          followUps: Array.isArray(a.followUps)
            ? (a.followUps as Obj[]).slice(-3).map((f) => ({ ...obj(f), q: clip(f.q, 600), a: clip(f.a, 3000) }))
            : a.followUps,
        })),
      } : {}),
      steps: arr(rs.steps).map((step) => {
        const st = obj(step)
        return { ...st, ...(typeof st.lead === 'string' ? { lead: st.lead.slice(0, 2000) } : {}) }
      }),
    }
  }
  return out
}

export function shapeChatForSync(c: unknown): unknown {
  const x = obj(c)
  return { ...x, msgs: arr(x.msgs).map(shapeMsg) }
}

/** Workspaces are generated project files, so they are user-facing. Only the
 *  latest revision is synced (older history stays local), but its file bodies
 *  are sent whole: silently clipping a workspace file makes a synced copy look
 *  complete while it will not build. If the full payload exceeds the transport
 *  limit the push fails loudly instead of storing a damaged file. */
export function shapeWorkspacesForSync(value: unknown): Obj {
  const out: Obj = {}
  for (const [id, ws] of Object.entries(obj(value))) {
    const w = obj(ws)
    const revisions = arr(w.revisions)
    const latest = revisions.length ? revisions[revisions.length - 1] : undefined
    out[id] = latest ? { ...w, revisions: [{ ...obj(latest), files: arr(obj(latest).files) }] } : { ...w, revisions: [] }
  }
  return out
}

/** Strip credentials from settings that can carry them even though the export
 *  path already omits keys; this is defence in depth for sync. */
function shapeSettings(settings: Obj): Obj {
  const out: Obj = { ...settings }
  if (Array.isArray(out.eps)) out.eps = out.eps.map((e) => ({ ...obj(e), key: '' }))
  if (out.search && typeof out.search === 'object') {
    out.search = { ...obj(out.search), keys: {}, readerKey: '' }
  }
  if (Array.isArray(out.mcps)) out.mcps = out.mcps.map((m) => ({ ...obj(m), headers: '' }))
  return out
}

export function shapeSyncData(data: SyncData): SyncData {
  return {
    settings: shapeSettings(data.settings),
    chats: data.chats.map(shapeChatForSync),
    workspaces: shapeWorkspacesForSync(data.workspaces),
    selectedRevision: data.selectedRevision,
  }
}
