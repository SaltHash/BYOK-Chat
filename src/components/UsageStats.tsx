import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDown, ArrowLeft, ArrowUp, CalendarDays, CircleCheck, CircleX, Coins,
  ExternalLink, Info, Layers, MessageSquare, RotateCcw, Search, Table2,
  TrendingUp, TriangleAlert, X,
} from 'lucide-react'
import { useS, featOn, type Stats } from '../store'
import { allAttemptAts, allAttemptLogs } from '../usage'
import { settingDomId } from '../settingsCatalog'
import {
  attemptContexts, buildUsageRecordsFromHistory, chartBuckets, bucketUnitFor, BUCKET_LABEL,
  findModel, formatDate, formatDateTime, formatDay, money, moneyExact, modelKey,
  percentOf, periodLabel, rangeLabel, recordsInRange, sharePct, sortModels, statsRange,
  summarize, seriesTotals, compactTokens, fmtInt, MAX_USAGE_ROWS, USAGE_PERIODS,
  type Bucket, type ModelSortKey, type ModelUsage, type StatsRange, type TokenBreakdown,
  type UsagePeriod, type UsageRecord, type UsageSummary, type BucketUnit,
} from '../usageStats'
import { Btn, Checkbox, Confirm, HelpTip, Sel, Seg, Surface, cx, useEscapeClose } from './ui'

export const STATS_INFO = 'Cost, tokens and per-model usage from every saved reply, including replies from temporary, archived and deleted chats. The lifetime counters at the bottom are separate all-time totals.'

/** A kept attempt from a deleted chat has no live title; say so instead of
 *  showing it as an untitled chat that still exists. */
const chatLabelOf = (r: UsageRecord): string => r.chatTitle || (r.available === false ? 'Deleted chat' : 'Untitled chat')

const VIEWS: [UsageView, string][] = [
  ['overview', 'Overview'],
  ['models', 'Models'],
  ['trends', 'Over time'],
  ['activity', 'Activity'],
]

type UsageView = 'overview' | 'models' | 'trends' | 'activity'
type DetailKind = 'cost' | 'tokens' | 'average' | 'model'
type Detail = { kind: DetailKind; modelKey?: string; modelLabel?: string; from: UsageView; focus: string } | null

type Ui = {
  view: UsageView
  detail: Detail
  /** Endpoint::model of the average-card selector. */
  modelKey: string
  modelLabel: string
  sort: ModelSortKey
  dir: 'asc' | 'desc'
  search: string
  activityModel: string
  activityStatus: 'all' | 'ok' | 'fail'
  activityLimit: number
  metric: 'cost' | 'tokens'
  tokenGroup: 'category' | 'model'
  showTable: boolean
}

/* State lives outside the component so switching Settings tabs — or opening a
 * detail and coming back — does not lose the view, filters or model choice. */
const initialUi: Ui = {
  view: 'overview', detail: null, modelKey: '', modelLabel: '',
  sort: 'tokens', dir: 'desc', search: '',
  activityModel: '', activityStatus: 'all', activityLimit: 50,
  metric: 'cost', tokenGroup: 'category', showTable: false,
}
const store: Ui = { ...initialUi }

const useUi = () => {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const set = useCallback((p: Partial<Ui>) => { Object.assign(store, p); bump() }, [])
  return [store, set] as const
}

/* Same contract as the Settings Anchor, without importing Settings (which
 * imports this module). */
const Anchor = ({ id, children }: { id: string; children: ReactNode }) => (
  <div id={settingDomId(id)} data-anchor={id} className="scroll-mt-6">{children}</div>
)

const jumpSetting = (target: string) => {
  try { window.dispatchEvent(new CustomEvent('byok:setting', { detail: target })) } catch { /* ignore */ }
}

const COST_CATS = [
  { key: 'uncached', label: 'Uncached input', color: 'var(--ac)' },
  { key: 'cacheRead', label: 'Cache read', color: 'var(--c2)' },
  { key: 'cacheWrite', label: 'Cache write', color: 'var(--c3)' },
  { key: 'output', label: 'Output', color: 'var(--c4)' },
] as const

const CHART_COLORS = ['var(--ac)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--er)', 'var(--mu)']

const cacheOf = (t: TokenBreakdown) => t.cacheRead + t.cacheWrite
const promptOf = (t: TokenBreakdown) => t.uncached + t.cacheRead + t.cacheWrite

const approxMoney = (n: number | null, decimals: number, estimated: boolean) =>
  n == null ? '—' : `${estimated ? '≈ ' : ''}${money(n, decimals)}`

/* ---- shared bits ---- */

function TokenMix({ tokens, compact = false }: { tokens: TokenBreakdown; compact?: boolean }) {
  const total = tokens.total
  const parts = COST_CATS.map((c) => ({ ...c, value: tokens[c.key] }))
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-bg" role="img" aria-label={total > 0
        ? `Token mix: ${parts.map((p) => `${p.label} ${percentOf(p.value, total)}`).join(', ')}`
        : 'No token usage'}>
        {total > 0 && parts.map((p) => p.value > 0 && (
          <span key={p.key} title={`${p.label}: ${fmtInt(p.value)} tokens (${percentOf(p.value, total)})`} style={{ width: `${p.value / total * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className={cx('grid gap-x-4 gap-y-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
        {parts.map((p) => (
          <div key={p.key} className="min-w-0 text-xs">
            <div className="flex min-w-0 items-center gap-1.5 text-mu">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: p.color }} />
              <span className="truncate" title={p.label}>{p.label}</span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5 pl-3.5 tabular-nums">
              <span className="font-medium">{total > 0 ? percentOf(p.value, total) : '—'}</span>
              <span className="text-mu">{fmtInt(p.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type SeriesDef = { key: string; label: string; color: string }

/** Dependency-free stacked bar chart. Rects and grid only; labels stay in HTML
 *  so they scale with the text and never distort with the SVG viewBox. */
function StackedBars({ buckets, series, valueOf, format, height = 176, title }: {
  buckets: Bucket[]
  series: SeriesDef[]
  valueOf: (b: Bucket, key: string) => number
  format: (n: number) => string
  height?: number
  title: string
}) {
  const max = Math.max(1, ...buckets.map((b) => series.reduce((n, s) => n + valueOf(b, s.key), 0)))
  const W = 640, plotH = height - 22, pad = 4
  const slot = (W - pad * 2) / Math.max(1, buckets.length)
  const barW = buckets.length === 1 ? Math.min(96, slot * 0.5) : Math.max(2, Math.min(28, slot * 0.68))
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8))
  return (
    <>
      <div role="img" aria-label={title} className="w-full">
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={0} x2={W} y1={pad + plotH * f} y2={pad + plotH * f} stroke="var(--bor)" strokeWidth={1} strokeDasharray={f === 1 ? undefined : '2 4'} vectorEffect="non-scaling-stroke" />
          ))}
          {buckets.map((b, i) => {
            let acc = 0
            const x = pad + i * slot + (slot - barW) / 2
            return (
              <g key={b.start}>
                <title>{`${b.label}: ${series.map((s) => `${s.label} ${format(valueOf(b, s.key))}`).join(', ')}`}</title>
                {series.map((s) => {
                  const v = valueOf(b, s.key)
                  if (v <= 0) return null
                  const h = v / max * plotH
                  const y = pad + plotH - acc - h
                  acc += h
                  return <rect key={s.key} x={x} y={y} width={barW} height={h} fill={s.color} opacity={0.92} />
                })}
              </g>
            )
          })}
        </svg>
        <div className="mt-1 grid gap-0.5 text-[10px] leading-4 text-mu" style={{ gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))` }} aria-hidden="true">
          {buckets.map((b, i) => <span key={b.start} className="truncate text-center">{i % labelEvery === 0 ? b.label : ''}</span>)}
        </div>
      </div>
    </>
  )
}

function ChartLegend({ series, totals, format }: { series: SeriesDef[]; totals: Record<string, number>; format: (n: number) => string }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {series.map((s) => (
        <span key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: s.color }} />
          <span className="truncate" title={s.label}>{s.label}</span>
          <span className="shrink-0 tabular-nums text-mu">{format(totals[s.key] ?? 0)}</span>
        </span>
      ))}
    </div>
  )
}

function ChartTable({ buckets, series, valueOf, format }: { buckets: Bucket[]; series: SeriesDef[]; valueOf: (b: Bucket, key: string) => number; format: (n: number) => string }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-bor">
      <table className="w-full min-w-max text-left text-xs">
        <caption className="sr-only">Chart data table</caption>
        <thead className="sticky top-0 bg-surf">
          <tr>{['Bucket', ...series.map((s) => s.label), 'Total'].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            const total = series.reduce((n, s) => n + valueOf(b, s.key), 0)
            return <tr key={b.start} className="border-t border-bor/60">
              <th scope="row" className="whitespace-nowrap px-2 py-1 font-normal text-mu">{b.label}</th>
              {series.map((s) => <td key={s.key} className="whitespace-nowrap px-2 py-1 tabular-nums">{format(valueOf(b, s.key))}</td>)}
              <td className="whitespace-nowrap px-2 py-1 font-medium tabular-nums">{format(total)}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  )
}

function ChartCard({ title, subtitle, series, buckets, valueOf, format, showTable, onToggleTable, height, empty, unitLabel }: {
  title: string
  subtitle: string
  series: SeriesDef[]
  buckets: Bucket[]
  valueOf: (b: Bucket, key: string) => number
  format: (n: number) => string
  showTable: boolean
  onToggleTable: () => void
  height?: number
  empty?: string
  unitLabel: string
}) {
  const totals: Record<string, number> = {}
  for (const s of series) totals[s.key] = buckets.reduce((n, b) => n + valueOf(b, s.key), 0)
  const grand = series.reduce((n, s) => n + (totals[s.key] ?? 0), 0)
  const summary = `${title}, ${unitLabel} buckets. ${series.map((s) => `${s.label}: ${format(totals[s.key] ?? 0)}`).join('. ')}. Total ${format(grand)}.`
  if (empty) return <Surface className="space-y-2"><h4 className="text-sm font-medium">{title}</h4><p className="text-sm text-mu">{empty}</p></Surface>
  return (
    <Surface className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="text-xs text-mu">{subtitle}</p>
        </div>
        <Btn v="soft" sm icon={Table2} title={showTable ? 'Hide data table' : 'Show data table'} aria-expanded={showTable} onClick={onToggleTable} />
      </div>
      <StackedBars buckets={buckets} series={series} valueOf={valueOf} format={format} height={height} title={summary} />
      <ChartLegend series={series} totals={totals} format={format} />
      {showTable && <ChartTable buckets={buckets} series={series} valueOf={valueOf} format={format} />}
      <span className="sr-only">{unitLabel} buckets</span>
    </Surface>
  )
}

function KpiCard({ icon: I, label, value, sub, onClick, aria, accent, focusKey }: {
  icon: typeof TrendingUp
  label: string
  value: string
  sub: ReactNode
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  aria: string
  accent?: boolean
  focusKey: string
}) {
  return (
    <button type="button" onClick={onClick} aria-label={aria} data-usage-focus={focusKey}
      className={cx('group flex min-h-32 w-full flex-col items-start gap-1 rounded-xl bg-surf p-4 text-left transition-colors hover:bg-hov focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ac', accent && 'ring-1 ring-ac/20')}>
      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-mu"><I size={15} className="text-ac" />{label}</span>
      <span className="min-w-0 text-2xl font-semibold tabular-nums">{value}</span>
      <span className="min-w-0 text-xs text-mu">{sub}</span>
      <span className="mt-auto pt-1 text-[11px] font-medium text-ac opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Open detail →</span>
    </button>
  )
}

/* ---- period and navigation ---- */

function PeriodBar({ period, from, to, range, records, now, setPeriod, setDates }: {
  period: UsagePeriod
  from: string
  to: string
  range: StatsRange
  records: UsageRecord[]
  now: number
  setPeriod: (p: UsagePeriod) => void
  setDates: (from: string, to: string) => void
}) {
  return (
    <div id={settingDomId('usage-period')} data-anchor="usage-period" className="sticky -top-4 z-10 -mx-1 space-y-2 rounded-xl border border-bor bg-bg p-3 pr-12 sm:-top-6 sm:pr-3" role="group" aria-label="Usage period">
      <div className="space-y-2">
        <div>
          <div className="mb-1 text-xs font-medium text-mu">Period</div>
          <div className="hidden sm:block"><Seg v={period} set={setPeriod} opts={USAGE_PERIODS} /></div>
          <div className="sm:hidden"><Sel value={period} set={(v) => setPeriod(v as UsagePeriod)} opts={USAGE_PERIODS.map(([k, l]) => [k, l])} /></div>
        </div>
        {period === 'custom' && (
          <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
            <label className="space-y-1 text-xs text-mu">
              <span>From</span>
              <input type="date" value={from} onChange={(e) => setDates(e.target.value, to)} aria-label="Usage from date" aria-invalid={range.invalid && !!from ? true : undefined}
                className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-tx outline-none focus:ring-2 focus:ring-ac/40" />
            </label>
            <label className="space-y-1 text-xs text-mu">
              <span>Through (inclusive)</span>
              <input type="date" value={to} onChange={(e) => setDates(from, e.target.value)} aria-label="Usage through date, inclusive" aria-invalid={range.invalid && !!to ? true : undefined}
                className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-tx outline-none focus:ring-2 focus:ring-ac/40" />
            </label>
          </div>
        )}
      </div>
      {range.invalid
        ? <p role="alert" className="flex items-start gap-1.5 text-xs text-er"><TriangleAlert size={13} className="mt-0.5 shrink-0" />Choose a valid range. “Through” must be on or after “From”, and both dates must be complete.</p>
        : <p className="text-xs text-mu" title={rangeLabel(range, records, now)}>{rangeLabel(range, records, now)}</p>}
    </div>
  )
}

function SubNav({ view, setView }: { view: UsageView; setView: (v: UsageView) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const pick = (i: number) => {
    const next = VIEWS[(i + VIEWS.length) % VIEWS.length]
    setView(next[0])
    refs.current[(i + VIEWS.length) % VIEWS.length]?.focus()
  }
  return (
    <>
      <div role="tablist" aria-label="Usage views" className="hidden flex-wrap gap-1 rounded-xl bg-surf p-1 md:flex">
        {VIEWS.map(([k, l], i) => (
          <button key={k} ref={(el) => { refs.current[i] = el }} role="tab" aria-selected={view === k} tabIndex={view === k ? 0 : -1} data-usage-focus={`view:${k}`}
            onClick={() => setView(k)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); pick(i + 1) }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); pick(i - 1) }
              else if (e.key === 'Home') { e.preventDefault(); pick(0) }
              else if (e.key === 'End') { e.preventDefault(); pick(VIEWS.length - 1) }
            }}
            className={cx('min-h-10 rounded-lg px-3 text-sm font-medium transition-colors', view === k ? 'bg-bg text-tx shadow-sm' : 'text-mu hover:text-tx')}>
            {l}
          </button>
        ))}
      </div>
      <div className="md:hidden">
        <label className="space-y-1 text-xs text-mu">
          <span>Usage view</span>
          <Sel value={view} set={(v) => setView(v as UsageView)} opts={VIEWS.map(([k, l]) => [k, l])} />
        </label>
      </div>
    </>
  )
}

/* ---- overview ---- */

function Overview({ summary, records, range, now, decimals, modelKey, modelLabel, setView, chooseModel, openDetail, buckets, unit }: {
  summary: UsageSummary
  records: UsageRecord[]
  range: StatsRange
  now: number
  decimals: number
  modelKey: string
  modelLabel: string
  setView: (v: UsageView) => void
  chooseModel: (key: string, label: string) => void
  openDetail: (kind: DetailKind, opts?: { modelKey?: string; modelLabel?: string }, trigger?: HTMLElement | null) => void
  buckets: Bucket[]
  unit: BucketUnit
}) {
  const selected = findModel(summary.models, modelKey)
  const selectedMissing = !!modelKey && !selected
  const avg = selected ? selected.average : summary.average
  const pricedTokens = selected ? selected.pricedTokens : summary.pricedTokens
  const costValue = summary.pricedRequests > 0 ? approxMoney(summary.totalCost, decimals, summary.estimated) : '—'
  const top = summary.mostUsed
  const models = summary.models
  const costSeries = topModelSeries(models, 'cost')
  const tokenSeries: SeriesDef[] = COST_CATS.map((c) => ({ key: c.key, label: c.label, color: c.color }))
  const canCost = summary.pricedRequests > 0
  const activeSeries = canCost ? costSeries.series : tokenSeries
  const activeValue = canCost
    ? (b: Bucket, key: string) => costSeries.valueOf(b, key)
    : (b: Bucket, key: string) => b.byCategory[key as keyof Bucket['byCategory']] ?? 0
  const fmt = canCost ? (n: number) => money(n, decimals) : (n: number) => compactTokens(n)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Coins} label="Total cost" value={costValue} accent focusKey="cost"
          aria={`Total cost ${costValue}. Open cost detail`}
          onClick={(e) => openDetail('cost', {}, e.currentTarget)}
          sub={<>{summary.pricedRequests > 0 ? `${fmtInt(summary.pricedRequests)} priced request${summary.pricedRequests === 1 ? '' : 's'}` : 'Cost unavailable'}
            {summary.unpricedTokens > 0 && <> · {compactTokens(summary.unpricedTokens)} unpriced tokens</>}</>} />
        <KpiCard icon={Layers} label="Total tokens" value={fmtInt(summary.totalTokens)} focusKey="tokens"
          aria={`Total tokens ${fmtInt(summary.totalTokens)}. Open token detail`}
          onClick={(e) => openDetail('tokens', {}, e.currentTarget)}
          sub={<>{fmtInt(summary.tokens.uncached)} input · {fmtInt(summary.tokens.output)} output · {fmtInt(cacheOf(summary.tokens))} cache</>} />
        <div className="flex min-h-32 flex-col gap-1 rounded-xl bg-surf p-4">
          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-mu"><TrendingUp size={15} className="text-ac" />Average cost / 1M</span>
          <button type="button" onClick={(e) => openDetail('average', { modelKey, modelLabel }, e.currentTarget)} data-usage-focus="average"
            aria-label={`Average cost per million tokens ${avg == null ? 'unavailable' : money(avg, decimals)}. Open average cost detail`}
            className="min-w-0 text-left text-2xl font-semibold tabular-nums hover:opacity-80">
            {avg == null ? '—' : money(avg, decimals)}
          </button>
          <span className="min-w-0 text-xs text-mu">
            {selectedMissing ? 'No usage for this model in this period'
              : selected ? (selected.pricedTokens > 0 ? `based on ${fmtInt(selected.pricedTokens)} tokens with recorded cost` : 'no priced usage for this model')
                : (pricedTokens > 0 ? `based on ${fmtInt(pricedTokens)} tokens with recorded cost` : 'no priced usage in this period')}
          </span>
          <div className="mt-auto space-y-1 pt-1">
            <Sel value={modelKey} set={(v) => {
              const row = findModel(models, v)
              chooseModel(v, row?.modelLabel ?? (v ? modelLabel : ''))
            }} opts={[
              ['', 'All models'],
              ...models.map((m): [string, string] => [m.key, `${m.modelLabel} · ${m.endpointName}`]),
              ...(selectedMissing ? [[modelKey, `${modelLabel || modelKey} · no usage in this period`] as [string, string]] : []),
            ]} />
            <div className="flex items-center justify-between text-[11px]">
              <button type="button" onClick={() => chooseModel('', '')} disabled={!modelKey}
                className="rounded text-mu hover:text-tx disabled:opacity-40">Clear model</button>
              <button type="button" onClick={(e) => openDetail('average', { modelKey, modelLabel }, e.currentTarget)} data-usage-focus="average" className="font-medium text-ac hover:underline">Details</button>
            </div>
          </div>
        </div>
        <KpiCard icon={MessageSquare} label="Most-used model" focusKey={top ? `model:${top.key}` : 'view:models'}
          value={top ? top.modelLabel : '—'}
          aria={top ? `Most used model ${top.modelLabel} on ${top.endpointName}, ${fmtInt(top.tokens.total)} tokens. Open model detail` : 'No usage in this period. Open model list'}
          onClick={(e) => top ? openDetail('model', { modelKey: top.key, modelLabel: top.modelLabel }, e.currentTarget) : (e.currentTarget.blur(), setView('models'))}
          sub={top ? <><span className="block truncate" title={top.endpointName}>{top.endpointName}</span>{fmtInt(top.tokens.total)} tokens · {sharePct(top.share)} · {fmtInt(top.requests)} requests</> : 'No billable usage in this period'} />
      </div>
      {(summary.failed > 0 || summary.unpricedTokens > 0) && (
        <p className="text-xs text-mu">
          {summary.failed > 0 && <>{fmtInt(summary.failed)} failed attempt{summary.failed === 1 ? '' : 's'} excluded from metrics.</>}
          {summary.failed > 0 && summary.unpricedTokens > 0 && ' '}
          {summary.unpricedTokens > 0 && <>Cost known for {fmtInt(summary.pricedTokens)} of {fmtInt(summary.totalTokens)} tokens.</>}
        </p>
      )}

      <Surface className="space-y-3">
        <h3 className="text-sm font-medium">Token mix</h3>
        <TokenMix tokens={summary.tokens} />
        <p className="text-xs text-mu">Cached tokens are included once; recorded costs already reflect their discounted price.</p>
      </Surface>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">{canCost ? 'Cost trend' : 'Token trend'}</h3>
            <p className="text-xs text-mu">{BUCKET_LABEL[unit]} buckets · {rangeLabel(range, records, now)}</p>
          </div>
          <Btn v="soft" onClick={() => setView('trends')}>Open over time</Btn>
        </div>
        <div className="rounded-xl bg-surf p-3">
          {summary.totalTokens === 0 && !canCost
            ? <p className="text-sm text-mu">No usage in this period.</p>
            : <StackedBars buckets={buckets} series={activeSeries} valueOf={activeValue} format={fmt} height={120} title={`${canCost ? 'Cost' : 'Token'} trend for the selected period`} />}
          {summary.totalTokens > 0 && !canCost && <p className="mt-1 text-xs text-mu">No provider cost is known for this period, so the trend shows tokens.</p>}
        </div>
      </div>

      <Surface className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Top models</h3>
          <button type="button" onClick={() => setView('models')} className="rounded px-1 text-xs font-medium text-ac hover:underline">View all models</button>
        </div>
        {models.slice(0, 5).length ? models.slice(0, 5).map((m, i) => (
          <button key={m.key} type="button" onClick={(e) => openDetail('model', { modelKey: m.key, modelLabel: m.modelLabel }, e.currentTarget)}
            data-usage-focus={`model:${m.key}`}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hov focus-visible:outline-2 focus-visible:outline-ac">
            <span className="w-4 shrink-0 text-xs text-mu">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={m.modelLabel}>{m.modelLabel}</span>
              <span className="block truncate text-xs text-mu" title={m.endpointName}>{m.endpointName}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-mu">{fmtInt(m.tokens.total)}</span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums">{sharePct(m.share)}</span>
          </button>
        )) : <p className="text-sm text-mu">No model usage in this period.</p>}
      </Surface>
    </div>
  )
}

/* ---- models ---- */

function SortHeader({ label, k, sort, dir, onSort, className }: { label: string; k: ModelSortKey; sort: ModelSortKey; dir: 'asc' | 'desc'; onSort: (k: ModelSortKey) => void; className?: string }) {
  return (
    <th scope="col" aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cx('px-2 py-2 text-left font-medium', className)}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 whitespace-nowrap rounded text-xs hover:text-tx">
        {label}{sort === k ? (dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null}
      </button>
    </th>
  )
}

function ModelsView({ summary, decimals, ui, setUi, openDetail }: {
  summary: UsageSummary
  decimals: number
  ui: Ui
  setUi: (p: Partial<Ui>) => void
  openDetail: (kind: DetailKind, opts?: { modelKey?: string; modelLabel?: string }, trigger?: HTMLElement | null) => void
}) {
  const needle = ui.search.trim().toLowerCase()
  const rows = sortModels(summary.models, ui.sort, ui.dir).filter((m) =>
    !needle || m.label.toLowerCase().includes(needle) || m.modelId.toLowerCase().includes(needle) || m.endpointName.toLowerCase().includes(needle))
  const sort = (k: ModelSortKey) => setUi({ sort: k, dir: ui.sort === k ? (ui.dir === 'desc' ? 'asc' : 'desc') : 'desc' })
  const open = (m: ModelUsage, el: HTMLElement) => openDetail('model', { modelKey: m.key, modelLabel: m.modelLabel }, el)
  const rowKey = (m: ModelUsage) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(m, e.currentTarget as HTMLElement) }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
          <input value={ui.search} onChange={(e) => setUi({ search: e.target.value })} placeholder="Search models, ids or endpoints"
            aria-label="Search models" className="w-full rounded-lg bg-surf py-2 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
          {ui.search && <button type="button" onClick={() => setUi({ search: '' })} aria-label="Clear model search" className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-mu hover:text-tx"><X size={13} /></button>}
        </label>
        <span className="text-xs text-mu">{rows.length} model{rows.length === 1 ? '' : 's'}</span>
      </div>
      {!rows.length ? <Surface><p className="text-sm text-mu">{summary.models.length ? 'No models match that search.' : 'No model usage in this period.'}</p></Surface> : (
        <>
          <div className="hidden overflow-x-auto rounded-xl bg-surf md:block">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Model usage for the selected period</caption>
              <thead className="border-b border-bor text-mu">
                <tr>
                  <th scope="col" className="w-10 px-2 py-2 text-left text-xs font-medium">#</th>
                  <SortHeader label="Model / endpoint" k="model" sort={ui.sort} dir={ui.dir} onSort={sort} />
                  <SortHeader label="Tokens" k="tokens" sort={ui.sort} dir={ui.dir} onSort={sort} />
                  <SortHeader label="Share" k="share" sort={ui.sort} dir={ui.dir} onSort={sort} />
                  <SortHeader label="Requests" k="requests" sort={ui.sort} dir={ui.dir} onSort={sort} />
                  <SortHeader label="Cost" k="cost" sort={ui.sort} dir={ui.dir} onSort={sort} />
                  <SortHeader label="Avg / 1M" k="average" sort={ui.sort} dir={ui.dir} onSort={sort} />
                  <SortHeader label="Last used" k="lastUsed" sort={ui.sort} dir={ui.dir} onSort={sort} />
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr key={m.key} tabIndex={0} onClick={(e) => open(m, e.currentTarget)} onKeyDown={rowKey(m)} data-usage-focus={`model:${m.key}`}
                    className="cursor-pointer border-b border-bor/50 align-top last:border-0 hover:bg-hov focus-visible:outline-2 focus-visible:outline-ac">
                    <td className="px-2 py-2 text-xs text-mu">{i + 1}</td>
                    <td className="max-w-64 px-2 py-2">
                      <div className="truncate font-medium" title={m.modelLabel}>{m.modelLabel}</div>
                      <div className="truncate text-xs text-mu" title={m.endpointName}>{m.endpointName}</div>
                      <div className="truncate text-[11px] text-mu" title={`${m.modelId}`}>{m.modelId}</div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{fmtInt(m.tokens.total)}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-bg"><span className="block h-full rounded-full bg-ac" style={{ width: `${(m.share ?? 0) * 100}%` }} /></span>
                        <span className="text-xs tabular-nums">{sharePct(m.share)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{fmtInt(m.requests)}{m.failed > 0 && <span className="text-xs text-er"> · {m.failed} failed</span>}</td>
                    <td className="px-2 py-2 tabular-nums" title={moneyExact(m.cost)}>{m.pricedRequests > 0 ? approxMoney(m.cost, decimals, m.estimated) : '—'}</td>
                    <td className="px-2 py-2 tabular-nums" title={moneyExact(m.average)}>{m.average == null ? '—' : money(m.average, decimals)}</td>
                    <td className="px-2 py-2 text-xs text-mu" title={formatDateTime(m.lastUsed)}>{formatDay(m.lastUsed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {rows.map((m, i) => (
              <button key={m.key} type="button" onClick={(e) => open(m, e.currentTarget)} data-usage-focus={`model:${m.key}`}
                className="w-full space-y-2 rounded-xl bg-surf p-3 text-left hover:bg-hov focus-visible:outline-2 focus-visible:outline-ac">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-xs text-mu">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={m.modelLabel}>{m.modelLabel}</span>
                    <span className="block truncate text-xs text-mu" title={m.endpointName}>{m.endpointName}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">{fmtInt(m.tokens.total)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-mu">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg"><span className="block h-full rounded-full bg-ac" style={{ width: `${(m.share ?? 0) * 100}%` }} /></span>
                  {sharePct(m.share)} · {fmtInt(m.requests)} req · {m.pricedRequests > 0 ? approxMoney(m.cost, decimals, m.estimated) : 'cost unavailable'}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-mu">Avg/1M {m.average == null ? '—' : money(m.average, decimals)} · {formatDay(m.lastUsed)}</span>
                  <span className="font-medium text-ac">View details →</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ---- over time ---- */

function topModelSeries(models: ModelUsage[], metric: 'cost' | 'tokens') {
  const sorted = [...models].filter((m) => metric === 'cost' ? m.pricedRequests > 0 : m.tokens.total > 0)
    .sort((a, b) => metric === 'cost' ? b.cost - a.cost : b.tokens.total - a.tokens.total)
  const top = sorted.slice(0, 6)
  const keys = new Set(top.map((m) => m.key))
  const series: SeriesDef[] = top.map((m, i) => ({ key: m.key, label: m.modelLabel, color: CHART_COLORS[i % CHART_COLORS.length] }))
  if (sorted.length > top.length) series.push({ key: '__other', label: 'Other models', color: 'var(--mu)' })
  return {
    series,
    valueOf: (b: Bucket, key: string) => {
      if (key === '__other') return Object.entries(b.byModel).filter(([k]) => !keys.has(k)).reduce((n, [, v]) => n + (metric === 'cost' ? v.cost : v.tokens), 0)
      const v = b.byModel[key]
      return v ? (metric === 'cost' ? v.cost : v.tokens) : 0
    },
  }
}

function TrendsView({ summary, records, range, now, decimals, ui, setUi }: {
  summary: UsageSummary
  records: UsageRecord[]
  range: StatsRange
  now: number
  decimals: number
  ui: Ui
  setUi: (p: Partial<Ui>) => void
}) {
  const unit = bucketUnitFor(range, now)
  const buckets = useMemo(() => chartBuckets(records, range, unit, now), [records, range, unit, now])
  const metric = ui.metric
  const canCost = summary.pricedRequests > 0
  const modelSeries = topModelSeries(summary.models, metric === 'cost' ? 'cost' : 'tokens')
  const categorySeries: SeriesDef[] = COST_CATS.map((c) => ({ key: c.key, label: c.label, color: c.color }))
  const series = metric === 'cost' ? modelSeries.series : ui.tokenGroup === 'model' ? modelSeries.series : categorySeries
  const valueOf = metric === 'cost'
    ? modelSeries.valueOf
    : ui.tokenGroup === 'model'
      ? modelSeries.valueOf
      : (b: Bucket, key: string) => b.byCategory[key as keyof Bucket['byCategory']] ?? 0
  const fmt = metric === 'cost' ? (n: number) => money(n, decimals) : (n: number) => fmtInt(n)
  const totals = seriesTotals(buckets)
  const totalLabel = metric === 'cost' ? (summary.pricedRequests > 0 ? money(totals.cost, decimals) : '—') : `${fmtInt(totals.tokens)} tokens`
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Seg v={metric} set={(v) => setUi({ metric: v })} opts={[['cost', 'Cost'], ['tokens', 'Tokens']]} />
        {metric === 'tokens' && <Seg v={ui.tokenGroup} set={(v) => setUi({ tokenGroup: v })} opts={[['category', 'By category'], ['model', 'By model']]} />}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">{metric === 'cost' ? 'Cost' : 'Tokens'} over time</h3>
        <p className="text-xs text-mu">{BUCKET_LABEL[unit]} buckets · {rangeLabel(range, records, now)}</p>
        <p className="text-xs text-mu">· {totalLabel}</p>
      </div>
      {metric === 'cost' && !canCost
        ? <Surface><p className="text-sm text-mu">No provider cost is known for this period, so there is no cost chart. Recorded costs and endpoint price tables both contribute when available.</p></Surface>
        : <ChartCard title={`${metric === 'cost' ? 'Cost' : 'Token'} breakdown`} subtitle={`${BUCKET_LABEL[unit]} buckets · ${series.length} series`}
          series={series} buckets={buckets} valueOf={valueOf} format={fmt}
          showTable={ui.showTable} onToggleTable={() => setUi({ showTable: !ui.showTable })} unitLabel={BUCKET_LABEL[unit]} />}
      {metric === 'tokens' && ui.tokenGroup === 'model' && !summary.models.length && <p className="text-xs text-mu">No model usage in this period.</p>}
    </div>
  )
}

/* ---- activity ---- */

function ActivityView({ records, summary, decimals, ui, setUi, onOpenChat }: {
  records: UsageRecord[]
  summary: UsageSummary
  decimals: number
  ui: Ui
  setUi: (p: Partial<Ui>) => void
  onOpenChat: (chatId: string, messageId: string) => void
}) {
  const modelOptions: [string, string][] = [['', 'All models']]
  const seen = new Map<string, string>()
  for (const r of records) {
    const k = modelKey(r.endpointId, r.modelId)
    if (!seen.has(k)) seen.set(k, `${r.modelLabel} · ${r.endpointName}`)
  }
  for (const [k, v] of seen) modelOptions.push([k, v])
  if (ui.activityModel && !seen.has(ui.activityModel)) modelOptions.push([ui.activityModel, 'Selected model · no usage in this period'])
  const filtered = records
    .filter((r) => !ui.activityModel || modelKey(r.endpointId, r.modelId) === ui.activityModel)
    .filter((r) => ui.activityStatus === 'all' || (ui.activityStatus === 'ok' ? !r.failed : r.failed))
    .sort((a, b) => b.at - a.at)
  const shown = filtered.slice(0, ui.activityLimit)
  const groups = new Map<string, UsageRecord[]>()
  for (const r of shown) {
    const k = formatDate(r.at)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-44 flex-1 space-y-1 text-xs text-mu"><span>Model</span><Sel value={ui.activityModel} set={(v) => setUi({ activityModel: v })} opts={modelOptions} /></label>
        <div className="space-y-1 text-xs text-mu"><span>Status</span><Seg v={ui.activityStatus} set={(v) => setUi({ activityStatus: v })} opts={[['all', 'All'], ['ok', 'Succeeded'], ['fail', 'Failed']]} /></div>
      </div>
      <p className="text-xs text-mu">Most recent {Math.min(ui.activityLimit, filtered.length)} of {filtered.length} attempts. Failed attempts are listed for diagnosis but excluded from every metric above.</p>
      {summary.failed > 0 && <p className="text-xs text-mu">{fmtInt(summary.failed)} failed attempt{summary.failed === 1 ? '' : 's'} excluded from totals.</p>}
      {!shown.length ? <Surface><p className="text-sm text-mu">No attempts match these filters.</p></Surface> : [...groups].map(([day, items]) => (
        <section key={day} className="space-y-1.5" aria-label={day}>
          <h4 className="sticky top-24 z-10 bg-bg/95 py-1 text-xs font-semibold uppercase tracking-wide text-mu backdrop-blur">{day}</h4>
          {items.map((r, idx) => {
            const canJump = !r.failed && !!r.chatId && !!r.messageId && r.available !== false
            const content = (
              <>
                <span className={cx('mt-1 size-1.5 shrink-0 rounded-full', r.failed ? 'bg-er' : 'bg-ac')} aria-hidden="true" />
                <span className="w-16 shrink-0 whitespace-nowrap text-xs tabular-nums text-mu">{new Date(r.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={cx('shrink-0 text-[11px] font-medium', r.failed ? 'text-er' : 'text-ac')}>{r.failed ? 'Failed' : 'OK'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" title={r.modelLabel}>{r.modelLabel}</span>
                  <span className="block truncate text-xs text-mu" title={r.endpointName}>{r.endpointName} · {chatLabelOf(r)}</span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-mu">
                  <span className="block">{fmtInt(r.tokens.total)} tok · {r.tokens.uncached} in / {r.tokens.output} out</span>
                  <span className="block">{cacheOf(r.tokens) > 0 ? `${fmtInt(cacheOf(r.tokens))} cache · ` : ''}{r.cost == null ? 'cost —' : `${r.estimated ? '≈ ' : ''}${money(r.cost, decimals)}`}</span>
                </span>
              </>
            )
            return canJump ? (
              <button key={`${r.messageId}-${idx}-${r.at}`} type="button" onClick={() => onOpenChat(r.chatId, r.messageId)}
                title={`Open in chat: ${chatLabelOf(r)}`}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-surf focus-visible:outline-2 focus-visible:outline-ac">{content}</button>
            ) : (
              <div key={`${r.messageId}-${idx}-${r.at}`} className="flex items-start gap-2 rounded-lg px-2 py-2">{content}</div>
            )
          })}
        </section>
      ))}
      {filtered.length > ui.activityLimit && <Btn v="soft" onClick={() => setUi({ activityLimit: ui.activityLimit + 50 })}>Show more ({filtered.length - ui.activityLimit} remaining)</Btn>}
    </div>
  )
}

/* ---- detail shell ---- */

function DetailShell({ kind, title, subtitle, view, onBack, headingRef, children }: {
  kind: string
  title: string
  subtitle?: string
  view: UsageView
  onBack: () => void
  headingRef: React.RefObject<HTMLHeadingElement>
  children: ReactNode
}) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} title={`Back to ${VIEWS.find(([k]) => k === view)?.[1] ?? 'Overview'} (Esc)`}
        className="inline-flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg text-sm text-mu hover:text-tx">
        <ArrowLeft size={16} /><span>Usage</span><span aria-hidden="true">/</span><span>{VIEWS.find(([k]) => k === view)?.[1] ?? 'Overview'}</span><span aria-hidden="true">/</span><span className="font-medium text-tx">{title}</span>
      </button>
      <div className="space-y-1">
        <h3 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">{title}</h3>
        {subtitle && <p className="text-sm text-mu">{subtitle}</p>}
        <span className="sr-only">{kind} detail</span>
      </div>
      {children}
    </div>
  )
}

function KeyValue({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return <div className="min-w-0 rounded-xl bg-surf p-3"><div className="text-xs text-mu">{label}</div><div className="mt-1 truncate text-lg font-semibold tabular-nums" title={title}>{value}</div></div>
}

/* ---- details ---- */

function CostDetail({ summary, records, range, now, decimals, from, onBack, headingRef, showTable, toggleTable, unit }: {
  summary: UsageSummary; records: UsageRecord[]; range: StatsRange; now: number; decimals: number; from: UsageView
  onBack: () => void; headingRef: React.RefObject<HTMLHeadingElement>; showTable: boolean; toggleTable: () => void; unit: BucketUnit
}) {
  const buckets = useMemo(() => chartBuckets(records, range, unit, now), [records, range, unit, now])
  const series = topModelSeries(summary.models, 'cost')
  const fmt = (n: number) => money(n, decimals)
  return (
    <DetailShell kind="Cost" title="Cost detail" subtitle={`Recorded and estimated spend · ${rangeLabel(range, records, now)}`} view={from} onBack={onBack} headingRef={headingRef}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyValue label="Total cost" value={summary.pricedRequests ? approxMoney(summary.totalCost, decimals, summary.estimated) : '—'} title={moneyExact(summary.totalCost)} />
        <KeyValue label="Provider recorded" value={summary.pricedRequests ? money(summary.recordedCost, decimals) : '—'} title={moneyExact(summary.recordedCost)} />
        <KeyValue label="Price-table estimate" value={summary.pricedRequests ? money(summary.estimatedCost, decimals) : '—'} title={moneyExact(summary.estimatedCost)} />
        <KeyValue label="Unpriced tokens" value={summary.totalTokens ? fmtInt(summary.unpricedTokens) : '—'} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyValue label="Average / 1M" value={summary.average == null ? '—' : money(summary.average, decimals)} />
        <KeyValue label="Priced requests" value={fmtInt(summary.pricedRequests)} />
        <KeyValue label="Unpriced requests" value={fmtInt(summary.unpricedRequests)} />
        <KeyValue label="Tokens with recorded cost" value={fmtInt(summary.pricedTokens)} />
      </div>
      <p className="text-xs text-mu">{summary.unpricedTokens > 0 ? `Cost is known for ${fmtInt(summary.pricedTokens)} of ${fmtInt(summary.totalTokens)} tokens; ${fmtInt(summary.unpricedTokens)} have no price and are excluded from the average.` : 'Every token in this period has a known cost.'}</p>
      {summary.pricedRequests > 0
        ? <ChartCard title="Cost over time" subtitle={`${BUCKET_LABEL[unit]} buckets · by model`} series={series.series} buckets={buckets} valueOf={series.valueOf} format={fmt} showTable={showTable} onToggleTable={toggleTable} unitLabel={BUCKET_LABEL[unit]} />
        : <Surface><p className="text-sm text-mu">No known cost in this period. Add prices in Settings → Endpoints, or use a provider that reports spend.</p></Surface>}
      <Surface className="space-y-2">
        <h4 className="text-sm font-medium">Cost by model</h4>
        {summary.models.filter((m) => m.pricedRequests > 0).length ? summary.models.filter((m) => m.pricedRequests > 0).map((m) => (
          <div key={m.key} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate" title={`${m.modelLabel} · ${m.endpointName}`}>{m.modelLabel} <span className="text-xs text-mu">· {m.endpointName}</span></span>
            <span className="shrink-0 text-xs tabular-nums text-mu">{fmtInt(m.pricedTokens)} tok</span>
            <span className="w-20 shrink-0 text-right tabular-nums">{approxMoney(m.cost, decimals, m.estimated)}</span>
          </div>
        )) : <p className="text-sm text-mu">No model has a known cost in this period.</p>}
      </Surface>
      <div className="flex flex-wrap gap-2">
        <Btn v="soft" icon={ExternalLink} onClick={() => jumpSetting('eps#model-pricing')}>Open model pricing</Btn>
      </div>
    </DetailShell>
  )
}

function TokenDetail({ summary, records, range, now, decimals, from, onBack, headingRef, showTable, toggleTable, unit }: {
  summary: UsageSummary; records: UsageRecord[]; range: StatsRange; now: number; decimals: number; from: UsageView
  onBack: () => void; headingRef: React.RefObject<HTMLHeadingElement>; showTable: boolean; toggleTable: () => void; unit: BucketUnit
}) {
  const buckets = useMemo(() => chartBuckets(records, range, unit, now), [records, range, unit, now])
  const prompt = promptOf(summary.tokens)
  const cacheShare = prompt > 0 ? `${((cacheOf(summary.tokens) / prompt) * 100).toFixed(1)}%` : '—'
  const cats = COST_CATS.map((c) => ({ ...c, value: summary.tokens[c.key] }))
  return (
    <DetailShell kind="Token" title="Token detail" subtitle={rangeLabel(range, records, now)} view={from} onBack={onBack} headingRef={headingRef}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyValue label="Total tokens" value={fmtInt(summary.totalTokens)} />
        {cats.map((c) => <KeyValue key={c.key} label={c.label} value={fmtInt(c.value)} />)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Surface className="space-y-2"><h4 className="text-sm font-medium">Cache share of prompt tokens</h4><p className="text-2xl font-semibold tabular-nums">{cacheShare}</p><p className="text-xs text-mu">{fmtInt(cacheOf(summary.tokens))} of {fmtInt(prompt)} prompt tokens were read from or written to a cache.</p></Surface>
        <Surface className="space-y-2"><h4 className="text-sm font-medium">How the total is counted</h4><p className="text-xs leading-5 text-mu">Uncached input, cache read, cache write and output. Cached tokens are included once — cached input is not also counted as uncached input.</p></Surface>
      </div>
      <Surface className="space-y-3"><h4 className="text-sm font-medium">Token mix</h4><TokenMix tokens={summary.tokens} /><p className="text-xs text-mu">Recorded cost already reflects cached-token discounts.</p></Surface>
      <ChartCard title="Tokens over time" subtitle={`${BUCKET_LABEL[unit]} buckets · by category`} series={COST_CATS.map((c) => ({ key: c.key, label: c.label, color: c.color }))} buckets={buckets}
        valueOf={(b, key) => b.byCategory[key as keyof Bucket['byCategory']] ?? 0} format={(n) => fmtInt(n)} showTable={showTable} onToggleTable={toggleTable} unitLabel={BUCKET_LABEL[unit]} />
      <Surface className="space-y-2">
        <h4 className="text-sm font-medium">Tokens by model</h4>
        {summary.models.map((m) => (
          <div key={m.key} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate" title={`${m.modelLabel} · ${m.endpointName}`}>{m.modelLabel} <span className="text-xs text-mu">· {m.endpointName}</span></span>
            <span className="shrink-0 text-xs text-mu">{fmtInt(m.tokens.uncached)} in · {fmtInt(m.tokens.output)} out · {fmtInt(cacheOf(m.tokens))} cache</span>
            <span className="w-20 shrink-0 text-right font-medium tabular-nums">{fmtInt(m.tokens.total)}</span>
          </div>
        ))}
        {!summary.models.length && <p className="text-sm text-mu">No model usage in this period.</p>}
      </Surface>
      <p className="text-xs text-mu">Cost uses the provider&rsquo;s recorded charge when present; otherwise the endpoint price table applies. Cached tokens are not double-counted.</p>
      <p className="text-xs text-mu">Average cost in this period: {summary.average == null ? '—' : money(summary.average, decimals)} per million priced tokens.</p>
    </DetailShell>
  )
}

function AverageDetail({ summary, decimals, modelKey, modelLabel, from, onBack, headingRef, openModel }: {
  summary: UsageSummary; decimals: number; modelKey: string; modelLabel: string; from: UsageView
  onBack: () => void; headingRef: React.RefObject<HTMLHeadingElement>; openModel: (m: ModelUsage, el: HTMLElement) => void
}) {
  const selected = findModel(summary.models, modelKey)
  const priced = summary.pricedRequests > 0
  return (
    <DetailShell kind="Average cost" title="Average cost detail" subtitle="Cost per million priced tokens" view={from} onBack={onBack} headingRef={headingRef}>
      <Surface className="space-y-2">
        <h4 className="text-sm font-medium">Formula</h4>
        <p className="font-mono text-sm">total known cost ÷ priced tokens × 1,000,000</p>
        <p className="text-xs text-mu">Only tokens whose attempts have a known cost are in the denominator. Unpriced usage is reported separately instead of diluting the average.</p>
      </Surface>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KeyValue label="Total known cost" value={priced ? money(summary.totalCost, decimals) : '—'} title={moneyExact(summary.totalCost)} />
        <KeyValue label="Priced tokens" value={priced ? fmtInt(summary.pricedTokens) : '—'} />
        <KeyValue label="Global average / 1M" value={summary.average == null ? '—' : money(summary.average, decimals)} />
      </div>
      {summary.pricedTokens === 0 && <Surface><p className="text-sm text-mu">No priced tokens in this period, so average cost is unavailable. Recorded provider costs or an endpoint price for the model will make it available.</p></Surface>}
      {modelKey && (
        <Surface className="space-y-2">
          <h4 className="text-sm font-medium">Selected model</h4>
          <p className="text-sm">{modelLabel || selected?.modelLabel || modelKey}</p>
          {selected ? (
            <p className="text-xs text-mu">{selected.pricedTokens > 0 ? `${money(selected.cost, decimals)} ÷ ${fmtInt(selected.pricedTokens)} tokens × 1,000,000 = ${money(selected.average, decimals)}` : 'No priced tokens for this model in the selected period.'}</p>
          ) : <p className="text-xs text-mu">No usage for this model in this period.</p>}
        </Surface>
      )}
      <Surface className="space-y-2">
        <h4 className="text-sm font-medium">Model comparison</h4>
        {summary.models.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs text-mu"><tr>{['Model', 'Tokens', 'Priced tokens', 'Cost', 'Avg / 1M'].map((h) => <th key={h} scope="col" className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {summary.models.map((m) => (
                  <tr key={m.key} className="border-t border-bor/60">
                    <th scope="row" className="max-w-48 px-2 py-1.5 text-left font-normal"><button type="button" onClick={(e) => openModel(m, e.currentTarget)} data-usage-focus={`model:${m.key}`} className="min-w-0 truncate text-left hover:text-ac" title={`${m.modelLabel} · ${m.endpointName}`}>{m.modelLabel}</button><span className="block truncate text-[11px] text-mu">{m.endpointName}</span></th>
                    <td className="px-2 py-1.5 tabular-nums">{fmtInt(m.tokens.total)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{fmtInt(m.pricedTokens)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{m.pricedRequests ? approxMoney(m.cost, decimals, m.estimated) : '—'}</td>
                    <td className="px-2 py-1.5 tabular-nums">{m.average == null ? '—' : money(m.average, decimals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-mu">No priced usage in this period.</p>}
      </Surface>
    </DetailShell>
  )
}

function ModelDetail({ summary, records, range, now, decimals, eps, detail, from, onBack, headingRef, onOpenChat, showTable, toggleTable, unit }: {
  summary: UsageSummary; records: UsageRecord[]; range: StatsRange; now: number; decimals: number; eps: { id: string; name: string; on: boolean }[]
  detail: Detail; from: UsageView; onBack: () => void; headingRef: React.RefObject<HTMLHeadingElement>; onOpenChat: (chatId: string, messageId: string) => void
  showTable: boolean; toggleTable: () => void; unit: BucketUnit
}) {
  const key = detail?.modelKey ?? ''
  const row = findModel(summary.models, key)
  const label = row?.modelLabel ?? detail?.modelLabel ?? key
  const endpoint = row ? eps.find((e) => e.id === row.endpointId) : undefined
  const removed = !!row && (!row.endpointId || !endpoint)
  const buckets = useMemo(() => chartBuckets(records, range, unit, now), [records, range, unit, now])
  const tokenSeries: SeriesDef[] = [{ key, label, color: 'var(--ac)' }]
  const tokenValue = (b: Bucket, k: string) => b.byModel[k]?.tokens ?? 0
  const costValue = (b: Bucket, k: string) => b.byModel[k]?.cost ?? 0
  const own = records.filter((r) => modelKey(r.endpointId, r.modelId) === key).sort((a, b) => b.at - a.at)
  const recent = own.slice(0, 20)
  const rank = row ? summary.models.findIndex((m) => m.key === key) + 1 : 0
  const fmt = (n: number) => money(n, decimals)
  return (
    <DetailShell kind="Model" title={label} subtitle={row ? `${row.endpointName}${removed ? ' · Endpoint removed' : ''}` : 'No usage for this model in this period'} view={from} onBack={onBack} headingRef={headingRef}>
      {row ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-hov px-2 py-1 font-mono">{row.modelId || 'unknown model'}</span>
            <span className={cx('rounded-md px-2 py-1', removed ? 'bg-er/10 text-er' : endpoint?.on ? 'bg-ac/10 text-ac' : 'bg-hov text-mu')}>{removed ? 'Endpoint removed' : endpoint?.on ? 'Endpoint enabled' : 'Endpoint disabled'}</span>
            <span className="text-mu">{rangeLabel(range, records, now)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KeyValue label="Tokens" value={fmtInt(row.tokens.total)} />
            <KeyValue label="Requests" value={fmtInt(row.requests)} />
            <KeyValue label="Cost" value={row.pricedRequests ? approxMoney(row.cost, decimals, row.estimated) : '—'} title={moneyExact(row.cost)} />
            <KeyValue label="Avg / 1M" value={row.average == null ? '—' : money(row.average, decimals)} />
            <KeyValue label="Share of period" value={sharePct(row.share)} />
            <KeyValue label="Rank" value={rank > 0 ? `#${rank}` : '—'} />
            <KeyValue label="Last used" value={formatDay(row.lastUsed)} title={formatDateTime(row.lastUsed)} />
            <KeyValue label="Failed attempts" value={fmtInt(row.failed)} />
          </div>
          <Surface className="space-y-2">
            <h4 className="text-sm font-medium">Token breakdown</h4>
            <TokenMix tokens={row.tokens} compact />
            <p className="text-xs text-mu">{row.pricedRequests > 0 ? `${fmtInt(row.pricedTokens)} priced tokens${row.unpricedTokens > 0 ? ` · ${fmtInt(row.unpricedTokens)} unpriced` : ''}` : 'No priced usage for this model in this period.'}{removed && ' Price-table data is unavailable because the endpoint was removed; provider-reported costs are still shown.'}</p>
          </Surface>
          <ChartCard title="Tokens over time" subtitle={`${BUCKET_LABEL[unit]} buckets · this model`} series={tokenSeries} buckets={buckets} valueOf={tokenValue} format={(n) => fmtInt(n)} showTable={showTable} onToggleTable={toggleTable} height={130} unitLabel={BUCKET_LABEL[unit]} />
          {row.pricedRequests > 0
            ? <ChartCard title="Cost over time" subtitle={`${BUCKET_LABEL[unit]} buckets · this model`} series={[{ key, label, color: 'var(--c2)' }]} buckets={buckets} valueOf={costValue} format={fmt} showTable={showTable} onToggleTable={toggleTable} height={130} unitLabel={BUCKET_LABEL[unit]} />
            : <Surface><p className="text-sm text-mu">No known cost for this model in this period.</p></Surface>}
        </>
      ) : (
        <Surface><p className="text-sm text-mu">No usage for this model in this period. The selection is kept so switching back to another period restores it.</p></Surface>
      )}
      <Surface className="space-y-2">
        <h4 className="text-sm font-medium">Recent attempts</h4>
        {recent.length ? recent.map((r) => {
          const canJump = !r.failed && !!r.chatId && !!r.messageId && r.available !== false
          const body = (
            <>
              <span className={cx('text-[11px] font-medium', r.failed ? 'text-er' : 'text-ac')}>{r.failed ? 'Failed' : 'OK'}</span>
              <span className="w-24 shrink-0 text-xs tabular-nums text-mu" title={formatDateTime(r.at)}>{formatDay(r.at)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-mu" title={chatLabelOf(r)}>{chatLabelOf(r)}</span>
              <span className="shrink-0 text-xs tabular-nums text-mu">{fmtInt(r.tokens.total)} tok</span>
              <span className="w-20 shrink-0 text-right text-xs tabular-nums">{r.cost == null ? '—' : `${r.estimated ? '≈ ' : ''}${money(r.cost, decimals)}`}</span>
            </>
          )
          return canJump
            ? <button key={`${r.messageId}-${r.at}`} type="button" onClick={() => onOpenChat(r.chatId, r.messageId)} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-hov focus-visible:outline-2 focus-visible:outline-ac">{body}</button>
            : <div key={`${r.messageId}-${r.at}`} className="flex min-h-9 items-center gap-2 rounded-lg px-1">{body}</div>
        }) : <p className="text-sm text-mu">No attempts for this model in this period.</p>}
      </Surface>
      <div className="flex flex-wrap gap-2">
        {!removed && <Btn v="soft" icon={ExternalLink} onClick={() => jumpSetting(`eps#ep-${row?.endpointId ?? ''}`)}>Open endpoint settings</Btn>}
        <Btn v="soft" icon={ExternalLink} onClick={() => jumpSetting('eps#model-pricing')}>Open model pricing</Btn>
      </div>
    </DetailShell>
  )
}

/* ---- page ---- */

export function UsageStats({ onOpenChat }: { onOpenChat: (chatId: string, messageId: string) => void }) {
  const features = useS((s) => s.features)
  const eps = useS((s) => s.eps)
  const stats = useS((s) => s.stats)
  const wp = useS((s) => s.widgetPrefs)
  const patch = useS((s) => s.patch)
  // Attempt arrays keep their identity while reply text streams, so a chunk
  // does not rebuild the dashboard. Chat metadata is a cheap string key so a
  // rename still refreshes Activity titles.
  const logs = useS(useShallow((s) => allAttemptLogs(s.chats)))
  const ats = useS(useShallow((s) => allAttemptAts(s.chats)))
  const chatMeta = useS((s) => s.chats.map((c) => `${c.id}\u0000${c.title ?? ''}`).join('\u0001'))
  // Kept history is the long-lived source; attempts still on live chats fill
  // any gap without being counted twice (see buildUsageRecordsFromHistory).
  const ledger = useS((s) => s.usage)
  const ledgerTitles = useS((s) => s.usageTitles)
  const [ui, setUi] = useUi()
  const [now, setNow] = useState(() => Date.now())
  const [resetOpen, setResetOpen] = useState(false)
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && (window as Window & { __byokReady?: boolean }).__byokReady === true)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (ready) return
    let live = true
    const done = () => { if (live) setReady(true) }
    window.addEventListener('byok:ready', done)
    // A hydration failure (or a build that never dispatches) must not leave a
    // permanent skeleton; synchronous data is usable after a short fallback.
    const t = setTimeout(done, 1500)
    return () => { live = false; window.removeEventListener('byok:ready', done); clearTimeout(t) }
  }, [ready])

  const period = (USAGE_PERIODS.some(([k]) => k === wp.usagePeriod) ? wp.usagePeriod : 'all') as UsagePeriod
  const from = wp.usageFrom ?? ''
  const to = wp.usageTo ?? ''
  const range = useMemo(() => statsRange({ period, from, to, now }), [period, from, to, now])
  const all = useMemo(() => {
    const chats = useS.getState().chats
    return buildUsageRecordsFromHistory({ ledger, titles: ledgerTitles, logs, ats, contexts: attemptContexts(chats), eps, chats })
  }, [ledger, ledgerTitles, logs, ats, eps, chatMeta])
  const records = useMemo(() => recordsInRange(all, range), [all, range])
  const summary = useMemo(() => summarize(records), [records])
  const decimals = Math.min(8, Math.max(0, Number(wp.costDecimals ?? 4)))
  const unit = bucketUnitFor(range, now)

  const setPeriod = useCallback((p: UsagePeriod) => {
    const st = useS.getState()
    st.patch({ widgetPrefs: { ...st.widgetPrefs, usagePeriod: p } })
  }, [])
  const setDates = useCallback((f: string, t: string) => {
    const st = useS.getState()
    st.patch({ widgetPrefs: { ...st.widgetPrefs, usageFrom: f, usageTo: t } })
  }, [])

  const chooseModel = useCallback((key: string, label: string) => setUi({ modelKey: key, modelLabel: label }), [setUi])
  const openDetail = useCallback((kind: DetailKind, opts?: { modelKey?: string; modelLabel?: string }, trigger?: HTMLElement | null) => {
    const focus = trigger?.getAttribute('data-usage-focus') || `${kind}:${opts?.modelKey ?? ''}`
    setUi({ detail: { kind, modelKey: opts?.modelKey ?? '', modelLabel: opts?.modelLabel ?? '', from: store.view, focus } })
  }, [setUi])
  // The trigger is replaced while a detail view is open, so the opener is
  // remembered by a stable key and re-found after the view renders again.
  const restoreFocus = useRef<string | null>(null)
  const closeDetail = useCallback(() => {
    restoreFocus.current = store.detail?.focus ?? null
    setUi({ detail: null })
  }, [setUi])
  useEffect(() => {
    if (ui.detail || !restoreFocus.current) return
    const focus = restoreFocus.current
    restoreFocus.current = null
    const node = document.querySelector<HTMLElement>(`[data-usage-focus="${focus.replace(/"/g, '\\"')}"]`)
    ;(node ?? document.querySelector<HTMLElement>('[role=tab][aria-selected=true]'))?.focus()
  }, [ui.detail])
  useEscapeClose(closeDetail, !!ui.detail)

  useEffect(() => {
    if (!ui.detail) return
    const t = setTimeout(() => headingRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [ui.detail])

  // Palette/catalog anchors: switch views or open a detail, without leaving the
  // Stats tab. Settings dispatches this before scrolling to the anchor.
  useEffect(() => {
    const map: Record<string, UsageView> = { 'view-overview': 'overview', 'view-models': 'models', 'view-trends': 'trends', 'view-activity': 'activity' }
    const details: Record<string, DetailKind> = { 'detail-cost': 'cost', 'detail-tokens': 'tokens', 'detail-average': 'average', 'detail-model': 'model' }
    const onAnchor = (e: Event) => {
      const a = (e as CustomEvent<string>).detail
      if (typeof a !== 'string') return
      if (map[a]) setUi({ view: map[a], detail: null })
      else if (details[a]) {
        const kind = details[a]
        const top = summary.models[0]
        setUi({ view: 'overview', detail: { kind, modelKey: kind === 'model' ? top?.key ?? '' : '', modelLabel: kind === 'model' ? top?.modelLabel ?? '' : '', from: 'overview', focus: `detail:${kind}` } })
      }
    }
    window.addEventListener('byok:anchor', onAnchor)
    return () => window.removeEventListener('byok:anchor', onAnchor)
  }, [setUi, summary.models])

  if (!featOn({ features }, 'stats')) return null

  const setView = (v: UsageView) => setUi({ view: v, detail: null })
  const selectedMissing = !!ui.modelKey && !findModel(summary.models, ui.modelKey)
  const noBillable = summary.requests === 0
  const empty = all.length === 0
  const periodEmpty = records.length === 0
  const emptyWindow = Number.isFinite(range.end)
    ? `No usage between ${formatDate(range.start)} and ${formatDate(range.end - 1)}.`
    : `No usage since ${formatDate(range.start)}.`

  const detail = ui.detail
  const detailBody = detail?.kind === 'cost'
    ? <CostDetail summary={summary} records={records} range={range} now={now} decimals={decimals} from={detail.from} onBack={closeDetail} headingRef={headingRef} showTable={ui.showTable} toggleTable={() => setUi({ showTable: !ui.showTable })} unit={unit} />
    : detail?.kind === 'tokens'
      ? <TokenDetail summary={summary} records={records} range={range} now={now} decimals={decimals} from={detail.from} onBack={closeDetail} headingRef={headingRef} showTable={ui.showTable} toggleTable={() => setUi({ showTable: !ui.showTable })} unit={unit} />
      : detail?.kind === 'average'
        ? <AverageDetail summary={summary} decimals={decimals} modelKey={ui.modelKey} modelLabel={ui.modelLabel} from={detail.from} onBack={closeDetail} headingRef={headingRef} openModel={(m, el) => openDetail('model', { modelKey: m.key, modelLabel: m.modelLabel }, el)} />
        : detail?.kind === 'model'
          ? <ModelDetail summary={summary} records={records} range={range} now={now} decimals={decimals} eps={eps} detail={detail} from={detail.from} onBack={closeDetail} headingRef={headingRef} onOpenChat={onOpenChat} showTable={ui.showTable} toggleTable={() => setUi({ showTable: !ui.showTable })} unit={unit} />
          : null

  const body = !ready
    ? <LoadingSkeleton />
    : range.invalid
      ? <EmptyState title="That date range is not valid" text="Through must be on or after From, and both dates must be complete. Nothing is shown for an invalid range so the numbers cannot mislead." action={<Btn v="soft" onClick={() => setPeriod('all')}>Show all time</Btn>} />
      : detail
        ? detailBody
        : empty
          ? <EmptyState title="No usage recorded yet" text="Usage appears after the first provider-reported reply. Connect an endpoint, then send a message. Lifetime counters below stay visible." action={<Btn v="solid" icon={ExternalLink} onClick={() => jumpSetting('eps')}>Open endpoints</Btn>} />
          : periodEmpty
            ? <EmptyState title="No usage in this period" text={`${emptyWindow} Pick a wider period to see usage that falls outside this window.`}
              action={<><Btn v="soft" onClick={() => setPeriod('month')}>Last 30 days</Btn><Btn v="soft" onClick={() => setPeriod('all')}>Show all time</Btn></>} />
            : noBillable
              ? <EmptyState title="No billable usage in this period" text={`${fmtInt(summary.failed)} failed attempt${summary.failed === 1 ? '' : 's'} were recorded and are excluded from every metric.`}
                action={<><Btn v="soft" onClick={() => setPeriod('month')}>Last 30 days</Btn><Btn v="soft" onClick={() => setPeriod('all')}>Show all time</Btn></>} />
              : ui.view === 'overview'
              ? <Overview summary={summary} records={records} range={range} now={now} decimals={decimals} modelKey={ui.modelKey} modelLabel={ui.modelLabel} setView={setView} chooseModel={chooseModel} openDetail={openDetail}
                buckets={chartBuckets(records, range, unit, now)} unit={unit} />
              : ui.view === 'models'
                ? <ModelsView summary={summary} decimals={decimals} ui={ui} setUi={setUi} openDetail={openDetail} />
                : ui.view === 'trends'
                  ? <TrendsView summary={summary} records={records} range={range} now={now} decimals={decimals} ui={ui} setUi={setUi} />
                    : <ActivityView records={records} summary={summary} decimals={decimals} ui={ui} setUi={setUi} onOpenChat={onOpenChat} />

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 pr-10">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><TrendingUp size={20} className="text-ac" />Stats</h2>
          <p className="mt-1 text-sm text-mu">{STATS_INFO}</p>
        </div>
      </div>
      <SubNav view={ui.view} setView={setView} />
      <div className="sr-only" aria-live="polite">{ui.detail ? `${detail?.kind} detail open` : `${VIEWS.find(([k]) => k === ui.view)?.[1] ?? ''} view`}</div>
      <PeriodBar period={period} from={from} to={to} range={range} records={records} now={now} setPeriod={setPeriod} setDates={setDates} />
      {selectedMissing && !detail && !range.invalid && !periodEmpty && <p className="text-xs text-mu">The selected model has no usage in this period. The average card shows — rather than switching models silently.</p>}
      {body}
      <Lifetime stats={stats} resetOpen={resetOpen} setResetOpen={setResetOpen} />
    </div>
  )
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <Surface className="flex flex-col items-start gap-2 p-5">
      <div className="flex items-center gap-2 font-medium"><Info size={16} className="text-ac" />{title}</div>
      <p className="max-w-prose text-sm text-mu">{text}</p>
      {action && <div className="flex flex-wrap gap-2 pt-1">{action}</div>}
    </Surface>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading usage from saved replies…</span>
      <div className="grid grid-cols-1 gap-3 motion-reduce:animate-none sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-surf motion-reduce:animate-none" />)}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-surf motion-reduce:animate-none" />
    </div>
  )
}

function Lifetime({ stats, resetOpen, setResetOpen }: {
  stats: Stats
  resetOpen: boolean
  setResetOpen: (v: boolean) => void
}) {
  const resetStats = useS((s) => s.resetStats)
  const kept = useS((s) => s.usage.length)
  const keptSince = useS((s) => s.usage[0]?.at ?? 0)
  const keep = useS((s) => s.prefs.keepUsageHistory !== false)
  const clearUsageHistory = useS((s) => s.clearUsageHistory)
  const [clearOpen, setClearOpen] = useState(false)
  return (
    <div className="space-y-3 border-t border-bor pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold">Lifetime counters</h3>
        <HelpTip text="All-time totals stored by the app. They are not filtered by the period above and are not affected by deleting chats, so they can differ from the windowed dashboard." label="About lifetime counters" />
        <span className="text-xs text-mu">since {new Date(stats.since).toLocaleDateString()}</span>
      </div>
      <Anchor id="lifetime-counters">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Anchor id="tokens-sent"><div className="rounded-lg bg-surf px-3 py-2"><div className="flex items-center gap-1.5 text-xs text-mu"><ArrowUp size={12} className="text-ac" />Tokens sent</div><div className="text-lg font-semibold tabular-nums">{stats.tin.toLocaleString()}</div><div className="text-[11px] text-mu">{stats.explicitIn.toLocaleString()} explicit · {stats.historyIn.toLocaleString()} history</div></div></Anchor>
          <Anchor id="tokens-generated"><div className="rounded-lg bg-surf px-3 py-2"><div className="flex items-center gap-1.5 text-xs text-mu"><ArrowDown size={12} className="text-ac" />Tokens generated</div><div className="text-lg font-semibold tabular-nums">{stats.tout.toLocaleString()}</div><div className="text-[11px] text-mu">reply tokens, partial replies included</div></div></Anchor>
          <Anchor id="messages-sent"><div className="rounded-lg bg-surf px-3 py-2"><div className="flex items-center gap-1.5 text-xs text-mu"><MessageSquare size={12} className="text-ac" />Messages sent</div><div className="text-lg font-semibold tabular-nums">{stats.sent.toLocaleString()}</div><div className="text-[11px] text-mu">edited and resent included</div></div></Anchor>
          <Anchor id="chats-started"><div className="rounded-lg bg-surf px-3 py-2"><div className="flex items-center gap-1.5 text-xs text-mu"><CalendarDays size={12} className="text-ac" />Chats started</div><div className="text-lg font-semibold tabular-nums">{stats.chats.toLocaleString()}</div><div className="text-[11px] text-mu">counted on the first message</div></div></Anchor>
        </div>
      </Anchor>
      <Anchor id="keep-usage-history">
        <Surface className="space-y-2">
          <Checkbox checked={keep} set={(v) => useS.getState().setKeepUsageHistory(v)} label="Keep usage from temporary, archived and deleted chats" />
          <p className="text-xs text-mu">{keep
            ? `Each attempt is saved in this browser as its reply finishes, so its tokens and cost stay in the dashboard after the chat expires, is archived or is deleted.${kept ? ` ${fmtInt(kept)} attempt${kept === 1 ? '' : 's'} kept${keptSince ? ` since ${formatDate(keptSince)}` : ''}.` : ''}`
            : 'Only attempts still stored on a chat are counted: deleting a chat, or letting a temporary one expire, removes its detailed usage from the dashboard.'}</p>
          <p className="text-xs text-mu">The newest {fmtInt(MAX_USAGE_ROWS)} attempts are kept; a full browser storage may keep fewer. Lifetime counters below are unaffected by either choice.</p>
          {kept > 0 && <Btn v="soft" onClick={() => setClearOpen(true)}>Clear kept history</Btn>}
        </Surface>
      </Anchor>
      <div className="flex flex-wrap items-center gap-2">
        <Anchor id="reset-stats"><Btn v="danger" icon={RotateCcw} onClick={() => setResetOpen(true)}>Reset stats</Btn></Anchor>
        <p className="min-w-0 flex-1 text-xs text-mu">Reset clears the all-time counters only; kept history is cleared separately above.</p>
      </div>
      {resetOpen && <Confirm title="Reset all stats?" text="Tokens, messages and chats-started totals go back to zero. Kept usage history and the attempts still stored on chats are not deleted." ok="Reset" close={() => setResetOpen(false)} run={() => resetStats()} />}
      {clearOpen && <Confirm title="Clear kept usage history?" text="Attempts kept permanently in this browser are removed, including those from temporary, archived and deleted chats. Usage still stored on existing chats and the lifetime counters are not affected." ok="Clear" close={() => setClearOpen(false)} run={() => clearUsageHistory()} />}
    </div>
  )
}
