import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { TrendingUp } from 'lucide-react'
import { useS, featOn } from '../store'
import { attemptLogsFromRows, chatAttemptLogs, deriveUsage, lastReplyBy } from '../usage'
import { estimateHistoryTokens } from '../engine'
import { compactThreshold, normCompactAt, withCompaction } from '../compaction'
import { qualityPrompt } from '../flair'
import { Pop, cx } from './ui'

const fmtTokens = (n: number) => {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : n >= 1e4 ? 1 : 0).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}
const fmtInt = (n: number) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString()

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-baseline justify-between gap-4 px-2 py-1 text-sm">
    <span className="text-mu">{k}</span>
    <span className="truncate font-medium tabular-nums">{v}</span>
  </div>
)

const Section = ({ title, className, children }: { title: string; className?: string; children: ReactNode }) => (
  <div className={className}>
    <div className="px-2 pb-1 text-xs text-mu">{title}</div>
    {children}
  </div>
)

/** Live context bar for the popover. It estimates the request that would be
 *  sent now (including a stored handoff), so manually compacting updates it
 *  immediately instead of waiting for the next provider-reported usage. */
function ContextBar({ limit, cpt, busy }: { limit: number; cpt: number; busy: boolean }) {
  const msgs = useS((s) => s.chats.find((c) => c.id === s.chat)?.msgs)
  const compact = useS((s) => s.chats.find((c) => c.id === s.chat)?.compact)
  const auto = useS((s) => s.prefs.compactAuto !== false)
  const at = useS((s) => normCompactAt(s.prefs.compactAt))
  const global = useS((s) => s.globalPrompt)
  const prompt = useS((s) => s.prompts.find((p) => p.id === s.pr)?.text ?? '')
  const [working, setWorking] = useState(false)
  const qPrompt = (global?.qualities?.length ?? 0) ? qualityPrompt(global.qualities) : ''
  const sysLen = [(global?.on ? global.text : ''), qPrompt].filter(Boolean).join('\n\n') + prompt
  const used = estimateHistoryTokens(withCompaction(msgs ?? [], compact), sysLen, cpt)
  const max = Math.max(1, limit)
  const pct = Math.max(0, Math.min(100, used / max * 100))
  const threshold = compactThreshold(max, at)
  const mark = Math.max(0, Math.min(100, threshold / max * 100))
  const compactNow = async () => {
    if (busy || working) return
    setWorking(true)
    try { await useS.getState().compactChat() } finally { setWorking(false) }
  }
  return (
    <div className="space-y-2 px-2 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Context</span>
        <span className="text-xs tabular-nums text-mu">{fmtTokens(used)} / {fmtTokens(max)} · {Math.round(pct)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Context size"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(used)}
        aria-valuetext={`${fmtInt(used)} of ${fmtInt(max)} estimated tokens${auto ? `; compacts at ${fmtInt(threshold)}` : '; automatic compaction is off'}`}
        title={`${fmtInt(used)} of ${fmtInt(max)} estimated tokens${auto ? `; compacts at ${fmtInt(threshold)}` : '; automatic compaction is off'}`}
        className="relative h-2.5 w-full rounded-full bg-black/25 shadow-inner ring-1 ring-inset ring-bor/70"
      >
        <div className="h-full rounded-full bg-ac" style={{ width: `${pct}%` }} />
        {auto && <span aria-hidden="true" title={`Compacts at ${fmtTokens(threshold)}`} className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-tx/80 shadow-[0_0_0_1px_var(--bg)]" style={{ left: `${mark}%` }} />}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-mu">
          {auto ? <>Compacts at <span className="font-medium text-tx">{fmtTokens(threshold)}</span></> : 'Auto-compact off'}
        </span>
        <button
          type="button"
          disabled={busy || working}
          onClick={compactNow}
          title="Replace older messages with a model-written handoff now"
          className="rounded-md px-2 py-1 font-medium text-ac hover:bg-hov disabled:cursor-not-allowed disabled:opacity-50"
        >
          {working ? 'Compacting…' : 'Compact'}
        </button>
      </div>
    </div>
  )
}

/* Header context meter: a ring showing verified (provider-reported) tokens
 * in the open chat as a share of the configured limit, plus the whole
 * chat's cost to the right of the ring. The ring stays empty until the
 * first answer reports its usage; the popover breaks the last reply and the
 * whole chat into the same four token categories (uncached input, cached
 * input, cache write, output) plus each one's cost.
 *
 * Subscriptions are deliberately narrow: everything here is derived from
 * attempt logs, and a streamed chunk keeps its message's `log` reference, so
 * the meter does not recompute once per token. */
export function ContextMeter({ cfg }: { cfg: (t: string) => void }) {
  const show = useS((s) => s.prefs.showContextMeter !== false)
  const statsOn = useS((s) => featOn(s, 'stats'))
  const chatId = useS((s) => s.chat)
  const logs = useS(useShallow((s) => chatAttemptLogs(s.chats, s.chat)))
  const lastBy = useS((s) => lastReplyBy(s.chats, s.chat))
  const ledger = useS((s) => s.usage)
  const ledgerLogs = useMemo(() => attemptLogsFromRows(ledger, chatId), [ledger, chatId])
  const eps = useS((s) => s.eps)
  const sel = useS((s) => s.sel)
  const manualLimit = useS((s) => Math.max(1000, Math.floor(Number(s.widgetPrefs?.contextLimit) || 128000)))
  const charsPerToken = useS((s) => Math.min(10, Math.max(1, Number(s.widgetPrefs?.charsPerToken) || 4)))
  const busy = useS((s) => s.busyChats?.[s.chat] === true)
  const decimals = useS((s) => Math.min(8, Math.max(0, Number(s.widgetPrefs?.costDecimals ?? 4))))
  // A message restored from a cloud copy has no process log (sync intentionally
  // omits it), but the permanent ledger still has the spend. Fall back to the
  // ledger so a reload does not make every chat look unused.
  const effectiveLogs = logs.length ? logs : ledgerLogs
  const effectiveLastBy = logs.length ? lastBy : (ledgerLogs[ledgerLogs.length - 1]?.[0]?.n ?? '')
  const u = useMemo(() => deriveUsage({ logs: effectiveLogs, lastBy: effectiveLastBy, eps, sel, manualLimit }), [effectiveLogs, effectiveLastBy, eps, sel, manualLimit])
  if (!show) return null

  const { hasReply, tok, limit, pct, over, tout, cacheRead, cacheWrite, uncached, replyCost, chatCost, chatTout, chatCacheRead, chatCacheWrite, chatUncached, modelLabel } = u
  // Both sections price the same way: an estimate marker when there is spend
  // to show, an em dash when the provider reported no price at all.
  const money = (n: number) => (n > 0 ? `≈ $${n.toFixed(decimals)}` : '—')
  // Header label: no "≈" and always 3 decimals, independent of the popup's decimals setting.
  const costHeader = `$${chatCost.toFixed(3)}`

  const R = 15.5, C = 2 * Math.PI * R
  const label = `${fmtTokens(tok)} of ${fmtTokens(limit)} tokens${hasReply ? ` · last reply by ${modelLabel || effectiveLastBy || 'unknown model'}` : ''}`
  return (
    <div className="flex items-center gap-1.5">
      <Pop
        w="w-72"
        right
        trigger={() => (
          <button
            type="button"
            title={label}
            aria-label={`Context usage: ${label}. Total cost ${costHeader}. Open usage details`}
            className="flex shrink-0 items-center gap-1.5 rounded-lg py-1.5 pl-1.5 pr-2 text-mu hover:bg-hov hover:text-tx"
          >
            <span className="relative grid size-9 place-items-center">
            <svg width="32" height="32" viewBox="0 0 36 36" aria-hidden="true" className="-rotate-90">
              <circle cx="18" cy="18" r={R} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r={R}
                fill="none"
                stroke={over ? 'var(--er)' : 'var(--ac)'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(pct * C).toFixed(1)} ${C.toFixed(1)}`}
              />
            </svg>
            <span className={cx('absolute inset-0 grid place-items-center text-[10px] font-semibold', over ? 'text-er' : 'text-tx')}>
              {fmtTokens(tok)}
            </span>
            </span>
            <span className="hidden text-xs tabular-nums sm:inline">{costHeader}</span>
          </button>
        )}
      >
        {(close) => (
          <div className="space-y-2 p-2">
            <ContextBar limit={limit} cpt={charsPerToken} busy={busy} />
            <div className="border-t border-bor" />
            <div className="px-2 pt-1 text-sm font-medium">Usage</div>
            {hasReply ? (
              <>
                <Section title={`Last reply${modelLabel ? ` · ${modelLabel}` : ''}`}>
                  <Row k="Uncached input" v={fmtInt(uncached)} />
                  <Row k="Cached input" v={fmtInt(cacheRead)} />
                  <Row k="Cache write" v={fmtInt(cacheWrite)} />
                  <Row k="Output" v={fmtInt(tout)} />
                  <Row k="Cost" v={money(replyCost)} />
                </Section>
                <Section title="This chat" className="border-t border-bor pt-2">
                  <Row k="Uncached input" v={fmtInt(chatUncached)} />
                  <Row k="Cached input" v={fmtInt(chatCacheRead)} />
                  <Row k="Cache write" v={fmtInt(chatCacheWrite)} />
                  <Row k="Output" v={fmtInt(chatTout)} />
                  <Row k="Cost" v={money(chatCost)} />
                </Section>
                {over && <p className="px-2 text-xs text-er">Over budget: older messages are compacted or trimmed from requests until it fits.</p>}
              </>
            ) : (
              <p className="px-2 text-xs text-mu">No replies yet — reported tokens appear here after the first answer.</p>
            )}
            {statsOn && (
              <div className="border-t border-bor pt-2">
                <button
                  type="button"
                  onClick={() => { close(); cfg('stats') }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hov focus-visible:outline-2 focus-visible:outline-ac"
                >
                  <TrendingUp size={15} className="shrink-0 text-ac" />
                  <span className="min-w-0 flex-1">Open usage statistics</span>
                </button>
              </div>
            )}
          </div>
        )}
      </Pop>
    </div>
  )
}
