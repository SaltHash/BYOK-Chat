/* Pure canvas file-artifact helpers. No DOM, no store imports — kept side-effect
   free so the logic stays unit-testable from src/canvas.test.mjs. */

export const CANVAS_TOOL = 'canvas_upsert'
export const CANVAS_MAX_CONTENT = 50000
export const CANVAS_MAX_FILES = 8
export const CANVAS_MAX_PATH = 200
export const CANVAS_TRUNC_MARKER = '\n\n[truncated: content exceeded 50,000 characters]'

/** Coerce any model-supplied path to a safe relative zip entry. Never throws. */
export function sanitizePath(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : ''
  s = s.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')
  const segs = s.split('/').filter((x) => x.length > 0)
  const cleanSeg = (x: string) => x.replace(/[^A-Za-z0-9_\-.]+/g, '_').replace(/^\.+$/, '_').slice(0, 100)
  if (!segs.length) return 'file.txt'
  // Any parent traversal collapses to the basename in the zip root.
  if (segs.some((x) => x === '..')) {
    const base = cleanSeg(segs[segs.length - 1]) || 'file.txt'
    return /[A-Za-z0-9]/.test(base) ? base.slice(0, CANVAS_MAX_PATH) : 'file.txt'
  }
  const clean = segs.filter((x) => x !== '.').map(cleanSeg).filter(Boolean)
  if (!clean.length) return 'file.txt'
  const joined = clean.join('/')
  if (!/^[\w\-./]+$/.test(joined) || joined.length > CANVAS_MAX_PATH) {
    return (clean[clean.length - 1].slice(0, 100) || 'file.txt')
  }
  return joined
}

export function truncateCanvasContent(content: string, max = CANVAS_MAX_CONTENT): { text: string; truncated: boolean } {
  if (content.length > max) return { text: content.slice(0, max) + CANVAS_TRUNC_MARKER, truncated: true }
  return { text: content, truncated: false }
}

export type CanvasArgs = { action?: string; path?: string; language?: string; content?: string; label?: string }

/** Best-effort unescape of a JSON string fragment (tolerates a cut-off tail). */
function unescapeFragment(s: string): string {
  const t = s.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, '')
  try { return JSON.parse('"' + t + '"') } catch { /* fall through to manual */ }
  return t.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/**
 * Parse canvas tool arguments tolerantly. Full JSON parses exactly; truncated
 * streaming JSON falls back to prefix extraction of each field. Never throws.
 */
export function parseCanvasArgsPartial(raw: string): CanvasArgs {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: CanvasArgs = {}
      for (const k of ['action', 'path', 'language', 'content', 'label'] as const) {
        if (typeof (v as Record<string, unknown>)[k] === 'string') out[k] = (v as Record<string, string>)[k]
      }
      return out
    }
  } catch { /* truncated JSON — extract prefixes below */ }
  const out: CanvasArgs = {}
  for (const k of ['action', 'path', 'language', 'label'] as const) {
    const m = raw.match(new RegExp('"' + k + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)'))
    if (m) out[k] = unescapeFragment(m[1])
  }
  // Content may be cut mid-string: consume from its opening quote, honouring
  // escapes, and stop at the closing quote or end of input.
  const cm = raw.match(/"content"\s*:\s*"/)
  if (cm?.index != null) {
    let i = cm.index + cm[0].length, buf = ''
    while (i < raw.length) {
      const ch = raw[i]
      if (ch === '\\') { buf += ch + (raw[i + 1] ?? ''); i += 2; continue }
      if (ch === '"') break
      buf += ch; i++
    }
    out.content = unescapeFragment(buf)
  }
  return out
}

export type CanvasCallLike = { id: string; name: string; arguments: string }
export type CanvasVersion = { action: string; path: string; language: string; content: string; label?: string; callId: string }

/** Group canvas calls by sanitized path in message order. Caps distinct files. */
export function groupCanvasVersions(calls: CanvasCallLike[], limit = CANVAS_MAX_FILES): { path: string; versions: CanvasVersion[] }[] {
  const order: string[] = []
  const map = new Map<string, CanvasVersion[]>()
  for (const c of calls) {
    if (c?.name !== CANVAS_TOOL && c?.name) continue
    const a = parseCanvasArgsPartial(typeof c.arguments === 'string' ? c.arguments : '')
    const path = sanitizePath(a.path ?? '')
    const v: CanvasVersion = {
      action: typeof a.action === 'string' && a.action ? a.action : 'create',
      path,
      language: typeof a.language === 'string' ? a.language : '',
      content: typeof a.content === 'string' ? a.content : '',
      label: typeof a.label === 'string' ? a.label : undefined,
      callId: c.id,
    }
    if (!map.has(path)) { map.set(path, []); order.push(path) }
    map.get(path)!.push(v)
  }
  return order.slice(0, limit).map((path) => ({ path, versions: map.get(path)! }))
}

/** Count distinct canvas files across calls (pre-cap). */
export function countCanvasFiles(calls: CanvasCallLike[]): number {
  return groupCanvasVersions(calls, Number.MAX_SAFE_INTEGER).length
}

/** Dedupe sanitized zip entry paths, suffixing -2, -3 before the extension. */
export function buildZipEntries(files: { path: string; content: string }[]): { path: string; content: string }[] {
  const used = new Set<string>()
  return files.map((f) => {
    let p = sanitizePath(f.path)
    if (used.has(p)) {
      const slash = p.lastIndexOf('/'), dot = p.lastIndexOf('.')
      const stem = dot > slash + 1 ? p.slice(0, dot) : p
      const ext = dot > slash + 1 ? p.slice(dot) : ''
      let n = 2
      while (used.has(`${stem}-${n}${ext}`)) n++
      p = `${stem}-${n}${ext}`
    }
    used.add(p)
    return { path: p, content: typeof f.content === 'string' ? f.content : String(f.content ?? '') }
  })
}

/** Zip filename from the first file's top-level directory, else a default. */
export function zipFilename(files: { path: string }[]): string {
  if (!files.length) return 'canvas-files.zip'
  const first = sanitizePath(files[0].path)
  if (first.includes('/')) {
    const top = first.split('/')[0].replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 60) || 'canvas'
    return `${top}.zip`
  }
  return 'canvas-files.zip'
}

export const canvasSize = (s: string) => {
  const n = new TextEncoder().encode(s).length
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`
}
export const canvasLines = (s: string) => (s ? s.split('\n').length : 0)
