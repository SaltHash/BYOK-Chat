/* Centralized error codes shared by client + server search paths.
 * Every provider / network failure carries a stable `code` so UI hints
 * never depend on regex-sniffing raw message strings.
 * Legacy string messages are still classified as a fallback for stored logs. */

export type ErrorCode =
  | 'missing_key'
  | 'missing_zone'
  | 'bad_request'
  | 'upstream_auth'
  | 'billing'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'cors'
  | 'not_found'
  | 'bad_response'
  | 'upstream_unavailable'
  | 'empty_response'
  | 'stopped'
  | 'unknown'

export type CodedError = Error & { code?: ErrorCode; retryable?: boolean; status?: number }

export const withCode = (message: string, code: ErrorCode, extra: { retryable?: boolean; status?: number } = {}): CodedError => {
  const e = Error(message) as CodedError
  e.code = code
  if (typeof extra.retryable === 'boolean') e.retryable = extra.retryable
  if (typeof extra.status === 'number') e.status = extra.status
  return e
}

export const getErrorCode = (e: unknown): ErrorCode | undefined => {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = String((e as { code?: unknown }).code ?? '')
    if (c) return c as ErrorCode
  }
  return undefined
}

/* Classify a raw provider / fetch failure message into a stable code.
 * Used for stored logs that predate coded errors. New code should throw
 * with `withCode()` directly instead of relying on this fallback. */
export const classifyModelError = (message: unknown): ErrorCode => {
  const direct = getErrorCode(message)
  if (direct) return direct
  const t = String(message ?? '')
  if (/Stopped/i.test(t)) return 'stopped'
  if (/CORS|Network or CORS|Connection lost|could not be reached|Failed to fetch|Load failed/i.test(t)) return 'cors'
  if (/HTTP 401|HTTP 403|key was rejected|rejected the API key|unauthorized|forbidden/i.test(t)) return 'upstream_auth'
  if (/HTTP 402|billing/i.test(t)) return 'billing'
  if (/HTTP 429|rate-limit/i.test(t)) return 'rate_limited'
  if (/HTTP 404|Not found/i.test(t)) return 'not_found'
  if (/HTTP 400|HTTP 422|Bad Request/i.test(t)) return 'bad_request'
  if (/HTTP 5\d\d/i.test(t)) return 'upstream_unavailable'
  if (/Empty response/i.test(t)) return 'empty_response'
  if (/timed out|timeout|AbortError/i.test(t)) return 'timeout'
  return 'unknown'
}

const HINTS: Record<ErrorCode, string> = {
  missing_key: '\n\nThe key was rejected. Check it in Settings → Endpoints.',
  missing_zone: '\n\nA required zone / region setting is missing. Check Settings → Tools.',
  bad_request: '\n\nThe request was rejected. Check the base URL and the model id.',
  upstream_auth: '\n\nThe key was rejected. Check it in Settings → Endpoints.',
  billing: '\n\nThe provider reported a billing problem. Check credits / plan, then retry.',
  rate_limited: '\n\nThe provider is rate-limiting requests. Wait a moment and try again.',
  timeout: '\n\nThe request timed out. Check your connection and try again.',
  network: '\n\nNetwork error: check your connection and try again.',
  cors: '\n\nCORS or network error: check the base URL, your connection, and that the server allows browser requests.',
  not_found: '\n\nNot found. Check the base URL and the model id.',
  bad_response: '\n\nThe provider returned an unexpected response. Try again.',
  upstream_unavailable: '\n\nThe provider is temporarily unavailable. Wait a moment and try again.',
  empty_response: '\n\nThe model returned an empty response. Try again.',
  stopped: '',
  unknown: '',
}

export const hintForCode = (code: ErrorCode): string => HINTS[code] ?? ''

/* Replacement for the old regex-based `hint(log)`: prefers structured
 * `Try.errCode`, falls back to classifying legacy `Try.err` strings. */
export type TryLike = { err?: string; errCode?: string }
export const hintForLog = (log: TryLike[]): string => {
  for (const entry of log) {
    const code = (entry.errCode as ErrorCode | undefined) ?? classifyModelError(entry.err ?? '')
    const hint = hintForCode(code)
    if (hint) return hint
  }
  return ''
}
