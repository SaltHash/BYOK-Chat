/* Reply quoting. A quote is stored as a Markdown blockquote at the start of the
 * user message so it survives copy, branch, sync and reload; the composer and
 * the transcript decode it into an attached banner rather than showing raw
 * `>` text. */

export type QuotedReply = { quote: string; body: string }

/** Encode selected assistant text for the start of a user message. */
export function quoteForSend(text: string): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  return `${t.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
}

/** Split a leading quote from the user's own text. Returns null when the
 * message does not start with a quote, so ordinary blockquotes are untouched. */
export function splitQuotedReply(text: string): QuotedReply | null {
  const lines = String(text ?? '').split('\n')
  const quote: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line === '') {
      if (i + 1 < lines.length && /^>($| )/.test(lines[i + 1])) {
        quote.push('')
        i++
        continue
      }
      i++
      break
    }
    const m = /^>($| )(.*)$/.exec(line)
    if (!m) break
    quote.push(m[2] ?? '')
    i++
  }
  const textQuote = quote.join('\n').trim()
  if (!textQuote) return null
  return { quote: textQuote, body: lines.slice(i).join('\n').replace(/^\n+/, '') }
}
