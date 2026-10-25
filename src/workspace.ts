/* Pure workspace file-artifact helpers. No DOM, no store imports — kept side-effect
   free so the logic stays unit-testable from src/workspace.test.mjs. */

export const WORKSPACE_TOOL = 'workspace_upsert'
export const WORKSPACE_MAX_CONTENT = 50000
export const WORKSPACE_MAX_PATH = 200
/** How many file paths a tool result lists back to the model. The workspace
 *  itself is uncapped; only this manifest is shortened, so a long project
 *  cannot flood the context on every call. */
export const WORKSPACE_RESULT_FILES = 40
export const WORKSPACE_TRUNC_MARKER = '\n\n[truncated: content exceeded 50,000 characters]'

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

export function truncateWorkspaceContent(content: string, max = WORKSPACE_MAX_CONTENT): { text: string; truncated: boolean } {
  if (content.length > max) return { text: content.slice(0, max) + WORKSPACE_TRUNC_MARKER, truncated: true }
  return { text: content, truncated: false }
}

export type WorkspaceArgs = { action?: string; path?: string; language?: string; content?: string; label?: string; template?: string; workspaceId?: string; workspaceName?: string }

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
      for (const k of ['action', 'path', 'language', 'content', 'label', 'template', 'workspaceId', 'workspaceName'] as const) {
        if (typeof (v as Record<string, unknown>)[k] === 'string') out[k] = (v as Record<string, string>)[k]
      }
      return out
    }
  } catch { /* truncated JSON — extract prefixes below */ }
  const out: WorkspaceArgs = {}
  for (const k of ['action', 'path', 'language', 'label', 'template', 'workspaceId', 'workspaceName'] as const) {
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
    // A read has no new file content: it is inspection, not a version, and
    // must never become the latest state in the panel or count as a write.
    if (a.action === 'read') continue
    const path = sanitizePath(a.path ?? '')
    const v: WorkspaceVersion = {
      action: typeof a.action === 'string' && a.action ? a.action : 'create',
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
        meta.set(key, { args, ws, fileKey, result, rawArgs: jsonObjectOf(raw) })
        if (fileKey) {
          if (args.action === 'create' || args.action === 'update') {
            latestFull.set(fileKey, { m, r, c })
            deleted.delete(fileKey)
          } else if (args.action === 'delete') {
            deleted.add(fileKey)
          }
          if (args.action === 'read') {
            latestRead.set(fileKey, { m, r, c })
            readHistory.set(fileKey, [...(readHistory.get(fileKey) ?? []), key])
          } else if (args.action) {
            // Any write makes earlier reads stale: their text is no longer the
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
              ? `[earlier version omitted from the model context: ${args.content.length.toLocaleString()} characters. The file was deleted later in this transcript.]`
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
          if (fileKey && args.action === 'read' && typeof result.content === 'string' && !isLatest(latestRead.get(fileKey), m, r, c)) {
            result.contentNote = staleReads.has(key)
              ? `[earlier read omitted: ${result.content.length.toLocaleString()} characters. The file changed after this read; call action read for its current text.]`
              : `[earlier read omitted: ${result.content.length.toLocaleString()} characters. A later read in this transcript is current.]`
            delete result.content
            changed = true
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
        truncated: g.versions[g.versions.length - 1].content.includes(WORKSPACE_TRUNC_MARKER),
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
 * The model often omits the workspace id (it is not in its context between
 * replies) or repeats createNew for what is really the same project. Both
 * used to spawn a second, nearly empty workspace, so the files the user was
 * looking at appeared to vanish. The active workspace of the chat is the
 * fallback. */

export type WorkspaceTargetInput = { workspaceId?: string; createNew?: boolean; workspaceName?: string }

export type WorkspaceTarget = {
  workspaceId?: string
  createNew?: boolean
  workspaceName?: string
  /** Set when the call was redirected away from what the model asked for. */
  fallback?: 'active' | 'new'
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

export type WorkspaceFileOp = { action: string; path: string; language?: string; content?: string }

export type WorkspaceCallInput = {
  workspaceId?: string
  createNew?: boolean
  workspaceName?: string
  revisionName: string
  action: string
  path: string
  language?: string
  content?: string
  template?: string
}

export type WorkspaceCallResult = {
  workspaceId: string
  path: string
  action: string
  revisionName: string
  changes: string[]
  scaffolded?: number
  /** The paths the workspace holds after this call, so the model can see what
   *  already exists before it writes the next file. */
  files: string[]
  /** Only for action "read": the file's current text, so the model can patch
   *  it accurately without resending the whole file. */
  content?: string
  lines?: number
  truncated?: boolean
}

const WORKSPACE_ACTIONS = ['create', 'update', 'delete', 'continue', 'patch', 'read']
const truncSuffixRe = new RegExp(WORKSPACE_TRUNC_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')

function applyOneFileOp(files: WorkspaceFile[], op: WorkspaceFileOp): { files: WorkspaceFile[]; note: string } {
  const p = sanitizePath(op.path)
  if (!p || p === 'file.txt') throw Error('path resolved to an invalid or empty name after sanitization')
  if (op.action === 'delete') {
    if (!files.some((f) => f.path === p)) throw Error(`File not found for delete: ${p}`)
    return { files: files.filter((f) => f.path !== p), note: `${p} deleted` }
  }
  // A create/update without a content string used to blank the file (a
  // truncated stream or a forgotten argument silently wiped it).
  if ((op.action === 'create' || op.action === 'update') && typeof op.content !== 'string') {
    throw Error(`Missing content for the "${op.action}" action on ${p}. Send the file body as a string.`)
  }
  if (op.action === 'continue') {
    const existing = files.find((f) => f.path === p)
    if (!existing) throw Error(`File not found for continue: ${p}`)
    const appended = existing.content.replace(truncSuffixRe, '') + (op.content ?? '')
    const { text, truncated } = truncateWorkspaceContent(appended)
    return { files: files.map((f) => (f.path === p ? { ...f, content: text, truncated } : f)), note: `${p} continued` }
  }
  if (op.action === 'patch') {
    const existing = files.find((f) => f.path === p)
    if (!existing) throw Error(`File not found for patch: ${p}. Use create with full content for new files.`)
    const patched = applyUnifiedDiff(existing.content, op.content ?? '')
    if (!patched.applied) throw Error(`Patch rejected for ${p}: ${patched.error}\nRead the current file with action "read" if you need the exact text, then retry with only the changed lines.`)
    const { text, truncated } = truncateWorkspaceContent(patched.text)
    const warning = patched.warnings?.length ? ` (${patched.warnings.join(' ')})` : ''
    return { files: files.map((f) => (f.path === p ? { ...f, content: text, language: op.language ?? f.language, truncated } : f)), note: `${p} patched (+${patched.added}/-${patched.removed})${warning}` }
  }
  const { text, truncated } = truncateWorkspaceContent(op.content ?? '')
  const at = files.findIndex((f) => f.path === p)
  if (at >= 0) {
    return { files: files.map((f, i) => (i === at ? { ...f, content: text, language: op.language ?? f.language, truncated } : f)), note: `${p} updated` }
  }
  return { files: [...files, { path: p, language: op.language ?? '', content: text, truncated }], note: `${p} created` }
}

export function applyWorkspaceCall(
  workspaces: Record<string, Workspace>,
  input: WorkspaceCallInput,
  ctx: { msgId: string; uid: () => string; now?: number },
): { workspaces: Record<string, Workspace>; selectedRevisionId: string; result: WorkspaceCallResult } {
  const now = ctx.now ?? Date.now()
  const safeName = String(input.revisionName ?? '').trim().slice(0, 200) || 'Revision'
  if (!WORKSPACE_ACTIONS.includes(String(input.action))) throw Error('action must be create, update, delete, continue, patch, or read')
  let next = { ...workspaces }
  let targetId = input.workspaceId
  let scaffolded = 0
  // Reading never creates or changes a workspace: it returns the current text
  // of one file so the model can patch it without sending a whole-file update.
  if (input.action === 'read') {
    if (input.template) throw Error('template cannot be used with action read.')
    if (input.createNew || !targetId) throw Error('action read needs an existing workspaceId.')
    const readWorkspace = next[targetId]
    if (!readWorkspace) throw Error(`Workspace not found: ${targetId}`)
    const latestRead = readWorkspace.revisions[readWorkspace.revisions.length - 1]
    if (!latestRead) throw Error(`Workspace has no files yet: ${targetId}`)
    const wanted = sanitizePath(input.path)
    const file = latestRead.files.find((f) => f.path === wanted)
    if (!file) {
      const available = latestRead.files.map((f) => f.path).slice(-20)
      throw Error(`File not found for read: ${wanted}${available.length ? `. Available files: ${available.join(', ')}` : ''}`)
    }
    return {
      workspaces,
      selectedRevisionId: latestRead.id,
      result: {
        workspaceId: targetId,
        path: file.path,
        action: 'read',
        revisionName: safeName,
        changes: [],
        files: latestRead.files.map((f) => f.path),
        content: file.content,
        lines: workspaceLines(file.content),
        ...(file.truncated ? { truncated: true } : {}),
      },
    }
  }
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
  const notes: string[] = []
  {
    const r = applyOneFileOp(files, { action: input.action, path: input.path, language: input.language, content: input.content })
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
      path: sanitizePath(input.path),
      action: input.action === 'delete' ? 'deleted' : 'ready',
      revisionName: safeName,
      changes: notes,
      ...(scaffolded ? { scaffolded } : {}),
      files: files.map((f) => f.path),
    },
  }
}