import { createElement, memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import remarkEmoji from 'remark-emoji'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import remend from 'remend'
import { rehypeFade } from '../streamFade'
import { common } from 'lowlight'
import { Check, Copy, FileText, ImageOff } from 'lucide-react'
import { Btn, cx, ImageLightbox, TextLightbox, ZoomableImage } from './ui'
import { loadChunk } from '../chunkLoad'
import { useS } from '../store'
import { friendlyFileName, promptNameOf } from '../attachments'
import type { CiteSource } from '../citations'

export type CiteMap = { sources: CiteSource[]; onCite?: (citeId: string) => void }

/** A file citation in a reply ([Paste 1], [Image 2], or an older [file-1]).
 *  Clicking it opens the file it names. The attachment is resolved on click:
 *  it lives on the request message, not on the reply that cites it. */
function FileCitePill({ name }: { name: string }) {
  const [text, setText] = useState<{ title: string; text: string } | null>(null)
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null)
  const label = friendlyFileName(name)
  const open = () => {
    const s = useS.getState()
    const want = name.toLowerCase()
    const files = s.chats.flatMap((c) => c.msgs.flatMap((m) => m.att ?? []))
    const hit = files.find((a) => promptNameOf(a).toLowerCase() === want)
      ?? files.find((a) => promptNameOf(a).replace(/\.[a-z0-9]{1,8}$/i, '').toLowerCase() === want)
    if (!hit) { s.patch({ notice: { t: `${label} is no longer available in this conversation.` } }); return }
    if (hit.text) setText({ title: hit.name, text: hit.text })
    else if (hit.kind === 'img' && hit.data) setImg({ src: `data:${hit.mime || 'image/png'};base64,${hit.data}`, alt: hit.name })
    else s.patch({ notice: { t: `${hit.name} has no readable text to open.` } })
  }
  return (
    <>
      <button
        type="button"
        onClick={open}
        title={`Open the attached file: ${label}`}
        className="mx-0.5 inline-flex cursor-pointer items-baseline gap-1 rounded-md border border-bor bg-hov px-1.5 align-baseline text-xs font-medium leading-5 text-tx transition-colors hover:border-ac/60 hover:bg-surf focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ac/40"
      >
        <FileText size={11} className="shrink-0 translate-y-px text-mu" aria-hidden="true" />
        {label}
      </button>
      {text && <TextLightbox text={text.text} title={text.title} close={() => setText(null)} />}
      {img && <ImageLightbox src={img.src} alt={img.alt} close={() => setImg(null)} />}
    </>
  )
}

const normCiteUrl = (u: string) => {
  try { return new URL(u).toString().replace(/\/$/, '').toLowerCase() } catch { return u.replace(/\/$/, '').toLowerCase() }
}

/* ---- pre-processing for syntax the parser does not know ---- */
const FENCE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/
const INLINE = /(`[^`\n]*`)/

/* Inline math `$…$` follows Pandoc's dollar-math rules: the opening `$` is not
 * followed by a space, and the closing `$` is neither preceded by a space nor
 * followed by a digit. Pairing two prices instead ("Pro is $20/mo, Max is
 * $100/mo", "$4/$20", "$0.75–$2.00") handed prose to KaTeX, which can only
 * paint it in the error color (errorColor: var(--er)) or, when the words happen
 * to parse as variables, render it as an equation. */
const mathEnd = (s: string, from: number): number => {
  for (let j = from; j < s.length; j++) {
    const c = s[j]
    if (c === '\n') return -1
    if (c !== '$' || s[j - 1] === '\\') continue
    if (/\s/.test(s[j - 1] ?? '') || /\d/.test(s[j + 1] ?? '')) return -1
    return j
  }
  return -1
}

/** Split into [prose, math, prose, math, …]; math spans keep their delimiters.
 *  `$$…$$` is display math, which no price can be mistaken for. */
const splitMath = (s: string): string[] => {
  const parts: string[] = []
  let last = 0
  let i = 0
  while (i < s.length) {
    if (s[i] !== '$' || s[i - 1] === '\\') { i++; continue }
    if (s[i + 1] === '$') {
      const close = s.indexOf('$$', i + 2)
      if (close < 0) break
      parts.push(s.slice(last, i), s.slice(i, close + 2))
      i = last = close + 2
      continue
    }
    if (/\s/.test(s[i + 1] ?? '')) { i++; continue }
    const close = mathEnd(s, i + 1)
    if (close < 0) { i++; continue }
    parts.push(s.slice(last, i), s.slice(i, close + 1))
    i = last = close + 1
  }
  parts.push(s.slice(last))
  return parts
}

const hasMath = (s: string) => splitMath(s).length > 2

// "Term\n: definition" becomes a <dl>; blank lines let inline markdown inside it still render
const defs = (t: string) =>
  t.replace(/^(?![:#>|*+\-`~<\s])([^\n]+)\n((?:: [^\n]*(?:\n[ \t]+[^\n]*)*\n?)+)/gm, (_, term: string, body: string) =>
    '<dl>\n\n' + `<dt>\n\n${term.trim()}\n\n</dt>\n\n` +
    body.split(/^: /m).filter(Boolean).map((d) => `<dd>\n\n${d.replace(/\n[ \t]+/g, ' ').trim()}\n\n</dd>\n\n`).join('') + '</dl>\n\n')

/* Everything that only applies outside math: the file-citation markers, Pandoc
 * sup/sub, and a stray backslash a model added to a numeric range. Math spans
 * are handed to remark-math exactly as written. */
const proseFix = (q: string) => q
  // Models sometimes escape a digit ("~5–\\6") as if a numeric range were
  // arithmetic; a backslash before a digit is never markdown, so drop it.
  .replace(/\\(?=\d)/g, '')
  // A bare attachment citation such as [paste-1], [image-2.png] or an older
  // [file-1] is not a markdown link, so it would otherwise render as plain
  // brackets. It becomes a link-shaped marker the `a` renderer turns into a
  // file pill.
  .replace(/(?<!!)\[((?:image|paste|document|media|file)-\d+(?:\.[a-z0-9]{1,8})?)\](?!\(|\s*:)/gi, '[$1](#file-cite:$1)')
  .replace(/\^([^\s^]+)\^/g, '<sup>$1</sup>')                                          // Pandoc superscript
  .replace(/(?<!~)~([^\s~]+)~(?!~)/g, '<sub>$1</sub>')                                 // Pandoc subscript
  // A dollar that did not open or close a math span is a literal price. Escaping
  // it keeps it literal for the markdown parser too, whose own inline-math rule
  // is more lenient and would pair "$20–$100+" into an equation.
  .replace(/(?<!\\)\$/g, '\\$')

/** Whether the delimiter at `index` in `s` is the first thing on its line. */
const startsLine = (s: string, index: number) => /^\s*$/.test(s.slice(s.lastIndexOf('\n', index - 1) + 1, index))

/* `$$` that opens a line is *flow* math: the rest of that opening line is read
 * as a fence info string and dropped, and the block only closes at a `$$` that
 * starts a line of its own. A model that opens a block on its own line and
 * closes it at the end of the last line ("$$L=\\int…\\approx 15.3$$") therefore
 * hands the parser an unterminated block, which runs to the next `$$` line or
 * to the end of the reply — and KaTeX paints all of it in the error colour.
 * Re-emit such a span with both delimiters on their own lines, which is what the
 * model meant. The mirror case (opened mid-sentence, closed on a later line)
 * leaves a `$$` starting that later line, where it opens another doomed block,
 * so it is pulled back up onto the opening line as the inline math it is. */
const displayMath = (span: string, before: string): string => {
  const body = span.slice(2, -2)
  const opensLine = /^\s*$/.test(before.slice(before.lastIndexOf('\n') + 1))
  const closesLine = startsLine(span, span.length - 2)
  if (opensLine) {
    if (closesLine || !body.includes('\n')) return span
    return `\n$$\n${body.trim()}\n$$\n`
  }
  return closesLine ? `$$${body.trim()}$$` : span
}

const fix = (t: string) => {
  const chunks = t.split(INLINE)
  return chunks.map((p, i) => {
    if (i % 2) return p
    const before = i ? chunks[i - 1] : ''
    const parts = splitMath(p
      .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => '$$' + m + '$$')                         // \( x \) -> inline math
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => '\n\n$$\n' + m.trim() + '\n$$\n\n'))     // \[ x \] -> display math
    return parts.map((q, j) => (j % 2 ? displayMath(q, j ? parts[j - 1] : before) : proseFix(q))).join('')
  }).join('')
}

const pre = (src: string) => src.split(FENCE).map((p, i) => (i % 2 ? p : fix(defs(p)))).join('')

/* ---- sanitising: raw HTML is allowed, scripts, iframes, styles and handlers are not ---- */
const A: Record<string, any[]> = (defaultSchema.attributes ?? {}) as any
const drop = (tag: string, name: string) => (A[tag] ?? []).filter((x) => (Array.isArray(x) ? x[0] : x) !== name)
const schema: any = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), 'mark', 'kbd'])],
  attributes: {
    ...A,
    a: [...(A.a ?? []), 'id', 'dataFootnoteBackref', 'dataFootnoteRef', 'ariaLabel', 'ariaDescribedBy'],
    section: [...(A.section ?? []), 'dataFootnotes'],
    h2: [...(A.h2 ?? []), 'id'],
    li: [...(A.li ?? []), 'id'],
    span: [...drop('span', 'className'), ['className', 'math', 'math-inline', 'math-display']],
    div: [...drop('div', 'className'), ['className', 'math', 'math-display']],
    code: [...drop('code', 'className'), ['className', /^language-./, 'math-inline', 'math-display']],
    th: [...drop('th', 'align'), 'align', ['style', /^text-align:\s*(left|right|center);?$/]],
    td: [...drop('td', 'align'), 'align', ['style', /^text-align:\s*(left|right|center);?$/]],
  },
}

// Remark + rehype pipelines are identical for every render; hoist them so they
// are allocated once rather than on every streamed word.
const BASE_PLUGINS: any = [[remarkGfm, { singleTilde: false }], remarkMath, remarkBreaks, remarkEmoji]

/* mdast-util-to-hast prefixes footnote ids *and* their `#` links with
 * `user-content-`, and rehype-sanitize then prefixes the ids a second time —
 * so a footnote link pointed at `#user-content-fn-1` while the footnote id
 * read `user-content-user-content-fn-1`: they did not match. Emit ids bare
 * (`clobberPrefix: ''` on the remark-rehype step) and retarget
 * intra-document links here, so every id is still prefixed exactly once (by
 * the sanitizer) and each `#…` link keeps pointing at its element. */
const rehypeFixAnchors = () => (tree: any) => {
  const ids = new Set<string>()
  const walk = (n: any, fn: (el: any) => void) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'element') fn(n)
    if (Array.isArray(n.children)) for (const c of n.children) walk(c, fn)
  }
  walk(tree, (el) => { const id = el.properties?.id; if (typeof id === 'string' && id) ids.add(id) })
  if (!ids.size) return
  walk(tree, (el) => {
    const href = el.properties?.href
    if (typeof href === 'string' && href.startsWith('#') && ids.has(href.slice(1))) el.properties.href = `#user-content-${href.slice(1)}`
  })
}

const REHYPE_BASE: any = [rehypeRaw, rehypeFixAnchors, [rehypeSanitize, schema]]
/* `common` covers the everyday languages (js/ts, python, json, bash, yaml,
 * sql, html/css, …). The full `all` set is ~1.2 MB of grammars for languages
 * that essentially never show up, and unknown languages are skipped anyway
 * (`ignoreMissing` below). */
const REHYPE_HIGHLIGHT: any = [rehypeHighlight, { detect: false, ignoreMissing: true, languages: common }]

/* KaTeX plus its fonts is far larger than the rest of the pipeline and only
 * matters for replies that actually contain math, so the plugin and its
 * stylesheet load on first use. Until they arrive the math source renders as
 * plain text (remark-math's fallback), which is readable and stable. */
let katexPlugins: any[] | null = null
let katexLoad: Promise<void> | null = null
const loadKatex = (): Promise<void> => (katexLoad ??= loadChunk(() => Promise.all([
  import('rehype-katex'),
  import('katex/dist/katex.min.css'),
])).then(([m]) => { katexPlugins = [[m.default, { throwOnError: false, strict: 'ignore', errorColor: 'var(--er)' }]] })
  // A failed load must not be memoised: the next reply with math has to retry.
  .catch((error) => { katexLoad = null; throw error }))

/* ---- components ---- */
const E = (T: string, c: string) => ({ node, className, ...p }: any) => createElement(T, { ...p, className: cx(c, className) })
const txt = (n: any): string => (n.type === 'text' ? n.value : (n.children ?? []).map(txt).join(''))
const link = 'text-ac underline decoration-ac/40 underline-offset-2 hover:decoration-ac'

/* Split highlighted code into logical source lines so the gutter can give each
 * one a row of its own: a line that soft-wraps grows its own row, so its number
 * stays level with the first row of the wrap instead of drifting. Inline
 * elements that straddle a newline (a multi-line string or comment) are cloned
 * once per line, so the highlighting survives the split. */
const splitLines = (nodes: any[]): any[][] => {
  const lines: any[][] = [[]]
  for (const n of nodes) {
    if (n.type === 'text') {
      n.value.split('\n').forEach((part: string, i: number) => {
        if (i) lines.push([])
        if (part) lines[lines.length - 1].push({ type: 'text', value: part })
      })
    } else if (n.children?.length) {
      const parts = splitLines(n.children)
      if (parts.length === 1) lines[lines.length - 1].push({ ...n, children: parts[0] })
      else parts.forEach((children, i) => {
        if (i) lines.push([])
        if (children.length) lines[lines.length - 1].push({ ...n, children })
      })
    } else lines[lines.length - 1].push(n)
  }
  return lines
}

/* Code blocks only contain text and class-bearing spans, so rendering the split
 * lines here matches what react-markdown would have emitted for the block. */
const hastJsx = (n: any, key: number): ReactNode =>
  n.type === 'text'
    ? n.value
    : createElement(n.tagName ?? 'span', { key, className: (n.properties?.className ?? []).join(' ') || undefined }, (n.children ?? []).map(hastJsx))

function Code({ lang, code, node, children, bare, className }: { lang: string; code: string; node?: any; children: ReactNode; bare?: boolean; /** `sd-fade`, when a streaming reply fades this block in as one unit. */ className?: string }) {
  const [ok, setOk] = useState(false)
  const [copiedLine, setCopiedLine] = useState<number | null>(null)
  const lineNumbers = useS((s) => s.prefs.codeLines === true)
  const maxHeight = useS((s) => s.prefs.codeMaxHeight ?? 0)
  if (bare) {
    return (
      <pre className={cx('overflow-x-auto px-6 py-5 font-mono text-sm leading-6', className)}>{children}</pre>
    )
  }
  /* The gutter and the code share one scroll container (and one height cap), so
   * they can never scroll apart: one bar for both axes. A very long block keeps
   * its own scrollbar instead of stretching the whole transcript. */
  const total = code ? code.split('\n').length : 0
  const sourceLines = code ? code.split('\n') : []
  // Rows are always split: each one carries its own hover copy control, and
  // the gutter is simply left off when line numbers are disabled.
  const rows = node ? splitLines(node.children ?? []) : null
  // The highlighted tree can carry a trailing newline the copied text drops;
  // keep the gutter to exactly the logical line count of `code`.
  if (rows) {
    rows.length = Math.min(rows.length, total)
    while (rows.length < total) rows.push([])
  }
  return (
    <div className={cx('my-4 overflow-hidden rounded-xl bg-code', className)}>
      <div className="code-head flex items-center justify-between bg-side px-4 py-2 text-xs">
        <span className="font-medium text-mu">{lang || 'text'}</span>
        <button onClick={() => { const p = navigator.clipboard?.writeText(code); if (!p) return; void p.then(() => { setOk(true); setTimeout(() => setOk(false), 1200) }).catch(() => {}) }} className="inline-flex items-center gap-1.5 text-mu hover:text-tx">
          {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="code-scroll" style={maxHeight > 0 ? { maxHeight } : undefined}>
        {rows ? (
          <div
            className="code-lines font-mono text-sm leading-6"
            style={{ '--code-gutter': lineNumbers ? `calc(${String(Math.max(total, 1)).length}ch + 1.35rem)` : '0px' } as any}
          >
            {rows.map((line, i) => (
              <div key={i} className="code-line">
                {lineNumbers && <span aria-hidden="true" className="code-num select-none text-mu/60">{i + 1}</span>}
                <code className="code-src">{line.map(hastJsx)}</code>
                <span className="code-line-end">
                  <button
                    type="button"
                    title="Copy this line"
                    aria-label={`Copy line ${i + 1}`}
                    onClick={() => {
                      const p = navigator.clipboard?.writeText(sourceLines[i] ?? '')
                      if (!p) return
                      void p.then(() => { setCopiedLine(i); setTimeout(() => setCopiedLine((cur) => (cur === i ? null : cur)), 1200) }).catch(() => {})
                    }}
                    className="line-copy"
                  >
                    {copiedLine === i ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <pre className="font-mono text-sm leading-6">{children}</pre>
        )}
      </div>
    </div>
  )
}

/* A model-authored reply must not silently beacon the reader's IP to an
 * arbitrary host, so remote images are click-to-load by default (inline and
 * app-relative sources still render immediately). The toggle lives in
 * Settings → Chats ("Load remote images"). */
function RemoteImage({ src, alt, title, className }: { src?: string; alt?: string; title?: string; className?: string }) {
  const allow = useS((s) => s.prefs.remoteImages === true)
  const [loaded, setLoaded] = useState(false)
  const remote = /^https?:\/\//i.test(src ?? '')
  if (!remote || allow || loaded) return <ZoomableImage src={src ?? ''} alt={alt} title={title} loading="lazy" referrerPolicy="no-referrer" className={cx('my-3 max-h-96 max-w-full rounded-xl bg-surf', className)} />
  let host = src ?? ''
  try { host = new URL(src ?? '').host || host } catch { /* keep the raw URL */ }
  return (
    <span className={cx('my-3 flex flex-wrap items-center gap-2 rounded-xl border border-bor bg-surf px-3 py-2 text-xs text-mu', className)}>
      <ImageOff size={14} className="shrink-0 text-ac" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Remote image{alt ? ` — ${alt}` : ''} from {host}</span>
      <Btn v="soft" compact onClick={() => setLoaded(true)}>Load image</Btn>
      <Btn v="solid" compact onClick={() => useS.setState({ prefs: { ...useS.getState().prefs, remoteImages: true } })}>Always load</Btn>
    </span>
  )
}

const makeC = (bare: boolean, cites: CiteMap | undefined, live: boolean): any => ({
  h1: E('h1', 'mb-3 mt-6 text-2xl font-semibold'),
  h2: E('h2', 'mb-2 mt-5 text-xl font-semibold'),
  h3: E('h3', 'mb-2 mt-4 text-lg font-semibold'),
  h4: E('h4', 'mb-1.5 mt-3 font-semibold'),
  h5: E('h5', 'mb-1 mt-3 text-sm font-semibold'),
  h6: E('h6', 'mb-1 mt-3 text-sm font-medium text-mu'),
  p: E('p', 'my-3'),
  del: E('del', 'text-mu'),
  mark: E('mark', 'rounded bg-ac/25 px-1 text-tx'),
  kbd: E('kbd', 'rounded-md bg-hov px-1.5 py-0.5 text-xs font-medium'),
  hr: E('hr', 'my-6 h-px border-0 bg-hov'),
  blockquote: E('blockquote', 'my-4 border-l-2 border-ac/60 py-1 pl-4 pr-1 text-mu [&>p]:my-2'),
  ol: E('ol', 'my-3 list-decimal space-y-1 pl-6 marker:text-mu'),
  ul: ({ node, className, ...p }: any) => createElement('ul', { ...p, className: cx('my-3 space-y-1', /contains-task-list/.test(className ?? '') ? 'list-none pl-1' : 'list-disc pl-6 marker:text-mu') }),
  li: E('li', 'pl-1 [&>ol]:my-1 [&>p]:my-1 [&>ul]:my-1'),
  input: ({ type, checked }: any) => (type === 'checkbox'
    ? <span role="checkbox" aria-label="Task complete" aria-checked={!!checked} aria-disabled="true" className={cx('mr-2 inline-grid size-4 translate-y-0.5 place-items-center rounded border', checked ? 'border-ac bg-ac text-acx' : 'border-mu/60 bg-bg text-transparent')}>{checked && <Check size={12} strokeWidth={3} />}</span> : null),
  a: ({ node, href, children, ...p }: any) => {
    // Attachment citations ([file-1], [file-2.pdf]) render as their own pill:
    // neutral surface, file icon, no link behaviour and no source styling.
    if (typeof href === 'string' && href.startsWith('#file-cite:')) {
      return <FileCitePill key={href} name={decodeURIComponent(href.slice('#file-cite:'.length))} />
    }
    /* A streaming reply has links whose URL is half-written; `remend` closes
     * the syntax so the label renders at once, pointing it at a placeholder
     * the sanitizer then drops. Show the label as pending text instead of a
     * link with no target; settled replies keep their normal anchor. */
    if (live && !href) {
      return <span className="text-ac underline decoration-ac/40 decoration-dotted underline-offset-2">{children}</span>
    }
    // Citation links ([S1] pointing at a known source) render as pills that
    // jump to the Sources entry below (description first); the entry itself
    // carries the Open-website button. Everything else stays a normal link.
    if (cites?.sources.length) {
      const label = Array.isArray(children) ? children.map((c) => (typeof c === 'string' ? c : '')).join('').trim() : (typeof children === 'string' ? children.trim() : '')
      const m = /^(S\d+)$/i.exec(label)
      if (m) {
        const hit = cites.sources.find((s) => s.citeId.toUpperCase() === m[1].toUpperCase() && normCiteUrl(s.url) === normCiteUrl(href ?? ''))
          ?? cites.sources.find((s) => normCiteUrl(s.url) === normCiteUrl(href ?? ''))
        if (hit) {
          return (
            <button
              type="button"
              onClick={(e) => {
                // Ctrl/Cmd-click keeps the in-app Sources list out of the way
                // and opens the actual source page in a new tab, like a link.
                if (e.ctrlKey || e.metaKey) { e.preventDefault(); window.open(hit.url, '_blank', 'noopener,noreferrer'); return }
                cites.onCite?.(hit.citeId)
              }}
              title={`${hit.title} — ${hit.host}. Jump to source, or Ctrl/Cmd-click to open the page.`}
              aria-label={`Jump to source ${hit.citeId}: ${hit.title}`}
              className="mx-0.5 inline-block min-h-6 min-w-6 whitespace-nowrap rounded-md bg-ac/15 px-1.5 text-center align-baseline font-mono text-xs font-semibold leading-6 text-ac underline decoration-ac/40 underline-offset-2 hover:bg-ac/25"
            >
              {hit.citeId.replace(/^S/i, '')}
            </button>
          )
        }
      }
    }
    return (/^#/.test(href ?? '')
    ? <a {...p} href={href} className={link}>
      {children}
    </a>
    : <a {...p} href={href} target="_blank" rel="noopener noreferrer nofollow" className={link}>{children}</a>)
  },
  img: ({ node, src, alt, title, className }: any) => (live && !src
    ? <span className={cx('my-3 inline-flex items-center gap-2 rounded-xl border border-bor bg-surf px-3 py-2 text-xs text-mu', className)}><ImageOff size={14} className="shrink-0 text-ac" aria-hidden="true" />{alt ? `Loading ${alt}…` : 'Loading image…'}</span>
    : <RemoteImage src={src} alt={alt} title={title} className={className} />),
  table: ({ className, children }: any) => <div className="my-4 overflow-x-auto rounded-xl bg-surf"><table className={cx('w-full border-collapse text-sm', className)}>{children}</table></div>,
  thead: E('thead', 'bg-hov text-left'),
  tr: E('tr', 'even:bg-bg/40'),
  th: ({ node, align, className, ...p }: any) => createElement('th', { ...p, style: align ? { textAlign: align } : p.style, className: cx('px-3 py-2 font-semibold', className) }),
  td: ({ node, align, className, ...p }: any) => createElement('td', { ...p, style: align ? { textAlign: align } : p.style, className: cx('px-3 py-2', className) }),
  details: E('details', 'my-3 rounded-xl bg-surf px-4 py-2 [&[open]>summary]:mb-2 [&>summary]:cursor-pointer [&>summary]:font-medium'),
  dl: E('dl', 'my-3 space-y-2 [&_p]:my-0'),
  dt: E('dt', 'font-semibold'),
  dd: E('dd', 'ml-5 text-mu'),
  section: ({ node, className, ...p }: any) => createElement('section', { ...p, className: cx('data-footnotes' in p && 'mt-6 text-sm text-mu [&_h2]:sr-only [&_ol]:list-decimal [&_ol]:pl-5', className) }),
  pre: ({ node, children, className }: any) => {
    const c = node?.children?.[0]
    const lang = /language-([\w+-]+)/.exec((c?.properties?.className ?? []).join(' '))?.[1] ?? ''
    return <Code lang={lang} code={c ? txt(c).replace(/\n$/, '') : ''} node={c} bare={bare} className={className}>{children}</Code>
  },
})

export default memo(function Rich({ t, bare = false, cites, blocks = false, live = false, fade = 0 }: { t: string; bare?: boolean; cites?: CiteMap; blocks?: boolean; live?: boolean; /** Fade-in duration in ms for a streaming reply; 0 disables it. */ fade?: number }) {
  /* A block that is still streaming is never balanced markdown. `remend` — the
   * incomplete-markdown pass streamdown ships — closes a half-typed **bold**,
   * `code` or [link]( so the live block renders with the formatting it will end
   * up with, instead of showing raw markers until the closing one arrives.
   * Settled blocks are complete already and skip it. */
  /* `pre` re-runs over the whole reply on each streamed chunk by design: it is
   * a handful of linear regex passes (measured well under 0.1 ms for a 13 KB
   * reply) while the markdown parse below dominates. An incremental version
   * would have to guess whether the new tail closes a fence, definition list
   * or `$$` block, and a wrong guess re-renders earlier text as prose. */
  const src = useMemo(() => pre(live ? remend(t, {
    /* GFM is configured without single-tilde strikethrough and `~…~` is
     * Pandoc subscript here, so remend must not escape single tildes: doing so
     * turned `H~2~O` into literal `<sub>` tags. An unclosed `$$` block stays
     * literal until the model closes it, which avoids KaTeX painting a
     * half-written formula in the error colour. */
    singleTilde: false,
    katex: false,
  }) : t), [t, live])
  const [katexReady, setKatexReady] = useState(() => katexPlugins !== null)
  // Rebuilding the ~30 element renderers on every streamed word is pure churn;
  // they only depend on the rarely-changing bare/cites props.
  const components = useMemo(() => makeC(bare, cites, live), [bare, cites, live])
  const wantsMath = hasMath(src)
  useEffect(() => {
    if (!wantsMath || katexReady) return
    let live = true
    void loadKatex().then(() => { if (live) setKatexReady(true) })
    return () => { live = false }
  }, [wantsMath, katexReady])
  /* KaTeX renders after sanitising and before highlighting, as before. The
   * fade pass is last, so it wraps the text the sanitizer already approved and
   * the highlighted code it must leave alone. Its identity only changes when
   * the setting does — a plugin recreated per render would re-run over every
   * block and replay each word's animation. */
  const fadeOn = fade > 0
  const rehypePlugins = useMemo(() => {
    const base = katexReady && katexPlugins ? [...REHYPE_BASE, ...katexPlugins, REHYPE_HIGHLIGHT] : [...REHYPE_BASE, REHYPE_HIGHLIGHT]
    return fadeOn ? [...base, rehypeFade] : base
  }, [katexReady, fadeOn])
  const body = (
    <ReactMarkdown
      remarkPlugins={BASE_PLUGINS}
      remarkRehypeOptions={{ clobberPrefix: '' }}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {src}
    </ReactMarkdown>
  )
  /* `blocks` renders the elements without the `.md` container: a streamed reply
   * is one document split across two renders (settled blocks and the block
   * still arriving), and both halves have to live in a single `.md` so the
   * spacing between them is the same as in the finished reply. */
  return blocks ? body : <div className="md leading-7">{body}</div>
})
