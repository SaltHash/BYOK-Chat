import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Check, TriangleAlert, type LucideIcon } from 'lucide-react'

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

export const Toggle = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => (
  <button role="switch" aria-checked={on} onClick={() => set(!on)} className={cx('h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors', on ? 'bg-ac' : 'bg-hov')}>
    <span className={cx('block size-4 rounded-full transition-transform', on ? 'translate-x-4 bg-acx' : 'bg-mu')} />
  </button>
)

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
  <div className="space-y-1.5"><span className="block text-sm font-medium">{label}</span>{children}{hint && <span className="block text-xs text-mu">{hint}</span>}</div>
)
export const Input = ({ value, set, ...p }: { value: string; set: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) => (
  <input {...p} value={value} onChange={(e) => set(e.target.value)} className={IN} />
)
export const Area = ({ value, set, rows = 4 }: { value: string; set: (v: string) => void; rows?: number }) => (
  <textarea rows={rows} value={value} onChange={(e) => set(e.target.value)} className={cx(IN, 'resize-y')} />
)
export const Sel = ({ value, set, opts }: { value: string; set: (v: string) => void; opts: [string, string][] }) => (
  <select value={value} onChange={(e) => set(e.target.value)} className={IN}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
)

export function Pop({ trigger, children, up, right, w = 'w-72' }: { trigger: (o: boolean) => ReactNode; children: (close: () => void) => ReactNode; up?: boolean; right?: boolean; w?: string }) {
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
      {o && <div className={cx('absolute z-30 max-h-96 overflow-y-auto rounded-xl bg-hov p-1.5', w, up ? 'bottom-full mb-2' : 'top-full mt-2', right ? 'right-0' : 'left-0')}>{children(() => setO(false))}</div>}
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

export function Modal({ children, close }: { children: ReactNode; close: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [close])
  return <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>{children}</div>
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
