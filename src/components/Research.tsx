import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Copy, Download, FileText, Globe, ListFilter, ListOrdered, Pencil, Play, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { useS, useLive, type Msg } from '../store'
import { PLAN_INTRO, RESEARCH_TIERS, agentRoundsUsed, agentSources, countedSteps, dedupTrace, reasoningBlocks, tierOf, type ResearchAgent, type ResearchPlan, type ResearchPlanStep, type ResearchTierId } from '../research'
import { claimForCitation, collectMessageSources, linkifyCitations, mergeSources, stripCitations } from '../citations'
import { Md } from './Md'
import { ArtifactCard } from './Artifact'
import { extractArtifactBlocks } from '../artifacts'

/** A research card follows its own chat, not whichever chat happens to be
 *  open: while another chat streams, this card's controls stay usable. */
const useMsgBusy = (mid: string) => useS((s) => {
  const c = s.chats.find((x) => x.msgs.some((m) => m.id === mid))
  return !!c && s.busyChats?.[c.id] === true
})
import { SourcesPanel, scrollToSource } from './Sources'
import { Btn, cx } from './ui'

const PLAN_ICONS = { search: Globe, analyze: ListFilter, report: FileText, other: Sparkles } as const
const fmtEstimate = (n: number) => `≈$${n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))

/** A small quiet label for one fact (depth, searches, spend). Keeps rows
 *  scannable without a run-on sentence of numbers. */
function Chip({ children, tone }: { children: string | number; tone?: 'ac' | 'er' }) {
  return <span className={cx('rounded bg-hov px-1.5 py-0.5 text-[10px] tabular-nums text-mu', tone === 'ac' && 'text-ac', tone === 'er' && 'text-er')}>{children}</span>
}

/** One figure with a bar against its ceiling: what the run used, not a wall of
 *  figures. The bar is omitted when there is no meaningful ceiling. */
function Tile({ label, value, of, pct, hint }: { label: string; value: string; of?: string; pct?: number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-bg/60 px-2.5 py-2">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-mu">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
        <span className="truncate text-sm font-semibold">{value}</span>
        {of && <span className="truncate text-[11px] text-mu">/ {of}</span>}
      </div>
      {pct != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hov">
          <div className="h-full rounded-full bg-ac transition-all" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        </div>
      )}
      {hint && <div className={cx('truncate text-[10px] text-mu', pct != null && 'mt-1')}>{hint}</div>}
    </div>
  )
}

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

/** The estimate shown on the plan card before the run starts: three quiet
 *  facts instead of a sentence of figures. The number is a token budget for
 *  the run — lead plus team — priced only when the model has a price. */
function PlanEstimate({ msg }: { msg: Msg }) {
  const configuredRounds = useS((s) => s.researchRounds)
  const rs = msg.research
  const est = rs?.estimate
  if (!est) return null
  const tier = tierOf(rs?.tier ?? 'standard', configuredRounds)
  const agents = Math.max(0, tier.agentRounds) * Math.max(0, tier.agentsPerRound)
  const tokens = `${fmtTokens(est.inputTokens)} in · ${fmtTokens(est.outputTokens)} out tokens`
  return (
    <div className="grid grid-cols-3 gap-2" title={est.costUsd != null ? `Projected from ${tokens}. Measured usage replaces this once the run starts.` : `Projected from ${tokens}. Set a price for this model to see dollars.`}>
      <Tile label="Searches" value={`~${est.searches}`} hint={agents ? `+${agents} field agents` : `${tier.maxSearches} max`} />
      <Tile label="Page reads" value={`~${est.reads}`} hint={`${tier.maxReads} max`} />
      <Tile label={est.costUsd != null ? 'Estimated' : 'Tokens'} value={est.costUsd != null ? fmtEstimate(est.costUsd) : fmtTokens(est.inputTokens + est.outputTokens)} hint={est.costUsd != null ? tokens : 'no price set'} />
    </div>
  )
}

function AgentStatus({ status, failed }: { status: ResearchAgent['status']; failed?: boolean }) {
  if (failed) return <span title="A follow-up failed" aria-label="A follow-up failed" className="inline-flex shrink-0"><X size={12} className="text-er" /></span>
  if (status === 'running') return <span className="size-2 shrink-0 animate-pulse rounded-full bg-ac" />
  if (status === 'done') return <Check size={12} className="shrink-0 text-ac" />
  return <X size={12} className="shrink-0 text-er" />
}

/** One delegated researcher: spending, brief, report, and follow-ups. */
function AgentRow({ agent }: { agent: ResearchAgent }) {
  const failedFollowUps = agent.followUpErrors?.length ?? 0
  return (
    <details>
      <summary className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-hov">
        <AgentStatus status={agent.status} failed={failedFollowUps > 0} />
        <span className="min-w-0 flex-1 truncate">{agent.label}</span>
        <span className="flex shrink-0 items-center gap-1">
          <Chip>{agent.depth ?? 'standard'}</Chip>
          <Chip>{`${agent.searches} searches`}</Chip>
          <Chip>{`${agent.reads} reads`}</Chip>
          {!!agent.followUps?.length && <Chip>{`${agent.followUps.length} follow-ups`}</Chip>}
          {failedFollowUps > 0 && <Chip tone="er">{`${failedFollowUps} failed`}</Chip>}
          {agent.costUsd ? <Chip tone="ac">{fmtEstimate(agent.costUsd)}</Chip> : null}
        </span>
      </summary>
      <div className="space-y-1 px-3 pb-1 pt-1.5">
        <p className="text-xs leading-relaxed text-mu">{agent.brief}</p>
        {agent.error && <p className="text-xs text-er">{agent.error}</p>}
        {agent.followUpErrors?.map((e, i) => (
          <p key={i} className="text-xs text-er">Follow-up failed: {e}</p>
        ))}
        {agent.answer && <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">{agent.answer}</p>}
        {(agent.followUps ?? []).map((f, i) => (
          <div key={i} className="space-y-0.5 border-l-2 border-bor pl-2">
            <p className="text-xs font-medium">{f.q}</p>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-mu">{f.a}</p>
          </div>
        ))}
        {(agent.sources?.length ?? 0) > 0 && <p className="text-[11px] text-mu">{agent.sources!.length} sources kept for the report</p>}
      </div>
    </details>
  )
}

/** The investigator roster grouped into its delegation rounds. */
function ResearchTeam({ agents, rounds }: { agents: ResearchAgent[]; rounds: number }) {
  const waves = useMemo(() => {
    const byRound = new Map<number, ResearchAgent[]>()
    for (const a of agents) {
      const list = byRound.get(a.round)
      if (list) list.push(a)
      else byRound.set(a.round, [a])
    }
    return [...byRound.entries()].sort(([a], [b]) => a - b)
  }, [agents])
  return (
    <div className="space-y-2">
      {waves.map(([round, list]) => {
        const finished = list.filter((a) => a.status === 'done').length
        const failedFollowUps = list.filter((a) => a.followUpErrors?.length).length
        return (
          <div key={round} className="rounded-lg border border-bor/60 bg-bg/40 p-2">
            <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-mu">
              <span>Round {round}{rounds > 1 ? ` of ${rounds}` : ''}</span>
              <span className="normal-case tracking-normal tabular-nums">{finished}/{list.length} done{failedFollowUps ? ` · ${failedFollowUps} follow-up failed` : ''}</span>
            </div>
            <div role="progressbar" aria-label={`Round ${round} progress`} aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={finished} className="mt-1.5 h-1 overflow-hidden rounded-full bg-hov">
              <div className="h-full rounded-full bg-ac transition-all" style={{ width: `${(finished / Math.max(1, list.length)) * 100}%` }} />
            </div>
            <div className="mt-1.5 space-y-0.5">{list.map((a) => <AgentRow key={a.id} agent={a} />)}</div>
          </div>
        )
      })}
    </div>
  )
}

/** Clarifying questions drafted after the plan's context searches. Answering
 * them tailors the run; skipping keeps the model's judgment. */
export function ResearchQuestionsCard({ msg }: { msg: Msg }) {
  const save = useS((s) => s.answerResearchQuestions)
  const skip = useS((s) => s.skipResearchQuestions)
  const stop = useS((s) => s.stopResearch)
  const rs = msg.research
  const questions = rs?.plan?.questions ?? []
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState('')
  useEffect(() => { setAnswers({}); setExtra('') }, [msg.id, rs?.plan])
  if (!rs || rs.status !== 'questions' || !questions.length) return null
  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }))
  const answered = questions.filter((q) => (answers[q.id] ?? '').trim()).length
  const canSubmit = answered > 0 || extra.trim().length > 0
  const submit = () => {
    const list = questions.map((q) => ({ question: q.question, answer: (answers[q.id] ?? '').trim() })).filter((a) => a.answer)
    if (extra.trim()) list.push({ question: 'Additional context for the research', answer: extra.trim() })
    if (list.length) save(msg.id, list)
  }
  return (
    <section aria-label="Research questions" className="max-w-xl space-y-3 rounded-2xl border border-bor bg-surf p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{rs.plan?.title || `Deep research on “${rs.query.slice(0, 90)}”`}</h3>
          <p className="mt-1 text-sm text-mu">A few questions so the research targets what you actually need. Answer any that matter, or skip and I’ll use my judgment.</p>
        </div>
        <span className="shrink-0 rounded-full bg-hov px-2 py-0.5 text-[11px] text-mu">{answered}/{questions.length} answered</span>
      </div>
      <div className="space-y-3">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <label htmlFor={`rq-${msg.id}-${q.id}`} className="block text-sm">{q.question}</label>
            {q.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => set(q.id, o)}
                    aria-pressed={(answers[q.id] ?? '') === o}
                    className={cx('rounded-full border px-2.5 py-1 text-xs transition-colors', (answers[q.id] ?? '') === o ? 'border-ac bg-ac/10 text-tx' : 'border-bor text-mu hover:bg-hov hover:text-tx')}
                  >{o}</button>
                ))}
              </div>
            )}
            <input
              id={`rq-${msg.id}-${q.id}`}
              value={answers[q.id] ?? ''}
              onChange={(e) => set(q.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSubmit) submit() } }}
              maxLength={1500}
              placeholder="Type your answer, or pick one above"
              className="w-full rounded-lg bg-bg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ac/40"
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <label htmlFor={`rqx-${msg.id}`} className="block text-xs font-medium text-mu">Anything else I should know? <span className="font-normal">(optional)</span></label>
          <textarea
            id={`rqx-${msg.id}`}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            maxLength={1500}
            placeholder="Constraints, must-cover sources, audience, or the format you want…"
            className="w-full resize-y rounded-lg bg-bg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ac/40"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => skip(msg.id)} className="rounded-lg px-3 py-1.5 text-sm text-mu hover:bg-hov hover:text-tx">Skip questions</button>
        <button type="button" disabled={!canSubmit} onClick={submit} title={canSubmit ? 'Use these answers to tailor the research' : 'Answer at least one question, or skip'} className="rounded-lg bg-ac px-4 py-2 text-sm font-medium text-acx transition-opacity hover:opacity-90 disabled:opacity-40">Use answers</button>
        <Btn icon={X} title="Cancel research" onClick={() => stop(msg.id)} />
      </div>
    </section>
  )
}

/** The plan card: shows "Generating research plan" while the plan drafts, then
 * the plan itself with Edit plan / Start research / cancel. Nothing runs until
 * the user starts it. */
export function ResearchPlanCard({ msg }: { msg: Msg }) {
  const start = useS((s) => s.startResearch)
  const stop = useS((s) => s.stopResearch)
  const save = useS((s) => s.updateResearchPlan)
  const busy = useMsgBusy(msg.id)
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
  const liveDraft = rs?.planDraft
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
        <h3 className="text-sm font-medium">{plan?.title || (planning ? liveDraft?.title : '') || rs.query.slice(0, 90)}</h3>
        {plan?.intro && <p className="text-xs leading-relaxed text-mu">{plan.intro}</p>}
        {planning ? (
          <div className="space-y-2" aria-live="polite">
            <p role="status" aria-label="Generating research plan" className="flex items-center text-sm text-mu">
              <span className="reply-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="ml-2">{liveDraft?.title ? 'Drafting the research plan…' : rs.scope ? `Getting context · ${rs.scope} ${rs.scope === 1 ? 'search' : 'searches'}…` : 'Generating research plan…'}</span>
            </p>
            {!!liveDraft?.steps.length && (
              <ol className="space-y-1">
                {liveDraft.steps.map((label, i) => <li key={`${label}-${i}`} className="text-xs leading-relaxed text-mu">{i + 1}. {label}</li>)}
              </ol>
            )}
          </div>
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
        {rs.answers?.length ? (
          <div className="space-y-1 rounded-lg bg-bg/60 px-2.5 py-2">
            <p className="text-xs font-medium text-mu">Brief from your answers</p>
            {rs.answers.map((a, i) => (
              <p key={i} className="text-xs leading-relaxed text-mu"><span className="text-tx">{a.question}</span> {a.answer}</p>
            ))}
          </div>
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
  const rounds = useS((s) => s.researchRounds)
  const busy = useMsgBusy(msg.id)
  const rs = msg.research
  if (!rs || rs.status !== 'tier-pick') return null
  return (
    <section aria-label="Choose research depth" className="max-w-xl space-y-3 rounded-xl border border-bor bg-surf p-4">
      <div>
        <h3 className="text-sm font-medium">Deep research on “{rs.query.slice(0, 120)}”</h3>
        <p className="mt-1 text-xs text-mu">Pick a depth. The model then scopes the topic, may ask you a few questions, and drafts a plan for you to review. Nothing is searched or read until you start it. Thorough mode sends out rounds of research subagents and can query them again when an answer is thin.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {RESEARCH_TIERS.map((base) => tierOf(base.id, rounds)).map((t) => (
          <button
            key={t.id}
            disabled={busy}
            onClick={() => choose(msg.id, t.id as ResearchTierId)}
            title={`${t.label}: ${t.agentRounds > 0 ? `${t.agentRounds} subagent rounds of ${t.agentsPerRound} agents, ${t.agentSearches} searches each` : `up to ${t.maxSearches} searches and ${t.maxReads} page reads`}`}
            className={cx('rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-hov disabled:opacity-50', rs.tier === t.id ? 'border-ac bg-ac/10' : 'border-bor')}
            aria-pressed={rs.tier === t.id}
          >
            <span className="block text-sm font-medium">{t.label}</span>
            <span className="mt-0.5 block text-xs text-mu">{t.blurb}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end">
        <button disabled={busy} onClick={() => stop(msg.id)} className="rounded-lg px-3 py-1.5 text-xs text-mu hover:bg-hov hover:text-tx disabled:opacity-50">Cancel</button>
      </div>
    </section>
  )
}

export function ResearchProgressCard({ msg }: { msg: Msg }) {
  const stop = useS((s) => s.stopResearch)
  const resume = useS((s) => s.resumeResearch)
  const steer = useS((s) => s.steerResearch)
  const configuredRounds = useS((s) => s.researchRounds)
  const busy = useMsgBusy(msg.id)
  const [focus, setFocus] = useState('')
  const rs = msg.research
  const live = useLive((l) => l.tools[msg.id]) as { name?: string }[] | undefined
  const toolBusy = !!live?.some((c) => c.name === 'search' || c.name === 'fetch_page' || c.name === 'delegate_research' || c.name === 'ask_research_agent')
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
  const tier = tierOf(rs.tier ?? 'standard', configuredRounds)
  const agents = rs.agents ?? []
  const roundsUsed = agentRoundsUsed(agents)
  const teamSearches = agents.reduce((n, a) => n + a.searches, 0)
  const teamReads = agents.reduce((n, a) => n + a.reads, 0)
  const teamCost = agents.reduce((n, a) => n + (a.costUsd ?? 0), 0)
  const activeFocus = (rs.steer ?? '').trim()
  const usedSearches = countedSteps(rs.steps, 'search')
  const usedReads = countedSteps(rs.steps, 'read')
  const canResume = rs.status === 'stopped' && usedSearches < tier.maxSearches && !!msg.toolRounds?.length
  const measured = rs.usage
  const spend = measured?.cost ?? 0
  const projected = rs.estimate?.costUsd ?? null
  const tokens = measured ? `${fmtTokens(measured.input)} in · ${fmtTokens(measured.output)} out` : ''
  const title = rs.status === 'running' ? `Researching · ${tier.label}` : rs.status === 'stopped' ? 'Research stopped' : 'Research needs attention'
  const subtitle = rs.status !== 'running'
    ? 'The report panel keeps what was gathered'
    : tier.agentRounds > 0
      ? `Round ${Math.min(Math.max(roundsUsed, 1), tier.agentRounds)} of ${tier.agentRounds} · ${rs.steps.length ? `${done} of ${rs.steps.length} steps` : `${agents.length} agent${agents.length === 1 ? '' : 's'} briefed`}`
      : rs.steps.length ? `${done} of ${rs.steps.length} steps done` : 'Gathering evidence'
  const runPct = tier.agentRounds > 0
    ? (roundsUsed / Math.max(1, tier.agentRounds)) * 100
    : rs.steps.length ? (done / rs.steps.length) * 100 : 6
  return (
    <section aria-label="Deep research progress" aria-live="polite" className="max-w-xl overflow-hidden rounded-xl border border-bor bg-surf">
      <div aria-hidden="true" className="h-0.5 bg-hov">
        <div className="h-full bg-ac transition-all" style={{ width: `${Math.max(2, Math.min(100, runPct))}%` }} />
      </div>
      <header className="flex items-start gap-2 border-b border-bor px-3 py-2">
        <ListOrdered size={15} className="mt-0.5 shrink-0 text-ac" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-[11px] text-mu">{subtitle}</p>
        </div>
        {rs.status === 'running' && busy && (
          <button onClick={() => stop(msg.id)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-hov px-2.5 py-1.5 text-xs font-medium hover:opacity-80">
            <Square size={12} fill="currentColor" />Stop
          </button>
        )}
        {canResume && (
          <button disabled={busy} onClick={() => resume(msg.id)} title="Continue with the remaining search budget" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-hov px-2.5 py-1.5 text-xs font-medium hover:opacity-80 disabled:opacity-50">
            <RotateCcw size={12} />Resume
          </button>
        )}
      </header>
      <div className="space-y-3 p-3">
        {/* What the run has used, each against its own ceiling: measured
            tokens after every round, never a wall of figures. */}
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Searches" value={String(usedSearches)} of={String(tier.maxSearches)} pct={(usedSearches / Math.max(1, tier.maxSearches)) * 100} />
          <Tile label="Page reads" value={String(usedReads)} of={String(tier.maxReads)} pct={(usedReads / Math.max(1, tier.maxReads)) * 100} />
          <Tile
            label="Spend"
            value={spend > 0 ? fmtEstimate(spend) : '—'}
            of={projected != null && spend > 0 ? fmtEstimate(projected) : undefined}
            pct={projected != null && spend > 0 ? (spend / projected) * 100 : undefined}
            hint={tokens || `${projected != null ? `${fmtEstimate(projected)} projected` : 'measured per round'}`}
          />
        </div>
      {rs.status === 'running' && (
        <div className="space-y-1.5 rounded-lg border border-bor/60 bg-bg/40 p-2.5">
          {activeFocus && (
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-xs font-medium text-mu">Focus</span>
              <span className="min-w-0 flex-1 text-xs leading-relaxed">{activeFocus}</span>
              <button type="button" onClick={() => steer(msg.id, '')} title="Clear the focus" aria-label="Clear research focus" className="rounded p-0.5 text-mu hover:bg-hov hover:text-tx"><X size={12} /></button>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); const v = focus.trim(); if (v) { steer(msg.id, v); setFocus('') } }} className="flex items-center gap-1.5">
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              maxLength={800}
              aria-label="Research focus"
              placeholder={activeFocus ? 'Update the focus for this run…' : 'Add a focus or constraint for this run…'}
              className="min-w-0 flex-1 rounded-md bg-surf px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ac/40"
            />
            <button type="submit" disabled={!focus.trim()} title="The lead researcher applies this on its next round; the run is not restarted" className="rounded-md bg-hov px-2 py-1.5 text-xs font-medium hover:opacity-80 disabled:opacity-40">Set</button>
          </form>
        </div>
      )}
      {agents.length > 0 && (
        <div className="space-y-2 rounded-lg border border-bor/60 bg-bg/40 p-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-mu">Research team</p>
            <p className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-mu">
              <Chip>{`${roundsUsed}/${tier.agentRounds} rounds`}</Chip>
              <Chip>{`${teamSearches} searches`}</Chip>
              <Chip>{`${teamReads} reads`}</Chip>
              {teamCost > 0 && <Chip tone="ac">{fmtEstimate(teamCost)}</Chip>}
            </p>
          </div>
          <ResearchTeam agents={agents} rounds={tier.agentRounds} />
        </div>
      )}
      {rs.plan && (
        <details className="rounded-lg border border-bor/60 bg-bg/40 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-mu hover:text-tx">Plan · {rs.plan.steps.length} steps</summary>
          <ol className="mt-1.5 space-y-2">
            {rs.plan.steps.map((s, i) => <PlanStepRow key={s.id} step={s} last={i === rs.plan!.steps.length - 1} />)}
          </ol>
        </details>
      )}
      {(rs.steps.length > 0 || note) && (
        <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-mu">Activity</p>
      )}
      <ol className="space-y-2">
        {rs.steps.map((s) => (
          <li key={s.id} className="space-y-1.5">
            {/* What the model wrote right before this set of searches. */}
            {s.lead && <p className="whitespace-pre-wrap border-l-2 border-bor pl-2.5 text-xs leading-relaxed text-mu">{s.lead}</p>}
            <div className="flex items-center gap-2 text-sm">
              {s.state === 'done' ? <Check size={14} className="shrink-0 text-ac" /> : s.state === 'running' ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-ac" /> : s.state === 'error' ? <X size={14} className="shrink-0 text-er" /> : <span className="size-2 shrink-0 rounded-full bg-hov" />}
              <span className="min-w-0 flex-1 truncate">{s.label}{s.query ? <span className="text-mu"> · {s.query.slice(0, 70)}</span> : ''}</span>
              {s.sources != null && <Chip>{`${s.sources} sources`}</Chip>}
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
        <details className="rounded-lg border border-bor/60 bg-bg/40 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-mu hover:text-tx">Model reasoning · {trace.length + (reasoning ? 1 : 0)}</summary>
          <div className="mt-1.5 space-y-1.5">
            {trace.map((t, i) => (
              <p key={i} className="whitespace-pre-wrap border-l-2 border-ac/40 pl-2.5 text-xs leading-relaxed text-mu">{t.slice(0, 1200)}</p>
            ))}
            {reasoning && <p className="whitespace-pre-wrap border-l-2 border-ac/40 pl-2.5 text-xs leading-relaxed text-mu">{reasoning.slice(-2000)}</p>}
          </div>
        </details>
      )}
      {rs.status === 'error' && rs.error && <p className="text-xs text-er">{rs.error}</p>}
      </div>
    </section>
  )
}

/* The run's card: it becomes the report card the moment the model starts
 * writing, and shows the model's own abstract as its sample text. Stopped
 * and failed runs keep the card when a partial report exists, so the work
 * (and its sources) stays reachable instead of stranded. */
export function ResearchTile({ msg, onOpen }: { msg: Msg; onOpen: () => void }) {
  const rerun = useS((s) => s.rerunResearch)
  const rs = msg.research
  const sources = useMemo(() => mergeSources(collectMessageSources(msg.toolRounds), agentSources(msg.research?.agents)), [msg.toolRounds, msg.research?.agents])
  const partial = (msg.toolFinal ?? msg.t ?? '').trim()
  if (!rs || (rs.status !== 'writing' && rs.status !== 'done' && !(partial && (rs.status === 'stopped' || rs.status === 'error')))) return null
  const writing = rs.status === 'writing'
  const agents = rs.agents ?? []
  const roundsUsed = agentRoundsUsed(agents)
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
      {agents.length > 0 && (
        <p className="text-xs text-mu">{roundsUsed} round{roundsUsed === 1 ? '' : 's'} · {agents.length} agent{agents.length === 1 ? '' : 's'} · {agents.reduce((n, a) => n + a.searches, 0)} agent searches</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Btn v="soft" icon={FileText} onClick={onOpen} className="w-auto">Open report</Btn>
        {!writing && rs.plan && (
          <Btn v="soft" icon={RotateCcw} onClick={(e) => { e.stopPropagation(); rerun(msg.id) }} onKeyDown={(e) => e.stopPropagation()} className="w-auto">Re-run plan</Btn>
        )}
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
  const configuredRounds = useS((s) => s.researchRounds)
  const rerun = useS((s) => s.rerunResearch)
  const sources = useMemo(() => mergeSources(collectMessageSources(msg.toolRounds), agentSources(msg.research?.agents)), [msg.toolRounds, msg.research?.agents])
  const report = useMemo(() => extractArtifactBlocks(msg.toolFinal ?? msg.t ?? ''), [msg.toolFinal, msg.t])
  const cited = useMemo(() => citeStyle === 'off' ? stripCitations(report.text) : linkifyCitations(report.text, sources), [report.text, sources, citeStyle])
  const cites = useMemo(() => citeStyle === 'pills' && sources.length ? {
    sources,
    onCite: (citeId: string) => {
      setTab('sources')
      setSrcFlash(citeId.toUpperCase())
      setSrcClaim(claimForCitation(report.text, citeId))
      window.setTimeout(() => scrollToSource(msg.id, citeId), 60)
      window.setTimeout(() => setSrcFlash((v) => (v === citeId.toUpperCase() ? null : v)), 1800)
    },
  } : undefined, [citeStyle, sources, msg.id, report.text])
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
  const agentList = rs?.agents ?? []
  const runTier = tierOf(rs?.tier ?? 'standard', configuredRounds)
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
    const body = `# Deep research: ${rs?.query ?? ''}\n\n_Tier: ${rs?.tier ?? ''} · ${sources.length} sources_\n\n${report.text}\n\n## Sources\n\n${sources.map((s) => `- [${s.citeId}] ${s.title} — ${s.url}`).join('\n')}\n`
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
        {rs?.plan && (rs.status === 'done' || rs.status === 'stopped' || rs.status === 'error') && (
          <Btn sm icon={RotateCcw} title="Re-run this plan against fresh sources" onClick={() => rerun(msg.id)} />
        )}
        <Btn sm icon={Download} title="Download report as Markdown" onClick={download} />
        <Btn sm icon={copied ? Check : Copy} title="Copy report" onClick={() => { void navigator.clipboard?.writeText(report.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {}) }} />
        <Btn sm icon={X} title="Close research panel" onClick={onClose} />
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'report' ? (
          <>
            <article className="leading-7"><Md t={cited} cites={cites} /></article>
            {report.artifacts.length > 0 && (
              <div className="mt-4 space-y-3">
                {report.artifacts.map((spec, i) => <ArtifactCard key={`${spec.title}-${i}`} spec={spec} />)}
              </div>
            )}
          </>
        ) : tab === 'sources' ? (
          <SourcesPanel msgId={msg.id} text={report.text} sources={sources} defaultOpen strict={false} flash={srcFlash} claim={srcClaim} />
        ) : (
          <div className="space-y-3">
            {agentList.length > 0 && (
              <details className="rounded-lg bg-bg/60 px-2.5 py-1.5">
                <summary className="cursor-pointer text-xs font-medium text-mu hover:text-tx">Research team · {agentList.length} agents</summary>
                <div className="mt-1.5">
                  <ResearchTeam agents={agentList} rounds={runTier.agentRounds} />
                </div>
              </details>
            )}
            {msg.research?.plan && (
              <details className="rounded-lg bg-bg/60 px-2.5 py-1.5" open>
                <summary className="cursor-pointer text-xs font-medium text-mu hover:text-tx">Research plan · {msg.research.plan.steps.length} steps</summary>
                {msg.research.plan.intro && <p className="mt-1.5 text-xs leading-relaxed text-mu">{msg.research.plan.intro}</p>}
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
