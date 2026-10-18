/* Context-window and cost reporting for the header meter.
 *
 * The derivation lives outside the component so it can be memoized on *log
 * identity*: a streamed chunk replaces a message's text but keeps its `log`
 * array, so the meter (and the popover) only recompute when a reply actually
 * reports usage — not once per token. */

import { modelsOf, modelNameOf } from './models'
import type { Attempt, Chat, Ep, Message } from './store'

export type Selection = { k?: string; id?: string; model?: string } | null | undefined

/** Shared empty result: reference-stable, so selectors never churn on it. */
export const NO_LOGS: Attempt[][] = []

/** Start of the current page load, used by the "this session" usage period. */
export const SESSION_START = Date.now()

/* Endpoint names carry a `(classifier)` suffix for routing calls; report the
 * spend against the endpoint the user configured. */
export const endpointNameOf = (n: string) => n.replace(/ \(classifier\)$/, '')

const endpointByName = (eps: Ep[], n: string) => eps.find((e) => e.name === endpointNameOf(n))

/** Attempt logs of every assistant message in the chat, oldest first. Only
 *  changes when a reply adds or replaces a log, never when a chunk replaces
 *  message text. */
export function chatAttemptLogs(chats: Chat[], chatId: string | null | undefined): Attempt[][] {
  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined
  if (!chat) return NO_LOGS
  const out: Attempt[][] = []
  for (const m of chat.msgs) if (m.r === 'assistant' && m.log?.length) out.push(m.log)
  return out
}

/** `by` of the newest assistant message that reported usage (tooltip
 *  fallback when no log entry maps to a display name). */
export function lastReplyBy(chats: Chat[], chatId: string | null | undefined): string {
  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined
  if (!chat) return ''
  for (let i = chat.msgs.length - 1; i >= 0; i--) {
    const m = chat.msgs[i]
    if (m.r === 'assistant' && m.log?.length) return m.by ?? ''
  }
  return ''
}

/** Newest assistant message that reported usage, by reference. Reference
 *  equality is what keeps "last reply" panels off the streamed-chunk path. */
export function lastLogMessage(chats: Chat[], chatId: string | null | undefined): Message | undefined {
  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined
  if (!chat) return undefined
  for (let i = chat.msgs.length - 1; i >= 0; i--) {
    const m = chat.msgs[i]
    if (m.r === 'assistant' && m.log?.length) return m
  }
  return undefined
}

/** Attempt logs of every message in every chat, oldest chat first. Paired
 *  index-wise with `allAttemptAts`. */
export function allAttemptLogs(chats: Chat[]): Attempt[][] {
  const out: Attempt[][] = []
  for (const chat of chats) for (const m of chat.msgs) if (m.log?.length) out.push(m.log)
  return out
}

/** `at` of the message owning each entry of `allAttemptLogs`, for entries that
 *  carry no timestamp of their own (e.g. engine-level failures). */
export function allAttemptAts(chats: Chat[]): number[] {
  const out: number[] = []
  for (const chat of chats) for (const m of chat.msgs) if (m.log?.length) out.push(m.at ?? 0)
  return out
}

/* ---- usage widget: time-windowed roll-up per endpoint (or per model) ---- */

export type UsageGroup = { key: string; ok: number; bad: number; tin: number; tout: number }

export type UsageWindow = { period?: string; from?: string; to?: string; now: number }

/** Half-open [start, end] window for the configured usage period. `end` is
 *  open-ended unless a custom range sets it. */
export function usageRange({ period, from, to, now }: UsageWindow): { start: number; end: number } {
  const start = period === 'session' ? SESSION_START
    : period === 'day' ? now - 86400000
      : period === 'week' ? now - 7 * 86400000
        : period === 'custom' ? (from ? new Date(from).getTime() : 0)
          : 0
  const end = period === 'custom' && to ? new Date(to).getTime() + 86400000 : Infinity
  return { start, end }
}

export function groupUsage(logs: Attempt[][], ats: number[], group: string | undefined, range: { start: number; end: number }): UsageGroup[] {
  const grouped = new Map<string, UsageGroup>()
  for (let i = 0; i < logs.length; i++) {
    const fallback = ats[i] ?? 0
    for (const t of logs[i]) {
      const at = t.at ?? fallback
      if (at < range.start || at > range.end) continue
      const endpoint = endpointNameOf(t.n)
      const key = group === 'model' ? `${endpoint} · ${t.m || 'unknown model'}` : endpoint
      const v = grouped.get(key) ?? { key, ok: 0, bad: 0, tin: 0, tout: 0 }
      if (t.err) v.bad++
      else v.ok++
      v.tin += t.tin ?? 0
      v.tout += t.tout ?? 0
      grouped.set(key, v)
    }
  }
  return [...grouped.values()]
}

export type UsageSource = {
  /** Oldest-first attempt logs (see `chatAttemptLogs`). */
  logs: Attempt[][]
  /** Newest reporting message's provider label (see `lastReplyBy`). */
  lastBy: string
  eps: Ep[]
  sel: Selection
  /** Fallback limit from Appearance settings when the model reports none. */
  manualLimit: number
}

export type Usage = {
  /** The chat has at least one reply with reported usage. */
  hasReply: boolean
  /** Verified tokens of the last reply (input + output). */
  tok: number
  /** Effective context window for the last reply's model. */
  limit: number
  pct: number
  over: boolean
  tin: number
  tout: number
  cacheRead: number
  cacheWrite: number
  uncached: number
  replyCost: number
  chatCost: number
  modelLabel: string
}

/* Billable = the provider reported usage and the attempt did not fail. */
const billable = (t: Attempt) => !t.err && (t.tin != null || t.tout != null)

const priceOf = (eps: Ep[], t: Attempt) => (t.m ? endpointByName(eps, t.n)?.prices?.[t.m] : undefined)

/** Per-attempt spend: provider-reported first, endpoint price table second. */
const costOf = (eps: Ep[], t: Attempt) => {
  if (Number.isFinite(t.cost) && (t.cost ?? 0) > 0) return t.cost as number
  const price = priceOf(eps, t)
  return price ? ((t.tin ?? 0) * price.input + (t.tout ?? 0) * price.output) / 1e6 : 0
}

/** Model-reported context window, or 0 when the endpoint has no entry. */
const contextLimit = (ep: Ep | undefined, model: string | undefined) => {
  if (!ep || !model) return 0
  const n = Number(ep.modelContext?.[model])
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function deriveUsage({ logs, lastBy, eps, sel, manualLimit }: UsageSource): Usage {
  const last = logs.length ? logs[logs.length - 1] : undefined
  const entries = (last ?? []).filter(billable)
  // Routing-classifier and auto-effort calls are logged as helper entries
  // (`<name> (classifier)` / `<name> (effort)`). They are billable, but they
  // are not the model that answered, so they must not set the context limit
  // or the header label.
  const main = entries.filter((t) => !/ \((?:classifier|effort)\)$/.test(t.n))
  const first = main[0] ?? entries[0]
  const replyEp = first ? endpointByName(eps, first.n) : undefined
  const selEp = sel?.k === 'ep' ? eps.find((e) => e.id === sel.id) : undefined
  // Max context follows the model: last reply's endpoint/model first, then the
  // current selection, then the manual limit from Appearance settings.
  const limit = contextLimit(replyEp, first?.m) || contextLimit(selEp, sel?.model) || Math.max(1000, manualLimit)

  // Header names the model that answered (display name, not id), preferring a
  // log entry whose model belongs to its endpoint over classifier/effort
  // entries whose `m` is a level or a routing pick.
  const nameEntry = main.find((t) => { const ep = endpointByName(eps, t.n); return !!ep && !!t.m && modelsOf(ep).includes(t.m) }) ?? first
  const nameEp = nameEntry ? endpointByName(eps, nameEntry.n) : undefined
  const modelLabel = nameEp && nameEntry?.m ? modelNameOf(nameEp, nameEntry.m) : lastBy

  let tin = 0, tout = 0, cacheRead = 0, cacheWrite = 0, reported = 0
  for (const t of entries) {
    tin += t.tin ?? 0
    tout += t.tout ?? 0
    cacheRead += t.cacheRead ?? 0
    cacheWrite += t.cacheWrite ?? 0
    reported += t.cost ?? 0
  }
  // Prefer provider-reported spend for the reply; fall back to the price
  // table only when the provider reported none at all.
  const priced = tin > 0 || tout > 0 ? entries.reduce((a, t) => a + costOf(eps, t), 0) : 0
  const replyCost = reported > 0 ? reported : priced

  // Whole-chat cost: every logged entry in the chat (not just the last reply),
  // per entry preferring reported spend and falling back to the price table.
  let chatCost = 0
  for (const log of logs) for (const t of log) if (billable(t)) chatCost += costOf(eps, t)

  const tok = tin + tout
  return {
    hasReply: entries.length > 0,
    tok,
    limit,
    pct: Math.max(0, Math.min(1, tok / limit)),
    over: tok > limit,
    tin,
    tout,
    cacheRead,
    cacheWrite,
    uncached: Math.max(0, tin - cacheRead - cacheWrite),
    replyCost,
    chatCost,
    modelLabel,
  }
}
