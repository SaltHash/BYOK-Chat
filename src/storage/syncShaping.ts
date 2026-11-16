/* What actually travels to the remote sync slot.
 *
 * Local storage keeps the full conversation; a sync payload keeps the
 * user-facing story and nothing else:
 *
 *   - message text, bylines, model labels, token counts and timings;
 *   - tool-call indicators (which tool ran, whether it failed, how long it
 *     took) without their arguments or results;
 *   - research narration, the plan and the final report, without the evidence
 *     transcripts behind them;
 *   - project names and file names, without the extracted file text;
 *   - settings, without credentials unless the user explicitly opted in.
 *
 * Uploaded file bytes, workspace file bodies, system prompts, raw
 * request/response bodies, retry alternatives and older workspace revisions
 * stay local. Shapes are plain data, so the module is pure and unit-testable.
 */

import { leanChat, leanMessage, leanProject } from './lean'
import type { SyncData } from './syncMerge'

type Obj = Record<string, unknown>

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const clip = (v: string, n: number): string => (v.length > n ? `${v.slice(0, n)}…` : v)

/** Caps for the one large user-facing artifact that still travels: the latest
 *  workspace revision. A single file larger than this is a generated binary or
 *  a data dump; storing it on every workspace edit is not worth the transfer,
 *  so it is truncated with an explicit marker rather than silently dropped. */
export const WORKSPACE_FILE_MAX_CHARS = 24_000
export const WORKSPACE_TOTAL_MAX_CHARS = 400_000

const SYNC_MESSAGE_OPTIONS = {
  toolResultChars: 0,
  toolArgChars: 0,
  reasoningChars: 2000,
  researchChars: 1200,
  toolTextChars: 2000,
  alternatives: false,
}

export function shapeChatForSync(c: unknown): unknown {
  return leanChat(c, SYNC_MESSAGE_OPTIONS)
}

/** Workspaces are generated project files, so they are user-facing and only
 *  exist when chats are stored. Only the latest revision is synced (older
 *  history stays local) and its bodies are capped; a capped file says so. */
export function shapeWorkspacesForSync(value: unknown): Obj {
  const out: Obj = {}
  let budget = WORKSPACE_TOTAL_MAX_CHARS
  for (const [id, ws] of Object.entries(obj(value))) {
    const w = obj(ws)
    const revisions = arr(w.revisions)
    const latest = revisions.length ? revisions[revisions.length - 1] : undefined
    if (!latest || !obj(latest).files) { out[id] = { ...w, revisions: [] }; continue }
    const rev = obj(latest)
    const files = arr(rev.files).map((file) => {
      const f = obj(file)
      if (typeof f.content !== 'string') return f
      const room = Math.max(0, Math.min(WORKSPACE_FILE_MAX_CHARS, budget))
      budget -= Math.min(f.content.length, room)
      if (f.content.length <= room) return f
      return { ...f, content: clip(f.content, room), truncated: true }
    })
    out[id] = { ...w, revisions: [{ ...rev, files }] }
  }
  return out
}

/** Strip credentials from settings unless the user opted into syncing them.
 *  Endpoint keys, every search-provider key, the reader key and MCP headers
 *  are all covered; a provider added later cannot leak by being missed. */
function shapeSettings(settings: Obj, includeKeys: boolean): Obj {
  const out: Obj = { ...settings }
  // Project context files are extracted file text (see leanProject).
  if (Array.isArray(out.projects)) out.projects = out.projects.map(leanProject)
  if (Array.isArray(out.folders)) out.folders = out.folders.map(leanProject)
  if (includeKeys) return out
  if (Array.isArray(out.eps)) out.eps = out.eps.map((e) => ({ ...obj(e), key: '' }))
  if (out.search && typeof out.search === 'object') out.search = { ...obj(out.search), keys: {}, readerKey: '' }
  // A local MCP server's `env` block often holds an API key, so its values are
  // blanked exactly like the header block (keys stay so the shape is obvious).
  if (Array.isArray(out.mcps)) out.mcps = out.mcps.map((m) => {
    const rec = obj(m)
    const env = rec.env && typeof rec.env === 'object' && !Array.isArray(rec.env)
      ? Object.fromEntries(Object.keys(obj(rec.env)).map((key) => [key, '']))
      : rec.env
    return { ...rec, headers: '', ...(env ? { env } : {}) }
  })
  // A share record's token is the owner credential for editing or revoking a
  // public link; it is minted server-side and stays on the device that made it.
  if (Array.isArray(out.shares)) out.shares = out.shares.map((s) => ({ ...obj(s), token: '' }))
  return out
}

export type SyncShapeOptions = {
  /** Include conversations. Off by default: the server stores settings only. */
  chats?: boolean
  /** Include endpoint/search/MCP credentials. Off by default. */
  includeKeys?: boolean
}

export function shapeSyncData(data: SyncData, options: SyncShapeOptions = {}): SyncData {
  const chats = options.chats === true
  return {
    settings: shapeSettings(data.settings, options.includeKeys === true),
    chats: chats ? data.chats.map(shapeChatForSync) : [],
    workspaces: chats ? shapeWorkspacesForSync(data.workspaces) : {},
    selectedRevision: chats ? data.selectedRevision : {},
  }
}

/** One message, exactly as uploaded. Exposed for tests and for the server-side
 *  equivalent in server/sync.mjs. */
export const shapeMessageForSync = (m: unknown): unknown => leanMessage(m, SYNC_MESSAGE_OPTIONS)
