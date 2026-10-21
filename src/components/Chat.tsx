import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { GitBranch, ChevronLeft, ChevronRight, ChevronDown, Sparkles, Clock, Server, Cpu, Copy, Check, RefreshCw, Trash2, ListOrdered, CircleCheck, CircleX, TriangleAlert, Paperclip, Download, ExternalLink, Volume2 } from 'lucide-react'
import { useS, useLive, usable, featOn, previewSysFor, type Msg } from '../store'
import { clampWorkspaceFrac, roundFrac, CHAT_WIDTH } from '../layout'
import { startPointerDrag } from '../hooks'
import { createFrameThrottle } from '../throttle'
import { CI, fmtDuration } from '../meta'
import { Btn, Chip, cx, type Ic } from './ui'
import { Composer } from './Composer'
import { Header } from './Header'
import { MessageActions } from './ReplyActions'
import { Tutorial } from './Extra'
import { Md, UserText } from './Md'
import { activityLine, flairLine, thinkingLine } from '../flair'
import { splitStream } from '../streamMd'
import { WorkspaceTile, WorkspacePanel } from './Workspace'
import { ResearchTierPicker, ResearchPlanCard, ResearchProgressCard, ResearchTile, ResearchPanel } from './Research'
import { SourcesPanel, scrollToSource } from './Sources'
import { collectMessageSources, linkifyCitations, parseSearchEvidence, stripCitations } from '../citations'
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
    const path = typeof args.path === 'string' ? args.path : 'file'
    const workspaceId = typeof args.workspaceId === 'string' ? args.workspaceId : ''
    const wsLabel = workspaceId ? ` (ws:${workspaceId.slice(0, 8)})` : ''
    const batch = Array.isArray(args.files) ? args.files.length : 0
    const what = batch ? `batch: ${action} ${clip(path, 60)} + ${batch} more` : `${action}: ${clip(path, 80)}`
    return `Workspace file · ${what}${wsLabel}`
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
            <img src={src} alt={img.revised || `Generated image ${i + 1}`} loading="lazy" className="max-h-80 rounded-xl border border-bor object-contain" />
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

const M = memo(function M({ m, last, onOpenWorkspace, onOpenResearch, selectedWorkspaceId, cfg }: { m: Msg; last: boolean; onOpenWorkspace: (mid: string, workspaceId: string, filePath?: string) => void; onOpenResearch: (mid: string) => void; selectedWorkspaceId?: string | null; cfg: (t: string) => void }) {
  // Granular subscriptions: a streamed chunk only changes `chats`, so these
  // slices stay referentially stable and this message does not re-render
  // unless its own `m` prop (or one of these) actually changed.
  const prefs = useS((s) => s.prefs)
  const streamFade = prefs.streamFade
  const streamMd = prefs.streamMd
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
  const searchPrefs = useS((s) => s.search)
  const sources = useMemo(() => collectMessageSources(m.toolRounds), [m.toolRounds])
  const displayText = m.toolFinal ?? m.t
  // While the live streamed text is on screen this output is not rendered, so
  // skip the whole-text linkify pass that would otherwise rerun per chunk.
  const citedText = useMemo(() => {
    if (liveChunks?.length) return displayText
    return searchPrefs?.citeStyle === 'off' ? stripCitations(displayText) : linkifyCitations(displayText, sources)
  }, [displayText, sources, searchPrefs?.citeStyle, liveChunks])
  const openCite = useCallback((citeId: string) => {
    setSrcOpen(true)
    setSrcFlash(citeId.toUpperCase())
    window.setTimeout(() => scrollToSource(m.id, citeId), 60)
    window.setTimeout(() => setSrcFlash((v) => (v === citeId.toUpperCase() ? null : v)), 1800)
  }, [m.id])
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
  if (m.r === 'user')
    return (
      <div id={`msg-${m.id}`} className={cx('ml-auto max-w-[85%] space-y-2 rounded-xl p-1', flash && 'ring-2 ring-ac')}>
        <div className="flex flex-wrap justify-end gap-1.5">{m.att?.map((a, i) => <Chip key={`${i}-${a.name}`} icon={Paperclip}>{a.name}</Chip>)}</div>
        {m.t && <UserText m={m} />}
      </div>
    )
  return (
    <div id={`msg-${m.id}`} className={cx('group space-y-2 rounded-xl p-1', flash && 'ring-2 ring-ac')}>
      {prefs.showBy && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-mu">
          <span className={cx('inline-flex items-center gap-1.5', m.err && 'text-er')}>{m.err ? <TriangleAlert size={14} /> : <Cpu size={14} />}{m.by}</span>
          {m.log && prefs.showLog && (
            <button onClick={() => setLog(!log)} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-surf hover:text-tx">
          <ListOrdered size={14} />Process to answer
            </button>
          )}
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
          <ol className="space-y-1.5">
            {m.log!.length === 0 && !m.toolRounds?.length && <li className="text-mu">{thinkingLine(m.id)}</li>}
            {m.log!.filter((t) => /\(classifier\)$/.test(t.n) || t.n === 'Memory recall').map((t, i) => (
              <li key={`classifier-${i}`} className="flex items-center gap-2">
                {t.err ? <CircleX size={14} className="shrink-0 text-er" /> : <CircleCheck size={14} className="shrink-0 text-ac" />}
                <span>{t.n === 'Memory recall' ? t.detail : `Classifier${t.m ? ` · ${t.m}` : ''}${t.detail ? ` · ${t.detail}` : ''}`}</span>
                <span className="ml-auto text-mu">{duration(t.ms)}{adv?.showTokenCounts && (t.tin != null || t.tout != null) ? ` · ${t.tin ?? 0} in / ${t.tout ?? 0} out` : ''}</span>{t.err && <span className="text-er">{t.err}</span>}
              </li>
            ))}
            {m.log!.filter((t) => !/\(classifier\)$/.test(t.n) && t.n !== 'Memory recall').map((t, i) => (
              <li key={`model-${i}`} className="flex items-center gap-2">
                {t.err ? <CircleX size={14} className="shrink-0 text-er" /> : <CircleCheck size={14} className="shrink-0 text-ac" />}
                <span>{t.m || t.n}{m.reasoning && !t.err ? ' (reasoning)' : ''}{t.detail ? ` · ${t.detail}` : ''}</span>
                <span className="ml-auto text-mu">{duration(t.ms)}{adv?.showTokenCounts && (t.tin != null || t.tout != null) ? ` · ${t.tin ?? 0} in / ${t.tout ?? 0} out` : ''}</span>{t.err && <span className="text-er">{t.err}</span>}
              </li>
            ))}
            {(m.toolRounds ?? []).flatMap((round) => round.calls).map((call, i) => (
              <li key={`tool-${i}`} className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  {call.error ? <CircleX size={14} className="shrink-0 text-er" /> : <CircleCheck size={14} className="shrink-0 text-ac" />}
                  <span>{toolStep(call.name, call.arguments, call.result)}</span>
                  <span className={cx('ml-auto text-mu', call.error && 'text-er')}>{duration(call.ms)}</span>
                </span>
                {adv?.showToolPayloads && (
                  <span className="ml-6 space-y-1">
                    <Payload label="args" text={prettyArgs(call.arguments)} open={!!expanded[`args-${i}`]} onToggle={() => togglePayload(`args-${i}`)} />
                    {call.result != null && <Payload label="result" text={call.result} open={!!expanded[`result-${i}`]} onToggle={() => togglePayload(`result-${i}`)} />}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className={cx('leading-7', m.err && 'text-er')}>
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
            <button onClick={() => setShowRawErr(!showRawErr)} className="rounded-lg bg-er/20 px-3 py-1.5 text-sm font-medium text-er hover:bg-er/30 transition-colors">
              {showRawErr ? 'Hide raw error' : 'Show raw error'}
            </button>
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
          // Keep the status line visible for the whole time this message is the
          // one being worked on: text may already have streamed, a tool may be
          // running, or the model may be between rounds. It only disappears
          // once the reply is finished and nothing is pending.
          const active = !!writingPath || (live?.length ?? 0) > 0 || (liveChunks?.length ?? 0) > 0 || (last && busy && !m.t)
          return (
            <>
              {m.t && (
                <div className="inline">
                  {liveChunks && liveChunks.length ? (
                    streamMd ? <StreamedMd chunks={liveChunks} fade={streamFade} /> : <StreamedText chunks={liveChunks} fade={streamFade} />
                  ) : (
                    <Md t={citedText} cites={cites} />
                  )}
                </div>
              )}
              {active && (
                <span className={cx('reply-thinking', m.t && 'mt-2 block')} role="status" aria-label={status}>
                  <span className="reply-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span className="ml-2 text-mu">{status}</span>
                </span>
              )}
            </>
          )
        })()}
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
        />
      )}
      {(m.toolRounds ?? []).length > 0 && <MessageActions calls={(m.toolRounds ?? []).flatMap((round) => round.calls)} />}
      {prefs.showTps && m.tps != null && !m.err && <div className="text-xs text-mu">{m.by} · {m.tps.toLocaleString()} tokens/s</div>}
      <div className={cx('flex flex-wrap items-center gap-0.5 transition-opacity', m.alts && m.alts.length > 1 ? '' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100')}>
        {m.alts && m.alts.length > 1 && !busy && (
          <>
            <Btn sm icon={ChevronLeft} title="Previous reply" disabled={(m.ai ?? 0) < 1} onClick={() => useS.getState().variant(m.id, (m.ai ?? 0) - 1)} />
            <span className="px-1 text-xs text-mu">{(m.ai ?? 0) + 1}/{m.alts.length}</span>
            <Btn sm icon={ChevronRight} title="Next reply" disabled={(m.ai ?? 0) >= m.alts.length - 1} onClick={() => useS.getState().variant(m.id, (m.ai ?? 0) + 1)} />
          </>
        )}
        <Btn icon={ok ? Check : Copy} title="Copy" onClick={() => { const p = navigator.clipboard?.writeText(m.t); if (!p) return; void p.then(() => { setOk(true); setTimeout(() => setOk(false), 1200) }).catch(() => {}) }} />
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
    selectedRevision: st.selectedRevision, eps: st.eps, features: st.features, patch: st.patch,
  })))
  const c = s.chats.find((x) => x.id === s.chat)
  const tiles = featOn(s, 'commands') ? s.cmds.filter((k) => k.on).slice(0, 4) : []
  const box = useRef<HTMLDivElement>(null), stick = useRef(true)
  // Mirrors `stick` into state so a jump-to-latest pill can appear while the
  // user reads back through the transcript (scroll events only; no renders
  // from streamed chunks).
  const [atEnd, setAtEnd] = useState(true)
  const onScrollBox = (e: React.UIEvent<HTMLDivElement>) => {
    const b = e.currentTarget
    const near = b.scrollHeight - b.scrollTop - b.clientHeight < 80
    stick.current = near
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
  const [workspacePanel, setWorkspacePanel] = useState<{ mid: string; workspaceId: string; initialFilePath?: string } | null>(null)
  const prevBusy = useRef(busy)

  useEffect(() => { stick.current = !useS.getState().flashMsg }, [s.chat])
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

  // Auto-open workspace panel when AI writes files; follow the file being written.
  useEffect(() => {
    if (!c || !workspacePrefs.autoOpen) return
    if (busy) {
      for (let i = c.msgs.length - 1; i >= 0; i--) {
        const m = c.msgs[i]
        if (m.r !== 'assistant') continue
        const writingPath = findWritingPath(liveTools[m.id], m.toolRounds)
        if (!writingPath) continue
        // Find workspace ID and active file path from live arguments
        const liveCalls = (liveTools[m.id] ?? []) as { name: string; arguments: string; result?: string }[]
        const liveWsIds = extractWorkspaceIds(liveCalls)
        const wsId = (m.workspaceIds ?? [])[0] ?? liveWsIds[0] ?? (m.workspaceIds ?? [])[0]
        const initialPath: string | undefined = writingPath
        if (wsId || initialPath) {
          setWorkspacePanel((prev) => {
            if (!prev || prev.mid !== m.id || prev.workspaceId !== wsId || prev.initialFilePath !== initialPath) {
              return { mid: m.id, workspaceId: wsId || prev?.workspaceId || '', initialFilePath: initialPath || prev?.initialFilePath }
            }
            return prev
          })
          break
        }
      }
    }
    // Auto-close when reply completes (optional - controlled by user closing panel)
    if (prevBusy.current && !busy && workspacePanel) {
      // Keep panel open until user closes it
    }
    prevBusy.current = busy
  }, [busy, liveTools, c, workspacePrefs.autoOpen, workspacePanel])

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
  const openWorkspace = useCallback((mid: string, wsId: string, filePath?: string) => setWorkspacePanel({ mid, workspaceId: wsId, initialFilePath: filePath }), [])
  const openResearch = useCallback((mid: string) => { useS.getState().patch({ researchPanel: { mid } }) }, [])

  const workspaceMsg = workspacePanel ? c?.msgs.find((m) => m.id === workspacePanel.mid) : undefined
  const workspace = workspaceMsg && workspacePanel ? s.workspaces[workspacePanel.workspaceId] : undefined
  const selectedRevId = workspacePanel ? s.selectedRevision[workspacePanel.workspaceId] : null
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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <Header side={side} toggle={toggle} cfg={cfg} pal={pal} title={c?.title ?? 'New chat'} />
      <div ref={rowRef} className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={box} onScroll={onScrollBox} className="absolute inset-0 overflow-y-auto" style={glass ? { paddingBottom: composerH } : { paddingBottom: composerH, WebkitMaskImage: `linear-gradient(to bottom, black calc(100% - ${composerH + 32}px), rgba(0,0,0,0.1) calc(100% - ${composerH}px))`, maskImage: `linear-gradient(to bottom, black calc(100% - ${composerH + 32}px), rgba(0,0,0,0.1) calc(100% - ${composerH}px))` }}>
            {c && c.msgs.length ? (
              <div className="mx-auto space-y-8 px-4 py-6" style={{ maxWidth: CHAT_WIDTH[s.prefs.chatWidth] }}>
                {c.msgs.map((m, i) => <M key={m.id} m={m} cfg={cfg} last={i === c.msgs.length - 1} onOpenWorkspace={openWorkspace} onOpenResearch={openResearch} selectedWorkspaceId={workspacePanel?.mid === m.id ? selectedRevId : null} />)}
                {c.msgs[c.msgs.length - 1]?.r === 'user' && !busy && (
                  <div className="flex justify-center pt-2">
                    <button onClick={() => useS.getState().regen()} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-bor bg-surf px-4 py-1.5 text-sm text-tx transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ac">
                      <RefreshCw size={14} className="text-ac" />Get AI reply
                    </button>
                  </div>
                )}
              </div>
            ) : !s.eps.some(usable) ? (
              <Tutorial cfg={cfg} />
            ) : (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-surf text-ac">{c?.temporary === true ? <Clock size={22} /> : <Sparkles size={22} />}</span>
                <h2 className="text-xl font-semibold">{flairLine(new Date(), { temporary: c?.temporary === true, seasonal: s.prefs.seasonal, seed: s.chats.length })}</h2>
                <div className="grid w-full gap-2 sm:grid-cols-2">
                  {!s.eps.length && <Tile icon={Server} t="Add an endpoint" d="Connect a model with your own key" on={() => cfg('eps')} />}
                  {tiles.map((k) => <Tile key={k.id} icon={CI[k.in]} t={'/' + k.name} d={k.desc} on={() => s.patch({ draft: '/' + k.name + ' ' })} />)}
                </div>
              </div>
            )}
          </div>
          <div ref={composerRef} className="absolute inset-x-0 bottom-0 z-10 flex flex-col">
            {!atEnd && c && c.msgs.length > 0 && (
              <button type="button" onClick={() => { stick.current = true; setAtEnd(true); followBottom.call() }} className="absolute bottom-full left-1/2 z-10 mb-2 inline-flex min-h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-bor bg-surf px-3 py-1 text-xs text-tx shadow-md transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ac">
                <ChevronDown size={13} className="text-ac" />Jump to latest
              </button>
            )}
            <Composer cfg={cfg} />
          </div>
        </div>
        {workspaceMsg && workspace && workspacePanel && (
          <>
            <div role="separator" aria-orientation="vertical" aria-label="Resize workspace panel" onPointerDown={startResize} className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 sm:block" />
            <aside aria-label="Workspace side panel" style={wide ? { flex: `0 0 ${workspaceFrac * 100}%`, maxWidth: '70%', minWidth: '15%' } : { height: '45dvh', width: '100%' }} className="flex min-h-0 shrink-0 flex-col border-t border-bor bg-surf/40 sm:border-l sm:border-t-0">
              <WorkspacePanel key={`${workspaceMsg.id}:${workspaceMsg.ai ?? 0}:${workspacePanel.workspaceId}:${workspacePanel.initialFilePath ?? ''}`} msg={workspaceMsg} live={liveTools[workspaceMsg.id]} workspace={workspace} selectedRevisionId={selectedRevId ?? workspace.revisions[workspace.revisions.length - 1].id} setSelectedRevisionId={(id) => s.patch({ selectedRevision: { ...s.selectedRevision, [workspacePanel.workspaceId]: id } })} onClose={() => setWorkspacePanel(null)} initialFilePath={workspacePanel.initialFilePath} />
            </aside>
          </>
        )}
        {researchMsg && (
          <>
            <div role="separator" aria-orientation="vertical" aria-label="Resize research panel" onPointerDown={startResize} className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 sm:block" />
            <aside aria-label="Research side panel" style={wide ? { flex: `0 0 ${workspaceFrac * 100}%`, maxWidth: '70%', minWidth: '15%' } : { height: '45dvh', width: '100%' }} className="flex min-h-0 shrink-0 flex-col border-t border-bor bg-surf/40 sm:border-l sm:border-t-0">
              <ResearchPanel key={`${researchMsg.id}:${researchMsg.research?.finishedAt ?? 0}`} msg={researchMsg} onClose={() => s.patch({ researchPanel: null })} />
            </aside>
          </>
        )}
      </div>
    </section>
  )
}
