import { useEffect, useMemo, useState } from 'react'
import { Archive, Check, Copy, Download, FileText, Files, Pencil, RotateCcw, X } from 'lucide-react'
import { strToU8, zipSync } from 'fflate'
import { useS, type Msg } from '../store'
import type { ToolCall } from '../engine'
import { CANVAS_MAX_FILES, buildZipEntries, canvasLines, canvasSize, groupCanvasVersions, sanitizePath, zipFilename } from '../canvas'
import { Md } from './Md'
import { Btn, cx } from './ui'

const fence = (lang: string, code: string) => {
  const runs = code.match(/`{3,}/g)
  const n = runs ? Math.max(...runs.map((x) => x.length)) + 1 : 3
  const f = '`'.repeat(n)
  return `${f}${lang || 'text'}\n${code}\n${f}`
}
const base = (p: string) => sanitizePath(p).split('/').pop() || 'file.txt'
export const saveBlob = (name: string, blob: Blob) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 999)
}

export function useCanvasGroups(msg: Msg, live?: ToolCall[]) {
  const finalCalls = useMemo(() => (msg.toolRounds ?? []).flatMap((r) => r.calls), [msg.toolRounds])
  const liveCalls = useMemo(() => (live ?? []).filter((c) => c.name === 'canvas_upsert' || !c.name), [live])
  const groups = useMemo(() => {
    // Merge finished rounds with in-flight streaming calls so new files appear
    // the moment they start, even while earlier files are already final.
    const done = new Set(finalCalls.filter((c) => c.name === 'canvas_upsert').map((c) => c.id))
    const pending = liveCalls.filter((c) => !c.id || !done.has(c.id))
    return groupCanvasVersions([...finalCalls, ...pending.map((c) => ({ ...c }))])
  }, [finalCalls, liveCalls])
  const total = groups.length
  const isLive = liveCalls.length > 0
  return { groups, total, isLive }
}

export function downloadAllFiles(groups: { path: string; versions: { action: string; content: string }[] }[], edits: Record<string, { content: string }[]>) {
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
  const entries = buildZipEntries(files)
  const obj: Record<string, Uint8Array> = {}
  for (const e of entries) obj[e.path] = strToU8(e.content)
  saveBlob(zipFilename(files), new Blob([zipSync(obj)], { type: 'application/zip' }))
}

/* Compact rail beneath the reply: vertical cards + download-all at the bottom. */
export function CanvasRail({ msg, live, onOpen, selected }: { msg: Msg; live?: ToolCall[]; onOpen?: (path: string) => void; selected?: string | null }) {
  const { groups, total, isLive } = useCanvasGroups(msg, live)
  if (!groups.length) return null
  const lastPath = groups[groups.length - 1]?.path
  return (
    <section aria-label="Canvas files" className="space-y-2 rounded-xl border border-hov bg-surf/50 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Files size={15} className="shrink-0 text-ac" />
        <span className="truncate font-medium">Canvas files · {total} file{total === 1 ? '' : 's'}</span>
        {isLive && lastPath && (
          <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-xs text-mu">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ac" />
            <span className="truncate">Writing {lastPath}</span>
          </span>
        )}
        {total > CANVAS_MAX_FILES && <span className="shrink-0 text-xs text-mu">(showing first {CANVAS_MAX_FILES})</span>}
      </div>
      <div className="space-y-2">
        {groups.map((g) => {
          const ver = g.versions[g.versions.length - 1]
          const deleted = ver?.action === 'delete'
          return (
            <button
              key={g.path}
              onClick={() => onOpen?.(g.path)}
              title={`Open ${g.path} in the side panel`}
              aria-current={g.path === selected}
              className={cx('flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-hov', g.path === selected ? 'border-ac bg-ac/10' : 'border-hov bg-bg/60')}
            >
              <FileText size={15} className="shrink-0 text-ac" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{base(g.path)}</span>
                <span className="block truncate font-mono text-[11px] text-mu">{g.path}</span>
              </span>
              {g.versions[0]?.language && <span className="shrink-0 rounded bg-hov px-1.5 py-0.5 font-mono text-[11px] text-mu">{g.versions[g.versions.length - 1].language || g.versions[0].language}</span>}
              {g.versions.length > 1 && <span className="shrink-0 text-xs text-mu">v{g.versions.length}</span>}
              {deleted
                ? <span className="shrink-0 text-xs text-mu">deleted</span>
                : <span className="shrink-0 text-xs text-mu">{canvasLines(ver.content)} lines</span>}
            </button>
          )
        })}
      </div>
      <Btn v="soft" icon={Archive} onClick={() => downloadAllFiles(groups, {})} className="w-full">Download all</Btn>
    </section>
  )
}

/* Full file viewer rendered in the resizable splitscreen on the right. */
export function CanvasPanel({ msg, live, path, setPath, onClose }: { msg: Msg; live?: ToolCall[]; path: string | null; setPath: (p: string) => void; onClose: () => void }) {
  const send = useS((s) => s.send)
  const busy = useS((s) => s.busy)
  const [pinned, setPinned] = useState<Record<string, number>>({})
  const [edits, setEdits] = useState<Record<string, { content: string; language: string }[]>>({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const { groups, total, isLive } = useCanvasGroups(msg, live)
  // Exit edit mode whenever the followed file changes (e.g. AI starts writing another file).
  useEffect(() => { setEditing(false) }, [path])
  if (!groups.length) return null
  const cur = (path ? groups.find((g) => g.path === path) : undefined) ?? groups[0]
  const local = edits[cur.path] ?? []
  const versions = [...cur.versions, ...local.map((e, i) => ({ action: 'update', path: cur.path, language: e.language, content: e.content, label: 'local edit', callId: `local-${i}` }))]
  const idx = Math.min(pinned[cur.path] ?? versions.length - 1, versions.length - 1)
  const ver = versions[idx]
  const deleted = ver.action === 'delete'
  const copy = (s: string) => { navigator.clipboard?.writeText(s); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  const downloadOne = (p: string, content: string) => saveBlob(base(p), new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const restore = () => {
    if (busy) return
    void send(`Please restore file "${cur.path}" to version ${idx + 1} of ${versions.length} (the earlier version shown, not the latest). Call canvas_upsert with action "update", the same path, and that version's exact content.`, [])
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hov px-3 py-2">
        <Files size={15} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Canvas · {total} file{total === 1 ? '' : 's'}</span>
        {isLive && <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-mu"><span className="size-1.5 animate-pulse rounded-full bg-ac" />Writing…</span>}
        <Btn sm icon={X} title="Close canvas panel" onClick={onClose} />
      </div>
      <div role="tablist" aria-label="Canvas files" className="max-h-48 space-y-2 overflow-y-auto border-b border-hov px-3 py-2">
        {Object.entries(
          groups.reduce<Record<string, typeof groups>>((acc, g) => {
            const i = g.path.lastIndexOf('/')
            const dir = i >= 0 ? g.path.slice(0, i) : '/'
            ;(acc[dir] ??= []).push(g)
            return acc
          }, {}),
        ).map(([dir, files]) => (
          <div key={dir}>
            <div className="px-1 pb-1 font-mono text-[11px] tracking-wide text-mu">{dir}</div>
            <div className="flex flex-wrap gap-1.5">
              {files.map((g) => (
                <button key={g.path} role="tab" aria-selected={g.path === cur.path} title={g.path} onClick={() => { setPath(g.path); setEditing(false) }} className={cx('inline-flex min-h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-left text-sm transition-colors', g.path === cur.path ? 'border-ac bg-ac/10' : 'border-hov hover:bg-hov')}>
                  <span className="max-w-36 truncate font-mono text-[13px]">{base(g.path)}</span>
                  {g.versions.length > 1 && <span className="text-xs text-mu">v{g.versions.length}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {versions.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 px-3 pt-3 text-xs text-mu">
            <span className="inline-flex items-center gap-1" role="group" aria-label="Version">
              {versions.map((_, i) => (
                <button key={i} onClick={() => { setPinned((v) => ({ ...v, [cur.path]: i })); setEditing(false) }} aria-pressed={i === idx} title={versions[i].label ?? `Version ${i + 1}`} className={cx('rounded px-1.5 py-0.5 font-mono', i === idx ? 'bg-ac text-acx' : 'bg-hov hover:text-tx')}>v{i + 1}</button>
              ))}
            </span>
          </div>
        )}
        {deleted ? (
          <p className="px-3 pt-2 text-sm text-mu">This file was deleted{versions.length > 1 ? ' — select an earlier version to preview or restore it' : ''}.</p>
        ) : editing ? (
          <div className="space-y-2 px-3 pt-2">
            <textarea autoFocus rows={20} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Edit ${cur.path}`} className="w-full resize-y rounded-lg bg-code px-3 py-2 font-mono text-[13px] leading-6 outline-none focus:ring-2 focus:ring-ac/40" />
            <p className="text-xs text-mu">Edits are local to this browser and kept as a new version above.</p>
            <div className="flex justify-end gap-2">
              <Btn v="soft" onClick={() => setEditing(false)}>Cancel</Btn>
              <Btn v="solid" icon={Check} onClick={() => { setEdits((v) => ({ ...v, [cur.path]: [...(v[cur.path] ?? []), { content: draft, language: ver.language }] })); setEditing(false); setPinned((p) => ({ ...p, [cur.path]: versions.length })) }}>Save edit</Btn>
            </div>
          </div>
        ) : (
          <div className="bg-code">
            <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
              {ver.language && <span className="rounded bg-codeh px-1.5 py-0.5 font-mono text-[11px] text-mu">{ver.language}</span>}
              <span className="text-xs text-mu">{canvasLines(ver.content)} lines · {canvasSize(ver.content)}</span>
              <span className="flex-1" />
              <Btn sm icon={Download} title="Download file" onClick={() => downloadOne(cur.path, ver.content)} />
              <Btn sm icon={Pencil} title="Edit locally" onClick={() => { setDraft(ver.content); setEditing(true) }} />
              <Btn icon={copied ? Check : Copy} title="Copy file" onClick={() => copy(ver.content)} />
            </div>
            <Md t={fence(ver.language, ver.content)} bare />
          </div>
        )}
        {!deleted && !editing && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
            {idx < versions.length - 1 && !isLive && <Btn sm v="soft" icon={RotateCcw} title={`Restore this version as v${versions.length + 1}`} onClick={restore}>Restore as new version</Btn>}
            {idx < versions.length - 1 && <span className="text-xs text-mu">Viewing v{idx + 1} of {versions.length}</span>}
          </div>
        )}
      </div>
      <div className="border-t border-hov p-3">
        <Btn v="soft" icon={Archive} onClick={() => downloadAllFiles(groups, edits)} className="w-full">Download all</Btn>
      </div>
    </div>
  )
}

/* Back-compat: old import still renders the compact rail. */
export function Canvas({ msg, live }: { msg: Msg; live?: ToolCall[] }) {
  return <CanvasRail msg={msg} live={live} />
}
