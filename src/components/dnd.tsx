import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flipDelta, parseTranslateY, stepInsertion } from '../dndShared'

/* Pointer-based drag-and-drop, shared by SortableList and the Sidebar.
 *
 * Three rules keep motion stable under fast, reversing drags:
 *
 * 1. Placement is decided from a snapshot of the rest layout taken at lift.
 *    Midpoints never come from live rects, because live rects include the
 *    sibling animations we are running, and those feed back into the decision
 *    and make the placeholder flicker. The snapshot is the slot grid; the
 *    pointer is converted to document coordinates, so auto-scroll still works.
 *
 * 2. Every reflow animates from the row's *visual* position. Each row's
 *    layout top is recorded without transforms. On the next commit the
 *    currently applied translate is read back from computed style, and the
 *    running animation is cancelled before the new one starts from exactly
 *    where the row is on screen. Nothing ever teleports, and interruptions
 *    cannot accumulate.
 *
 * 3. One requestAnimationFrame loop per drag does all work (overlay position,
 *    target, edge auto-scroll). Pointer events only store coordinates, so
 *    stale frames are never queued.
 *
 * Also: 6px activation threshold so clicks and text selection still work,
 * Escape cancels, keyboard reorder is supported, and no new dependencies are
 * needed.
 */

export const DND_ACTIVATION_PX = 6

export function measureBox(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return { w: r.width, h: r.height, radius: cs.borderRadius || '12px' }
}

/** Sum of scroll offsets of everything above `el`. `rect.top + this` is a
 *  document coordinate that stays put while any ancestor scrolls. */
export function scrollSumAbove(el: HTMLElement): number {
  let sum = window.scrollY
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    sum += p.scrollTop
  }
  return sum
}

function translateYOf(el: HTMLElement): number {
  return parseTranslateY(getComputedStyle(el).transform)
}

/** Document-space top of an element's layout box, ignoring any animation
 *  transform currently applied to it. */
export function restDocTop(el: HTMLElement): number {
  return el.getBoundingClientRect().top + scrollSumAbove(el) - translateYOf(el)
}

/** Document-space y for a viewport pointer position, relative to `el`'s
 *  content. Same coordinate system as `restDocTop`. */
export function pointerDocY(clientY: number, el: HTMLElement): number {
  return clientY + scrollSumAbove(el) + el.scrollTop
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

/** Scroll the nearest scrollers (and the window) when the pointer nears an edge. */
export function edgeScroll(clientY: number, scrollers: (HTMLElement | null)[]) {
  for (const t of scrollers) {
    if (!t || t === document.body || t === document.documentElement) continue
    if (t.scrollHeight <= t.clientHeight + 4) continue
    const r = t.getBoundingClientRect()
    if (clientY < r.top + 56) t.scrollTop -= 10
    else if (clientY > r.bottom - 56) t.scrollTop += 10
  }
  if (clientY < 72) window.scrollBy(0, -10)
  else if (clientY > window.innerHeight - 72) window.scrollBy(0, 10)
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

const FLIP_MS = 180

/** Reflow animation for rows whose layout changed. Call it in a layout effect
 *  after each commit. `layoutKey` must change when the visible order changes.
 *
 *  Each row starts from its visual position and eases to its new slot. A row
 *  that is interrupted by another commit restarts from wherever it is on
 *  screen (see `flipDelta`), never from a stale slot. */
export function useFlipAnimate(elsRef: React.RefObject<Map<string, HTMLElement>>, disabled: boolean, layoutKey: string) {
  const prev = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const els = elsRef.current
    if (!els) return

    // Read phase: the DOM already has the new layout, but running animations
    // still apply, so `restDocTop` gives the new slot and `translateYOf` gives
    // the translate the row is currently drawn with.
    const next = new Map<string, number>()
    const starts: [HTMLElement, number][] = []
    els.forEach((el, id) => {
      const now = restDocTop(el)
      next.set(id, now)
      const before = prev.current.get(id)
      if (before == null || disabled) return
      const delta = flipDelta(before, translateYOf(el), now)
      if (Math.abs(delta) > 0.5) starts.push([el, delta])
    })

    // Write phase: cancel stale motion, then start one fresh animation per row.
    els.forEach((el) => el.getAnimations().forEach((a) => a.cancel()))
    for (const [el, delta] of starts) {
      el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0px)' }], {
        duration: FLIP_MS,
        easing: 'ease',
      })
    }
    prev.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, disabled])
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
type Drag = { id: string; dx: number; dy: number; x: number; y: number; pointer: boolean; raf: number }

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
  const drag = useRef<Drag | null>(null)
  // Midpoints of the rest rows, in document space, captured at lift.
  const slots = useRef<number[]>([])
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

  // Visible order: source ids minus the dragged one, placeholder at insertAt.
  const visual = useMemo(() => {
    if (!activeId) return ids.map((id) => ({ kind: 'item' as const, id }))
    const rest = ids.filter((id) => id !== activeId)
    const at = Math.max(0, Math.min(insertAt, rest.length))
    const out: ({ kind: 'item'; id: string } | { kind: 'placeholder' })[] = rest.map((id) => ({ kind: 'item' as const, id }))
    out.splice(at, 0, { kind: 'placeholder' })
    return out
  }, [ids, activeId, insertAt])

  const layoutKey = visual.map((v) => (v.kind === 'item' ? v.id : '__ph')).join(',')
  useFlipAnimate(itemEls, reducedMotion, layoutKey)

  const takeSnapshot = useCallback((draggedId: string) => {
    const mids: number[] = []
    for (const id of stateRef.current.ids) {
      if (id === draggedId) continue
      const el = itemEls.current.get(id)
      if (!el) continue
      mids.push(restDocTop(el) + el.getBoundingClientRect().height / 2)
    }
    slots.current = mids
  }, [])

  const computeInsertAt = useCallback((clientY: number) => {
    const c = containerRef.current
    if (!c) return stateRef.current.insertAt
    return stepInsertion(slots.current, pointerDocY(clientY, c), stateRef.current.insertAt)
  }, [])

  const cleanup = useCallback(() => {
    const d = drag.current
    if (d) cancelAnimationFrame(d.raf)
    drag.current = null
    pending.current = null
    slots.current = []
    hideDragOverlay()
  }, [])

  const finish = useCallback(
    (commit: boolean) => {
      const d = drag.current
      if (!d) {
        cleanup()
        return
      }
      const cur = stateRef.current.ids
      // Pointer drops resolve the slot from the latest pointer position, not the
      // last rendered state: a fast release can land before the frame loop's
      // setState has committed.
      const at = d.pointer ? computeInsertAt(d.y) : stateRef.current.insertAt
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

  // One frame loop per pointer drag: overlay, target, and edge scrolling.
  const frame = useCallback(() => {
    const d = drag.current
    if (!d || !d.pointer) return
    moveDragOverlay(d.x, d.y, d.dx, d.dy)
    const at = computeInsertAt(d.y)
    if (at !== stateRef.current.insertAt) setInsertAt(at)
    edgeScroll(d.y, [containerRef.current, containerRef.current?.closest('[data-dnd-scroll]') as HTMLElement | null])
    d.raf = requestAnimationFrame(frame)
  }, [computeInsertAt])

  const frameRef = useRef(frame)
  frameRef.current = frame

  const onWindowMove = useCallback((e: PointerEvent) => {
    const d = drag.current
    const p = pending.current
    if (d) {
      e.preventDefault()
      d.x = e.clientX
      d.y = e.clientY
      return
    }
    if (!p) return
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DND_ACTIVATION_PX) return
    const el = itemEls.current.get(p.id)
    pending.current = null
    if (!el) return
    // Snapshot the rest layout before the dragged row leaves the DOM.
    takeSnapshot(p.id)
    const b = measureBox(el)
    const from = stateRef.current.ids.indexOf(p.id)
    showDragOverlay(el, e.clientX, e.clientY)
    drag.current = { id: p.id, dx: p.dx, dy: p.dy, x: e.clientX, y: e.clientY, pointer: true, raf: 0 }
    drag.current.raf = requestAnimationFrame(() => frameRef.current())
    setBox(b)
    setActiveId(p.id)
    setInsertAt(from >= 0 ? from : 0)
    setMessage(`${label ?? 'Item'} lifted. Use arrow keys or pointer to move, release to drop, Escape to cancel.`)
  }, [label, takeSnapshot])

  const onWindowUp = useCallback(() => {
    if (drag.current) finish(true)
    else cleanup()
  }, [cleanup, finish])

  const onWindowCancel = useCallback(() => {
    if (drag.current) finish(false)
    else cleanup()
  }, [cleanup, finish])

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
      cleanup()
    }
  }, [cleanup])

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
          drag.current = { id, dx: 0, dy: 0, x: 0, y: 0, pointer: false, raf: 0 }
          setBox(b)
          setActiveId(id)
          setKeyboardMode(true)
          setInsertAt(from >= 0 ? from : 0)
          setMessage(`${describe?.(id) ?? label ?? 'Item'} lifted at position ${from + 1} of ${cur.length}. Arrow keys move, Enter drops, Escape cancels.`)
        }
        return
      }
      const restLen = cur.length - 1
      const move = (next: number) => {
        const clamped = Math.max(0, Math.min(restLen, next))
        setInsertAt(clamped)
        setMessage(`Destination position ${clamped + 1} of ${cur.length}.`)
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        move(stateRef.current.insertAt + (e.key === 'ArrowDown' ? 1 : -1))
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
        setInsertAt(restLen)
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
