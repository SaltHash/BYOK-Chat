import type { FadeEvent } from './store'

/* Fade-in events are stamped with page-relative performance.now() timestamps,
 * so they are only meaningful inside the session that produced them. After a
 * reload (or when stale data is restored from durable storage) an event's `at`
 * can be far in the "future" relative to the new page's clock; animating those
 * words would leave them stuck at opacity 0 until the clock catches up.
 * Keep only events that belong to the current fade window: age >= 0 and within
 * the duration. Pure + unit-testable. */
export function activeFadeEvents(events: FadeEvent[] | null | undefined, now: number, durationMs: number): FadeEvent[] {
  if (!(durationMs > 0) || !Array.isArray(events) || !events.length) return []
  return events.filter((e) => {
    const age = now - e.at
    return age >= 0 && age < durationMs
  })
}
