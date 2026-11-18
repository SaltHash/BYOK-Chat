import { useEffect, useMemo, useRef, useState } from 'react'
import { useS } from '../store'
import { artifactDocument, artifactTheme, type ArtifactSpec } from '../artifacts'
import { roundEmbeds, replyBlocks, type LayoutCall } from '../replyLayout'

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
export function artifactSpecs(calls?: LayoutCall[]): ArtifactSpec[] {
  return roundEmbeds(calls).flatMap((embed) => (embed.kind === 'artifact' ? [embed.spec] : []))
}

export function ArtifactList({ specs }: { specs: ArtifactSpec[] }) {
  if (!specs.length) return null
  return <div className="space-y-3">{specs.map((spec, i) => <ArtifactCard key={`${spec.title}-${i}`} spec={spec} />)}</div>
}

/** Split a reply so each artifact sits where the model called it: after the
 *  text of the round that created it and before anything written later. A
 *  round that made the artifact before writing anything places it at that
 *  point in the reply rather than at the end. Null when there is no artifact,
 *  which keeps the ordinary body on the single-pass path. */
export function artifactBlocks(text: string, rounds?: { text?: string; calls: LayoutCall[] }[]): { text?: string; specs?: ArtifactSpec[] }[] | null {
  const blocks = replyBlocks(text, rounds)
  if (!blocks) return null
  const out: { text?: string; specs?: ArtifactSpec[] }[] = []
  for (const block of blocks) {
    const specs = block.embeds.flatMap((embed) => (embed.kind === 'artifact' ? [embed.spec] : []))
    if (!specs.length) { if (block.text) out.push({ text: block.text }); continue }
    if (block.text) out.push({ text: block.text })
    out.push({ specs })
  }
  return out.length ? out : null
}
