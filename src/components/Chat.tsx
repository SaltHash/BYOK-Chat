import { useEffect, useRef, useState } from 'react'
import { GitBranch, ChevronLeft, ChevronRight, Sparkles, Server, Cpu, Copy, Check, RefreshCw, Trash2, ListOrdered, CircleCheck, CircleX, TriangleAlert, Paperclip, ChevronDown } from 'lucide-react'
import { useS, usable, type Msg } from '../store'
import { CI, fmtDuration } from '../meta'
import { Btn, Chip, cx, type Ic } from './ui'
import { Composer } from './Composer'
import { Header } from './Header'
import { Tutorial } from './Extra'
import { Md, UserText } from './Md'

function toolStep(name: string, rawArgs: string) {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(rawArgs || '{}') } catch { /* Keep the action label if arguments are malformed. */ }
  const query = typeof args.query === 'string' ? args.query : ''
  const expression = typeof args.expression === 'string' ? args.expression : ''
  const text = typeof args.text === 'string' ? args.text : ''
  const clip = (s: string, n = 90) => s.length > n ? `${s.slice(0, n)}…` : s
  if (name === 'search') return `Web search · query: “${clip(query || 'missing query')}”`
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
  return `Tool ${name} · inputs: ${Object.keys(args).length ? Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? clip(v, 60) : String(v)}`).join(', ') : 'none'}`
}
const duration = (ms?: number) => ms == null ? '' : ` ${fmtDuration(ms, useS.getState().widgetPrefs.timeUnit ?? 'auto')}`

function M({ m, last }: { m: Msg; last: boolean }) {
  const { prefs, busy } = useS()
  const [log, setLog] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [ok, setOk] = useState(false)
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
          <ol className="space-y-1.5">
            {m.log!.filter((t) => /\(classifier\)$/.test(t.n) || t.n === 'Memory recall').map((t, i) => (
              <li key={`classifier-${i}`} className="flex items-center gap-2">
                {t.err ? <CircleX size={14} className="text-er" /> : <CircleCheck size={14} className="text-ac" />}
                <span>{t.n === 'Memory recall' ? t.detail : `Classifier${t.m ? ` · ${t.m}` : ''}${t.detail ? ` · ${t.detail}` : ''}`}</span>
                <span className="ml-auto text-tx">{duration(t.ms)}</span>{t.err && <span className="text-er">{t.err}</span>}
              </li>
            ))}
            {m.log!.filter((t) => !/\(classifier\)$/.test(t.n) && t.n !== 'Memory recall').map((t, i) => (
              <li key={`model-${i}`} className="flex items-center gap-2">
                {t.err ? <CircleX size={14} className="text-er" /> : <CircleCheck size={14} className="text-ac" />}
                <span>{t.m || t.n}{m.reasoning && !t.err ? ' (reasoning)' : ''}{t.detail ? ` · ${t.detail}` : ''}</span>
                <span className="ml-auto text-tx">{duration(t.ms)}</span>{t.err && <span className="text-er">{t.err}</span>}
              </li>
            ))}
            {(m.toolRounds ?? []).flatMap((round) => round.calls).map((call, i) => (
              <li key={`tool-${i}`} className="flex items-center gap-2">
                {call.error ? <CircleX size={14} className="text-er" /> : <CircleCheck size={14} className="text-ac" />}
                <span>{toolStep(call.name, call.arguments)}</span>
                <span className={cx('ml-auto text-tx', call.error && 'text-er')}>{duration(call.ms)}</span>
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
        ) : (
          <span className="text-mu inline-flex items-center gap-1.5">
            Waiting for a reply…
          </span>
        )}
      </div>
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
  const tiles = s.cmds.filter((k) => k.on).slice(0, 4)
  const box = useRef<HTMLDivElement>(null), stick = useRef(true)
  useEffect(() => { stick.current = true }, [s.chat])
  useEffect(() => {
    const b = box.current, last = c?.msgs[c.msgs.length - 1]
    if (b && (stick.current || last?.r === 'user')) b.scrollTop = b.scrollHeight
  }, [c?.msgs, s.chat])
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <Header side={side} toggle={toggle} cfg={cfg} pal={pal} title={c?.title ?? 'New chat'} />
      <div ref={box} onScroll={(e) => { const b = e.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80 }} className="min-h-0 flex-1 overflow-y-auto">
        {c && c.msgs.length ? (
          <div className="mx-auto space-y-8 px-4 py-6" style={{ maxWidth: ({ narrow: 640, standard: 768, wide: 1024 } as const)[s.prefs.chatWidth] }}>
            {c.msgs.map((m, i) => <M key={m.id} m={m} last={i === c.msgs.length - 1} />)}

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
    </section>
  )
}
