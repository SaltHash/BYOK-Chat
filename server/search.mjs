export function boundedInt(value, fallback, min, max) {
  const n = Number(value)
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback
}

export function buildSearchUrl(baseUrl, query) {
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('SEARXNG_BASE_URL must use HTTP or HTTPS')
  const endpoint = new URL('/search', base)
  endpoint.searchParams.set('q', query)
  endpoint.searchParams.set('format', 'json')
  return endpoint
}

function canonicalUrl(value) {
  try {
    const u = new URL(value)
    if (!['http:', 'https:'].includes(u.protocol)) return ''
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = ''
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key)
    return u.toString().replace(/\/$/, '')
  } catch { return '' }
}

export function selectResults(items, { maxResults = 8, maxSnippetChars = 1800, evidenceBudget = 12000 } = {}) {
  let budget = evidenceBudget
  const normalized = (Array.isArray(items) ? items : []).map((x, i) => {
    const url = canonicalUrl(x?.url)
    return {
      title: String(x?.title || 'Untitled result').trim().slice(0, 300),
      url,
      host: url ? new URL(url).hostname : '',
      snippet: String(x?.content || x?.snippet || '').replace(/\s+/g, ' ').trim().slice(0, maxSnippetChars),
      engine: String(x?.engine || '').slice(0, 80),
      score: Number.isFinite(Number(x?.score)) ? Number(x.score) : 0,
      order: i,
    }
  }).filter((x) => x.url && x.snippet)
  normalized.sort((a, b) => b.score - a.score || a.order - b.order)
  // Prefer distinct domains in the first pass, then use remaining high-scoring results.
  const ordered = [...normalized.filter((x, i) => normalized.findIndex((y) => y.host === x.host) === i), ...normalized.filter((x, i) => normalized.findIndex((y) => y.host === x.host) !== i)]
  const seen = new Set(), out = []
  for (const x of ordered) {
    if (seen.has(x.url) || out.length >= maxResults || budget <= 0) continue
    seen.add(x.url)
    const allowance = Math.min(maxSnippetChars, budget - x.title.length - x.url.length - 80)
    if (allowance <= 0) break
    x.snippet = x.snippet.slice(0, allowance)
    budget -= x.title.length + x.url.length + x.snippet.length + 80
    out.push({ id: `S${out.length + 1}`, title: x.title, url: x.url, snippet: x.snippet, ...(x.engine ? { engine: x.engine } : {}) })
  }
  return out
}
