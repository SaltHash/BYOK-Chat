/* Page-reader extraction: GET /api/extract?url=… → { url, title, text }.
 * SSRF-safe (public http/https only, no private/loopback/link-local hosts),
 * bounded (HTML cap, text cap, timeout), cached 10 min in memory. No extra
 * dependencies: lightweight tag-stripping tuned for article-style pages. */

export const EXTRACT_MAX_HTML = 1_500_000
export const EXTRACT_MAX_TEXT = 12_000

const cache = new Map()

function isPrivateIpv4(p) {
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // documentation (198.51.100.0/24)
  if (a === 203 && b === 0) return true // documentation (203.0.113.0/24)
  return false
}

/* Expand a textual IPv6 address (no IPv4 tail) into 8 groups, or null. */
function ipv6Groups(host) {
  const text = String(host).split('%')[0]
  if (!/^[0-9a-f:]+$/i.test(text)) return null
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = []
  for (const part of [...head, ...tail]) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
    groups.push(parseInt(part, 16))
  }
  if (halves.length === 1) return groups.length === 8 ? groups : null
  if (groups.length > 8) return null
  return [...groups.slice(0, head.length), ...new Array(8 - groups.length).fill(0), ...groups.slice(head.length)]
}

function isPrivateIpv6(g) {
  const [g0, g1] = g
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true // fec0::/10 deprecated site-local
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((g0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (g0 === 0x0100 && g1 === 0) return true // 100::/64 discard-only
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0db0) return true // 2001:db8::/32 documentation
  const firstFiveZero = g.slice(0, 5).every((n) => n === 0)
  // ::, ::1, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d)
  if (firstFiveZero && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0) return true
    return isPrivateIpv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255])
  }
  // NAT64 (64:ff9b::/96, 64:ff9b:1::/48) and 6to4 (2002::/16) embed an IPv4 address.
  if (g0 === 0x0064 && g1 === 0xff9b) return isPrivateIpv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255])
  if (g0 === 0x2002) return isPrivateIpv4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255])
  return false
}

function isPublicHttp(url) {
  let u
  try { u = new URL(url) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  // URL keeps IPv6 literals bracketed; strip them so the checks below see the address.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  // Literal private/loopback/link-local/reserved IPs (v4 + v6). The URL parser
  // already normalizes shorthand IPv4 (127.1, 0x7f.1, 2130706433, …) and
  // mapped IPv6 forms to their canonical dotted/compressed spelling.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const p = host.split('.').map(Number)
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
    return !isPrivateIpv4(p)
  }
  if (host.includes(':')) {
    const groups = ipv6Groups(host)
    if (!groups) return false // unparseable or IPv4-embedded literal: refuse
    return !isPrivateIpv6(groups)
  }
  return true
}

function decodeEntities(s) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", '#x2F': '/' }
  return String(s)
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#x27|#x2F);/g, (_, e) => named[e] ?? ' ')
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
}

/* Decode one numeric entity, tolerating junk: surrogates, out-of-range and
 * non-finite values become a space instead of a stray/incorrect character. */
function codePoint(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return ' '
  return String.fromCodePoint(n)
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

/* Redirects are followed by hand so every hop is checked against the same
 * public-address rules. Automatic following would let a public URL bounce the
 * server onto a private address. */
async function fetchFollowingPublic(fetchFn, url, init, maxHops = 5) {
  let current = url
  for (let hop = 0; ; hop++) {
    const res = await fetchFn(current, { ...init, redirect: 'manual' })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get?.('location') : null
    if (!location) return res
    await res.body?.cancel?.().catch(() => {})
    if (hop >= maxHops) throw Object.assign(Error('The page redirected too many times.'), { code: 'bad_response', status: 502, retryable: false })
    const next = new URL(location, current).href
    if (!isPublicHttp(next)) throw Object.assign(Error('The page redirected to a non-public address.'), { code: 'bad_url' })
    current = next
  }
}

/* Fetch and decode one public page. Throws structured errors (with `code`)
 * for HTTP failures, unreadable types and redirect problems; the caller maps
 * aborts and transport errors. The abort signal covers the whole exchange,
 * including the body stream, so a stalled body cannot hang the reader. */
async function readPublicPage(fetchFn, url, signal) {
  const res = await fetchFollowingPublic(fetchFn, url, { signal, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'byok-chat-reader/1.0' } })
  if (!res.ok) {
    try { await res.body?.cancel?.() } catch {}
    const err = Error(`The page returned HTTP ${res.status}.`)
    err.code = res.status >= 500 ? 'upstream_unavailable' : 'bad_response'
    err.status = res.status
    err.retryable = res.status >= 500
    throw err
  }
  const type = res.headers.get?.('content-type') ?? ''
  if (type && !/html|xml|text/i.test(type)) {
    try { await res.body?.cancel?.() } catch {}
    const err = Error('That URL is not a readable page (only HTML/text).')
    err.code = 'bad_type'
    throw err
  }
  const reader = res.body?.getReader?.()
  let html = ''
  if (reader) {
    const dec = new TextDecoder()
    while (html.length <= EXTRACT_MAX_HTML) {
      const { done, value } = await reader.read()
      if (done) break
      html += dec.decode(value, { stream: true })
    }
    if (html.length > EXTRACT_MAX_HTML) {
      html = html.slice(0, EXTRACT_MAX_HTML)
      // Stop the upstream transfer instead of leaving the socket streaming.
      try { await reader.cancel() } catch {}
    }
  } else {
    html = (await res.text().catch(() => '')).slice(0, EXTRACT_MAX_HTML)
  }
  return htmlToText(html)
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
  try {
    const { title, text } = await readPublicPage(fetchFn, url, ac.signal)
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
  } catch (e) {
    if (e?.code) throw e // structured failures pass through unchanged
    const err = Error(e?.name === 'AbortError' ? 'The page took too long to respond.' : `Could not reach the page (${e?.message || 'network error'}).`)
    err.code = e?.name === 'AbortError' ? 'timeout' : 'network'
    err.retryable = true
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export { isPublicHttp }
