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
 *  `shownBefore` covers the render that replaces the paced body with pieces
 *  around a tool round: the opening piece is prose the reader has already
 *  been reading, so fading it would take visible text back to transparent. */
export function segmentFade(previous: number | undefined, isLast: boolean, fadeMs: number, shownBefore = false): number {
  if (previous !== undefined) return previous
  return isLast && !shownBefore ? fadeMs : 0
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
