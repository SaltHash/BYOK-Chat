import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Check, ChevronRight, CircleHelp, TriangleAlert, type LucideIcon } from 'lucide-react'

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
    <button {...p} className={cx('inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40', children ? 'h-9 px-3' : sm ? 'size-7' : 'size-9', V[v], className)}>
      {I && <I size={sm ? 14 : 16} />}
      {children}
    </button>
  )
}

export const Chip = ({ icon: I, children }: { icon?: Ic; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md bg-hov px-2 py-1 text-xs">{I && <I size={12} />}{children}</span>
)

export const Toggle = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label?: string }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} className={cx('h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors', on ? 'bg-ac' : 'bg-hov')}>
    <span className={cx('block size-4 rounded-full transition-transform', on ? 'translate-x-4 bg-acx' : 'bg-mu')} />
  </button>
)

/* Single surface primitive: codifies rounded-xl + bg-surf + p-3/p-4.
 * Settings Card, WidgetCard, Chat Tile and Extra Box should all wrap this. */
export const Surface = ({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) => (
  <div className={cx('rounded-xl bg-surf', padded && 'p-3', className)}>{children}</div>
)

/* Single dropdown-menu primitive: one bg, radius, shadow, max-h for Pop,
 * SearchSelect, Palette and ModelMenu. */
export const Menu = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('rounded-xl bg-hov p-1.5 shadow-md', className)}>{children}</div>
)

export function Checkbox({ checked, set, label, disabled = false, className = '' }: { checked: boolean; set: (v: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => set(!checked)} className={cx('inline-flex min-h-8 items-center gap-2 rounded-md text-left text-sm disabled:cursor-not-allowed disabled:opacity-40', className)}>
    <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center rounded border transition-colors', checked ? 'border-ac bg-ac text-acx' : 'border-mu/60 bg-bg text-transparent')}><Check size={12} strokeWidth={3} /></span>{label}
  </button>
}

let helpTipId = 0
export function HelpTip({ text, label = 'Help' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const idRef = useRef(`helptip-${++helpTipId}`)
  useEffect(() => {
    if (!open) return
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [open ])
  return (
    <span className="group/help relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={idRef.current}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="rounded-full text-mu hover:text-tx focus-visible:text-tx"
      >
        <CircleHelp size={14} />
      </button>
      <span
        role="tooltip"
        id={idRef.current}
        className={cx(
          'pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg bg-hov p-2.5 text-xs font-normal leading-relaxed text-tx transition-opacity',
          open ? 'visible opacity-100' : 'invisible opacity-0 group-hover/help:visible group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:opacity-100',
        )}
      >
        {text}
      </span>
    </span>
  )
}

export function Seg<T extends string>({ v, set, opts }: { v: T; set: (v: T) => void; opts: [T, string, Ic?][] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-bg p-1">
      {opts.map(([k, l, I]) => (
        <button key={k} onClick={() => set(k)} className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors', v === k ? 'bg-hov text-tx' : 'text-mu hover:text-tx')}>
          {I && <I size={14} />}{l}
        </button>
      ))}
    </div>
  )
}

const IN = 'w-full rounded-lg bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40'
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="space-y-1.5"><span className="flex items-center gap-1.5 text-sm font-medium">{label}{hint && <HelpTip text={hint} label={`Help: ${label}`} />}</span>{children}</div>
)
export const Input = ({ value, set, ...p }: { value: string; set: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) => (
  <input {...p} value={value} onChange={(e) => set(e.target.value)} className={IN} />
)
export const Area = ({ value, set, rows = 4 }: { value: string; set: (v: string) => void; rows?: number }) => (
  <textarea rows={rows} value={value} onChange={(e) => set(e.target.value)} className={cx(IN, 'resize-y')} />
)
export const Sel = ({ value, set, opts }: { value: string; set: (v: string) => void; opts: [string, string][] }) => (
  <SearchSelect value={value} set={set} opts={opts} />
)

export function SearchSelect({ value, set, opts, ariaLabel = 'Choose an option' }: { value: string; set: (v: string) => void; opts: [string, string][]; ariaLabel?: string }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const filtered = opts.filter(([, label]) => label.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => { if (!open) return; const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(false); setQuery('') } }; addEventListener('pointerdown', close); return () => removeEventListener('pointerdown', close) }, [open])
  useEffect(() => { if (open) search.current?.focus() }, [open])
  const choose = (item: [string, string]) => { set(item[0]); setOpen(false); setQuery('') }
  return <div ref={root} className="relative">
    <button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }} className={cx(IN, 'flex items-center justify-between text-left')}><span className="truncate">{opts.find(([k]) => k === value)?.[1] ?? value}</span><ChevronRight size={14} aria-hidden="true" className={cx('ml-2 shrink-0 text-mu transition-transform', open && 'rotate-90')} /></button>
    {open && <div className="absolute z-40 mt-1 w-full"><Menu className="settings-dropdown max-h-56 overflow-y-auto">
      <input ref={search} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0) }} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((n) => Math.min(n + 1, filtered.length - 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((n) => Math.max(n - 1, 0)) } else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); choose(filtered[active]) } else if (e.key === 'Escape') { setOpen(false); setQuery('') } }} placeholder="Type to search" aria-label="Search options" className="mb-1 w-full rounded-lg bg-surf px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
      <div role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto">{filtered.map((item, i) => <button type="button" role="option" aria-selected={item[0] === value} key={item[0]} onMouseEnter={() => setActive(i)} onClick={() => choose(item)} className={cx('block w-full rounded-lg px-2.5 py-2 text-left text-sm', active === i ? 'bg-hov text-tx' : 'text-mu')}>{item[1]}</button>)}{!filtered.length && <div className="px-2.5 py-2 text-sm text-mu">No matches</div>}</div>
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

export function Pop({ trigger, children, up, right, w = 'w-72', scroll = true }: { trigger: (o: boolean) => ReactNode; children: (close: () => void) => ReactNode; up?: boolean; right?: boolean; w?: string; scroll?: boolean }) {
  const [o, setO] = useState(false)
  const r = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!o) return
    const f = (e: MouseEvent) => { if (!r.current?.contains(e.target as Node)) setO(false) }
    addEventListener('mousedown', f)
    return () => removeEventListener('mousedown', f)
  }, [o])
  return (
    <div ref={r} className="relative">
      <div onClick={() => setO((v) => !v)}>{trigger(o)}</div>
      {o && <div className={cx('absolute z-30', scroll && 'max-h-96 overflow-y-auto', !scroll && 'overflow-hidden', w, up ? 'bottom-full mb-2' : 'top-full mt-2', right ? 'right-0' : 'left-0')}><Menu>{children(() => setO(false))}</Menu></div>}
    </div>
  )
}

export const Item = ({ icon: I, children, sub, on, off, ...p }: { icon?: Ic; sub?: string; on?: boolean; off?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surf', off && 'opacity-50')}>
    {I && <I size={16} className="shrink-0 text-mu" />}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {sub && <span className="max-w-32 truncate text-xs text-mu">{sub}</span>}
    {on && <Check size={16} className="shrink-0 text-ac" />}
  </button>
)

export function Modal({ children, close, blur = true, opacity = 55, keyboard = true }: { children: ReactNode; close: () => void; blur?: boolean; opacity?: number; keyboard?: boolean }) {
  useEffect(() => {
    if (!keyboard) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [close, keyboard])
  return <div style={{ backgroundColor: `rgb(0 0 0 / ${Math.max(0, Math.min(100, opacity))}%)`, backdropFilter: blur ? 'blur(var(--modal-blur, 12px))' : undefined }} className="fixed inset-0 z-50 grid place-items-center p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>{children}</div>
}

export function Confirm({ title, text, ok, close, run }: { title: string; text: string; ok: string; close: () => void; run: () => void }) {
  return (
    <Modal close={close}>
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-bg p-5">
        <div className="flex items-center gap-2 font-semibold"><TriangleAlert size={18} className="text-er" />{title}</div>
        <p className="text-sm text-mu">{text}</p>
        <div className="flex justify-end gap-2">
          <Btn v="soft" onClick={close}>Cancel</Btn>
          <Btn v="danger" onClick={() => { run(); close() }}>{ok}</Btn>
        </div>
      </div>
    </Modal>
  )
}
