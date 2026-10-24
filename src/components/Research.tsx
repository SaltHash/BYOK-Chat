import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Copy, Download, FileText, Globe, ListFilter, ListOrdered, Pencil, Play, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { useS, useLive, type Msg } from '../store'
import { PLAN_INTRO, RESEARCH_TIERS, dedupTrace, reasoningBlocks, tierOf, type ResearchPlan, type ResearchPlanStep, type ResearchTierId } from '../research'
import { claimForCitation, collectMessageSources, linkifyCitations, stripCitations } from '../citations'
import { Md } from './Md'
import { SourcesPanel, scrollToSource } from './Sources'
import { Btn, cx } from './ui'

const PLAN_ICONS = { search: Globe, analyze: ListFilter, report: FileText, other: Sparkles } as const

/** One plan step: its icon, label and the numbered research directions under
 * it. Read-only here; editing happens in `ResearchPlanCard`. */
function PlanStepRow({ step, last }: { step: ResearchPlanStep; last: boolean }) {
  const Icon = PLAN_ICONS[step.kind] ?? Sparkles
  return (
    <li className="relative pl-9">
      {!last && <span aria-hidden="true" className="absolute left-[13px] top-7 h-[calc(100%-1rem)] w-px bg-hov" />}
      <Icon size={18} className="absolute left-0 top-0.5 text-mu" />
      <div className="text-sm font-medium">{step.label}</div>
      {step.items.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {step.items.map((it, i) => <li key={i} className="text-xs leading-relaxed text-mu">{it}</li>)}
        </ul>
      )}
    </li>
  )
}

/** The estimate/tier summary shown on the plan card before the run starts. */
function PlanEstimate({ msg }: { msg: Msg }) {
  const rs = msg.research
  const est = rs?.estimate
  if (!est) return null
  const cost = est.costUsd != null
    ? `≈$${est.costUsd < 0.01 ? est.costUsd.toFixed(3) : est.costUsd.toFixed(2)}`
    : `≈${Math.round(est.inputTokens / 1000)}k in / ${Math.round(est.outputTokens / 1000)}k out tokens`
  return <p className="text-xs text-mu">Up to {est.searches} searches · {est.reads} reads · {cost} (ceiling estimate)</p>
}

/** The plan card: shows "Generating research plan" while the plan drafts, then
 * the plan itself with Edit plan / Start research / cancel. Nothing runs until
 * the user starts it. */
export function ResearchPlanCard({ msg }: { msg: Msg }) {
  const start = useS((s) => s.startResearch)
  const stop = useS((s) => s.stopResearch)
  const save = useS((s) => s.updateResearchPlan)
  const busy = useS((s) => s.busy)
  const rs = msg.research
  const [draft, setDraft] = useState<ResearchPlan | null>(rs?.plan ?? null)
  // `mode` is the edit button's two-state behaviour:
  //  - 'view': show the plan as a list. "Edit plan" focuses the composer.
  //  - 'focus': just focused the composer; button now says "Edit plan manually"
  //    and a click enters actual editing.
  //  - 'edit': the manual in-place editing controls are shown.
  const [mode, setMode] = useState<'view' | 'focus' | 'edit'>('view')
  // The plan arrives after the generation round returns; adopt it (and reset
  // the edit state) whenever the stored plan or the status changes.
  useEffect(() => { setDraft(rs?.plan ?? null); setMode('view') }, [rs?.plan, rs?.status])
  const planning = rs?.status === 'planning'
  const plan = draft ?? rs?.plan
  // Trim trailing whitespace only when the plan is committed, never on every
  // keystroke: rewriting the controlled value mid-edit makes React reset the
  // caret, so pressing space at the end of a line jumps to the end of the field.
  const trimPlan = (p: ResearchPlan): ResearchPlan => ({ ...p, steps: p.steps.map((s) => ({ ...s, label: s.label.replace(/\s+$/, ''), items: s.items.map((x) => x.replace(/\s+$/, '')) })) })
  const startNow = () => { if (plan) { const p = trimPlan(plan); save(msg.id, p); start(msg.id) } }
  const updateStep = (id: string, patch: Partial<ResearchPlanStep>) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : d))
  // Single click on "Edit plan" jumps back into the composer with a quick
  // outline fade animation, then the button relabels so a second click opens
  // the manual editor.
  const composerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const ta = document.getElementById('composer')
    if (ta) composerRef.current = ta
  }, [])
  // Bail out only after every hook above has run so the hook order stays stable
  // across the render where a message first gains a research run.
  if (!rs || (rs.status !== 'planning' && rs.status !== 'plan')) return null
  const onEditText = () => {
    setMode('focus')
    const ta = composerRef.current ?? (document.getElementById('composer') as HTMLElement | null)
    if (ta) {
      ta.focus()
      // Quick outline that fades in then out in the theme's main border color,
      // anchored to the composer box, to confirm focus moved there.
      const host = ta.parentElement
      if (host) {
        const el = document.createElement('div')
        el.className = 'composer-focus-outline'
        el.style.cssText = 'position:absolute;pointer-events:none;border-radius:1.25rem;border:2px solid var(--bor);opacity:0;animation:composerOutlineFade 0.45s ease-out forwards;'
        const r = ta.getBoundingClientRect()
        const h = host.getBoundingClientRect()
        el.style.left = `${r.left - h.left}px`
        el.style.top = `${r.top - h.top}px`
        el.style.width = `${r.width}px`
        el.style.height = `${r.height}px`
        host.style.position = host.style.position === 'static' || !host.style.position ? 'relative' : host.style.position
        host.appendChild(el)
        setTimeout(() => { if (host.contains(el)) host.removeChild(el) }, 460)
      }
    }
  }
  const onEditManual = () => { setMode('edit') }
  const commitEdit = () => { if (draft) { save(msg.id, trimPlan(draft)); setMode('view') } }
  const cancelEdit = () => { setDraft(rs?.plan ?? null); setMode('view') }
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm">{PLAN_INTRO}</p>
      <section aria-label="Research plan" aria-live="polite" className="space-y-4 rounded-2xl border border-bor bg-surf p-4">
        <h3 className="text-sm font-medium">{plan?.title || rs.query.slice(0, 90)}</h3>
        {planning ? (
          <p role="status" aria-label="Generating research plan" className="flex items-center text-sm text-mu">
            <span className="reply-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="ml-2">{rs.scope ? `Getting context · ${rs.scope} ${rs.scope === 1 ? 'search' : 'searches'}…` : 'Generating research plan…'}</span>
          </p>
        ) : plan ? (
          mode === 'edit' ? (
            <div className="space-y-4">
              {plan.steps.map((s) => (
                <div key={s.id} className="space-y-1.5">
                  <input
                    value={s.label}
                    onChange={(e) => updateStep(s.id, { label: e.target.value })}
                    aria-label={`Plan step label: ${s.label || 'untitled'}`}
                    className="w-full rounded-lg bg-bg px-2.5 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ac/40"
                  />
                  <textarea
                    value={s.items.join('\n')}
                    onChange={(e) => updateStep(s.id, { items: e.target.value.split('\n') })}
                    rows={Math.min(10, Math.max(2, s.items.length + 1))}
                    aria-label={`Plan step details: ${s.label || 'untitled'}`}
                    className="w-full resize-y rounded-lg bg-bg px-2.5 py-1.5 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ac/40"
                  />
                </div>
              ))}
              <div className="flex gap-2 justify-end">
                <Btn v="soft" icon={X} onClick={cancelEdit}>Cancel</Btn>
                <Btn v="solid" icon={Check} onClick={commitEdit}>Save plan</Btn>
              </div>
            </div>
          ) : (
            <ol className="space-y-3">
              {plan.steps.map((s, i) => <PlanStepRow key={s.id} step={s} last={i === plan.steps.length - 1} />)}
            </ol>
          )
        ) : null}
        {rs.error && <p className="text-xs text-mu">{rs.error}</p>}
        {!planning && plan && <PlanEstimate msg={msg} />}
        <div className="flex items-center justify-end gap-2">
          {!planning && plan && (
            <button
              onClick={mode === 'view' ? onEditText : mode === 'focus' ? onEditManual : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-mu hover:bg-hov hover:text-tx"
            >
              {mode === 'view' && <><Pencil size={14} />Edit plan</>}
              {mode === 'focus' && <>Edit plan manually</>}
              {mode === 'edit' && <><Pencil size={14} />Editing…</>}
            </button>
          )}
          {!planning && plan && (
            <button disabled={busy} onClick={startNow} className="inline-flex items-center gap-1.5 rounded-lg bg-ac px-4 py-2 text-sm font-medium text-acx transition-opacity hover:opacity-90 disabled:opacity-50">
              <Play size={15} fill="currentColor" />Start research
            </button>
          )}
          <Btn icon={X} title={planning ? 'Cancel plan generation' : 'Cancel research'} disabled={busy && !planning} onClick={() => stop(msg.id)} />
        </div>
      </section>
    </div>
  )
}

export function ResearchTierPicker({ msg }: { msg: Msg }) {
  const choose = useS((s) => s.chooseResearchTier)
  const stop = useS((s) => s.stopResearch)
  const busy = useS((s) => s.busy)
  const def = useS((s) => s.research?.defaultTier)
  const rs = msg.research
  if (!rs || rs.status !== 'tier-pick') return null
  return (
    <section aria-label="Choose research depth" className="max-w-xl space-y-3 rounded-xl border border-bor bg-surf p-4">
      <div>
        <h3 className="text-sm font-medium">Deep research on “{rs.query.slice(0, 120)}”</h3>
        <p className="mt-1 text-xs text-mu">Pick a depth. The model then drafts a research plan for you to review, and only searches the web and reads pages once you start it.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {RESEARCH_TIERS.map((t) => (
          <button
            key={t.id}
            disabled={busy}
            onClick={() => choose(msg.id, t.id as ResearchTierId)}
            title={`${t.label}: up to ${t.maxSearches} searches and ${t.maxReads} page reads`}
            className={cx('rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-hov disabled:opacity-50', rs.tier === t.id ? 'border-ac bg-ac/10' : 'border-bor')}
            aria-pressed={rs.tier === t.id}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">{t.label}{def === t.id && <span className="rounded-sm bg-hov px-1.5 py-0.5 text-[10px] font-medium text-mu">default</span>}</span>
            <span className="mt-0.5 block text-xs text-mu">{t.blurb}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-mu">Default is remembered for next time.</span>
        <button disabled={busy} onClick={() => stop(msg.id)} className="rounded-lg px-3 py-1.5 text-xs text-mu hover:bg-hov hover:text-tx disabled:opacity-50">Cancel</button>
      </div>
    </section>
  )
}

export function ResearchProgressCard({ msg }: { msg: Msg }) {
  const stop = useS((s) => s.stopResearch)
  const resume = useS((s) => s.resumeResearch)
  const busy = useS((s) => s.busy)
  const rs = msg.research
  const live = useLive((l) => l.tools[msg.id]) as { name?: string }[] | undefined
  const toolBusy = !!live?.some((c) => c.name === 'search' || c.name === 'fetch_page')
  const note = (rs?.note ?? '').trim()
  const reasoning = (rs?.reasoning ?? '').trim()
  // Intermittent reasoning behind the run: the model's own text between tool
  // calls, persisted on tool rounds, plus provider reasoning summaries.
  // Shown alongside the searches/fetches so the thinking stays visible.
  // Round texts already attached as step leads are filtered out (see
  // `dedupTrace`) so the same narration never appears twice.
  const trace = useMemo(() => {
    const texts: string[] = []
    for (const round of msg.toolRounds ?? []) {
      const t = String((round as { text?: string }).text ?? '').trim()
      if (t && t.length > 1 && !texts.includes(t)) texts.push(t)
    }
    const leads = (rs?.steps ?? []).map((s) => s.lead ?? '').filter(Boolean)
    return dedupTrace(texts, leads).slice(-12)
  }, [msg.toolRounds, rs?.steps])
  // Writing the report hands the card over to ResearchTile, and the report
  // text streams only in the side panel. A stopped or failed run with no
  // steps (e.g. a cancelled tier pick) still renders a one-line notice so
  // the chat never shows an unexplained empty gap.
  if (!rs || (rs.status !== 'running' && rs.status !== 'stopped' && rs.status !== 'error')) return null
  if (rs.status !== 'running' && !rs.steps.length && !rs.error && rs.status !== 'stopped') return null
  const done = rs.steps.filter((s) => s.state === 'done').length
  const tier = tierOf(rs.tier ?? 'standard')
  const usedSearches = rs.steps.filter((s) => s.kind === 'search').length
  const canResume = rs.status === 'stopped' && usedSearches < tier.maxSearches && !!msg.toolRounds?.length
  return (
    <section aria-label="Deep research progress" aria-live="polite" className="max-w-xl space-y-2 rounded-xl border border-bor bg-surf p-4">
      <div className="flex items-center gap-2 text-sm">
        <ListOrdered size={15} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {rs.status === 'running' ? `Researching · ${tier.label} · ${done}/${rs.steps.length} steps` : rs.status === 'stopped' ? 'Research stopped' : 'Research needs attention'}
        </span>
        {rs.status === 'running' && busy && (
          <button onClick={() => stop(msg.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-hov px-2.5 py-1.5 text-xs font-medium hover:opacity-80">
            <Square size={12} fill="currentColor" />Stop
          </button>
        )}
        {canResume && (
          <button disabled={busy} onClick={() => resume(msg.id)} title="Continue with the remaining search budget" className="inline-flex items-center gap-1.5 rounded-lg bg-hov px-2.5 py-1.5 text-xs font-medium hover:opacity-80 disabled:opacity-50">
            <RotateCcw size={12} />Resume
          </button>
        )}
      </div>
      {rs.plan && (
        <details className="rounded-lg bg-bg/60 px-2.5 py-1.5">
          <summary className="cursor-pointer text-xs font-medium text-mu hover:text-tx">Research plan · {rs.plan.steps.length} steps</summary>
          <ol className="mt-1.5 space-y-2">
            {rs.plan.steps.map((s, i) => <PlanStepRow key={s.id} step={s} last={i === rs.plan!.steps.length - 1} />)}
          </ol>
        </details>
      )}
      <ol className="space-y-2">
        {rs.steps.map((s) => (
          <li key={s.id} className="space-y-1.5">
            {/* What the model wrote right before this set of searches. */}
            {s.lead && <p className="whitespace-pre-wrap border-l-2 border-bor pl-2.5 text-xs leading-relaxed text-mu">{s.lead}</p>}
            <div className="flex items-center gap-2 text-sm">
              {s.state === 'done' ? <Check size={14} className="shrink-0 text-ac" /> : s.state === 'running' ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-ac" /> : s.state === 'error' ? <X size={14} className="shrink-0 text-er" /> : <span className="size-2 shrink-0 rounded-full bg-hov" />}
              <span className="min-w-0 flex-1 truncate">{s.label}{s.query ? <span className="text-mu"> · {s.query.slice(0, 70)}</span> : ''}</span>
              {s.sources != null && <span className="shrink-0 text-xs text-mu">{s.sources} sources</span>}
            </div>
          </li>
        ))}
        {/* The round streaming right now. It moves onto the step this round is
            about to produce, so it stays above the searches it leads to. */}
        {rs.status === 'running' && note && (
          <li><p className="whitespace-pre-wrap border-l-2 border-bor pl-2.5 text-xs leading-relaxed text-mu">{note}</p></li>
        )}
      </ol>
      {rs.status === 'running' && !toolBusy && !note && (
        <p role="status" aria-label="Model thinking" className="flex items-center text-sm text-mu">
          <span className="reply-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="ml-1">Thinking…</span>
        </p>
      )}
      {(trace.length > 0 || reasoning) && (
        <details className="rounded-lg bg-bg/60 px-2.5 py-1.5">
          <summary className="cursor-pointer text-xs font-medium text-mu hover:text-tx">Model reasoning · {trace.length + (reasoning ? 1 : 0)}</summary>
          <div className="mt-1.5 space-y-1.5">
            {trace.map((t, i) => (
              <p key={i} className="whitespace-pre-wrap border-l-2 border-ac/40 pl-2.5 text-xs leading-relaxed text-mu">{t.slice(0, 1200)}</p>
            ))}
            {reasoning && <p className="whitespace-pre-wrap border-l-2 border-ac/40 pl-2.5 text-xs leading-relaxed text-mu">{reasoning.slice(-2000)}</p>}
          </div>
        </details>
      )}
      {rs.status === 'error' && rs.error && <p className="text-xs text-er">{rs.error}</p>}
    </section>
  )
}

/* The run's card: it becomes the report card the moment the model starts
 * writing, and shows the model's own abstract as its sample text. Stopped
 * and failed runs keep the card when a partial report exists, so the work
 * (and its sources) stays reachable instead of stranded. */
export function ResearchTile({ msg, onOpen }: { msg: Msg; onOpen: () => void }) {
  const rs = msg.research
  const sources = useMemo(() => collectMessageSources(msg.toolRounds), [msg.toolRounds])
  const partial = (msg.toolFinal ?? msg.t ?? '').trim()
  if (!rs || (rs.status !== 'writing' && rs.status !== 'done' && !(partial && (rs.status === 'stopped' || rs.status === 'error')))) return null
  const writing = rs.status === 'writing'
  const label = tierOf(rs.tier ?? 'standard').label
  const head = writing ? `Writing research report · ${label}` : rs.status === 'done' ? `Research report · ${label}` : `Partial research report · ${label}`
  return (
    <section
      aria-label="Research report"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className="max-w-xl cursor-pointer space-y-2 rounded-xl border border-bor bg-surf/50 p-3 transition-colors hover:border-ac/50"
    >
      <div className="flex items-center gap-2 text-sm">
        {writing ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-ac" /> : <BookOpen size={15} className="shrink-0 text-ac" />}
        <span className="min-w-0 flex-1 truncate font-medium">{head}</span>
        <span className="shrink-0 text-xs text-mu">{sources.length} sources</span>
      </div>
      {rs.summary && <p className="whitespace-pre-wrap text-sm text-mu">{rs.summary}</p>}
      <div>
        <Btn v="soft" icon={FileText} onClick={onOpen} className="w-auto">Open report</Btn>
      </div>
    </section>
  )
}

/* Document-styled side panel: Report / Sources / Reasoning tabs, rendered
 * markdown, download + copy, no code chrome. Citations follow the search
 * tool setting: off strips them, pills render jump-to-source pills, links
 * render plain markdown links. */
export function ResearchPanel({ msg, onClose }: { msg: Msg; onClose: () => void }) {
  const [tab, setTab] = useState<'report' | 'sources' | 'reasoning'>('report')
  const [copied, setCopied] = useState(false)
  const [srcFlash, setSrcFlash] = useState<string | null>(null)
  const [srcClaim, setSrcClaim] = useState<string | null>(null)
  const citeStyle = useS((s) => s.search?.citeStyle)
  const sources = useMemo(() => collectMessageSources(msg.toolRounds), [msg.toolRounds])
  const cited = useMemo(() => citeStyle === 'off' ? stripCitations(msg.toolFinal ?? msg.t) : linkifyCitations(msg.toolFinal ?? msg.t, sources), [msg.toolFinal, msg.t, sources, citeStyle])
  const cites = useMemo(() => citeStyle === 'pills' && sources.length ? {
    sources,
    onCite: (citeId: string) => {
      setTab('sources')
      setSrcFlash(citeId.toUpperCase())
      setSrcClaim(claimForCitation(msg.toolFinal ?? msg.t, citeId))
      window.setTimeout(() => scrollToSource(msg.id, citeId), 60)
      window.setTimeout(() => setSrcFlash((v) => (v === citeId.toUpperCase() ? null : v)), 1800)
    },
  } : undefined, [citeStyle, sources, msg.id])
  const trace = useMemo(() => {
    const texts: string[] = []
    for (const round of msg.toolRounds ?? []) {
      const t = String((round as { text?: string }).text ?? '').trim()
      if (t && !texts.includes(t)) texts.push(t)
    }
    const leads = (msg.research?.steps ?? []).map((s) => s.lead ?? '').filter(Boolean)
    return dedupTrace(texts, leads)
  }, [msg.toolRounds, msg.research?.steps])
  const reasoning = (msg.research?.reasoning ?? '').trim()
  const blocks = useMemo(() => reasoningBlocks(msg.research?.steps ?? []), [msg.research?.steps])
  const rs = msg.research
  // The report streams into the panel: keep the newest text in view, but stop
  // the moment the user scrolls away from the bottom. Scrolling back to the
  // bottom resumes auto-scrolling.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(true)
  const writing = rs?.status === 'writing'
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }
  useEffect(() => {
    if (tab !== 'report' || !writing || !pinned) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [cited, tab, writing, pinned])
  const download = () => {
    const name = `${(rs?.query ?? 'research').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'research'}.md`
    const body = `# Deep research: ${rs?.query ?? ''}\n\n_Tier: ${rs?.tier ?? ''} · ${sources.length} sources_\n\n${msg.toolFinal ?? msg.t}\n\n## Sources\n\n${sources.map((s) => `- [${s.citeId}] ${s.title} — ${s.url}`).join('\n')}\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 999)
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-bor px-3 py-2">
        <BookOpen size={15} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Research · {rs?.query.slice(0, 80)}</span>
        <div role="tablist" aria-label="Research view" className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-hov p-0.5">
          {(['report', 'sources', 'reasoning'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cx('rounded-md px-2 py-1 text-xs capitalize', tab === v ? 'bg-surf text-tx' : 'text-mu hover:text-tx')}>
              {v}
            </button>
          ))}
        </div>
        <Btn sm icon={Download} title="Download report as Markdown" onClick={download} />
        <Btn sm icon={copied ? Check : Copy} title="Copy report" onClick={() => { void navigator.clipboard?.writeText(msg.toolFinal ?? msg.t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {}) }} />
        <Btn sm icon={X} title="Close research panel" onClick={onClose} />
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'report' ? (
          <article className="leading-7"><Md t={cited} cites={cites} /></article>
        ) : tab === 'sources' ? (
          <SourcesPanel msgId={msg.id} text={msg.toolFinal ?? msg.t} sources={sources} defaultOpen strict={false} flash={srcFlash} claim={srcClaim} />
        ) : (
          <div className="space-y-3">
            {msg.research?.plan && (
              <details className="rounded-lg bg-bg/60 px-2.5 py-1.5" open>
                <summary className="cursor-pointer text-xs font-medium text-mu hover:text-tx">Research plan · {msg.research.plan.steps.length} steps</summary>
                <ol className="mt-1.5 space-y-2">
                  {msg.research.plan.steps.map((s, i) => <PlanStepRow key={s.id} step={s} last={i === msg.research!.plan!.steps.length - 1} />)}
                </ol>
              </details>
            )}
            {blocks.map((b) => (
              <div key={b.id} className="space-y-1">
                <p className="text-xs font-medium text-mu">{b.label}{b.query ? ` · ${b.query.slice(0, 80)}` : ''}</p>
                <p className="whitespace-pre-wrap border-l-2 border-bor pl-2.5 text-xs leading-relaxed text-mu">{b.lead}</p>
              </div>
            ))}
            {trace.map((t, i) => (
              <p key={`round-${i}`} className="whitespace-pre-wrap border-l-2 border-ac/40 pl-2.5 text-xs leading-relaxed text-mu">{t.slice(0, 2000)}</p>
            ))}
            {reasoning && <p className="whitespace-pre-wrap border-l-2 border-ac/40 pl-2.5 text-xs leading-relaxed text-mu">{reasoning.slice(-4000)}</p>}
            {!trace.length && !reasoning && !blocks.length && !msg.research?.plan && (
              <p className="text-xs text-mu">No reasoning captured for this run yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
