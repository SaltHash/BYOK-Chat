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

/* ---- copying ----
 * Replies are markdown, so a copy can either preserve their formatting (tables,
 * code fences, and citation pills expanded to real links) or strip it down to
 * plain prose. Both forms resolve bare [S1] markers; the plain form drops the
 * markers entirely. */
export function messageForCopy(text: string, sources: CiteSource[], markdown: boolean): string {
  return markdown ? linkifyCitations(text, sources) : plainTextFromMarkdown(stripCitations(text))
}

/** Best-effort markdown to plain text for copying. Code block contents and
 *  inline code survive verbatim; structural punctuation does not. */
export function plainTextFromMarkdown(text: string): string {
  const src = String(text ?? '')
  if (!src) return ''
  let out = src
    // Fenced code: keep the code, drop the fence lines and language tag.
    .replace(/^[ \t]*(```|~~~)[^\n]*\n?([\s\S]*?)^[ \t]*\1[ \t]*$/gm, (_m, _f, body: string) => body)
    // Images become their alt text, links become "label (url)".
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => (url && !/^#/.test(url) ? `${label} (${url})` : label))
    // Headings, blockquotes, list markers, task boxes and horizontal rules.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, '- ')
    .replace(/^[ \t]*([-*+]|[0-9]+[.)])[ \t]+/gm, '- ')
    .replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    // Inline code: keep its contents, drop the ticks.
    .replace(/`([^`\n]+)`/g, '$1')
    // Emphasis and strikethrough markers.
    .replace(/(\*\*|__)([^\n]+?)\1/g, '$2')
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/(?<![_\w])_([^_\n]+)_(?!\w)/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    // Tables: flatten the pipes into a readable separator.
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, row: string) => row.split('|').map((cell) => cell.trim()).filter(Boolean).join(' · '))
  out = out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim()
  return out
}

/* ---- report/source highlighting ----
 * A citation should point at the sentence it actually supports, not merely at
 * the source row. The evidence available may be a full page read or only a
 * search snippet, so the matcher works on whatever text there is and never
 * requires the page to have been fetched. */
const STOP_WORDS = new Set(['the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'its', 'into', 'than', 'then', 'they', 'their', 'there', 'which', 'when', 'what', 'who', 'how', 'why', 'also', 'been', 'being', 'can', 'could', 'would', 'should', 'may', 'might', 'will', 'about', 'over', 'under', 'between', 'after', 'before', 'more', 'most', 'such', 'only', 'very', 'some', 'any', 'all', 'each', 'other', 'one', 'two', 'new', 'use', 'used', 'using', 'said', 'says'])
const contentWords = (text: string): string[] =>
  (String(text ?? '').toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []).filter((w) => !STOP_WORDS.has(w))

/** Split prose into candidate excerpts: sentences, then long sentences into
 *  clauses, so one very long paragraph still yields a tight highlight. */
export function excerptCandidates(text: string): string[] {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const out: string[] = []
  for (const sentence of clean.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(\[])/)) {
    const s = sentence.trim()
    if (!s) continue
    if (s.length <= 320) { out.push(s); continue }
    for (const clause of s.split(/(?<=[;:])\s+/)) {
      const c = clause.trim()
      if (c) out.push(c.length > 320 ? `${c.slice(0, 317)}…` : c)
    }
  }
  return out
}

/** The excerpt of `sourceText` that best supports `claim`, with the matched
 *  terms for highlighting. Works with a full page, a summary, or a short
 *  search snippet; returns the first excerpt when nothing overlaps. */
export function supportingExcerpt(sourceText: string, claim: string, maxChars = 700): { text: string; terms: string[]; score: number } {
  const cleaned = String(sourceText ?? '').replace(/\s+/g, ' ').trim()
  const clipped = cleaned.length > maxChars ? `${cleaned.slice(0, maxChars).trimEnd()}…` : cleaned
  if (!clipped) return { text: '', terms: [], score: 0 }
  const words = [...new Set(contentWords(claim))]
  const candidates = excerptCandidates(clipped).length ? excerptCandidates(clipped) : [clipped]
  let best = candidates[0]
  let bestScore = -1
  const lowerClaim = String(claim ?? '').toLowerCase()
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase()
    let score = 0
    for (const w of words) if (lower.includes(w)) score += 1
    // Contiguous claim fragments are a stronger signal than scattered terms.
    const claimChunks = lowerClaim.split(/[^a-z0-9 ]+/).filter((c) => c.trim().split(' ').length >= 2)
    for (const chunk of claimChunks) if (chunk.length >= 12 && lower.includes(chunk.trim())) score += 2
    if (score > bestScore) { bestScore = score; best = candidate }
  }
  return { text: best, terms: words.filter((w) => best.toLowerCase().includes(w)).slice(0, 24), score: Math.max(0, bestScore) }
}

/** The sentence around a citation marker, used to show which claim a source is
 *  supporting. Works on the raw markdown (before linkification) and on the
 *  linked form, and falls back to the nearest paragraph. */
export function claimForCitation(text: string, citeId: string): string {
  const src = String(text ?? '')
  const id = String(citeId ?? '').replace(/^s/i, 'S')
  if (!src || !id) return ''
  const at = src.toLowerCase().indexOf(`[${id.toLowerCase()}]`)
  if (at < 0) return ''
  const before = src.slice(0, at)
  const after = src.slice(at)
  const startBreak = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n\n'))
  const endCandidates = ['. ', '! ', '? ', '\n\n'].map((m) => after.indexOf(m)).filter((i) => i >= 0)
  const end = endCandidates.length ? Math.min(...endCandidates) + 1 : after.length
  const raw = `${before.slice(startBreak >= 0 ? startBreak + (before[startBreak] === '\n' ? 2 : 2) : 0)}${after.slice(0, end)}`
  return raw
    .replace(/\[(?:Sources?\s+)?S\d+\](?:\([^)]*\))?/gi, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

/* ---- citation export ---- */
export type ExportSource = Pick<CiteSource, 'citeId' | 'title' | 'url' | 'host' | 'query' | 'searchedAt'>

const bibEscape = (s: string): string => String(s ?? '').replace(/[{}]/g, (m) => `\\${m}`).replace(/\s+/g, ' ').trim()

/** A small, valid BibTeX bibliography for a reply or research report. */
export function sourcesToBibtex(sources: ExportSource[]): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const s of sources) {
    if (!s?.url || seen.has(s.url)) continue
    seen.add(s.url)
    const key = (s.citeId || `S${entries.length + 1}`).replace(/[^A-Za-z0-9]/g, '') || `S${entries.length + 1}`
    const fields = [
      `  title = {${bibEscape(s.title || s.url)}}`,
      `  howpublished = {\\url{${bibEscape(s.url)}}}`,
      `  note = {${bibEscape(s.host || hostOf(s.url))}${s.searchedAt ? `, accessed ${bibEscape(s.searchedAt)}` : ''}${s.query ? `, query: ${bibEscape(s.query)}` : ''}}`,
    ]
    entries.push(`@misc{${key},\n${fields.join(',\n')}\n}`)
  }
  return entries.length ? `${entries.join('\n\n')}\n` : ''
}

/** A plain link list, one source per line, with its citation id. */
export function sourcesToLinkList(sources: ExportSource[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const s of sources) {
    if (!s?.url || seen.has(s.url)) continue
    seen.add(s.url)
    lines.push(`[${s.citeId || 'S?'}] ${s.title || s.host || s.url} — ${s.url}`)
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

/* Coverage check for the strict-citations setting: which cited ids are
 * unknown, and whether evidence exists with zero citations. */
export function citationCoverage(text: string, sources: CiteSource[]): { cited: string[]; unknown: string[]; uncited: boolean } {
  const cited = extractCitedIds(text)
  const known = new Set(sources.map((s) => s.citeId.toUpperCase()))
  return { cited, unknown: cited.filter((id) => !known.has(id)), uncited: sources.length > 0 && cited.length === 0 }
}
