/* Pure workspace file-artifact helpers. No DOM, no store imports — kept side-effect
   free so the logic stays unit-testable from src/workspace.test.mjs. */

export const WORKSPACE_TOOL = 'workspace_upsert'
export const WORKSPACE_MAX_CONTENT = 50000
export const WORKSPACE_MAX_FILES = 16
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

export type WorkspaceArgs = { action?: string; path?: string; language?: string; content?: string; label?: string; template?: string; files?: { path?: string; language?: string; content?: string; action?: string }[] }

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
      for (const k of ['action', 'path', 'language', 'content', 'label', 'template'] as const) {
        if (typeof (v as Record<string, unknown>)[k] === 'string') out[k] = (v as Record<string, string>)[k]
      }
      // Batch file lists only parse from complete JSON (they stream poorly).
      const files = (v as Record<string, unknown>).files
      if (Array.isArray(files)) {
        out.files = files
          .filter((f) => f && typeof f === 'object' && !Array.isArray(f))
          .map((f) => {
            const r = f as Record<string, unknown>
            const e: { path?: string; language?: string; content?: string; action?: string } = {}
            for (const k of ['path', 'language', 'content', 'action'] as const) if (typeof r[k] === 'string') e[k] = r[k] as string
            return e
          })
          .filter((f) => f.path != null)
      }
      return out
    }
  } catch { /* truncated JSON — extract prefixes below */ }
  const out: WorkspaceArgs = {}
  for (const k of ['action', 'path', 'language', 'label', 'template'] as const) {
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
    if (c?.name !== WORKSPACE_TOOL) continue
    const a = parseWorkspaceArgsPartial(typeof c.arguments === 'string' ? c.arguments : '')
    // Skip calls that have not streamed a real file target yet: an empty path
    // is not a file named "file.txt", it is just arguments still arriving.
    const hasPath = typeof a.path === 'string' && a.path.trim().length > 0
    const hasFiles = Array.isArray(a.files) && a.files.length > 0
    if (!hasPath && !hasFiles) continue
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

export type PatchResult = { text: string; applied: boolean; added: number; removed: number; error?: string }

/** Apply a unified diff to base text. Hunk headers (`@@ -a,b +c,d @@`) drive
 *  placement; context lines must match with ±3 lines of fuzz, otherwise the
 *  hunk — and the whole patch — is rejected with a precise error. The
 *  `---`/`+++` headers, `Index:` lines and `\ No newline` markers are
 *  accepted and ignored. Never throws. */
export function applyUnifiedDiff(base: string, diff: string): PatchResult {
  const fail = (error: string): PatchResult => ({ text: String(base ?? ''), applied: false, added: 0, removed: 0, error })
  const src = String(base ?? '').split('\n')
  // One trailing newline is a terminator, not an empty context line.
  const raw = String(diff ?? '').replace(/\n$/, '').split('\n')
  const hunks: { oldStart: number; lines: { kind: ' ' | '+' | '-'; text: string }[] }[] = []
  let cur: { oldStart: number; lines: { kind: ' ' | '+' | '-'; text: string }[] } | null = null
  for (const line of raw) {
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('Index: ') || line.startsWith('diff ')) continue
    if (line.startsWith('\\ ')) continue
    const h = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line)
    if (h) { cur = { oldStart: Math.max(1, Number(h[1])), lines: [] }; hunks.push(cur); continue }
    if (!cur) {
      if (!line.trim()) continue
      return fail('No hunks found: include at least one @@ -a,b +c,d @@ hunk.')
    }
    if (!line) { cur.lines.push({ kind: ' ', text: '' }); continue }
    const k = line[0]
    if (k === ' ' || k === '+' || k === '-') cur.lines.push({ kind: k as ' ' | '+' | '-', text: line.slice(1) })
    else return fail(`Unexpected diff line: ${line.slice(0, 60)}`)
  }
  if (!hunks.length) return fail('No hunks found: include at least one @@ -a,b +c,d @@ hunk.')
  const out = [...src]
  let added = 0, removed = 0, drift = 0
  for (const hunk of hunks) {
    // Verify the hunk's old-side lines match at the expected position (±fuzz),
    // then walk the hunk in order: context advances, '-' removes, '+' inserts.
    const oldSide = hunk.lines.filter((l) => l.kind !== '+').map((l) => l.text)
    let at = -1
    for (let fuzz = 0; fuzz <= 3 && at < 0; fuzz++) {
      for (const dir of fuzz === 0 ? [0] : [-fuzz, fuzz]) {
        const cand = hunk.oldStart - 1 + drift + dir
        if (cand < 0 || cand + oldSide.length > out.length + (oldSide.length === 0 ? 1 : 0)) continue
        if (oldSide.every((t, k) => out[cand + k] === t)) { at = cand; break }
      }
    }
    if (at < 0) return fail(`Hunk at old line ${hunk.oldStart} does not match (context changed?).`)
    if (at > out.length) return fail(`Hunk at old line ${hunk.oldStart} is past the end of the file.`)
    const before = at
    for (const l of hunk.lines) {
      if (l.kind === ' ') {
        if (out[at] !== l.text) return fail(`Hunk at old line ${hunk.oldStart} does not match (context changed?).`)
        at++
      } else if (l.kind === '-') {
        if (out[at] !== l.text) return fail(`Hunk at old line ${hunk.oldStart} does not match (context changed?).`)
        out.splice(at, 1)
        removed++
      } else {
        out.splice(at, 0, l.text)
        added++
        at++
      }
    }
    drift += at - before - oldSide.length
  }
  return { text: out.join('\n'), applied: true, added, removed }
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
 *  Applies one workspace_upsert call (single op + optional files[] batch +
 *  optional template scaffold) and returns the next workspaces map, the
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
  files?: { path?: string; language?: string; content?: string; action?: string }[]
  template?: string
}

export type WorkspaceCallResult = {
  workspaceId: string
  path: string
  action: string
  revisionName: string
  changes: string[]
  scaffolded?: number
}

const WORKSPACE_ACTIONS = ['create', 'update', 'delete', 'continue', 'patch']
const truncSuffixRe = new RegExp(WORKSPACE_TRUNC_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')

function applyOneFileOp(files: WorkspaceFile[], op: WorkspaceFileOp): { files: WorkspaceFile[]; note: string } {
  const p = sanitizePath(op.path)
  if (!p || p === 'file.txt') throw Error('path resolved to an invalid or empty name after sanitization')
  if (op.action === 'delete') {
    if (!files.some((f) => f.path === p)) throw Error(`File not found for delete: ${p}`)
    return { files: files.filter((f) => f.path !== p), note: `${p} deleted` }
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
    if (!patched.applied) throw Error(`Patch rejected for ${p}: ${patched.error}`)
    const { text, truncated } = truncateWorkspaceContent(patched.text)
    return { files: files.map((f) => (f.path === p ? { ...f, content: text, language: op.language ?? f.language, truncated } : f)), note: `${p} patched (+${patched.added}/-${patched.removed})` }
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
  if (!WORKSPACE_ACTIONS.includes(String(input.action))) throw Error('action must be create, update, delete, continue, or patch')
  const batch = Array.isArray(input.files) ? input.files : []
  if (batch.length > WORKSPACE_MAX_FILES) throw Error(`files holds at most ${WORKSPACE_MAX_FILES} entries per call`)
  for (const e of batch) {
    if (!e || typeof e !== 'object' || typeof e.path !== 'string') throw Error('Each files entry needs a path string.')
    if (!WORKSPACE_ACTIONS.includes(e.action ?? 'update')) throw Error(`Unsupported files entry action: ${e.action ?? 'update'}`)
  }

  let next = { ...workspaces }
  let targetId = input.workspaceId
  let scaffolded = 0
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
  for (const e of batch) {
    const r = applyOneFileOp(files, { action: e.action ?? 'update', path: e.path as string, language: e.language, content: e.content })
    files = r.files
    notes.push(r.note)
  }
  if (files.length > WORKSPACE_MAX_FILES * 2) throw Error(`Workspace holds too many files (cap ${WORKSPACE_MAX_FILES * 2}). Delete some first.`)

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
    },
  }
}