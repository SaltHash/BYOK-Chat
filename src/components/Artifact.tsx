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

export function ArtifactCards({ rounds }: { rounds?: { calls: CallLike[] }[] }) {
  const specs = (rounds ?? []).flatMap((round) => round.calls)
    .filter((call) => call.name === 'show_artifact' && !call.error)
    .map((call) => parseArtifactArgs(call.arguments))
    .filter((spec): spec is ArtifactSpec => !!spec)
  if (!specs.length) return null
  return <div className="mt-3 space-y-3">{specs.map((spec, i) => <ArtifactCard key={`${spec.title}-${i}`} spec={spec} />)}</div>
}
