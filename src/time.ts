/* Timestamp formatting for message bylines.
 *
 * Deliberately locale-independent: a chat time reads the same everywhere, and
 * the format stays testable. Today shows just the clock; past days add the
 * date; another year adds the year. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

/** `14:05` — the 24-hour clock used in both the short and long forms. */
export const clockOf = (at: number): string => {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Compact form for the byline: `14:05`, `4 Mar, 14:05`, `4 Mar 2025, 14:05`. */
export function formatMsgTime(at: number | undefined, now = Date.now()): string {
  if (at == null || !Number.isFinite(at)) return ''
  const d = new Date(at)
  const n = new Date(now)
  const time = clockOf(at)
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return time
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() === n.getFullYear() ? `${day}, ${time}` : `${day} ${d.getFullYear()}, ${time}`
}

/** Full form for the `title` tooltip: always carries the date and year. */
export function formatMsgDateTime(at: number | undefined): string {
  if (at == null || !Number.isFinite(at)) return ''
  const d = new Date(at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clockOf(at)}`
}
