import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Gauge, Activity, Layers, StickyNote, Bookmark, Plus, X, CornerDownLeft, Coins, Timer, ScrollText, Keyboard, Type, ListChecks, Check, GripVertical } from 'lucide-react'
import { useS, modelsOf, uid, widgetOn } from '../store'
import { clampWidgetWidth } from '../layout'
import { fmtDuration, KEYS, WIDGETS } from '../meta'
import { estimateHistoryTokens, fmt } from '../engine'
import { qualityPrompt } from '../flair'
import { allAttemptAts, allAttemptLogs, groupUsage, lastLogMessage, usageRange } from '../usage'
import { Btn, Surface, cx, type Ic } from './ui'
import { SortableList, type SortHandleProps } from './dnd'

/* Side-panel widgets.
 *
 * Each widget is its own memoized component with the narrowest possible
 * subscription: the panel shell never reads chat history, and no widget
 * depends on the text of an in-flight reply. Streaming a response therefore
 * costs this panel nothing — a chunk replaces message text while keeping the
 * `log` arrays that the usage/last-reply widgets actually derive from. */

const WidgetCard = ({ icon: I, t, handle, children }: { icon: Ic; t: string; handle: SortHandleProps; children: ReactNode }) => {
  return <Surface className="space-y-3">
    <div className="flex items-center gap-2 text-sm font-medium"><span {...handle} title="Drag to rearrange" className="dnd-handle cursor-grab text-mu"><GripVertical size={14} /></span><I size={16} className="text-ac" />{t}</div>
    {children}
  </Surface>
}
const field = 'w-full rounded-lg bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40'

const WP_DEFAULTS = { contextLimit: 128000, showDisabledEndpoints: true, scratchRows: 6, snippetLimit: 20, costDecimals: 4, activePromptsOnly: false, charsPerToken: 4, hideDoneTodos: false }

type WidgetProps = { handle: SortHandleProps }

/** Widget preferences with defaults applied. The stored object is reference
 *  stable, so the merge runs once per change rather than per render. */
function useWidgetPrefs() {
  const raw = useS((s) => s.widgetPrefs)
  return useMemo(() => ({ ...WP_DEFAULTS, ...raw }), [raw])
}

const ContextMeterWidget = memo(({ handle }: WidgetProps) => {
  // Numbers, so a streamed chunk only re-renders the meter when the estimate
  // actually moves (the whole-chat selector below stays off the text path).
  const tokens = useS((s) => {
    const global = s.globalPrompt
    const sysLen = (global?.on ? global.text + ((global.qualities?.length ?? 0) ? '\n\n' + qualityPrompt(global.qualities) : '') : '') + (s.prompts.find((p) => p.id === s.pr)?.text ?? '')
    const msgs = s.chats.find((c) => c.id === s.chat)?.msgs ?? []
    return estimateHistoryTokens(msgs, sysLen, Math.max(1, s.widgetPrefs?.charsPerToken ?? 4))
  })
  const limit = useS((s) => s.widgetPrefs?.contextLimit ?? 128000)
  const overBudget = tokens > limit
  return (
    <WidgetCard handle={handle} icon={Gauge} t="Context meter">
      <div className="h-2 overflow-hidden rounded-full bg-bg"><div className="h-full bg-ac" style={{ width: Math.min(100, tokens / (limit / 100)) + '%' }} /></div>
      <p className="text-xs text-mu">About {tokens.toLocaleString()} of {limit.toLocaleString()} tokens (estimate){overBudget ? ' — over budget: oldest messages are trimmed from requests until it fits' : ''}</p>
    </WidgetCard>
  )
})

const EndpointStatusWidget = memo(({ handle }: WidgetProps) => {
  const eps = useS((s) => s.eps)
  const showDisabled = useS((s) => s.widgetPrefs?.showDisabledEndpoints !== false)
  return (
    <WidgetCard handle={handle} icon={Activity} t="Endpoint status">
      {eps.filter((e) => showDisabled || e.on).map((e) => (
        <div key={e.id} className="flex items-start gap-2 text-sm">
          <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', e.on ? 'bg-ac' : 'bg-mu/40')} />
          <span className="flex-1 truncate">{e.name}</span>
          <span className="max-w-40 text-right text-xs text-mu">{e.on ? modelsOf(e).join(e.modelsMode === 'playlist' ? ' → ' : ', ') : 'disabled'}</span>
        </div>
      ))}
    </WidgetCard>
  )
})

/** `useShallow` on the attempt arrays keeps this widget off the streaming
 *  render path: the `log` references survive a text-only chunk update. */
const UsageWidget = memo(({ handle }: WidgetProps) => {
  const wp = useWidgetPrefs()
  const logs = useS(useShallow((s) => allAttemptLogs(s.chats)))
  const ats = useS(useShallow((s) => allAttemptAts(s.chats)))
  const { usagePeriod, usageFrom, usageTo, usageGroup, usageMode, usageFormat, usageTotal } = wp
  // Bucketed so the window refreshes on a later render instead of making the
  // memo depend on a value that changes on every render.
  const renderMinute = Math.floor(Date.now() / 60000)
  const grouped = useMemo(
    () => groupUsage(logs, ats, usageGroup, usageRange({ period: usagePeriod, from: usageFrom, to: usageTo, now: Date.now() })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, ats, usageGroup, usagePeriod, usageFrom, usageTo, renderMinute],
  )
  const usageText = (tin: number, tout: number) => usageFormat.replaceAll('{in}', tin.toLocaleString()).replaceAll('{out}', tout.toLocaleString())
  const totals = grouped.reduce((a, x) => ({ ok: a.ok + x.ok, bad: a.bad + x.bad, tin: a.tin + x.tin, tout: a.tout + x.tout }), { ok: 0, bad: 0, tin: 0, tout: 0 })
  return (
    <WidgetCard handle={handle} icon={Layers} t="Usage">
      {usageMode === 'success' ? grouped.map((x) => <div key={x.key} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{x.key}</span><span className="text-xs text-ac">{x.ok} ok</span><span className="text-xs text-er">{x.bad} failed</span></div>) : grouped.map((x) => <div key={x.key} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{x.key}</span><span className="text-xs text-mu">{usageText(x.tin, x.tout)}</span></div>)}
      {usageTotal && <div className="border-t border-bor pt-2 text-xs"><span className="text-mu">Total usage</span><span className="float-right font-medium">{usageMode === 'tokens' ? usageText(totals.tin, totals.tout) : `${totals.ok} ok · ${totals.bad} fails`}</span></div>}
      {!grouped.length && <p className="text-xs text-mu">No usage in this period.</p>}
    </WidgetCard>
  )
})

const ScratchpadWidget = memo(({ handle }: WidgetProps) => {
  const pad = useS((s) => s.pad)
  const patch = useS((s) => s.patch)
  const wp = useWidgetPrefs()
  return (
    <WidgetCard handle={handle} icon={StickyNote} t="Scratchpad">
      <textarea rows={wp.scratchRows} value={pad} onChange={(e) => patch({ pad: e.target.value })} placeholder="Notes that stay next to the chat" className={cx(field, 'resize-y')} />
    </WidgetCard>
  )
})

const SnippetsWidget = memo(({ handle }: WidgetProps) => {
  const snips = useS((s) => s.snips)
  const draft = useS((s) => s.draft)
  const patch = useS((s) => s.patch)
  const wp = useWidgetPrefs()
  const [n, setN] = useState('')
  return (
    <WidgetCard handle={handle} icon={Bookmark} t="Snippets">
      <div className="flex gap-1.5">
        <input value={n} onChange={(e) => setN(e.target.value)} placeholder="New snippet" className={field} />
        <Btn v="soft" icon={Plus} title="Save snippet" onClick={() => { if (n.trim()) { patch({ snips: [n.trim(), ...snips] }); setN('') } }} />
      </div>
      {snips.slice(0, wp.snippetLimit).map((t, i) => (
        <div key={i} className="flex items-center gap-1 text-sm">
          <span className="flex-1 truncate">{t}</span>
          <Btn sm icon={CornerDownLeft} title="Insert into message" onClick={() => patch({ draft: draft + t })} />
          <Btn sm icon={X} title="Remove" onClick={() => patch({ snips: snips.filter((_, j) => j !== i) })} />
        </div>
      ))}
    </WidgetCard>
  )
})

const CostWidget = memo(({ handle }: WidgetProps) => {
  const cost = useS((s) => s.stats.cost ?? 0)
  const wp = useWidgetPrefs()
  return (
    <WidgetCard handle={handle} icon={Coins} t="Cost estimate">
      <p className="text-sm">{'≈ $' + cost.toFixed(wp.costDecimals)} <span className="text-xs text-mu">all-time priced usage</span></p>
      <p className="text-xs text-mu">Uses the spend reported by the provider when available (e.g. OpenRouter); otherwise uses the per-model rates in Settings → Endpoints. Unpriced usage is excluded.</p>
    </WidgetCard>
  )
})

const LastReplyWidget = memo(({ handle }: WidgetProps) => {
  // Reference-stable selector: the newest message that reported usage, which
  // is not the message being streamed.
  const lr = useS((s) => lastLogMessage(s.chats, s.chat))
  const wp = useWidgetPrefs()
  const won = lr?.log?.find((t) => !t.err && t.ms != null)
  return (
    <WidgetCard handle={handle} icon={Timer} t="Last reply">
      {lr ? (
        <div className="space-y-1 text-sm">
          <div className="truncate">{lr.by}</div>
          <div className="text-xs text-mu">{lr.log!.length} model{lr.log!.length > 1 ? 's' : ''} used · {lr.log!.filter((t) => t.err).length} failed{wp.lastSpeed && won ? ` · ${fmtDuration(won.ms ?? 0, wp.timeUnit)}` : ''}{wp.lastSpeed && lr.tps != null ? ` · ${lr.tps} tokens/s` : ''}</div>
        </div>
      ) : <p className="text-xs text-mu">No replies yet.</p>}
    </WidgetCard>
  )
})

const PromptsWidget = memo(({ handle }: WidgetProps) => {
  const prompts = useS((s) => s.prompts)
  const pr = useS((s) => s.pr)
  const patch = useS((s) => s.patch)
  const wp = useWidgetPrefs()
  const shown = prompts.filter((p) => !wp.activePromptsOnly || p.id === pr)
  return (
    <WidgetCard handle={handle} icon={ScrollText} t="Prompt picker">
      {shown.length ? shown.map((p) => (
        <button key={p.id} onClick={() => patch({ pr: pr === p.id ? '' : p.id })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg">
          <span className="flex-1 truncate">{p.name}</span>{pr === p.id && <Check size={14} className="text-ac" />}
        </button>
      )) : <p className="text-xs text-mu">No saved prompts.</p>}
    </WidgetCard>
  )
})

const KeysWidget = memo(({ handle }: WidgetProps) => {
  const keys = useS((s) => s.keys)
  const wp = useWidgetPrefs()
  return (
    <WidgetCard handle={handle} icon={Keyboard} t="Shortcuts">
      {KEYS.filter(([kid]) => wp.shortcuts.includes(kid)).map(([kid, l, d]) => <div key={kid} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{l}</span><kbd className="rounded-md bg-hov px-1.5 py-0.5 text-xs">{fmt(keys[kid] ?? d)}</kbd></div>)}
    </WidgetCard>
  )
})

const DraftWidget = memo(({ handle }: WidgetProps) => {
  const draft = useS((s) => s.draft)
  const wp = useWidgetPrefs()
  return (
    <WidgetCard handle={handle} icon={Type} t="Draft counter">
      <p className="text-sm">{draft.length.toLocaleString()} characters · {draft.trim() ? draft.trim().split(/\s+/).length : 0} words · about {Math.ceil(draft.length / Math.max(1, wp.charsPerToken))} tokens</p>
    </WidgetCard>
  )
})

const TodoWidget = memo(({ handle }: WidgetProps) => {
  const todos = useS((s) => s.todos)
  const patch = useS((s) => s.patch)
  const wp = useWidgetPrefs()
  const [td, setTd] = useState('')
  const shown = todos.filter((x) => !wp.hideDoneTodos || !x.done)
  return (
    <WidgetCard handle={handle} icon={ListChecks} t="Checklist">
      <input value={td} onChange={(e) => setTd(e.target.value)} placeholder="Add a task, press Enter" className={field}
        onKeyDown={(e) => { if (e.key === 'Enter' && td.trim()) { patch({ todos: [...todos, { id: uid(), t: td.trim(), done: false }] }); setTd('') } }} />
      {shown.map((x) => (
        <div key={x.id} className="flex items-center gap-2 text-sm">
          <button onClick={() => patch({ todos: todos.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)) })} className={cx('grid size-5 shrink-0 place-items-center rounded-md', x.done ? 'bg-ac text-acx' : 'bg-bg')}>{x.done && <Check size={13} />}</button>
          <span className={cx('flex-1', x.done && 'text-mu line-through')}>{x.t}</span>
          <Btn sm icon={X} title="Remove" onClick={() => patch({ todos: todos.filter((y) => y.id !== x.id) })} />
        </div>
      ))}
    </WidgetCard>
  )
})

/* Widget id -> component. Kept as a plain map so the shell has no switch. */
const WIDGET_BODY: Record<string, (p: WidgetProps) => ReactNode> = {
  ctx: ContextMeterWidget,
  eps: EndpointStatusWidget,
  usage: UsageWidget,
  pad: ScratchpadWidget,
  snips: SnippetsWidget,
  cost: CostWidget,
  last: LastReplyWidget,
  prompts: PromptsWidget,
  keys: KeysWidget,
  draft: DraftWidget,
  todo: TodoWidget,
}

export function Widgets({ width = 320 }: { width?: number }) {
  const { widgetPrefs, widgets, features, patch } = useS(useShallow((s) => ({ widgetPrefs: s.widgetPrefs, widgets: s.widgets, features: s.features, patch: s.patch })))
  const safeWidth = clampWidgetWidth(width)
  const wp = useMemo(() => ({ ...WP_DEFAULTS, ...widgetPrefs }), [widgetPrefs])
  const order = useMemo(() => [...new Set([...(wp.widgetOrder ?? []), ...WIDGETS.map(([k]) => k)])], [wp])
  const visible = useMemo(
    () => order.filter((k) => widgetOn({ widgets, features }, k)),
    [order, widgets, features],
  )

  const commitWidgets = useCallback((from: number, to: number) => {
    if (from === to) return
    const nextVisible = [...visible]
    const [x] = nextVisible.splice(from, 1)
    nextVisible.splice(to, 0, x)
    // Preserve hidden widgets in their existing slots; only permute visible ones.
    const queue = [...nextVisible]
    const visSet = new Set(visible)
    const nextOrder = order.map((k) => (visSet.has(k) ? queue.shift()! : k))
    patch({ widgetPrefs: { ...wp, widgetOrder: nextOrder } })
  }, [visible, order, wp, patch])

  const renderWidget = useCallback((id: string, api: { handleProps: (label?: string) => SortHandleProps }) => {
    const Body = WIDGET_BODY[id]
    if (!Body) return null
    const title = WIDGETS.find(([k]) => k === id)?.[1] ?? id
    return <Body handle={api.handleProps(`Reorder ${title} widget`)} />
  }, [])

  return (
    <aside style={{ width: safeWidth, maxWidth: '90vw' }} className="z-20 flex min-w-0 shrink-0 flex-col gap-3 overflow-y-auto border-l border-bor bg-side p-3 max-lg:fixed max-lg:inset-y-0 max-lg:right-0">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium">Widgets</span>
        <Btn sm icon={X} title="Close panel" onClick={() => patch({ rail: false })} />
      </div>
      <SortableList
        ids={visible}
        onCommit={commitWidgets}
        label="Widget"
        describe={(id) => WIDGETS.find(([k]) => k === id)?.[1] ?? id}
        className="flex flex-col gap-3"
        renderItem={renderWidget}
      />
    </aside>
  )
}
