import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type ImgHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, Search, Star, TriangleAlert, X, type LucideIcon } from 'lucide-react'

export type Ic = LucideIcon
export const cx = (...a: unknown[]) => a.filter(Boolean).join(' ')

const V = {
  solid: 'bg-ac text-acx hover:opacity-90',
  soft: 'bg-hov hover:opacity-80',
  ghost: 'text-mu hover:bg-hov hover:text-tx',
  danger: 'text-er hover:bg-er/10',
  /** Inline text action ("Use another URL"), not a boxed button. */
  link: 'text-mu underline decoration-mu/40 underline-offset-2 hover:text-tx hover:decoration-tx',
}

export function Btn({ icon: I, v = 'ghost', sm, compact, children, className, ...p }: { icon?: Ic; v?: keyof typeof V; sm?: boolean; /** A labelled button that fits inside a banner or a dense row. */ compact?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...p} aria-label={p['aria-label'] ?? (!children ? p.title : undefined)} className={cx('inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-40', v === 'link' ? 'min-h-0 p-0 text-sm font-normal' : compact ? 'h-7 px-2 text-xs' : children ? 'h-9 px-3 text-sm' : sm ? 'size-7' : 'size-9', V[v], className)}>
      {I && <I size={sm ? 14 : 16} />}
      {children}
    </button>
  )
}

/** A button-shaped anchor. Same variants and sizes as Btn, for actions that
 *  navigate instead of running a handler. */
export const ABtn = ({ icon: I, v = 'soft', compact, children, className, ...p }: { icon?: Ic; v?: keyof typeof V; compact?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a {...p} className={cx('inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition-colors', compact ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-sm', V[v], className)}>{I && <I size={compact ? 13 : 16} />}{children}</a>
)

/** A choice pill: the same shape for research answers, tool questions and any
 *  other compact either/or row. */
export const Pill = ({ on = false, children, className, ...p }: { on?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" aria-pressed={on} {...p} className={cx('rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40', on ? 'border-ac bg-ac/10 text-tx' : 'border-bor text-mu hover:bg-hov hover:text-tx', className)}>{children}</button>
)

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

export function Checkbox({ checked, set, label, sub, disabled = false, className = '' }: { checked: boolean; set: (v: boolean) => void; /** Plain text or a row layout. */ label: ReactNode; /** Secondary line under the label, for option rows with detail. */ sub?: ReactNode; disabled?: boolean; className?: string }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={typeof label === 'string' ? label : undefined} disabled={disabled} onClick={() => set(!checked)} className={cx('inline-flex min-h-8 items-center gap-2 rounded-md text-left text-sm disabled:cursor-not-allowed disabled:opacity-40', className)}>
    <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center self-start rounded border transition-colors', checked ? 'border-ac bg-ac text-acx' : 'border-mu/60 bg-bg text-transparent')}><Check size={12} strokeWidth={3} /></span>
    <span className="min-w-0">{sub ? <><span className="block">{label}</span><span className="mt-0.5 block text-xs text-mu">{sub}</span></> : label}</span>
  </button>
}

/** Single choice in a list of rich rows (inference providers, model lists). */
export function Radio({ checked, onSelect, label, children, disabled = false, className = '' }: { checked: boolean; onSelect: () => void; label: string; children: ReactNode; disabled?: boolean; className?: string }) {
  return <button type="button" role="radio" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onSelect} className={cx('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-hov disabled:opacity-40', checked && 'bg-hov', className)}>
    <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center rounded-full border', checked ? 'border-ac' : 'border-mu/60')}>{checked && <span className="size-2 rounded-full bg-ac" />}</span>
    <span className="min-w-0 flex-1">{children}</span>
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
 * pattern promises (only the checked option is in the Tab order). The selected
 * pill is one element that slides between options, so choosing another moves
 * the highlight and its hairline across instead of blinking between buttons. */
export function Seg<T extends string>({ v, set, opts, label, fill = false, kind = 'radio', size = 'md', className, itemProps }: {
  v: T
  set: (v: T) => void
  opts: [T, string, Ic?][]
  /** Group name. Falls back to the option names when a call site has its own visible heading. */
  label?: string
  /** Stretch the segments across the container instead of hugging them. */
  fill?: boolean
  /** Radiogroup for a setting; tablist for a view switcher. Both render the same control. */
  kind?: 'radio' | 'tabs'
  size?: 'md' | 'sm'
  className?: string
  /** Extra attributes per option (focus markers used by the stats view). */
  itemProps?: (k: T) => Record<string, unknown>
}) {
  const ref = useRef<HTMLDivElement>(null)
  /* Measured position of the checked segment inside the group. Flex wrapping
   * can place it on a second row, so its vertical offset and height travel
   * with the horizontal move. */
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const measure = () => {
    const el = ref.current
    const checked = el?.querySelector<HTMLButtonElement>('[aria-checked="true"], [aria-selected="true"]')
    if (!el || !checked) { setPill(null); return }
    // Measured as a box difference rather than offsetLeft/offsetTop, so the
    // group's own padding and border cannot nudge the pill off the option.
    const box = checked.getBoundingClientRect()
    const root = el.getBoundingClientRect()
    const next = { x: box.left - root.left - el.clientLeft, y: box.top - root.top - el.clientTop, w: box.width, h: box.height }
    setPill((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next))
  }
  useLayoutEffect(measure, [v, opts])
  useEffect(() => {
    // A font-size change or a wrapped row moves the checked option without a
    // selection change, so re-measure instead of leaving the pill behind.
    const el = ref.current
    if (!el) return
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    addEventListener('resize', measure)
    return () => { ro?.disconnect(); removeEventListener('resize', measure) }
  }, [])
  const hasValue = opts.some(([k]) => k === v)
  const move = (delta: number) => {
    const at = Math.max(0, opts.findIndex(([k]) => k === v))
    const next = opts[(at + delta + opts.length) % opts.length]
    if (!next) return
    set(next[0])
    requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[opts.indexOf(next)]?.focus())
  }
  return (
    <div ref={ref} role={kind === 'tabs' ? 'tablist' : 'radiogroup'} aria-label={label ?? opts.map(([, l]) => l).join(' or ')} className={cx('relative gap-0.5 rounded-lg bg-surf p-0.5', fill ? 'flex w-full' : 'inline-flex flex-wrap', className)}>
      {pill && (
        <span
          aria-hidden="true"
          className="seg-pill pointer-events-none absolute left-0 top-0 rounded-md border border-tx/20 bg-hov"
          style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }}
        />
      )}
      {opts.map(([k, l, I], i) => (
        <button
          key={k} type="button" role={kind === 'tabs' ? 'tab' : 'radio'} {...(kind === 'tabs' ? { 'aria-selected': v === k } : { 'aria-checked': v === k })} tabIndex={v === k || (!hasValue && i === 0) ? 0 : -1}
          {...(itemProps?.(k) ?? {})}
          onClick={() => set(k)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
            else if (e.key === 'Home') { e.preventDefault(); set(opts[0][0]); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus()) }
            else if (e.key === 'End') { e.preventDefault(); const last = opts[opts.length - 1]; set(last[0]); requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[opts.length - 1]?.focus()) }
          }}
          className={cx('relative inline-flex items-center gap-1.5 rounded-md border border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-ac/40', size === 'sm' ? 'min-h-7 px-2 py-1 text-xs' : 'min-h-7 px-3 py-1.5 text-sm', fill && 'flex-1 justify-center', v === k ? 'font-medium text-tx' : 'text-mu hover:text-tx')}
        >
          {I && <I size={14} />}{l}
        </button>
      ))}
    </div>
  )
}

/* Every text field in the app is Input or Area: one radius, one focus ring,
 * one hover treatment and one set of sizes. Surfaces that sit on a different
 * background pick a tone instead of restyling the field. */
const FIELD = 'w-full rounded-lg text-tx outline-none transition-colors placeholder:text-mu/70 focus:ring-2 focus:ring-ac/40 disabled:cursor-not-allowed disabled:opacity-50'
const FIELD_TONE = { surf: 'bg-surf hover:bg-hov', bg: 'bg-bg hover:bg-hov', soft: 'bg-hov', none: 'bg-transparent' }
const FIELD_SIZE = { md: 'px-3 py-2 text-sm', sm: 'px-2 py-1 text-xs', xs: 'px-2 py-1.5 text-sm', lg: 'px-2 py-1.5 text-lg' }
export const Field = ({ label, children, row }: { label: string; children: ReactNode; /** Put a compact control to the right of its label instead of below it. */ row?: boolean }) => row ? (
  <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2"><span className="min-w-0 flex-1 text-sm">{label}</span><div className="ml-auto flex max-w-full shrink-0 items-center justify-end gap-2">{children}</div></div>
) : (
  <div className="space-y-1.5"><span className="block text-sm">{label}</span>{children}</div>
)
export const Input = forwardRef<HTMLInputElement, { value: string | number; set: (v: string) => void; size?: keyof typeof FIELD_SIZE; tone?: keyof typeof FIELD_TONE; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'>>(function Input({ value, set, size = 'md', tone = 'surf', className, ...p }, ref) {
  return <input ref={ref} {...p} value={value} onChange={(e) => set(e.target.value)} className={cx(FIELD, FIELD_SIZE[size], FIELD_TONE[tone], className)} />
})
export const Area = ({ value, set, rows = 4, size = 'md', tone = 'surf', resize = true, className, ...p }: { value: string; set: (v: string) => void; rows?: number; size?: keyof typeof FIELD_SIZE; tone?: keyof typeof FIELD_TONE; resize?: boolean; className?: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) => (
  <textarea {...p} rows={rows} value={value} onChange={(e) => set(e.target.value)} className={cx(FIELD, FIELD_SIZE[size], FIELD_TONE[tone], resize && 'resize-y', className)} />
)
/** Text field with a leading search icon (and an optional clear button). */
export function SearchInput({ value, set, label, placeholder = 'Search', size = 'md', clear = false, className, id, autoFocus, onKeyDown }: { value: string; set: (v: string) => void; label: string; placeholder?: string; size?: keyof typeof FIELD_SIZE; clear?: boolean; className?: string; id?: string; autoFocus?: boolean; onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void }) {
  return (
    <div className={cx('relative min-w-0', className)}>
      <Search size={size === 'sm' ? 14 : 16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
      <Input id={id} autoFocus={autoFocus} onKeyDown={onKeyDown} aria-label={label} placeholder={placeholder} value={value} set={set} size={size} className={cx(size === 'sm' ? 'pl-8' : 'pl-9', clear && 'pr-9')} />
      {clear && value && <Btn sm icon={X} title="Clear search" onClick={() => set('')} className="absolute right-1 top-1/2 -translate-y-1/2" />}
    </div>
  )
}
export const Sel = ({ value, set, opts, placeholder, inline, ariaLabel, className }: { value: string; set: (v: string) => void; opts: [string, string][]; placeholder?: string; inline?: boolean; ariaLabel?: string; className?: string }) => (
  <SearchSelect value={value} set={set} opts={opts} {...(placeholder ? { placeholder } : {})} {...(inline ? { inline } : {})} {...(ariaLabel ? { ariaLabel } : {})} {...(className ? { className } : {})} />
)

export function SearchSelect({ value, set, opts, ariaLabel = 'Choose an option', placeholder = 'Type to search', inline = false, allowCustom = false, className }: { value: string; set: (v: string) => void; opts: [string, string][]; ariaLabel?: string; placeholder?: string; inline?: boolean; /** Accept whatever was typed when nothing matches (font names). */ allowCustom?: boolean; className?: string }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const dismiss = () => { setOpen(false); setQuery('') }
  useEscapeClose(() => { dismiss(); trigger.current?.focus() }, open)
  const filtered = opts.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase()))
  const canCreate = allowCustom && !!query.trim() && !opts.some(([, label]) => label.toLowerCase() === query.trim().toLowerCase())
  const pickCustom = () => { const v = query.trim(); if (!v) return; set(v); setOpen(false); setQuery(''); trigger.current?.focus() }
  useEffect(() => { if (!open) return; const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(false); setQuery('') } }; addEventListener('pointerdown', close); return () => removeEventListener('pointerdown', close) }, [open])
  useEffect(() => { if (open) search.current?.focus() }, [open])
  const choose = (item: [string, string]) => { set(item[0]); setOpen(false); setQuery(''); trigger.current?.focus() }
  return <div ref={root} className={cx('relative', inline && 'min-w-0 max-w-full', className)}>
    <button ref={trigger} type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }} className={inline ? 'ml-auto flex max-w-full items-center justify-end gap-1.5 rounded-md px-1.5 py-1 text-sm text-mu transition-colors hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ac/40' : cx(FIELD, FIELD_SIZE.md, FIELD_TONE.surf, 'flex items-center justify-between text-left')}><span className="truncate">{opts.find(([k]) => k === value)?.[1] ?? value}</span>{inline ? <ChevronDown size={14} aria-hidden="true" className={cx('shrink-0 transition-transform', open && 'rotate-180')} /> : <ChevronRight size={14} aria-hidden="true" className={cx('ml-2 shrink-0 text-mu transition-transform', open && 'rotate-90')} />}</button>
    {open && <div className={cx('absolute z-40 mt-1', inline ? 'right-0 w-64 max-w-[min(16rem,80vw)]' : 'w-full')}><Menu>
      <Input ref={search} autoFocus value={query} set={(v) => { setQuery(v); setActive(0) }} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((n) => Math.min(n + 1, filtered.length - 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((n) => Math.max(n - 1, 0)) } else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active]); else if (canCreate) pickCustom() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); trigger.current?.focus() } }} placeholder={placeholder} aria-label="Search options" className="mb-1" />
      <div role="listbox" aria-label={ariaLabel} className="dd-list max-h-56 overflow-y-auto overscroll-contain">{filtered.map((item, i) => <button type="button" role="option" aria-selected={item[0] === value} key={item[0]} onMouseEnter={() => setActive(i)} onClick={() => choose(item)} className={cx('block w-full rounded-lg px-2.5 py-2 text-left text-sm', active === i ? 'bg-hov text-tx' : 'text-mu')}>{item[1]}</button>)}{!filtered.length && !canCreate && <div className="px-2.5 py-2 text-sm text-mu">No matches</div>}{canCreate && <button type="button" role="option" aria-selected={false} onClick={pickCustom} className="block w-full rounded-lg px-2.5 py-2 text-left text-sm text-mu hover:bg-hov hover:text-tx">Use “{query.trim()}”</button>}</div>
    </Menu></div>}
  </div>
}

export function RangeSlider({ value, set, min, max, step = 1, label, valueText, describedBy, id, disabled = false, className = '' }: { value: number; set: (n: number) => void; min: number; max: number; step?: number; label: string; valueText?: string; describedBy?: string; id?: string; disabled?: boolean; className?: string }) {
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
  return <div ref={ref} id={id} role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(shown * 100) / 100} aria-valuetext={valueText ?? String(shown)} aria-orientation="horizontal" aria-describedby={describedBy} aria-disabled={disabled} onPointerDown={(e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); move(snap(e.clientX)) }} onPointerMove={(e) => { if (!disabled && e.buttons) move(snap(e.clientX)) }} onPointerUp={() => { if (!disabled && drag !== null) commit(drag) }} onPointerCancel={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null } pending.current = null; setDrag(null) }} onKeyDown={(e) => { if (disabled) return; const delta = e.shiftKey ? step * 10 : step; if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setDrag(null); set(Math.min(max, shown + delta)) } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setDrag(null); set(Math.max(min, shown - delta)) } else if (e.key === 'Home') { e.preventDefault(); setDrag(null); set(min) } else if (e.key === 'End') { e.preventDefault(); setDrag(null); set(max) } else if (e.key === 'PageUp') { e.preventDefault(); setDrag(null); set(Math.min(max, shown + step * 10)) } else if (e.key === 'PageDown') { e.preventDefault(); setDrag(null); set(Math.max(min, shown - step * 10)) } }} className={cx('group relative h-7 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ac/40 rounded-md', disabled && 'opacity-40', className)}>
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

export const Item = ({ icon: I, children, sub, on, off, star, toggle, action, className, ...p }: { icon?: Ic; sub?: string; on?: boolean; off?: boolean; star?: { on: boolean; set: (on: boolean) => void }; /** A switch in place of the check, for rows that turn something on rather than choose it. */ toggle?: { on: boolean; set: (on: boolean) => void; label: string }; /** A trailing control beside the row (usually an icon button). */ action?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <div className={cx('group flex items-center rounded-lg hover:bg-hov', off && 'opacity-50', className)}>
    <button {...p} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm">
      {I && <I size={16} className="shrink-0 text-mu transition-colors group-hover:text-tx" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {sub && <span className="max-w-32 truncate text-xs text-mu transition-colors group-hover:text-tx">{sub}</span>}
      {on && !toggle && <Check size={16} className="shrink-0 text-ac" />}
    </button>
    {action && <span className="mr-1 shrink-0">{action}</span>}
    {toggle && <span className="mr-2 shrink-0"><Toggle on={toggle.on} set={toggle.set} label={toggle.label} /></span>}
    {star && <button type="button" aria-label={star.on ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={star.on} title={star.on ? 'Remove from favorites' : 'Add to favorites'} onClick={() => star.set(!star.on)} className={cx('mr-1 grid size-9 shrink-0 place-items-center rounded-md transition-colors hover:bg-hov hover:text-tx', star.on ? 'text-ac' : 'text-mu group-hover:text-tx')}><Star size={15} fill={star.on ? 'currentColor' : 'none'} /></button>}
  </div>
)

/* Focusable elements eligible for the modal tab cycle. */
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** The one dialog surface. Every modal panel renders this inside Modal, so the
 *  background, radius, padding, hairline and shadow cannot drift between the
 *  composer, Settings and the standalone dialogs. */
export function DialogPanel({ children, className, padded = true, gap = true, style }: { children: ReactNode; className?: string; padded?: boolean; gap?: boolean; style?: CSSProperties }) {
  return <div style={style} className={cx('modal-panel flex w-full flex-col rounded-2xl bg-bg shadow-2xl', gap && 'gap-4', padded && 'p-5', className)}>{children}</div>
}

const DIALOG_W = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'w-[min(64rem,100%)]',
  wide: 'w-[min(96vw,1100px)]',
}

/** Complete dialog: backdrop, focus trap, title row, body and footer. Call
 *  sites describe content and actions instead of rebuilding the shell. */
export function Dialog({ title, icon: I, iconClass, sub, close, children, footer, width = 'md', scroll = false, bodyClassName, panelClassName, label, blur, opacity, keyboard }: {
  title?: ReactNode
  icon?: Ic
  iconClass?: string
  sub?: ReactNode
  close: () => void
  children?: ReactNode
  footer?: ReactNode
  width?: keyof typeof DIALOG_W
  /** Keep the header and footer fixed and scroll the body. */
  scroll?: boolean
  bodyClassName?: string
  panelClassName?: string
  /** Accessible name when there is no visible title. */
  label?: string
  blur?: boolean
  opacity?: number
  keyboard?: boolean
}) {
  const titleId = useRef(`dialog-title-${++layerId}`)
  return (
    <Modal close={close} labelledBy={title ? titleId.current : undefined} label={title ? undefined : label} blur={blur} opacity={opacity} keyboard={keyboard}>
      <DialogPanel className={cx(DIALOG_W[width], scroll && 'max-h-[88dvh] overflow-hidden', panelClassName)}>
        {title && (
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId.current} className="flex items-center gap-2 text-base font-semibold">
                {I && <I size={18} aria-hidden="true" className={cx('shrink-0', iconClass ?? 'text-ac')} />}
                <span className="min-w-0 truncate">{title}</span>
              </h2>
              {sub && <p className="mt-0.5 text-xs text-mu">{sub}</p>}
            </div>
            <Btn sm icon={X} title="Close" onClick={close} />
          </div>
        )}
        {children != null && <div className={cx('min-w-0 space-y-4', scroll && 'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1', bodyClassName)}>{children}</div>}
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{footer}</div>}
      </DialogPanel>
    </Modal>
  )
}

/** A floating menu anchored at viewport coordinates (chat row actions, theme
 *  and project pickers). Owns the menu chrome and the menu role. */
export function ContextMenu({ label, left, top, width = 208, onKeyDown, children, className, menuRef }: {
  label: string
  left: number
  top: number
  width?: number
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
  className?: string
  /** So the caller can run useMenuNav over this menu. */
  menuRef?: RefObject<HTMLDivElement>
}) {
  return (
    <div ref={menuRef} role="menu" aria-label={label} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown} style={{ left, top, width }} className={cx('menu-surface fixed z-40 rounded-xl bg-surf p-1.5', className)}>{children}</div>
  )
}

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

/** Full-screen viewer for pasted text. Uses the same portal and dialog shell as
 *  the image lightbox so the two previews behave identically. */
export function TextLightbox({ text, title, close }: { text: string; title: string; close: () => void }) {
  return createPortal(
    <Dialog title={title} close={close} width="wide" scroll blur={false} opacity={82} panelClassName="max-h-[92vh] overflow-hidden" bodyClassName="min-h-0 flex-1 overflow-auto">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-tx">{text}</pre>
    </Dialog>,
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
  return (
    <Dialog title={title} icon={TriangleAlert} iconClass="text-er" width="sm" label={title} close={close}
      footer={<><Btn v="soft" onClick={close}>Cancel</Btn><Btn v="danger" onClick={() => { run(); close() }}>{ok}</Btn></>}>
      <p className="text-sm text-mu">{text}</p>
    </Dialog>
  )
}
