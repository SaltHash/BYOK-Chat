/* Pure workspace file-artifact helpers. No DOM, no store imports — kept side-effect
   free so the logic stays unit-testable from src/workspace.test.mjs. */

export const WORKSPACE_TOOL = 'workspace_upsert'
export const WORKSPACE_MAX_CONTENT = 50000
export const WORKSPACE_MAX_FILES = 8
export const WORKSPACE_MAX_PATH = 200
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

export type WorkspaceArgs = { action?: string; path?: string; language?: string; content?: string; label?: string }

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
      for (const k of ['action', 'path', 'language', 'content', 'label'] as const) {
        if (typeof (v as Record<string, unknown>)[k] === 'string') out[k] = (v as Record<string, string>)[k]
      }
      return out
    }
  } catch { /* truncated JSON — extract prefixes below */ }
  const out: WorkspaceArgs = {}
  for (const k of ['action', 'path', 'language', 'label'] as const) {
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

/** Group workspace calls by sanitized path in message order. Caps distinct files. */
export function groupWorkspaceVersions(calls: WorkspaceCallLike[], limit = WORKSPACE_MAX_FILES): { path: string; versions: WorkspaceVersion[] }[] {
  const order: string[] = []
  const map = new Map<string, WorkspaceVersion[]>()
  for (const c of calls) {
    if (c?.name !== WORKSPACE_TOOL && c?.name) continue
    const a = parseWorkspaceArgsPartial(typeof c.arguments === 'string' ? c.arguments : '')
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

/** Pending (not-yet-committed) live calls vs completed final calls. */
export function pendingLiveCalls(
  live: LiveCallLike[] | undefined,
  finalCalls: { id: string }[],
  tool = WORKSPACE_TOOL,
): LiveCallLike[] {
  const done = new Set(finalCalls.map((c) => c.id))
  return (live ?? []).filter((c) => c.name === tool || !c.name).filter((c) => !c.id || !done.has(c.id))
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

/** Last path across final + pending calls (used for the "Writing…" fallback in Chat). */
export function findLastWorkspacePath(
  live: LiveCallLike[] | undefined,
  toolRounds: { calls: WorkspaceCallLike[] }[] | undefined,
  tool = WORKSPACE_TOOL,
): string | null {
  const finalCalls = (toolRounds ?? []).flatMap((r) => r.calls).filter((c) => c.name === tool)
  const pending = pendingLiveCalls(live as LiveCallLike[] | undefined, finalCalls, tool)
  const all = [...pending.map((c) => ({ ...c, name: tool })), ...finalCalls.map((c) => ({ ...c })) as WorkspaceCallLike[]]
  if (!all.length) return null
  const groups = groupWorkspaceVersions(all)
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
export function migrateLegacyCanvasGroups(chats: { msgs: any[] }[]): { workspaces: Record<string, Workspace>; selectedRevision: Record<string, string> } {
  const workspaces: Record<string, Workspace> = {}
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