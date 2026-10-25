/* What actually travels to the remote sync slot.
 *
 * Local storage is allowed to keep the full conversation: uploaded file bytes,
 * tool arguments and results, reasoning traces, process logs. Remote storage is
 * not. A sync payload is the user-facing story only — message text, the final
 * answer, research reports, projects, settings and workspaces — with the bulky
 * regenerable/technical fields stripped. This keeps snapshots small enough to
 * stay cheap in Neon and limits what a remote copy can reveal.
 *
 * Shapes are plain data, so the module is pure and unit-testable.
 */

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

const shapeCall = (c: unknown): unknown => {
  const x = obj(c)
  const { result, arguments: args, ...rest } = x
  // A short argument string keeps the process log readable ("search: cats");
  // the full tool input and every tool output are local-only.
  return { ...rest, ...(typeof args === 'string' && args.length <= 500 ? { arguments: args } : {}) }
}

const shapeMsg = (m: unknown): unknown => {
  const x = obj(m)
  const { full, sys, reasoning, log, historyTokens, explicitTokens, ...rest } = x
  const out: Obj = { ...rest }
  if (Array.isArray(x.att)) out.att = x.att.map(shapeAttachment)
  if (Array.isArray(x.toolRounds)) {
    out.toolRounds = x.toolRounds.map((round) => {
      const r = obj(round)
      return { ...r, text: clip(r.text, 4000), calls: arr(r.calls).map(shapeCall) }
    })
  }
  if (Array.isArray(x.alts)) out.alts = x.alts.map((alt) => {
    const a = obj(alt)
    const { att, toolRounds, log, full: f, sys: s, reasoning: rs, ...keep } = a
    return keep
  })
  if (x.research && typeof x.research === 'object') {
    const rs = obj(x.research)
    const { reasoning: rr, note, ...keep } = rs
    out.research = {
      ...keep,
      ...(typeof note === 'string' ? { note: note.slice(0, 2000) } : {}),
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
