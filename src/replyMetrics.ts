/* Footer metrics derived from a saved reply's usage log. Kept out of the
 * component so the output-token and cost rules can be tested directly. */

import type { Attempt, Ep, Msg } from './store'
import { attemptCost } from './usage'

/** Output tokens for the reply. New replies persist the field directly; older
 *  replies fall back to the final attempt's cumulative output count. */
export function outputTokensOf(m: Pick<Msg, 'tokensOut' | 'log'>): number {
  if (typeof m.tokensOut === 'number' && Number.isFinite(m.tokensOut)) return Math.max(0, m.tokensOut)
  const final = [...(m.log ?? [])].reverse().find((a) => a.tout != null || a.contextTout != null)
  return Math.max(0, final?.tout ?? final?.contextTout ?? 0)
}

/** Shortest active generation worth reporting. Below it the stream is a single
 *  burst (or the non-streaming fallback), and any rate would be noise. */
export const MIN_SPEED_MS = 200

/** Generation speed in tokens/s, measured from the stream itself: visible
 *  output characters over the time spent emitting them (engine's `genMs`).
 *  The provider's usage figure is deliberately not used — it counts hidden
 *  reasoning tokens and never says how long generation actually took. Null
 *  when too little text streamed for the number to mean anything. */
export function replySpeed(outChars: number, genMs: number, charsPerToken = 4): number | null {
  if (!Number.isFinite(outChars) || !Number.isFinite(genMs)) return null
  if (outChars <= 0 || genMs < MIN_SPEED_MS) return null
  const tokens = Math.ceil(outChars / Math.max(1, charsPerToken))
  return Math.round(tokens / (genMs / 1000) * 10) / 10
}

/** Total spend for every priced attempt in the reply, or null when no attempt
 *  has a provider-reported cost or a matching endpoint price. */
export function messageCostOf(eps: Ep[], log: Attempt[] | undefined): { total: number; estimated: boolean } | null {
  let total = 0
  let known = false
  let estimated = false
  for (const attempt of log ?? []) {
    const priced = attemptCost(eps, attempt)
    if (priced.cost == null || !Number.isFinite(priced.cost)) continue
    known = true
    total += Math.max(0, priced.cost)
    estimated ||= priced.estimated
  }
  return known ? { total, estimated } : null
}

/** Compact footer price; the exact value remains available in the title. */
export function formatCost(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '$0'
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(3)}`
  if (n >= 0.0001) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

export function exactCost(n: number): string {
  if (!Number.isFinite(n)) return 'Cost unavailable'
  return `$${n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`
}
