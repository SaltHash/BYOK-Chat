/* Coalescing helpers for high-frequency UI input (pointer drags, sliders).
 *
 * A drag that writes to the store on every `pointermove` triggers a store
 * update, a re-render of every subscriber and (until writes are coalesced) a
 * persistence write per event — far more often than the screen can show.
 * These helpers collapse a burst into the latest value: at most one update
 * per animation frame, plus an explicit `flush()` for the commit point
 * (pointerup) so the final position is never lost.
 *
 * Dependency-free and injectable, so the behaviour is unit-testable in Node
 * without a DOM or a real frame clock. */

export type FrameThrottle<A extends unknown[]> = {
  /** Replace the pending arguments; schedules a frame if none is pending. */
  call: (...args: A) => void
  /** Apply the latest pending arguments immediately, cancelling the frame. */
  flush: () => void
  /** Drop the pending arguments without applying them. */
  cancel: () => void
}

export type FrameThrottleOptions = {
  request?: (fn: () => void) => number
  cancelFrame?: (handle: number) => void
}

const defaultRequest = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16) as unknown as number)
const defaultCancel = (handle: number) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle); else clearTimeout(handle) }

/** One eased step toward a growing container's end.
 *
 * Following the absolute bottom on every frame puts the newly written line
 * exactly on the edge, so a fast stream reads as a series of jumps: the whole
 * distance a burst added lands in a single frame. Moving a share of the
 * remaining gap instead leaves a few pixels of buffer, so text enters from
 * just off the bottom rather than appearing already flush with it. The floor
 * keeps the tail from crawling when the gap is tiny, and the step never
 * overshoots the end (a container that got shorter lands on its new end). */
export function followStep(current: number, target: number, share = 0.3, floor = 1.5): number {
  if (!(target > current)) return target
  return Math.min(target, current + Math.max(floor, (target - current) * share))
}

/** Whether the transcript should keep following the end after a scroll event.
 *
 * `followPos` is the last position the eased follow wrote (or the reader's
 * last known position). A position above it is the reader scrolling up, and
 * it ends the follow at once: waiting until the view left a near-bottom band
 * swallowed small nudges while text kept arriving, so the reader could not
 * get out of the follow without scrolling most of a screen. A position equal
 * to `followPos` is the follow's own write and changes nothing — the view
 * trails the end on purpose, and content can grow past the band between two
 * frames. Returns null when the event is that echo. */
export function stickAfterScroll(scrollTop: number, followPos: number, scrollHeight: number, clientHeight: number, band = 80): boolean | null {
  if (Math.abs(scrollTop - followPos) <= 2) return null
  if (scrollTop < followPos - 2) return false
  return scrollHeight - scrollTop - clientHeight < band
}

/** Latest-value, one-per-frame throttle. */
export function createFrameThrottle<A extends unknown[]>(run: (...args: A) => void, options: FrameThrottleOptions = {}): FrameThrottle<A> {
  const request = options.request ?? defaultRequest
  const cancelFrame = options.cancelFrame ?? defaultCancel
  let handle: number | null = null
  let latest: A | null = null

  const apply = () => {
    const args = latest
    latest = null
    if (args) run(...args)
  }
  const stop = () => {
    if (handle !== null) { cancelFrame(handle); handle = null }
  }

  return {
    call: (...args) => {
      latest = args
      if (handle === null) handle = request(() => { handle = null; apply() })
    },
    flush: () => { stop(); apply() },
    cancel: () => { stop(); latest = null },
  }
}
