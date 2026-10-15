/* Page-reader extraction: GET /api/extract?url=… → { url, title, text }.
 * SSRF-safe (public http/https only, no private/loopback/link-local hosts),
 * bounded (HTML cap, text cap, timeout), cached 10 min in memory. No extra
 * dependencies: lightweight tag-stripping tuned for article-style pages. */

export const EXTRACT_MAX_HTML = 1_500_000
export const EXTRACT_MAX_TEXT = 12_000

const cache = new Map()

function isPublicHttp(url) {
  let u
  try { u = new URL(url) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  const host = u.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  // Literal private/loopback/link-local/reserved IPs (v4 + common v6).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const p = host.split('.').map(Number)
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
    const [a, b] = p
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 0) || a >= 224) return false
  }
  if (host === '[::1]' || host === '::1' || /^(fc|fd)[0-9a-f]*:/i.test(host) || /^fe80:/i.test(host)) return false
  return true
}

function decodeEntities(s) {
  return String(s)
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#x27|#x2F);/g, (_, e) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", '#x2F': '/' }[e] ?? ' '))
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return Number.isFinite(c) ? String.fromCharCode(Math.min(c, 0x10ffff)) : ' ' })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

export function htmlToText(html) {
  let s = String(html ?? '')
  const title = (/<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s)?.[1] ?? /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(s)?.[1] ?? '').trim()
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav\s*>/gi, ' ').replace(/<header[\s\S]*?<\/header\s*>/gi, ' ').replace(/<footer[\s\S]*?<\/footer\s*>/gi, ' ')
  // Keep link text, drop the markup.
  s = s.replace(/<(p|div|br|li|h1|h2|h3|h4|tr)[^>]*>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s).replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n')
  const lines = s.split('\n').map((l) => l.trim()).filter((l) => l && l.length > 1)
  // Drop boilerplate-ish lines (nav crumbs, cookie banners) beyond the head.
  const kept = lines.filter((l, i) => i < 6 || !/^(home|menu|search|login|sign in|subscribe|newsletter|cookie|privacy|terms|advertisement|sponsored)$/i.test(l))
  return { title: decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 300), text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}

export async function fetchPageText(url, { timeoutMs = 8000, fetchFn = fetch } = {}) {
  if (!isPublicHttp(url)) {
    const e = Error('Only public http(s) pages can be read.')
    e.code = 'bad_url'
    throw e
  }
  const key = String(url)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 600_000) return hit.data
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res
  try { res = await fetchFn(url, { signal: ac.signal, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'byok-chat-reader/1.0' }, redirect: 'follow' }) }
  catch (e) {
    clearTimeout(timer)
    const err = Error(e?.name === 'AbortError' ? 'The page took too long to respond.' : `Could not reach the page (${e?.message || 'network error'}).`)
    err.code = e?.name === 'AbortError' ? 'timeout' : 'network'
    err.retryable = true
    throw err
  } finally { clearTimeout(timer) }
  if (!res.ok) {
    const err = Error(`The page returned HTTP ${res.status}.`)
    err.code = res.status >= 500 ? 'upstream_unavailable' : 'bad_response'
    err.status = res.status
    err.retryable = res.status >= 500
    throw err
  }
  const type = res.headers.get?.('content-type') ?? ''
  if (type && !/html|xml|text/i.test(type)) {
    const err = Error('That URL is not a readable page (only HTML/text).')
    err.code = 'bad_type'
    throw err
  }
  const reader = res.body?.getReader?.()
  let html = ''
  if (reader) {
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      html += dec.decode(value, { stream: true })
      if (html.length > EXTRACT_MAX_HTML) break
    }
  } else {
    html = (await res.text().catch(() => '')).slice(0, EXTRACT_MAX_HTML)
  }
  const { title, text } = htmlToText(html)
  if (!text) {
    const err = Error('No readable text found on that page.')
    err.code = 'empty'
    throw err
  }
  const truncated = text.length > EXTRACT_MAX_TEXT
  const data = { url, title: title || url, text: truncated ? text.slice(0, EXTRACT_MAX_TEXT) : text, truncated }
  cache.set(key, { at: Date.now(), data })
  if (cache.size > 200) cache.delete(cache.keys().next().value)
  return data
}

export { isPublicHttp }
