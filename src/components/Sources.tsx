import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Copy, Check, ExternalLink, FileText, Link2, AlertTriangle } from 'lucide-react'
import { fetchPage } from '../engine'
import { truncateSnippet, citationCoverage, type CiteSource } from '../citations'
import { cx } from './ui'

const normUrl = (u: string) => {
  try { return new URL(u).toString().replace(/\/$/, '') } catch { return u.replace(/\/$/, '') }
}

/* One source row: truncated snippet first, then Open / Excerpt / Copy actions. */
function Row({ msgId, source, flash, cited }: { msgId: string; source: CiteSource; flash: boolean; cited: boolean }) {
  const [excerpt, setExcerpt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState<'link' | 'cite' | null>(null)
  const copy = (kind: 'link' | 'cite', text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(kind); setTimeout(() => setCopied(null), 1200)
  }
  const read = async () => {
    if (excerpt != null || busy) return
    setBusy(true); setErr('')
    try {
      const page = await fetchPage(source.url)
      setExcerpt(page.text.slice(0, 2000))
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <li id={`${msgId}-src-${source.citeId}`} className={cx('scroll-mt-24 rounded-xl bg-bg p-3 transition-colors', flash && 'ring-2 ring-ac')}>
      <div className="flex items-start gap-2.5">
        <span className={cx('grid size-6 shrink-0 place-items-center rounded-md font-mono text-xs font-semibold', cited ? 'bg-ac text-acx' : 'bg-hov text-mu')} title={cited ? `Cited as [${source.citeId}]` : 'Not cited in this reply'}>{source.citeId.replace(/^S/, '')}</span>
        <div className="min-w-0 flex-1">
          <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm font-medium text-tx underline decoration-ac/40 underline-offset-2 hover:decoration-ac">{source.title}</a>
          <div className="mt-0.5 truncate text-xs text-mu">{source.host}{source.engine ? ` · ${source.engine}` : ''}{source.query && source.query !== 'page reader' ? ` · “${source.query.slice(0, 60)}”` : ''}</div>
          <p className="mt-1.5 text-sm leading-6 text-mu">{truncateSnippet(source.snippet)}</p>
          {excerpt != null && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surf p-2.5 text-xs leading-5 text-tx">{excerpt}</p>}
          {err && <p className="mt-2 text-xs text-er">{err}</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
        <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-hov px-2.5 text-xs font-medium hover:opacity-80"><ExternalLink size={13} />Open</a>
        <button onClick={read} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-hov px-2.5 text-xs font-medium hover:opacity-80 disabled:opacity-40"><FileText size={13} />{busy ? 'Reading…' : excerpt != null ? 'Excerpt' : 'Read page'}</button>
        <button onClick={() => copy('link', source.url)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-mu hover:bg-hov hover:text-tx"><Link2 size={13} />{copied === 'link' ? 'Copied' : 'Copy link'}</button>
        <button onClick={() => copy('cite', `[${source.citeId}](${source.url})`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-mu hover:bg-hov hover:text-tx">{copied === 'cite' ? <Check size={13} /> : <Copy size={13} />}{copied === 'cite' ? 'Copied' : 'Copy cite'}</button>
      </div>
    </li>
  )
}

/* Sources button + expandable list. Rendered below workspaces, above the
 * message options. Collapsed by default unless the Sources setting says open. */
export function SourcesPanel({ msgId, text, sources, defaultOpen, strict, open, onToggle, flash }: {
  msgId: string
  text: string
  sources: CiteSource[]
  defaultOpen: boolean
  strict: boolean
  open?: boolean
  onToggle?: (open: boolean) => void
  flash?: string | null
}) {
  const [inner, setInner] = useState(defaultOpen)
  const isOpen = open ?? inner
  const setIsOpen = (v: boolean) => { onToggle ? onToggle(v) : setInner(v) }
  if (!sources.length) return null
  const { cited, unknown, uncited } = citationCoverage(text, sources)
  const citedSet = new Set(cited)
  const ordered = [...sources].sort((a, b) => Number(a.citeId.slice(1)) - Number(b.citeId.slice(1)))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className="inline-flex min-h-9 items-center gap-2 rounded-full border border-hov bg-surf px-3 py-1.5 text-sm text-tx transition-colors hover:bg-hov"
        >
          <BookOpen size={14} className="text-ac" />
          Sources · {sources.length}
          <ChevronDown size={14} className={cx('text-mu transition-transform', isOpen && 'rotate-180')} />
        </button>
        {cited.length > 0 && <span className="text-xs text-mu">{cited.length} cited</span>}
        {uncited && <span className="text-xs text-mu">not cited in this reply</span>}
        {strict && (uncited || unknown.length > 0) && (
          <span className="inline-flex items-center gap-1 text-xs text-er"><AlertTriangle size={13} />{uncited ? 'No citations for grounded claims' : `Unknown ${unknown.join(', ')}`}</span>
        )}
      </div>
      {isOpen && (
        <>
          <ul className="space-y-2" aria-label="Sources used in this reply">
            {ordered.map((s) => (
              <Row key={s.citeId} msgId={msgId} source={s} flash={flash === s.citeId.toUpperCase()} cited={citedSet.has(s.citeId.toUpperCase())} />
            ))}
          </ul>
          <button
            onClick={() => setIsOpen(false)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-mu transition-colors hover:bg-hov hover:text-tx"
          >
            <ChevronUp size={14} />Collapse
          </button>
        </>
      )}
    </div>
  )
}

/* Imperative scroll helper used by inline citation pills. */
export function scrollToSource(msgId: string, citeId: string, setFlash?: (id: string | null) => void) {
  const el = document.getElementById(`${msgId}-src-${citeId.toUpperCase()}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
