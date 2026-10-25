/* Pure workspace file-artifact helpers. No DOM, no store imports — kept side-effect
   free so the logic stays unit-testable from src/workspace.test.mjs. */

export const WORKSPACE_TOOL = 'workspace_upsert'
export const WORKSPACE_MAX_CONTENT = 200000
export const WORKSPACE_MAX_PATH = 200
/** How many file paths a tool result lists back to the model. The workspace
 *  itself is uncapped; only this manifest is shortened, so a long project
 *  cannot flood the context on every call. */
export const WORKSPACE_RESULT_FILES = 40
export const WORKSPACE_TRUNC_MARKER = `\n\n[truncated: content exceeded ${WORKSPACE_MAX_CONTENT.toLocaleString('en-US')} characters]`
/** Any truncation marker, including the old 50,000-character one, so a file
 *  cut by an earlier version can still be recognised and continued. */
export const WORKSPACE_TRUNC_RE = /\n\n\[truncated: content exceeded [\d,]+ characters\]$/
export const isTruncatedContent = (s: unknown) => WORKSPACE_TRUNC_RE.test(String(s ?? ''))
/** How many lines one `read` returns before the model has to page on with
 *  `startLine`. A whole large file would otherwise fill the context and hide
 *  the lines the model actually needs to patch. */
export const WORKSPACE_READ_MAX_LINES = 400
/** Character safety net for a read window (a single minified line can be huge). */
export const WORKSPACE_READ_MAX_CHARS = 40000
/** Every action the workspace tool accepts. Writes are listed separately: only
 *  they create a revision or make earlier reads stale. */
export const WORKSPACE_ACTIONS = ['create', 'update', 'delete', 'continue', 'patch', 'read', 'list', 'search', 'diff', 'move'] as const
export type WorkspaceActionName = (typeof WORKSPACE_ACTIONS)[number]
export const WORKSPACE_WRITE_ACTIONS: readonly string[] = ['create', 'update', 'delete', 'continue', 'patch', 'move']
export const isWorkspaceWriteAction = (action: unknown): boolean => WORKSPACE_WRITE_ACTIONS.includes(String(action))
/** True for actions that only inspect the workspace (read, list, search, diff).
 *  They must never create a workspace or a revision. */
export const isWorkspaceReadAction = (action: unknown): boolean =>
  (WORKSPACE_ACTIONS as readonly string[]).includes(String(action)) && !isWorkspaceWriteAction(action)

/** Coerce any model-supplied path to a safe relative zip entry. Never throws. */
export function sanitizePath(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : ''
  s = s.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')
  const segs = s.split('/').filter((x) => x.length > 0)
  const cleanSeg = (x: string) => x.replace(/[^A-Za-z0-9_\-.]+/g, '_').replace(/^\.+$/, '_').slice(0, 100)
  if (!segs.length) return 'file.txt'
  // Any parent traversal collapses to the basename in the zip root.
  if (segs.some((x) => x === '..')) {
    const base = cleanSeg(segs[segs.length - 1]) || 'file.txt'
    return /[A-Za-z0-9]/.test(base) ? base.slice(0, WORKSPACE_MAX_PATH) : 'file.txt'
  }
  const clean = segs.filter((x) => x !== '.').map(cleanSeg).filter(Boolean)
  if (!clean.length) return 'file.txt'
  const joined = clean.join('/')
  if (!/^[\w\-./]+$/.test(joined) || joined.length > WORKSPACE_MAX_PATH) {
    return (clean[clean.length - 1].slice(0, 100) || 'file.txt')
  }
  return joined
}

/** Cut content at the per-file limit. New writes are refused rather than
 *  stored cut (see applyOneFileOp); this stays for legacy data and for the
 *  size check. */
export function truncateWorkspaceContent(content: string, max = WORKSPACE_MAX_CONTENT): { text: string; truncated: boolean } {
  if (content.length > max) return { text: content.slice(0, max) + WORKSPACE_TRUNC_MARKER, truncated: true }
  return { text: content, truncated: false }
}

export type WorkspaceArgs = { action?: string; path?: string; language?: string; content?: string; label?: string; template?: string; workspaceId?: string; workspaceName?: string; revisionName?: string; to?: string; query?: string; glob?: string; against?: string }

/** Argument keys the tolerant parser reads as plain strings. */
const WORKSPACE_STRING_ARGS = ['action', 'path', 'language', 'content', 'label', 'template', 'workspaceId', 'workspaceName', 'revisionName', 'to', 'query', 'glob', 'against'] as const

/** Best-effort unescape of a JSON string fragment (tolerates a cut-off tail). */
function unescapeFragment(s: string): string {
  const t = s.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, '')
  try { return JSON.parse('"' + t + '"') } catch { /* fall through to manual */ }
  return t.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/**
 * Parse workspace tool arguments tolerantly. Full JSON parses exactly; truncated
 * streaming JSON falls back to prefix extraction of each field. Never throws.
 */
export function parseWorkspaceArgsPartial(raw: string): WorkspaceArgs {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: WorkspaceArgs = {}
      for (const k of WORKSPACE_STRING_ARGS) {
        if (typeof (v as Record<string, unknown>)[k] === 'string') out[k] = (v as Record<string, string>)[k]
      }
      return out
    }
  } catch { /* truncated JSON — extract prefixes below */ }
  const out: WorkspaceArgs = {}
  for (const k of WORKSPACE_STRING_ARGS) {
    // Content is extracted below, where an unterminated string is handled.
    if (k === 'content') continue
    const m = raw.match(new RegExp('"' + k + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)'))
    if (m) out[k] = unescapeFragment(m[1])
  }
  // Content may be cut mid-string: consume from its opening quote, honouring
  // escapes, and stop at the closing quote or end of input.
  const cm = raw.match(/"content"\s*:\s*"/)
  if (cm?.index != null) {
    let i = cm.index + cm[0].length, buf = ''
    while (i < raw.length) {
      const ch = raw[i]
      if (ch === '\\') { buf += ch + (raw[i + 1] ?? ''); i += 2; continue }
      if (ch === '"') break
      buf += ch; i++
    }
    out.content = unescapeFragment(buf)
  }
  return out
}

export type WorkspaceCallLike = { id: string; name: string; arguments: string }
export type WorkspaceVersion = { action: string; path: string; language: string; content: string; label?: string; callId: string }

/* Group workspace calls by sanitized path in message order. There is no cap on
   the number of files a workspace may hold: the model writes one file per
   call, and a large project is a normal outcome. */
export function groupWorkspaceVersions(calls: WorkspaceCallLike[], limit = Number.POSITIVE_INFINITY): { path: string; versions: WorkspaceVersion[] }[] {
  const order: string[] = []
  const map = new Map<string, WorkspaceVersion[]>()
  for (const c of calls) {
    if (c?.name !== WORKSPACE_TOOL) continue
    const a = parseWorkspaceArgsPartial(typeof c.arguments === 'string' ? c.arguments : '')
    // Skip calls that have not streamed a real file target yet: an empty path
    // is not a file named "file.txt", it is just arguments still arriving.
    const hasPath = typeof a.path === 'string' && a.path.trim().length > 0
    if (!hasPath) continue
    // read, list, search and diff are inspection, not versions: they must
    // never become the latest state in the panel, make a file look written,
    // or count as a project file. Arguments still streaming have no action
    // yet, so they are skipped too.
    const action = typeof a.action === 'string' ? a.action : ''
    if (!isWorkspaceWriteAction(action)) continue
    const path = sanitizePath(a.path ?? '')
    const v: WorkspaceVersion = {
      action,
      path,
      language: typeof a.language === 'string' ? a.language : '',
      content: typeof a.content === 'string' ? a.content : '',
      label: typeof a.label === 'string' ? a.label : undefined,
      callId: c.id,
    }
    if (!map.has(path)) { map.set(path, []); order.push(path) }
    map.get(path)!.push(v)
  }
  return order.slice(0, limit).map((path) => ({ path, versions: map.get(path)! }))
}

/** Count distinct workspace files across calls (pre-cap). */
export function countWorkspaceFiles(calls: WorkspaceCallLike[]): number {
  return groupWorkspaceVersions(calls, Number.MAX_SAFE_INTEGER).length
}

/* ---- Request-only compaction of workspace history -----------------------
 * A full-file write is part of the assistant's tool-call history forever, so
 * a model that rewrites a 500-line file ten times pays for all ten copies on
 * every later round. The workspace itself keeps every revision; the model
 * only needs the current version of each file plus the small patch calls that
 * came after it. This function rewrites a wire-bound history copy (never the
 * stored one): older full bodies become short placeholders, older read results
 * are reduced to a note, and older file manifests are dropped. */

export type WorkspaceWireCall = WorkspaceCallLike & { result?: string }
export type WorkspaceWireRound = { text: string; calls: WorkspaceWireCall[] }
export type WorkspaceWireMessage = { toolRounds?: WorkspaceWireRound[] }

/** Bodies below this size are not worth replacing; the placeholder is almost
 *  as large as the content and keeping short snippets is still useful. */
const WORKSPACE_COMPACT_MIN = 400

const workspaceCallKey = (m: number, r: number, c: number) => `${m}:${r}:${c}`

/** Identify the workspace a call wrote to. The first create of a workspace has
 *  no id yet, so its result (which reports the new id) is preferred over the
 *  name: without that, its body would never be recognised as superseded by a
 *  later update that used the id. */
const workspaceKeyOf = (args: WorkspaceArgs, result: unknown): string => {
  const direct = typeof args.workspaceId === 'string' ? args.workspaceId.trim() : ''
  if (direct) return direct
  if (result && typeof result === 'object') {
    const created = (result as { workspaceId?: unknown }).workspaceId
    if (typeof created === 'string' && created) return created
  }
  const named = typeof args.workspaceName === 'string' ? args.workspaceName.trim() : ''
  return named ? `name:${named}` : ''
}

const fileKeyOf = (ws: string, path: string) => `${ws}\u0000${path}`
/** Inspection results are snapshots, not history: the newest answer to the
 *  same question makes the earlier one redundant. These keys identify that
 *  question so the compactor can drop only true duplicates. */
const listKeyOf = (ws: string, args: WorkspaceArgs) => `${ws}\u0000${args.path ?? ''}\u0000${args.glob ?? ''}`
const searchKeyOf = (ws: string, args: WorkspaceArgs, raw: Record<string, unknown>) =>
  `${ws}\u0000${args.query ?? ''}\u0000${args.path ?? ''}\u0000${args.glob ?? ''}\u0000${raw.regex === true ? 1 : 0}\u0000${raw.caseSensitive === true ? 1 : 0}`

/** The original argument object, so replacing a body keeps fields the tolerant
 *  parser deliberately ignores (`createNew`, booleans, future additions). */
const jsonObjectOf = (raw: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  } catch { return {} }
}

type WorkspaceCallMeta = { args: WorkspaceArgs; ws: string; fileKey?: string; result?: unknown; rawArgs: Record<string, unknown> }

export function compactWorkspaceHistory<T extends WorkspaceWireMessage>(msgs: T[]): T[] {
  type Loc = { m: number; r: number; c: number }
  const meta = new Map<string, WorkspaceCallMeta>()
  const latestFull = new Map<string, Loc>()
  const latestRead = new Map<string, Loc>()
  const latestList = new Map<string, Loc>()
  const latestSearch = new Map<string, Loc>()
  const latestDiff = new Map<string, Loc>()
  const readHistory = new Map<string, string[]>()
  const staleReads = new Set<string>()
  const deleted = new Set<string>()
  const lastManifest = new Map<string, string>()

  for (let m = 0; m < msgs.length; m++) {
    const rounds = msgs[m].toolRounds
    if (!rounds) continue
    for (let r = 0; r < rounds.length; r++) {
      for (let c = 0; c < rounds[r].calls.length; c++) {
        const call = rounds[r].calls[c]
        if (call?.name !== WORKSPACE_TOOL) continue
        const raw = typeof call.arguments === 'string' ? call.arguments : ''
        const args = parseWorkspaceArgsPartial(raw)
        const key = workspaceCallKey(m, r, c)
        let result: unknown
        try { result = typeof call.result === 'string' ? JSON.parse(call.result) : undefined } catch { /* error strings have no manifest */ }
        const ws = workspaceKeyOf(args, result)
        const path = typeof args.path === 'string' && args.path.trim() ? sanitizePath(args.path) : ''
        const fileKey = path ? fileKeyOf(ws, path) : undefined
        const rawArgs = jsonObjectOf(raw)
        meta.set(key, { args, ws, fileKey, result, rawArgs })
        if (result && typeof result === 'object') {
          if (args.action === 'list' && typeof (result as { tree?: unknown }).tree === 'string') latestList.set(listKeyOf(ws, args), { m, r, c })
          if (args.action === 'search' && Array.isArray((result as { matches?: unknown }).matches)) latestSearch.set(searchKeyOf(ws, args, rawArgs), { m, r, c })
          if (args.action === 'diff' && fileKey && typeof (result as { diff?: unknown }).diff === 'string') latestDiff.set(fileKey, { m, r, c })
        }
        if (fileKey) {
          const write = isWorkspaceWriteAction(args.action)
          if (args.action === 'create' || args.action === 'update') {
            latestFull.set(fileKey, { m, r, c })
            deleted.delete(fileKey)
          } else if (args.action === 'delete' || args.action === 'move') {
            deleted.add(fileKey)
          }
          if (args.action === 'read') {
            // Only a whole-file read can stand in for an earlier read. A
            // paged window (startLine/hasMore) must not hide the rest of the
            // file that an earlier read already brought into context.
            const start = result && typeof result === 'object' ? (result as { startLine?: unknown }).startLine : undefined
            const whole = start === undefined
              || (Number(start) <= 1 && (result as { hasMore?: unknown }).hasMore !== true)
            if (whole) latestRead.set(fileKey, { m, r, c })
            readHistory.set(fileKey, [...(readHistory.get(fileKey) ?? []), key])
          } else if (write) {
            // A write makes earlier reads stale: their text is no longer the
            // file, so it must not travel as if it were current.
            for (const prior of readHistory.get(fileKey) ?? []) staleReads.add(prior)
            readHistory.delete(fileKey)
            latestRead.delete(fileKey)
          }
        }
        if (result && typeof result === 'object' && Array.isArray((result as { files?: unknown }).files)) lastManifest.set(ws, key)
      }
    }
  }
  if (!meta.size) return msgs

  const isLatest = (loc: Loc | undefined, m: number, r: number, c: number) => !!loc && loc.m === m && loc.r === r && loc.c === c

  return msgs.map((msg, m) => {
    const rounds = msg.toolRounds
    if (!rounds) return msg
    const nextRounds = rounds.map((round, r) => ({
      ...round,
      calls: round.calls.map((call, c) => {
        if (call?.name !== WORKSPACE_TOOL) return call
        const key = workspaceCallKey(m, r, c)
        const info = meta.get(key)
        if (!info) return call
        const { args, fileKey } = info
        let next = call

        if (fileKey && (args.action === 'create' || args.action === 'update') && typeof args.content === 'string' && args.content.length >= WORKSPACE_COMPACT_MIN) {
          const latest = latestFull.get(fileKey)
          if (deleted.has(fileKey) || !isLatest(latest, m, r, c)) {
            const note = deleted.has(fileKey)
              ? `[earlier version omitted from the model context: ${args.content.length.toLocaleString()} characters. The file was deleted or moved later in this transcript.]`
              : `[earlier version omitted from the model context: ${args.content.length.toLocaleString()} characters. The latest version of this file is later in this transcript.]`
            next = { ...next, arguments: JSON.stringify({ ...info.rawArgs, content: note }) }
          }
        }

        if (typeof next.result === 'string' && info.result && typeof info.result === 'object') {
          const result = { ...info.result as Record<string, unknown> }
          let changed = false
          if (Array.isArray(result.files) && lastManifest.get(info.ws) !== key) {
            delete result.files
            delete result.fileCount
            delete result.filesNote
            result.filesNote = 'File list omitted here; the latest workspace result for this workspace lists the current files.'
            changed = true
          }
          if (args.action === 'list' && typeof result.tree === 'string' && !isLatest(latestList.get(listKeyOf(info.ws, args)), m, r, c)) {
            result.treeNote = 'An earlier file tree was omitted; the newest list result for the same filter is later in this transcript.'
            delete result.tree
            changed = true
          }
          if (args.action === 'search' && Array.isArray(result.matches) && !isLatest(latestSearch.get(searchKeyOf(info.ws, args, info.rawArgs)), m, r, c)) {
            const found = result.matches.length
            result.matchesNote = `Earlier results of the same search omitted (${found} match${found === 1 ? '' : 'es'}); the newest search for this query is later in this transcript.`
            delete result.matches
            changed = true
          }
          if (fileKey && args.action === 'diff' && typeof result.diff === 'string' && !isLatest(latestDiff.get(fileKey), m, r, c)) {
            result.diffNote = 'An earlier diff was omitted; the newest diff for this file is later in this transcript.'
            delete result.diff
            changed = true
          }
          if (fileKey && args.action === 'read' && typeof result.content === 'string') {
            // A paged read is not a replacement for a whole-file read: keep
            // both, so the context never loses lines the model already paid
            // for just because it inspected a later window.
            const paged = result.startLine !== undefined
              && (Number(result.startLine) > 1 || result.hasMore === true)
            const stale = staleReads.has(key)
            if (stale || (!paged && !isLatest(latestRead.get(fileKey), m, r, c))) {
              result.contentNote = stale
                ? `[earlier read omitted: ${result.content.length.toLocaleString()} characters. The file changed after this read; call action read for its current text.]`
                : `[earlier read omitted: ${result.content.length.toLocaleString()} characters. A later read in this transcript is current.]`
              delete result.content
              changed = true
            }
          }
          if (changed) next = { ...next, result: JSON.stringify(result) }
        }
        return next
      }),
    }))
    return { ...msg, toolRounds: nextRounds }
  })
}

/** Dedupe sanitized zip entry paths, suffixing -2, -3 before the extension. */
export function buildZipEntries(files: { path: string; content: string }[]): { path: string; content: string }[] {
  const used = new Set<string>()
  return files.map((f) => {
    let p = sanitizePath(f.path)
    if (used.has(p)) {
      const slash = p.lastIndexOf('/'), dot = p.lastIndexOf('.')
      const stem = dot > slash + 1 ? p.slice(0, dot) : p
      const ext = dot > slash + 1 ? p.slice(dot) : ''
      let n = 2
      while (used.has(`${stem}-${n}${ext}`)) n++
      p = `${stem}-${n}${ext}`
    }
    used.add(p)
    return { path: p, content: typeof f.content === 'string' ? f.content : String(f.content ?? '') }
  })
}

/** Zip filename from the first file's top-level directory, else a default. */
export function zipFilename(files: { path: string }[]): string {
  if (!files.length) return 'workspace-files.zip'
  const first = sanitizePath(files[0].path)
  if (first.includes('/')) {
    const top = first.split('/')[0].replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 60) || 'workspace'
    return `${top}.zip`
  }
  return 'workspace-files.zip'
}

export const workspaceSize = (s: string) => {
  const n = new TextEncoder().encode(s).length
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`
}
export const workspaceLines = (s: string) => (s ? s.split('\n').length : 0)

/* ---- Shared live-workspace helpers (pure, unit-testable) ----
 * These collapse the 4 duplicated writingPath / workspaceIds computations
 * previously spread across Chat.tsx and Workspace.tsx. */

export type LiveCallLike = { id: string; name?: string; arguments: string; result?: string }

/** IDs of workspaces touched by completed tool rounds (args first, then result). */
export function extractWorkspaceIds(calls: { name: string; arguments: string; result?: string }[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const c of calls) {
    if (c.name !== WORKSPACE_TOOL) continue
    let id: string | null = null
    try { const a = JSON.parse(c.arguments || '{}'); if (a.workspaceId) id = String(a.workspaceId) } catch { /* ignore */ }
    if (!id) try { const r = JSON.parse(c.result || '{}'); if (r.workspaceId) id = String(r.workspaceId) } catch { /* ignore */ }
    if (id && !seen.has(id)) { seen.add(id); ids.push(id) }
  }
  return ids
}

/** Pending (not-yet-committed) live calls vs completed final calls. Only calls
 *  that have actually named the workspace tool are pending: a nameless live
 *  call is some other tool whose name has not streamed yet, not a file write. */
export function pendingLiveCalls(
  live: LiveCallLike[] | undefined,
  finalCalls: { id: string }[],
  tool = WORKSPACE_TOOL,
): LiveCallLike[] {
  const done = new Set(finalCalls.map((c) => c.id))
  return (live ?? []).filter((c) => c.name === tool).filter((c) => !c.id || !done.has(c.id))
}

/** Path of the file currently being written, or null when idle. */
export function findWritingPath(
  live: LiveCallLike[] | undefined,
  toolRounds: { calls: WorkspaceCallLike[] }[] | undefined,
  tool = WORKSPACE_TOOL,
): string | null {
  const finalCalls = (toolRounds ?? []).flatMap((r) => r.calls).filter((c) => c.name === tool)
  const pending = pendingLiveCalls(live as LiveCallLike[] | undefined, finalCalls, tool)
  if (!pending.length) return null
  const groups = groupWorkspaceVersions(pending.map((c) => ({ ...c, name: tool })))
  return groups[groups.length - 1]?.path ?? null
}

export type FolderTreeNode<T extends { path: string }> = { files: T[]; folders: Set<string> }
export type FolderTree<T extends { path: string }> = Record<string, FolderTreeNode<T>>

/** Nested folder tree keyed by `/a/b` paths; root is `/`. Pure and shared by tile + panel. */
export function buildFolderTree<T extends { path: string }>(files: T[]): FolderTree<T> {
  const root: FolderTree<T> = { '/': { files: [], folders: new Set() } }
  for (const f of files) {
    const parts = f.path.split('/')
    let current = '/'
    for (let i = 0; i < parts.length - 1; i++) {
      const next = current === '/' ? `/${parts[i]}` : `${current}/${parts[i]}`
      if (!root[next]) root[next] = { files: [], folders: new Set() }
      root[current].folders.add(parts[i])
      current = next
    }
    root[current].files.push(f)
  }
  return root
}

/** Expanded-folder map for every ancestor of `filePath` (e.g. auto-follow). */
export function expandedFoldersForPath(filePath: string | null | undefined): Record<string, boolean> {
  if (!filePath) return {}
  const parts = filePath.split('/')
  const out: Record<string, boolean> = {}
  let cur = '/'
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur === '/' ? `/${parts[i]}` : `${cur}/${parts[i]}`
    out[cur] = true
  }
  return out
}

/* ============================================================================
 * Workspace (first-class entity) types and migration helpers
 * ============================================================================ */

export type WorkspaceFile = { path: string; language: string; content: string; truncated?: boolean }
export type WorkspaceRevision = { id: string; name: string; msgId: string; files: WorkspaceFile[]; createdAt: number }
export type Workspace = { id: string; name: string; revisions: WorkspaceRevision[]; viewDefault?: 'pinned' | 'latest' }

/** Migrate legacy per-message canvas groups into Workspace entities. */
export function migrateLegacyCanvasGroups(chats: { msgs: any[] }[]): { workspaces: Record<string, Workspace>; selectedRevision: Record<string, string> } {  const workspaces: Record<string, Workspace> = {}
  const selectedRevision: Record<string, string> = {}
  let workspaceCounter = 0

  for (const chat of chats) {
    for (const msg of chat.msgs) {
      if (msg.r !== 'assistant') continue
      const calls = (msg.toolRounds ?? []).flatMap((r: any) => r.calls)
      const workspaceCalls = calls.filter((c: any) => c.name === 'canvas_upsert')
      if (!workspaceCalls.length) continue

      workspaceCounter++
      const groups = groupWorkspaceVersions(workspaceCalls.map((c: any) => ({ ...c, name: WORKSPACE_TOOL })))
      if (!groups.length) continue

      const workspaceId = `ws-${msg.id}-${workspaceCounter}`
      const revisionId = `rev-${msg.id}-1`
      const files: WorkspaceFile[] = groups.map(g => ({
        path: g.path,
        language: g.versions[g.versions.length - 1].language,
        content: g.versions[g.versions.length - 1].content,
        truncated: isTruncatedContent(g.versions[g.versions.length - 1].content),
      }))

      workspaces[workspaceId] = {
        id: workspaceId,
        name: `Workspace ${workspaceCounter}`,
        revisions: [{
          id: revisionId,
          name: groups[0].versions[0].label || `v1`,
          msgId: msg.id,
          files,
          createdAt: msg.at ?? Date.now(),
        }],
      }
      selectedRevision[workspaceId] = revisionId
    }
  }

  return { workspaces, selectedRevision }
}

/* ---- Which workspace does a workspace_upsert call target? ----------------
 * The model can omit the workspace id (older replies carry a `<Workspace:id>`
 * tag, but the model may still forget it) or repeat createNew for what is
 * really the same project. Both used to spawn a second, nearly empty
 * workspace, so the files the user was looking at appeared to vanish. The
 * active workspace of the chat is the fallback. */

export type WorkspaceTargetInput = { workspaceId?: string; createNew?: boolean; workspaceName?: string }

export type WorkspaceTarget = {
  workspaceId?: string
  createNew?: boolean
  workspaceName?: string
  /** Set when the call was redirected away from what the model asked for. */
  fallback?: 'active' | 'new'
}

/* ---- Keeping the workspace id in the model's transcript -----------------
 * A completed reply's tool calls are dropped before the next request, and the
 * workspace id lived only inside them. The system prompt names the active
 * workspace, but an older one became unreachable, and a reply that only used
 * a tool had no text at all. Each assistant turn that touched a workspace now
 * carries a compact `<Workspace:id>` tag in the request copy (never in the
 * stored message), so the model can still find and return to it. */

const cleanWorkspaceId = (raw: unknown) => String(raw ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)

/** One marker per distinct workspace id, in the order the reply used them. */
export function workspaceTags(ids?: string[]): string {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of ids ?? []) {
    const id = cleanWorkspaceId(raw)
    if (!id || seen.has(id)) continue
    seen.add(id)
    tags.push(`<Workspace:${id}>`)
  }
  return tags.join(' ')
}

/** Append this reply's workspace tags unless the text already carries them. */
export function withWorkspaceTags(text: string, ids?: string[]): string {
  const raw = String(text ?? '')
  const body = raw.trimEnd()
  const tags = workspaceTags((ids ?? []).filter((id) => !body.includes(`<Workspace:${cleanWorkspaceId(id)}>`)))
  if (!tags) return raw
  return `${body}${body ? '\n\n' : ''}${tags}`
}

/** The workspace a chat is working in: the last one touched by any message. */
export function activeWorkspaceId(msgs: { workspaceIds?: string[] }[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const ids = msgs[i]?.workspaceIds
    if (ids?.length) return ids[ids.length - 1]
  }
  return undefined
}

/**
 * Decide which workspace a workspace_upsert call targets.
 * - A known workspaceId wins.
 * - An unknown workspaceId (stale or hallucinated) falls back to the chat's
 *   active workspace so the files land where the user is looking.
 * - With no id at all the active workspace is used; a new workspace is only
 *   created when the chat has none yet.
 * - createNew:true starts a new workspace, unless the name matches the
 *   active one (the model re-creating "the same project").
 */
export function resolveWorkspaceTarget(
  input: WorkspaceTargetInput,
  ctx: { workspaces: Record<string, Workspace>; activeId?: string },
): WorkspaceTarget {
  const name = String(input.workspaceName ?? '').trim().slice(0, 80)
  const active = ctx.activeId ? ctx.workspaces[ctx.activeId] : undefined
  if (input.createNew) {
    if (active && name && name.toLowerCase() === String(active.name ?? '').trim().toLowerCase()) {
      return { workspaceId: active.id, fallback: 'active' }
    }
    return { createNew: true, workspaceName: name || 'Workspace' }
  }
  const wanted = String(input.workspaceId ?? '').trim()
  if (wanted && ctx.workspaces[wanted]) return { workspaceId: wanted }
  if (active) return { workspaceId: active.id, fallback: 'active' }
  return { createNew: true, workspaceName: name || 'Workspace', fallback: 'new' }
}

/* ============================================================================
 * Diffs, patches, previews, templates (all pure, no DOM)
 * ============================================================================ */

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

const DIFF_LCS_CAP = 2000

/** Line diff via LCS (falls back to whole-block replace past the line cap so
 *  huge files stay fast). Never throws. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n')
  if (A.length * B.length > DIFF_LCS_CAP * DIFF_LCS_CAP) {
    if (a === b) return A.map((text) => ({ type: 'same' as const, text }))
    return [...A.map((text): DiffLine => ({ type: 'del', text })), ...B.map((text): DiffLine => ({ type: 'add', text }))]
  }
  const m = A.length, n = B.length
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i] }); i++ }
    else { out.push({ type: 'add', text: B[j] }); j++ }
  }
  while (i < m) out.push({ type: 'del', text: A[i++] })
  while (j < n) out.push({ type: 'add', text: B[j++] })
  return out
}

export const diffStat = (lines: DiffLine[]): { added: number; removed: number } => ({
  added: lines.filter((l) => l.type === 'add').length,
  removed: lines.filter((l) => l.type === 'del').length,
})

export type FileChange = { path: string; status: 'added' | 'removed' | 'modified' | 'same' }

/** Per-path change list between two revisions' file sets. Pure. */
export function changedFilesBetween(prev: { path: string; content: string }[], next: { path: string; content: string }[]): FileChange[] {
  const a = new Map(prev.map((f) => [f.path, f.content]))
  const b = new Map(next.map((f) => [f.path, f.content]))
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort()
  return paths.map((path) => ({
    path,
    status: !a.has(path) ? 'added' : !b.has(path) ? 'removed' : a.get(path) === b.get(path) ? 'same' : 'modified',
  }))
}

/* ----------------------------------------------------------------------------
 * Inspection helpers: ranged reads, grep, folder tree, unified diffs.
 * All pure and DOM-free, so every one of them is unit-testable and safe to use
 * from the request planner.
 * -------------------------------------------------------------------------- */

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/** Normalize a folder prefix the model passed ("src", "/src/", "") to `src`. */
export function folderPrefix(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text || text === '/' || text === '.') return ''
  const clean = sanitizePath(text)
  return clean === 'file.txt' ? '' : clean.replace(/\/+$/, '')
}

export type WorkspaceReadRange = {
  text: string
  /** 1-based, inclusive, and already clamped to the file. */
  startLine: number
  endLine: number
  totalLines: number
  returnedLines: number
  hasMore: boolean
  nextStartLine?: number
}

/** One page of a file. Without a range the first page is returned, so a huge
 *  file can never swallow the context in a single read. */
export function readWorkspaceRange(
  content: string,
  opts: { startLine?: number; endLine?: number; maxLines?: number; maxChars?: number } = {},
): WorkspaceReadRange {
  const source = String(content ?? '')
  const lines = source.split('\n')
  const totalLines = source === '' ? 0 : lines.length
  if (!totalLines) return { text: '', startLine: 1, endLine: 0, totalLines: 0, returnedLines: 0, hasMore: false }
  const maxLines = clampInt(opts.maxLines, 1, 2000, WORKSPACE_READ_MAX_LINES)
  const maxChars = clampInt(opts.maxChars, 1000, 200000, WORKSPACE_READ_MAX_CHARS)
  const startLine = clampInt(opts.startLine, 1, totalLines, 1)
  const lastAllowed = Math.min(totalLines, startLine + maxLines - 1)
  const endLimit = Math.min(clampInt(opts.endLine, startLine, totalLines, lastAllowed), lastAllowed)
  const out: string[] = []
  let chars = 0
  for (let i = startLine - 1; i < endLimit; i++) {
    const line = lines[i]
    if (out.length && chars + line.length + 1 > maxChars) break
    out.push(line)
    chars += line.length + 1
  }
  const endLine = out.length ? startLine + out.length - 1 : startLine
  const hasMore = out.length > 0 && endLine < totalLines
  return {
    text: out.join('\n'),
    startLine,
    endLine,
    totalLines,
    returnedLines: out.length,
    hasMore,
    ...(hasMore ? { nextStartLine: endLine + 1 } : {}),
  }
}

/** Folders whose contents are noise in a manifest: dependency, build, cache
 *  and VCS directories. They are still shown as a folder with a file count. */
export const WORKSPACE_HIDDEN_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.wrangler', '.output',
  'coverage', 'vendor', 'venv', '.venv', '__pycache__', '.pytest_cache',
  '.mypy_cache', 'target', 'Pods', '.gradle', '.idea', '.vscode',
])

/** Glob (supports `*`, `**` and `?`) to an anchored path regex. */
export function workspaceGlob(glob: string): RegExp {
  const source = String(glob ?? '').trim().replace(/^\.\//, '').replace(/^\//, '')
  let out = ''
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '*') {
      if (source[i + 1] === '*') {
        i++
        if (source[i + 1] === '/') { i++; out += '(?:.*/)?' } else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`(^|/)${out}$`, 'i')
}

/** Does a workspace path match a folder prefix and/or glob? */
export function workspacePathMatches(path: string, opts: { path?: string; glob?: string } = {}): boolean {
  const prefix = folderPrefix(opts.path)
  if (prefix && path !== prefix && !path.startsWith(prefix + '/')) return false
  const glob = String(opts.glob ?? '').trim()
  return !glob || workspaceGlob(glob).test(path)
}

export type WorkspaceMatch = { path: string; line: number; text: string; before?: string[]; after?: string[] }
export type WorkspaceSearchResult = {
  query: string
  matches: WorkspaceMatch[]
  /** Matches returned (<= maxResults). */
  matchCount: number
  /** Matches found, including the ones cut by maxResults. */
  totalMatches: number
  filesMatched: number
  filesSearched: number
  truncated: boolean
}

/** Grep across workspace files. Literal by default; `regex` switches to a
 *  pattern. Always bounded, so a broad query cannot fill the context. */
export function searchWorkspaceFiles(
  files: { path: string; content: string }[],
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean; path?: string; glob?: string; contextLines?: number; maxResults?: number; maxTextChars?: number } = {},
): WorkspaceSearchResult {
  const needle = String(query ?? '')
  if (!needle.length) throw Error('search needs a query: the text or pattern to find.')
  if (needle.length > 500) throw Error('search query is too long (keep it under 500 characters).')
  // A nested quantifier such as `(a+)+` can backtrack for minutes on one long
  // line and freeze the tab. Refuse the obvious cases instead of risking it.
  if (opts.regex && /\((?:\?:)?[^()]*[*+][^()]*\)\s*[*+]/.test(needle)) {
    throw Error('That regular expression nests a quantifier inside a repeated group, which can hang the search. Simplify the pattern or use a literal search.')
  }
  const flags = opts.caseSensitive ? '' : 'i'
  let matcher: RegExp
  try {
    matcher = new RegExp(opts.regex ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch (error) {
    throw Error(`Invalid regular expression: ${(error as Error).message}`)
  }
  const maxResults = clampInt(opts.maxResults, 1, 200, 50)
  const contextLines = clampInt(opts.contextLines, 0, 3, 0)
  const maxText = clampInt(opts.maxTextChars, 60, 500, 200)
  const clip = (line: string) => (line.length > maxText ? `${line.slice(0, maxText)}…` : line)
  const included = files.filter((f) => workspacePathMatches(String(f.path ?? ''), opts))
  const matches: WorkspaceMatch[] = []
  const matchedFiles = new Set<string>()
  let totalMatches = 0
  // Bounded overall work: a workspace can hold arbitrarily many files, and a
  // search must not stall the reply for seconds.
  const deadline = performance.now() + 1500
  let timedOut = false
  for (const file of included) {
    if (performance.now() > deadline) { timedOut = true; break }
    const lines = String(file.content ?? '').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!matcher.test(lines[i])) continue
      totalMatches++
      matchedFiles.add(file.path)
      if (matches.length >= maxResults) continue
      matches.push({
        path: file.path,
        line: i + 1,
        text: clip(lines[i]),
        ...(contextLines ? {
          before: lines.slice(Math.max(0, i - contextLines), i).map(clip),
          after: lines.slice(i + 1, i + 1 + contextLines).map(clip),
        } : {}),
      })
    }
  }
  return {
    query: needle,
    matches,
    matchCount: matches.length,
    totalMatches,
    filesMatched: matchedFiles.size,
    filesSearched: included.length,
    truncated: totalMatches > matches.length || timedOut,
  }
}

type TreeDir = { folders: Map<string, TreeDir>; files: { name: string; lines: number }[] }

/** Compact, human-readable folder tree for the system prompt and `list`.
 *  Dependency/build folders are shown once with a file count and no children,
 *  so `node_modules` never floods the context but its existence is visible. */
export function workspaceTree(
  files: { path: string; content?: string }[],
  opts: { maxEntries?: number; maxChars?: number } = {},
): { text: string; fileCount: number; folderCount: number; hiddenFiles: number; hiddenFolders: number; truncated: boolean; omittedFiles: number } {
  const maxEntries = clampInt(opts.maxEntries, 5, 500, 80)
  const maxChars = clampInt(opts.maxChars, 200, 20000, 3000)
  const root: TreeDir = { folders: new Map(), files: [] }
  const folderPrefixes = new Set<string>()
  const hiddenCounts = new Map<string, number>()
  let hiddenFiles = 0
  let fileCount = 0
  for (const file of files) {
    const path = String(file.path ?? '')
    if (!path) continue
    fileCount++
    const parts = path.split('/')
    let hiddenAt = -1
    for (let i = 0; i < parts.length - 1; i++) {
      if (WORKSPACE_HIDDEN_DIRS.has(parts[i])) { hiddenAt = i; break }
    }
    if (hiddenAt >= 0) {
      const prefix = parts.slice(0, hiddenAt + 1).join('/')
      hiddenCounts.set(prefix, (hiddenCounts.get(prefix) ?? 0) + 1)
      hiddenFiles++
      // Keep folder nodes down to the hidden folder so it renders in place.
      // Parent folders are still part of the visible structure; the hidden
      // folder itself is counted separately.
      let node = root
      for (let i = 0; i <= hiddenAt; i++) {
        const name = parts[i]
        if (!node.folders.has(name)) node.folders.set(name, { folders: new Map(), files: [] })
        if (i < hiddenAt) folderPrefixes.add(parts.slice(0, i + 1).join('/'))
        node = node.folders.get(name)!
      }
      continue
    }
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      node.folders.set(name, node.folders.get(name) ?? { folders: new Map(), files: [] })
      folderPrefixes.add(parts.slice(0, i + 1).join('/'))
      node = node.folders.get(name)!
    }
    node.files.push({ name: parts[parts.length - 1], lines: workspaceLines(String(file.content ?? '')) })
  }

  const out: string[] = []
  let chars = 0
  let truncated = false
  let renderedFiles = 0
  const push = (line: string): boolean => {
    if (out.length >= maxEntries || chars + line.length + 1 > maxChars) { truncated = true; return false }
    out.push(line)
    chars += line.length + 1
    return true
  }
  const render = (dir: TreeDir, depth: number, prefix: string) => {
    for (const name of [...dir.folders.keys()].sort()) {
      if (truncated) return
      const childPrefix = prefix ? `${prefix}/${name}` : name
      const hidden = hiddenCounts.get(childPrefix) ?? 0
      const line = hidden
        ? `${'  '.repeat(depth)}${name}/ (contents hidden — ${hidden} file${hidden === 1 ? '' : 's'})`
        : `${'  '.repeat(depth)}${name}/`
      if (!push(line)) return
      if (!hidden) render(dir.folders.get(name)!, depth + 1, childPrefix)
    }
    if (truncated) return
    for (const file of [...dir.files].sort((a, b) => a.name.localeCompare(b.name))) {
      const line = `${'  '.repeat(depth)}${file.name}${file.lines ? ` (${file.lines} line${file.lines === 1 ? '' : 's'})` : ''}`
      if (!push(line)) return
      renderedFiles++
    }
  }
  render(root, 0, '')
  const omittedFiles = Math.max(0, fileCount - renderedFiles)
  if (truncated) out.push(`… ${omittedFiles} more file${omittedFiles === 1 ? '' : 's'} not shown`)
  return {
    text: out.join('\n'),
    fileCount,
    folderCount: folderPrefixes.size,
    hiddenFiles,
    hiddenFolders: hiddenCounts.size,
    truncated,
    omittedFiles,
  }
}

export type UnifiedDiffResult = { diff: string; added: number; removed: number; truncated: boolean }

/** Unified diff text for a file, with `context` unchanged lines around each
 *  hunk and a hard output cap. Added/removed are the full counts. */
export function unifiedDiffFor(
  path: string,
  oldText: string,
  newText: string,
  opts: { context?: number; maxLines?: number } = {},
): UnifiedDiffResult {
  const lines = diffLines(String(oldText ?? ''), String(newText ?? ''))
  const { added, removed } = diffStat(lines)
  if (!added && !removed) return { diff: '', added: 0, removed: 0, truncated: false }
  const context = clampInt(opts.context, 0, 20, 3)
  const maxLines = clampInt(opts.maxLines, 20, 5000, 600)
  const oldNum: number[] = [], newNum: number[] = []
  let ol = 1, nl = 1
  for (let i = 0; i < lines.length; i++) {
    oldNum[i] = ol; newNum[i] = nl
    if (lines[i].type === 'same') { ol++; nl++ }
    else if (lines[i].type === 'del') ol++
    else nl++
  }
  const ranges: [number, number][] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'same') continue
    const last = ranges[ranges.length - 1]
    if (last && i <= last[1] + context * 2 + 1) last[1] = i
    else ranges.push([i, i])
  }
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`]
  let truncated = false
  for (const [first, last] of ranges) {
    const from = Math.max(0, first - context)
    const to = Math.min(lines.length - 1, last + context)
    let oldCount = 0, newCount = 0
    for (let i = from; i <= to; i++) {
      if (lines[i].type !== 'add') oldCount++
      if (lines[i].type !== 'del') newCount++
    }
    const oldStart = oldCount ? oldNum[from] : Math.max(1, oldNum[from] - 1)
    const newStart = newCount ? newNum[from] : Math.max(1, newNum[from] - 1)
    if (out.length + 2 + (to - from + 1) > maxLines) { truncated = true; break }
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (let i = from; i <= to; i++) {
      out.push(`${lines[i].type === 'add' ? '+' : lines[i].type === 'del' ? '-' : ' '}${lines[i].text}`)
    }
  }
  if (truncated) out.push('[diff truncated — the full change is larger than the display cap]')
  return { diff: out.join('\n'), added, removed, truncated }
}

export type PatchResult = { text: string; applied: boolean; added: number; removed: number; error?: string; warnings?: string[] }

type PatchLine = { kind: ' ' | '+' | '-'; text: string }
type PatchHunk = { oldStart?: number; oldCount?: number; newStart?: number; newCount?: number; section?: string; lines: PatchLine[] }

/* Models write patches in several dialects. Unified-diff numbers are useful
 * hints, but they are frequently stale or invented (`@@ -1,1` repeated for
 * changes near the end of a file), so every hunk is located by its content.
 * Accept a standard `@@ -a,b +c,d @@` header, an apply_patch `@@` / `@@ section`
 * header, or no header at all when the body is just -/+ lines. */
const PATCH_HUNK_HEADER = /^@@(?:\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?(?:\s+@@)?)?(?:\s*(.*))?$/
const PATCH_FILE_HEADER = /^\*\*\* (?:Update|Add|Delete) File:\s*(.*?)\s*$/
const PATCH_ENVELOPE = new Set(['*** Begin Patch', '*** End Patch', '*** End of File'])

function parsePatchHunks(diff: string): { hunks: PatchHunk[]; error?: string } {
  // Strip a Markdown fence without trimming the first line: a context line
  // starts with a meaningful space.
  let text = String(diff ?? '').replace(/\r\n?/g, '\n').replace(/^\ufeff/, '').replace(/^\n+/, '')
  // Strip only a column-zero code fence. A context line inside a patch to a
  // Markdown file also starts with backticks, but it begins with a space and
  // must stay part of the hunk.
  text = text.replace(/^```(?:diff|patch)?[ \t]*\n/i, '').replace(/\n```[ \t]*$/i, '').replace(/\n+$/, '')
  if (!text.trim()) return { hunks: [], error: 'Patch is empty. Send a unified diff or -/+ lines.' }
  const raw = text.split('\n')
  const hunks: PatchHunk[] = []
  let cur: PatchHunk | null = null
  let seenHunk = false
  let fileHeader: string | null = null
  const open = (hunk: PatchHunk) => { cur = hunk; hunks.push(hunk); seenHunk = true }
  const add = (kind: PatchLine['kind'], content: string) => {
    if (!cur) open({ lines: [] })
    cur!.lines.push({ kind, text: content })
  }
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]
    const trimmed = line.trim()
    if (PATCH_ENVELOPE.has(trimmed) || /^\*\*\* Move to:/.test(trimmed)) continue
    const file = PATCH_FILE_HEADER.exec(trimmed)
    if (file) {
      const path = file[1]
      if (fileHeader && path && path !== fileHeader) {
        return { hunks: [], error: `Patch changes more than one file (${fileHeader} and ${path}). Send one workspace_upsert call per file.` }
      }
      if (path) fileHeader = path
      continue
    }
    // Only treat these as headers before the first hunk, and only when a hunk
    // really follows. Otherwise `--- comment` / `+++ new` in a plain -/+ body
    // are content, not file headers (a removed `--` comment looks identical).
    if (!seenHunk && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      let j = i + 1
      while (j < raw.length && raw[j].trim() === '') j++
      if (line.startsWith('--- ') && j < raw.length && raw[j].startsWith('+++ ')) j++
      while (j < raw.length && raw[j].trim() === '') j++
      if (j < raw.length && (raw[j].startsWith('@@') || raw[j].startsWith('Index: ') || raw[j].startsWith('diff '))) continue
    }
    if (!seenHunk && (line.startsWith('Index: ') || line.startsWith('diff ') || /^(?:index |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/.test(line))) continue
    if (line.startsWith('\\ ')) continue
    const header = PATCH_HUNK_HEADER.exec(line)
    if (header) {
      const section = (header[5] ?? '').trim()
      open({
        ...(header[1] !== undefined ? { oldStart: Number(header[1]) } : {}),
        ...(header[2] !== undefined ? { oldCount: Number(header[2]) } : {}),
        ...(header[3] !== undefined ? { newStart: Number(header[3]) } : {}),
        ...(header[4] !== undefined ? { newCount: Number(header[4]) } : {}),
        ...(section ? { section } : {}),
        lines: [],
      })
      continue
    }
    // Blank lines inside an apply_patch block are separators, not context. A
    // genuine empty context line is sent as a single space by diff tools.
    if (!line) {
      const next = raw.slice(i + 1).find((x) => x.trim() !== '') ?? ''
      if (!next || next.startsWith('@@') || PATCH_ENVELOPE.has(next.trim()) || PATCH_FILE_HEADER.test(next.trim())) continue
      add(' ', '')
      continue
    }
    const kind = line[0]
    if (kind === ' ' || kind === '+' || kind === '-') { add(kind, line.slice(1)); continue }
    if (!seenHunk) return { hunks: [], error: `No hunks found: include at least one @@ hunk or -/+ line. (Unexpected line: ${line.slice(0, 60)})` }
    return { hunks: [], error: `Unexpected diff line: ${line.slice(0, 80)}` }
  }
  if (!hunks.length) return { hunks: [], error: 'No hunks found: include at least one @@ hunk or -/+ line.' }
  if (!hunks.some((h) => h.lines.some((l) => l.kind === '+' || l.kind === '-'))) {
    return { hunks: [], error: 'No changes found: the patch has no - or + lines.' }
  }
  return { hunks }
}

/** Exact match scores 3, trailing-whitespace match 2, indentation-insensitive
 *  match 1. Zero means the line is not a match. */
const patchLineScore = (a: string, b: string): number => {
  if (a === b) return 3
  if (a.trimEnd() === b.trimEnd()) return 2
  if (a.trim() === b.trim()) return 1
  return 0
}

function findPatchMatch(lines: string[], old: string[], expected: number, preferAfter: number): { at: number; exact: boolean; matches: number } | null {
  const matches: { at: number; score: number; exact: boolean }[] = []
  for (let at = 0; at + old.length <= lines.length; at++) {
    let score = 0
    let ok = true
    for (let k = 0; k < old.length; k++) {
      const s = patchLineScore(lines[at + k], old[k])
      if (!s) { ok = false; break }
      score += s
    }
    if (ok) matches.push({ at, score, exact: score === old.length * 3 })
  }
  if (!matches.length) return null
  // Bare hunks have no meaningful line number; prefer the first match after
  // the previous hunk so a repeated line is not patched twice.
  const after = preferAfter > 0 ? matches.filter((m) => m.at >= preferAfter) : matches
  const pool = after.length ? after : matches
  pool.sort((a, b) =>
    Number(b.exact) - Number(a.exact) ||
    b.score - a.score ||
    Math.abs(a.at - expected) - Math.abs(b.at - expected) ||
    a.at - b.at,
  )
  return { at: pool[0].at, exact: pool[0].exact, matches: matches.length }
}

function patchMismatchHint(lines: string[], old: string[]): string {
  const needle = old.find((l) => l.trim())
  if (!needle) return 'The hunk has no usable context; include at least one unchanged or removed line.'
  let best = -1, bestScore = 0
  for (let i = 0; i < lines.length; i++) {
    const score = patchLineScore(lines[i], needle)
    if (score > bestScore) { best = i; bestScore = score }
  }
  if (best >= 0) return `The closest current line is line ${best + 1}: ${JSON.stringify(lines[best].slice(0, 140))}.`
  return 'Read the current file with action read and copy its exact lines, or use action update to replace the whole file.'
}

/** Apply a unified diff to base text. Hunks are located by content, so stale
 *  or invented line numbers do not reject a correct patch; standard unified
 *  diffs, apply_patch (`*** Begin Patch` / bare `@@`) blocks and plain -/+
 *  bodies are all accepted. Never throws. */
export function applyUnifiedDiff(base: string, diff: string): PatchResult {
  const fail = (error: string): PatchResult => ({ text: String(base ?? ''), applied: false, added: 0, removed: 0, error })
  const parsed = parsePatchHunks(diff)
  if (parsed.error) return fail(parsed.error)
  const source = String(base ?? '')
  const crlf = /\r\n/.test(source)
  const out = source.replace(/\r\n?/g, '\n').split('\n')
  let added = 0, removed = 0, drift = 0, cursor = 0
  const warnings: string[] = []
  for (const hunk of parsed.hunks) {
    const old = hunk.lines.filter((l) => l.kind !== '+').map((l) => l.text)
    let at: number
    if (!old.length) {
      if (hunk.oldStart !== undefined) {
        // A zero-old-count hunk is a pure insertion after old line a.
        at = hunk.oldCount === 0 ? hunk.oldStart + drift : hunk.oldStart - 1 + drift
      } else if (hunk.section) {
        const found = out.findIndex((line, index) => index >= cursor && line.includes(hunk.section!))
        if (found < 0) return fail(`Insertion anchor "${hunk.section.slice(0, 60)}" was not found. Include the unchanged line the new lines go after.`)
        at = found + 1
      } else {
        // Guessing where an unanchored insertion belongs is how a patch quietly
        // corrupts a file. Ask for context instead.
        return fail('This hunk only adds lines and has nothing to place them after. Include the unchanged or removed lines around the insertion, or use action update.')
      }
    } else {
      const expected = hunk.oldStart !== undefined ? hunk.oldStart - 1 + drift : cursor
      const found = findPatchMatch(out, old, expected, hunk.oldStart === undefined ? cursor : 0)
      if (!found) return fail(`${hunk.oldStart !== undefined ? `Hunk at old line ${hunk.oldStart}` : 'A hunk'} does not match the current file. ${patchMismatchHint(out, old)}`)
      at = found.at
      if (found.matches > 1) warnings.push(`A hunk matched ${found.matches} places; applied at line ${at + 1}. Read the file to verify the change.`)
    }
    at = Math.max(0, Math.min(out.length, at))
    let addedHere = 0, removedHere = 0
    for (const l of hunk.lines) {
      if (l.kind === ' ') at++
      else if (l.kind === '-') { out.splice(at, 1); removedHere++ }
      else { out.splice(at, 0, l.text); addedHere++; at++ }
    }
    added += addedHere
    removed += removedHere
    drift += addedHere - removedHere
    cursor = at
  }
  const text = out.join('\n')
  return {
    text: crlf ? text.replace(/\n/g, '\r\n') : text,
    applied: true, added, removed,
    ...(warnings.length ? { warnings: warnings.slice(0, 3) } : {}),
  }
}

/** Strip scripts, frames, objects, event handlers and javascript: URLs so
 *  model- or user-supplied HTML is safe inside a sandboxed preview iframe.
 *  Belt and braces: the iframe is sandboxed with no allow flags regardless. */
export function sanitizeHtmlPreview(html: string): string {
  let s = String(html ?? '')
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<\/?(?:object|embed|applet|form|input|button|textarea|select|option|meta|link|base|title)[^>]*>/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = s.replace(/(href|src|xlink:href)\s*=\s*("|')\s*javascript:[^"']*(")/gi, '$1=$2#$3')
  s = s.replace(/(href|src)\s*=\s*javascript:[^\s>]+/gi, '$1="#"')
  return s
}

const PREVIEWABLE_HTML = new Set(['html', 'htm', 'xhtml', 'svg'])
const PREVIEWABLE_MD = new Set(['md', 'markdown'])
const PREVIEWABLE_CSV = new Set(['csv', 'tsv'])

export type PreviewKind = 'code' | 'html' | 'svg' | 'markdown' | 'csv'

/** Which rich preview a file gets (code is the universal fallback). */
export function previewKindFor(path: string, language: string): PreviewKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const lang = (language || '').toLowerCase()
  if (ext === 'svg' || lang === 'svg') return 'svg'
  if (PREVIEWABLE_HTML.has(ext) || (lang === 'html' && !ext)) return 'html'
  if (PREVIEWABLE_MD.has(ext) || lang === 'markdown' || lang === 'md') return 'markdown'
  if (PREVIEWABLE_CSV.has(ext)) return 'csv'
  return 'code'
}

/* ----------------------------------------------------------------------------
 * Syntax highlighting language resolution for the workspace code view.
 * The viewer renders code as a fenced markdown block through
 * rehype-highlight (highlight.js via lowlight `all`, ~190 grammars), so the
 * fence tag must be a canonical lowlight language id. Models often omit
 * `language` or send aliases ("js", "py", "sh"), so resolve in order:
 * explicit language (normalized) -> filename/extension -> plaintext.
 * ---------------------------------------------------------------------------- */

/** Aliases models commonly send, mapped to canonical lowlight ids. */
const HIGHLIGHT_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', mts: 'typescript',
  cts: 'typescript', tsx: 'typescript', ts: 'typescript',
  py: 'python', pyw: 'python', gyp: 'python',
  rb: 'ruby', erb: 'erb',
  sh: 'shell', bash: 'bash', zsh: 'bash', fish: 'shell', shell: 'shell', console: 'bash',
  ps1: 'powershell', psm1: 'powershell', powershell: 'powershell', bat: 'dos', cmd: 'dos',
  yml: 'yaml', yaml: 'yaml', toml: 'ini',
  md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown',
  htm: 'xml', html: 'xml', xhtml: 'xml', vue: 'xml', svelte: 'xml', astro: 'xml', wxml: 'xml',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', 'c++': 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  'c#': 'csharp', 'c-sharp': 'csharp', cs: 'csharp', csx: 'csharp',
  m: 'objectivec', mm: 'objectivec',
  kt: 'kotlin', kts: 'kotlin', ktscript: 'kotlin',
  rs: 'rust', go: 'go', swift: 'swift',
  java: 'java', scala: 'scala', groovy: 'groovy', gradle: 'gradle',
  php: 'php', pl: 'perl', pm: 'perl', perl: 'perl', r: 'r', jl: 'julia',
  lua: 'lua', dart: 'dart', elm: 'elm', ex: 'elixir', exs: 'elixir', elixir: 'elixir',
  erl: 'erlang', hrl: 'erlang', clj: 'clojure', cljs: 'clojure', cljc: 'clojure',
  hs: 'haskell', ml: 'ocaml', mli: 'ocaml', fs: 'fsharp', fsi: 'fsharp', fsx: 'fsharp',
  pas: 'delphi', dpr: 'delphi', pp: 'delphi', d: 'd',
  sql: 'sql', pgsql: 'pgsql', postgres: 'pgsql', mysql: 'sql', graphql: 'graphql', gql: 'graphql',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', styl: 'stylus', stylus: 'stylus',
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json', geojson: 'json', ndjson: 'json',
  jsmap: 'json', tsmap: 'json',
  diff: 'diff', patch: 'diff',
  tex: 'latex', latex: 'latex', sty: 'latex', bib: 'latex',
  vim: 'vim', vimrc: 'vim', nvim: 'vim',
  asm: 'x86asm', s: 'x86asm', nasm: 'x86asm', yasm: 'x86asm', arm: 'armasm',
  vb: 'vbnet', vba: 'vbnet', vbs: 'vbscript',
  f90: 'fortran', f95: 'fortran', f03: 'fortran', fortran: 'fortran',
  cob: 'cobol', cbl: 'cobol', cobol: 'cobol',
  adb: 'ada', ads: 'ada', ada: 'ada',
  sol: 'javascript', hcl: 'ini', tf: 'ini', tfvars: 'ini',
  proto: 'protobuf', protobuf: 'protobuf',
  thrift: 'thrift', avro: 'json', capnp: 'capnproto',
  cmake: 'cmake', make: 'makefile', mk: 'makefile', makefile: 'makefile',
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  nginx: 'nginx', apache: 'apache', htaccess: 'apache',
  ini: 'ini', cfg: 'ini', conf: 'ini', config: 'ini', properties: 'properties',
  env: 'properties', gitignore: 'plaintext', dockerignore: 'plaintext',
  txt: 'plaintext', text: 'plaintext', log: 'plaintext',
  csv: 'plaintext', tsv: 'plaintext',
  svg: 'xml', wsdl: 'xml', xsd: 'xml', rss: 'xml', atom: 'xml', plist: 'xml',
  wasm: 'wasm', wat: 'wasm',
  glsl: 'glsl', vert: 'glsl', frag: 'glsl', wgsl: 'glsl', hlsl: 'glsl',
  nix: 'nix', star: 'python', bazel: 'python', bzl: 'python',
  octave: 'matlab', matlab: 'matlab',
  awk: 'awk', sed: 'bash', tcl: 'tcl', expect: 'tcl',
  lisp: 'lisp', scm: 'scheme', ss: 'scheme', scheme: 'scheme', rkt: 'scheme',
  smalltalk: 'smalltalk', st: 'smalltalk',
  pro: 'prolog', prolog: 'prolog',
  v: 'verilog', sv: 'verilog', svh: 'verilog', vhd: 'vhdl', vhdl: 'vhdl',
  zig: 'c', nim: 'nim', crystal: 'crystal',
  coffee: 'coffeescript', litcoffee: 'coffeescript', iced: 'coffeescript',
  ls: 'livescript', reason: 'reasonml', res: 'reasonml', resi: 'reasonml', re: 'reasonml',
  purs: 'haskell',
  flow: 'javascript', ejs: 'django', hbs: 'handlebars', handlebars: 'handlebars',
  mustache: 'django', njk: 'django', nunjucks: 'django', twig: 'twig', liquid: 'django',
  pug: 'xml', jade: 'xml',
  rss2: 'xml', adoc: 'asciidoc', asciidoc: 'asciidoc', rst: 'plaintext',
  http: 'http', https: 'http', rest: 'http',
  gqlgen: 'graphql',
  cshtml: 'xml', razor: 'xml',
  ktm: 'kotlin', klib: 'kotlin',
  ipynb: 'json', har: 'json',
  lock: 'json', map: 'json',
  cucumber: 'gherkin', feature: 'gherkin', gherkin: 'gherkin',
  arduino: 'arduino', ino: 'arduino', pde: 'arduino',
}

/** File extension (no dot, lowercase) -> canonical lowlight id. */
const EXTENSION_HIGHLIGHT: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', flow: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json', geojson: 'json', ndjson: 'json',
  map: 'json', har: 'json', ipynb: 'json', jsonld: 'json',
  html: 'xml', htm: 'xml', xhtml: 'xml', vue: 'xml', svelte: 'xml', astro: 'xml',
  svg: 'xml', xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', wsdl: 'xml', plist: 'xml',
  atom: 'xml', rss: 'xml', cshtml: 'xml', wxml: 'xml', axml: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', styl: 'stylus', stylus: 'stylus',
  md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown',
  py: 'python', pyw: 'python', pyi: 'python', gyp: 'python', gypi: 'python', bzl: 'python',
  rb: 'ruby', erb: 'erb', rake: 'ruby', gemspec: 'ruby',
  php: 'php', phtml: 'php', php3: 'php', php4: 'php', php5: 'php', phps: 'php',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', sc: 'scala',
  groovy: 'groovy', gradle: 'gradle',
  go: 'go', rs: 'rust', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  hh: 'cpp', hxx: 'cpp', inl: 'cpp', ipp: 'cpp',
  cs: 'csharp', csx: 'csharp',
  m: 'objectivec', mm: 'objectivec',
  swift: 'swift', dart: 'dart',
  lua: 'lua', pl: 'perl', pm: 'perl', t: 'perl',
  r: 'r', jl: 'julia',
  sh: 'bash', bash: 'bash', zsh: 'bash', ksh: 'bash', dash: 'bash', fish: 'shell',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'dos', cmd: 'dos',
  sql: 'sql', pgsql: 'pgsql', mysql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', config: 'ini', properties: 'properties',
  env: 'properties',
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  makefile: 'makefile', mk: 'makefile', mak: 'makefile',
  cmake: 'cmake', 'cmake.in': 'cmake',
  nginx: 'nginx', apache: 'apache',
  diff: 'diff', patch: 'diff',
  tex: 'latex', latex: 'latex', sty: 'latex', bib: 'latex', cls: 'latex',
  vim: 'vim', vimrc: 'vim',
  asm: 'x86asm', s: 'x86asm', nasm: 'x86asm', yasm: 'x86asm',
  vb: 'vbnet', vba: 'vbnet', vbs: 'vbscript',
  f: 'fortran', f90: 'fortran', f95: 'fortran', f03: 'fortran', f08: 'fortran', for: 'fortran', ftn: 'fortran',
  cob: 'cobol', cbl: 'cobol', ccp: 'cobol',
  adb: 'ada', ads: 'ada',
  sol: 'javascript', hcl: 'ini', tf: 'ini', tfvars: 'ini',
  proto: 'protobuf', thrift: 'thrift', avdl: 'json', avsc: 'json',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hrl: 'erlang',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure',
  hs: 'haskell', lhs: 'haskell', ml: 'ocaml', mli: 'ocaml', fs: 'fsharp', fsi: 'fsharp', fsx: 'fsharp',
  pas: 'delphi', dpr: 'delphi', pp: 'delphi',
  awk: 'awk', tcl: 'tcl', expect: 'tcl',
  lisp: 'lisp', lsp: 'lisp', scm: 'scheme', ss: 'scheme', rkt: 'scheme',
  st: 'smalltalk', pro: 'prolog',
  v: 'verilog', sv: 'verilog', svh: 'verilog', vhd: 'vhdl', vhdl: 'vhdl',
  zig: 'c', nim: 'nim', nims: 'nim',
  coffee: 'coffeescript', litcoffee: 'coffeescript', ls: 'livescript',
  re: 'reasonml', res: 'reasonml', resi: 'reasonml',
  pug: 'xml', jade: 'xml', hbs: 'handlebars',
  twig: 'twig', ejs: 'django', njk: 'django',
  feature: 'gherkin',
  ino: 'arduino', pde: 'arduino',
  glsl: 'glsl', vert: 'glsl', frag: 'glsl', geom: 'glsl', comp: 'glsl', wgsl: 'glsl', hlsl: 'glsl',
  nix: 'nix', http: 'http', rest: 'http',
  csv: 'plaintext', tsv: 'plaintext', txt: 'plaintext', text: 'plaintext', log: 'plaintext',
  gitignore: 'plaintext', dockerignore: 'plaintext', editorconfig: 'plaintext',
  wasm: 'wasm', wat: 'wasm',
  cql: 'sql', hql: 'sql',
  qml: 'qml', sqf: 'sqf',
  cr: 'crystal',
}

/** Basenames without a useful extension -> canonical lowlight id. */
const FILENAME_HIGHLIGHT: Record<string, string> = {
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  makefile: 'makefile', gnumakefile: 'makefile', cmakelists: 'cmake',
  gemfile: 'ruby', rakefile: 'ruby', vagrantfile: 'ruby', podfile: 'ruby', fastfile: 'ruby',
  cmakecache: 'cmake',
  '.bashrc': 'bash', '.bash_profile': 'bash', '.zshrc': 'bash', '.profile': 'bash',
  '.vimrc': 'vim', '.gvimrc': 'vim', vimrc: 'vim',
  '.gitignore': 'plaintext', '.dockerignore': 'plaintext', '.editorconfig': 'plaintext',
}

/** Normalize a model- or user-supplied language tag to a lowlight id. */
export function normalizeHighlightLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase().replace(/^\./, '')
  if (!t) return null
  if (HIGHLIGHT_ALIASES[t]) return HIGHLIGHT_ALIASES[t]
  // Already canonical (letters, digits, +, #, -)? Keep as-is; rehype-highlight
  // ignores unknown ids (ignoreMissing) so pass-through is safe.
  if (/^[a-z0-9+#-]+$/.test(t)) return t
  return null
}

/** Fence-tag language for the workspace code view: explicit tag wins, else
 *  filename/extension inference, else plaintext (never empty). */
export function highlightLanguageFor(path: string, language: unknown): string {
  const explicit = normalizeHighlightLanguage(language)
  if (explicit) return explicit
  const base = String(path ?? '').split('/').pop() ?? ''
  const lower = base.toLowerCase()
  if (FILENAME_HIGHLIGHT[lower]) return FILENAME_HIGHLIGHT[lower]
  const noDot = lower.startsWith('.') ? lower.slice(1) : lower
  if (FILENAME_HIGHLIGHT[noDot]) return FILENAME_HIGHLIGHT[noDot]
  // Basename without extension but known (e.g. "Dockerfile.dev", "Makefile.am").
  const stem = lower.split('.')[0]
  if (FILENAME_HIGHLIGHT[stem]) return FILENAME_HIGHLIGHT[stem]
  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  if (ext && EXTENSION_HIGHLIGHT[ext]) return EXTENSION_HIGHLIGHT[ext]
  if (ext && HIGHLIGHT_ALIASES[ext]) return HIGHLIGHT_ALIASES[ext]
  return 'plaintext'
}

/** Minimal CSV/TSV parse for the table preview (quotes + delimiter aware). */
export function parseCsvPreview(text: string, maxRows = 200, maxCols = 20): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quote = false
  const src = String(text ?? '')
  const delim = (src.split('\n')[0] ?? '').includes('\t') ? '\t' : ','
  for (let i = 0; i < src.length && rows.length < maxRows; i++) {
    const c = src[i]
    if (quote) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ }
        else quote = false
      } else cell += c
    } else if (c === '"') quote = true
    else if (c === delim) { row.push(cell); cell = ''; if (row.length >= maxCols) { row.push('…'); } }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim()) && rows.length < maxRows) rows.push(row)
  return rows.map((r) => r.slice(0, maxCols + 1))
}

/* ---- Project templates: fixed starter file sets the model can scaffold
 *  in one call (template: '<id>' + createNew). Listed in Settings so users
 *  can ask for them by name. Contents stay small and dependency-free. ---- */

export type WorkspaceTemplate = { id: string; name: string; description: string; files: { path: string; language: string; content: string }[] }

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'static-site',
    name: 'Static site',
    description: 'Single-page site with separated markup, styles and script.',
    files: [
      { path: 'index.html', language: 'html', content: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>Untitled</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n  <main>\n    <h1>Hello</h1>\n    <p>Edit me.</p>\n    <button id="btn">Click</button>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>\n' },
      { path: 'styles.css', language: 'css', content: ':root { color-scheme: light dark; }\nbody { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.6; }\nmain { max-width: 40rem; margin: 0 auto; }\n' },
      { path: 'app.js', language: 'javascript', content: "document.getElementById('btn')?.addEventListener('click', () => {\n  alert('Hello!');\n});\n" },
    ],
  },
  {
    id: 'python-script',
    name: 'Python script',
    description: 'CLI skeleton with argparse and a requirements file.',
    files: [
      { path: 'main.py', language: 'python', content: '"""Entry point. Run with: python main.py --name Ada"""\n\nimport argparse\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description="Describe what this does.")\n    parser.add_argument("--name", default="world")\n    args = parser.parse_args()\n    print(f"Hello, {args.name}!")\n\n\nif __name__ == "__main__":\n    main()\n' },
      { path: 'requirements.txt', language: 'text', content: '# Add dependencies here, one per line.\n' },
      { path: 'README.md', language: 'markdown', content: '# Project\n\nRun with:\n\n```sh\npython main.py --name Ada\n```\n' },
    ],
  },
  {
    id: 'markdown-notes',
    name: 'Markdown notes',
    description: 'Dated notes vault with an index page.',
    files: [
      { path: 'index.md', language: 'markdown', content: '# Notes\n\n- [Inbox](inbox.md)\n- [Ideas](ideas.md)\n' },
      { path: 'inbox.md', language: 'markdown', content: '# Inbox\n\n- \n' },
      { path: 'ideas.md', language: 'markdown', content: '# Ideas\n\n## \n\n\n' },
    ],
  },
]

export const templateById = (id: string): WorkspaceTemplate | null => {
  const t = WORKSPACE_TEMPLATES.find((x) => x.id === String(id || '').trim().toLowerCase())
  return t ?? null
}

/* ---- Stateful workspace application (pure — the store is a thin wrapper).
 *  Applies one workspace_upsert call (a single file operation + optional
 *  template scaffold) and returns the next workspaces map, the
 *  selected revision id, and the tool result payload. Throws on any invalid
 *  input; callers surface the message. Same-message calls fold into one
 *  revision; otherwise a new revision is appended. */

export type WorkspaceFileOp = { action: string; path: string; language?: string; content?: string; to?: string }

export type WorkspaceCallInput = {
  workspaceId?: string
  createNew?: boolean
  workspaceName?: string
  /** Required for actions that change files; ignored by inspections. */
  revisionName?: string
  action: string
  path?: string
  language?: string
  content?: string
  template?: string
  /** read: 1-based inclusive line window. */
  startLine?: number
  endLine?: number
  /** search */
  query?: string
  regex?: boolean
  caseSensitive?: boolean
  glob?: string
  contextLines?: number
  maxResults?: number
  /** move / diff */
  to?: string
  against?: string
  /** patch: return the diff without saving anything. */
  dryRun?: boolean
}

export type WorkspaceCallResult = {
  workspaceId: string
  path: string
  action: string
  revisionName?: string
  changes: string[]
  scaffolded?: number
  /** The paths the workspace holds after a write, so the model can see what
   *  already exists before it writes the next file. Inspections omit it (they
   *  return their own, smaller result). */
  files?: string[]
  fileCount: number
  /** read */
  content?: string
  lines?: number
  startLine?: number
  endLine?: number
  returnedLines?: number
  hasMore?: boolean
  nextStartLine?: number
  note?: string
  /** list */
  tree?: string
  matchedFiles?: number
  folderCount?: number
  hiddenFiles?: number
  /** search */
  query?: string
  matches?: WorkspaceMatch[]
  matchCount?: number
  totalMatches?: number
  filesMatched?: number
  filesSearched?: number
  /** diff */
  diff?: string
  added?: number
  removed?: number
  against?: string
  dryRun?: boolean
  /** move */
  to?: string
  truncated?: boolean
}

const truncSuffixRe = WORKSPACE_TRUNC_RE

/** A write that would exceed the per-file limit is refused, not stored cut:
 *  a truncated file is corrupt, and the model must split it into modules. */
const oversizeError = (p: string, chars: number) => Error(
  `${p} would be ${chars.toLocaleString()} characters, over the ${WORKSPACE_MAX_CONTENT.toLocaleString()}-character per-file limit. Split it into smaller modules and write each file separately (or shorten it); nothing was stored.`,
)

function applyOneFileOp(files: WorkspaceFile[], op: WorkspaceFileOp): { files: WorkspaceFile[]; note: string } {
  const p = sanitizePath(op.path)
  if (!p || p === 'file.txt') throw Error('path resolved to an invalid or empty name after sanitization')
  if (op.action === 'delete') {
    if (!files.some((f) => f.path === p)) throw Error(`File not found for delete: ${p}`)
    return { files: files.filter((f) => f.path !== p), note: `${p} deleted` }
  }
  if (op.action === 'move') {
    const to = sanitizePath(op.to ?? '')
    if (!String(op.to ?? '').trim()) throw Error('move needs "to": the new path for the file.')
    if (!files.some((f) => f.path === p)) throw Error(`File not found for move: ${p}`)
    if (to === p) throw Error(`move needs a different path: ${p} is already there.`)
    if (files.some((f) => f.path === to)) throw Error(`A file already exists at ${to}. Delete it or choose another path.`)
    return { files: files.map((f) => (f.path === p ? { ...f, path: to } : f)), note: `${p} moved to ${to}` }
  }
  // A create/update without a content string used to blank the file (a
  // truncated stream or a forgotten argument silently wiped it).
  if ((op.action === 'create' || op.action === 'update') && typeof op.content !== 'string') {
    throw Error(`Missing content for the "${op.action}" action on ${p}. Send the file body as a string.`)
  }
  if (op.action === 'continue') {
    const existing = files.find((f) => f.path === p)
    if (!existing) throw Error(`File not found for continue: ${p}`)
    // Strip either the current or the old marker first, so continuing a file
    // cut by an earlier version appends after its real text. The total must fit
    // the limit; a continue cannot grow past it.
    const appended = existing.content.replace(truncSuffixRe, '') + (op.content ?? '')
    if (appended.length > WORKSPACE_MAX_CONTENT) throw oversizeError(p, appended.length)
    return { files: files.map((f) => (f.path === p ? { ...f, content: appended, truncated: false } : f)), note: `${p} continued` }
  }
  if (op.action === 'patch') {
    const existing = files.find((f) => f.path === p)
    if (!existing) throw Error(`File not found for patch: ${p}. Use create with full content for new files.`)
    // Patching an incomplete file would leave the truncation marker in the
    // middle of the result. Finish or replace it first.
    if (existing.truncated === true || isTruncatedContent(existing.content)) {
      throw Error(`File is incomplete: ${p} was cut at the per-file limit. Finish it with action "continue" (the missing text only) or replace it with action "update", then patch it.`)
    }
    const patched = applyUnifiedDiff(existing.content, op.content ?? '')
    if (!patched.applied) throw Error(`Patch rejected for ${p}: ${patched.error}\nRead the current file with action "read" if you need the exact text, then retry with only the changed lines.`)
    if (patched.text.length > WORKSPACE_MAX_CONTENT) throw oversizeError(p, patched.text.length)
    const warning = patched.warnings?.length ? ` (${patched.warnings.join(' ')})` : ''
    return { files: files.map((f) => (f.path === p ? { ...f, content: patched.text, language: op.language ?? f.language, truncated: false } : f)), note: `${p} patched (+${patched.added}/-${patched.removed})${warning}` }
  }
  const body = op.content ?? ''
  if (body.length > WORKSPACE_MAX_CONTENT) throw oversizeError(p, body.length)
  const at = files.findIndex((f) => f.path === p)
  if (at >= 0) {
    return { files: files.map((f, i) => (i === at ? { ...f, content: body, language: op.language ?? f.language, truncated: false } : f)), note: `${p} updated` }
  }
  return { files: [...files, { path: p, language: op.language ?? '', content: body, truncated: false }], note: `${p} created` }
}

export function applyWorkspaceCall(
  workspaces: Record<string, Workspace>,
  input: WorkspaceCallInput,
  ctx: { msgId: string; uid: () => string; now?: number },
): { workspaces: Record<string, Workspace>; selectedRevisionId: string; result: WorkspaceCallResult } {
  const now = ctx.now ?? Date.now()
  const action = String(input.action ?? '')
  if (!(WORKSPACE_ACTIONS as readonly string[]).includes(action)) {
    throw Error(`action must be one of: ${WORKSPACE_ACTIONS.join(', ')}`)
  }
  let next = { ...workspaces }
  let targetId = input.workspaceId
  let scaffolded = 0

  /* ---- Inspections: never create a workspace, a revision or a file. ---- */
  if (isWorkspaceReadAction(action)) {
    if (input.template) throw Error(`template cannot be used with action ${action}.`)
    if (input.createNew || !targetId) throw Error(`action ${action} needs an existing workspaceId.`)
    const readWorkspace = next[targetId]
    if (!readWorkspace) throw Error(`Workspace not found: ${targetId}`)
    const latestRead = readWorkspace.revisions[readWorkspace.revisions.length - 1]
    const files = latestRead?.files ?? []
    const base = {
      workspaceId: targetId,
      action: action === 'list' ? 'listed' : action === 'search' ? 'searched' : action === 'diff' ? 'diffed' : 'read',
      changes: [] as string[],
      fileCount: files.length,
    }

    if (action === 'list') {
      const filtered = files.filter((f) => workspacePathMatches(f.path, { path: input.path, glob: input.glob }))
      const tree = workspaceTree(filtered, { maxEntries: 150, maxChars: 8000 })
      return {
        workspaces,
        selectedRevisionId: latestRead?.id ?? '',
        result: {
          ...base,
          path: folderPrefix(input.path),
          tree: tree.text || '(no files match this filter)',
          matchedFiles: filtered.length,
          folderCount: tree.folderCount,
          hiddenFiles: tree.hiddenFiles,
          ...(tree.truncated ? { truncated: true } : {}),
        },
      }
    }

    if (action === 'search') {
      const found = searchWorkspaceFiles(files, String(input.query ?? ''), {
        regex: input.regex === true,
        caseSensitive: input.caseSensitive === true,
        path: input.path,
        glob: input.glob,
        contextLines: input.contextLines,
        maxResults: input.maxResults,
      })
      return {
        workspaces,
        selectedRevisionId: latestRead?.id ?? '',
        result: {
          ...base,
          path: folderPrefix(input.path),
          query: found.query,
          matches: found.matches,
          matchCount: found.matchCount,
          totalMatches: found.totalMatches,
          filesMatched: found.filesMatched,
          filesSearched: found.filesSearched,
          ...(found.truncated ? { truncated: true } : {}),
        },
      }
    }

    if (!latestRead) throw Error(`Workspace has no files yet: ${targetId}`)
    if (!String(input.path ?? '').trim()) throw Error(`path is required for action ${action}.`)
    const wanted = sanitizePath(input.path ?? '')
    const file = latestRead.files.find((f) => f.path === wanted)
    if (!file) {
      const available = latestRead.files.map((f) => f.path).slice(-20)
      throw Error(`File not found for ${action}: ${wanted}${available.length ? `. Available files: ${available.join(', ')}` : ''}`)
    }

    if (action === 'read') {
      const truncatedFile = file.truncated === true || isTruncatedContent(file.content)
      const range = readWorkspaceRange(file.content, { startLine: input.startLine, endLine: input.endLine })
      const rangeText = range.startLine === range.endLine
        ? `line ${range.startLine}`
        : `lines ${range.startLine}–${range.endLine}`
      const note = range.totalLines === 0
        ? 'The file is empty.'
        : range.hasMore
          ? `Showing ${rangeText} of ${range.totalLines}. Call read again with startLine ${range.nextStartLine} for the rest.`
          : range.startLine === 1
            ? `Whole file: ${range.totalLines} line${range.totalLines === 1 ? '' : 's'}.`
            : `${rangeText[0].toUpperCase()}${rangeText.slice(1)} of ${range.totalLines}.`
      return {
        workspaces,
        selectedRevisionId: latestRead.id,
        result: {
          ...base,
          path: file.path,
          content: range.text,
          lines: range.totalLines,
          startLine: range.startLine,
          endLine: range.endLine,
          returnedLines: range.returnedLines,
          hasMore: range.hasMore,
          ...(range.nextStartLine ? { nextStartLine: range.nextStartLine } : {}),
          note: `${note}${truncatedFile ? ' This file is incomplete: it was cut at the per-file limit. Finish it with action "continue" or replace it with "update".' : ''}`,
          ...(truncatedFile ? { truncated: true } : {}),
        },
      }
    }

    // diff: current file against a previous revision (default), another file,
    // or a proposed body that has not been saved.
    let oldText = ''
    let newText = file.content
    let against = ''
    if (typeof input.content === 'string') {
      oldText = file.content
      newText = input.content
      against = 'proposed content'
    } else if (String(input.against ?? '').trim()) {
      const otherPath = sanitizePath(input.against ?? '')
      const other = latestRead.files.find((f) => f.path === otherPath)
      if (!other) throw Error(`File not found for diff against: ${otherPath}. Available files: ${latestRead.files.slice(0, 20).map((f) => f.path).join(', ')}`)
      oldText = other.content
      against = other.path
    } else {
      const revIndex = readWorkspace.revisions.indexOf(latestRead)
      let previous: WorkspaceRevision | undefined
      for (let i = revIndex - 1; i >= 0; i--) {
        if (readWorkspace.revisions[i].files.some((f) => f.path === file.path)) { previous = readWorkspace.revisions[i]; break }
      }
      if (!previous) {
        return {
          workspaces,
          selectedRevisionId: latestRead.id,
          result: { ...base, path: file.path, diff: '', added: 0, removed: 0, against: 'no earlier version', note: 'This file has only one version. Pass against (another path) or content (a proposed version) to compare.' },
        }
      }
      oldText = previous.files.find((f) => f.path === file.path)!.content
      against = `revision "${previous.name}"`
    }
    const unified = unifiedDiffFor(file.path, oldText, newText)
    return {
      workspaces,
      selectedRevisionId: latestRead.id,
      result: {
        ...base,
        path: file.path,
        diff: unified.diff,
        added: unified.added,
        removed: unified.removed,
        against,
        ...(unified.diff ? {} : { note: `No differences between ${file.path} and ${against}.` }),
        ...(unified.truncated ? { truncated: true } : {}),
      },
    }
  }

  /* ---- Writes ---- */
  if (!String(input.path ?? '').trim()) throw Error(`path is required for action ${action}.`)
  const revisionName = String(input.revisionName ?? '').trim()
  if (!revisionName) throw Error(`revisionName is required to ${action} a file (a short label such as "Add auth form").`)
  const safeName = revisionName.slice(0, 200)
  if (input.createNew || !targetId) {
    if (!input.workspaceName) throw Error('workspaceName required when createNew:true')
    targetId = ctx.uid()
    next[targetId] = { id: targetId, name: input.workspaceName, revisions: [] }
    if (input.template) {
      const tpl = templateById(input.template)
      if (!tpl) throw Error(`Unknown template: ${input.template}. Available: ${WORKSPACE_TEMPLATES.map((t) => t.id).join(', ')}.`)
      next[targetId] = {
        ...next[targetId],
        revisions: [{
          id: ctx.uid(),
          name: `Scaffold: ${tpl.name}`,
          msgId: ctx.msgId,
          files: tpl.files.map((f) => ({ path: sanitizePath(f.path), language: f.language, content: f.content })),
          createdAt: now,
        }],
      }
      scaffolded = tpl.files.length
    }
  } else if (!next[targetId]) {
    throw Error(`Workspace not found: ${input.workspaceId}`)
  } else if (input.template) {
    throw Error('template is only used with createNew:true (it scaffolds a fresh workspace).')
  }

  const ws = next[targetId]!
  const latest = ws.revisions[ws.revisions.length - 1]
  const sameMessage = latest?.msgId === ctx.msgId
  let files = sameMessage ? latest.files : (latest?.files ?? [])

  // A dry-run patch proves the diff applies and shows the result without
  // touching the workspace or adding a revision. This is the safe way to
  // preview a risky edit before committing it.
  if (action === 'patch' && input.dryRun === true) {
    const p = sanitizePath(input.path ?? '')
    const existing = files.find((f) => f.path === p)
    if (!existing) throw Error(`File not found for patch: ${p}. Use create with full content for new files.`)
    const patched = applyUnifiedDiff(existing.content, input.content ?? '')
    if (!patched.applied) throw Error(`Patch rejected for ${p}: ${patched.error}\nRead the current file with action "read" if you need the exact text, then retry with only the changed lines.`)
    const unified = unifiedDiffFor(p, existing.content, patched.text)
    return {
      workspaces,
      selectedRevisionId: latest?.id ?? '',
      result: {
        workspaceId: targetId,
        path: p,
        action: 'diffed',
        changes: [`${p} would be patched (+${patched.added}/-${patched.removed})`],
        fileCount: files.length,
        diff: unified.diff,
        added: unified.added,
        removed: unified.removed,
        dryRun: true,
        ...(patched.warnings?.length ? { note: patched.warnings.join(' ') } : {}),
      },
    }
  }

  const notes: string[] = []
  {
    const r = applyOneFileOp(files, { action, path: input.path ?? '', language: input.language, content: input.content, to: input.to })
    files = r.files
    notes.push(r.note)
  }

  let revision: WorkspaceRevision
  let revisions: WorkspaceRevision[]
  if (sameMessage) {
    revision = { ...latest!, name: safeName, files, createdAt: now }
    revisions = ws.revisions.slice(0, -1).concat(revision)
  } else {
    revision = { id: ctx.uid(), name: safeName, msgId: ctx.msgId, files, createdAt: now }
    revisions = [...ws.revisions, revision]
  }
  next[targetId] = { ...ws, revisions }
  return {
    workspaces: next,
    selectedRevisionId: revision.id,
    result: {
      workspaceId: targetId,
      path: sanitizePath(input.path ?? ''),
      action: action === 'delete' ? 'deleted' : action === 'move' ? 'moved' : 'ready',
      revisionName: safeName,
      changes: notes,
      ...(scaffolded ? { scaffolded } : {}),
      ...(action === 'move' ? { to: sanitizePath(input.to ?? '') } : {}),
      files: files.map((f) => f.path),
      fileCount: files.length,
    },
  }
}