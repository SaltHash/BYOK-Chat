/* Citation helpers: turn per-search evidence blocks back into structured
 * sources, then turn the model's [S1] / [Source S1] / [S2, S8] tokens into real links.
 * Pure + unit-testable; no DOM, no store imports. */

export type CiteSource = {
  citeId: string
  title: string
  url: string
  host: string
  snippet: string
  query: string
  engine?: string
  searchedAt?: string
}

export const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

export const truncateSnippet = (s: string, n = 220): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t
}

/* Parse one formatSearch() evidence block back into sources. Tolerates the
 * header line plus [Source S1] sections; never throws. */
export function parseSearchEvidence(result: string): { query: string; provider: string; sources: Omit<CiteSource, 'citeId'>[] } {
  const text = String(result ?? '')
  const header = text.split('\n')[0] ?? ''
  const query = /evidence for [“"](.+?)[”"]/.exec(header)?.[1] ?? ''
  const provider = /\((.+?) · \d+ sources?/.exec(header)?.[1] ?? ''
  const out: Omit<CiteSource, 'citeId'>[] = []
  const re = /\[Source (S\d+)\]\nTitle: ([^\n]*)\nURL: ([^\n]*)\nSnippet: ([\s\S]*?)(?=\n\n\[Source S\d+\]|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const url = (m[3] ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    out.push({
      title: (m[2] ?? '').trim() || url,
      url,
      host: hostOf(url),
      snippet: (m[4] ?? '').replace(/<\/?search_evidence>/g, ' ').replace(/\s+/g, ' ').trim(),
      query,
      engine: provider || undefined,
    })
  }
  return { query, provider, sources: out }
}

export type ToolRoundLike = { calls: { name: string; arguments: string; result?: string; error?: boolean }[] }

/* Collect every successful search/fetch_page call across tool rounds into one
 * deduped source list (by canonical URL). Citation ids are reassigned
 * globally (S1..Sn) in first-seen order so [S1] is unambiguous per message. */
export function collectMessageSources(rounds?: { calls: { name: string; arguments: string; result?: string; error?: boolean }[] }[] | null): CiteSource[] {
  const seen = new Map<string, CiteSource>()
  const keyOf = (url: string) => {
    try {
      const u = new URL(url)
      u.hash = ''
      return u.toString().replace(/\/$/, '').toLowerCase()
    } catch { return url.toLowerCase() }
  }
  for (const round of rounds ?? []) {
    for (const call of round.calls ?? []) {
      if (call.error) continue
      if (call.name === 'search' && call.result) {
        for (const s of parseSearchEvidence(call.result).sources) {
          const k = keyOf(s.url)
          if (!seen.has(k)) seen.set(k, { ...s, citeId: `S${seen.size + 1}` })
        }
      } else if (call.name === 'fetch_page' && call.result) {
        try {
          const j = JSON.parse(call.result)
          const url = String(j?.url ?? '')
          if (!/^https?:\/\//i.test(url)) continue
          const k = keyOf(url)
          if (!seen.has(k)) {
            seen.set(k, {
              citeId: `S${seen.size + 1}`,
              title: String(j?.title ?? url),
              url,
              host: hostOf(url),
              snippet: String(j?.text ?? j?.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
              query: 'page reader',
            })
          }
        } catch { /* non-JSON results are ignored */ }
      }
    }
  }
  return [...seen.values()]
}

/* Citation ids referenced by rendered text: [S1], [Source S1], [S1](url),
 * plus grouped forms like [S2, S8], [S1; S2], [Sources S1, S2]. */
export function extractCitedIds(text: string): string[] {
  const ids = new Set<string>()
  const re = /\[(?:Sources? )?([^\]\n]{1,80})\](?:\([^)]*\))?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text ?? '')))) {
    const inner = m[1] ?? ''
    if (!/S\d+/i.test(inner)) continue
    // Only treat the bracket as a citation when its contents are ids plus
    // separators (commas, semicolons, whitespace, &, +, "and", "Source(s)").
    const stripped = inner
      .replace(/sources?/gi, '')
      .replace(/\band\b/gi, '')
      .replace(/S\d+/gi, '')
      .replace(/[,;+\s&]/g, '')
    if (stripped !== '') continue
    for (const hit of inner.match(/S\d+/gi) ?? []) ids.add(hit.toUpperCase())
  }
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

/* Rewrite bare [S1] / [Source S1] / [S2, S8] tokens into markdown links
 * against sources. Already-linked [S1](…) is left alone; unknown ids are
 * left as plain text ([S2, S9] links S2, leaves [S9]). */
export function linkifyCitations(text: string, sources: CiteSource[]): string {
  if (!sources.length) return text
  const byId = new Map(sources.map((s) => [s.citeId.toUpperCase(), s]))
  const linkOf = (id: string): string | null => {
    const s = byId.get(id.toUpperCase())
    return s ? `[${s.citeId}](${s.url} "${s.title.replace(/"/g, "'")}")` : null
  }
  return String(text ?? '').replace(/( |&nbsp;|\u00a0)?\[(?:Sources? )?([^\]\n]{1,80})\](?!\()/gi, (full, sp: string, inner: string) => {
    if (!/S\d+/i.test(inner)) return full
    const stripped = String(inner)
      .replace(/sources?/gi, '')
      .replace(/\band\b/gi, '')
      .replace(/S\d+/gi, '')
      .replace(/[,;+\s&]/g, '')
    if (stripped !== '') return full
    const ids = inner.match(/S\d+/gi) ?? []
    if (!ids.length) return full
    const glue = sp ? ' ' : ''
    if (ids.length === 1) {
      // Preserve the [Source S1] spelling for singletons.
      const link = linkOf(ids[0])
      return (link ? glue + (link ?? full) : full)
    }
    // Grouped ids render as adjacent pills (space-separated, no comma).
    return glue + ids.map((id) => linkOf(id) ?? `[${id.toUpperCase()}]`).join(' ')
  }).replace(/(\][(][^)\n]*[)])\s+([.,;:!?])/g, '$1$2').replace(/(\[S\d+\])\s+([.,;:!?])/gi, '$1$2')
}

/* Remove bare [S1] / [Source S1] / [S2, S8] tokens for the citations-off
 * setting. Already-linked [S1](…) is left alone. */
export function stripCitations(text: string): string {
  return String(text ?? '').replace(/( |&nbsp;|\u00a0)?\[(?:Sources? )?([^\]\n]{1,80})\](?!\()/gi, (full, sp: string, inner: string) => {
    if (!/S\d+/i.test(inner)) return full
    const stripped = String(inner)
      .replace(/sources?/gi, '')
      .replace(/\band\b/gi, '')
      .replace(/S\d+/gi, '')
      .replace(/[,;+\s&]/g, '')
    if (stripped !== '') return full
    // Drop the token plus one preceding space to avoid double spaces.
    return ''
  }).replace(/ {2,}/g, ' ').replace(/ \n/g, '\n')
}

/* Coverage check for the strict-citations setting: which cited ids are
 * unknown, and whether evidence exists with zero citations. */
export function citationCoverage(text: string, sources: CiteSource[]): { cited: string[]; unknown: string[]; uncited: boolean } {
  const cited = extractCitedIds(text)
  const known = new Set(sources.map((s) => s.citeId.toUpperCase()))
  return { cited, unknown: cited.filter((id) => !known.has(id)), uncited: sources.length > 0 && cited.length === 0 }
}
