import { useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { Gauge, Activity, Layers, StickyNote, Bookmark, Plus, X, CornerDownLeft, Coins, Timer, ScrollText, Keyboard, Type, ListChecks, Check, GripVertical } from 'lucide-react'
import { useS, modelsOf, uid, widgetOn } from '../store'
import { fmtDuration, KEYS, WIDGETS } from '../meta'
import { fmt } from '../engine'
import { Btn, cx, type Ic } from './ui'

const W = ({ icon: I, t, id, style, children }: { icon: Ic; t: string; id: string; style?: CSSProperties; children: ReactNode }) => {
  const [over, setOver] = useState(false)
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setOver(false)
    const from = e.dataTransfer.getData('text/plain')
    if (!from || from === id) return
    const prefs = useS.getState().widgetPrefs
    const order = [...new Set([...(prefs.widgetOrder ?? []), ...WIDGETS.map(([k]) => k)])]
    const a = order.indexOf(from), b = order.indexOf(id)
    if (a < 0 || b < 0) return
    order.splice(b, 0, order.splice(a, 1)[0])
    useS.getState().patch({ widgetPrefs: { ...prefs, widgetOrder: order } })
  }
  return <div style={style} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop} className={cx('space-y-3 rounded-xl bg-surf p-3', over && 'ring-2 ring-ac')}>
    <div className="flex items-center gap-2 text-sm font-medium"><span draggable title="Drag to rearrange" onDragStart={(e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move' }} className="cursor-grab text-mu"><GripVertical size={14} /></span><I size={16} className="text-ac" />{t}</div>
    {children}
  </div>
}
const field = 'w-full rounded-lg bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40'
const SESSION_START = Date.now()

export function Widgets({ width = 320 }: { width?: number }) {
  const s = useS()
  const [n, setN] = useState('')
  const [td, setTd] = useState('')
  const c = s.chats.find((x) => x.id === s.chat)
  const w = Object.fromEntries(WIDGETS.map(([k]) => [k, widgetOn(s, k)])) as Record<string, boolean>
  const wp = { contextLimit: 128000, showDisabledEndpoints: true, scratchRows: 6, snippetLimit: 20, costDecimals: 4, activePromptsOnly: false, charsPerToken: 4, hideDoneTodos: false, ...s.widgetPrefs }
  const widgetOrder = [...new Set([...(wp.widgetOrder ?? []), ...WIDGETS.map(([k]) => k)])]
  const tok = Math.round((c?.msgs.reduce((a, m) => a + m.t.length, 0) ?? 0) / Math.max(1, wp.charsPerToken))
  const now = Date.now(), periodStart = wp.usagePeriod === 'session' ? SESSION_START : wp.usagePeriod === 'day' ? now - 86400000 : wp.usagePeriod === 'week' ? now - 7 * 86400000 : wp.usagePeriod === 'custom' ? (wp.usageFrom ? new Date(wp.usageFrom).getTime() : 0) : 0
  const events = s.chats.flatMap((chat) => chat.msgs.flatMap((msg) => (msg.log ?? []).map((log) => ({ ...log, at: log.at ?? msg.at ?? 0 }))))
    .filter((x) => x.at >= periodStart && (wp.usagePeriod !== 'custom' || !wp.usageTo || x.at <= new Date(wp.usageTo).getTime() + 86400000))
  const grouped = new Map<string, { ok: number; bad: number; tin: number; tout: number }>()
  events.forEach((x) => { const endpoint = x.n.replace(/ \(classifier\)$/, ''), k = wp.usageGroup === 'model' ? `${endpoint} · ${x.m || 'unknown model'}` : endpoint; const v = grouped.get(k) ?? { ok: 0, bad: 0, tin: 0, tout: 0 }; if (x.err) v.bad++; else v.ok++; v.tin += x.tin ?? 0; v.tout += x.tout ?? 0; grouped.set(k, v) })
  const usageText = (tin: number, tout: number) => wp.usageFormat.replaceAll('{in}', tin.toLocaleString()).replaceAll('{out}', tout.toLocaleString())
  const lr = [...(c?.msgs ?? [])].reverse().find((m) => m.r === 'assistant' && m.log?.length)
  const won = lr?.log?.find((t) => !t.err && t.ms != null)
  return (
    <aside style={{ width }} className="z-10 flex w-80 min-w-0 shrink-0 flex-col gap-3 overflow-y-auto bg-side p-3 max-lg:hidden">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium">Widgets</span>
        <Btn sm icon={X} title="Close panel" onClick={() => s.patch({ rail: false })} />
      </div>
      {w.ctx && (
        <W id="ctx" style={{ order: widgetOrder.indexOf('ctx') }} icon={Gauge} t="Context meter">
          <div className="h-2 overflow-hidden rounded-full bg-bg"><div className="h-full bg-ac" style={{ width: Math.min(100, tok / (wp.contextLimit / 100)) + '%' }} /></div>
          <p className="text-xs text-mu">About {tok.toLocaleString()} of {wp.contextLimit.toLocaleString()} tokens (estimate)</p>
        </W>
      )}
      {w.eps && (
        <W id="eps" style={{ order: widgetOrder.indexOf('eps') }} icon={Activity} t="Endpoint status">
          {s.eps.filter((e) => wp.showDisabledEndpoints || e.on).map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-sm">
              <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', e.on ? 'bg-ac' : 'bg-mu/40')} />
              <span className="flex-1 truncate">{e.name}</span>
              <span className="max-w-40 text-right text-xs text-mu">{e.on ? modelsOf(e).join(e.modelsMode === 'playlist' ? ' → ' : ', ') : 'disabled'}</span>
            </div>
          ))}
        </W>
      )}
      {w.usage && (
        <W id="usage" style={{ order: widgetOrder.indexOf('usage') }} icon={Layers} t="Usage">
          {wp.usageMode === 'success' ? [...grouped].map(([name, x]) => <div key={name} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{name}</span><span className="text-xs text-ac">{x.ok} ok</span><span className="text-xs text-er">{x.bad} failed</span></div>) : [...grouped].map(([name, x]) => <div key={name} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{name}</span><span className="text-xs text-mu">{usageText(x.tin, x.tout)}</span></div>)}
          {wp.usageTotal && <div className="border-t border-hov pt-2 text-xs"><span className="text-mu">Total usage</span><span className="float-right font-medium">{wp.usageMode === 'tokens' ? usageText([...grouped.values()].reduce((a, x) => a + x.tin, 0), [...grouped.values()].reduce((a, x) => a + x.tout, 0)) : `${[...grouped.values()].reduce((a, x) => a + x.ok, 0)} ok · ${[...grouped.values()].reduce((a, x) => a + x.bad, 0)} fails`}</span></div>}
          {!grouped.size && <p className="text-xs text-mu">No usage in this period.</p>}
        </W>
      )}
      {w.pad && (
        <W id="pad" style={{ order: widgetOrder.indexOf('pad') }} icon={StickyNote} t="Scratchpad">
          <textarea rows={wp.scratchRows} value={s.pad} onChange={(e) => s.patch({ pad: e.target.value })} placeholder="Notes that stay next to the chat" className={cx(field, 'resize-y')} />
        </W>
      )}
      {w.snips && (
        <W id="snips" style={{ order: widgetOrder.indexOf('snips') }} icon={Bookmark} t="Snippets">
          <div className="flex gap-1.5">
            <input value={n} onChange={(e) => setN(e.target.value)} placeholder="New snippet" className={field} />
            <Btn v="soft" icon={Plus} title="Save snippet" onClick={() => { if (n.trim()) { s.patch({ snips: [n.trim(), ...s.snips] }); setN('') } }} />
          </div>
          {s.snips.slice(0, wp.snippetLimit).map((t, i) => (
            <div key={i} className="flex items-center gap-1 text-sm">
              <span className="flex-1 truncate">{t}</span>
              <Btn sm icon={CornerDownLeft} title="Insert into message" onClick={() => s.patch({ draft: s.draft + t })} />
              <Btn sm icon={X} title="Remove" onClick={() => s.patch({ snips: s.snips.filter((_, j) => j !== i) })} />
            </div>
          ))}
        </W>
      )}
      {w.cost && (
        <W id="cost" style={{ order: widgetOrder.indexOf('cost') }} icon={Coins} t="Cost estimate">
          <p className="text-sm">{'≈ $' + (s.stats.cost ?? 0).toFixed(wp.costDecimals)} <span className="text-xs text-mu">all-time priced usage</span></p>
          <p className="text-xs text-mu">Set input and output rates per model in Settings → Endpoints. Unpriced usage is excluded.</p>
        </W>
      )}
      {w.last && (
        <W id="last" style={{ order: widgetOrder.indexOf('last') }} icon={Timer} t="Last reply">
          {lr ? (
            <div className="space-y-1 text-sm">
              <div className="truncate">{lr.by}</div>
              <div className="text-xs text-mu">{lr.log!.length} model{lr.log!.length > 1 ? 's' : ''} used · {lr.log!.filter((t) => t.err).length} failed{wp.lastSpeed && won ? ` · ${fmtDuration(won.ms ?? 0, wp.timeUnit)}` : ''}{wp.lastSpeed && lr.tps != null ? ` · ${lr.tps} tokens/s` : ''}</div>
            </div>
          ) : <p className="text-xs text-mu">No replies yet.</p>}
        </W>
      )}
      {w.prompts && (
        <W id="prompts" style={{ order: widgetOrder.indexOf('prompts') }} icon={ScrollText} t="Prompt picker">
          {s.prompts.filter((p) => !wp.activePromptsOnly || p.id === s.pr).length ? s.prompts.filter((p) => !wp.activePromptsOnly || p.id === s.pr).map((p) => (
            <button key={p.id} onClick={() => s.patch({ pr: s.pr === p.id ? '' : p.id })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg">
              <span className="flex-1 truncate">{p.name}</span>{s.pr === p.id && <Check size={14} className="text-ac" />}
            </button>
          )) : <p className="text-xs text-mu">No saved prompts.</p>}
        </W>
      )}
      {w.keys && (
        <W id="keys" style={{ order: widgetOrder.indexOf('keys') }} icon={Keyboard} t="Shortcuts">
          {KEYS.filter(([id]) => wp.shortcuts.includes(id)).map(([id, l, d]) => <div key={id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{l}</span><kbd className="rounded-md bg-hov px-1.5 py-0.5 text-xs">{fmt(s.keys[id] ?? d)}</kbd></div>)}
        </W>
      )}
      {w.draft && (
        <W id="draft" style={{ order: widgetOrder.indexOf('draft') }} icon={Type} t="Draft counter">
          <p className="text-sm">{s.draft.length.toLocaleString()} characters · {s.draft.trim() ? s.draft.trim().split(/\s+/).length : 0} words · about {Math.ceil(s.draft.length / Math.max(1, wp.charsPerToken))} tokens</p>
        </W>
      )}
      {w.todo && (
        <W id="todo" style={{ order: widgetOrder.indexOf('todo') }} icon={ListChecks} t="Checklist">
          <input value={td} onChange={(e) => setTd(e.target.value)} placeholder="Add a task, press Enter" className={field}
            onKeyDown={(e) => { if (e.key === 'Enter' && td.trim()) { s.patch({ todos: [...s.todos, { id: uid(), t: td.trim(), done: false }] }); setTd('') } }} />
          {s.todos.filter((x) => !wp.hideDoneTodos || !x.done).map((x) => (
            <div key={x.id} className="flex items-center gap-2 text-sm">
              <button onClick={() => s.patch({ todos: s.todos.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)) })} className={cx('grid size-5 shrink-0 place-items-center rounded-md', x.done ? 'bg-ac text-acx' : 'bg-bg')}>{x.done && <Check size={13} />}</button>
              <span className={cx('flex-1', x.done && 'text-mu line-through')}>{x.t}</span>
              <Btn sm icon={X} title="Remove" onClick={() => s.patch({ todos: s.todos.filter((y) => y.id !== x.id) })} />
            </div>
          ))}
        </W>
      )}
    </aside>
  )
}
