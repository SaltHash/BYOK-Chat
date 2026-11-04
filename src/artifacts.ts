/* Interactive HTML artifacts.
 *
 * The model writes semantic markup, never styling. The app owns the CSS and a
 * small class vocabulary; the artifact is rendered in a sandboxed iframe with
 * no network access and no same-origin privileges. Reports can carry the same
 * artifact as a fenced block, which avoids asking the report pass for tools. */

export const ARTIFACT_CLASSES = [
  'artifact-card',
  'artifact-grid',
  'artifact-stat',
  'artifact-title',
  'artifact-label',
  'artifact-muted',
  'artifact-accent',
  'artifact-badge',
  'artifact-table',
  'artifact-row',
  'artifact-note',
  'artifact-bar',
  'artifact-button',
] as const

export const ARTIFACT_CLASS_GUIDE = ARTIFACT_CLASSES.map((c) => `  .${c}`).join('\n')

export const ARTIFACT_INSTRUCTIONS = [
  'Write semantic HTML only. Prefer no classes at all; when structure needs help use only these app-owned classes:',
  ...ARTIFACT_CLASS_GUIDE.split('\n'),
  'Do not write <style>, style="…" attributes, colors, fonts, backgrounds, widths, or any other visual styling. The app supplies all styling and adapts it to the theme.',
  'Do not load external CSS, fonts, images, or scripts. Inline <script> is allowed only for local interaction and must not make network requests.',
  'Do not repeat the artifact HTML in your reply; the interface renders it in place.',
].join('\n')

export type ArtifactSpec = { title: string; html: string; height?: number }
export type ArtifactTheme = { bg: string; surf: string; tx: string; mu: string; bor: string; hov: string; ac: string; acx: string; er: string }

const FALLBACK_THEME: ArtifactTheme = {
  bg: '#ffffff', surf: '#f5f5f5', tx: '#171717', mu: '#666666',
  bor: '#dddddd', hov: '#eeeeee', ac: '#2563eb', acx: '#ffffff', er: '#dc2626',
}

const safeToken = (v: string, fallback: string) => /^[#(),.%\sa-zA-Z0-9-]+$/.test(v.trim()) ? v.trim() : fallback

/** Read the app's current theme tokens so the artifact feels native rather than
 *  like a model-styled island. Falls back safely outside a browser. */
export function artifactTheme(): ArtifactTheme {
  if (typeof document === 'undefined') return FALLBACK_THEME
  const cs = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => safeToken(cs.getPropertyValue(name), fallback)
  return {
    bg: read('--bg', FALLBACK_THEME.bg), surf: read('--surf', FALLBACK_THEME.surf),
    tx: read('--tx', FALLBACK_THEME.tx), mu: read('--mu', FALLBACK_THEME.mu),
    bor: read('--bor', FALLBACK_THEME.bor), hov: read('--hov', FALLBACK_THEME.hov),
    ac: read('--ac', FALLBACK_THEME.ac), acx: read('--acx', FALLBACK_THEME.acx),
    er: read('--er', FALLBACK_THEME.er),
  }
}

const allowedClasses = new Set<string>(ARTIFACT_CLASSES)

/** Strip model-authored presentation and keep only semantic markup plus the
 *  app's small class vocabulary. Scripts stay: the iframe is sandboxed and its
 *  CSP blocks every network request. */
export function sanitizeArtifactBody(html: string): string {
  let s = String(html ?? '')
  s = s.replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')
    .replace(/<(?:iframe|object|embed)\b[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, '')
    .replace(/<\/?font\b[^>]*>/gi, '')
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:bgcolor|background|color|face|alink|link|vlink)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:border|cellpadding|cellspacing|width|height|align|valign|size)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(fill|stroke|stop-color)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (_m, attr: string, value: string) => /^(?:none|currentColor)$/i.test(value.replace(/["']/g, '')) ? ` ${attr}=${value}` : ` ${attr}="currentColor"`)
    .replace(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/gi, (_m, _q, dq, sq) => {
      const keep = String(dq ?? sq ?? '').split(/\s+/).filter((c) => allowedClasses.has(c))
      return keep.length ? ` class="${keep.join(' ')}"` : ''
    })
    .replace(/\s(href|src|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*javascript:[^\s>]+/gi, ' $1="#"')
  return s.trim()
}

/** Build the full sandbox document. The CSP permits local inline interaction
 *  and data images only; there is no connect-src, so fetch/XHR/WebSocket all
 *  fail even before the sandbox denies same-origin access. */
export function artifactDocument(spec: ArtifactSpec, theme: ArtifactTheme = FALLBACK_THEME): string {
  const t = theme
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:${t.bg};color:${t.tx};font:14px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:14px}
h1,h2,h3{margin:0 0 .45em;line-height:1.25}
h1{font-size:1.2rem}h2{font-size:1.05rem}h3{font-size:.95rem}
p{margin:.45em 0}a{color:${t.ac}}
.artifact-card{border:1px solid ${t.bor};border-radius:12px;background:${t.surf};padding:14px}
.artifact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.artifact-stat{border:1px solid ${t.bor};border-radius:10px;background:${t.bg};padding:10px}
.artifact-title{font-weight:650;font-size:1rem}
.artifact-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:${t.mu}}
.artifact-muted{color:${t.mu}}
.artifact-accent{color:${t.ac};font-weight:650}
.artifact-badge{display:inline-block;border-radius:999px;background:${t.ac};color:${t.acx};padding:.1em .55em;font-size:.75rem;font-weight:600}
.artifact-table{width:100%;border-collapse:collapse;font-size:.85rem}
.artifact-table th,.artifact-table td{border-bottom:1px solid ${t.bor};padding:7px 6px;text-align:left;vertical-align:top}
.artifact-table th{color:${t.mu};font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.artifact-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid ${t.bor};padding:8px 0}
.artifact-bar{height:8px;border-radius:999px;background:${t.hov};overflow:hidden}
.artifact-bar>span{display:block;height:100%;background:${t.ac};border-radius:inherit}
.artifact-note{border-left:3px solid ${t.ac};background:${t.surf};padding:8px 10px;border-radius:0 8px 8px 0;color:${t.mu};font-size:.82rem}
.artifact-button{appearance:none;border:1px solid ${t.ac};border-radius:8px;background:${t.ac};color:${t.acx};padding:.4em .75em;font:inherit;font-weight:600;cursor:pointer}
.artifact-button:active{transform:translateY(1px)}
.artifact-button[data-secondary]{background:transparent;color:${t.ac}}
.artifact-button:focus-visible{outline:2px solid ${t.ac};outline-offset:2px}
</style></head><body>${sanitizeArtifactBody(spec.html)}</body></html>`
}

export function parseArtifactArgs(raw: string): ArtifactSpec | null {
  try {
    const v = JSON.parse(String(raw || '{}'))
    if (!v || typeof v !== 'object' || typeof v.title !== 'string' || typeof v.html !== 'string') return null
    const title = v.title.replace(/\s+/g, ' ').trim().slice(0, 120)
    const html = v.html.trim()
    if (!title || !html) return null
    const height = Math.max(160, Math.min(720, Math.round(Number(v.height) || 340)))
    return { title, html, height }
  } catch { return null }
}

/** Extract fenced report artifacts and return the report with those blocks
 *  removed. The fence is deliberately not a tool call: the report stream has no
 *  tools attached. */
export function extractArtifactBlocks(text: string): { text: string; artifacts: ArtifactSpec[] } {
  const artifacts: ArtifactSpec[] = []
  const out: string[] = []
  const src = String(text ?? '')
  const re = /^[ \t]*```html-artifact[ \t]*([^\n]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gim
  let last = 0
  for (const m of src.matchAll(re)) {
    out.push(src.slice(last, m.index))
    const head = m[1] ?? ''
    const attr = (name: string) => {
      const hit = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s]+))`, 'i').exec(head)
      return hit ? (hit[2] ?? hit[3] ?? hit[4] ?? '') : ''
    }
    const title = attr('title') || `Interactive artifact ${artifacts.length + 1}`
    const height = Number(attr('height')) || 340
    artifacts.push({ title: title.slice(0, 120), html: String(m[2] ?? '').trim(), height: Math.max(160, Math.min(720, Math.round(height))) })
    last = (m.index ?? 0) + m[0].length
  }
  out.push(src.slice(last))
  return { text: out.join('').replace(/\n{3,}/g, '\n\n').trim(), artifacts }
}

export const ARTIFACT_REPORT_NOTE = [
  'Optional interactive artifact: if a compact visual would materially help the reader, append at most one fenced block after the report:',
  '```html-artifact title="Short title" height="320"',
  '<div class="artifact-card">…semantic HTML…</div>',
  '```',
  `Allowed classes: ${ARTIFACT_CLASSES.join(', ')}. Prefer plain semantic HTML with no classes at all. Do not write <style>, style attributes, colors, fonts, SVG colors, external assets, or network requests. Omit the block entirely when a plain report is enough.`,
].join('\n')
