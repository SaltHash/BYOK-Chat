import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useS } from '../store'
import { chatAttemptLogs, deriveUsage, lastReplyBy } from '../usage'
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
    <span className="truncate font-medium">{v}</span>
  </div>
)

/* Header context meter: a ring showing verified (provider-reported) tokens
 * in the open chat as a share of the configured limit, plus the whole
 * chat's cost to the right of the ring. The ring stays empty until the
 * first answer reports its usage; the popover shows the last reply's
 * breakdown (input / output / cache read / cache write / provider / cost).
 *
 * Subscriptions are deliberately narrow: everything here is derived from
 * attempt logs, and a streamed chunk keeps its message's `log` reference, so
 * the meter does not recompute once per token. */
export function ContextMeter() {
  const show = useS((s) => s.prefs.showContextMeter !== false)
  const logs = useS(useShallow((s) => chatAttemptLogs(s.chats, s.chat)))
  const lastBy = useS((s) => lastReplyBy(s.chats, s.chat))
  const eps = useS((s) => s.eps)
  const sel = useS((s) => s.sel)
  const manualLimit = useS((s) => Math.max(1000, Math.floor(Number(s.widgetPrefs?.contextLimit) || 128000)))
  const decimals = useS((s) => Math.min(8, Math.max(0, Number(s.widgetPrefs?.costDecimals ?? 4))))
  const u = useMemo(() => deriveUsage({ logs, lastBy, eps, sel, manualLimit }), [logs, lastBy, eps, sel, manualLimit])
  if (!show) return null

  const { hasReply, tok, limit, pct, over, tin, contextTin, contextTout, tout, cacheRead, cacheWrite, uncached, replyCost, chatCost, modelLabel } = u
  const costLabel = chatCost > 0 ? `≈ $${chatCost.toFixed(decimals)}` : '$0.00'
  // Header label: no "≈" and always 3 decimals, independent of the popup's decimals setting.
  const costHeader = `$${chatCost.toFixed(3)}`
  const cost = replyCost

  const R = 15.5, C = 2 * Math.PI * R
  const label = `${fmtTokens(tok)} of ${fmtTokens(limit)} tokens${hasReply ? ` · last reply by ${lastBy || 'unknown model'}` : ''}`
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
        {() => (
          <div className="space-y-2 p-2">
            <div className="px-2 pt-1 text-sm font-medium">Context usage</div>
            {hasReply ? (
              <div>
                <div className="px-2 pb-1 text-xs text-mu">Last reply{modelLabel ? ` · ${modelLabel}` : ''}</div>
                <Row k="Input (final round)" v={fmtInt(contextTin)} />
                <Row k="Output (final round)" v={fmtInt(contextTout)} />
                <Row k="Uncached input (all rounds)" v={fmtInt(uncached)} />
                <Row k="Output (all rounds)" v={fmtInt(tout)} />
                <Row k="Cache read (all rounds)" v={fmtInt(cacheRead)} />
                <Row k="Cache write (all rounds)" v={fmtInt(cacheWrite)} />
                <Row k="Prompt total (all rounds)" v={fmtInt(tin)} />
                <Row k="Cost estimate" v={cost > 0 ? `≈ $${cost.toFixed(decimals)}` : 'no priced usage'} />
              </div>
            ) : (
              <p className="px-2 text-xs text-mu">No replies yet — reported tokens appear here after the first answer.</p>
            )}
            <div className="border-t border-bor pt-2">
              <div className="px-2 pb-1 text-xs text-mu">This chat</div>
              <Row k="Context tokens" v={`${fmtInt(tok)} of ${fmtInt(limit)}`} />
              <Row k="Cost" v={costLabel} />
              {over && <p className="px-2 text-xs text-er">Over budget: oldest messages are trimmed from requests until it fits.</p>}
            </div>
          </div>
        )}
      </Pop>
    </div>
  )
}
