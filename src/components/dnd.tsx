import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { dndDirection, insertionIndex } from '../dndShared'

/* Cohesive pointer-based drag-and-drop system (replaces the old HTML5 DnD handlers).
 *
 * Design (checked against dnd-kit docs: DndContext/useDraggable/useDroppable +
 * DragOverlay/transform pattern; sortable on top):
 * - Pointer activation constraint (~6px) so clicks/text selection still work.
 * - On lift the item's content is cloned into a fixed-position overlay that
 *   follows the pointer via translate3d (compositor-friendly, direct DOM writes,
 *   no React re-render per mousemove).
 * - The item's slot becomes a filled placeholder box (very dark in dark themes,
 *   light-but-darker-than-side in light themes, 2px dashed outline) that
 *   occupies real layout space; siblings FLIP-animate around it continuously
 *   while dragging (spatial reflow, not drop-time swap).
 * - Midpoint collision with small hysteresis prevents boundary flicker.
 * - Pointer capture is window-level so direction reversals work mid-drag.
 * - Auto-scroll near scroll-container edges; Escape cancels; keyboard reorder
 *   (Space lift, arrows move, Enter drop, Escape cancel) with live announcements.
 * - No new dependencies; no native HTML5 drag-and-drop visuals.
 */

export const DND_ACTIVATION_PX = 6

export function measureBox(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return { w: r.width, h: r.height, radius: cs.borderRadius || '12px' }
}

let overlayEl: HTMLDivElement | null = null

export function showDragOverlay(source: HTMLElement, pointerX: number, pointerY: number) {
  hideDragOverlay()
  const rect = source.getBoundingClientRect()
  const dx = pointerX - rect.left
  const dy = pointerY - rect.top
  const el = document.createElement('div')
  el.className = 'dnd-overlay'
  el.style.width = `${rect.width}px`
  const clone = source.cloneNode(true) as HTMLElement
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
  clone.setAttribute('inert', '')
  clone.style.margin = '0'
  clone.style.width = '100%'
  el.appendChild(clone)
  document.body.appendChild(el)
  overlayEl = el
  moveDragOverlay(pointerX, pointerY, dx, dy)
  return { dx, dy, w: rect.width, h: rect.height }
}

export function moveDragOverlay(pointerX: number, pointerY: number, dx: number, dy: number) {
  if (!overlayEl) return
  overlayEl.style.transform = `translate3d(${pointerX - dx}px, ${pointerY - dy}px, 0) scale(1.02)`
}

export function hideDragOverlay() {
  if (overlayEl) {
    overlayEl.remove()
    overlayEl = null
  }
}

export function DndPlaceholder({ height, radius }: { height: number; radius?: string }) {
  // The measured wrapper is often unrounded (the rounding lives on inner
  // content), which would override the rounded default with 0px. Only inherit
  // a radius that actually rounds something.
  const rounded = radius && !/^0/.test(radius.trim()) ? radius : undefined
  const style: CSSProperties = {
    height: Math.max(24, Math.round(height)),
    ...(rounded ? { borderRadius: rounded } : null),
  }
  return <div className="dnd-placeholder" style={style} aria-hidden="true" data-dnd-placeholder="true" />
}

export function DndLiveRegion({ message }: { message: string }) {
  return (
    <div aria-live="polite" role="status" className="dnd-live">
      {message}
    </div>
  )
}

/* Shared FLIP animator for rows around the live placeholder.
 *
 * Stability rules (fast drags must not compound):
 * - Runs only when the layout signature changes (order/placeholder/drag id),
 *   never on unrelated re-renders.
 * - Before measuring, any in-flight item animation is cancelled and the item
 *   is snapped back to its true layout position. Measuring an element while a
 *   previous invert transform is still applied is what made rapid drags
 *   oscillate: each frame's delta was computed against a shifted position and
 *   the error compounded. Reset-first keeps every frame's delta exact.
 * - Restarting a short (180ms) transition toward the new position each frame
 *   yields smooth trailing motion instead of snaps.
 */
export function useFlipAnimate(
  elsRef: React.RefObject<Map<string, HTMLElement>>,
  activeId: string | null,
  disabled: boolean,
  layoutKey: string,
) {
  const prev = useRef(new Map<string, number>())
  const recs = useRef(new Map<string, { raf: number; timeout: number; onEnd: (() => void) | null }>())
  useLayoutEffect(() => {
    if (disabled) return
    recs.current.forEach((rec, id) => {
      cancelAnimationFrame(rec.raf)
      clearTimeout(rec.timeout)
      const el = elsRef.current?.get(id)
      if (el) {
        if (rec.onEnd) el.removeEventListener('transitionend', rec.onEnd)
        el.style.transition = ''
        el.style.transform = ''
      }
    })
    recs.current.clear()
    const tops = new Map<string, number>()
    elsRef.current?.forEach((el, id) => tops.set(id, el.getBoundingClientRect().top))
    if (prev.current.size) {
      elsRef.current?.forEach((el, id) => {
        if (id === activeId) return
        const a = prev.current.get(id)
        const b = tops.get(id)
        if (a == null || b == null) return
        const delta = a - b
        if (Math.abs(delta) <= 2) return
        el.style.transition = 'none'
        el.style.transform = `translateY(${delta}px)`
        const rec: { raf: number; timeout: number; onEnd: (() => void) | null } = { raf: 0, timeout: 0, onEnd: null }
        rec.raf = requestAnimationFrame(() => {
          el.style.transition = 'transform 180ms ease'
          el.style.transform = ''
          const clear = () => {
            el.style.transition = ''
            el.style.transform = ''
            el.removeEventListener('transitionend', clear)
            if (recs.current.get(id) === rec) recs.current.delete(id)
          }
          rec.onEnd = clear
          el.addEventListener('transitionend', clear)
          rec.timeout = window.setTimeout(clear, 220)
        })
        recs.current.set(id, rec)
      })
    }
    prev.current = tops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, activeId, disabled])
}

export type SortHandleProps = {
  className: string
  tabIndex: number
  role: string
  'aria-label': string
  'aria-describedby'?: string
  'aria-pressed'?: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export type SortItemApi = {
  handleProps: (label?: string) => SortHandleProps
  dragging: boolean
  keyboardDragging: boolean
}

type Pending = { id: string; startX: number; startY: number; dx: number; dy: number }

export function SortableList(props: {
  ids: string[]
  onCommit: (from: number, to: number) => void
  renderItem: (id: string, api: SortItemApi) => ReactNode
  label?: string
  className?: string
  itemClassName?: string
  describe?: (id: string) => string
}) {
  const { ids, onCommit, renderItem, label, className, itemClassName, describe } = props
  const [activeId, setActiveId] = useState<string | null>(null)
  const [insertAt, setInsertAt] = useState(0)
  const [box, setBox] = useState<{ w: number; h: number; radius: string } | null>(null)
  const [keyboardMode, setKeyboardMode] = useState(false)
  const [message, setMessage] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const itemEls = useRef(new Map<string, HTMLElement>())
  const pending = useRef<Pending | null>(null)
  const drag = useRef<{ id: string; from: number; dx: number; dy: number; dir: 1 | -1; lastY: number; raf: number; scrollRaf: number } | null>(null)
  const stateRef = useRef({ ids, insertAt, activeId })
  stateRef.current = { ids, insertAt, activeId }
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const register = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) itemEls.current.set(id, el)
      else itemEls.current.delete(id)
    },
    [],
  )

  // Visual order: source ids minus the dragged one, placeholder spliced at insertAt.
  const visual = useMemo(() => {
    if (!activeId) return ids.map((id) => ({ kind: 'item' as const, id }))
    const rest = ids.filter((id) => id !== activeId)
    const at = Math.max(0, Math.min(insertAt, rest.length))
    const out: ({ kind: 'item'; id: string } | { kind: 'placeholder' })[] = rest.map((id) => ({ kind: 'item' as const, id }))
    out.splice(at, 0, { kind: 'placeholder' })
    return out
  }, [ids, activeId, insertAt])

  // Animate siblings around the placeholder; keyed on the visible order so
  // unrelated re-renders never disturb in-flight motion.
  const layoutKey = visual.map((v) => (v.kind === 'item' ? v.id : '__ph')).join(',')
  useFlipAnimate(itemEls, activeId, reducedMotion, layoutKey)

  const computeInsertAt = useCallback((pointerY: number) => {
    const d = drag.current
    if (!d) return 0
    const rest = stateRef.current.ids.filter((id) => id !== d.id)
    const mids: number[] = []
    for (const id of rest) {
      const el = itemEls.current.get(id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      mids.push(r.top + r.height / 2)
    }
    const dir = dndDirection(pointerY, d.lastY)
    d.dir = dir
    d.lastY = pointerY
    // Hysteresis band keeps the placeholder stable right on a boundary.
    return insertionIndex(mids, pointerY, dir)
  }, [])

  const autoScroll = useCallback((pointerY: number) => {
    const d = drag.current
    if (!d) return
    const scroller = containerRef.current?.closest('[data-dnd-scroll]') as HTMLElement | null
    const targets: (HTMLElement | null)[] = [containerRef.current, scroller]
    for (const t of targets) {
      if (!t || t === document.body) continue
      const r = t.getBoundingClientRect()
      const canScroll = t.scrollHeight > t.clientHeight + 4
      if (!canScroll) continue
      if (pointerY < r.top + 56) t.scrollTop -= 10
      else if (pointerY > r.bottom - 56) t.scrollTop += 10
    }
    if (pointerY < 72) window.scrollBy(0, -10)
    else if (pointerY > window.innerHeight - 72) window.scrollBy(0, 10)
  }, [])

  const cleanup = useCallback(() => {
    const d = drag.current
    if (d) {
      cancelAnimationFrame(d.raf)
      cancelAnimationFrame(d.scrollRaf)
    }
    drag.current = null
    pending.current = null
    hideDragOverlay()
  }, [])

  const finish = useCallback(
    (commit: boolean) => {
      const d = drag.current
      if (!d) {
        cleanup()
        return
      }
      const { ids: cur, insertAt: at } = stateRef.current
      const from = cur.indexOf(d.id)
      cleanup()
      setActiveId(null)
      setKeyboardMode(false)
      setBox(null)
      if (commit && from >= 0) {
        const rest = cur.filter((id) => id !== d.id)
        const to = Math.max(0, Math.min(at, rest.length))
        if (to !== from) {
          onCommitRef.current(from, to)
          setMessage(`${label ?? 'Item'} moved from position ${from + 1} to ${to + 1}.`)
        } else {
          setMessage(`${label ?? 'Item'} unchanged.`)
        }
      } else {
        setMessage(`${label ?? 'Item'} drag cancelled. Order unchanged.`)
      }
    },
    [cleanup, label],
  )

  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      const p = pending.current
      if (d) {
        e.preventDefault()
        const { clientX, clientY } = e
        cancelAnimationFrame(d.raf)
        d.raf = requestAnimationFrame(() => {
          moveDragOverlay(clientX, clientY, d.dx, d.dy)
          const at = computeInsertAt(clientY)
          if (at !== stateRef.current.insertAt) setInsertAt(at)
          autoScroll(clientY)
        })
        return
      }
      if (p) {
        const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY)
        if (moved < DND_ACTIVATION_PX) return
        const el = itemEls.current.get(p.id)
        if (!el) {
          pending.current = null
          return
        }
        const b = measureBox(el)
        const from = stateRef.current.ids.indexOf(p.id)
        drag.current = { id: p.id, from, dx: p.dx, dy: p.dy, dir: 1, lastY: e.clientY, raf: 0, scrollRaf: 0 }
        pending.current = null
        showDragOverlay(el, e.clientX, e.clientY)
        setBox(b)
        setActiveId(p.id)
        setInsertAt(from >= 0 ? from : 0)
        setMessage(`${label ?? 'Item'} lifted. Use arrow keys or pointer to move, release to drop, Escape to cancel.`)
      }
    },
    [autoScroll, computeInsertAt, label],
  )

  const onWindowUp = useCallback(() => {
    if (drag.current) finish(true)
    else {
      pending.current = null
      cleanup()
    }
  }, [cleanup, finish])

  const onWindowCancel = useCallback(() => {
    if (drag.current) finish(false)
    else {
      pending.current = null
      cleanup()
    }
  }, [cleanup, finish])

  // Keep stable listener identities for add/remove symmetry.
  const moveRef = useRef(onWindowMove)
  moveRef.current = onWindowMove
  const upRef = useRef(onWindowUp)
  upRef.current = onWindowUp
  const cancelRef = useRef(onWindowCancel)
  cancelRef.current = onWindowCancel

  useEffect(() => {
    const mv = (e: PointerEvent) => moveRef.current(e)
    const up = () => upRef.current()
    const cn = () => cancelRef.current()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current) {
        e.preventDefault()
        e.stopPropagation()
        cancelRef.current()
      }
    }
    window.addEventListener('pointermove', mv, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cn)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cn)
      window.removeEventListener('keydown', key, true)
    }
  }, [])

  const beginPending = useCallback((e: React.PointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = itemEls.current.get(id)
    if (!el) return
    const r = el.getBoundingClientRect()
    pending.current = { id, startX: e.clientX, startY: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top }
  }, [])

  const handleKey = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      const cur = stateRef.current.ids
      const from = cur.indexOf(id)
      if (activeId !== id) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          const el = itemEls.current.get(id)
          const b = el ? measureBox(el) : { w: 0, h: 48, radius: '12px' }
          drag.current = { id, from, dx: 0, dy: 0, dir: 1, lastY: 0, raf: 0, scrollRaf: 0 }
          setBox(b)
          setActiveId(id)
          setKeyboardMode(true)
          setInsertAt(from >= 0 ? from : 0)
          setMessage(`${describe?.(id) ?? label ?? 'Item'} lifted at position ${from + 1} of ${cur.length}. Arrow keys move, Enter drops, Escape cancels.`)
        }
        return
      }
      const rest = cur.filter((x) => x !== id)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setInsertAt((at) => {
          const next = Math.max(0, Math.min(rest.length, at + delta))
          setMessage(`Destination position ${next + 1} of ${cur.length}.`)
          return next
        })
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setInsertAt(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setInsertAt(rest.length)
      }
    },
    [activeId, describe, finish, label],
  )

  const apiFor = useCallback(
    (id: string): SortItemApi => ({
      dragging: activeId === id && !keyboardMode,
      keyboardDragging: activeId === id && keyboardMode,
      handleProps: (handleLabel?: string) => ({
        className: 'dnd-handle',
        tabIndex: 0,
        role: 'button',
        'aria-label': handleLabel ?? `Reorder ${describe?.(id) ?? label ?? 'item'}. Press Space to lift.`,
        'aria-pressed': activeId === id,
        onPointerDown: (e: React.PointerEvent) => beginPending(e, id),
        onKeyDown: (e: React.KeyboardEvent) => handleKey(e, id),
      }),
    }),
    [activeId, beginPending, describe, handleKey, keyboardMode, label],
  )

  return (
    <div ref={containerRef} className={className} data-dnd-scroll="">
      {visual.map((entry, i) => {
        if (entry.kind === 'placeholder') {
          return <DndPlaceholder key="__placeholder" height={box?.h ?? 48} radius={box?.radius} />
        }
        const api = apiFor(entry.id)
        return (
          <div
            key={entry.id}
            ref={register(entry.id)}
            data-sort-id={entry.id}
            data-drag-row={i}
            className={(itemClassName ? itemClassName + ' ' : '') + (api.keyboardDragging ? 'dnd-lift' : '') || undefined}
          >
            {renderItem(entry.id, api)}
          </div>
        )
      })}
      <DndLiveRegion message={message} />
    </div>
  )
}
