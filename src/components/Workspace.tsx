import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Check, Copy, ChevronRight, Download, FileCode, FileJson, FileText, FileType, Globe, Image, Music, Video, Braces, Terminal, Database, Cog, Hash, PenTool, LayoutTemplate, Sparkles, File, Files, Folder, FolderOpen, Pencil, X, type LucideIcon } from 'lucide-react'
import { strToU8, zipSync } from 'fflate'
import { useS, type Msg } from '../store'
import { clampWorkspaceSplit } from '../layout'
import type { ToolCall } from '../engine'
import { Md } from './Md'
import { Btn, cx } from './ui'
import { WORKSPACE_MAX_FILES, buildZipEntries, workspaceLines, workspaceSize, buildFolderTree, expandedFoldersForPath, extractWorkspaceIds, findWritingPath, groupWorkspaceVersions, sanitizePath, zipFilename, type Workspace, type WorkspaceRevision } from '../workspace'

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
  const liveCalls = useMemo(() => (live ?? []).filter((c) => c.name === 'workspace_upsert' || !c.name), [live])
  const groups = useMemo(() => {
    const done = new Set(finalCalls.map((c) => c.id))
    const pending = liveCalls.filter((c) => !c.id || !done.has(c.id))
    return groupWorkspaceVersions([...finalCalls, ...pending.map((c) => ({ ...c }))])
  }, [finalCalls, liveCalls])
  const total = groups.length
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

  // Auto-expand only folders leading to writing file; mirror panel
  useEffect(() => {
    setExpandedFolders(expandedFoldersForPath(writingPath))
  }, [writingPath])

  // Build nested folder tree for expandable folders
  const folderTree = useMemo(() => buildFolderTree(revision.files), [revision.files])

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] }))
  }

  return (
    <section aria-label="Workspace files" className="space-y-2 rounded-xl border border-hov bg-surf/50 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Files size={15} className="shrink-0 text-ac" />
        <span className="truncate font-medium">{workspace.name}</span>
        <span className="text-xs text-mu">· {total} file{total === 1 ? '' : 's'}</span>
        <span className="text-xs text-mu">· {revision.name}</span>
        {isLive && writingPath && (
          <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs text-mu ml-auto">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ac" />
            <span className="truncate">Writing {writingPath}…</span>
          </span>
        )}
        {total > WORKSPACE_MAX_FILES && <span className="shrink-0 text-xs text-mu">(showing first {WORKSPACE_MAX_FILES})</span>}
      </div>
      <div className="max-h-200 overflow-y-auto space-y-1 border-t border-hov pt-2 mt-1">
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
            onSelect={onSelectRevision}
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
        className="flex w-full items-center gap-2 rounded-lg border border-hov bg-bg px-2.5 py-1.5 text-left text-sm hover:bg-hov"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate font-mono text-sm">{selected.name}</span>
        <span className="shrink-0 text-xs text-mu">v{workspace.revisions.findIndex(r => r.id === selected.id) + 1} of {workspace.revisions.length}</span>
        <span className="flex-1" />
        <span className="shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 max-h-60 overflow-y-auto rounded-xl border border-hov bg-surf shadow-lg z-10">
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
  const [pinned, setPinned] = useState<Record<string, number>>({})
  const [edits, setEdits] = useState<Record<string, { content: string; language: string }[]>>({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const split = clampWorkspaceSplit(storedSplit)
  const setSplit = (v: number) => {
    const st = useS.getState()
    st.patch({ prefs: { ...st.prefs, workspaceSplit: Math.round(clampWorkspaceSplit(v) * 1000) / 1000 } })
  }
  const initialPathRef = useRef(initialFilePath)

  const revision = workspace.revisions.find(r => r.id === selectedRevisionId) ?? workspace.revisions[workspace.revisions.length - 1]
  const { groups, total, isLive } = useWorkspaceFiles(msg, live)

  // Determine the file currently being written by the AI
  const writingPath = useMemo(() => findWritingPath(live, msg.toolRounds), [msg.toolRounds, live])

  // Exit edit mode whenever the followed file changes (e.g. AI starts writing another file).
  useEffect(() => { setEditing(false) }, [revision.id])

  // Set initial file path from prop (only on mount)
  useEffect(() => {
    if (initialPathRef.current && !selectedFilePath) {
      setSelectedFilePath(initialPathRef.current)
      // Ensure the folder containing this file is expanded
      setExpandedFolders((prev) => ({ ...prev, ...expandedFoldersForPath(initialPathRef.current) }))
    }
  }, [])

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
    if (revision.files.length > 0 && !selectedFilePath && !writingPath && !initialPathRef.current) {
      setSelectedFilePath(revision.files[0].path)
    }
  }, [revision.id, revision.files, selectedFilePath, writingPath])

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

  // Build folder tree for expandable folders
  const folderTree = useMemo(() => buildFolderTree(files), [files])

  const selectedFile = files.find(f => f.path === selectedFilePath) ?? files[0]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hov px-3 py-2">
        <Files size={15} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.name} · {total} file{total === 1 ? '' : 's'}</span>
        <WorkspaceRevisionPicker
          workspace={workspace}
          selectedId={selectedRevisionId}
          onSelect={setSelectedRevisionId}
          className="w-48"
        />
        {isLive && <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-mu"><span className="size-1.5 animate-pulse rounded-full bg-ac" />Writing…</span>}
        <Btn sm icon={X} title="Close workspace panel" onClick={() => { setSelectedFilePath(null); onClose(); }} />
      </div>
      <div role="tree" aria-label="Workspace files" className="min-h-0 overflow-y-auto border-b border-hov px-2 py-2" style={{ flex: `0 0 ${split * 100}%` }}>
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
              {selectedFile.language && <span className="rounded bg-codeh px-1.5 py-0.5 font-mono text-xs text-mu">{selectedFile.language}</span>}
              <span className="text-xs text-mu">{workspaceLines(selectedFile.content)} lines · {workspaceSize(selectedFile.content)}</span>
              {selectedFile.path === writingPath && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ac"><span className="size-1.5 animate-pulse rounded-full bg-ac" />Writing…</span>}
              <span className="flex-1" />
              <Btn sm icon={Download} title="Download file" onClick={() => downloadOne(selectedFile.path, selectedFile.content)} />
              <Btn sm icon={Pencil} title="Edit locally" onClick={() => { setDraft(selectedFile.content); setEditing(true) }} />
              <Btn sm icon={Copy} title="Copy file" onClick={() => copy(selectedFile.content)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Md t={fence(selectedFile.language, selectedFile.content)} bare />
            </div>
          </div>
        )}
        {!selectedFile && files.length === 0 && (
          <p className="px-3 pt-2 text-sm text-mu">No files in this revision.</p>
        )}

      </div>
    </div>
  )
}

/* Back-compat: old `Canvas` import still renders the compact tile. */
export function Canvas({ msg, live }: { msg: Msg; live?: ToolCall[] }) {
  return <WorkspaceTile msg={msg} live={live} workspace={{ id: '', name: '', revisions: [] }} selectedRevisionId={null} onOpen={() => {}} onSelectRevision={() => {}} />
}