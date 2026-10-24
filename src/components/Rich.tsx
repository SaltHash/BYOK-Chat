import { createElement, memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import remarkEmoji from 'remark-emoji'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import { Check, Copy, ImageOff } from 'lucide-react'
import { cx } from './ui'
import { useS } from '../store'
import type { CiteSource } from '../citations'

export type CiteMap = { sources: CiteSource[]; onCite?: (citeId: string) => void }

const normCiteUrl = (u: string) => {
  try { return new URL(u).toString().replace(/\/$/, '').toLowerCase() } catch { return u.replace(/\/$/, '').toLowerCase() }
}

/* ---- pre-processing for syntax the parser does not know ---- */
const FENCE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/
const INLINE = /(`[^`\n]*`)/
const MATH = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/

// "Term\n: definition" becomes a <dl>; blank lines let inline markdown inside it still render
const defs = (t: string) =>
  t.replace(/^(?![:#>|*+\-`~<\s])([^\n]+)\n((?:: [^\n]*(?:\n[ \t]+[^\n]*)*\n?)+)/gm, (_, term: string, body: string) =>
    '<dl>\n\n' + `<dt>\n\n${term.trim()}\n\n</dt>\n\n` +
    body.split(/^: /m).filter(Boolean).map((d) => `<dd>\n\n${d.replace(/\n[ \t]+/g, ' ').trim()}\n\n</dd>\n\n`).join('') + '</dl>\n\n')

const fix = (t: string) =>
  t.split(INLINE).map((p, i) => (i % 2 ? p : p
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => '$$' + m + '$$')                              // \( x \) -> inline math
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => '\n\n$$\n' + m.trim() + '\n$$\n\n')             // \[ x \] -> display math
    .replace(/\$(?=\d[\d,]*(?:\.\d+)?(?:\s|$|[.,;:!?)\]]))/g, '\\$')                          // "$5 and $10" is money, not math
    .split(MATH).map((q, j) => (j % 2 ? q : q
      .replace(/\^([^\s^]+)\^/g, '<sup>$1</sup>')                                          // Pandoc superscript
      .replace(/(?<!~)~([^\s~]+)~(?!~)/g, '<sub>$1</sub>'))).join(''))).join('')           // Pandoc subscript

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

/* Streamed tail: text that starts at or after `at` (source offset of what is
 * already on screen) is wrapped in an `.animate-reply-in` span, so new words
 * fade in wherever they land. A table that starts after `at` fades once as a
 * whole; its cells do not fade separately. Runs last, so only nodes that carry
 * source positions (not highlighted code or math) are affected. */
const fadeNew = ({ at }: { at: number }) => (tree: any) => {
  const fade = (value: string) => ({ type: 'element', tagName: 'span', properties: { className: ['animate-reply-in'] }, children: [{ type: 'text', value }] })
  /* One span per word: a span that already finished its animation would not
   * replay when more text is appended to it, so each new word mounts fresh. */
  const fadeWords = (value: string) => value.split(/(?<=\s)/).filter(Boolean).map(fade)
  const walk = (parent: any) => {
    const kids: any[] = []
    for (const n of parent.children ?? []) {
      const s = n.position?.start?.offset
      const e = n.position?.end?.offset
      if (n.type === 'element') {
        if (n.tagName === 'table' && typeof s === 'number' && s >= at) n.properties = { ...n.properties, dataFade: true }
        else walk(n)
        kids.push(n)
      } else if (n.type === 'text' && typeof s === 'number' && typeof e === 'number' && e > at) {
        const cut = Math.min(Math.max(at - s, 0), n.value.length)
        if (cut > 0) kids.push({ type: 'text', value: n.value.slice(0, cut) })
        if (cut < n.value.length) kids.push(...fadeWords(n.value.slice(cut)))
      } else kids.push(n)
    }
    parent.children = kids
  }
  walk(tree)
}

/* KaTeX plus its fonts is far larger than the rest of the pipeline and only
 * matters for replies that actually contain math, so the plugin and its
 * stylesheet load on first use. Until they arrive the math source renders as
 * plain text (remark-math's fallback), which is readable and stable. */
let katexPlugins: any[] | null = null
let katexLoad: Promise<void> | null = null
const loadKatex = (): Promise<void> => (katexLoad ??= Promise.all([
  import('rehype-katex'),
  import('katex/dist/katex.min.css'),
]).then(([m]) => { katexPlugins = [[m.default, { throwOnError: false, strict: 'ignore', errorColor: 'var(--er)' }]] }))

/* ---- components ---- */
const E = (T: string, c: string) => ({ node, className, ...p }: any) => createElement(T, { ...p, className: cx(c, className) })
const txt = (n: any): string => (n.type === 'text' ? n.value : (n.children ?? []).map(txt).join(''))
const link = 'text-ac underline decoration-ac/40 underline-offset-2 hover:decoration-ac'

function Code({ lang, code, children, bare }: { lang: string; code: string; children: ReactNode; bare?: boolean }) {
  const [ok, setOk] = useState(false)
  const lineNumbers = useS((s) => s.prefs.codeLines === true)
  const maxHeight = useS((s) => s.prefs.codeMaxHeight ?? 0)
  if (bare) {
    return (
      <pre className="overflow-x-auto px-6 py-5 font-mono text-sm leading-6">{children}</pre>
    )
  }
  // The line-number gutter and the code share one scroll container, so they
  // never drift apart; the height cap applies to that container. A very long
  // block keeps its own scrollbar instead of stretching the whole transcript.
  const lines = lineNumbers ? code.split('\n') : null
  return (
    <div className="my-4 overflow-hidden rounded-xl bg-code">
      <div className="code-head flex items-center justify-between bg-codeh px-4 py-2 text-xs">
        <span className="font-medium text-mu">{lang || 'text'}</span>
        <button onClick={() => { const p = navigator.clipboard?.writeText(code); if (!p) return; void p.then(() => { setOk(true); setTimeout(() => setOk(false), 1200) }).catch(() => {}) }} className="inline-flex items-center gap-1.5 text-mu hover:text-tx">
          {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex overflow-y-auto" style={maxHeight > 0 ? { maxHeight } : undefined}>
        {lines && (
          <pre aria-hidden="true" className="shrink-0 select-none border-r border-bor/60 px-2 py-3 text-right font-mono text-sm leading-6 text-mu/60">
            {lines.map((_, i) => i + 1).join('\n')}
          </pre>
        )}
        <pre className="min-w-0 flex-1 overflow-x-auto px-4 py-3 font-mono text-sm leading-6">{children}</pre>
      </div>
    </div>
  )
}

/* A model-authored reply must not silently beacon the reader's IP to an
 * arbitrary host, so remote images are click-to-load by default (inline and
 * app-relative sources still render immediately). The toggle lives in
 * Settings → Chats ("Load remote images"). */
function RemoteImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const allow = useS((s) => s.prefs.remoteImages === true)
  const [loaded, setLoaded] = useState(false)
  const remote = /^https?:\/\//i.test(src ?? '')
  if (!remote || allow || loaded) return <img src={src} alt={alt} title={title} loading="lazy" referrerPolicy="no-referrer" className="my-3 max-h-96 max-w-full rounded-xl bg-surf" />
  let host = src ?? ''
  try { host = new URL(src ?? '').host || host } catch { /* keep the raw URL */ }
  return (
    <span className="my-3 flex flex-wrap items-center gap-2 rounded-xl border border-bor bg-surf px-3 py-2 text-xs text-mu">
      <ImageOff size={14} className="shrink-0 text-ac" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Remote image{alt ? ` — ${alt}` : ''} from {host}</span>
      <button type="button" onClick={() => setLoaded(true)} className="rounded-lg bg-hov px-2.5 py-1 font-medium text-tx hover:opacity-80">Load image</button>
      <button type="button" onClick={() => useS.setState({ prefs: { ...useS.getState().prefs, remoteImages: true } })} className="rounded-lg bg-ac px-2.5 py-1 font-medium text-acx hover:opacity-90">Always load</button>
    </span>
  )
}

const makeC = (bare: boolean, cites?: CiteMap): any => ({
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
  blockquote: E('blockquote', 'relative my-4 rounded-xl bg-surf py-1 pl-5 pr-4 text-mu before:absolute before:inset-y-2 before:left-2 before:w-1 before:rounded-full before:bg-ac/60 [&>p]:my-2'),
  ol: E('ol', 'my-3 list-decimal space-y-1 pl-6 marker:text-mu'),
  ul: ({ node, className, ...p }: any) => createElement('ul', { ...p, className: cx('my-3 space-y-1', /contains-task-list/.test(className ?? '') ? 'list-none pl-1' : 'list-disc pl-6 marker:text-mu') }),
  li: E('li', 'pl-1 [&>ol]:my-1 [&>p]:my-1 [&>ul]:my-1'),
  input: ({ type, checked }: any) => (type === 'checkbox'
    ? <span role="checkbox" aria-label="Task complete" aria-checked={!!checked} aria-disabled="true" className={cx('mr-2 inline-grid size-4 translate-y-0.5 place-items-center rounded border', checked ? 'border-ac bg-ac text-acx' : 'border-mu/60 bg-bg text-transparent')}>{checked && <Check size={12} strokeWidth={3} />}</span> : null),
  a: ({ node, href, children, ...p }: any) => {
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
  img: ({ node, src, alt, title }: any) => <RemoteImage src={src} alt={alt} title={title} />,
  table: ({ children, node }: any) => <div className={cx('my-4 overflow-x-auto rounded-xl bg-surf', node?.properties?.dataFade && 'animate-reply-in')}><table className="w-full border-collapse text-sm">{children}</table></div>,
  thead: E('thead', 'bg-hov text-left'),
  tr: E('tr', 'even:bg-bg/40'),
  th: ({ node, align, className, ...p }: any) => createElement('th', { ...p, style: align ? { textAlign: align } : p.style, className: cx('px-3 py-2 font-semibold', className) }),
  td: ({ node, align, className, ...p }: any) => createElement('td', { ...p, style: align ? { textAlign: align } : p.style, className: cx('px-3 py-2', className) }),
  details: E('details', 'my-3 rounded-xl bg-surf px-4 py-2 [&[open]>summary]:mb-2 [&>summary]:cursor-pointer [&>summary]:font-medium'),
  dl: E('dl', 'my-3 space-y-2 [&_p]:my-0'),
  dt: E('dt', 'font-semibold'),
  dd: E('dd', 'ml-5 text-mu'),
  section: ({ node, className, ...p }: any) => createElement('section', { ...p, className: cx('data-footnotes' in p && 'mt-6 text-sm text-mu [&_h2]:sr-only [&_ol]:list-decimal [&_ol]:pl-5', className) }),
  pre: ({ node, children }: any) => {
    const c = node?.children?.[0]
    const lang = /language-([\w+-]+)/.exec((c?.properties?.className ?? []).join(' '))?.[1] ?? ''
    return <Code lang={lang} code={c ? txt(c).replace(/\n$/, '') : ''} bare={bare}>{children}</Code>
  },
})

export default memo(function Rich({ t, bare = false, cites, blocks = false, fadeFrom }: { t: string; bare?: boolean; cites?: CiteMap; blocks?: boolean; fadeFrom?: number }) {
  /* `pre` re-runs over the whole reply on each streamed chunk by design: it is
   * a handful of linear regex passes (measured well under 0.1 ms for a 13 KB
   * reply) while the markdown parse below dominates. An incremental version
   * would have to guess whether the new tail closes a fence, definition list
   * or `$$` block, and a wrong guess re-renders earlier text as prose. */
  const src = useMemo(() => pre(t), [t])
  const [katexReady, setKatexReady] = useState(() => katexPlugins !== null)
  // Rebuilding the ~30 element renderers on every streamed word is pure churn;
  // they only depend on the rarely-changing bare/cites props.
  const components = useMemo(() => makeC(bare, cites), [bare, cites])
  const wantsMath = MATH.test(src)
  useEffect(() => {
    if (!wantsMath || katexReady) return
    let live = true
    void loadKatex().then(() => { if (live) setKatexReady(true) })
    return () => { live = false }
  }, [wantsMath, katexReady])
  // KaTeX renders after sanitising and before highlighting, as before.
  // `fadeFrom` counts raw reply characters; map it through the same pre-pass so
  // it lines up with the source offsets the parser reports.
  const fadeAt = fadeFrom === undefined ? undefined : pre(t.slice(0, fadeFrom)).length
  const rehypePlugins = useMemo(() => {
    const base = katexReady && katexPlugins ? [...REHYPE_BASE, ...katexPlugins, REHYPE_HIGHLIGHT] : [...REHYPE_BASE, REHYPE_HIGHLIGHT]
    return fadeAt === undefined ? base : [...base, [fadeNew, { at: fadeAt }]]
  }, [katexReady, fadeAt])
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
