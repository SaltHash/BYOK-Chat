import { useEffect, useRef, useState } from 'react'

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

/** Number of words in `s`, without allocating the match list. */
function wordCount(s: string): number {
  let n = 0
  let inWord = false
  for (let i = 0; i < s.length; i++) {
    const space = /\s/.test(s[i])
    if (!space && !inWord) n++
    inWord = !space
  }
  return n
}

/** Index just past the last of `limit` complete words at or after `from`.
 *
 *  A word is complete only once whitespace follows it: the last word of the
 *  buffer may still be growing, and releasing it would let the fade-in span be
 *  extended mid-animation. Whitespace on its own is always safe to release. */
function releaseTo(text: string, from: number, limit: number): number {
  let i = from
  let seen = 0
  while (i < text.length && seen < limit) {
    if (/\s/.test(text[i])) { i++; continue }
    let end = i
    while (end < text.length && !/\s/.test(text[end])) end++
    if (end >= text.length) break
    i = end
    seen++
  }
  return i
}

export function useSmoothedStream(full: string, { pace, done = false, resume = false }: { pace: boolean; done?: boolean; resume?: boolean }): string {
  // Without pacing the text is shown as it arrives (batched to a frame below);
  // with it, the first paint starts empty and the buffer fills in. `resume` is
  // for a reply that is mounted again while it is still arriving: what was
  // already on screen stays on screen, and only the words that arrive next are
  // paced and faded, instead of replaying the whole reply from nothing.
  const [released, setReleased] = useState(() => (pace && !resume ? '' : full))
  const text = useRef(full)
  const at = useRef(pace && !resume ? 0 : full.length)
  const grewAt = useRef(typeof performance === 'undefined' ? 0 : performance.now())
  text.current = full

  useEffect(() => {
    let raf = 0
    let timer = 0

    const step = () => {
      raf = 0
      const s = text.current
      const from = at.current
      if (from >= s.length) return
      // The stream has ended: show everything at once rather than keep the
      // reader waiting for the buffer to catch up.
      if (!pace || done) {
        at.current = s.length
        grewAt.current = performance.now()
        setReleased(s)
        return
      }
      const words = Math.max(1, Math.ceil(wordCount(s.slice(from)) * CATCH_UP))
      const target = releaseTo(s, from, words)
      if (target > from) {
        at.current = target
        grewAt.current = performance.now()
        setReleased(s.slice(0, target))
      }
      if (at.current >= s.length) return
      if (releaseTo(s, at.current, 1) > at.current) {
        raf = requestAnimationFrame(step)
        return
      }
      // Only a partial word is left. It is held back until whitespace follows
      // it (the next chunk will schedule another frame), but a stalled stream
      // must not leave the last word invisible: once the pause is longer than
      // one fade, show it.
      const wait = Math.max(0, IDLE_MS - (performance.now() - grewAt.current))
      timer = window.setTimeout(() => { timer = 0; raf = requestAnimationFrame(step) }, wait + 16)
    }

    if (at.current < text.current.length) raf = requestAnimationFrame(step)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
    }
  }, [full, pace, done])

  return released
}
