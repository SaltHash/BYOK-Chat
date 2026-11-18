/* Temporary harness: reproduces the live reply body (markdown branch of
 * LiveReply) for a plain-prose reply and a markdown-heavy one, and records the
 * fade spans that actually mount. Deleted after debugging. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Md } from './components/Md'
import { useSmoothedStream } from './useSmoothedStream'
import { blockEnds, splitBlocks } from './streamSplit'
import './index.css'

type Entry = { at: number; label: string; text: string }

const log: Entry[] = []
;(window as any).__fadeLog = log

function Live({ full, label }: { full: string; label: string }) {
  const text = useSmoothedStream(full, { pace: true, done: false })
  const [settled, setSettled] = useState<string[]>([])
  const settledLen = settled.reduce((n, part) => n + part.length, 0)
  const tail = text.slice(settledLen)
  const ends = useMemo(() => blockEnds(tail), [tail])
  useEffect(() => {
    if (ends.length < 2) return
    setSettled((prev) => [...prev, tail.slice(0, ends[ends.length - 2])])
  }, [ends, tail])
  const liveParts = useMemo(() => splitBlocks(tail), [tail])
  const parts = settled.concat(liveParts)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of Array.from(r.addedNodes)) {
          if (node.nodeType === 1 && (node as Element).classList?.contains('sd-fade')) {
            log.push({ at: Math.round(performance.now()), label, text: node.textContent ?? '' })
          }
        }
      }
    })
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [label])
  return (
    <div ref={ref} data-case={label} className="sd-stream md leading-7" style={{ '--sd-fade-ms': '300ms' } as any}>
      {parts.map((part, i) => (
        <Md key={i} t={part} blocks live={i >= settled.length} fade={i >= settled.length ? 300 : 0} />
      ))}
    </div>
  )
}

/** Feeds `full` one word boundary at a time, like provider chunks do. */
function Stream({ full, label }: { full: string; label: string }) {
  const cuts = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < full.length; i++) if (/\s/.test(full[i])) out.push(i + 1)
    out.push(full.length)
    return out
  }, [full])
  const [n, setN] = useState(1)
  useEffect(() => {
    if (n >= cuts.length) return
    const id = setTimeout(() => setN(n + 1), 40)
    return () => clearTimeout(id)
  }, [n, cuts.length])
  return <Live full={full.slice(0, cuts[Math.min(n, cuts.length) - 1])} label={label} />
}

/* The plain-text branch of LiveReply (Markdown during streaming turned off). */
function PlainLive({ chunks, label, busy }: { chunks: string[]; label: string; busy: boolean }) {
  const full = useMemo(() => chunks.join(''), [chunks])
  const text = useSmoothedStream(full, { pace: true, done: !busy })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of Array.from(r.addedNodes)) {
          if (node.nodeType === 1 && (node as Element).classList?.contains('sd-fade')) {
            log.push({ at: Math.round(performance.now()), label, text: node.textContent ?? '' })
          }
        }
      }
    })
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [label])
  let start = 0
  return (
    <div ref={ref} data-case={label} className="sd-stream md whitespace-pre-wrap leading-7" style={{ '--sd-fade-ms': '300ms' } as any}>
      {chunks.map((chunk, i) => {
        const from = start
        start += chunk.length
        const shown = Math.max(0, Math.min(chunk.length, text.length - from))
        if (!shown) return null
        return <span key={i} className="sd-fade">{chunk.slice(0, shown)}</span>
      })}
    </div>
  )
}

function PlainStream({ full, label, busy = true }: { full: string; label: string; busy?: boolean }) {
  const [chunks, setChunks] = useState<string[]>([])
  useEffect(() => {
    const words = full.match(/\S+\s*/g) ?? [full]
    let i = 0
    const tick = () => {
      if (i >= words.length) return
      setChunks((prev) => [...prev, words[i]])
      i++
      if (i < words.length) setTimeout(tick, 40)
    }
    tick()
  }, [full])
  return <PlainLive chunks={chunks} label={label} busy={busy} />
}

const PLAIN = 'The build passes and the tests are green. Nothing else changed in the repository today, so the branch is safe to merge now.'
const MD = '## Result\n\nThe build passes.\n\n- tests green\n- lint clean\n\nNothing else changed, so the branch is safe to merge now.'

function Root() {
  return (
    <div className="p-6 text-tx">
      <h3>plain</h3>
      <Stream full={PLAIN} label="plain" />
      <h3 className="mt-8">markdown</h3>
      <Stream full={MD} label="md" />
      <h3 className="mt-8">plain-text branch</h3>
      <PlainStream full={PLAIN} label="plaintext-path" />
      <h3 className="mt-8">one chunk</h3>
      <PlainLive chunks={[PLAIN]} label="onechunk" busy />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
