import { useEffect, useMemo, useRef, useState } from 'react'
import { useS } from '../store'
import { artifactDocument, artifactTheme, parseArtifactArgs, type ArtifactSpec } from '../artifacts'

type CallLike = { id: string; name: string; arguments: string; error?: boolean }

/** One app-styled, sandboxed interactive artifact. It renders bare, without a
 *  frame or title of its own, at the height its content needs, so it reads as
 *  part of the reply rather than as an embedded widget. */
export function ArtifactCard({ spec }: { spec: ArtifactSpec }) {
  const themeMode = useS((s) => s.themeMode)
  const doc = useMemo(() => artifactDocument(spec, artifactTheme()), [spec, themeMode])
  const frame = useRef<HTMLIFrameElement>(null)
  /* The document reports its own content height, so the artifact is always
   * shown in full: nothing is clipped and no scrollbar appears. Only this
   * frame's own window is trusted. */
  const [measured, setMeasured] = useState<number | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { source?: string; height?: number } | null
      if (!d || d.source !== 'byok-artifact' || typeof d.height !== 'number' || !Number.isFinite(d.height)) return
      setMeasured(Math.max(32, Math.round(d.height)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  useEffect(() => { setMeasured(null) }, [spec])
  const height = measured ?? spec.height ?? 340
  return (
    <iframe
      ref={frame}
      title={spec.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      scrolling="no"
      className="block w-full border-0"
      style={{ height, background: 'transparent' }}
    />
  )
}

/** The usable artifact specs among a round's tool calls. */
export function artifactSpecs(calls?: CallLike[]): ArtifactSpec[] {
  return (calls ?? [])
    .filter((call) => call.name === 'show_artifact' && !call.error)
    .map((call) => parseArtifactArgs(call.arguments))
    .filter((spec): spec is ArtifactSpec => !!spec)
}

export function ArtifactList({ specs }: { specs: ArtifactSpec[] }) {
  if (!specs.length) return null
  return <div className="space-y-3">{specs.map((spec, i) => <ArtifactCard key={`${spec.title}-${i}`} spec={spec} />)}</div>
}

/** Split a reply so each artifact sits where the model called it: after the
 *  text of the round that created it and before anything written later. The
 *  round texts are already part of the final reply text, in order, so each one
 *  is found from the cursor and the cut lands on its end. Null when there is
 *  no artifact, which keeps the ordinary body on the single-pass path. */
export function artifactBlocks(text: string, rounds?: { text?: string; calls: CallLike[] }[]): { text?: string; specs?: ArtifactSpec[] }[] | null {
  const list = rounds ?? []
  if (!list.some((round) => artifactSpecs(round.calls).length > 0)) return null
  const out: { text?: string; specs?: ArtifactSpec[] }[] = []
  const deferred: ArtifactSpec[] = []
  let cursor = 0
  let buf = ''
  for (const round of list) {
    const t = String(round.text ?? '')
    let at = -1
    if (t) {
      at = text.indexOf(t, cursor)
      if (at >= 0) { buf += text.slice(cursor, at + t.length); cursor = at + t.length }
    }
    const specs = artifactSpecs(round.calls)
    if (!specs.length) continue
    // A round whose text is not part of this reply (a research run writes its
    // report separately) cannot be placed exactly; keep those at the end
    // rather than guessing a position above the whole answer.
    if (at < 0) { deferred.push(...specs); continue }
    if (buf.trim()) out.push({ text: buf })
    out.push({ specs })
    buf = ''
  }
  buf += text.slice(cursor)
  if (buf.trim()) out.push({ text: buf })
  if (deferred.length) out.push({ specs: deferred })
  return out.length ? out : null
}
