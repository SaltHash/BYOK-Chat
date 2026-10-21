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

/* The standing citation policy, added to the system prompt whenever the
 * model can pull in web evidence.
 *
 * This rule used to live only inside the search tool's result, and models
 * routinely dropped it: the instruction sat far up in the context, and by the
 * time the model wrote the final reply it had drifted out of attention. As
 * part of the system prompt it is re-sent with every round of the tool loop,
 * so the model always has it in view — including in the round that writes the
 * answer. */
export function citationRule(opts: { inline?: boolean } = {}): string {
  if (opts.inline === false) {
    return 'Citations: the app lists the sources separately, so do not put [S1], [S2], etc. markers in your reply — refer to a source by name or link instead.'
  }
  return [
    'Citations: web search results and page reads are numbered [S1], [S2], … in the order the tools return them, and those numbers keep counting up across every tool call in this reply.',
    'Cite every factual claim you take from that evidence inline, right after the claim, as [S1] (group several sources as [S1, S2]).',
    'Use only the ids the tools gave you in this reply: never invent an id, never cite a number that was not returned, and never renumber a source. For evidence from an earlier message in the chat, name the source in words instead of an id.',
    'The rule applies to every reply, including the final one you write after your last tool call, and it applies again if you call another tool.',
    'If a claim has no supporting source, say that it is unsourced rather than citing anyway.',
  ].join(' ')
}

/* Citation ids for one reply: one S<n> per distinct URL, numbered across
 * every search and page read in the turn. Two searches would otherwise both
 * number their results from S1, and the model's [S1] would be ambiguous. */
export function createCiteIds() {
  const byUrl = new Map<string, string>()
  let next = 1
  const keyOf = (url: string) => {
    try {
      const u = new URL(url)
      u.hash = ''
      return u.toString().replace(/\/$/, '').toLowerCase()
    } catch { return String(url ?? '').toLowerCase() }
  }
  return {
    /** The id for a URL. The same URL always keeps the id it was given, and
     * each new URL takes the next free number. */
    idFor(url: string): string {
      const k = keyOf(url)
      const hit = byUrl.get(k)
      if (hit) return hit
      const id = `S${next++}`
      byUrl.set(k, id)
      return id
    },
  }
}

/* Parse one formatSearch() evidence block back into sources. Tolerates the
 * header line plus [Source S1] sections; never throws. The evidence `S<n>`
 * label is preserved as `citeId` so absolute, run-wide numbering survives
 * the round-trip (see `collectMessageSources`). */
export function parseSearchEvidence(result: string): { query: string; provider: string; sources: CiteSource[] } {
  const text = String(result ?? '')
  const header = text.split('\n')[0] ?? ''
  const query = /evidence for [“"](.+?)[”"]/.exec(header)?.[1] ?? ''
  const provider = /\((.+?) · \d+ sources?/.exec(header)?.[1] ?? ''
  const out: CiteSource[] = []
  const re = /\[Source (S\d+)\]\nTitle: ([^\n]*)\nURL: ([^\n]*)\nSnippet: ([\s\S]*?)(?=\n\n\[Source S\d+\]|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const url = (m[3] ?? '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    out.push({
      citeId: (m[1] ?? '').toUpperCase(),
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

/* Parse one research fetch_page() result back into a source. Handles both
 * the JSON payload shape and the formatted `Page excerpt [Source S<n>]`
 * text the research loop returns (see `formatPage`). Returns null when the
 * text is not a readable page result. */
export function parsePageExcerpt(result: string): CiteSource | null {
  const text = String(result ?? '')
  // Preferred: formatted excerpt carrying its absolute source id.
  const labelled = /Page (?:excerpt|summary)\s+\[Source (S\d+)\]\s+for\s+(\S+)/i.exec(text)
  const unlabelled = /Page (?:excerpt|summary) for (\S+)/i.exec(text)
  const url = (labelled?.[2] ?? unlabelled?.[1] ?? '').trim().replace(/[.,;:!?)\]]+$/, '')
  if (!/^https?:\/\//i.test(url)) {
    // Fall back to a raw JSON payload (non-research callers).
    try {
      const j = JSON.parse(text)
      const jurl = String(j?.url ?? '')
      if (!/^https?:\/\//i.test(jurl)) return null
      return {
        citeId: '',
        title: String(j?.title ?? jurl),
        url: jurl,
        host: hostOf(jurl),
        snippet: String(j?.text ?? j?.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
        query: 'page reader',
      }
    } catch { return null }
  }
  const title = /^Title: ([^\n]*)/m.exec(text)?.[1]?.trim() || url
  const body = /<page_excerpt>\n([\s\S]*?)\n<\/page_excerpt>/.exec(text)?.[1]
    ?? text.replace(/^[^\n]*\n/, '').replace(/^Title: [^\n]*\n/, '')
  return {
    citeId: (labelled?.[1] ?? '').toUpperCase(),
    title,
    url,
    host: hostOf(url),
    snippet: body.replace(/\s+/g, ' ').trim().slice(0, 600),
    query: 'page reader',
  }
}

export type ToolRoundLike = { calls: { name: string; arguments: string; result?: string; error?: boolean }[] }

/* Collect every successful search/fetch_page call across tool rounds into one
 * deduped source list (by canonical URL). Absolute evidence ids ([Source
 * S<n>] written by the research loop) are preserved so the model's [S<n>]
 * citations resolve to the page it actually read; colliding or missing ids
 * (e.g. legacy per-search S1..Sn blocks) are assigned the next free number.
 * Output is sorted by numeric citation id. */
export function collectMessageSources(rounds?: { calls: { name: string; arguments: string; result?: string; error?: boolean }[] }[] | null): CiteSource[] {
  const byUrl = new Map<string, CiteSource>()
  const usedIds = new Set<string>()
  let next = 1
  const keyOf = (url: string) => {
    try {
      const u = new URL(url)
      u.hash = ''
      return u.toString().replace(/\/$/, '').toLowerCase()
    } catch { return url.toLowerCase() }
  }
  const claim = (wanted: string): string => {
    const w = String(wanted ?? '').toUpperCase()
    if (/^S\d+$/.test(w) && !usedIds.has(w)) { usedIds.add(w); return w }
    while (usedIds.has(`S${next}`)) next++
    const id = `S${next++}`
    usedIds.add(id)
    return id
  }
  const addSource = (s: CiteSource) => {
    const k = keyOf(s.url)
    if (byUrl.has(k)) return
    const citeId = claim(s.citeId)
    byUrl.set(k, { ...s, citeId })
  }
  for (const round of rounds ?? []) {
    for (const call of round.calls ?? []) {
      if (call.error) continue
      if (call.name === 'search' && call.result) {
        for (const s of parseSearchEvidence(call.result).sources) addSource(s)
      } else if (call.name === 'fetch_page' && call.result) {
        const s = parsePageExcerpt(call.result)
        if (s) addSource(s)
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => Number(a.citeId.slice(1)) - Number(b.citeId.slice(1)))
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
