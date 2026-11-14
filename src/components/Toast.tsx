import { useEffect, type CSSProperties } from 'react'
import { Info, X } from 'lucide-react'
import { useS } from '../store'
import { Btn, cx } from './ui'

/** Floating status toast. It sits above the shell (and settings) instead of
 *  taking a row from the composer, follows the glass composer's material when
 *  that is on, expires after five seconds, and dismisses on a click anywhere
 *  that is not one of its own controls. */
export function Notice({ cfg }: { cfg: (t: string) => void }) {
  const n = useS((s) => s.notice)
  const glass = useS((s) => s.prefs.glassComposer !== false)
  const blur = useS((s) => s.prefs.glassBlur ?? 14)
  const opacity = useS((s) => s.prefs.glassOpacity ?? 80)

  useEffect(() => {
    if (!n) return
    const timer = setTimeout(() => useS.getState().patch({ notice: null }), 5000)
    return () => clearTimeout(timer)
  }, [n])

  if (!n) return null
  const dismiss = () => useS.getState().patch({ notice: null })
  return (
    <div
      role={n.undo ? 'alert' : 'status'}
      aria-live={n.undo ? 'assertive' : 'polite'}
      title="Click to dismiss"
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) dismiss() }}
      style={glass ? ({ '--glass-blur': `${blur}px`, '--glass-opacity': `${opacity}%` } as CSSProperties) : undefined}
      className={cx(
        'fixed left-1/2 top-3 z-[60] flex w-[min(92vw,34rem)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3 text-sm shadow-2xl',
        glass ? 'glass-composer border-hov' : 'border-bor bg-surf',
      )}
    >
      <Info size={18} className="shrink-0 text-ac" aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-40 break-words leading-5">{n.t}</p>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {n.href && <a href={n.href} target="_blank" rel="noreferrer" className="inline-flex h-9 shrink-0 items-center rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80">{n.label ?? 'Open link'}</a>}
        {n.tab && <Btn v="soft" onClick={() => { dismiss(); cfg(n.tab!) }}>{n.label ?? 'Open settings'}</Btn>}
        {n.undo && <Btn v="soft" onClick={() => useS.getState().undoDelete()}>Undo</Btn>}
        <Btn sm icon={X} title="Dismiss" onClick={dismiss} />
      </span>
    </div>
  )
}
