/* The decisions behind the reply fade-in, kept out of the renderer so the
 * rules can be read (and tested) without a DOM.
 *
 * One setting drives two different effects. While a reply streams, its words
 * fade in one released word at a time. A reply that finishes before any of
 * those words reached the screen (a fast endpoint, or an answer that arrived
 * inside a single frame) gets one whole-body fade instead. A reply must get
 * one or the other, never both: fading a body whose words already faded turns
 * text the reader is reading transparent and then fades it back in.
 */

/** Milliseconds for the 0–1 "Reply fade-in" setting; 0 turns the fade off. */
export function fadeMsOf(setting: number | null | undefined): number {
  const v = typeof setting === 'number' && Number.isFinite(setting) ? setting : 0
  return v > 0 ? Math.round(Math.min(1, v) * 1000) : 0
}

/** The fade a live segment keeps for as long as it stays mounted.
 *
 *  The streaming text is re-split on every render, so which piece is "the one
 *  still being written" can change under a block that is already on screen.
 *  Handing the renderer a different duration re-parses that block without its
 *  fade spans, and handing the fade back later creates them all again — every
 *  new span replays its animation, so words the reader has already read flash.
 *  The first answer therefore sticks: a piece that was being written when it
 *  appeared fades its new words, and a finished piece never starts fading
 *  afterwards.
 *
 *  `fresh` says the piece's own words arrived with it. It covers the render
 *  that replaces the paced body with pieces around a tool round, and a reply
 *  that is mounted again while it is still streaming (the reader left the chat
 *  and came back): the text those pieces already hold is prose that has been
 *  on screen already, so fading it would take visible text back to
 *  transparent. A piece that appears empty is new writing and fades as it
 *  arrives. */
export function segmentFade(previous: number | undefined, isLast: boolean, fadeMs: number, fresh = true): number {
  if (previous !== undefined) return previous
  return isLast && fresh ? fadeMs : 0
}

/** Duration of the single whole-body fade a just-finished reply gets, or 0 when
 *  it should not fade as a unit: it is still streaming, or its words already
 *  faded in on screen. */
export function arrivalFadeMs(opts: {
  /** The chat went from streaming to idle on this render. */
  finished: boolean
  /** The reply's live body is still mounted (chunks not committed yet). */
  live: boolean
  /** A fading word from this reply was rendered into the page. */
  painted: boolean
  setting: number | null | undefined
}): number {
  if (!opts.finished || opts.live || opts.painted) return 0
  return fadeMsOf(opts.setting)
}

/* ---- pacing: which part of the received text is allowed on screen ----
 *
 * Provider chunks land in bursts, so the paced body releases the buffer a
 * frame at a time. Both scans below run over the unreleased remainder once per
 * frame, which is why they work on char codes and allocate nothing.
 */

/** `code` is whitespace, as far as splitting into words is concerned. */
const isSpace = (code: number): boolean => code === 32 || (code >= 9 && code <= 13) || code === 0xa0

/** Number of words in `text` from `from` on. */
export function wordCount(text: string, from = 0): number {
  let n = 0
  let inWord = false
  for (let i = from; i < text.length; i++) {
    if (isSpace(text.charCodeAt(i))) inWord = false
    else if (!inWord) {
      inWord = true
      n++
    }
  }
  return n
}

/** Index just past the last of `limit` complete words at or after `from`, or
 *  `from` when no complete word is left.
 *
 *  A word counts as complete only once whitespace follows it: the last word of
 *  the buffer may still be growing, and releasing it early lets its fade-in
 *  span be extended while it animates. Whitespace on its own is always safe to
 *  release. The index stops before the trailing whitespace, so the word that is
 *  still open stays out of the released text. */
export function releaseTo(text: string, from: number, limit: number): number {
  let i = from
  let seen = 0
  while (i < text.length && seen < limit) {
    if (isSpace(text.charCodeAt(i))) {
      i++
      continue
    }
    let end = i
    while (end < text.length && !isSpace(text.charCodeAt(end))) end++
    if (end >= text.length) break
    i = end
    seen++
  }
  return i
}
