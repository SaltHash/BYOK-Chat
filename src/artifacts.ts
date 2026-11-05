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
  'artifact-chart',
  'artifact-legend',
  'artifact-swatch',
] as const

export const ARTIFACT_CLASS_GUIDE = ARTIFACT_CLASSES.map((c) => `  .${c}`).join('\n')

/** How a chart is written without any styling of its own: one inline SVG with a
 *  viewBox, series grouped by `data-series`, and axes in a muted group. */
export const ARTIFACT_CHART_GUIDE = [
  'Charts: <figure class="artifact-chart"><svg viewBox="0 0 W H">…</svg><figcaption>…</figcaption></figure>. Give the SVG a viewBox and no width/height: the app sizes it to the full width of the reply.',
  'Inside the SVG, group each series in <g data-series="1"> … <g data-series="5">; the app colors each group from the theme, so draw its shapes with fill="currentColor" or stroke="currentColor".',
  'Put axes, gridlines, and tick labels in <g class="artifact-muted">. Axis text inherits its color, so leave fill off <text>.',
  'Name the series in <div class="artifact-legend"><span><i class="artifact-swatch" data-series="1"></i>Exa</span>…</div>, matching each swatch data-series to its group.',
  'Meters: <div class="artifact-bar" data-value="72"><span></span></div> renders a filled bar for 0-100; do not set widths yourself.',
].join('\n')

export const ARTIFACT_INSTRUCTIONS = [
  'Write semantic HTML only. Prefer no classes at all; when structure needs help use only these app-owned classes:',
  ...ARTIFACT_CLASS_GUIDE.split('\n'),
  ...ARTIFACT_CHART_GUIDE.split('\n'),
  'Do not write <style>, style="…" attributes, colors, fonts, backgrounds, widths, or any other visual styling. The app supplies all styling and adapts it to the theme.',
  'Do not load external CSS, fonts, images, or scripts. Inline <script> is allowed only for local interaction and must not make network requests.',
  'Do not repeat the artifact HTML in your reply; the interface renders it in place.',
].join('\n')

export type ArtifactSpec = { title: string; html: string; height?: number }
export type ArtifactTheme = {
  bg: string; surf: string; tx: string; mu: string; bor: string; hov: string; ac: string; acx: string; er: string
  /** Chart palette for `data-series` groups; falls back to the accent. */
  c2?: string; c3?: string; c4?: string; c5?: string
}

const FALLBACK_THEME: ArtifactTheme = {
  bg: '#ffffff', surf: '#f5f5f5', tx: '#171717', mu: '#666666',
  bor: '#dddddd', hov: '#eeeeee', ac: '#2563eb', acx: '#ffffff', er: '#dc2626',
  c2: '#0f766e', c3: '#b45309', c4: '#7c3aed', c5: '#be123c',
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
    c2: read('--c2', FALLBACK_THEME.c2 ?? FALLBACK_THEME.ac),
    c3: read('--c3', FALLBACK_THEME.c3 ?? FALLBACK_THEME.ac),
    c4: read('--c4', FALLBACK_THEME.c4 ?? FALLBACK_THEME.ac),
    c5: read('--c5', FALLBACK_THEME.c5 ?? FALLBACK_THEME.ac),
  }
}

const allowedClasses = new Set<string>(ARTIFACT_CLASSES)

/** Strip model-authored presentation and keep only semantic markup plus the
 *  app's small class vocabulary. Scripts stay: the iframe is sandboxed and its
 *  CSP blocks every network request.
 *
 *  SVG geometry (viewBox, x/y, cx/cy, r, d, points, width/height, …) is kept:
 *  a chart cannot be drawn without it. Colors are not: every fill and stroke is
 *  forced to `currentColor`, so the app theme — or a `data-series` group —
 *  decides the palette. */
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
    .replace(/\s(?:border|cellpadding|cellspacing|align|valign|size)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
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
 *  fail even before the sandbox denies same-origin access.
 *
 *  The body is transparent and flush with the reply, so the artifact reads as
 *  part of the message instead of a tinted panel. A tiny local script fills
 *  `data-value` meters and reports the content height, which the frame uses to
 *  size itself exactly (no clipped charts, no scrollbars, no dead space). */
export function artifactDocument(spec: ArtifactSpec, theme: ArtifactTheme = FALLBACK_THEME): string {
  const t = theme
  const c2 = t.c2 ?? t.ac
  const c3 = t.c3 ?? t.ac
  const c4 = t.c4 ?? t.ac
  const c5 = t.c5 ?? t.ac
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
html,body{margin:0;background:transparent;overflow:hidden}
body{color:${t.tx};font:13.5px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:1px 0;overflow-wrap:break-word}
h1,h2,h3,h4{margin:0 0 .4em;line-height:1.3;font-weight:650}
h1{font-size:1.08rem}h2{font-size:.98rem}h3{font-size:.9rem}
h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:${t.mu}}
p{margin:.4em 0}
small{font-size:.8rem;color:${t.mu}}
strong,b{font-weight:650}
ul,ol{margin:.4em 0;padding-left:1.15em}
li+li{margin-top:.15em}
hr{border:0;border-top:1px solid ${t.bor};margin:.9em 0}
blockquote{margin:.5em 0;padding:.1em 0 .1em .8em;border-left:3px solid ${t.ac};color:${t.mu}}
a{color:${t.ac}}
code,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em;background:${t.hov};border-radius:5px;padding:.1em .35em}
img,svg{max-width:100%;height:auto}
svg{display:block;fill:currentColor}
figure{margin:.55em 0}
figcaption{font-size:.76rem;color:${t.mu};margin-top:.45em}
.artifact-card{border:1px solid ${t.bor};border-radius:12px;background:${t.surf};padding:14px}
.artifact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.artifact-stat{border:1px solid ${t.bor};border-radius:10px;background:${t.bg};padding:10px}
.artifact-title{font-weight:650;font-size:1rem;line-height:1.35}
.artifact-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${t.mu}}
.artifact-muted{color:${t.mu}}
.artifact-accent{color:${t.ac};font-weight:650}
.artifact-badge{display:inline-block;border-radius:999px;background:${t.ac};color:${t.acx};padding:.1em .55em;font-size:.75rem;font-weight:600}
.artifact-table{width:100%;border-collapse:collapse;font-size:.82rem}
.artifact-table th,.artifact-table td{border-bottom:1px solid ${t.bor};padding:6px 8px;text-align:left;vertical-align:top}
.artifact-table th{color:${t.mu};font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.artifact-table tbody tr:hover{background:${t.hov}}
.artifact-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid ${t.bor};padding:8px 0}
.artifact-bar{height:8px;border-radius:999px;background:${t.hov};overflow:hidden}
.artifact-row .artifact-bar{flex:1 1 auto;min-width:56px}
.artifact-bar>span{display:block;height:100%;background:${t.ac};border-radius:inherit}
.artifact-note{border-left:3px solid ${t.ac};background:${t.surf};padding:8px 10px;border-radius:0 8px 8px 0;color:${t.mu};font-size:.82rem}
.artifact-button{appearance:none;border:1px solid ${t.ac};border-radius:8px;background:${t.ac};color:${t.acx};padding:.4em .75em;font:inherit;font-weight:600;cursor:pointer}
.artifact-button:active{transform:translateY(1px)}
.artifact-button[data-secondary]{background:transparent;color:${t.ac}}
.artifact-button:focus-visible{outline:2px solid ${t.ac};outline-offset:2px}
/* Charts: the app owns sizing, palette and axis type. The model supplies one
 * SVG with a viewBox; every fill and stroke is currentColor, so data-series is
 * all it takes to color a series. */
.artifact-chart{min-width:0}
.artifact-chart svg{display:block;width:100%;height:auto;margin-inline:auto;overflow:visible;fill:currentColor}
.artifact-chart svg text{font-size:11px;font-variant-numeric:tabular-nums}
.artifact-legend{display:flex;flex-wrap:wrap;gap:.3em .9em;margin-top:.5em;font-size:.76rem;color:${t.mu}}
.artifact-legend>span{display:inline-flex;align-items:center;gap:.42em}
.artifact-swatch{display:inline-block;flex:none;width:.62em;height:.62em;border-radius:999px;background:currentColor}
[data-series="1"]{color:${t.ac}}
[data-series="2"]{color:${c2}}
[data-series="3"]{color:${c3}}
[data-series="4"]{color:${c4}}
[data-series="5"]{color:${c5}}
[data-series="0"]{color:${t.mu}}
</style></head><body>${sanitizeArtifactBody(spec.html)}<script>(function(){
var bars=document.querySelectorAll('.artifact-bar[data-value]');
for(var i=0;i<bars.length;i++){var b=bars[i];var v=Number(b.getAttribute('data-value'));v=isFinite(v)?Math.max(0,Math.min(100,v)):0;var s=b.firstElementChild;if(!s||s.tagName!=='SPAN'){s=document.createElement('span');b.appendChild(s)}s.style.width=v+'%'}
var last=-1;
/* An SVG scales its text with its viewBox, so a small chart stretched across a
 * wide reply would read like a poster. Cap the upscale instead. */
function fit(){var ss=document.querySelectorAll('svg');for(var i=0;i<ss.length;i++){var s=ss[i];var vb=s.viewBox&&s.viewBox.baseVal;if(!vb||!vb.width)continue;s.style.maxWidth=Math.max(220,Math.min(760,Math.round(vb.width*1.35)))+'px'}}
function post(){fit();var h=Math.ceil(document.body.getBoundingClientRect().height);if(h!==last){last=h;try{parent.postMessage({source:'byok-artifact',height:h},'*')}catch(e){}}}
post();addEventListener('load',post);setTimeout(post,60);setTimeout(post,400);
if(window.ResizeObserver)new ResizeObserver(post).observe(document.body);
})()</script></body></html>`
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
  `Allowed classes: ${ARTIFACT_CLASSES.join(', ')}. Prefer plain semantic HTML with no classes at all. ${ARTIFACT_CHART_GUIDE} Do not write <style>, style attributes, colors, fonts, SVG colors, external assets, or network requests. Omit the block entirely when a plain report is enough.`,
].join('\n')
