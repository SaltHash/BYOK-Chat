import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { GitBranch, ChevronLeft, ChevronRight, ChevronDown, Server, Cpu, Copy, Check, RefreshCw, Trash2, ListOrdered, TriangleAlert, Paperclip, Download, ExternalLink, Volume2, Pin, PinOff, Search, ArrowUp, ArrowDown, X, Quote } from 'lucide-react'
import { useS, useLive, usable, featOn, previewSysFor, activeWorkspaceForChat, pinnedReplyOf, type LogDetail, type Msg } from '../store'
import { clampWorkspaceFrac, roundFrac, CHAT_WIDTH } from '../layout'
import { focusComposer, startPointerDrag } from '../hooks'
import { createFrameThrottle } from '../throttle'
import { CI, fmtDuration } from '../meta'
import { formatMsgDateTime, formatMsgTime } from '../time'
import { Btn, Chip, cx, ZoomableImage, type Ic } from './ui'
import { Composer } from './Composer'
import { ProjectOverview } from './ProjectOverview'
import { Header } from './Header'
import { MessageActions } from './ReplyActions'
import { GraphCards, hasPlacedGraphs } from './Graph'
import { Tutorial } from './Extra'
import { Md, UserText } from './Md'
import { activityLine, flairLine, thinkingLine, TEMPORARY_NOTE } from '../flair'
import { splitStream } from '../streamMd'
import { WorkspaceTile, WorkspacePanel } from './Workspace'
import { ResearchTierPicker, ResearchPlanCard, ResearchProgressCard, ResearchTile, ResearchPanel } from './Research'
import { SourcesPanel, scrollToSource } from './Sources'
import { claimForCitation, collectMessageSources, linkifyCitations, messageForCopy, parseSearchEvidence, stripCitations } from '../citations'
import { findWritingPath, extractWorkspaceIds, type WorkspaceCallLike } from '../workspace'
import { imageRefsFromRounds, imageSrc, type GeneratedImage } from '../imagegen'
import { blobGet } from '../storage/durable'
import { normVoice, speak, speechAvailable, voiceOn } from '../voice'

function toolStep(name: string, rawArgs: string, result?: string) {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(rawArgs || '{}') } catch { /* Keep the action label if arguments are malformed. */ }
  const query = typeof args.query === 'string' ? args.query : ''
  const expression = typeof args.expression === 'string' ? args.expression : ''
  const text = typeof args.text === 'string' ? args.text : ''
  if (name === 'prompt_chip') return `Follow-up · ${typeof args.label === 'string' ? args.label : 'Continue'}`
  if (name === 'inline_poll') {
    const questions = Array.isArray(args.questions) ? args.questions : []
    const first = questions[0] && typeof questions[0] === 'object' ? (questions[0] as Record<string, unknown>).label : ''
    const label = typeof args.question === 'string' ? args.question : typeof first === 'string' ? first : ''
    return `Choice · ${label || 'Quick questions'}`
  }
  const clip = (s: string, n = 90) => s.length > n ? `${s.slice(0, n)}…` : s
  if (name.startsWith('mcp_')) {
    const label = name.slice(4).replace(/_/g, ' ')
    const inputs = Object.entries(args).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'string' ? clip(v, 60) : JSON.stringify(v)}`).join(', ')
    return `MCP · ${label}${inputs ? ` (${inputs})` : ''}`
  }
  if (name === 'workspace_upsert') {
    const action = typeof args.action === 'string' ? args.action : 'file'
    const path = typeof args.path === 'string' ? args.path : ''
    const workspaceId = typeof args.workspaceId === 'string' ? args.workspaceId : ''
    const wsLabel = workspaceId ? ` (ws:${workspaceId.slice(0, 8)})` : ''
    // One file per call: a tool call that still carries a list is shown as
    // such, because the tool refuses it.
    const batch = Array.isArray(args.files) ? args.files.length : 0
    let info: Record<string, unknown> | null = null
    try { info = result ? JSON.parse(result) : null } catch { /* error text has no fields */ }
    const num = (key: string) => (typeof info?.[key] === 'number' ? info[key] as number : null)
    if (batch) return `Workspace file · batch of ${batch} refused: ${action} ${clip(path, 60)}${wsLabel}`
    if (action === 'list') {
      const n = num('matchedFiles') ?? num('fileCount') ?? 0
      return `Workspace · listed ${n} file${n === 1 ? '' : 's'}${wsLabel}`
    }
    if (action === 'search') {
      const q = typeof args.query === 'string' ? args.query : ''
      const n = num('totalMatches')
      return `Workspace search · “${clip(q || 'missing query', 60)}”${n == null ? '' : ` · ${n} match${n === 1 ? '' : 'es'}`}${wsLabel}`
    }
    if (action === 'read') {
      const from = typeof args.startLine === 'number' ? args.startLine : null
      const to = typeof args.endLine === 'number' ? args.endLine : null
      const range = from == null && to == null
        ? ''
        : from != null && to != null && from === to
          ? ` (line ${from})`
          : ` (lines ${from ?? 1}–${to ?? 'end'})`
      return `Workspace read · ${clip(path || 'file', 80)}${range}${wsLabel}`
    }
    if (action === 'diff') {
      const added = num('added'), removed = num('removed')
      const stat = added == null && removed == null ? '' : ` (+${added ?? 0} −${removed ?? 0})`
      return `Workspace diff · ${clip(path || 'file', 70)}${stat}${wsLabel}`
    }
    if (action === 'move') {
      const to = typeof args.to === 'string' ? args.to : ''
      return `Workspace file · move ${clip(path || 'file', 50)} → ${clip(to || 'missing path', 50)}${wsLabel}`
    }
    if (action === 'patch' && args.dryRun === true) return `Workspace preview · ${clip(path || 'file', 80)}${wsLabel}`
    return `Workspace file · ${action}: ${clip(path || 'file', 80)}${wsLabel}`
  }
  if (name === 'search') {
    const responses = result?.match(/\[Source [^\]]+\]/g)?.length
    let meta = ''
    try {
      if (result) {
        const parsed = parseSearchEvidence(result)
        const bits = [`${parsed.sources.length || responses || 0} sources`]
        if (parsed.provider) bits.push(parsed.provider)
        if (parsed.query) bits.push(`“${clip(parsed.query, 60)}”`)
        else if (query) bits.push(`“${clip(query, 60)}”`)
        meta = ` (${bits.join(' · ')})`
      }
    } catch { /* fall back to the query-only label */ }
    return `Web search · query: “${clip(query || 'missing query')}”${responses == null ? '' : meta || ` (${responses} responses)`}`
  }
  if (name === 'fetch_page') {
    let label = ''
    // A summarized read is labelled apart from a raw excerpt, so the process
    // log shows that a second model was involved.
    const summarized = /^\s*Page summary/i.test(String(result ?? ''))
    try {
      const j = JSON.parse(result ?? '')
      const title = typeof j?.title === 'string' ? j.title : ''
      const url = typeof j?.url === 'string' ? j.url : (typeof args.url === 'string' ? args.url : '')
      let host = ''
      try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep empty */ }
      label = [title ? `“${clip(title, 70)}”` : '', host].filter(Boolean).join(' · ') || clip(String(args.url ?? 'page'), 80)
    } catch { label = clip(String(args.url ?? 'page'), 80) }
    return `${summarized ? 'Page summary' : 'Page reader'} · ${label || 'page'}`
  }
  if (name === 'time') return 'Checked the current date and time'
  if (name === 'date') return 'Checked the current date'
  if (name === 'calc') return `Calculator · expression: ${expression || 'missing expression'}`
  if (name === 'count') return `Text count · input: ${text ? `${text.length} characters` : 'text unavailable'}`
  if (name === 'json') return `JSON formatter · input: ${text ? `${text.length} characters` : 'text unavailable'}`
  if (name === 'base64') return `Base64 encoder · input: ${text ? `${text.length} characters` : 'text unavailable'}`
  if (name === 'location') return 'Checked approximate location'
  if (name === 'clipboard') return 'Clipboard · read current clipboard (contents hidden)'
  if (name === 'uuid') return 'Generated a UUID'
  if (name === 'random') return `Random integer · range: ${String(args.min ?? 1)}–${String(args.max ?? 100)}`
  if (name === 'hash') return `SHA-256 · input: ${text ? `${text.length} characters` : 'text unavailable'}`
  if (name === 'memory') {
    const action = typeof args.action === 'string' ? args.action : 'unknown action'
    if (action === 'list') return 'Memory · listed stored entries (IDs, categories, and summaries returned to model)'
    if (action === 'add') return `Memory · added${typeof args.category === 'string' ? ` to ${clip(args.category, 40)}` : ''}${text ? ` · summary: “${clip(text)}”` : ''}`
    if (action === 'update') return `Memory · updated entry ${String(args.id ?? '(missing id)')}${text ? ` · new summary: “${clip(text)}”` : ''}`
    if (action === 'delete') return `Memory · deleted entry ${String(args.id ?? '(missing id)')}`
    return `Memory · ${action}`
  }
  if (name === 'graph') {
    const title = typeof args.title === 'string' ? args.title : ''
    const equations = Array.isArray(args.equations) ? args.equations.length : 0
    const series = Array.isArray(args.series) ? args.series.length : 0
    const points = Array.isArray(args.points) ? args.points.length : 0
    const shapes = Array.isArray(args.shapes) ? args.shapes.length : 0
    const bits = [equations ? `${equations} equation${equations === 1 ? '' : 's'}` : '', series ? `${series} series` : '', points ? `${points} point${points === 1 ? '' : 's'}` : '', shapes ? `${shapes} shape${shapes === 1 ? '' : 's'}` : ''].filter(Boolean)
    return `Graph · ${title ? `“${clip(title, 60)}”` : 'plot'}${bits.length ? ` (${bits.join(' · ')})` : ''}`
  }
  if (name === 'use_skill') {
    let id = ''
    try { const a = JSON.parse(rawArgs || '{}'); if (a && typeof a.id === 'string') id = a.id } catch { /* Keep the generic label. */ }
    return `Skill · loaded instructions for “${clip(id || 'unknown skill', 60)}”`
  }
  if (name === 'run_code') {
    const language = args.language === 'python' ? 'Python' : 'JavaScript'
    const code = typeof args.code === 'string' ? args.code : ''
    const lines = code ? code.split('\n').length : 0
    return `Code · ${language}${lines ? ` · ${lines} line${lines === 1 ? '' : 's'}` : ''}`
  }
  return `Tool ${name} · inputs: ${Object.keys(args).length ? Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? clip(v, 60) : String(v)}`).join(', ') : 'none'}`
}

/* A tool step reads as a process node: a short name on the node itself and the
 * details underneath it. `toolStep` already puts the name first and separates
 * it with a middot, so a label without one falls back to the tool's own name. */
const TOOL_NAMES: Record<string, string> = {
  search: 'Web search',
  fetch_page: 'Page reader',
  time: 'Time',
  date: 'Date',
  calc: 'Calculator',
  count: 'Text count',
  json: 'JSON formatter',
  base64: 'Base64 encoder',
  location: 'Location',
  clipboard: 'Clipboard',
  uuid: 'UUID',
  random: 'Random integer',
  hash: 'SHA-256',
  memory: 'Memory',
  graph: 'Graph',
  run_code: 'Code',
  use_skill: 'Skill',
  prompt_chip: 'Follow-up',
  inline_poll: 'Choice',
}
const toolName = (id: string) => TOOL_NAMES[id] ?? (id.startsWith('mcp_') ? `MCP · ${id.slice(4).replace(/_/g, ' ')}` : id)
/* Name on the node, details below it — the same split for saved calls and for
 * a call that is still running. */
function toolNode(label: string, id: string): [string, string] {
  const cut = label.indexOf(' · ')
  return cut < 0 ? [toolName(id), label] : [label.slice(0, cut), label.slice(cut + 3)]
}
/* Generated images live in durable local storage and are referenced by id in
 * the tool result, so the chat never carries base64. Each strip loads lazily. */
function ImageGroup({ id }: { id: string }) {
  const [images, setImages] = useState<GeneratedImage[] | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let live = true
    void blobGet(id).then((raw) => {
      if (!live) return
      if (!raw) { setMissing(true); return }
      try {
        const v = JSON.parse(raw)
        if (Array.isArray(v) && v.length) setImages(v)
        else setMissing(true)
      } catch { setMissing(true) }
    }).catch(() => { if (live) setMissing(true) })
    return () => { live = false }
  }, [id])
  if (missing) return <p className="text-xs text-mu">This generated image is no longer in local storage.</p>
  if (!images) return <div aria-label="Loading generated image" className="h-48 w-48 animate-pulse rounded-xl bg-surf" />
  return (
    <div className="flex flex-wrap gap-3">
      {images.map((img, i) => {
        const src = imageSrc(img)
        if (!src) return null
        return (
          <figure key={i} className="max-w-[min(100%,20rem)] space-y-1.5">
            <ZoomableImage src={src} alt={img.revised || `Generated image ${i + 1}`} loading="lazy" className="max-h-80 rounded-xl border border-bor object-contain" />
            <figcaption className="flex items-center gap-3 text-xs text-mu">
              <a href={src} download={`generated-${i + 1}.png`} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surf hover:text-tx"><Download size={13} />Download</a>
              <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surf hover:text-tx"><ExternalLink size={13} />Open</a>
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}

function GeneratedImages({ rounds }: { rounds?: Msg['toolRounds'] }) {
  const ids = useMemo(() => imageRefsFromRounds(rounds), [rounds])
  if (!ids.length) return null
  return <div className="space-y-3">{ids.map((id) => <ImageGroup key={id} id={id} />)}</div>
}

const duration = (ms?: number) => ms == null ? '' : ` ${fmtDuration(ms, useS.getState().widgetPrefs.timeUnit ?? 'auto')}`
const STEP_CLIP = 180
const prettyArgs = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw || '{}'), null, 1)
  } catch { return raw || '{}' }
}
/* A clipped payload (args/result) with a read-more toggle revealing the whole thing at once. */
function Payload({ label, text, open, onToggle }: { label: string; text: string; open: boolean; onToggle: () => void }) {
  const LIMIT = 2000
  const clipped = text.length > LIMIT
  return (
    <span className="block space-y-1">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-2 font-mono text-xs text-mu">{label}: {open || !clipped ? text : `${text.slice(0, LIMIT)}…`}</pre>
      {clipped && (
        <button onClick={onToggle} className="rounded-md px-1.5 py-0.5 text-xs text-mu hover:bg-bg hover:text-tx">
          {open ? 'Show less' : `Read more (${text.length.toLocaleString()} characters)`}
        </button>
      )}
    </span>
  )
}

/* One saved attempt in the Process-to-answer panel. Where the old panel
 * printed a whole sentence per step, the detail level now decides how much is
 * shown: Compact keeps a row to its name, Standard clips long explanations
 * behind a read-more, Detailed prints everything that was saved. Errors and
 * the step's own timing/model are always kept — those are the parts a reader
 * actually goes looking for. */
function ProcessStep({ t, detail, timing, models, tokens, open, toggle }: {
  t: NonNullable<Msg['log']>[number]
  detail: LogDetail
  timing: boolean
  models: boolean
  tokens: boolean
  open: boolean
  toggle: () => void
}) {
  const text = t.detail ?? ''
  const clipped = detail !== 'verbose' && text.length > STEP_CLIP
  const shown = detail === 'compact' ? '' : clipped && !open ? `${text.slice(0, STEP_CLIP).trimEnd()}…` : text
  const meta = [
    timing && t.ms != null ? duration(t.ms).trim() : '',
    tokens && (t.tin != null || t.tout != null) ? `${t.tin ?? 0} in / ${t.tout ?? 0} out` : '',
  ].filter(Boolean)
  return (
    <li className="process-node">
      <span className="process-dot" data-err={t.err ? '' : undefined} aria-hidden="true" />
      <div className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 break-words">{t.n}</span>
          {models && t.m && t.m !== t.n && <span className="max-w-full truncate text-xs text-mu">{t.m}</span>}
          {meta.length > 0 && <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-mu">{meta.join(' · ')}</span>}
        </span>
        {t.err && <span className="mt-0.5 block break-words text-xs text-er">{t.err}</span>}
        {shown && (
          <span className="mt-0.5 block break-words text-xs text-mu">
            {shown}
            {clipped && <button type="button" onClick={toggle} className="ml-1 rounded text-ac hover:underline">{open ? 'Show less' : 'More'}</button>}
          </span>
        )}
      </div>
    </li>
  )
}

/* During streaming, each provider chunk renders as its own <span> so the
 * fade-in effect applies per chunk. `fade === 0` disables it outright — no
 * spans, no animation, no CSS variable. Once streaming ends the live chunks
 * are cleared and the normal markdown renderer takes over. */
function StreamedText({ chunks, fade }: { chunks: string[]; fade: number }) {
  return (
    /* `whitespace-pre-wrap` keeps the line breaks the model sent: without it the
     * whole reply collapses into one paragraph and wraps wherever the pane
     * happens to break, then reflows when the finished markdown takes over. */
    <span className="md whitespace-pre-wrap leading-7">
      {chunks.map((t, i) => (
        <span key={i} className={fade > 0 ? 'animate-reply-in' : undefined} style={fade > 0 ? { '--reply-in-duration': `${fade}s` } as React.CSSProperties : undefined}>
          {t}
        </span>
      ))}
    </span>
  )
}

/* Markdown during streaming, parsed incrementally. The reply is split at its
 * last settled block boundary (see `splitStream`): the settled blocks are
 * parsed once and re-parsed only when another block completes, while the block
 * still being written is parsed on its own. Both halves share one `.md`
 * container, so the live text sits inside the structure it belongs to — list
 * items keep their indent, quotes their background, tables their column widths
 * — and a growing paragraph is never broken onto a new line mid-sentence. */
function StreamedMd({ chunks, fade }: { chunks: string[]; fade: number }) {
  const full = useMemo(() => chunks.join(''), [chunks])
  /* Tokens arrive far faster than a long reply can be parsed. Handing React the
   * newest text at a lower priority lets it skip the intermediate tokens while
   * a parse is still in flight, instead of queueing one parse per token. */
  const text = useDeferredValue(full)
  const { head, tail } = useMemo(() => splitStream(text), [text])
  /* Characters of the reply already on screen before this render. Only text
   * past this point fades in, and the ref moves forward after each commit. */
  const shown = useRef(0)
  useEffect(() => { shown.current = text.length })
  const seen = fade > 0 ? shown.current : undefined
  return (
    <div className="md leading-7" style={fade > 0 ? { '--reply-in-duration': `${fade}s` } as React.CSSProperties : undefined}>
      {head && <Md t={head} blocks fadeFrom={seen} />}
      {tail && (
        /* Deliberately not keyed by the settled length: remounting the tail at
         * every block boundary would throw away an in-progress text selection.
         * The first/last child margins are flattened so the seam between the
         * two halves matches a normal block gap. */
        <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <Md t={tail} blocks fadeFrom={seen === undefined ? undefined : Math.max(0, seen - head.length)} />
        </div>
      )}
    </div>
  )
}

/* Live progress for a reply that is still being produced: the orbiting dots
 * and the status line, nothing else. It is only mounted while the reply is
 * waiting on something (see `active`), never while text is arriving. */
function ReplyProgress({ status, block }: { status: string; block?: boolean }) {
  return (
    <span className={cx('reply-thinking', block && 'mt-2 block')} role="status" aria-label={status}>
      <span className="reply-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="ml-2 text-mu">{status}</span>
    </span>
  )
}

function applySearchHighlights(el: HTMLElement | null, query?: string, open?: boolean) {
  if (!el) return
  const marks = Array.from(el.querySelectorAll('.search-highlight'))
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    parent.insertBefore(document.createTextNode(mark.textContent ?? ''), mark)
    parent.removeChild(mark)
    parent.normalize()
  }
  const q = query?.trim()
  if (!open || !q) return
  const regex = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (regex.test(text)) {
        regex.lastIndex = 0
        const parts = text.split(regex)
        const frag = document.createDocumentFragment()
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 1) {
            const mark = document.createElement('mark')
            mark.className = 'search-highlight'
            mark.textContent = parts[i]
            frag.appendChild(mark)
          } else {
            frag.appendChild(document.createTextNode(parts[i]))
          }
        }
        node.parentNode?.replaceChild(frag, node)
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'svg') return
      const children = Array.from(node.childNodes)
      for (const child of children) walk(child)
    }
  }
  walk(el)
}

const M = memo(function M({ m, last, onOpenWorkspace, onOpenResearch, selectedWorkspaceId, cfg, searchQuery, searchOpen }: { m: Msg; last: boolean; onOpenWorkspace: (mid: string, workspaceId: string, filePath?: string) => void; onOpenResearch: (mid: string) => void; selectedWorkspaceId?: string | null; cfg: (t: string) => void; searchQuery?: string; searchOpen?: boolean }) {
  // Granular subscriptions: a streamed chunk only changes `chats`, so these
  // slices stay referentially stable and this message does not re-render
  // unless its own `m` prop (or one of these) actually changed.
  const prefs = useS((s) => s.prefs)
  const streamFade = prefs.streamFade
  const streamMd = prefs.streamMd
  const logDetail = prefs.logDetail ?? 'standard'
  const logTiming = prefs.logTiming !== false
  const logModels = prefs.logModels !== false
  const busy = useS((s) => s.busy)
  const advanced = useS((s) => s.advanced)
  const features = useS((s) => s.features)
  const workspaces = useS((s) => s.workspaces)
  // Tile revision pickers must re-render when the selection changes even while
  // the side panel is closed (`React.memo` would otherwise keep the stale id).
  const selectedRevision = useS((s) => s.selectedRevision)
  const adv = featOn({ features }, 'advanced') ? advanced : undefined
  const [sysOpen, setSysOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sysPreview, setSysPreview] = useState<string | null>(null)
  // Saved prompt for new replies; reconstructed from current settings for older ones.
  const sysText = m.sys ?? sysPreview
  const togglePayload = (k: string) => setExpanded((v) => ({ ...v, [k]: !v[k] }))
  const live = useLive((s) => s.tools[m.id])
  const liveChunks = useLive((s) => s.chunks[m.id])
  const [showRawErr, setShowRawErr] = useState(false)
  // Jump-to-message from ranked sidebar search: scroll + temporary highlight.
  const flash = useS((st) => st.flashMsg === m.id)
  useEffect(() => {
    if (!flash) return
    document.getElementById(`msg-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => { if (useS.getState().flashMsg === m.id) useS.getState().patch({ flashMsg: null }) }, 2500)
    return () => clearTimeout(t)
  }, [flash, m.id])
  const [log, setLog] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [ok, setOk] = useState(false)
  const [srcOpen, setSrcOpen] = useState<boolean | null>(null)
  const [srcFlash, setSrcFlash] = useState<string | null>(null)
  const [srcClaim, setSrcClaim] = useState<string | null>(null)
  const searchPrefs = useS((s) => s.search)
  const sources = useMemo(() => collectMessageSources(m.toolRounds), [m.toolRounds])
  const displayText = m.toolFinal ?? m.t
  // While the live streamed text is on screen this output is not rendered, so
  // skip the whole-text linkify pass that would otherwise rerun per chunk.
  const citedText = useMemo(() => {
    if (liveChunks?.length) return displayText
    return searchPrefs?.citeStyle === 'off' ? stripCitations(displayText) : linkifyCitations(displayText, sources)
  }, [displayText, sources, searchPrefs?.citeStyle, liveChunks])
  // Keep the find-in-conversation marks in step with the rendered body. Runs
  // after render so it can wrap text inside the already-rendered markdown.
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    applySearchHighlights(contentRef.current, searchQuery, searchOpen)
  }, [searchQuery, searchOpen, citedText, m.id])
  const openCite = useCallback((citeId: string) => {
    setSrcOpen(true)
    setSrcFlash(citeId.toUpperCase())
    setSrcClaim(claimForCitation(displayText, citeId))
    window.setTimeout(() => scrollToSource(m.id, citeId), 60)
    window.setTimeout(() => setSrcFlash((v) => (v === citeId.toUpperCase() ? null : v)), 1800)
  }, [m.id, displayText])
  // Stable identity: `cites` feeds the memoized markdown renderer, so a fresh
  // object here would re-parse this message's whole body on every render.
  const cites = useMemo(() => searchPrefs?.citeStyle === 'links' || searchPrefs?.citeStyle === 'off' || !sources.length ? undefined : {
    sources,
    onCite: openCite,
  }, [searchPrefs?.citeStyle, sources, openCite])
  const writingPath = useMemo(
    () => findWritingPath(live as { id: string; name?: string; arguments: string }[] | undefined, m.toolRounds),
    [m.toolRounds, live],
  )
  // Research reports live in the side panel (opened from the report card),
  // never inline. Error text still renders so failures stay visible.
  const hideBody = !!m.research && m.research.status !== 'error'
  /* Copying defaults to rich text: the reply is already rendered in the page,
   * so its HTML is what a word processor needs to keep headings, lists,
   * tables and code blocks. Modifier clicks stay available for the other two
   * forms without adding a menu: Shift copies Markdown, Ctrl/Cmd copies plain
   * text. Clipboard API quirks fall back to a plain-text write. */
  const richCopyHtml = () => {
    const el = contentRef.current
    if (!el) return ''
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll('button').forEach((b) => {
      // Citation pills are content: keep the number, and link it when the
      // source is known, so a pasted answer still points at its evidence.
      const cite = /^Jump to source (S\d+)/i.exec(b.getAttribute('aria-label') ?? '')
      if (cite) {
        const source = sources.find((s) => s.citeId.toUpperCase() === cite[1].toUpperCase())
        const mark = document.createElement(source ? 'a' : 'sup')
        if (source && mark instanceof HTMLAnchorElement) { mark.href = source.url; mark.title = source.title }
        mark.textContent = cite[1].replace(/^S/i, '')
        b.replaceWith(mark)
      } else b.remove()
    })
    clone.querySelectorAll('mark.search-highlight').forEach((m) => m.classList.remove('search-highlight'))
    return clone.innerHTML
  }
  const markCopied = () => { setOk(true); setTimeout(() => setOk(false), 1200) }
  const copyReply = (mode: 'rich' | 'markdown' | 'plain' = 'rich') => {
    const markdown = messageForCopy(displayText, sources, true)
    const plain = messageForCopy(displayText, sources, false)
    if (mode === 'markdown' || mode === 'plain') {
      const p = navigator.clipboard?.writeText(mode === 'markdown' ? markdown : plain)
      if (p) void p.then(markCopied).catch(() => {})
      return
    }
    const html = richCopyHtml()
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })
      void navigator.clipboard.write([item]).then(markCopied).catch(() => {
        // Some browsers only allow one representation, or refuse HTML.
        const p = navigator.clipboard?.writeText(markdown)
        if (p) void p.then(markCopied).catch(() => {})
      })
      return
    }
    const p = navigator.clipboard?.writeText(markdown)
    if (p) void p.then(markCopied).catch(() => {})
  }
  if (m.r === 'user')
    return (
      <div id={`msg-${m.id}`} data-msg-role="user" className={cx('ml-auto max-w-[85%] space-y-2 rounded-xl p-1', flash && 'ring-2 ring-ac')}>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {prefs.showTimestamps && m.at != null && <time dateTime={new Date(m.at).toISOString()} title={formatMsgDateTime(m.at)} className="text-xs text-mu">{formatMsgTime(m.at)}</time>}
          {m.att?.map((a, i) => <Chip key={`${i}-${a.name}`} icon={Paperclip}>{a.name}</Chip>)}
        </div>
        {m.t && <UserText m={m} searchQuery={searchQuery} searchOpen={searchOpen} />}
      </div>
    )
  return (
    <div id={`msg-${m.id}`} data-msg-role="assistant" className={cx('group space-y-2 rounded-xl p-1', flash && 'ring-2 ring-ac')}>
      {/* The process panel is its own control, not part of the byline: hiding
          which model answered must not make the saved steps unreachable. */}
      {(prefs.showBy || (m.log && prefs.showLog) || (prefs.showTimestamps && m.at != null)) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-mu">
          {prefs.showBy && <span className={cx('inline-flex items-center gap-1.5', m.err && 'text-er')}>{m.err ? <TriangleAlert size={14} /> : <Cpu size={14} />}{m.by}</span>}
          {m.log && prefs.showLog && (
            <button onClick={() => setLog(!log)} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-surf hover:text-tx">
          <ListOrdered size={14} />Process to answer
            </button>
          )}
          {prefs.showTimestamps && m.at != null && <time dateTime={new Date(m.at).toISOString()} title={formatMsgDateTime(m.at)} className="ml-auto text-xs text-mu">{formatMsgTime(m.at)}</time>}
        </div>
      )}

      {log && (
        <div className="space-y-1.5 rounded-xl bg-surf p-3 text-sm">
          {adv?.showSystemPrompt && (
            <div className="rounded-lg bg-bg p-2">
              {sysText != null ? (
                <>
                  <span className="flex items-center gap-2">
                    <button onClick={() => setSysOpen(!sysOpen)} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-mu hover:bg-surf hover:text-tx">
                      <ChevronRight size={14} className={cx('transition-transform', sysOpen && 'rotate-90')} />Full system prompt ({sysText.length.toLocaleString()} characters)
                    </button>
                    <button
                      onClick={() => { void navigator.clipboard?.writeText(sysText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-mu hover:bg-surf hover:text-tx"
                      title="Copy the full system prompt"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
                    </button>
                  </span>
                  {m.sys == null && <p className="mt-1 px-1.5 text-xs text-mu">Reconstructed from current settings — the exact prompt was not saved for this reply.</p>}
                  {sysOpen && <div className="mt-2 max-h-96 overflow-y-auto rounded-lg bg-surf p-3 leading-7"><Md t={sysText} /></div>}
                </>
              ) : (
                <button onClick={() => setSysPreview(previewSysFor(m.id) ?? '(Could not reconstruct a system prompt for this reply.)')} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-mu hover:bg-surf hover:text-tx">
                  <ChevronRight size={14} />Preview the system prompt for this reply
                </button>
              )}
            </div>
          )}
          {/* One pass, in the order the steps happened. The old panel split the
              log into helper calls and model calls, which put a later retry or
              memory decision above the request that caused it. */}
          {(() => {
            const steps = m.log ?? []
            const calls = (m.toolRounds ?? []).flatMap((round) => round.calls)
            // A call that is still running has no saved round yet, so it is
            // drawn from the live list; ids keep a landed call from showing
            // twice while the round is being written back.
            const saved = new Set(calls.map((c) => c.id))
            const pending = ((live ?? []) as { id?: string; name?: string; arguments?: string }[])
              .filter((t) => t.name && (!t.id || !saved.has(t.id)))
            const running = busy && last
            const count = steps.length + calls.length + pending.length
            const total = [...steps.map((t) => t.ms ?? 0), ...calls.map((c) => c.ms ?? 0)].reduce((a, b) => a + b, 0)
            return (
              <>
                {count > 0 && !m.err && (
                  <div className="flex items-baseline gap-2 px-1 text-xs uppercase tracking-wide text-mu">
                    <span>{count} step{count === 1 ? '' : 's'}</span>
                    {logTiming && total > 0 && <span className="ml-auto normal-case tracking-normal tabular-nums">{duration(total).trim()} total</span>}
                  </div>
                )}
                {/* A tree, not a list: one rail runs from dot to dot, model
                    rounds are filled dots, and tool calls are open circles in
                    the muted tone — work that happened on the way to the
                    answer. Only a call that is still running animates. */}
                <ol className="process-tree">
                  {count === 0 && <li className="process-node text-mu"><span className="process-dot" aria-hidden="true" />{thinkingLine(m.id)}</li>}
                  {steps.map((t, i) => (
                    <ProcessStep key={`step-${i}`} t={t} detail={logDetail} timing={logTiming} models={logModels} tokens={!!adv?.showTokenCounts} open={!!expanded[`step-${i}`]} toggle={() => togglePayload(`step-${i}`)} />
                  ))}
                  {calls.map((call, i) => {
                    const [head, desc] = toolNode(toolStep(call.name, call.arguments, call.result), call.name)
                    return (
                      <li key={`tool-${i}`} className="process-node">
                        <span className="process-ring" data-err={call.error ? '' : undefined} aria-hidden="true" />
                        <div className="min-w-0">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className={cx('min-w-0 break-words text-mu', call.error && 'text-er')}>{head}</span>
                            {logTiming && call.ms != null && <span className={cx('ml-auto shrink-0 pl-2 text-xs tabular-nums text-mu', call.error && 'text-er')}>{duration(call.ms).trim()}</span>}
                          </span>
                          {desc && <div className={cx('mt-0.5 break-words text-xs text-mu', call.error && 'text-er')}>{desc}</div>}
                          {adv?.showToolPayloads && (
                            <div className="mt-1 space-y-1">
                              <Payload label="args" text={prettyArgs(call.arguments)} open={!!expanded[`args-${i}`]} onToggle={() => togglePayload(`args-${i}`)} />
                              {call.result != null && <Payload label="result" text={call.result} open={!!expanded[`result-${i}`]} onToggle={() => togglePayload(`result-${i}`)} />}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                  {pending.map((tool, i) => {
                    const name = tool.name!
                    const [head, desc] = toolNode(toolStep(name, tool.arguments ?? ''), name)
                    return (
                      <li key={`pending-${i}`} className="process-node">
                        <span className="process-ring" data-live={running ? '' : undefined} aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="break-words text-mu">{head}</div>
                          {desc && <div className="mt-0.5 break-words text-xs text-mu">{desc}</div>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </>
            )
          })()}
        </div>
      )}
      <div className={cx('flow-root leading-7', m.err && 'text-er')}>
        {/* Inline graphs float beside the prose, so the text wraps around the
            figure it explains instead of the plot being pushed to the end. */}
        {!m.err && !hideBody && hasPlacedGraphs(m.toolRounds, 'left') && <div className="float-left mb-3 w-full sm:mr-5 sm:w-[min(52%,23rem)]"><GraphCards rounds={m.toolRounds} placement="left" compact /></div>}
        {!m.err && !hideBody && hasPlacedGraphs(m.toolRounds, 'right') && <div className="float-right mb-3 w-full sm:ml-5 sm:w-[min(52%,23rem)]"><GraphCards rounds={m.toolRounds} placement="right" compact /></div>}
        {m.err ? (
          <div className="space-y-3 rounded-xl border border-er/30 bg-er/10 p-4">
            <div className="flex items-center gap-2 font-semibold text-er">
              <TriangleAlert size={18} /> Model Error{m.by ? ` · ${m.by}` : ''}
            </div>
            <div className="text-sm text-er/90">{m.t || 'HTTP 500 — Internal error encountered.'}</div>
            {(m.log ?? []).some((t) => t.errCode === 'tool_limit' || /Tool execution limit/i.test(t.err ?? '')) && (
              <div>
                <button onClick={() => cfg('tools')} className="rounded-lg bg-ac px-3 py-1.5 text-sm font-medium text-acx hover:opacity-90 transition-opacity">
                  Raise tool limit
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Btn v="solid" icon={RefreshCw} title="Send the same request again" onClick={() => useS.getState().retryMsg(m.id)}>Try again</Btn>
              <button onClick={() => setShowRawErr(!showRawErr)} className="rounded-lg bg-er/20 px-3 py-1.5 text-sm font-medium text-er hover:bg-er/30 transition-colors">
                {showRawErr ? 'Hide raw error' : 'Show raw error'}
              </button>
            </div>
            {showRawErr && (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-3 font-mono text-xs text-mu border border-bor">{(() => { try { return JSON.stringify(JSON.parse(m.t || '{}'), null, 2) } catch { return m.t || '' } })()}</pre>
            )}
          </div>
        ) : hideBody ? null : (() => {
          const finalIds = new Set((m.toolRounds ?? []).flatMap((r) => r.calls).map((c) => c.id))
          const pendingNames = ((live ?? []) as { id?: string; name?: string }[])
            .filter((t) => t.name && (!t.id || !finalIds.has(t.id)))
            .map((t) => t.name!)
          const status = writingPath ? `Writing ${writingPath}…` : activityLine(pendingNames, m.id)
          // The indicator belongs to waiting, not writing: it shows while a tool
          // runs (even if text already streamed) or before the first token, and
          // hides the moment prose arrives so the dots never sit beside text
          // the model is actively typing.
          const active = !!writingPath || (live?.length ?? 0) > 0 || (last && busy && !m.t)
          return (
            <>
              {m.t && (
                <div ref={contentRef} className="inline">
                  {liveChunks && liveChunks.length ? (
                    streamMd ? <StreamedMd chunks={liveChunks} fade={streamFade} /> : <StreamedText chunks={liveChunks} fade={streamFade} />
                  ) : (
                    <Md t={citedText} cites={cites} />
                  )}
                </div>
              )}
              {active && <ReplyProgress status={status} block={!!m.t} />}
            </>
          )
        })()}
        {/* A figure placed below belongs directly under the prose that
            explains it, not in a separate block at the end of the message. */}
        {!m.err && !hideBody && hasPlacedGraphs(m.toolRounds, 'below') && <div className="clear-both mt-3"><GraphCards rounds={m.toolRounds} placement="below" /></div>}
        {!m.err && <div className="clear-both" aria-hidden="true" />}
      </div>
      {!m.err && <GeneratedImages rounds={m.toolRounds} />}
      {m.capped && !m.err && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-er/30 bg-er/10 px-3 py-2 text-xs text-mu">
          <TriangleAlert size={13} className="shrink-0 text-er" />
          Tool execution limit reached — the partial reply above was kept.
          <button onClick={() => cfg('tools')} className="rounded-lg bg-ac px-2.5 py-1 text-xs font-medium text-acx transition-opacity hover:opacity-90">Raise tool limit</button>
        </div>
      )}
      {m.trunc && !m.err && !busy && m.t.trim() && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-ac/30 bg-ac/10 px-3 py-2 text-xs text-mu">
          <TriangleAlert size={13} className="shrink-0 text-ac" />
          The reply hit the model's output limit and was cut off.
          <button onClick={() => { void useS.getState().send('Continue from where you left off.', []) }} className="rounded-lg bg-ac px-2.5 py-1 text-xs font-medium text-acx transition-opacity hover:opacity-90">Continue</button>
        </div>
      )}
      {/* Workspace tiles for this message — shown above message controls but below content */}
      {m.research && <ResearchTierPicker msg={m} />}
      {m.research && <ResearchPlanCard msg={m} />}
      {m.research && <ResearchProgressCard msg={m} />}
      {m.research && <ResearchTile msg={m} onOpen={() => onOpenResearch(m.id)} />}
      {(() => {
        const wsIds = new Set<string>([...(m.workspaceIds ?? []), ...extractWorkspaceIds(((live ?? []) as { name: string; arguments: string; result?: string }[]))])
        const ids = Array.from(wsIds)
        return ids.length > 0 ? (
          <div className="space-y-2">
            {ids.map((wsId) => {
              const workspace = workspaces[wsId]
              if (!workspace) return null
              const selectedRevId = selectedRevision?.[wsId] ?? workspace.revisions[workspace.revisions.length - 1].id
              return (
                <WorkspaceTile
                  key={wsId}
                  msg={m}
                  live={live}
                  workspace={workspace}
                  selectedRevisionId={selectedRevId}
                  onOpen={(filePath) => onOpenWorkspace(m.id, wsId, filePath)}
                  onSelectRevision={(revId) => useS.getState().patch({ selectedRevision: { ...useS.getState().selectedRevision, [wsId]: revId } })}
                />
              )
            })}
          </div>
        ) : null
      })()}
      {/* Sources drawer: below workspaces, above the message options.
        Hidden for research runs — sources live in the report side panel. */}
      {!m.err && !hideBody && (
        <SourcesPanel
          msgId={m.id}
          text={displayText}
          sources={sources}
          defaultOpen={!!searchPrefs?.sourcesOpen}
          strict={!!searchPrefs?.strictCitations}
          open={srcOpen ?? undefined}
          onToggle={setSrcOpen}
          flash={srcFlash}
          claim={srcClaim}
        />
      )}
      {(m.toolRounds ?? []).length > 0 && <MessageActions calls={(m.toolRounds ?? []).flatMap((round) => round.calls)} />}
      {prefs.showTps && m.tps != null && !m.err && <div className="text-xs text-mu">{m.by} · {m.tps.toLocaleString()} tokens/s</div>}
      <div className={cx('flex flex-wrap items-center gap-0.5 transition-opacity', prefs.alwaysShowActions || (m.alts && m.alts.length > 1) ? '' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100')}>
        {m.alts && m.alts.length > 1 && !busy && (
          <>
            <Btn sm icon={ChevronLeft} title="Previous reply" disabled={(m.ai ?? 0) < 1} onClick={() => useS.getState().variant(m.id, (m.ai ?? 0) - 1)} />
            <span className="px-1 text-xs text-mu">{(m.ai ?? 0) + 1}/{m.alts.length}</span>
            <Btn sm icon={ChevronRight} title="Next reply" disabled={(m.ai ?? 0) >= m.alts.length - 1} onClick={() => useS.getState().variant(m.id, (m.ai ?? 0) + 1)} />
          </>
        )}
        <Btn icon={ok ? Check : Copy} title="Copy with formatting — Shift-click for Markdown, Ctrl/Cmd-click for plain text" onClick={(e) => copyReply(e.shiftKey ? 'markdown' : e.ctrlKey || e.metaKey ? 'plain' : 'rich')} />
        {!m.err && !hideBody && (
          <Btn icon={m.pin ? PinOff : Pin} title={m.pin ? 'Unpin this reply (it stays in the model context until unpinned)' : 'Pin this reply (shown under the header and kept in the model context)'} className={m.pin ? 'text-ac' : undefined} onClick={() => useS.getState().pinMsg(m.id)} />
        )}
        {voiceOn({ features }) && speechAvailable() && !hideBody && !m.err && !!displayText.trim() && (
          <Btn icon={Volume2} title="Read aloud" onClick={() => speak(displayText, normVoice(useS.getState().voicePrefs))} />
        )}
        {last && <Btn icon={RefreshCw} title="Regenerate" onClick={() => useS.getState().regen()} />}
        <Btn icon={GitBranch} title="Branch from here (copy this thread into a new chat)" onClick={() => useS.getState().branch(m.id)} />
        <Btn icon={Trash2} title="Delete" onClick={() => useS.getState().delMsg(m.id)} />
      </div>
    </div>
  )
})

const Tile = ({ icon: I, t, d, on }: { icon: Ic; t: string; d: string; on: () => void }) => (
  <button onClick={on} className="flex items-center gap-3 rounded-xl bg-surf p-3 text-left hover:bg-hov">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-bg text-ac"><I size={18} /></span>
    <span className="min-w-0"><span className="block text-sm font-medium">{t}</span><span className="block truncate text-xs text-mu">{d}</span></span>
  </button>
)

export function Chat({ side, toggle, cfg, pal }: { side: boolean; toggle: () => void; cfg: (t: string) => void; pal: () => void }) {
  /* Narrow slice: the transcript re-renders for chat changes (a streamed chunk
     legitimately updates it), but not for composer keystrokes, scratchpad,
     todos, snippets or other unrelated panel state. */
  const s = useS(useShallow((st) => ({
    chats: st.chats, chat: st.chat, cmds: st.cmds, prefs: st.prefs, workspaces: st.workspaces,
    selectedRevision: st.selectedRevision, eps: st.eps, features: st.features, patch: st.patch, newChatPending: st.newChatPending,
    projects: st.projects, activeProject: st.activeProject,
  })))
  const c = s.chats.find((x) => x.id === s.chat)
  // Project overview mode: a project opened from the sidebar fills the main
  // area until a chat is opened. A chat always wins over the overview, so
  // opening one clears the stale pointer.
  const project = s.activeProject && !c ? s.projects.find((p) => p.id === s.activeProject) : undefined
  useEffect(() => {
    if (s.chat && useS.getState().activeProject) useS.getState().patch({ activeProject: '' })
  }, [s.chat])
  // A pending new chat (no store entry yet) resolves its mode until send.
  const pendingTemp = !c && s.chat === '' && s.newChatPending === 'temporary'
  const isTemp = c?.temporary === true || pendingTemp
  // Before any message is sent the chat is a blank slate: the composer floats
  // centered, and the welcome content sits just above it.
  const empty = !(c && c.msgs.length)
  const glowI = Math.max(0, Math.min(2, s.prefs.tempGlow ?? 1))
  const newChatPending = useS((st) => st.newChatPending)
  // Starting a fresh chat moves focus straight into the composer so typing
  // needs no click. Runs for the pending descriptor and again whenever the
  // pending mode changes (e.g. switching "new" ↔ "new temporary"). The click
  // that asked for it can leave its own button focused, so the composer is
  // focused from the shared helper instead of only from an unfocused page.
  useEffect(() => {
    if (s.chat !== '') return
    focusComposer()
  }, [s.chat, newChatPending])

  // Also focus when switching to an existing chat (clicking a chat in the
  // sidebar or project overview). This runs on every chat change except the
  // initial empty string. We allow focus if the active element is the body
  // (initial load) or a button (sidebar/chat list click), but not if the user
  // is typing in an input/textarea or a modal is open.
  const prevChat = useRef<string>(s.chat)
  useEffect(() => {
    if (s.chat === '' || s.chat === prevChat.current) return
    const id = requestAnimationFrame(() => {
      const ae = document.activeElement
      const isModalOpen = document.querySelector('[role="dialog"]')
      const isInputFocused = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || (ae instanceof HTMLElement && ae.isContentEditable)
      const isButtonFocused = ae instanceof HTMLButtonElement
      if (isModalOpen || (isInputFocused && !isButtonFocused)) return
      ;(document.getElementById('composer') as HTMLElement | null)?.focus({ preventScroll: true })
    })
    prevChat.current = s.chat
    return () => cancelAnimationFrame(id)
  }, [s.chat])
  const tiles = featOn(s, 'commands') ? s.cmds.filter((k) => k.on).slice(0, 4) : []
  const box = useRef<HTMLDivElement>(null), stick = useRef(true)
  /* Session-only scroll memory per chat, so switching back and forth keeps the
     place the reader was at instead of snapping every transcript to the end. */
  const scrollMemo = useRef(new Map<string, { top: number; atEnd: boolean }>())
  // Mirrors `stick` into state so a jump-to-latest pill can appear while the
  // user reads back through the transcript (scroll events only; no renders
  // from streamed chunks).
  const [atEnd, setAtEnd] = useState(true)
  const onScrollBox = (e: React.UIEvent<HTMLDivElement>) => {
    const b = e.currentTarget
    const near = b.scrollHeight - b.scrollTop - b.clientHeight < 80
    stick.current = near
    if (s.chat) scrollMemo.current.set(s.chat, { top: b.scrollTop, atEnd: near })
    setAtEnd((was) => (was === near ? was : near))
  }
  const liveTools = useLive((l) => l.tools)
  const busy = useS((st) => st.busy)
  const voicePrefs = useS((st) => st.voicePrefs)
  // Auto read-aloud: speak each reply once, after it finishes streaming.
  const spoken = useRef('')
  useEffect(() => {
    if (busy) return
    const last = c?.msgs[c.msgs.length - 1]
    if (!last || last.r !== 'assistant' || last.err || !last.t.trim()) return
    if (spoken.current === last.id) return
    spoken.current = last.id
    if (featOn(s, 'voice') && normVoice(voicePrefs).autoRead) speak(last.toolFinal ?? last.t, normVoice(voicePrefs))
  }, [busy, c?.msgs, s.features, voicePrefs])
  const workspacePrefs = useS((st) => st.workspacePrefs ?? { defaultView: 'latest', autoOpen: true, autoFollow: true })
  /* `focus` counts explicit file requests so the panel can re-apply the same
     path when the user asks for it twice. */
  const [workspacePanel, setWorkspacePanel] = useState<{ mid: string; workspaceId: string; initialFilePath?: string; focus?: number } | null>(null)
  const prevBusy = useRef(busy)
  /* The user closed the panel: it must stay closed while the current reply
     runs, and open again with the next one. */
  const panelClosed = useRef(false)

  /* Restore the reader's position when the open chat changes. A jump from the
     sidebar search owns the scroll for its highlight window, so it is left
     alone; a chat never visited this session starts at the end as before. */
  useEffect(() => {
    if (useS.getState().flashMsg) return
    const b = box.current
    const saved = scrollMemo.current.get(s.chat)
    if (!b || !saved) { stick.current = true; return }
    // One entry per chat seen this session; keep the map bounded.
    if (scrollMemo.current.size > 60) {
      for (const key of scrollMemo.current.keys()) { if (key !== s.chat) { scrollMemo.current.delete(key); break } }
    }
    if (saved.atEnd) { stick.current = true; b.scrollTop = b.scrollHeight; setAtEnd(true); return }
    b.scrollTop = Math.max(0, Math.min(saved.top, b.scrollHeight - b.clientHeight))
    stick.current = false
    setAtEnd(false)
  }, [s.chat])
  /* Follow-the-bottom scrolling is coalesced to at most one write per frame:
     assigning `scrollTop` forces a layout, and streamed chunks can arrive
     faster than the display refreshes. */
  const followBottom = useMemo(() => createFrameThrottle(() => {
    const b = box.current
    if (b) b.scrollTop = b.scrollHeight
  }), [])
  useEffect(() => () => followBottom.cancel(), [followBottom])
  useEffect(() => {
    // A sidebar jump owns the scroll position for its highlight window.
    if (useS.getState().flashMsg) return
    const last = c?.msgs[c.msgs.length - 1]
    if (stick.current || last?.r === 'user') followBottom.call()
  }, [c?.msgs, s.chat, followBottom])

  // Auto-open the workspace panel while the AI writes files, and keep it
  // pointed at the workspace the files land in. The panel itself follows the
  // file being written, so the panel state only carries the workspace.
  useEffect(() => {
    if (!c || !workspacePrefs.autoOpen) return
    // A new reply may open the panel again; until then a panel the user
    // closed stays closed.
    if (busy && !prevBusy.current) panelClosed.current = false
    if (panelClosed.current) { prevBusy.current = busy; return }
    if (busy) {
      for (let i = c.msgs.length - 1; i >= 0; i--) {
        const m = c.msgs[i]
        if (m.r !== 'assistant') continue
        const live = (liveTools[m.id] ?? []) as WorkspaceCallLike[]
        const writingPath = findWritingPath(live, m.toolRounds)
        const ids = m.workspaceIds ?? []
        // The message records the workspace as soon as the first file lands,
        // so the id is known while the reply is still streaming.
        const wsId = ids[ids.length - 1] ?? extractWorkspaceIds(live)[0]
        if (!wsId && !writingPath) continue
        setWorkspacePanel((prev) => {
          // Keep the previous workspace when the new id is not known yet: an
          // unknown id made the panel unmount, and the workspace the user
          // was working in appeared to vanish.
          const nextId = wsId || prev?.workspaceId || ''
          if (!nextId) return prev
          if (prev && prev.mid === m.id && prev.workspaceId === nextId) return prev
          return { mid: m.id, workspaceId: nextId, initialFilePath: undefined, focus: prev?.focus ?? 0 }
        })
        break
      }
    }
    prevBusy.current = busy
  }, [busy, liveTools, c, workspacePrefs.autoOpen])

  // The panel belongs to a chat: switching chats closes it instead of
  // leaving it pointing at a message that is no longer on screen.
  useEffect(() => { panelClosed.current = false; setWorkspacePanel(null) }, [s.chat])

  const rowRef = useRef<HTMLDivElement>(null)
  // The composer floats over the message list; track its height so the list can
  // keep its last message clear of it and fade out just above it.
  const composerRef = useRef<HTMLDivElement>(null)
  const [composerH, setComposerH] = useState(0)
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    const f = () => setComposerH(el.offsetHeight)
    f()
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const glass = s.prefs.glassComposer !== false
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 640px)').matches)
  useEffect(() => {
    const q = matchMedia('(min-width: 640px)')
    const f = () => setWide(q.matches)
    f()
    q.addEventListener('change', f)
    return () => q.removeEventListener('change', f)
  }, [])

  // Stable callback identities so memoized message rows do not re-render when
  // the list re-renders for an unrelated (streamed) chunk.
  const openWorkspace = useCallback((mid: string, wsId: string, filePath?: string) => setWorkspacePanel((prev) => ({ mid, workspaceId: wsId, initialFilePath: filePath, focus: (prev?.focus ?? 0) + 1 })), [])
  const openResearch = useCallback((mid: string) => { useS.getState().patch({ researchPanel: { mid } }) }, [])

  const workspaceMsg = workspacePanel ? c?.msgs.find((m) => m.id === workspacePanel.mid) : undefined  /* The panel id can be a workspace that does not exist yet (a brand new
     project, or one whose id the model never sent). Fall back to the
     workspace the message itself points at, so the panel keeps showing the
     project instead of disappearing mid-write. */
  const msgWsIds = workspaceMsg?.workspaceIds ?? []
  const panelWsId = workspacePanel?.workspaceId ?? ''
  const workspaceId = panelWsId && s.workspaces[panelWsId] ? panelWsId : (msgWsIds[msgWsIds.length - 1] ?? '')
  const workspace = workspaceMsg && workspacePanel ? s.workspaces[workspaceId] : undefined
  const selectedRevId = workspacePanel ? s.selectedRevision[workspaceId] : null
  // Indicator: the panel is showing a workspace lent by the project's other
  // chats because this chat has not used one yet and the project shares.
  const sharedWorkspaceOf = useMemo(() => {
    const proj = s.projects.find((p) => p.id === c?.project)
    if (!workspacePanel || !c || !proj || proj.shareWorkspaces === false) return undefined
    if (c.msgs.some((m) => m.workspaceIds?.includes(workspaceId))) return undefined
    return activeWorkspaceForChat(s, s.chat).shared ? proj.name : undefined
  }, [workspacePanel, c, s.projects, workspaceId, s])
  const workspaceFrac = clampWorkspaceFrac(s.prefs.workspaceWidth)
  const researchMid = useS((st) => st.researchPanel?.mid ?? null)
  const researchMsg = researchMid ? c?.msgs.find((m) => m.id === researchMid && m.research) : undefined

  const startResize = (e: React.PointerEvent) => {
    const row = rowRef.current
    if (!row) return
    const startX = e.clientX, start = workspaceFrac, total = row.getBoundingClientRect().width || 1
    startPointerDrag(e, (clientX) => {
      const next = roundFrac(clampWorkspaceFrac(start - (clientX - startX) / total))
      const st = useS.getState()
      if (st.prefs.workspaceWidth === next) return
      st.patch({ prefs: { ...st.prefs, workspaceWidth: next } })
    })
  }

  /* ---- long transcripts, find, rail ----
   * Past a couple hundred messages, mounting every row makes typing and
   * scrolling feel old. A moving window keeps the DOM bounded; the button at
   * the top (and a jump from find, the rail, or the sidebar) widens it. */
  const WINDOW_SIZE = 120
  const [windowFrom, setWindowFrom] = useState(0)
  // A different chat starts at its newest window; the same chat only trims as
  // it grows, so revealing older messages is never undone by a new reply.
  useEffect(() => {
    const n = c?.msgs.length ?? 0
    setWindowFrom(Math.max(0, n - WINDOW_SIZE))
  }, [s.chat])
  useEffect(() => {
    const n = c?.msgs.length ?? 0
    setWindowFrom((v) => Math.min(v, Math.max(0, n - WINDOW_SIZE)))
  }, [c?.msgs.length])
  const flashMsg = useS((st) => st.flashMsg)
  useEffect(() => {
    if (!flashMsg || !c) return
    const i = c.msgs.findIndex((m) => m.id === flashMsg)
    if (i >= 0) setWindowFrom((v) => (i < v ? Math.max(0, i - 20) : v))
  }, [flashMsg, c])
  const scrollToMsgTop = (mid: string) => {
    const b = box.current
    const el = document.getElementById(`msg-${mid}`)
    if (!b || !el) return
    b.scrollTop = el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 10
  }
  const reveal = (mid: string) => {
    const i = c?.msgs.findIndex((m) => m.id === mid) ?? -1
    if (i >= 0 && i < windowFrom) setWindowFrom(Math.max(0, i - 10))
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToMsgTop(mid)))
  }
  const flashTo = (mid: string) => {
    reveal(mid)
    useS.getState().patch({ flashMsg: mid })
  }
  const showEarlier = () => {
    if (!c || windowFrom <= 0) return
    const target = c.msgs[Math.max(0, windowFrom - WINDOW_SIZE)]
    setWindowFrom(Math.max(0, windowFrom - WINDOW_SIZE))
    if (target) requestAnimationFrame(() => requestAnimationFrame(() => scrollToMsgTop(target.id)))
  }

  const [findOpen, setFindOpen] = useState(false)
  const [findQ, setFindQ] = useState('')
  const [findIdx, setFindIdx] = useState(0)
  const findHits = useMemo(() => {
    const q = findQ.trim().toLowerCase()
    if (!q) return []
    return (c?.msgs ?? []).filter((m) => {
      const text = m.r === 'assistant' ? (m.toolFinal ?? m.t) : m.t
      return (text ?? '').toLowerCase().includes(q)
    }).map((m) => m.id)
  }, [findQ, c?.msgs])
  useEffect(() => { setFindIdx(0) }, [findQ])
  useEffect(() => {
    if (!findOpen || !findHits.length) return
    const id = findHits[Math.min(findIdx, findHits.length - 1)]
    if (id) flashTo(id)
    // After message is revealed, scroll the first highlight inside it into view
    requestAnimationFrame(() => {
      setTimeout(() => {
        const msgEl = document.getElementById(`msg-${id}`)
        if (!msgEl) return
        const hl = msgEl.querySelector('.search-highlight')
        if (hl) hl.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
      }, 60)
    })
    // Deliberately keyed on the number of hits, not the array: a streaming
    // reply rewrites message text on every chunk and must not yank the
    // transcript back to the active match while the reader is elsewhere.
  }, [findOpen, findHits.length, findIdx, findQ])
  const stepFind = (dir: number) => {
    if (!findHits.length) return
    const next = (findIdx + dir + findHits.length) % findHits.length
    setFindIdx(next)
    requestAnimationFrame(() => {
      const id = findHits[next]
      const msgEl = document.getElementById(`msg-${id}`)
      if (!msgEl) return
      const hl = msgEl.querySelector('.search-highlight')
      if (hl) hl.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    })
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'f') return
      if (s.prefs.customSearch === false) return
      if (!c?.msgs.length) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setFindOpen(true)
      requestAnimationFrame(() => (document.getElementById('chat-find') as HTMLInputElement | null)?.focus())
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [c?.msgs.length, s.prefs.customSearch])

  /* Selected assistant text offers a reply-with-quote action right where the
   * reader selected it: the conversational gesture that used to require
   * copying into the composer by hand. */
  const [quote, setQuote] = useState<{ text: string; x: number; y: number } | null>(null)
  const captureQuote = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setQuote(null); return }
    const text = sel.toString().trim()
    if (!text || text.length > 4000) { setQuote(null); return }
    const node = sel.anchorNode
    const el = node?.nodeType === 1 ? (node as Element) : node?.parentElement
    if (!el?.closest('[data-msg-role="assistant"]')) { setQuote(null); return }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setQuote({ text, x: Math.max(90, Math.min(window.innerWidth - 90, rect.left + rect.width / 2)), y: rect.top })
  }
  useEffect(() => {
    if (!quote && !findOpen) return
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { setQuote(null); setFindOpen(false) } }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [quote, findOpen])
  const quoteReply = () => {
    if (!quote) return
    const quoted = quote.text.split('\n').map((line) => `> ${line}`).join('\n')
    const st = useS.getState()
    st.patch({ draft: `${quoted}\n\n${st.draft}` })
    setQuote(null)
    window.getSelection()?.removeAllRanges()
    requestAnimationFrame(() => document.getElementById('composer')?.focus())
  }
  const pinned = pinnedReplyOf(c)
  // Dense transcripts get sampled down to a readable rail instead of 400
  // overlapping dots; every dot still jumps to a real message. The rail only
  // earns its place once the reader has sent a couple of messages, so a single
  // prompt and its reply do not sit behind a lone dot.
  const { railDots, sentCount } = useMemo(() => {
    const all = c?.msgs ?? []
    const sentCount = all.reduce((n, m) => n + (m.r === 'user' ? 1 : 0), 0)
    const msgs = all.filter((m) => m.r === 'assistant')
    const max = 160
    const railDots = msgs.length <= max
      ? msgs
      : (() => { const step = Math.ceil(msgs.length / max); return msgs.filter((_, i) => i % step === 0 || i === msgs.length - 1) })()
    return { railDots, sentCount }
  }, [c?.msgs])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <Header side={side} toggle={toggle} cfg={cfg} pal={pal} title={c?.title ?? (project ? project.name : pendingTemp ? 'Temporary chat' : 'New chat')} />
      {pinned && !project && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-xl border border-ac/30 bg-ac/5 px-3 py-1.5">
          <Pin size={13} className="shrink-0 text-ac" aria-hidden="true" />
          <span className="shrink-0 text-xs font-medium text-ac">Pinned</span>
          <button onClick={() => flashTo(pinned.id)} className="min-w-0 flex-1 truncate text-left text-xs text-mu hover:text-tx" title="Jump to the pinned reply">
            {(pinned.by ? `${pinned.by} · ` : '') + (pinned.toolFinal ?? pinned.t).replace(/\s+/g, ' ').slice(0, 200)}
          </button>
          <button onClick={() => useS.getState().pinMsg(pinned.id)} title="Unpin this reply" aria-label="Unpin this reply" className="grid size-6 shrink-0 place-items-center rounded-md text-mu hover:bg-surf hover:text-tx"><X size={13} /></button>
        </div>
      )}
      <div ref={rowRef} className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {project ? (
          <ProjectOverview project={project} cfg={cfg} />
        ) : (
        <>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {findOpen && s.prefs.customSearch !== false && (
            <div className="absolute inset-x-3 top-3 z-30 mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-bor bg-surf p-3 shadow-2xl">
              <Search size={20} className="ml-1 shrink-0 text-mu" aria-hidden="true" />
              <input id="chat-find" value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Find in conversation" aria-label="Find in conversation" onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1) }
                if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false) }
              }} className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-lg outline-none placeholder:text-base" />
              <span aria-live="polite" className="shrink-0 text-sm text-mu">{findQ.trim() ? (findHits.length ? `${Math.min(findIdx + 1, findHits.length)}/${findHits.length}` : 'No matches') : ''}</span>
              <Btn icon={ArrowUp} title="Previous match" disabled={!findHits.length} onClick={() => stepFind(-1)} />
              <Btn icon={ArrowDown} title="Next match" disabled={!findHits.length} onClick={() => stepFind(1)} />
              <Btn icon={X} title="Close find" onClick={() => { setFindOpen(false); setFindQ('') }} />
            </div>
          )}
          {quote && (
            <div className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2" style={{ left: quote.x, top: quote.y }}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={quoteReply} className="inline-flex items-center gap-1.5 rounded-lg border border-bor bg-surf px-2.5 py-1.5 text-xs font-medium text-tx shadow-xl hover:bg-hov">
                <Quote size={13} className="text-ac" />Reply with quote
              </button>
            </div>
          )}
          {c && sentCount >= 2 && (
            <nav aria-label="Message rail" className="absolute inset-y-6 right-2 z-20 hidden w-4 md:block">
              <div className="relative h-full w-full flex flex-col items-center justify-center gap-[6px] overflow-y-auto">
                {railDots.map((m) => (
                  <button key={m.id} type="button" aria-label={`Jump to ${m.r === 'user' ? 'your message' : 'reply'}: ${(m.r === 'assistant' ? (m.toolFinal ?? m.t) : m.t).replace(/\s+/g, ' ').slice(0, 60)}`} title={`${m.r === 'user' ? 'You' : (m.by || 'Assistant')}: ${(m.r === 'assistant' ? (m.toolFinal ?? m.t) : m.t).replace(/\s+/g, ' ').slice(0, 120)}`} onClick={() => reveal(m.id)} className={cx('shrink-0 size-[10px] rounded-full transition-[background-color,transform] hover:scale-[1.4] hover:bg-tx focus-visible:bg-tx focus-visible:outline-none', m.r === 'user' ? 'bg-mu/55' : 'bg-mu/35')} />
                ))}
              </div>
            </nav>
          )}
          <div ref={box} onScroll={(e) => { if (quote) setQuote(null); onScrollBox(e) }} onMouseUp={captureQuote} className="absolute inset-0 overflow-y-auto overflow-x-auto" style={glass ? { paddingBottom: composerH + (empty ? 32 : 0) } : { paddingBottom: composerH + (empty ? 32 : 0), WebkitMaskImage: `linear-gradient(to bottom, black calc(100% - ${composerH + 32}px), rgba(0,0,0,0.1) calc(100% - ${composerH}px))`, maskImage: `linear-gradient(to bottom, black calc(100% - ${composerH + 32}px), rgba(0,0,0,0.1) calc(100% - ${composerH}px))` }}>
            {c && c.msgs.length ? (
              <div className="mx-auto flex flex-col" style={{ maxWidth: CHAT_WIDTH[s.prefs.chatWidth], padding: 'var(--ui-chat-pad-y) var(--ui-chat-pad-x)', rowGap: 'var(--ui-msg-gap)' }}>
                {windowFrom > 0 && (
                  <div className="flex justify-center pb-2">
                    <button type="button" onClick={showEarlier} className="rounded-full border border-bor bg-surf px-3 py-1 text-xs text-mu transition-colors hover:bg-hov hover:text-tx">
                      Show {Math.min(WINDOW_SIZE, windowFrom)} earlier message{Math.min(WINDOW_SIZE, windowFrom) === 1 ? '' : 's'} ({windowFrom} hidden for speed)
                    </button>
                  </div>
                )}
                {c.msgs.slice(windowFrom).map((m, i) => <M key={m.id} m={m} cfg={cfg} last={windowFrom + i === c.msgs.length - 1} onOpenWorkspace={openWorkspace} onOpenResearch={openResearch} selectedWorkspaceId={workspacePanel?.mid === m.id ? selectedRevId : null} searchQuery={findQ} searchOpen={findOpen} />)}
                {c.msgs[c.msgs.length - 1]?.r === 'user' && !busy && (
                  <div className="flex justify-center pt-2">
                    <button onClick={() => useS.getState().regen()} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-bor bg-surf px-4 py-1.5 text-sm text-tx transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ac">
                      <RefreshCw size={14} className="text-ac" />Get AI reply
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-x-0 top-0 flex overflow-y-auto" style={{ bottom: `calc(50% + ${composerH / 2 + 24}px)` }}>
                {!s.eps.some(usable) ? (
                  <div className="m-auto w-full"><Tutorial cfg={cfg} /></div>
                ) : (
                  <div className="m-auto mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-4 py-4 text-center">
                    <div className="grid w-full gap-2 sm:grid-cols-2">
                      {!s.eps.length && <Tile icon={Server} t="Add an endpoint" d="Connect a model with your own key" on={() => cfg('eps')} />}
                      {tiles.map((k) => <Tile key={k.id} icon={CI[k.in]} t={'/' + k.name} d={k.desc} on={() => s.patch({ draft: '/' + k.name + ' ' })} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div ref={composerRef} className={cx('absolute inset-x-0 z-10 flex flex-col', empty ? 'top-1/2 -translate-y-1/2' : 'bottom-0')}>
            {!atEnd && c && c.msgs.length > 0 && (
              <button type="button" onClick={() => { stick.current = true; setAtEnd(true); followBottom.call() }} className="absolute bottom-full left-1/2 z-10 mb-2 inline-flex min-h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-bor bg-surf px-3 py-1 text-xs text-tx shadow-md transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ac">
                <ChevronDown size={13} className="text-ac" />Jump to latest
              </button>
            )}
            {/* The greeting (or the temporary-chat line) belongs to the
                composer it introduces, not to the welcome tiles: it sits
                directly above the box with a clear gap, at a size that reads
                as the headline of the empty chat. A temporary chat also gets
                one short line under it, because the headline alone never says
                what actually happens to the conversation. */}
            {empty && (
              <>
                <div className={cx('px-4 text-center text-2xl font-semibold leading-tight tracking-tight text-tx', isTemp ? 'mb-2' : 'mb-6')}>
                  {flairLine(new Date(), { temporary: isTemp, seasonal: s.prefs.seasonal, seed: s.chats.length })}
                </div>
                {isTemp && <div className="mb-6 px-8 text-center text-xs leading-relaxed text-mu">{TEMPORARY_NOTE}</div>}
              </>
            )}
            <Composer cfg={cfg} />
          </div>
        </div>
        {workspaceMsg && workspace && workspacePanel && (
          <>
            <div role="separator" aria-orientation="vertical" aria-label="Resize workspace panel" onPointerDown={startResize} className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 sm:block" />
            <aside aria-label="Workspace side panel" style={wide ? { flex: `0 0 ${workspaceFrac * 100}%`, maxWidth: '70%', minWidth: '15%' } : { height: '45dvh', width: '100%' }} className="panel-shell flex min-h-0 shrink-0 flex-col border-t border-bor bg-surf/40 sm:border-l sm:border-t-0">
              <WorkspacePanel key={`${workspaceMsg.id}:${workspaceMsg.ai ?? 0}:${workspaceId}`} msg={workspaceMsg} live={liveTools[workspaceMsg.id]} workspace={workspace} selectedRevisionId={selectedRevId ?? workspace.revisions[workspace.revisions.length - 1]?.id ?? null} setSelectedRevisionId={(id) => s.patch({ selectedRevision: { ...s.selectedRevision, [workspaceId]: id } })} onClose={() => { panelClosed.current = true; setWorkspacePanel(null) }} initialFilePath={workspacePanel.initialFilePath} focus={workspacePanel.focus ?? 0} sharedOf={sharedWorkspaceOf} />
            </aside>
          </>
        )}
        {researchMsg && (
          <>
            <div role="separator" aria-orientation="vertical" aria-label="Resize research panel" onPointerDown={startResize} className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 sm:block" />
            <aside aria-label="Research side panel" style={wide ? { flex: `0 0 ${workspaceFrac * 100}%`, maxWidth: '70%', minWidth: '15%' } : { height: '45dvh', width: '100%' }} className="panel-shell flex min-h-0 shrink-0 flex-col border-t border-bor bg-surf/40 sm:border-l sm:border-t-0">
              <ResearchPanel key={`${researchMsg.id}:${researchMsg.research?.finishedAt ?? 0}`} msg={researchMsg} onClose={() => s.patch({ researchPanel: null })} />
            </aside>
          </>
        )}
        </>
        )}
      </div>
      {project && <div className="px-4 pb-2 text-center text-xs text-mu">Temporary chats are unavailable in projects.</div>}
      {/* The empty temporary chat already explains itself under the headline;
          once the conversation starts, the standing provider caveat takes over. */}
      {isTemp && !project && !empty && <div className="px-4 pb-2 text-center text-xs text-mu">Some providers may retain temporary chats for safety or model training.</div>}
      {/* Temporary-chat frame: one soft accent glow hugging the viewport edges.
         No shine sweep any more: while the chat is still empty the glow just
         waves in intensity and never actually turns off, then settles to a
         faint, static rim after the first message — the "this conversation will
         not stick" tell that stays legible without shouting. */}
      {isTemp && !project && glowI > 0 && <div aria-hidden="true" className="temp-glow" data-sent={c?.msgs.length ? '' : undefined} style={{ ['--temp-glow-i' as never]: glowI, ['--temp-glow-sent' as never]: Math.max(0, Math.min(2, s.prefs.tempGlowSent ?? 0.5)) }} />}
    </section>
  )
}
