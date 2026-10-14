import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, ChevronLeft, ChevronRight, Sparkles, Server, Cpu, Copy, Check, RefreshCw, Trash2, ListOrdered, CircleCheck, CircleX, TriangleAlert, Paperclip, ChevronDown, CornerDownLeft } from 'lucide-react'
import { useS, useLive, usable, featOn, previewSysFor, type Msg } from '../store'
import { CI, fmtDuration } from '../meta'
import { Btn, Chip, cx, type Ic } from './ui'
import { Composer } from './Composer'
import { Header } from './Header'
import { Tutorial } from './Extra'
import { Md, UserText } from './Md'
import { CanvasRail, CanvasPanel } from './Canvas'
import { groupCanvasVersions } from '../canvas'

function toolStep(name: string, rawArgs: string, result?: string) {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(rawArgs || '{}') } catch { /* Keep the action label if arguments are malformed. */ }
  const query = typeof args.query === 'string' ? args.query : ''
  const expression = typeof args.expression === 'string' ? args.expression : ''
  const text = typeof args.text === 'string' ? args.text : ''
  if (name === 'prompt_chip') return `Follow-up · ${typeof args.label === 'string' ? args.label : 'Continue'}`
  if (name === 'inline_poll') return `Choice · ${typeof args.question === 'string' ? args.question : 'Choose an option'}`
  const clip = (s: string, n = 90) => s.length > n ? `${s.slice(0, n)}…` : s
  if (name === 'canvas_upsert') {
    const action = typeof args.action === 'string' ? args.action : 'file'
    const path = typeof args.path === 'string' ? args.path : 'file'
    return `Canvas file · ${action}: ${clip(path, 80)}`
  }
  if (name === 'search') {
    const responses = result?.match(/\[Source [^\]]+\]/g)?.length
    return `Web search · query: “${clip(query || 'missing query')}”${responses == null ? '' : ` (${responses} responses)`}`
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
  return `Tool ${name} · inputs: ${Object.keys(args).length ? Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? clip(v, 60) : String(v)}`).join(', ') : 'none'}`
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

function MessageActions({ calls }: { calls: { id: string; name: string; arguments: string; error?: boolean }[] }) {
  const s = useS()
  const [chosen, setChosen] = useState<Record<string, number[]>>({})
  const [used, setUsed] = useState<Record<string, boolean>>({})
  const actions = calls.filter((call) => !call.error && ['prompt_chip', 'inline_poll'].includes(call.name))
  if (!actions.length) return null
  const parse = (raw: string) => { try { return JSON.parse(raw || '{}') as Record<string, any> } catch { return {} } }
  const run = (key: string, prompt: string) => { if (!prompt.trim() || s.busy) return; setUsed((v) => ({ ...v, [key]: true })); void s.send(prompt, []) }
  return <div className="space-y-2 pt-1">
    {actions.map((call) => {
      const args = parse(call.arguments)
      if (call.name === 'prompt_chip') return <button key={call.id} disabled={s.busy || used[call.id]} onClick={() => run(call.id, String(args.prompt ?? ''))} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-hov bg-surf px-3 py-1.5 text-sm text-tx transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ac disabled:opacity-50"><CornerDownLeft size={14} className="text-ac" />{String(args.label || 'Continue')}</button>
      const options = Array.isArray(args.options) ? args.options.map((o: any) => typeof o === 'string' ? { label: o, prompt: o } : o).filter((o: any) => o && typeof o.label === 'string').slice(0, 6) : []
      const selected = chosen[call.id] ?? []
      const multi = args.mode === 'multiple'
      const pick = (index: number) => setChosen((v) => ({ ...v, [call.id]: multi ? selected.includes(index) ? selected.filter((x) => x !== index) : [...selected, index] : [index] }))
      return <section key={call.id} aria-label="Assistant choice" className="max-w-xl rounded-xl border border-hov bg-surf p-4">
        <h3 className="text-sm font-medium">{String(args.question || 'Choose an option')}</h3>
        <div role={multi ? 'group' : 'radiogroup'} aria-label={String(args.question || 'Choose an option')} className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map((option: any, index: number) => <button key={index} type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={selected.includes(index)} disabled={used[call.id] || s.busy} onClick={() => pick(index)} onKeyDown={(e) => { if (!multi && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); const next = (index + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length; pick(next); e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus() } }} className={cx('flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-hov disabled:opacity-50', selected.includes(index) ? 'border-ac bg-ac/10' : 'border-hov')}>
            <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center border', multi ? 'rounded' : 'rounded-full', selected.includes(index) ? 'border-ac bg-ac text-acx' : 'border-mu/60')} >{selected.includes(index) && <Check size={11} strokeWidth={3} />}</span>{option.label}
          </button>)}
        </div>
        <div className="mt-3 flex items-center justify-between"><span aria-live="polite" className="text-xs text-mu">{used[call.id] ? 'Sent' : multi ? 'Choose one or more' : 'Choose one'}</span><button disabled={!selected.length || s.busy || used[call.id]} onClick={() => run(call.id, options.filter((_: any, i: number) => selected.includes(i)).map((o: any) => o.prompt).join('\n\n'))} className="rounded-lg bg-ac px-3 py-1.5 text-sm font-medium text-acx transition-opacity hover:opacity-90 disabled:opacity-40">Continue</button></div>
      </section>
    })}
  </div>
}

function M({ m, last, onOpenCanvas, selectedPath }: { m: Msg; last: boolean; onOpenCanvas: (mid: string, path: string) => void; selectedPath?: string | null }) {
  const { prefs, busy, advanced, features } = useS()
  const adv = featOn({ features }, 'advanced') ? advanced : undefined
  const [sysOpen, setSysOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sysPreview, setSysPreview] = useState<string | null>(null)
  // Saved prompt for new replies; reconstructed from current settings for older ones.
  const sysText = m.sys ?? sysPreview
  const togglePayload = (k: string) => setExpanded((v) => ({ ...v, [k]: !v[k] }))
  const live = useLive((s) => s.tools[m.id])
  const [log, setLog] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [ok, setOk] = useState(false)
  const writingPath = useMemo(() => {
    const final = (m.toolRounds ?? []).flatMap((r) => r.calls).filter((t) => t.name === 'canvas_upsert')
    const streaming = (live ?? []).filter((t) => t.name === 'canvas_upsert' || !t.name)
    const done = new Set(final.map((t) => t.id))
    const pending = streaming.filter((t) => !t.id || !done.has(t.id))
    if (!pending.length) return null
    const groups = groupCanvasVersions(pending.map((t) => ({ ...t })))
    return groups[groups.length - 1]?.path ?? null
  }, [m.toolRounds, live])
  if (m.r === 'user')
    return (
      <div className="ml-auto max-w-[85%] space-y-2">
        <div className="flex flex-wrap justify-end gap-1.5">{m.att?.map((a) => <Chip key={a.name} icon={Paperclip}>{a.name}</Chip>)}</div>
        {m.t && <UserText m={m} />}
      </div>
    )
  return (
    <div className="group space-y-2">
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
                      <ChevronDown size={14} className={cx('transition-transform', !sysOpen && '-rotate-90')} />Full system prompt ({sysText.length.toLocaleString()} characters)
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
                  <ChevronDown size={14} className="-rotate-90" />Preview the system prompt for this reply
                </button>
              )}
            </div>
          )}
          <ol className="space-y-1.5">
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
      {(m.reasoning || (m.thinkingOn && busy && last)) && (
        <div className="rounded-xl bg-surf px-3 py-2 text-sm">
          <button onClick={() => setThinkingOpen(!thinkingOpen)} className="flex items-center gap-2 text-mu hover:text-tx">
            <ChevronDown size={14} className={cx('transition-transform', !thinkingOpen && '-rotate-90')} />
            <span className="font-medium">Thinking</span>
          </button>
          {thinkingOpen && <div className="mt-2 whitespace-pre-wrap border-l border-hov pl-4 text-sm text-mu">{m.reasoning || 'This model has not sent a reasoning summary.'}</div>}
        </div>
      )}
      <div className={cx('leading-7', m.err && 'text-er')}>
        {m.t ? (
          <div className="inline">
            <Md t={m.t} fadeEvents={m.fadeEvents} fade={prefs.fade} />
          </div>
        ) : writingPath ? (
          <span className="reply-thinking" role="status" aria-label={`Writing ${writingPath}`}>
            <span className="reply-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="ml-2 text-mu">Writing {writingPath}…</span>
          </span>
        ) : (
          <span className="reply-thinking" role="status" aria-label="Waiting for a reply">
            <span className="reply-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="ml-2 text-mu">Thinking…</span>
          </span>
        )}
      </div>
      {((m.toolRounds ?? []).length > 0 || (live ?? []).length > 0) && <CanvasRail msg={m} live={live} selected={selectedPath} onOpen={(path) => onOpenCanvas(m.id, path)} />}
      {(m.toolRounds ?? []).length > 0 && <MessageActions calls={(m.toolRounds ?? []).flatMap((round) => round.calls)} />}
      {prefs.showTps && m.tps != null && !m.err && <div className="text-xs text-mu">{m.by} · {m.tps.toLocaleString()} tokens/s</div>}
      <div className={cx('flex items-center gap-0.5 transition-opacity', m.alts && m.alts.length > 1 ? '' : 'opacity-0 group-hover:opacity-100')}>
        {m.alts && m.alts.length > 1 && !busy && (
          <>
            <Btn sm icon={ChevronLeft} title="Previous reply" disabled={(m.ai ?? 0) < 1} onClick={() => useS.getState().variant(m.id, (m.ai ?? 0) - 1)} />
            <span className="px-1 text-xs text-mu">{(m.ai ?? 0) + 1}/{m.alts.length}</span>
            <Btn sm icon={ChevronRight} title="Next reply" disabled={(m.ai ?? 0) >= m.alts.length - 1} onClick={() => useS.getState().variant(m.id, (m.ai ?? 0) + 1)} />
          </>
        )}
        <Btn icon={ok ? Check : Copy} title="Copy" onClick={() => { navigator.clipboard?.writeText(m.t); setOk(true); setTimeout(() => setOk(false), 1200) }} />
        {last && <Btn icon={RefreshCw} title="Regenerate" onClick={() => useS.getState().regen()} />}
        <Btn icon={GitBranch} title="Branch from here (copy this thread into a new chat)" onClick={() => useS.getState().branch(m.id)} />
        <Btn icon={Trash2} title="Delete" onClick={() => useS.getState().delMsg(m.id)} />
      </div>
    </div>
  )
}

const Tile = ({ icon: I, t, d, on }: { icon: Ic; t: string; d: string; on: () => void }) => (
  <button onClick={on} className="flex items-center gap-3 rounded-xl bg-surf p-3 text-left hover:bg-hov">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-bg text-ac"><I size={18} /></span>
    <span className="min-w-0"><span className="block text-sm font-medium">{t}</span><span className="block truncate text-xs text-mu">{d}</span></span>
  </button>
)

export function Chat({ side, toggle, cfg, pal }: { side: boolean; toggle: () => void; cfg: (t: string) => void; pal: () => void }) {
  const s = useS()
  const c = s.chats.find((x) => x.id === s.chat)
  const tiles = featOn(s, 'commands') ? s.cmds.filter((k) => k.on).slice(0, 4) : []
  const box = useRef<HTMLDivElement>(null), stick = useRef(true)
  const liveTools = useLive((l) => l.tools)
  const busy = useS((st) => st.busy)
  const canvasPrefs = useS((st) => st.canvasPrefs ?? { autoOpen: true, autoClose: false })
  const [dock, setDock] = useState<{ mid: string; path: string | null } | null>(null)
  const prevBusy = useRef(busy)
  useEffect(() => { stick.current = true }, [s.chat])
  useEffect(() => {
    const b = box.current, last = c?.msgs[c.msgs.length - 1]
    if (b && (stick.current || last?.r === 'user')) b.scrollTop = b.scrollHeight
  }, [c?.msgs, s.chat])
  // Drop the dock when switching to a chat that does not contain it.
  useEffect(() => {
    if (dock && c && !c.msgs.some((m) => m.id === dock.mid)) setDock(null)
  }, [s.chat])
  // Auto-open on live canvas writes; follow the last file written; auto-close optionally.
  useEffect(() => {
    if (!c) return
    if (busy && canvasPrefs.autoOpen) {
      for (let i = c.msgs.length - 1; i >= 0; i--) {
        const m = c.msgs[i]
        if (m.r !== 'assistant') continue
        const final = (m.toolRounds ?? []).flatMap((r) => r.calls).filter((t) => t.name === 'canvas_upsert')
        const live = (liveTools[m.id] ?? []).filter((t) => t.name === 'canvas_upsert' || !t.name)
        const done = new Set(final.map((t) => t.id))
        const pending = live.filter((t) => !t.id || !done.has(t.id))
        const combined = [...final, ...pending.map((t) => ({ ...t }))]
        if (!combined.length) {
          // No canvas activity on this message — keep looking at older ones.
          continue
        }
        const groups = groupCanvasVersions(combined)
        const lastPath = groups[groups.length - 1]?.path
        if (!lastPath) break
        setDock((d) => {
          if (!d || d.mid !== m.id) return { mid: m.id, path: lastPath }
          if (d.path !== lastPath) return { ...d, path: lastPath }
          return d
        })
        break
      }
    }
    if (prevBusy.current && !busy && canvasPrefs.autoClose) setDock(null)
    prevBusy.current = busy
  }, [busy, liveTools, c, canvasPrefs.autoOpen, canvasPrefs.autoClose])
  const openCanvas = (mid: string, path: string) => setDock({ mid, path })
  const dockMsg = dock ? c?.msgs.find((m) => m.id === dock.mid) : undefined
  // Canvas width is a fraction of the chat section (screen minus sidebar).
  // Legacy pixel values (>1) fall back to the 40% default without persisting.
  const rawCanvas = s.prefs.canvasWidth ?? 0.4
  const canvasFrac = typeof rawCanvas === 'number' && rawCanvas > 0 && rawCanvas <= 1 ? rawCanvas : 0.4
  const rowRef = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 640px)').matches)
  useEffect(() => {
    const q = matchMedia('(min-width: 640px)')
    const f = () => setWide(q.matches)
    f()
    q.addEventListener('change', f)
    return () => q.removeEventListener('change', f)
  }, [])
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const row = rowRef.current
    if (!row) return
    const x = e.clientX, start = canvasFrac, total = row.getBoundingClientRect().width || 1
    const move = (ev: PointerEvent) => {
      const value = Math.max(0.15, Math.min(0.7, start - (ev.clientX - x) / total))
      const st = useS.getState()
      st.patch({ prefs: { ...st.prefs, canvasWidth: Math.round(value * 1000) / 1000 } })
    }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
    addEventListener('pointermove', move); addEventListener('pointerup', up, { once: true })
  }
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <Header side={side} toggle={toggle} cfg={cfg} pal={pal} title={c?.title ?? 'New chat'} />
      <div ref={rowRef} className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={box} onScroll={(e) => { const b = e.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80 }} className="min-h-0 flex-1 overflow-y-auto">
            {c && c.msgs.length ? (
              <div className="mx-auto space-y-8 px-4 py-6" style={{ maxWidth: ({ narrow: 640, standard: 768, wide: 1024 } as const)[s.prefs.chatWidth] }}>
                {c.msgs.map((m, i) => <M key={m.id} m={m} last={i === c.msgs.length - 1} onOpenCanvas={openCanvas} selectedPath={dock?.mid === m.id ? dock.path : null} />)}
              </div>
            ) : !s.eps.some(usable) ? (
              <Tutorial cfg={cfg} />
            ) : (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-surf text-ac"><Sparkles size={22} /></span>
                <h2 className="text-xl font-semibold">What do you want to work on?</h2>
                <div className="grid w-full gap-2 sm:grid-cols-2">
                  {!s.eps.length && <Tile icon={Server} t="Add an endpoint" d="Connect a model with your own key" on={() => cfg('eps')} />}
                  {tiles.map((k) => <Tile key={k.id} icon={CI[k.in]} t={'/' + k.name} d={k.desc} on={() => s.patch({ draft: '/' + k.name + ' ' })} />)}
                </div>
              </div>
            )}
          </div>
          <Composer cfg={cfg} />
        </div>
        {dockMsg && (
          <>
            <div role="separator" aria-orientation="vertical" aria-label="Resize canvas panel" onPointerDown={startResize} className="hidden w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-ac/50 sm:block" />
            <aside aria-label="Canvas side panel" style={wide ? { flex: `0 0 ${canvasFrac * 100}%`, maxWidth: '70%', minWidth: '15%' } : { height: '45dvh', width: '100%' }} className="flex min-h-0 shrink-0 flex-col border-t border-hov bg-surf/40 sm:border-l sm:border-t-0">
              <CanvasPanel key={`${dockMsg.id}:${dockMsg.ai ?? 0}`} msg={dockMsg} live={liveTools[dockMsg.id]} path={dock?.path ?? null} setPath={(path) => setDock((d) => (d ? { ...d, path } : d))} onClose={() => setDock(null)} />
            </aside>
          </>
        )}
      </div>
    </section>
  )
}
