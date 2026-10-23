/* Sliding-window rate limiting shared by every /api route.
 *
 * A fixed window lets a client send the full allowance at the end of one
 * window and the full allowance again at the start of the next, so the window
 * slides with each request instead. Buckets live in module scope: the Node
 * host runs one process (exact limits), while each Cloudflare isolate keeps
 * its own copy (approximate, bounded by the number of live isolates).
 */

export const RATE_LIMIT = 30
export const RATE_WINDOW_MS = 60_000

function hitsInWindow(bucket, ip, now) {
  const times = bucket.get(ip)
  if (!times) return []
  while (times.length && now - times[0] >= RATE_WINDOW_MS) times.shift()
  return times
}

export function overRateLimit(bucket, ip, now, limit = RATE_LIMIT) {
  return hitsInWindow(bucket, ip, now).length >= limit
}

export function bumpRateLimit(bucket, ip, now) {
  const times = hitsInWindow(bucket, ip, now)
  times.push(now)
  bucket.set(ip, times)
  if (bucket.size > 1000) bucket.delete(bucket.keys().next().value)
}
