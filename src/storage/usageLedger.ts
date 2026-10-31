/* The permanently kept usage ledger.
 *
 * Usage the Stats page shows used to live only on assistant messages, so a
 * deleted, archived-away or expiry-pruned chat took its tokens and cost with
 * it. Each attempt is now also written here, keyed by its own localStorage
 * entry, and is never pruned when the chat goes away.
 *
 * It is deliberately *not* part of the zustand persist payload: that payload is
 * rewritten whenever settings or chats change (dozens of times a second while
 * a reply streams), and a growing ledger would be serialised on every write.
 * This key changes only when an attempt is added or the history is cleared.
 *
 * Rows are capped (see MAX_USAGE_ROWS) so statistics cannot fill the storage
 * chat history needs; under quota pressure the oldest half is dropped, matching
 * how chats are compacted rather than failing the whole write.
 */

import { reportStorageFailure } from '../persistence'
import { MAX_USAGE_ROWS, normUsageRows, normUsageTitles, type UsageRow } from '../usageStats'

export const USAGE_LEDGER_KEY = 'byok.v1:usage'
const LEDGER_VERSION = 1

export type UsageLedger = {
  rows: UsageRow[]
  /** Best-known title per kept chat id, so a deleted chat still has a label. */
  titles: Record<string, string>
}

const empty = (): UsageLedger => ({ rows: [], titles: {} })

const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch { return null }
}

/** Load the ledger at store creation. Unreadable data is treated as no data:
 *  statistics are derived, so a corrupt ledger must not block startup. */
export function readUsageLedger(): UsageLedger {
  const ls = store()
  if (!ls) return empty()
  try {
    const raw = ls.getItem(USAGE_LEDGER_KEY)
    if (!raw) return empty()
    const parsed: unknown = JSON.parse(raw)
    const file = parsed && typeof parsed === 'object' ? (parsed as { rows?: unknown; titles?: unknown }) : {}
    return { rows: normUsageRows(file.rows), titles: normUsageTitles(file.titles) }
  } catch { return empty() }
}

/** Whether this browser has ever written the ledger. A missing key on an
 *  existing install is the signal to seed from the chats it already has. */
export function usageLedgerExists(): boolean {
  const ls = store()
  if (!ls) return false
  try { return ls.getItem(USAGE_LEDGER_KEY) != null } catch { return false }
}

/** Persist the ledger and report which rows actually fit. A quota failure
 *  drops the oldest half once, then surfaces the storage warning instead of
 *  silently promising history that is not saved. */
export function writeUsageLedger(rows: UsageRow[], titles: Record<string, string>): UsageRow[] {
  const ls = store()
  if (!ls) return rows
  const put = (kept: UsageRow[]): boolean => {
    try {
      ls.setItem(USAGE_LEDGER_KEY, JSON.stringify({ v: LEDGER_VERSION, rows: kept, titles }))
      return true
    } catch { return false }
  }
  if (put(rows)) return rows
  const half = rows.slice(-Math.max(1, Math.floor(rows.length / 2)))
  if (half.length < rows.length && put(half)) return half
  reportStorageFailure()
  return rows
}

export { MAX_USAGE_ROWS }
