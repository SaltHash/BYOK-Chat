/* Pure usage-dashboard derivation.
 *
 * Everything the Stats page shows is derived here from the attempt logs that
 * are already saved with each assistant message plus the endpoint price tables.
 * Nothing in this module reads the lifetime counters in `s.stats`: those have no
 * time or model dimensions and stay a separate, all-time block.
 *
 * Time rules:
 *  - A custom range is inclusive of its "Through" date, so the half-open end is
 *    midnight after it. Every other period ends at infinity.
 *  - Attempts without `at` inherit their owning message's timestamp, matching
 *    `groupUsage` in usage.ts.
 *  - Duplicate cached tokens are never counted: `uncached` already excludes
 *    cache reads/writes (OpenAI-shaped usage), so total = the four parts once.
 */

import type { Attempt, Chat, Ep } from './store'
import { modelNameOf } from './models'
import { allAttemptAts, allAttemptLogs, attemptCost, endpointNameOf, usageRange, type UsageGroup } from './usage'

export type UsagePeriod = 'session' | 'day' | 'week' | 'month' | 'all' | 'custom'

export const USAGE_PERIODS: [UsagePeriod, string][] = [
  ['session', 'Session'],
  ['day', 'Last 24 hours'],
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days'],
  ['all', 'All time'],
  ['custom', 'Custom'],
]

export const periodLabel = (p: UsagePeriod | string): string => USAGE_PERIODS.find(([k]) => k === p)?.[1] ?? 'All time'

export type StatsRange = {
  start: number
  /** Exclusive. Infinity for every period except a custom Through date. */
  end: number
  period: UsagePeriod
  /** A custom range whose dates do not parse or whose Through is before From. */
  invalid: boolean
}

const isPeriod = (p: unknown): p is UsagePeriod => USAGE_PERIODS.some(([k]) => k === p)

const validDate = (s: string): boolean => Number.isFinite(new Date(s).getTime())

/** Page-wide period window, backed by the same usageRange the widget uses.
 *  Invalid custom ranges are reported, never silently coerced into "all". */
export function statsRange({ period, from, to, now = Date.now() }: { period?: string; from?: string; to?: string; now?: number }): StatsRange {
  const p: UsagePeriod = isPeriod(period) ? period : 'all'
  if (p !== 'custom') {
    const { start, end } = usageRange({ period: p, now })
    return { start, end, period: p, invalid: false }
  }
  const f = (from ?? '').trim()
  const t = (to ?? '').trim()
  const badFrom = !!f && (!validDate(f) || !/^\d{4}-\d{2}-\d{2}$/.test(f))
  const badTo = !!t && (!validDate(t) || !/^\d{4}-\d{2}-\d{2}$/.test(t))
  // ISO date strings compare chronologically, so no timezone is involved.
  const reversed = !!f && !!t && !badFrom && !badTo && f > t
  const invalid = badFrom || badTo || reversed
  if (invalid) return { start: 0, end: 0, period: p, invalid: true }
  const { start, end } = usageRange({ period: 'custom', from: f, to: t, now })
  return { start, end, period: p, invalid: false }
}

/** Half-open membership test ([start, end)). */
export const inRange = (at: number, range: StatsRange): boolean => !range.invalid && at >= range.start && at < range.end

export type TokenBreakdown = {
  /** Uncached prompt tokens (`tin` already excludes cached input). */
  uncached: number
  cacheRead: number
  cacheWrite: number
  output: number
  total: number
}

export type UsageRecord = {
  at: number
  chatId: string
  chatTitle: string
  messageId: string
  /** False when the owning chat no longer exists, so Activity cannot jump to
   *  it. Undefined for callers that did not supply the live chat list. */
  available?: boolean
  endpointId: string
  endpointName: string
  modelId: string
  modelLabel: string
  failed: boolean
  tokens: TokenBreakdown
  cost: number | null
  estimated: boolean
}

const count = (n: unknown): number => {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : 0
}

export const tokensOf = (a: Attempt): TokenBreakdown => {
  const uncached = count(a.tin)
  const cacheRead = count(a.cacheRead)
  const cacheWrite = count(a.cacheWrite)
  const output = count(a.tout)
  return { uncached, cacheRead, cacheWrite, output, total: uncached + cacheRead + cacheWrite + output }
}

const ZERO_TOKENS = (): TokenBreakdown => ({ uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 })

const addTokens = (a: TokenBreakdown, b: TokenBreakdown): TokenBreakdown => ({
  uncached: a.uncached + b.uncached,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
  total: a.total + b.total,
})

/** One encoded context per entry of `allAttemptLogs`, index-aligned. Keeping
 *  the chat/message lookup as strings lets the component subscribe narrowly:
 *  a streamed text chunk replaces message text but not these values. */
export function attemptContexts(chats: Chat[]): string[] {
  const out: string[] = []
  for (const chat of chats) for (const m of chat.msgs) {
    if (!m.log?.length) continue
    out.push(JSON.stringify([chat.id, chat.title ?? '', m.id, m.at ?? 0]))
  }
  return out
}

const decodeContext = (raw: string | undefined): [string, string, string, number] =>
  (() => {
    try {
      const j = JSON.parse(raw ?? '')
      return Array.isArray(j)
        ? [String(j[0] ?? ''), String(j[1] ?? ''), String(j[2] ?? ''), count(j[3])]
        : ['', '', '', 0]
    } catch {
      return ['', '', '', 0]
    }
  })()

/** Build the normalized dashboard records from attempt logs. Endpoint names are
 *  cleaned with `endpointNameOf`, so classifier/effort helper calls (real spend)
 *  resolve to the endpoint the user configured. Removed endpoints and unknown
 *  models are kept, labelled rather than dropped. */
export function buildUsageRecordsFrom(logs: Attempt[][], ats: number[], contexts: string[], eps: Ep[]): UsageRecord[] {
  const out: UsageRecord[] = []
  for (let i = 0; i < logs.length; i++) {
    const [chatId, chatTitle, messageId, messageAt] = decodeContext(contexts[i])
    const fallback = ats[i] ?? messageAt
    for (const t of logs[i]) {
      const at = Number.isFinite(t.at) ? (t.at as number) : (Number.isFinite(fallback) ? fallback : 0)
      const ep = eps.find((e) => e.name === endpointNameOf(t.n))
      const modelId = typeof t.m === 'string' ? t.m : ''
      const priced = attemptCost(eps, t)
      out.push({
        at,
        chatId,
        chatTitle,
        messageId,
        endpointId: ep?.id ?? '',
        endpointName: ep?.name ?? 'Unknown endpoint',
        modelId,
        modelLabel: ep && modelId ? modelNameOf(ep, modelId) : modelId || 'Unknown model',
        failed: !!t.err,
        tokens: tokensOf(t),
        cost: priced.cost,
        estimated: priced.estimated,
      })
    }
  }
  return out
}

/* ---- permanently kept usage history ----
 *
 * The dashboard used to derive everything from the attempt logs stored on
 * assistant messages, so deleting a chat (or letting a temporary one expire)
 * took its detailed usage with it. Every attempt is therefore also copied into
 * a small ledger in this browser as soon as a reply finishes. The ledger is
 * never pruned when its chat goes away; only the storage quota or the explicit
 * cap can shorten it.
 *
 * Rows are the compact, serialisable form of one attempt: no message text, no
 * tool payloads, nothing that could identify the conversation beyond its id and
 * a best-known title. */

export type UsageRow = {
  at: number
  chatId: string
  messageId: string
  /** Endpoint name as logged; helper suffixes (`(classifier)`, `(effort)`) stay. */
  endpoint: string
  model: string
  tin: number
  tout: number
  cacheRead: number
  cacheWrite: number
  /** Provider-reported spend; 0 when the provider reported none. */
  cost: number
  /** Failed attempts count as attempts but never as usage. */
  failed?: true
}

/** Attempts kept per browser. Unlike chat history this is deliberately
 *  bounded: a ledger that grows forever would eventually crowd out chats in
 *  the same storage, and every row past the newest MAX_USAGE_ROWS is older
 *  history the dashboard can no longer show anyway. */
export const MAX_USAGE_ROWS = 12000

/** Identity of one attempt, so a ledger copy and the same attempt still on its
 *  message never count twice. */
export const usageRowKey = (r: UsageRow): string =>
  `${r.chatId}\u0000${r.messageId}\u0000${r.at}\u0000${r.failed ? 1 : 0}\u0000${r.endpoint}\u0000${r.model}\u0000${r.tin}\u0000${r.tout}\u0000${r.cacheRead}\u0000${r.cacheWrite}\u0000${r.cost}`

/** One attempt as a kept row. Tokens and timestamps are clamped exactly like
 *  the dashboard clamps them, so a malformed value cannot poison the ledger. */
export function usageRowOf(chatId: string, messageId: string, t: Attempt, fallbackAt: number): UsageRow {
  const fallback = Number.isFinite(fallbackAt) ? fallbackAt : 0
  const at = Number.isFinite(t.at) ? (t.at as number) : fallback
  return {
    at,
    chatId: String(chatId),
    messageId: String(messageId),
    endpoint: String(t.n ?? ''),
    model: String(t.m ?? ''),
    tin: count(t.tin),
    tout: count(t.tout),
    cacheRead: count(t.cacheRead),
    cacheWrite: count(t.cacheWrite),
    cost: count(t.cost),
    ...(t.err ? { failed: true as const } : {}),
  }
}

/** Rows for every attempt already saved with these chats, oldest first. Used
 *  to seed the ledger for installs that predate it. */
export function usageRowsFromChats(chats: Chat[]): UsageRow[] {
  const out: UsageRow[] = []
  for (const chat of chats) for (const m of chat.msgs) {
    if (!m.log?.length) continue
    for (const t of m.log) out.push(usageRowOf(chat.id, m.id, t, m.at ?? 0))
  }
  // Chats are stored newest-first; the ledger is kept oldest-first so the cap
  // and the "kept since" label refer to the oldest kept attempt.
  out.sort((a, b) => a.at - b.at)
  return out.length > MAX_USAGE_ROWS ? out.slice(out.length - MAX_USAGE_ROWS) : out
}

export function usageTitlesFromChats(chats: Chat[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chat of chats) if (chat.title) out[chat.id] = chat.title
  return out
}

/** Add rows the ledger does not hold yet and keep the newest MAX_USAGE_ROWS.
 *  Returns the input array unchanged when nothing was added, so callers can
 *  skip a write. */
export function appendUsageRows(existing: UsageRow[], added: UsageRow[]): UsageRow[] {
  if (!added.length) return existing
  const seen = new Set(existing.map(usageRowKey))
  const fresh: UsageRow[] = []
  for (const row of added) {
    const key = usageRowKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push(row)
  }
  if (!fresh.length) return existing
  const out = [...existing, ...fresh]
  return out.length > MAX_USAGE_ROWS ? out.slice(out.length - MAX_USAGE_ROWS) : out
}

/** Read back a stored ledger defensively: anything unreadable is dropped
 *  rather than trusted, and the cap applies to persisted data too. */
export function normUsageRows(v: unknown): UsageRow[] {
  if (!Array.isArray(v)) return []
  const out: UsageRow[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const r = raw as Record<string, unknown>
    if (typeof r.chatId !== 'string' || typeof r.messageId !== 'string') continue
    const at = Number(r.at)
    if (!Number.isFinite(at)) continue
    out.push({
      at,
      chatId: r.chatId,
      messageId: r.messageId,
      endpoint: typeof r.endpoint === 'string' ? r.endpoint : '',
      model: typeof r.model === 'string' ? r.model : '',
      tin: count(r.tin),
      tout: count(r.tout),
      cacheRead: count(r.cacheRead),
      cacheWrite: count(r.cacheWrite),
      cost: count(r.cost),
      ...(r.failed === true ? { failed: true as const } : {}),
    })
  }
  return out.length > MAX_USAGE_ROWS ? out.slice(out.length - MAX_USAGE_ROWS) : out
}

/** Chat titles are best-effort labels for chats that may no longer exist. */
export function normUsageTitles(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [id, title] of Object.entries(v)) if (id && typeof title === 'string' && title) out[id] = title.slice(0, 80)
  return out
}

/** Kept rows plus any attempt still present on a live chat, deduplicated and
 *  ordered oldest first. The ledger is the long-lived source; live attempts
 *  only fill gaps (a chat restored from sync, or a log written before the
 *  ledger existed) so nothing is counted twice. */
export function collectUsageRows(ledger: UsageRow[], logs: Attempt[][], ats: number[], contexts: string[]): UsageRow[] {
  const rows: UsageRow[] = []
  const seen = new Set<string>()
  // A ledger restored from two sources (or written by two paths before it was
  // deduplicated) must still count each attempt once.
  for (const row of ledger) {
    const key = usageRowKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  for (let i = 0; i < logs.length; i++) {
    const [chatId, , messageId, messageAt] = decodeContext(contexts[i])
    const fallback = Number.isFinite(ats[i]) ? ats[i] : messageAt
    for (const t of logs[i]) {
      const row = usageRowOf(chatId, messageId, t, fallback)
      const key = usageRowKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
  }
  return rows.sort((a, b) => a.at - b.at)
}

/** Same roll-up as `groupUsage` in usage.ts, but from kept rows so the Usage
 *  widget keeps counting usage whose chat no longer exists. */
export function groupUsageRows(rows: UsageRow[], group: string | undefined, range: { start: number; end: number }): UsageGroup[] {
  const grouped = new Map<string, UsageGroup>()
  for (const r of rows) {
    if (r.at < range.start || r.at > range.end) continue
    const endpoint = endpointNameOf(r.endpoint)
    const key = group === 'model' ? `${endpoint} · ${r.model || 'unknown model'}` : endpoint
    const v = grouped.get(key) ?? { key, ok: 0, bad: 0, tin: 0, tout: 0 }
    if (r.failed) v.bad++
    else v.ok++
    v.tin += r.tin
    v.tout += r.tout
    grouped.set(key, v)
  }
  return [...grouped.values()]
}

/** Dashboard records for kept rows. `titles` supplies the best-known name for
 *  every chat (live chats override it); `live` marks which chats still exist
 *  so Activity only offers a jump that can work. */
export function buildRecordsFromRows(rows: UsageRow[], eps: Ep[], titles: Record<string, string> = {}, live?: Set<string>): UsageRecord[] {
  return rows.map((r) => {
    const ep = eps.find((e) => e.name === endpointNameOf(r.endpoint))
    const priced = attemptCost(eps, { n: r.endpoint, m: r.model, tin: r.tin, tout: r.tout, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, cost: r.cost })
    return {
      at: r.at,
      chatId: r.chatId,
      chatTitle: titles[r.chatId] ?? '',
      messageId: r.messageId,
      ...(live ? { available: live.has(r.chatId) } : {}),
      endpointId: ep?.id ?? '',
      endpointName: ep?.name ?? 'Unknown endpoint',
      modelId: r.model,
      modelLabel: ep && r.model ? modelNameOf(ep, r.model) : r.model || 'Unknown model',
      failed: r.failed === true,
      tokens: tokensOf({ n: r.endpoint, m: r.model, tin: r.tin, tout: r.tout, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite }),
      cost: priced.cost,
      estimated: priced.estimated,
    }
  })
}

/** The Stats page's single entry point: kept history merged with the attempts
 *  still stored on live chats. Chat titles prefer the live title and fall back
 *  to the last title seen before a chat was removed. */
export function buildUsageRecordsFromHistory(input: {
  ledger: UsageRow[]
  titles?: Record<string, string>
  logs: Attempt[][]
  ats: number[]
  contexts: string[]
  eps: Ep[]
  chats: Chat[]
}): UsageRecord[] {
  const titles = { ...(input.titles ?? {}), ...usageTitlesFromChats(input.chats) }
  const live = new Set(input.chats.map((c) => c.id))
  return buildRecordsFromRows(collectUsageRows(input.ledger, input.logs, input.ats, input.contexts), input.eps, titles, live)
}

/** Convenience wrapper used by tests and any caller that has full chats. */
export function buildUsageRecords(chats: Chat[], eps: Ep[]): UsageRecord[] {
  return buildUsageRecordsFrom(allAttemptLogs(chats), allAttemptAts(chats), attemptContexts(chats), eps)
}

export const isBillable = (r: UsageRecord): boolean => !r.failed

export function recordsInRange(records: UsageRecord[], range: StatsRange): UsageRecord[] {
  if (range.invalid) return []
  return records.filter((r) => inRange(r.at, range))
}

export const modelKey = (endpointId: string, modelId: string): string => `${endpointId}::${modelId}`

export type ModelUsage = {
  key: string
  endpointId: string
  endpointName: string
  modelId: string
  modelLabel: string
  /** Display label plus endpoint, used for search and tertiary sorting. */
  label: string
  tokens: TokenBreakdown
  requests: number
  failed: number
  cost: number
  /** Provider-reported and price-table portions of `cost`. */
  recordedCost: number
  estimatedCost: number
  /** Any included cost came from the price table rather than the provider. */
  estimated: boolean
  pricedTokens: number
  unpricedTokens: number
  pricedRequests: number
  /** Cost per million priced tokens; null when nothing is priced. */
  average: number | null
  /** Share of the period's billable tokens; null when the period has none. */
  share: number | null
  firstUsed: number
  lastUsed: number
}

export function aggregateModels(records: UsageRecord[]): ModelUsage[] {
  const billable = records.filter(isBillable)
  const totalTokens = billable.reduce((n, r) => n + r.tokens.total, 0)
  const map = new Map<string, ModelUsage>()
  for (const r of billable) {
    const key = modelKey(r.endpointId, r.modelId)
    const row = map.get(key) ?? {
      key, endpointId: r.endpointId, endpointName: r.endpointName, modelId: r.modelId, modelLabel: r.modelLabel,
      label: `${r.modelLabel} · ${r.endpointName}`,
      tokens: ZERO_TOKENS(), requests: 0, failed: 0, cost: 0, recordedCost: 0, estimatedCost: 0, estimated: false,
      pricedTokens: 0, unpricedTokens: 0, pricedRequests: 0, average: null, share: null,
      firstUsed: r.at, lastUsed: r.at,
    }
    row.tokens = addTokens(row.tokens, r.tokens)
    row.requests++
    if (r.cost != null) {
      row.cost += r.cost
      row.pricedTokens += r.tokens.total
      row.pricedRequests++
      if (r.estimated) { row.estimated = true; row.estimatedCost += r.cost } else row.recordedCost += r.cost
    } else {
      row.unpricedTokens += r.tokens.total
    }
    row.firstUsed = Math.min(row.firstUsed, r.at)
    row.lastUsed = Math.max(row.lastUsed, r.at)
    map.set(key, row)
  }
  // Failed counts are per model too (the model detail lists them), but a model
  // with only failures is not a ranking row.
  for (const r of records) if (r.failed) {
    const row = map.get(modelKey(r.endpointId, r.modelId))
    if (row) row.failed++
  }
  const rows = [...map.values()]
  for (const row of rows) {
    row.average = row.pricedTokens > 0 ? row.cost / row.pricedTokens * 1_000_000 : null
    row.share = totalTokens > 0 ? row.tokens.total / totalTokens : null
  }
  return rows
}

export type ModelSortKey = 'model' | 'tokens' | 'share' | 'requests' | 'cost' | 'average' | 'lastUsed'

/** Stable ordering: the chosen column first, then the documented default
 *  tie-breakers (tokens, cost, label). */
export function sortModels(rows: ModelUsage[], key: ModelSortKey = 'tokens', dir: 'asc' | 'desc' = 'desc'): ModelUsage[] {
  const primary = (a: ModelUsage, b: ModelUsage): number => {
    switch (key) {
      case 'model': return a.label.localeCompare(b.label)
      case 'tokens': return a.tokens.total - b.tokens.total
      case 'share': return (a.share ?? -1) - (b.share ?? -1)
      case 'requests': return a.requests - b.requests
      case 'cost': return a.cost - b.cost
      case 'average': return (a.average ?? -1) - (b.average ?? -1)
      case 'lastUsed': return a.lastUsed - b.lastUsed
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => sign * primary(a, b)
    || b.tokens.total - a.tokens.total
    || b.cost - a.cost
    || a.label.localeCompare(b.label))
}

export type UsageSummary = {
  /** Every attempt in the window, failures included. */
  attempts: number
  /** Billable attempts (the ones every metric uses). */
  requests: number
  failed: number
  totalCost: number
  recordedCost: number
  estimatedCost: number
  estimated: boolean
  totalTokens: number
  pricedTokens: number
  unpricedTokens: number
  pricedRequests: number
  unpricedRequests: number
  /** totalCost / pricedTokens * 1,000,000, or null when nothing is priced. */
  average: number | null
  tokens: TokenBreakdown
  models: ModelUsage[]
  mostUsed?: ModelUsage
  firstUsed: number | null
  lastUsed: number | null
}

export function summarize(records: UsageRecord[]): UsageSummary {
  const billable = records.filter(isBillable)
  const models = aggregateModels(records)
  const tokens = billable.reduce((a, r) => addTokens(a, r.tokens), ZERO_TOKENS())
  let totalCost = 0, recordedCost = 0, estimatedCost = 0, pricedTokens = 0, unpricedTokens = 0
  let pricedRequests = 0, unpricedRequests = 0, estimated = false
  for (const r of billable) {
    if (r.cost != null) {
      totalCost += r.cost
      pricedTokens += r.tokens.total
      pricedRequests++
      if (r.estimated) { estimated = true; estimatedCost += r.cost } else recordedCost += r.cost
    } else {
      unpricedTokens += r.tokens.total
      unpricedRequests++
    }
  }
  const sorted = sortModels(models, 'tokens', 'desc')
  return {
    attempts: records.length,
    requests: billable.length,
    failed: records.length - billable.length,
    totalCost,
    recordedCost,
    estimatedCost,
    estimated,
    totalTokens: tokens.total,
    pricedTokens,
    unpricedTokens,
    pricedRequests,
    unpricedRequests,
    average: pricedTokens > 0 ? totalCost / pricedTokens * 1_000_000 : null,
    tokens,
    models: sorted,
    mostUsed: sorted[0],
    firstUsed: billable.length ? Math.min(...billable.map((r) => r.at)) : null,
    lastUsed: billable.length ? Math.max(...billable.map((r) => r.at)) : null,
  }
}

export const findModel = (rows: ModelUsage[], key: string): ModelUsage | undefined => rows.find((m) => m.key === key)

/* ---- chart bucketing ---- */

export type BucketUnit = 'hour' | 'day' | 'week' | 'month'

export const BUCKET_LABEL: Record<BucketUnit, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' }

export function bucketUnitFor(range: StatsRange, now = Date.now()): BucketUnit {
  if (range.period === 'all') return 'month'
  const end = Number.isFinite(range.end) ? range.end : now
  const span = Math.max(0, end - range.start)
  if (span <= 48 * 3_600_000) return 'hour'
  if (span <= 90 * 86_400_000) return 'day'
  return 'week'
}

/** Local calendar floors, so a bucket label matches the user's clock. */
export function bucketStart(at: number, unit: BucketUnit): number {
  const d = new Date(at)
  if (unit === 'hour') { d.setMinutes(0, 0, 0); return d.getTime() }
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (unit === 'week') {
    const dow = (new Date(day).getDay() + 6) % 7 // Monday = 0
    return day - dow * 86_400_000
  }
  return day
}

export function nextBucket(start: number, unit: BucketUnit): number {
  const d = new Date(start)
  if (unit === 'hour') return start + 3_600_000
  if (unit === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  if (unit === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime()
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
}

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const fmtDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
const fmtDayYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export const formatDateTime = (at: number): string =>
  `${fmtDayYear.format(at)}, ${fmtTime.format(at)}`

export const formatDate = (at: number): string => fmtDayYear.format(at)

export const formatDay = (at: number): string => fmtDay.format(at)

export const formatDayTime = (at: number): string => `${fmtDay.format(at)} ${fmtTime.format(at)}`

export function bucketLabel(start: number, unit: BucketUnit): string {
  if (unit === 'hour') return fmtTime.format(start)
  if (unit === 'month') return fmtMonth.format(start)
  return fmtDay.format(start)
}

export type Bucket = {
  start: number
  end: number
  label: string
  requests: number
  tokens: TokenBreakdown
  cost: number
  costKnown: boolean
  estimated: boolean
  byCategory: { uncached: number; cacheRead: number; cacheWrite: number; output: number }
  byModel: Record<string, { tokens: number; cost: number }>
}

/** Normalised span used by charts. Infinite periods shrink to the data they
 *  contain; an empty infinite period still gets a one-day window. */
export function chartSpan(records: UsageRecord[], range: StatsRange, now = Date.now()): { start: number; end: number; empty: boolean } {
  if (range.invalid) return { start: 0, end: 0, empty: true }
  const times = records.map((r) => r.at)
  const min = times.length ? Math.min(...times) : null
  const max = times.length ? Math.max(...times) : null
  // `all` (and a custom range with no From) spans the recorded data, not 1970.
  const openStart = range.period === 'all' || (range.period === 'custom' && range.start === 0)
  const start = openStart || !Number.isFinite(range.start) ? (min ?? now - 86_400_000) : range.start
  const end = Number.isFinite(range.end) ? range.end : (range.period === 'all' ? (max != null ? max + 1 : start + 1) : Math.max(now, max != null ? max + 1 : now))
  return { start, end: Math.max(start + 1, end), empty: min == null }
}

const MAX_BUCKETS = 600

function generateBuckets(start: number, end: number, unit: BucketUnit): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let t = bucketStart(start, unit)
  // A range that ends exactly on a bucket boundary has no trailing empty bucket.
  while (t < end && out.length < MAX_BUCKETS) {
    const next = nextBucket(t, unit)
    out.push({ start: t, end: next })
    t = next
  }
  if (!out.length) out.push({ start, end: start + 1 })
  return out
}

/** Buckets cover the chart span and contain every billable record exactly once,
 *  so summed series always equal the period summary. */
export function chartBuckets(records: UsageRecord[], range: StatsRange, unit: BucketUnit = bucketUnitFor(range), now = Date.now()): Bucket[] {
  const span = chartSpan(records, range, now)
  if (range.invalid) return []
  const billable = records.filter(isBillable)
  let u = unit
  let raw = generateBuckets(span.start, span.end, u)
  // Pathological custom ranges (a thousand years at weekly granularity) would
  // build an enormous DOM; monthly clauses keep the chart readable instead.
  if (raw.length >= MAX_BUCKETS) { u = 'month'; raw = generateBuckets(span.start, span.end, u) }
  const buckets: Bucket[] = raw.map((b) => ({
    ...b,
    label: bucketLabel(b.start, u),
    requests: 0,
    tokens: ZERO_TOKENS(),
    cost: 0,
    costKnown: false,
    estimated: false,
    byCategory: { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    byModel: {},
  }))
  const first = buckets[0].start
  for (const r of billable) {
    if (r.at < first) continue
    const idx = buckets.findIndex((b) => r.at >= b.start && r.at < b.end)
    if (idx < 0) continue
    const b = buckets[idx]
    b.requests++
    b.tokens = addTokens(b.tokens, r.tokens)
    b.byCategory.uncached += r.tokens.uncached
    b.byCategory.cacheRead += r.tokens.cacheRead
    b.byCategory.cacheWrite += r.tokens.cacheWrite
    b.byCategory.output += r.tokens.output
    const key = modelKey(r.endpointId, r.modelId)
    const m = b.byModel[key] ?? { tokens: 0, cost: 0 }
    m.tokens += r.tokens.total
    if (r.cost != null) {
      b.cost += r.cost
      b.costKnown = true
      m.cost += r.cost
      if (r.estimated) b.estimated = true
    }
    b.byModel[key] = m
  }
  return buckets
}

export function seriesTotals(buckets: Bucket[]) {
  return buckets.reduce((a, b) => ({
    tokens: a.tokens + b.tokens.total,
    cost: a.cost + b.cost,
    requests: a.requests + b.requests,
  }), { tokens: 0, cost: 0, requests: 0 })
}

/* ---- labels and formatting ---- */

/** Readable boundary line under the period controls, e.g.
 *  "27 Sep – 27 Oct 2026 · last 30 days". */
export function rangeLabel(range: StatsRange, records: UsageRecord[], now = Date.now()): string {
  if (range.invalid) return 'Invalid custom range'
  const end = Number.isFinite(range.end) ? range.end - 1 : now
  if (range.period === 'custom') {
    const from = range.start > 0 ? formatDate(range.start) : 'Start'
    const to = Number.isFinite(range.end) ? formatDate(range.end - 1) : 'now'
    return `${from} – ${to} · custom range`
  }
  if (range.period === 'all') {
    if (!records.length) return 'No recorded usage yet'
    const times = records.map((r) => r.at)
    return `${formatDate(Math.min(...times))} – ${formatDate(Math.max(...times))} · all recorded usage`
  }
  if (range.period === 'session') return `${formatDate(range.start)} – now · current session`
  const tail = range.period === 'day' ? 'last 24 hours' : range.period === 'week' ? 'last 7 days' : 'last 30 days'
  return `${fmtDay.format(range.start)} – ${formatDate(end)} · ${tail}`
}

export const fmtInt = (n: number): string => Math.max(0, Math.round(Number(n) || 0)).toLocaleString()

export function compactTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

export function money(n: number | null, decimals: number): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(Math.min(8, Math.max(0, decimals)))}`
}

/** Exact money for title attributes, where rounding should not hide a cost. */
export function moneyExact(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'Cost unavailable'
  return `$${n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`
}

export const sharePct = (share: number | null): string => share == null ? '—' : `${(share * 100).toFixed(1)}%`

export const percentOf = (part: number, whole: number): string => whole > 0 ? `${(part / whole * 100).toFixed(1)}%` : '—'

/** Cost per million tokens for an arbitrary priced subset. */
export function costPerMillion(cost: number, tokens: number): number | null {
  return tokens > 0 ? cost / tokens * 1_000_000 : null
}
