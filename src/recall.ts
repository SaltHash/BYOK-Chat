/* Local recall + routing intelligence. Dependency-free: BM25 ranking over
 * memories and chats (no model calls, works offline), near-duplicate
 * detection for memories, a TTL classifier-decision cache, and latency /
 * price scoring for smart endpoint ordering. Pure + unit-testable. */

const STOP = new Set(('a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,do,does,did,have,has,had,my,your,his,her,its,our,their,this,that,these,those,what,when,where,which,who,how,why,not,no,yes,can,could,should,would,will,just,about,into,over,after,before,between,me,you,we,they,it,its,there,here,so,than,too,very,please,thanks,thank,hi,hello,hey,ok,well').split(','))

/** Lowercase alphanumeric tokens minus stopwords. Never throws. */
export function tokenize(text: string): string[] {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t))
}

const K1 = 1.2
const B = 0.75

function idf(df: number, n: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5))
}

/** BM25-rank doc ids for a query. Returns at most topK [id, score] pairs
 *  with score > 0, best first. Ties break by input order (stable). */
export function rankDocs(query: string, docs: { id: string; text: string }[], topK = 8): { id: string; score: number }[] {
  const terms = [...new Set(tokenize(query))]
  if (!terms.length || !docs.length) return []
  const tokenized = docs.map((d) => tokenize(d.text))
  const lens = tokenized.map((t) => t.length)
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length) || 1
  const n = docs.length
  const out: { id: string; score: number; at: number }[] = []
  docs.forEach((d, at) => {
    const toks = tokenized[at]
    if (!toks.length) return
    const freq = new Map<string, number>()
    for (const t of toks) freq.set(t, (freq.get(t) ?? 0) + 1)
    let score = 0
    for (const term of terms) {
      const f = freq.get(term) ?? 0
      if (!f) continue
      let df = 0
      for (const o of tokenized) if (o.includes(term)) df++
      score += idf(df, n) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * toks.length) / avg)))
    }
    if (score > 0) out.push({ id: d.id, score, at })
  })
  out.sort((a, b) => b.score - a.score || a.at - b.at)
  return out.slice(0, Math.max(1, topK)).map(({ id, score }) => ({ id, score }))
}

export type MemoryLike = { id: string; text: string; category: string }
export type RecallMode = 'holistic' | 'contextual' | 'specific'

/** Pick memories for a request. Holistic returns everything; contextual and
 *  specific rank locally (top 8 / top 4 above a relevance floor). Generic
 *  over the element type so timestamped memories stay timestamped. */
export function rankMemories<T extends MemoryLike>(memories: T[], query: string, mode: RecallMode): T[] {
  if (mode === 'holistic') return memories
  if (!memories.length) return []
  const topK = mode === 'contextual' ? 8 : 4
  const floor = mode === 'contextual' ? 0 : 0.5
  const ranked = rankDocs(query, memories.map((m) => ({ id: m.id, text: `${m.text} ${m.category}` })), topK)
    .filter((r) => r.score > floor)
  if (!ranked.length) return []
  const keep = new Set(ranked.map((r) => r.id))
  return memories.filter((m) => keep.has(m.id))
}

/* ---- Near-duplicate memories ---- */

/** Token Jaccard similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

/** All memory pairs at or above threshold, best first. */
export function findDuplicatePairs(memories: MemoryLike[], threshold = 0.75): { a: string; b: string; score: number }[] {
  const out: { a: string; b: string; score: number }[] = []
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const score = similarity(memories[i].text, memories[j].text)
      if (score >= threshold) out.push({ a: memories[i].id, b: memories[j].id, score })
    }
  }
  out.sort((x, y) => y.score - x.score)
  return out
}

export type MergeResult<T extends MemoryLike = MemoryLike> = { memories: T[]; merged: boolean; id: string }

/** Insert a memory, folding near-duplicates into the existing entry (keeps
 *  the longer text, refreshes the timestamp/category). Pure. Generic over
 *  the element type so timestamped memories stay timestamped. */
export function mergeMemory<T extends MemoryLike>(memories: T[], entry: T & { createdAt: number; updatedAt: number }, threshold = 0.75): MergeResult<T> {
  let best: MemoryLike | null = null, bestScore = 0
  for (const m of memories) {
    const s = similarity(m.text, entry.text)
    if (s > bestScore) { bestScore = s; best = m }
  }
  if (best && bestScore >= threshold) {
    const kept = entry.text.length > best.text.length ? entry.text : best.text
    return {
      memories: memories.map((m) => (m.id === best!.id
        ? { ...m, text: kept.slice(0, 500), category: entry.category || m.category, updatedAt: entry.updatedAt }
        : m)),
      merged: true,
      id: best.id,
    }
  }
  return { memories: [...memories, entry], merged: false, id: entry.id }
}

/* ---- Chat search ---- */

export type ChatLike = { id: string; title: string; temporary?: boolean; msgs: { id: string; r: string; t: string }[] }
export type ChatHit = { chatId: string; msgId: string | null; title: boolean; score: number; pre: string; match: string; post: string }

const SNIPPET_RADIUS = 90

function snippetFor(text: string, queryTerms: string[]): { pre: string; match: string; post: string } | null {
  const lower = text.toLowerCase()
  let at = -1, term = ''
  for (const t of queryTerms) {
    const i = lower.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) { at = i; term = t }
  }
  if (at < 0) return null
  const start = Math.max(0, at - SNIPPET_RADIUS), end = Math.min(text.length, at + term.length + SNIPPET_RADIUS)
  return {
    pre: (start > 0 ? '…' : '') + text.slice(start, at),
    match: text.slice(at, at + term.length),
    post: text.slice(at + term.length, end) + (end < text.length ? '…' : ''),
  }
}

/** Rank chats for a query: title matches first, then the best message match
 *  per chat (one hit per chat, with a text snippet). Empty query → []. */
export function searchChats(chats: ChatLike[], query: string, max = 30): ChatHit[] {
  const q = query.trim()
  if (!q) return []
  const terms = tokenize(q)
  if (!terms.length) return []
  const hits: (ChatHit & { at: number })[] = []
  chats.forEach((c, at) => {
    const titleHit = terms.some((t) => c.title.toLowerCase().includes(t))
    let best: { msgId: string; score: number; snip: { pre: string; match: string; post: string } } | null = null
    for (const m of c.msgs) {
      const snip = snippetFor(m.t, terms)
      if (!snip) continue
      const score = terms.reduce((s, t) => s + (m.t.toLowerCase().split(t).length - 1), 0)
      if (!best || score > best.score) best = { msgId: m.id, score, snip }
    }
    if (!titleHit && !best) return
    const score = (titleHit ? 100 : 0) + (best?.score ?? 0)
    hits.push({
      chatId: c.id,
      msgId: best?.msgId ?? null,
      title: titleHit && !best,
      score,
      pre: best?.snip.pre ?? '',
      match: best?.snip.match ?? (titleHit ? c.title : ''),
      post: best?.snip.post ?? '',
      at,
    })
  })
  hits.sort((a, b) => b.score - a.score || a.at - b.at)
  return hits.slice(0, Math.max(1, max)).map(({ at: _at, ...h }) => h)
}

/* ---- Classifier-decision cache ---- */

/** Normalized cache key for a routing decision (playlist + request). */
export function routeCacheKey(playlistId: string, query: string): string {
  return `${playlistId}::${query.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500)}`
}

export class RouteCache {
  private map = new Map<string, { model: string; at: number }>()
  constructor(private ttlMs = 3_600_000, private max = 200) {}
  get(playlistId: string, query: string, now = Date.now()): string | null {
    const hit = this.map.get(routeCacheKey(playlistId, query))
    if (!hit) return null
    if (now - hit.at > this.ttlMs) { this.map.delete(routeCacheKey(playlistId, query)); return null }
    return hit.model
  }
  set(playlistId: string, query: string, model: string, now = Date.now()): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(routeCacheKey(playlistId, query), { model, at: now })
  }
  clear(): void { this.map.clear() }
  get size(): number { return this.map.size }
}

/* ---- Latency / price ordering ---- */

export type RouteStat = { calls: number; fails: number; ms: number }
export type Routable = { id: string; model: string }

/** Record one attempt outcome. Pure (returns the next stat object). */
export function recordRoute(prev: RouteStat | undefined, ms: number, failed: boolean): RouteStat {
  return { calls: (prev?.calls ?? 0) + 1, fails: (prev?.fails ?? 0) + (failed ? 1 : 0), ms: (prev?.ms ?? 0) + Math.max(0, ms) }
}

/** Average ms, penalized by failures; unknown endpoints sort first
 *  (optimistic: new endpoints get tried before known-slow ones). */
export function routeScore(stat: RouteStat | undefined): number {
  if (!stat || stat.calls < 2) return -1
  return (stat.ms / stat.calls) * (1 + stat.fails * 2)
}

export type RoutingMode = 'ordered' | 'fastest' | 'cheapest'

/** Stable reorder of candidates. Ordered keeps list order; fastest sorts by
 *  observed latency; cheapest sorts by input price (priceless last). */
export function orderEndpoints<T extends Routable>(cands: T[], stats: Record<string, RouteStat>, mode: RoutingMode, priceOf: (e: T) => number | undefined = () => undefined): T[] {
  if (mode === 'ordered') return cands
  const keyOf = (e: T) => `${e.id}::${e.model}`
  return [...cands]
    .map((e, at) => ({ e, at }))
    .sort((a, b) => {
      if (mode === 'fastest') return routeScore(stats[keyOf(a.e)]) - routeScore(stats[keyOf(b.e)]) || a.at - b.at
      const pa = priceOf(a.e), pb = priceOf(b.e)
      const ka = pa == null ? Number.POSITIVE_INFINITY : pa, kb = pb == null ? Number.POSITIVE_INFINITY : pb
      return ka - kb || a.at - b.at
    })
    .map(({ e }) => e)
}
