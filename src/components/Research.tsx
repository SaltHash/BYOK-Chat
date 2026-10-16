import { useMemo, useState } from 'react'
import { BookOpen, Check, Copy, Download, FileText, ListOrdered, Square, X } from 'lucide-react'
import { useS, type Msg } from '../store'
import { RESEARCH_TIERS, type ResearchTierId } from '../research'
import { collectMessageSources, linkifyCitations } from '../citations'
import { Md } from './Md'
import { SourcesPanel } from './Sources'
import { Btn, cx } from './ui'

export function ResearchTierPicker({ msg }: { msg: Msg }) {
  const choose = useS((s) => s.chooseResearchTier)
  const stop = useS((s) => s.stopResearch)
  const busy = useS((s) => s.busy)
  const rs = msg.research
  if (!rs || rs.status !== 'tier-pick') return null
  return (
    <section aria-label="Choose research depth" className="max-w-xl space-y-3 rounded-xl border border-hov bg-surf p-4">
      <div>
        <h3 className="text-sm font-medium">Deep research on “{rs.query.slice(0, 120)}”</h3>
        <p className="mt-1 text-xs text-mu">Pick a depth. Every run starts with parallel searches, then the model follows up and writes a cited report.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {RESEARCH_TIERS.map((t) => (
          <button
            key={t.id}
            disabled={busy}
            onClick={() => choose(msg.id, t.id as ResearchTierId)}
            className={cx('rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-hov disabled:opacity-50', rs.tier === t.id ? 'border-ac bg-ac/10' : 'border-hov')}
            aria-pressed={rs.tier === t.id}
          >
            <span className="block text-sm font-medium">{t.label}</span>
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
  const busy = useS((s) => s.busy)
  const rs = msg.research
  const live = msg.t ? msg.t.length : 0
  if (!rs || (rs.status !== 'running' && rs.status !== 'stopped' && rs.status !== 'error')) return null
  if (rs.status !== 'running' && !rs.steps.length) return null
  const done = rs.steps.filter((s) => s.state === 'done').length
  return (
    <section aria-label="Deep research progress" aria-live="polite" className="max-w-xl space-y-2 rounded-xl border border-hov bg-surf p-4">
      <div className="flex items-center gap-2 text-sm">
        <ListOrdered size={15} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {rs.status === 'running' ? `Researching · ${rs.tier} · ${done}/${rs.steps.length} steps` : rs.status === 'stopped' ? 'Research stopped' : 'Research needs attention'}
        </span>
        {rs.status === 'running' && busy && (
          <button onClick={() => stop(msg.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-hov px-2.5 py-1.5 text-xs font-medium hover:opacity-80">
            <Square size={12} fill="currentColor" />Stop
          </button>
        )}
      </div>
      <ol className="space-y-1.5">
        {rs.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            {s.state === 'done' ? <Check size={14} className="shrink-0 text-ac" /> : s.state === 'running' ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-ac" /> : s.state === 'error' ? <X size={14} className="shrink-0 text-er" /> : <span className="size-2 shrink-0 rounded-full bg-hov" />}
            <span className="min-w-0 flex-1 truncate">{s.label}{s.query ? <span className="text-mu"> · {s.query.slice(0, 70)}</span> : ''}</span>
            {s.sources != null && <span className="shrink-0 text-xs text-mu">{s.sources} sources</span>}
          </li>
        ))}
      </ol>
      {rs.status === 'running' && live > 0 && <p className="text-xs text-mu">Drafting the report…</p>}
      {rs.status === 'error' && rs.error && <p className="text-xs text-er">{rs.error}</p>}
    </section>
  )
}

export function ResearchTile({ msg, onOpen }: { msg: Msg; onOpen: () => void }) {
  const rs = msg.research
  const sources = useMemo(() => collectMessageSources(msg.toolRounds), [msg.toolRounds])
  if (!rs || rs.status !== 'done' || !msg.t) return null
  return (
    <section aria-label="Research report" className="space-y-2 rounded-xl border border-hov bg-surf/50 p-3">
      <div className="flex items-center gap-2 text-sm">
        <BookOpen size={15} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1 truncate font-medium">Research report · {rs.tier}</span>
        <span className="shrink-0 text-xs text-mu">{sources.length} sources</span>
      </div>
      <p className="line-clamp-3 text-sm text-mu">{msg.t.slice(0, 280)}</p>
      <div>
        <Btn v="soft" icon={FileText} onClick={onOpen} className="w-auto">Open report</Btn>
      </div>
    </section>
  )
}

/* Document-styled side panel: Report / Sources tabs, rendered markdown,
 * download + copy, no code chrome. */
export function ResearchPanel({ msg, onClose }: { msg: Msg; onClose: () => void }) {
  const [tab, setTab] = useState<'report' | 'sources'>('report')
  const [copied, setCopied] = useState(false)
  const sources = useMemo(() => collectMessageSources(msg.toolRounds), [msg.toolRounds])
  const cited = useMemo(() => linkifyCitations(msg.toolFinal ?? msg.t, sources), [msg.toolFinal, msg.t, sources])
  const rs = msg.research
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
      <div className="flex items-center gap-2 border-b border-hov px-3 py-2">
        <BookOpen size={15} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Research · {rs?.query.slice(0, 80)}</span>
        <div role="tablist" aria-label="Research view" className="inline-flex items-center gap-1 rounded-lg bg-hov p-0.5">
          {(['report', 'sources'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cx('rounded-md px-2 py-1 text-xs capitalize', tab === v ? 'bg-surf text-tx' : 'text-mu hover:text-tx')}>
              {v}
            </button>
          ))}
        </div>
        <Btn sm icon={Download} title="Download report as Markdown" onClick={download} />
        <Btn sm icon={copied ? Check : Copy} title="Copy report" onClick={() => { void navigator.clipboard?.writeText(msg.toolFinal ?? msg.t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }).catch(() => {}) }} />
        <Btn sm icon={X} title="Close research panel" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'report' ? (
          <article className="leading-7"><Md t={cited} /></article>
        ) : (
          <SourcesPanel msgId={msg.id} text={msg.toolFinal ?? msg.t} sources={sources} defaultOpen strict={false} />
        )}
      </div>
    </div>
  )
}
