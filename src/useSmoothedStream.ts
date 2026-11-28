import { useEffect, useRef, useState } from 'react'
import { releaseTo, wordCount } from './replyFade'

/* Pacing for a reply that is still arriving.
 *
 * Provider chunks land in bursts (a whole paragraph at once, then nothing for
 * 300 ms), and fading a burst in as one block reads as a flash, not as writing.
 * This hook turns the received text into the text that is allowed on screen:
 * it releases it a frame at a time, always ending on a word boundary, so a
 * word that has just faded in is never rewritten while it animates.
 *
 * The rate adapts to the backlog: a quiet stream releases a word a frame, a
 * burst releases ~15% of what is still owed per frame and catches up in a few
 * frames. Nothing runs while the reply is idle — the loop stops as soon as the
 * received text has been released, and is restarted by the next chunk.
 */

/** Share of the unreleased words released per frame while catching up. */
const CATCH_UP = 0.15
/** How long a trailing, still-open word may stay hidden before it is shown. */
const IDLE_MS = 200

/** A monotonic clock that also exists where the hook is rendered outside a
 *  browser (the module is imported by tests through no DOM at all). */
const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now())

export function useSmoothedStream(full: string, { pace, done = false, resume = false }: { pace: boolean; done?: boolean; resume?: boolean }): string {
  // Without pacing the text is shown as it arrives (no state, no frame); with
  // it, the first paint starts empty and the buffer fills in. `resume` is for a
  // reply that is mounted again while it is still arriving: what was already on
  // screen stays on screen, and only the words that arrive next are paced,
  // instead of replaying the whole reply from nothing.
  const [released, setReleased] = useState(() => (pace && !resume ? '' : full))
  const text = useRef(full)
  const at = useRef(pace && !resume ? 0 : full.length)
  const grewAt = useRef(now())
  text.current = full

  useEffect(() => {
    if (!pace) return
    let raf = 0
    let timer = 0

    const step = () => {
      raf = 0
      const s = text.current
      // A retried or rewritten reply can hand us a shorter buffer; the release
      // point has to stay inside it.
      if (at.current > s.length) {
        at.current = s.length
        grewAt.current = now()
        setReleased(s)
        return
      }
      if (at.current >= s.length) return
      // The stream has ended: show everything at once rather than keep the
      // reader waiting for the buffer to catch up.
      if (done) {
        at.current = s.length
        grewAt.current = now()
        setReleased(s)
        return
      }
      const words = Math.max(1, Math.ceil(wordCount(s, at.current) * CATCH_UP))
      const target = releaseTo(s, at.current, words)
      if (target > at.current) {
        at.current = target
        grewAt.current = now()
        setReleased(s.slice(0, target))
        if (target < s.length) raf = requestAnimationFrame(step)
        return
      }
      /* Only a partial word is left. It is held back until whitespace follows
       * it (the next chunk schedules another frame), which is what keeps a word
       * from being shown half-written and then extended. A stream that stops
       * mid-word must not leave that word invisible, though — and must not keep
       * waking up to look at it either — so once the pause outlasts one fade the
       * word is shown as it stands; the rest of it extends the same span when
       * it arrives. */
      const wait = IDLE_MS - (now() - grewAt.current)
      if (wait > 0) {
        timer = window.setTimeout(() => {
          timer = 0
          raf = requestAnimationFrame(step)
        }, wait + 16)
        return
      }
      at.current = s.length
      grewAt.current = now()
      setReleased(s)
    }

    if (at.current !== text.current.length) raf = requestAnimationFrame(step)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
    }
  }, [full, pace, done])

  return pace ? released : full
}
