import { useEffect, useMemo, useState } from 'react'
import { Archive, Check, Copy, ChevronRight, Download, FileCode, FileJson, FileText, FileType, Globe, Image, Music, Video, Braces, Terminal, Database, Cog, Hash, PenTool, LayoutTemplate, Sparkles, File, Files, Folder, FolderOpen, Pencil, X, Diff as DiffIcon, Trash2, Send, Share2, Save, type LucideIcon } from 'lucide-react'
import { strToU8, zipSync } from 'fflate'
import { useS, uid, type Msg } from '../store'
import { clampWorkspaceSplit } from '../layout'
import type { ToolCall } from '../engine'
import { Md } from './Md'
import { Btn, Confirm, Field, Input, Toggle, cx } from './ui'
import { WORKSPACE_MAX_FILES, buildZipEntries, workspaceLines, workspaceSize, buildFolderTree, expandedFoldersForPath, extractWorkspaceIds, findWritingPath, groupWorkspaceVersions, countWorkspaceFiles, sanitizePath, zipFilename, diffLines, diffStat, changedFilesBetween, sanitizeHtmlPreview, previewKindFor, highlightLanguageFor, parseCsvPreview, type Workspace, type WorkspaceRevision } from '../workspace'

const fence = (lang: string, code: string) => {
  const runs = code.match(/`{3,}/g)
  const n = runs ? Math.max(...runs.map((x) => x.length)) + 1 : 3
  const f = '`'.repeat(n)
  return `${f}${lang || 'text'}\n${code}\n${f}`
}
const base = (p: string) => sanitizePath(p).split('/').pop() || 'file.txt'

const fileIconMap: Record<string, LucideIcon> = {
  js: FileCode, ts: FileCode, jsx: FileCode, tsx: FileCode, mjs: FileCode,
  json: FileJson, yaml: Braces, yml: Braces,
  html: Globe, htm: Globe,
  css: LayoutTemplate, scss: LayoutTemplate, sass: LayoutTemplate, less: LayoutTemplate,
  md: FileText, txt: FileText,
  png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image, bmp: Image,
  mp3: Music, wav: Music, ogg: Music,
  mp4: Video, mov: Video, avi: Video, webm: Video,
  py: Terminal, sh: Terminal, bash: Terminal, zsh: Terminal,
  sql: Database, sqlite: Database,
  xml: Braces, ini: Cog, config: Cog, conf: Cog, env: Hash,
  log: FileText, csv: Database, tsv: Database,
}

export function fileIconFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return fileIconMap[ext] ?? FileText
}
/** Accent color for file icons (single token, replaces per-extension helper). */
export const FILE_ICON_COLOR = 'var(--ac)'
export const saveBlob = (name: string, blob: Blob) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 999)
}

export function useWorkspaceFiles(msg: Msg, live?: ToolCall[], workspace?: Workspace, selectedRevisionId?: string | null) {
  const finalCalls = useMemo(() => (msg.toolRounds ?? []).flatMap((r) => r.calls).filter((c) => c.name === 'workspace_upsert'), [msg.toolRounds])
  const liveCalls = useMemo(() => (live ?? []).filter((c) => c.name === 'workspace_upsert'), [live])
  const groups = useMemo(() => {
    const done = new Set(finalCalls.map((c) => c.id))
    const pending = liveCalls.filter((c) => !c.id || !done.has(c.id))
    return groupWorkspaceVersions([...finalCalls, ...pending.map((c) => ({ ...c }))])
  }, [finalCalls, liveCalls])
  // Uncapped count: `groups` is capped at WORKSPACE_MAX_FILES, so its length
  // could never trigger the "(showing first N)" hint.
  const total = useMemo(() => {
    const done = new Set(finalCalls.map((c) => c.id))
    const pending = liveCalls.filter((c) => !c.id || !done.has(c.id))
    return countWorkspaceFiles([...finalCalls, ...pending.map((c) => ({ ...c }))])
  }, [finalCalls, liveCalls])
  const isLive = liveCalls.length > 0
  return { groups, total, isLive }
}

export function downloadAllFiles(groups: { path: string; versions: { action: string; content: string }[] }[], edits: Record<string, { content: string }[]>, workspaceName?: string) {
  const latest = (path: string) => {
    const g = groups.find((x) => x.path === path)!
    const all = [...g.versions, ...((edits[path] ?? []).map((e) => ({ content: e.content })))]
    return all[all.length - 1].content
  }
  const files = groups.filter((g) => {
    const all = [...g.versions, ...(edits[g.path] ?? []).map((e) => ({ action: 'update', content: e.content }))]
    return all[all.length - 1].action !== 'delete'
  }).map((g) => ({ path: g.path, content: latest(g.path) }))
  if (!files.length) return
  const rootName = workspaceName ? workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project' : ''
  const entries = buildZipEntries(files)
  const zipPaths = entries.map((e) => ({ ...e, path: rootName ? `${rootName}/${e.path}` : e.path }))
  const obj: Record<string, Uint8Array> = {}
  for (const e of zipPaths) obj[e.path] = strToU8(e.content)
  saveBlob(`${rootName || zipFilename(entries).replace(/\.zip$/, '')}.zip`, new Blob([zipSync(obj)], { type: 'application/zip' }))
}

/* Line diff renderer (shared by the per-file Diff tab and compare mode). */
export function DiffView({ oldText, newText, maxLines = 2000 }: { oldText: string; newText: string; maxLines?: number }) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText])
  const { added, removed } = diffStat(lines)
  const shown = lines.slice(0, maxLines)
  if (!added && !removed) return <p className="px-4 py-3 text-sm text-mu">No changes.</p>
  return (
    <div className="py-2 font-mono text-xs leading-5">
      <p className="px-4 pb-2 text-mu">+{added} −{removed}</p>
      {shown.map((l, i) => (
        <div key={i} className={cx('flex gap-2 overflow-x-auto whitespace-pre px-4', l.type === 'add' && 'bg-ac/10 text-tx', l.type === 'del' && 'bg-er/10 text-tx', l.type === 'same' && 'text-mu')}>
          <span aria-hidden="true" className="w-3 shrink-0 select-none text-mu">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
          <span className="min-w-0">{l.text || ' '}</span>
        </div>
      ))}
      {lines.length > shown.length && <p className="px-4 pt-2 text-mu">Showing {shown.length} of {lines.length} changed lines.</p>}
    </div>
  )
}

/* Rich previews: sandboxed HTML iframe, rendered Markdown, SVG image, CSV table. */
export function FilePreview({ path, language, content }: { path: string; language: string; content: string }) {
  const kind = previewKindFor(path, language)
  const [svgUrl, setSvgUrl] = useState<string | null>(null)
  useEffect(() => {
    if (kind !== 'svg') return
    const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }))
    setSvgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [kind, content])
  if (kind === 'html') {
    return <iframe title={`Preview of ${path}`} sandbox="" srcDoc={sanitizeHtmlPreview(content)} className="min-h-64 w-full flex-1 bg-white" />
  }
  if (kind === 'svg' && svgUrl) {
    return <div className="grid min-h-64 flex-1 place-items-center overflow-auto bg-white p-4"><img src={svgUrl} alt={path} className="max-h-full max-w-full" /></div>
  }
  if (kind === 'markdown') {
    return <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3"><Md t={content} /></div>
  }
  if (kind === 'csv') {
    const rows = parseCsvPreview(content)
    if (!rows.length) return <p className="px-4 py-3 text-sm text-mu">No rows to preview.</p>
    return (
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <table className="w-full border-collapse text-xs">
          <thead><tr>{rows[0].map((c, i) => <th key={i} className="border border-bor bg-surf px-2 py-1 text-left font-semibold">{c}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-bor px-2 py-1">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
  return null
}

/* Optional GitHub Gist export: plain fetch with the user's own token
 * (BYOK-style, stored only in this browser). No new dependencies. */
export async function exportGist(token: string, description: string, pub: boolean, files: { path: string; content: string }[]): Promise<string> {
  const t = token.trim()
  if (!t) throw Error('Paste a GitHub personal access token (classic, gist scope) first.')
  if (!files.length) throw Error('Nothing to share.')
  const r = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify({ description: description || 'Workspace export', public: pub, files: Object.fromEntries(files.map((f) => [f.path.replace(/\//g, '-'), { content: f.content }])) }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Error(data?.message ? `GitHub: ${data.message}` : `GitHub returned HTTP ${r.status}.`)
  if (typeof data?.html_url !== 'string') throw Error('GitHub returned an unexpected response.')
  return data.html_url
}

/* Shared folder/file tree used by both the compact tile and the side panel.
 * `variant` preserves each caller's styling; recursion + sorting live here once. */
export function WorkspaceFileTree<T extends { path: string; content: string }>({
  tree, expanded, selectedPath, onToggle, onSelect, variant = 'tile',
}: {
  tree: Record<string, { files: T[]; folders: Set<string> }>
  expanded: Record<string, boolean>
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  variant?: 'tile' | 'panel'
}) {
  const renderFolder = (path: string, depth = 0): React.ReactNode => {
    const node = tree[path]
    if (!node) return null
    const isExpanded = expanded[path] ?? false
    const displayName = path === '/' ? 'Root' : path.split('/').pop() || ''
    const indent = depth * 16
    const showButton = path !== '/'
    return (
      <div key={path} className={variant === 'tile' ? 'space-y-1' : 'space-y-0.5'}>
        {showButton && (
          <button
            onClick={() => onToggle(path)}
            className={variant === 'tile'
              ? 'flex w-full items-start gap-2 px-2 py-1.5 text-sm hover:bg-hov rounded transition-colors'
              : cx('flex w-full items-start gap-2 px-2 py-1.5 text-sm hover:bg-hov rounded transition-colors', depth > 0 && 'ml-4')}
            style={{ paddingLeft: `${16 + indent}px` }}
            aria-expanded={isExpanded}
            aria-label={variant === 'tile' ? undefined : isExpanded ? `Collapse ${displayName}` : `Expand ${displayName}`}
          >
            <span className="flex-1 min-w-0 flex items-start gap-2">
              <span className="shrink-0">{isExpanded ? <FolderOpen size={14} className="text-mu" /> : <Folder size={14} className="text-mu" />}</span>
              <span className="font-mono text-xs text-mu text-left">{displayName}</span>
              {variant === 'panel' && <span className="text-xs text-mu/70">{node.files.length} file{node.files.length === 1 ? '' : 's'}{node.folders.size > 0 ? `, ${node.folders.size} folder${node.folders.size === 1 ? '' : 's'}` : ''}</span>}
              <ChevronRight size={12} className={cx('shrink-0 text-mu transition-transform', isExpanded && 'rotate-90')} />
            </span>
            {variant === 'tile' && <span className="text-xs text-mu">{node.files.length} file{node.files.length === 1 ? '' : 's'}</span>}
          </button>
        )}
        {(showButton ? isExpanded : true) && (
          <>
            {Array.from(node.folders).sort().map((name) => renderFolder(path === '/' ? `/${name}` : `${path}/${name}`, path === '/' ? depth : depth + 1))}
            {[...node.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => {
              const Icon = fileIconFor(f.path)
              const selected = selectedPath === f.path
              return (
                <button
                  key={f.path}
                  onClick={() => onSelect(f.path)}
                  className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-hov', selected ? 'text-tx' : 'text-tx/90', variant === 'panel' && depth > 0 && 'ml-4')}
                  style={{ paddingLeft: path === '/' ? `${16 + indent}px` : `${16 + indent + 14}px`, backgroundColor: selected ? 'color-mix(in srgb, var(--ac) 12%, transparent)' : undefined }}
                  aria-current={variant === 'panel' && selected ? 'true' : undefined}
                  aria-label={variant === 'panel' ? `${f.path} · ${workspaceLines(f.content)} lines` : undefined}
                >
                  <span className="shrink-0" style={{ color: FILE_ICON_COLOR }}><Icon size={variant === 'tile' ? 14 : 13} /></span>
                  <span className="min-w-0 truncate font-mono text-xs">{f.path.split('/').pop()}</span>
                  <span className="ml-auto text-xs text-mu">{workspaceLines(f.content)} lines</span>
                </button>
              )
            })}
          </>
        )}
      </div>
    )
  }
  return <>{renderFolder('/')}</>
}

/* Compact tile beneath the reply: shows workspace name, file count, revision, and file list grouped by folder. */
export function WorkspaceTile({ msg, live, workspace, selectedRevisionId, onOpen, onSelectRevision }: {
  msg: Msg; live?: ToolCall[]; workspace: Workspace; selectedRevisionId: string | null;
  onOpen?: (filePath?: string) => void; onSelectRevision?: (revId: string) => void
}) {
  const { groups, total, isLive } = useWorkspaceFiles(msg, live)
  // Guard against empty placeholder workspace objects
  if (!groups.length && (!workspace || !workspace.id || !workspace.revisions?.length)) return null

  const revision = workspace.revisions?.find(r => r.id === selectedRevisionId) ?? workspace.revisions?.[workspace.revisions.length - 1]
  if (!revision) return null
  const writingPath = useMemo(() => findWritingPath(live, msg.toolRounds), [msg.toolRounds, live])

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(workspace.name)

  const revIdx = workspace.revisions.findIndex((r) => r.id === revision.id)
  const prevRev = revIdx > 0 ? workspace.revisions[revIdx - 1] : null
  const changeStat = useMemo(() => {
    if (!prevRev) return null
    const prevMap = new Map(prevRev.files.map((f) => [f.path, f.content]))
    let added = 0, removed = 0
    for (const f of revision.files) {
      const old = prevMap.get(f.path)
      if (old == null) added += f.content.split('\n').length
      else if (old !== f.content) { const s = diffStat(diffLines(old, f.content)); added += s.added; removed += s.removed }
    }
    for (const f of prevRev.files) if (!revision.files.some((x) => x.path === f.path)) removed += f.content.split('\n').length
    return added + removed > 0 ? { added, removed } : null
  }, [prevRev, revision])

  const saveName = () => {
    const name = nameDraft.trim().slice(0, 80)
    if (name && name !== workspace.name) {
      const st = useS.getState(), ws = st.workspaces[workspace.id]
      if (ws) st.patch({ workspaces: { ...st.workspaces, [workspace.id]: { ...ws, name } } })
    }
    setRenaming(false)
  }

  // Auto-expand only folders leading to the writing file; merge like the
  // panel so a null writingPath does not collapse what the user expanded.
  useEffect(() => {
    if (!writingPath) return
    setExpandedFolders((prev) => ({ ...prev, ...expandedFoldersForPath(writingPath) }))
  }, [writingPath])

  // Build nested folder tree for expandable folders
  const folderTree = useMemo(() => buildFolderTree(revision.files), [revision.files])

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] }))
  }

  return (
    <section aria-label="Workspace files" className="space-y-2 rounded-xl border border-bor bg-surf/50 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Files size={15} className="shrink-0 text-ac" />
        {renaming ? (
          <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false) }} className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
        ) : (
          <>
            <span className="truncate font-medium">{workspace.name}</span>
            <button title="Rename workspace" onClick={() => { setNameDraft(workspace.name); setRenaming(true) }} className="grid size-6 shrink-0 place-items-center rounded-md text-mu hover:bg-hov hover:text-tx"><Pencil size={12} /></button>
          </>
        )}
        <span className="text-xs text-mu">· {total} file{total === 1 ? '' : 's'}</span>
        <span className="text-xs text-mu">· {revision.name}</span>
        {changeStat && <span className="shrink-0 font-mono text-xs text-mu" title="Changed lines vs the previous revision">+{changeStat.added} −{changeStat.removed}</span>}
        {isLive && writingPath && (
          <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs text-mu ml-auto">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ac" />
            <span className="truncate">Writing {writingPath}…</span>
          </span>
        )}
        {total > WORKSPACE_MAX_FILES && <span className="shrink-0 text-xs text-mu">(showing first {WORKSPACE_MAX_FILES})</span>}
      </div>
      <div className="max-h-200 overflow-y-auto space-y-1 border-t border-bor pt-2 mt-1">
        <WorkspaceFileTree
          tree={folderTree}
          expanded={expandedFolders}
          selectedPath={selectedPath}
          onToggle={toggleFolder}
          onSelect={(p) => { setSelectedPath(p); onOpen?.(p) }}
          variant="tile"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        {workspace.revisions.length > 0 && (
          <WorkspaceRevisionPicker
            workspace={workspace}
            selectedId={selectedRevisionId}
            onSelect={onSelectRevision ?? (() => {})}
            className="flex-1"
          />
        )}
        <Btn v="soft" icon={Archive} onClick={() => downloadAllFiles(revision.files.map((f) => ({ path: f.path, versions: [{ action: 'create' as const, content: f.content }] })), {}, workspace.name)} className="w-auto">Download project</Btn>
      </div>
    </section>
  )
}

function WorkspaceRevisionPicker({ workspace, selectedId, onSelect, className }: {
  workspace: Workspace; selectedId: string | null; onSelect: (revId: string) => void; className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = workspace.revisions.find(r => r.id === selectedId) ?? workspace.revisions[workspace.revisions.length - 1]

  return (
    <div className={cx('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border border-bor bg-bg px-2.5 py-1.5 text-left text-sm hover:bg-hov"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate font-mono text-sm">{selected.name}</span>
        <span className="shrink-0 text-xs text-mu">v{workspace.revisions.findIndex(r => r.id === selected.id) + 1} of {workspace.revisions.length}</span>
        <span className="flex-1" />
        <span className="shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-60 overflow-y-auto rounded-xl border border-bor bg-surf shadow-lg z-10">
          {workspace.revisions.map((rev, i) => (
            <button
              key={rev.id}
              onClick={() => { onSelect(rev.id); setOpen(false) }}
              className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', rev.id === selectedId ? 'bg-ac/10' : 'hover:bg-hov')}
            >
              <span className="flex-1 truncate">{rev.name}</span>
              <span className="shrink-0 text-xs text-mu">v{i + 1}</span>
              {rev.id === selectedId && <Check size={14} className="shrink-0 text-ac" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* Full file viewer rendered in the resizable splitscreen on the right. */
export function WorkspacePanel({ msg, live, workspace, selectedRevisionId, setSelectedRevisionId, onClose, initialFilePath }: {
  msg: Msg; live?: ToolCall[]; workspace: Workspace; selectedRevisionId: string | null;
  setSelectedRevisionId: (id: string) => void; onClose: () => void; initialFilePath?: string
}) {
  const send = useS((s) => s.send)
  const busy = useS((s) => s.busy)
  const workspacePrefs = useS((s) => s.workspacePrefs ?? { defaultView: 'latest', autoOpen: true, autoFollow: true })
  const storedSplit = useS((s) => s.prefs.workspaceSplit)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<'code' | 'preview' | 'diff'>('code')
  const [diffBaseId, setDiffBaseId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(workspace.name)
  const [gistOpen, setGistOpen] = useState(false)
  const [flash, setFlash] = useState<'copy' | 'download' | null>(null)
  const flashFor = (k: 'copy' | 'download') => { setFlash(k); setTimeout(() => setFlash(null), 1200) }
  const split = clampWorkspaceSplit(storedSplit)
  const setSplit = (v: number) => {
    const st = useS.getState()
    st.patch({ prefs: { ...st.prefs, workspaceSplit: Math.round(clampWorkspaceSplit(v) * 1000) / 1000 } })
  }

  const revision = workspace.revisions.find(r => r.id === selectedRevisionId) ?? workspace.revisions[workspace.revisions.length - 1]
  const revIdx = workspace.revisions.findIndex(r => r.id === revision.id)
  const { total } = useWorkspaceFiles(msg, live)

  // Determine the file currently being written by the AI
  const writingPath = useMemo(() => findWritingPath(live, msg.toolRounds), [msg.toolRounds, live])

  // Exit edit mode whenever the revision changes.
  useEffect(() => { setEditing(false); setDiffBaseId(null) }, [revision.id])

  // Select the file requested from the inline tile (or auto-open). Runs on
  // mount and whenever the requested path changes while the panel is open.
  useEffect(() => {
    if (initialFilePath) {
      setSelectedFilePath(initialFilePath)
      // Ensure the folder containing this file is expanded
      setExpandedFolders((prev) => ({ ...prev, ...expandedFoldersForPath(initialFilePath) }))
    }
  }, [initialFilePath])

  // Auto-follow: when AI starts writing a new file, switch to it
  useEffect(() => {
    if (workspacePrefs.autoFollow && writingPath && writingPath !== selectedFilePath) {
      setSelectedFilePath(writingPath)
      // Ensure the folder containing this file is expanded
      setExpandedFolders((prev) => ({ ...prev, ...expandedFoldersForPath(writingPath) }))
    }
  }, [writingPath, workspacePrefs.autoFollow, selectedFilePath])

  // Initialize selected file to first file in revision (only if no file selected yet and no initial path)
  useEffect(() => {
    if (revision.files.length > 0 && !selectedFilePath && !writingPath && !initialFilePath) {
      setSelectedFilePath(revision.files[0].path)
    }
  }, [revision.id, revision.files, selectedFilePath, writingPath, initialFilePath])

  const files = revision.files
  const copy = (s: string) => { navigator.clipboard?.writeText(s) }
  const downloadOne = (p: string, content: string) => saveBlob(base(p), new Blob([content], { type: 'text/plain;charset=utf-8' }))

  const restore = () => {
    if (busy) return
    const file = revision.files.find(f => f.path === selectedFilePath) ?? revision.files[0]
    if (file) {
      void send(`Please restore file "${file.path}" to the selected revision. Call workspace_upsert with action "update", the same path, and that version's exact content.`, [])
    }
  }

  const saveLocalEdit = () => {
    const st = useS.getState()
    const ws = st.workspaces[workspace.id]
    const file = revision.files.find(f => f.path === selectedFilePath) ?? revision.files[0]
    if (!ws || !file) return
    const latest = ws.revisions[ws.revisions.length - 1]
    const next: WorkspaceRevision = {
      id: uid(),
      name: 'Local edit',
      msgId: msg.id,
      // The edited file may exist only in the selected older revision: append
      // it instead of silently dropping the edit.
      files: latest.files.some((f) => f.path === file.path)
        ? latest.files.map((f) => (f.path === file.path ? { ...f, content: draft } : f))
        : [...latest.files, { ...file, content: draft }],
      createdAt: Date.now(),
    }
    st.patch({
      workspaces: { ...st.workspaces, [ws.id]: { ...ws, revisions: [...ws.revisions, next] } },
      selectedRevision: { ...st.selectedRevision, [ws.id]: next.id },
    })
    setSelectedRevisionId(next.id)
    setEditing(false)
  }

  const deleteLocalFile = () => {
    const st = useS.getState()
    const ws = st.workspaces[workspace.id]
    if (!ws || !selectedFilePath) return
    const latest = ws.revisions[ws.revisions.length - 1]
    const next: WorkspaceRevision = {
      id: uid(),
      name: `Removed ${base(selectedFilePath)}`,
      msgId: msg.id,
      files: latest.files.filter((f) => f.path !== selectedFilePath),
      createdAt: Date.now(),
    }
    st.patch({
      workspaces: { ...st.workspaces, [ws.id]: { ...ws, revisions: [...ws.revisions, next] } },
      selectedRevision: { ...st.selectedRevision, [ws.id]: next.id },
    })
    setSelectedRevisionId(next.id)
    setSelectedFilePath(next.files[0]?.path ?? null)
    setConfirmDelete(false)
  }

  const askAboutFile = () => {
    if (busy || !selectedFile) return
    const clipped = selectedFile.content.length > 8000 ? selectedFile.content.slice(0, 8000) + '\n…[truncated]' : selectedFile.content
    void send(`About \`${selectedFile.path}\` in workspace "${workspace.name}" (workspaceId "${workspace.id}"):\n${fence(highlightLanguageFor(selectedFile.path, selectedFile.language), clipped)}\n\nReply with your thoughts, and apply any changes I ask for with workspace_upsert calls against that workspaceId.`, [])
  }

  const saveName = () => {
    const name = nameDraft.trim().slice(0, 80)
    const st = useS.getState(), ws = st.workspaces[workspace.id]
    if (name && ws && name !== ws.name) st.patch({ workspaces: { ...st.workspaces, [workspace.id]: { ...ws, name } } })
    setRenaming(false)
  }

  // Build folder tree for expandable folders
  const folderTree = useMemo(() => buildFolderTree(files), [files])

  const selectedFile = files.find(f => f.path === selectedFilePath) ?? files[0]
  const kind = selectedFile ? previewKindFor(selectedFile.path, selectedFile.language) : 'code'
  const canPreview = kind !== 'code'
  const highlightLang = selectedFile ? highlightLanguageFor(selectedFile.path, selectedFile.language) : 'plaintext'

  // Diff base: explicit older revision, else the nearest earlier revision
  // that also contains this file (whole-file add when there is none).
  const olderRevs = workspace.revisions.slice(0, Math.max(0, revIdx))
  const diffBaseRev = (diffBaseId ? workspace.revisions.find((r) => r.id === diffBaseId) : undefined)
    ?? [...olderRevs].reverse().find((r) => selectedFile && r.files.some((f) => f.path === selectedFile.path))
    ?? null
  const diffBaseContent = selectedFile ? diffBaseRev?.files.find((f) => f.path === selectedFile.path)?.content ?? '' : ''
  const revChanges = useMemo(
    () => (diffBaseRev ? changedFilesBetween(diffBaseRev.files, revision.files).filter((c) => c.status !== 'same') : []),
    [diffBaseRev, revision],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-bor px-3 py-2">
        <Files size={15} className="shrink-0 text-ac" />
        {renaming ? (
          <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false) }} className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.name} · {total} file{total === 1 ? '' : 's'}</span>
            <Btn sm icon={Pencil} title="Rename workspace" onClick={() => { setNameDraft(workspace.name); setRenaming(true) }} />
          </>
        )}
        <WorkspaceRevisionPicker
          workspace={workspace}
          selectedId={selectedRevisionId}
          onSelect={setSelectedRevisionId}
          className="w-32 shrink-0 sm:w-64"
        />
        <Btn sm icon={Share2} title="Share via GitHub Gist (optional token)" onClick={() => setGistOpen(true)} />
        <Btn sm icon={X} title="Close workspace panel" onClick={() => { setSelectedFilePath(null); onClose(); }} />
      </div>
      <div role="tree" aria-label="Workspace files" className="min-h-0 overflow-y-auto border-b border-bor px-2 py-2" style={{ flex: `0 0 ${split * 100}%` }}>
        <WorkspaceFileTree
          tree={folderTree}
          expanded={expandedFolders}
          selectedPath={selectedFilePath}
          onToggle={(p) => setExpandedFolders((prev) => ({ ...prev, [p]: !prev[p] }))}
          onSelect={(p) => setSelectedFilePath(p)}
          variant="panel"
        />
      </div>
      <div role="separator" onPointerDown={(e) => {
        e.preventDefault()
        const startY = e.clientY
        const startSplit = split
        const row = (e.currentTarget as HTMLElement).parentElement
        const total = row?.getBoundingClientRect().height || 1
        const move = (ev: PointerEvent) => {
          const delta = ev.clientY - startY
          const newSplit = Math.max(0.1, Math.min(0.9, startSplit + delta / total))
          setSplit(newSplit)
        }
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
        addEventListener('pointermove', move)
        addEventListener('pointerup', up, { once: true })
      }} className="h-px shrink-0 cursor-row-resize bg-transparent hover:bg-ac/20 sm:block" aria-label="Resize workspace sections" aria-orientation="horizontal" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ flex: `0 0 ${(1 - split) * 100}%` }}>
        {selectedFile && (
          <div className="flex min-h-0 flex-1 flex-col bg-code">
            <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
              <span className="rounded bg-codeh px-1.5 py-0.5 font-mono text-xs text-mu">{highlightLang}</span>
              <span className="text-xs text-mu">{workspaceLines(selectedFile.content)} lines · {workspaceSize(selectedFile.content)}</span>
              {selectedFile.path === writingPath && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ac"><span className="size-1.5 animate-pulse rounded-full bg-ac" />Writing…</span>}
              <span className="flex-1" />
              <div role="tablist" aria-label="File view" className="inline-flex items-center gap-1 rounded-lg bg-codeh p-0.5">
                {(['code', 'preview', 'diff'] as const).filter((v) => v !== 'preview' || canPreview).map((v) => (
                  <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx('rounded-md px-2 py-1 text-xs capitalize', view === v ? 'bg-hov text-tx' : 'text-mu hover:text-tx')}>
                    {v === 'code' ? 'Code' : v === 'preview' ? 'Preview' : 'Diff'}
                  </button>
                ))}
              </div>
              <Btn sm icon={flash === 'download' ? Check : Download} title="Download file" onClick={() => { downloadOne(selectedFile.path, selectedFile.content); flashFor('download') }} />
              <Btn sm icon={Pencil} title="Edit locally" onClick={() => { setDraft(selectedFile.content); setEditing(true); setView('code') }} />
              <Btn sm icon={flash === 'copy' ? Check : Copy} title="Copy file" onClick={() => { copy(selectedFile.content); flashFor('copy') }} />
              <Btn sm icon={Send} title="Ask about this file in chat" onClick={askAboutFile} />
              <Btn sm icon={Trash2} title="Delete file" onClick={() => setConfirmDelete(true)} />
            </div>
            {view === 'diff' && (
              <div className="flex flex-wrap items-center gap-2 px-4 pt-2 text-xs text-mu">
                <DiffIcon size={13} className="shrink-0" />
                <span>vs</span>
                <select
                  value={diffBaseRev?.id ?? ''}
                  onChange={(e) => setDiffBaseId(e.target.value || null)}
                  className="max-w-56 truncate rounded-md bg-codeh px-1.5 py-1 text-xs outline-none"
                  aria-label="Compare against revision"
                >
                  {!diffBaseRev && <option value="">No earlier version</option>}
                  {olderRevs.map((r, i) => <option key={r.id} value={r.id}>{r.name} (v{i + 1})</option>)}
                </select>
                {revChanges.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {revChanges.slice(0, 8).map((c) => (
                      <button
                        key={c.path}
                        onClick={() => { setSelectedFilePath(c.path); setExpandedFolders((prev) => ({ ...prev, ...expandedFoldersForPath(c.path) })) }}
                        title={`${c.path} · ${c.status}`}
                        className={cx('rounded px-1.5 py-0.5 font-mono', c.path === selectedFile.path ? 'bg-ac/20 text-tx' : 'bg-codeh hover:text-tx', c.status === 'added' && 'text-ac', c.status === 'removed' && 'text-er')}
                      >
                        {c.status === 'added' ? '+' : c.status === 'removed' ? '−' : '~'}{base(c.path)}
                      </button>
                    ))}
                    {revChanges.length > 8 && <span>+{revChanges.length - 8} more</span>}
                  </span>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {editing ? (
                <div className="flex h-full min-h-0 flex-col gap-2 p-4">
                  <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none rounded-lg bg-bg p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ac/40" />
                  <div className="flex justify-end gap-2">
                    <Btn v="soft" onClick={() => setEditing(false)}>Cancel</Btn>
                    <Btn v="solid" icon={Save} onClick={saveLocalEdit}>Save as new revision</Btn>
                  </div>
                </div>
              ) : view === 'preview' && canPreview ? (
                <FilePreview path={selectedFile.path} language={selectedFile.language} content={selectedFile.content} />
              ) : view === 'diff' ? (
                <DiffView oldText={diffBaseContent} newText={selectedFile.content} />
              ) : (
                <Md t={fence(highlightLang, selectedFile.content)} bare />
              )}
            </div>
          </div>
        )}
        {!selectedFile && files.length === 0 && (
          <p className="px-3 pt-2 text-sm text-mu">No files in this revision.</p>
        )}

      </div>
      {confirmDelete && selectedFile && (
        <Confirm title="Delete this file?" text={`"${selectedFile.path}" is removed in a new "Removed" revision. The model can recreate it later.`} ok="Delete file" close={() => setConfirmDelete(false)} run={deleteLocalFile} />
      )}
      {gistOpen && <GistModal workspace={workspace} revision={revision} close={() => setGistOpen(false)} />}
    </div>
  )
}

/* Optional Gist sharing dialog. The token is the user's own (BYOK-style), kept
 * in the synced settings store, and only sent to GitHub when they press Share. */
function GistModal({ workspace, revision, close }: { workspace: Workspace; revision: WorkspaceRevision; close: () => void }) {
  const token = useS((s) => s.gistToken ?? '')
  const setToken = (v: string) => useS.getState().patch({ gistToken: v })
  const [desc, setDesc] = useState(workspace.name)
  const [pub, setPub] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')
  const share = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      const url = await exportGist(token, desc, pub, revision.files)
      setResult(url)
    } catch (x: any) { setError(String(x?.message ?? x)) }
    finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div role="dialog" aria-modal="true" aria-label="Share workspace via Gist" className="w-full max-w-md space-y-4 rounded-2xl border border-bor bg-bg p-5">
        <div className="flex items-center gap-2 font-semibold"><Share2 size={18} className="text-ac" />Share via GitHub Gist</div>
        <p className="text-sm text-mu">Optional: shares the {revision.files.length} file{revision.files.length === 1 ? '' : 's'} of “{revision.name}” as a gist. Needs a classic personal access token with the <b>gist</b> scope; it is stored with your settings and encrypted when device sync is on.</p>
        <Field label="GitHub token (gist scope)">
          <Input type="password" value={token} set={setToken} placeholder="ghp_…" />
        </Field>
        <Field label="Gist description">
          <Input value={desc} set={setDesc} placeholder={workspace.name} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Public gist</span>
          <Toggle on={pub} set={setPub} label="Public gist" />
        </div>
        {error && <p className="text-sm text-er">{error}</p>}
        {result && <p className="text-sm">Shared: <a href={result} target="_blank" rel="noopener noreferrer nofollow" className="text-ac underline">{result}</a></p>}
        <div className="flex justify-end gap-2">
          <Btn v="soft" onClick={close}>Close</Btn>
          <Btn v="solid" icon={Share2} disabled={busy || !token.trim()} onClick={share}>{busy ? 'Sharing…' : 'Share'}</Btn>
        </div>
      </div>
    </div>
  )
}

/* Back-compat: old `Canvas` import still renders the compact tile. */
export function Canvas({ msg, live }: { msg: Msg; live?: ToolCall[] }) {
  return <WorkspaceTile msg={msg} live={live} workspace={{ id: '', name: '', revisions: [] }} selectedRevisionId={null} onOpen={() => {}} onSelectRevision={() => {}} />
}