import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ImgHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, Star, TriangleAlert, X, type LucideIcon } from 'lucide-react'

export type Ic = LucideIcon
export const cx = (...a: unknown[]) => a.filter(Boolean).join(' ')

const V = {
  solid: 'bg-ac text-acx hover:opacity-90',
  soft: 'bg-hov hover:opacity-80',
  ghost: 'text-mu hover:bg-hov hover:text-tx',
  danger: 'text-er hover:bg-er/10',
}

export function Btn({ icon: I, v = 'ghost', sm, children, className, ...p }: { icon?: Ic; v?: keyof typeof V; sm?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...p} aria-label={p['aria-label'] ?? (!children ? p.title : undefined)} className={cx('inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40', children ? 'h-9 px-3' : sm ? 'size-7' : 'size-9', V[v], className)}>
      {I && <I size={sm ? 14 : 16} />}
      {children}
    </button>
  )
}

export const Chip = ({ icon: I, children }: { icon?: Ic; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md bg-hov px-2 py-1 text-xs">{I && <I size={12} />}{children}</span>
)

/* Every switch is named: a `role="switch"` without an accessible name is
 * announced as just "switch, on" by a screen reader. The visual track stays
 * 20px tall; a pseudo-element widens the hit area to 32x28 for touch and
 * motor-impaired users without changing the row rhythm. */
export const Toggle = ({ on, set, label, disabled = false }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set(!on)} className={cx('relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors before:absolute before:-inset-x-1.5 before:-inset-y-1 before:content-[""] disabled:opacity-40', on ? 'bg-ac' : 'bg-hov')}>
    <span className={cx('block size-4 rounded-full transition-transform', on ? 'translate-x-4 bg-acx' : 'bg-mu')} />
  </button>
)

/* Single surface primitive: codifies rounded-xl + bg-surf + p-3/p-4.
 * Settings Card, WidgetCard, Chat Tile and Extra Box should all wrap this. */
export const Surface = ({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) => (
  <div className={cx('rounded-xl bg-surf', padded && 'p-3', className)}>{children}</div>
)

/* Single dropdown-menu primitive: one bg, radius, border, shadow and max-h
 * for Pop, SearchSelect, Palette, ModelMenu, chat actions and the context
 * meter. */
export const Menu = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('menu-surface rounded-xl bg-surf p-1.5', className)}>{children}</div>
)

export function Checkbox({ checked, set, label, disabled = false, className = '' }: { checked: boolean; set: (v: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => set(!checked)} className={cx('inline-flex min-h-8 items-center gap-2 rounded-md text-left text-sm disabled:cursor-not-allowed disabled:opacity-40', className)}>
    <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center rounded border transition-colors', checked ? 'border-ac bg-ac text-acx' : 'border-mu/60 bg-bg text-transparent')}><Check size={12} strokeWidth={3} /></span>{label}
  </button>
}

let layerId = 0

/* Escape must close only the top-most layer: a Confirm opened inside a modal
 * inside another modal would otherwise dismiss every open layer at
 * once. Layers push themselves when they open and pop on unmount. */
const escStack: Array<(e: KeyboardEvent) => void> = []
export function useEscapeClose(close: () => void, active = true): void {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || escStack[escStack.length - 1] !== h) return
      e.stopPropagation()
      ref.current()
    }
    escStack.push(h)
    addEventListener('keydown', h)
    return () => {
      removeEventListener('keydown', h)
      const i = escStack.indexOf(h)
      if (i >= 0) escStack.splice(i, 1)
    }
  }, [active])
}

/* Shared keyboard contract for pop-up menus: opening moves focus to the
 * selected item (or the first action), arrows/Home/End move between items,
 * and Escape or Tab closes and returns focus to the trigger. */
export function useMenuNav(open: boolean, menuRef: RefObject<HTMLElement>, close: () => void, returnFocus?: () => void) {
  const closeRef = useRef(close)
  const returnRef = useRef(returnFocus)
  closeRef.current = close
  returnRef.current = returnFocus
  useEscapeClose(() => { closeRef.current(); returnRef.current?.() }, open)
  useEffect(() => {
    if (!open || !menuRef.current) return
    const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [role="menuitem"]:not([disabled])')).filter((item) => item.getClientRects().length > 0)
    const selected = items.find((item) => item.getAttribute('aria-checked') === 'true')
    ;(selected ?? items[0])?.focus()
  }, [open, menuRef])
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      closeRef.current()
      returnRef.current?.()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const menu = menuRef.current
    if (!menu) return
    const items = Array.from(menu.querySelectorAll<HTMLElement>('button:not([disabled]), [role="menuitem"]:not([disabled])')).filter((item) => item.getClientRects().length > 0)
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
        : at < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
}

/* Mutually exclusive choices. Exposed as a radiogroup so assistive technology
 * hears which option is selected, with the arrow-key roving focus the radio
 * pattern promises (only the checked option is in the Tab order). */
export function Seg<T extends string>({ v, set, opts, label }: { v: T; set: (v: T) => void; opts: [T, string, Ic?][]; /** Group name. Falls back to the option names when a call site has its own visible heading. */ label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const hasValue = opts.some(([k]) => k === v)
  const move = (delta: number) => {
    const at = Math.max(0, opts.findIndex(([k]) => k === v))
    const next = opts[(at + delta + opts.length) % opts.length]
    if (!next) return
    set(next[0])
    requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[opts.indexOf(next)]?.focus())
  }
  return (
    <div ref={ref} role="radiogroup" aria-label={label ?? opts.map(([, l]) => l).join(' or ')} className="inline-flex flex-wrap gap-0.5 rounded-lg bg-surf p-0.5">
      {opts.map(([k, l, I], i) => (
        <button
          key={k} type="button" role="radio" aria-checked={v === k} tabIndex={v === k || (!hasValue && i === 0) ? 0 : -1}
          onClick={() => set(k)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
            else if (e.key === 'Home') { e.preventDefault(); set(opts[0][0]); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus()) }
            else if (e.key === 'End') { e.preventDefault(); const last = opts[opts.length - 1]; set(last[0]); requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[opts.length - 1]?.focus()) }
          }}
          className={cx('inline-flex min-h-7 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ac/40', v === k ? 'bg-hov font-medium text-tx' : 'text-mu hover:text-tx')}
        >
          {I && <I size={14} />}{l}
        </button>
      ))}
    </div>
  )
}

const IN = 'w-full rounded-lg bg-surf px-3 py-2 text-sm outline-none transition-colors hover:bg-hov focus:ring-2 focus:ring-ac/40'
export const Field = ({ label, children, row }: { label: string; children: ReactNode; /** Put a compact control to the right of its label instead of below it. */ row?: boolean }) => row ? (
  <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2"><span className="min-w-0 flex-1 text-sm">{label}</span><div className="ml-auto flex max-w-full shrink-0 items-center justify-end gap-2">{children}</div></div>
) : (
  <div className="space-y-1.5"><span className="block text-sm">{label}</span>{children}</div>
)
export const Input = ({ value, set, ...p }: { value: string | number; set: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) => (
  <input {...p} value={value} onChange={(e) => set(e.target.value)} className={IN} />
)
export const Area = ({ value, set, rows = 4, className, ...p }: { value: string; set: (v: string) => void; rows?: number; className?: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) => (
  <textarea {...p} rows={rows} value={value} onChange={(e) => set(e.target.value)} className={cx(IN, 'resize-y', className)} />
)
export const Sel = ({ value, set, opts, placeholder, inline }: { value: string; set: (v: string) => void; opts: [string, string][]; placeholder?: string; inline?: boolean }) => (
  <SearchSelect value={value} set={set} opts={opts} {...(placeholder ? { placeholder } : {})} {...(inline ? { inline } : {})} />
)

export function SearchSelect({ value, set, opts, ariaLabel = 'Choose an option', placeholder = 'Type to search', inline = false }: { value: string; set: (v: string) => void; opts: [string, string][]; ariaLabel?: string; placeholder?: string; inline?: boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const dismiss = () => { setOpen(false); setQuery('') }
  useEscapeClose(() => { dismiss(); trigger.current?.focus() }, open)
  const filtered = opts.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => { if (!open) return; const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(false); setQuery('') } }; addEventListener('pointerdown', close); return () => removeEventListener('pointerdown', close) }, [open])
  useEffect(() => { if (open) search.current?.focus() }, [open])
  const choose = (item: [string, string]) => { set(item[0]); setOpen(false); setQuery(''); trigger.current?.focus() }
  return <div ref={root} className={cx('relative', inline && 'min-w-0 max-w-full')}>
    <button ref={trigger} type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }} className={inline ? 'flex max-w-full items-center justify-end gap-1.5 rounded-md px-1.5 py-1 text-sm text-mu transition-colors hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ac/40' : cx(IN, 'flex items-center justify-between text-left')}><span className="truncate">{opts.find(([k]) => k === value)?.[1] ?? value}</span>{inline ? <ChevronDown size={14} aria-hidden="true" className={cx('shrink-0 transition-transform', open && 'rotate-180')} /> : <ChevronRight size={14} aria-hidden="true" className={cx('ml-2 shrink-0 text-mu transition-transform', open && 'rotate-90')} />}</button>
    {open && <div className={cx('absolute z-40 mt-1', inline ? 'right-0 w-64 max-w-[min(16rem,80vw)]' : 'w-full')}><Menu>
      <input ref={search} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0) }} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((n) => Math.min(n + 1, filtered.length - 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((n) => Math.max(n - 1, 0)) } else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); choose(filtered[active]) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); trigger.current?.focus() } }} placeholder={placeholder} aria-label="Search options" className="mb-1 w-full rounded-lg bg-surf px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
      <div role="listbox" aria-label={ariaLabel} className="dd-list max-h-56 overflow-y-auto overscroll-contain">{filtered.map((item, i) => <button type="button" role="option" aria-selected={item[0] === value} key={item[0]} onMouseEnter={() => setActive(i)} onClick={() => choose(item)} className={cx('block w-full rounded-lg px-2.5 py-2 text-left text-sm', active === i ? 'bg-hov text-tx' : 'text-mu')}>{item[1]}</button>)}{!filtered.length && <div className="px-2.5 py-2 text-sm text-mu">No matches</div>}</div>
    </Menu></div>}
  </div>
}

export function RangeSlider({ value, set, min, max, step = 1, label, valueText, describedBy, disabled = false, className = '' }: { value: number; set: (n: number) => void; min: number; max: number; step?: number; label: string; valueText?: string; describedBy?: string; disabled?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const pct = Math.max(0, Math.min(100, (shown - min) / (max - min) * 100))
  const setRef = useRef(set); setRef.current = set
  const valRef = useRef(value); valRef.current = value
  const lastPush = useRef(0), pending = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const snap = (clientX: number) => { const r = ref.current!.getBoundingClientRect(), raw = min + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (max - min); return Math.max(min, Math.min(max, min + Math.round((raw - min) / step) * step)) }
  const push = (n: number) => { // throttled live store write so sibling labels update without per-mousemove persist
    if (n === valRef.current && n === pending.current) return
    const now = Date.now()
    if (now - lastPush.current >= 80) { lastPush.current = now; pending.current = null; if (timer.current) { clearTimeout(timer.current); timer.current = null } if (n !== valRef.current) setRef.current(n) }
    else { pending.current = n; if (!timer.current) timer.current = setTimeout(() => { timer.current = null; lastPush.current = Date.now(); const p = pending.current; pending.current = null; if (p !== null && p !== valRef.current) setRef.current(p) }, 80 - (now - lastPush.current)) }
  }
  const move = (n: number) => { setDrag(n); push(n) }
  const commit = (n: number) => { setDrag(null); if (timer.current) { clearTimeout(timer.current); timer.current = null } pending.current = null; lastPush.current = Date.now(); if (n !== valRef.current) setRef.current(n) }
  return <div ref={ref} role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(shown * 100) / 100} aria-valuetext={valueText ?? String(shown)} aria-orientation="horizontal" aria-describedby={describedBy} aria-disabled={disabled} onPointerDown={(e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); move(snap(e.clientX)) }} onPointerMove={(e) => { if (!disabled && e.buttons) move(snap(e.clientX)) }} onPointerUp={() => { if (!disabled && drag !== null) commit(drag) }} onPointerCancel={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null } pending.current = null; setDrag(null) }} onKeyDown={(e) => { if (disabled) return; const delta = e.shiftKey ? step * 10 : step; if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setDrag(null); set(Math.min(max, shown + delta)) } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setDrag(null); set(Math.max(min, shown - delta)) } else if (e.key === 'Home') { e.preventDefault(); setDrag(null); set(min) } else if (e.key === 'End') { e.preventDefault(); setDrag(null); set(max) } else if (e.key === 'PageUp') { e.preventDefault(); setDrag(null); set(Math.min(max, shown + step * 10)) } else if (e.key === 'PageDown') { e.preventDefault(); setDrag(null); set(Math.max(min, shown - step * 10)) } }} className={cx('group relative h-7 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ac/40 rounded-md', disabled && 'opacity-40', className)}>
    <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full border border-mu/50 bg-mu/35 shadow-inner"><div className="h-full rounded-full bg-ac shadow-[0_0_5px_color-mix(in_srgb,var(--ac)_55%,transparent)]" style={{ width: `${pct}%` }} /></div><div className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-ac shadow-md ring-1 ring-ac/50 group-focus-visible:ring-4 group-focus-visible:ring-ac/30" style={{ left: `${pct}%` }} />
  </div>
}

export function Pop({ trigger, children, up, right, w = 'w-72', scroll = true, autoFocus = false, onOpenChange }: { trigger: (o: boolean) => ReactNode; children: (close: () => void) => ReactNode; up?: boolean; right?: boolean; w?: string; scroll?: boolean; /** Move focus into the first action when the popover opens. */ autoFocus?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [o, setO] = useState(false)
  const r = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null)
  const flip = (v: boolean) => { setO(v); onOpenChange?.(v) }
  useEscapeClose(() => { flip(false); triggerRef.current?.querySelector<HTMLElement>('button')?.focus() }, o)
  useEffect(() => {
    if (!o || !autoFocus) return
    menuRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
  }, [o, autoFocus])
  useEffect(() => {
    if (!o) return
    const f = (e: MouseEvent) => { if (!r.current?.contains(e.target as Node)) flip(false) }
    addEventListener('mousedown', f)
    return () => removeEventListener('mousedown', f)
  }, [o])
  return (
    <div ref={r} className="relative">
      <div ref={triggerRef} onClick={() => flip(!o)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !o) { e.preventDefault(); flip(true) } }}>{trigger(o)}</div>
      {o && <div ref={menuRef} onKeyDown={(e) => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return; const target = e.target as HTMLElement; if (target.closest('input,textarea,select,[role="slider"],[contenteditable="true"]')) return; const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).filter(item => item.getClientRects().length > 0); if (!items.length) return; e.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement); const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : index < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next].focus() }} className={cx('absolute z-30 max-w-[calc(100vw-1rem)]', w, up ? 'bottom-full mb-2' : 'top-full mt-2', right ? 'right-0' : 'left-0')}><Menu className={cx(scroll ? 'max-h-96 overflow-y-auto overscroll-contain' : 'overflow-hidden')}>{children(() => flip(false))}</Menu></div>}
    </div>
  )
}

export const Item = ({ icon: I, children, sub, on, off, star, toggle, className, ...p }: { icon?: Ic; sub?: string; on?: boolean; off?: boolean; star?: { on: boolean; set: (on: boolean) => void }; /** A switch in place of the check, for rows that turn something on rather than choose it. */ toggle?: { on: boolean; set: (on: boolean) => void; label: string } } & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <div className={cx('group flex items-center rounded-lg hover:bg-hov', off && 'opacity-50', className)}>
    <button {...p} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm">
      {I && <I size={16} className="shrink-0 text-mu transition-colors group-hover:text-tx" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {sub && <span className="max-w-32 truncate text-xs text-mu transition-colors group-hover:text-tx">{sub}</span>}
      {on && !toggle && <Check size={16} className="shrink-0 text-ac" />}
    </button>
    {toggle && <span className="mr-2 shrink-0"><Toggle on={toggle.on} set={toggle.set} label={toggle.label} /></span>}
    {star && <button type="button" aria-label={star.on ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={star.on} title={star.on ? 'Remove from favorites' : 'Add to favorites'} onClick={() => star.set(!star.on)} className={cx('mr-1 grid size-9 shrink-0 place-items-center rounded-md transition-colors hover:bg-hov hover:text-tx', star.on ? 'text-ac' : 'text-mu group-hover:text-tx')}><Star size={15} fill={star.on ? 'currentColor' : 'none'} /></button>}
  </div>
)

/* Focusable elements eligible for the modal tab cycle. */
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({ children, close, blur = true, opacity = 55, keyboard = true, labelledBy, label }: { children: ReactNode; close: () => void; blur?: boolean; opacity?: number; keyboard?: boolean; labelledBy?: string; /** Accessible name when the dialog has no heading to point at. */ label?: string }) {
  useEscapeClose(close, keyboard)
  const root = useRef<HTMLDivElement>(null)
  /* Keyboard users must land inside the dialog, Tab must cycle within it, and
     closing it must hand focus back to whatever opened it. */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = root.current
    if (node && !node.contains(document.activeElement)) node.focus()
    return () => { try { previous?.focus() } catch { /* the opener is gone */ } }
  }, [])
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    // Nested dialogs each own their own cycle; the outer one must not
    // re-wrap a Tab that the inner dialog already handled.
    e.stopPropagation()
    const node = root.current
    if (!node) return
    const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(item => item.getClientRects().length > 0 && !item.closest('[inert], [aria-hidden="true"]'))
    if (!items.length) { e.preventDefault(); node.focus(); return }
    const first = items[0], last = items[items.length - 1]
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) { e.preventDefault(); last.focus() }
  }
  return <div ref={root} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} tabIndex={-1} onKeyDown={onKeyDown} style={{ backgroundColor: `rgb(0 0 0 / ${Math.max(0, Math.min(100, opacity))}%)`, backdropFilter: blur ? 'blur(var(--modal-blur, 12px))' : undefined }} className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain p-4 outline-none" onMouseDown={(e) => e.target === e.currentTarget && close()}>{children}</div>
}

/** Full-screen image viewer. Clicking the backdrop, the close button, or
 *  pressing Escape closes it; the image itself stays put.
 *
 *  Rendered into <body> instead of in place: the composer sets a transform (and
 *  a backdrop filter when glass is on), and either one turns that element into
 *  the containing block for `position: fixed`. An inline lightbox was therefore
 *  caged inside the composer instead of covering the window. */
export function ImageLightbox({ src, alt, close }: { src: string; alt?: string; close: () => void }) {
  return createPortal(
    <Modal close={close} blur={false} opacity={82} label={alt ? `Image: ${alt}` : 'Image preview'}>
      <figure className="relative m-0 flex max-h-[94vh] w-full max-w-[min(96vw,1400px)] items-center justify-center">
        <img src={src} alt={alt ?? ''} className="max-h-[94vh] w-auto max-w-full rounded-lg object-contain shadow-2xl" />
        <Btn sm icon={X} title="Close full screen" onClick={close} className="absolute right-2 top-2 bg-black/60 text-white hover:bg-black/80" />
      </figure>
    </Modal>,
    document.body,
  )
}

/** Full-screen viewer for pasted text. Uses the same portal and modal shell as
 *  the image lightbox so the two previews behave identically. */
export function TextLightbox({ text, title, close }: { text: string; title: string; close: () => void }) {
  const titleId = useRef(`text-preview-${++layerId}`)
  return createPortal(
    <Modal close={close} blur={false} opacity={82} labelledBy={titleId.current}>
      <section className="modal-panel flex max-h-[92vh] w-full max-w-[min(96vw,1100px)] flex-col overflow-hidden rounded-2xl border border-bor bg-bg shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-bor px-4 py-3">
          <div id={titleId.current} className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
          <Btn sm icon={X} title="Close full screen" onClick={close} />
        </header>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm leading-relaxed text-tx">{text}</pre>
      </section>
    </Modal>,
    document.body,
  )
}

/** An image that opens the lightbox when clicked. Clicks on a button or link
 *  inside the surrounding card are left alone, so the controls keep working. */
export function ZoomableImage({ src, alt, className, ...rest }: { src: string; alt?: string; className?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className'>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <img
        {...rest}
        src={src}
        alt={alt ?? ''}
        className={cx(className, 'cursor-zoom-in')}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) return
          setOpen(true)
        }}
      />
      {open && <ImageLightbox src={src} alt={alt} close={() => setOpen(false)} />}
    </>
  )
}

export function Confirm({ title, text, ok, close, run }: { title: string; text: string; ok: string; close: () => void; run: () => void }) {
  const titleId = useRef(`confirm-title-${++layerId}`)
  return (
    <Modal close={close} labelledBy={titleId.current}>
      <div className="modal-panel w-full max-w-sm space-y-4 rounded-2xl bg-bg p-5">
        <div id={titleId.current} className="flex items-center gap-2 font-semibold"><TriangleAlert size={18} className="text-er" />{title}</div>
        <p className="text-sm text-mu">{text}</p>
        <div className="flex justify-end gap-2">
          <Btn v="soft" onClick={close}>Cancel</Btn>
          <Btn v="danger" onClick={() => { run(); close() }}>{ok}</Btn>
        </div>
      </div>
    </Modal>
  )
}
