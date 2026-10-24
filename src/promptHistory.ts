/* Sent-message history for the composer.
 *
 * The ↑/↓ prompt-recall feature needs the list of messages sent this session.
 * It is deliberately module-level and not part of the store: it is runtime
 * state only (like the live streaming buffers), must not ride device sync or
 * persistence, and a reload resetting it matches every mainstream chat client.
 */

const MAX_HISTORY = 100

const history: string[] = []

/** Add a sent message. Empty drafts are never recorded, and an immediate
 *  resend of the newest entry does not duplicate it. */
export function pushPromptHistory(text: string): void {
  const value = text.trim()
  if (!value) return
  if (history.length && history[history.length - 1] === value) return
  history.push(value)
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
}

/** Newest-last snapshot for navigation. A copy, so callers cannot mutate it. */
export function getPromptHistory(): string[] {
  return [...history]
}

/** Number of entries currently recorded. */
export function promptHistoryDepth(): number {
  return history.length
}
