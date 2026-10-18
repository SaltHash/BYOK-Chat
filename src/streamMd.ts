/* Splitting a reply that is still arriving into "settled blocks" and the one
 * block that is still being written.
 *
 * Streaming markdown cannot be re-parsed from scratch on every token: a 13 KB
 * reply costs tens of milliseconds per parse, and tokens arrive many times per
 * frame. Parsing only the part that has stopped changing keeps that cost off
 * the hot path, but the split has to land on a real block boundary, or the live
 * text is rendered outside the structure it belongs to: a list item loses its
 * indent, a quote loses its background, a table cell loses its column width,
 * and a paragraph is broken onto a new line mid-sentence.
 *
 * A blank line outside a fenced code block ends a top-level block, so the last
 * such blank line is where the settled prefix ends and the in-progress block
 * begins. Everything after it (including the incomplete final line) is rendered
 * as one markdown document, which is exactly how it will look once the reply is
 * complete, so text never shifts when a block is finally committed. */

/* Any leading whitespace: a fence nested in a list item is indented past the
 * four spaces that would otherwise look like an indented code block. Treating
 * one as a fence only costs the splitter a later commit, while missing one
 * would split the code in half. */
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})(.*)$/

const isBlank = (s: string) => s.trim() === ''

/** Indented lines continue the block above them (list item bodies, indented
 *  code); splitting in front of one would change how both halves render. */
const isIndented = (s: string) => /^[ \t]/.test(s)

/** Split an incomplete markdown document into the settled prefix and the block
 *  that is still streaming. `head` is '' when nothing has settled yet, and
 *  `head + tail === full` always holds. */
export function splitStream(full: string): { head: string; tail: string } {
  if (!full) return { head: '', tail: '' }
  const lines: { text: string; start: number }[] = []
  let start = 0
  for (let i = 0; i <= full.length; i++) {
    if (i === full.length || full.charCodeAt(i) === 10) {
      lines.push({ text: full.slice(start, i), start })
      start = i + 1
    }
  }
  let fence: { ch: string; len: number } | null = null
  let blockStart = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text
    const m = FENCE_LINE.exec(line)
    if (fence) {
      // Only a fence of the same character, at least as long, with nothing
      // after it closes the block.
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !m[2].trim()) fence = null
      continue
    }
    if (m) { fence = { ch: m[1][0], len: m[1].length }; continue }
    if (!isBlank(line)) continue
    // The next non-blank line starts a new top-level block, unless it is
    // indented (a continuation) or there is nothing after the blank run.
    let j = i + 1
    while (j < lines.length && isBlank(lines[j].text)) j++
    if (j >= lines.length || isIndented(lines[j].text)) continue
    blockStart = lines[j].start
    i = j - 1
  }
  return { head: full.slice(0, blockStart), tail: full.slice(blockStart) }
}
