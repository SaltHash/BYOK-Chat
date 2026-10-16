import { createElement, memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import remarkEmoji from 'remark-emoji'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { all } from 'lowlight'
import 'katex/dist/katex.min.css'
import { Check, Copy } from 'lucide-react'
import { cx } from './ui'
import type { FadeEvent } from '../store'
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
    span: [...drop('span', 'className'), ['className', 'math', 'math-inline', 'math-display', 'stream-fade', 'stream-fade-active'], ['style', /^transition-duration:\s*\d+(?:\.\d+)?s;?$/]],
    div: [...drop('div', 'className'), ['className', 'math', 'math-display']],
    code: [...drop('code', 'className'), ['className', /^language-./, 'math-inline', 'math-display']],
    th: [...drop('th', 'align'), 'align', ['style', /^text-align:\s*(left|right|center);?$/]],
    td: [...drop('td', 'align'), 'align', ['style', /^text-align:\s*(left|right|center);?$/]],
  },
}

// Track stream fragments by timestamp so each word gets its own complete fade.
const fadeFragments = (events: FadeEvent[], duration: number) => () => (tree: any) => {
  if (duration <= 0 || !events.length) return
  const now = performance.now(), active = events.filter((e) => now - e.at < duration * 1000).reverse()
  const leaves: any[] = []
  const collect = (node: any) => {
    if (node.type === 'text') leaves.push(node)
    else for (const child of node.children ?? []) collect(child)
  }
  collect(tree)
  const ranges = new Map<any, { start: number; end: number; event: FadeEvent; age: number }[]>()
  let leafIndex = leaves.length - 1, before = leaves[leafIndex]?.value.length ?? 0
  for (const event of active) {
    const needle = event.text.trim().replace(/^[*_~`]+|[*_~`]+$/g, '')
    if (!needle) continue
    let found = false
    for (let i = leafIndex; i >= 0 && !found; i--) {
      const value = leaves[i].value, limit = i === leafIndex ? before : value.length
      const start = value.lastIndexOf(needle, limit - needle.length)
      if (start >= 0 && start + needle.length <= limit) {
        const list = ranges.get(leaves[i]) ?? []
        for (const match of needle.matchAll(/\S+/g)) {
          const wordStart = start + (match.index ?? 0)
          list.push({ start: wordStart, end: wordStart + match[0].length, event, age: now - event.at })
        }
        ranges.set(leaves[i], list)
        leafIndex = i; before = start; found = true
      }
    }
  }
  const replace = (parent: any) => {
    if (!parent.children) return
    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i], marks = ranges.get(node)
      if (marks?.length) {
        const pieces: any[] = []; let offset = 0
        for (const mark of marks.sort((a, b) => a.start - b.start)) {
          if (mark.start < offset) continue
          if (mark.start > offset) pieces.push({ type: 'text', value: node.value.slice(offset, mark.start) })
          const active = mark.age >= 32, remaining = Math.max(0, duration - mark.age / 1000).toFixed(3)
          pieces.push({ type: 'text', value: node.value.slice(mark.start, mark.end), data: { hName: 'span', hProperties: { className: active ? ['stream-fade', 'stream-fade-active'] : ['stream-fade'], ...(active ? { style: `transition-duration:${remaining}s;` } : {}) } } })
          offset = mark.end
        }
        if (offset < node.value.length) pieces.push({ type: 'text', value: node.value.slice(offset) })
        parent.children.splice(i, 1, ...pieces); i += pieces.length - 1
      } else replace(node)
    }
  }
  replace(tree)
}

/* ---- components ---- */
const E = (T: string, c: string) => ({ node, className, ...p }: any) => createElement(T, { ...p, className: cx(c, className) })
const txt = (n: any): string => (n.type === 'text' ? n.value : (n.children ?? []).map(txt).join(''))
const link = 'text-ac underline decoration-ac/40 underline-offset-2 hover:decoration-ac'

function Code({ lang, code, children, bare }: { lang: string; code: string; children: ReactNode; bare?: boolean }) {
  const [ok, setOk] = useState(false)
  if (bare) {
    return (
      <pre className="overflow-x-auto px-6 py-5 font-mono text-sm leading-6">{children}</pre>
    )
  }
  return (
    <div className="my-4 overflow-hidden rounded-xl bg-code">
      <div className="flex items-center justify-between bg-codeh px-4 py-2 text-xs">
        <span className="font-medium text-mu">{lang || 'text'}</span>
        <button onClick={() => { navigator.clipboard?.writeText(code); setOk(true); setTimeout(() => setOk(false), 1200) }} className="inline-flex items-center gap-1.5 text-mu hover:text-tx">
          {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-sm leading-6">{children}</pre>
    </div>
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
              onClick={() => cites.onCite?.(hit.citeId)}
              title={`${hit.title} — ${hit.host}. Jump to source.`}
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
  img: ({ node, src, alt, title }: any) => <img src={src} alt={alt} title={title} loading="lazy" referrerPolicy="no-referrer" className="my-3 max-h-96 max-w-full rounded-xl bg-surf" />,
  table: ({ children }: any) => <div className="my-4 overflow-x-auto rounded-xl bg-surf"><table className="w-full border-collapse text-sm">{children}</table></div>,
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

export default memo(function Rich({ t, fadeEvents = [], fade = 0, bare = false, cites }: { t: string; fadeEvents?: FadeEvent[]; fade?: number; bare?: boolean; cites?: CiteMap }) {
  const src = useMemo(() => pre(t), [t])
  const [, refresh] = useState(0)
  useEffect(() => {
    if (fade <= 0 || !fadeEvents.some((event) => performance.now() - event.at < fade * 1000)) return
    const timer = window.setInterval(() => {
      refresh((n) => n + 1)
      if (!fadeEvents.some((event) => performance.now() - event.at < fade * 1000)) window.clearInterval(timer)
    }, 32)
    return () => window.clearInterval(timer)
  }, [fadeEvents, fade])
  return (
    <div className="md leading-7" style={{ '--word-fade-duration': `${fade}s` } as CSSProperties}>
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, remarkBreaks, remarkEmoji, fadeFragments(fadeEvents, fade)]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], [rehypeKatex, { throwOnError: false, strict: 'ignore', errorColor: 'var(--er)' }], [rehypeHighlight, { detect: false, ignoreMissing: true, languages: all }]]}
        components={makeC(bare, cites)}
      >
        {src}
      </ReactMarkdown>
    </div>
  )
})
