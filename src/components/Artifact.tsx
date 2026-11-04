import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import { useS } from '../store'
import { artifactDocument, artifactTheme, parseArtifactArgs, type ArtifactSpec } from '../artifacts'
import { cx } from './ui'

type CallLike = { id: string; name: string; arguments: string; error?: boolean }

/** One app-styled, sandboxed interactive artifact. */
export function ArtifactCard({ spec, compact = false }: { spec: ArtifactSpec; compact?: boolean }) {
  const themeMode = useS((s) => s.themeMode)
  const doc = useMemo(() => artifactDocument(spec, artifactTheme()), [spec, themeMode])
  const frame = useRef<HTMLIFrameElement>(null)
  const cap = compact ? 340 : 720
  const initial = compact ? Math.min(spec.height ?? 280, cap) : spec.height ?? 340
  /* The document reports its own content height, so a tall chart grows the
   * frame instead of being clipped and a short one leaves no dead space. Only
   * this frame's own window is trusted. */
  const [measured, setMeasured] = useState<number | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { source?: string; height?: number } | null
      if (!d || d.source !== 'byok-artifact' || typeof d.height !== 'number' || !Number.isFinite(d.height)) return
      setMeasured(Math.max(64, Math.min(cap, Math.round(d.height))))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [cap])
  useEffect(() => { setMeasured(null) }, [spec])
  const height = measured ?? initial
  return (
    <section className={cx('overflow-hidden rounded-xl border border-bor bg-surf/40', compact && 'text-sm')} aria-label={`Interactive artifact: ${spec.title}`}>
      <div className="flex items-center gap-2 border-b border-bor px-3 py-2">
        <Layers size={14} className="shrink-0 text-ac" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{spec.title}</span>
        <span className="shrink-0 rounded-full bg-ac/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ac">Interactive</span>
      </div>
      <iframe
        ref={frame}
        title={spec.title}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={doc}
        className="block w-full border-0"
        style={{ height, background: 'transparent' }}
      />
    </section>
  )
}

export function ArtifactCards({ rounds, compact = false }: { rounds?: { calls: CallLike[] }[]; compact?: boolean }) {
  const specs = (rounds ?? []).flatMap((round) => round.calls)
    .filter((call) => call.name === 'show_artifact' && !call.error)
    .map((call) => parseArtifactArgs(call.arguments))
    .filter((spec): spec is ArtifactSpec => !!spec)
  if (!specs.length) return null
  return <div className="mt-3 space-y-3">{specs.map((spec, i) => <ArtifactCard key={`${spec.title}-${i}`} spec={spec} compact={compact} />)}</div>
}
