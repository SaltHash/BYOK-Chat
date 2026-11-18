/* Where a streamed reply can stop being re-parsed.
 *
 * A live reply is re-rendered once per released word, and the markdown parser
 * sees the whole document each time. That cost grows with the reply: a
 * 2,000-word answer took ~190 ms per update, so the reveal could only run at a
 * few frames a second and arrived in clumps of words instead of one at a time.
 * Everything before the block still being written is final, though, so it can
 * be handed to a memoised renderer once and left alone.
 *
 * `blockEnds` returns the offsets where that is safe: just past a blank line
 * that ends a top-level block, outside a code fence or a `$$` block. A blank
 * line inside a list does not count when the next line is another item of the
 * same list — splitting there would restart the list's numbering in a second
 * `<ol>` — and neither does one inside a fence or display math, where a blank
 * line is just content.
 */

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export function blockEnds(text: string): number[] {
  const ends: number[] = []
  let fence: string | null = null
  let math = false
  let pending = -1
  let pendingList = false
  let lastNonBlank = ''
  let i = 0

  /* A block has started: the blank line before it now ends a block, unless the
   * next block continues a list the previous one ended with. */
  const start = (line: string) => {
    if (pending > 0 && !(pendingList && LIST_ITEM.test(line))) ends.push(pending)
    pending = -1
    pendingList = false
    lastNonBlank = line
  }

  while (i < text.length) {
    const nl = text.indexOf('\n', i)
    const stop = nl < 0 ? text.length : nl
    const line = text.slice(i, stop)
    const trimmed = line.trim()

    if (fence) {
      if (trimmed.startsWith(fence) && !trimmed.slice(fence.length).trim()) fence = null
      if (trimmed) lastNonBlank = line
    } else if (math) {
      // The closing `$$` starts whatever follows it; it does not open math.
      if (trimmed === '$$') { math = false; start(line) }
      else if (trimmed) lastNonBlank = line
    } else if (!trimmed) {
      if (pending < 0) {
        pending = nl < 0 ? text.length : nl + 1
        pendingList = LIST_ITEM.test(lastNonBlank)
      }
    } else {
      start(line)
      const open = FENCE.exec(line)
      if (open) fence = open[1]
      else if (trimmed === '$$') math = true
    }
    i = nl < 0 ? text.length : nl + 1
  }

  return ends
}

/** The text cut into independently renderable blocks; the last one may still
 *  be incomplete, which is what the caller keeps re-rendering. */
export function splitBlocks(text: string): string[] {
  const ends = blockEnds(text)
  const parts: string[] = []
  let from = 0
  for (const end of ends) {
    parts.push(text.slice(from, end))
    from = end
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts.length ? parts : [text]
}
