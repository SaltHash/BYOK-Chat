import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { colorSuggestions, hexToHsl, hslToHex, normalizeHex, type ColorRole } from '../theme'
import { cx, useEscapeClose } from './ui'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const FALLBACK_PRESETS = ['#d97757', '#dc8ad8', '#3b5bdb', '#0d9488', '#16a34a', '#eab308', '#ef4444', '#f8fafc', '#111827']

/** An in-app HSL colour picker. Native `<input type="color">` looks different
 *  on every platform and cannot show a labelled swatch, so the theme editor
 *  uses this control instead. */
export function ColorPicker({ value, onChange, label, role = 'accent', theme }: { value: string; onChange: (hex: string) => void; label: string; role?: ColorRole; theme?: { accent: string; text: string; background: string } }) {
  const safe = normalizeHex(value, '#888888')
  const suggestions = useMemo(
    () => theme ? colorSuggestions({ role, ...theme }) : FALLBACK_PRESETS,
    [role, theme?.accent, theme?.text, theme?.background],
  )
  const [open, setOpen] = useState(false)
  const [hue, setHue] = useState(() => hexToHsl(safe).h)
  const [text, setText] = useState(safe)
  const [pos, setPos] = useState({ left: 8, top: 8 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  useEscapeClose(() => setOpen(false), open)

  useEffect(() => {
    setText(safe)
    const next = hexToHsl(safe)
    if (next.s > 0.02) setHue(next.h)
  }, [safe])

  useEffect(() => {
    if (!open) return
    const dismiss = (e: PointerEvent) => {
      if (panel.current?.contains(e.target as Node) || trigger.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    addEventListener('pointerdown', dismiss)
    return () => removeEventListener('pointerdown', dismiss)
  }, [open])

  const place = () => {
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const width = 264
    const height = 326
    const left = clamp(r.left, 8, Math.max(8, innerWidth - width - 8))
    const top = r.bottom + height > innerHeight - 8 ? Math.max(8, r.top - height - 8) : r.bottom + 8
    setPos({ left, top })
  }

  const apply = (hex: string) => {
    setText(hex)
    onChange(hex)
  }
  const fromArea = (e: { clientX: number; clientY: number }) => {
    const r = area.current?.getBoundingClientRect()
    if (!r) return
    const s = clamp((e.clientX - r.left) / r.width, 0, 1)
    const l = clamp(1 - (e.clientY - r.top) / r.height, 0, 1)
    apply(hslToHex({ h: hue, s, l }))
  }
  const fromHue = (e: { clientX: number }) => {
    const r = panel.current?.querySelector<HTMLElement>('[data-hue]')?.getBoundingClientRect()
    if (!r) return
    const h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360
    setHue(h)
    const current = hexToHsl(safe)
    apply(hslToHex({ h, s: current.s || 0.7, l: current.l }))
  }
  const current = hexToHsl(safe)

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}: ${safe}. Open color picker`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { place(); setOpen((v) => !v) }}
        className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-bor bg-bg p-1.5 text-left transition-colors hover:border-mu/60"
      >
        <span aria-hidden="true" className="size-6 shrink-0 rounded-md border border-white/25 shadow-sm" style={{ backgroundColor: safe }} />
        <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-tight text-tx">{safe}</span>
      </button>
      {open && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={`${label} picker`}
          style={{ left: pos.left, top: pos.top }}
          className="menu-surface fixed z-[80] w-[264px] space-y-3 rounded-xl bg-bg p-3 text-tx shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{label}</span>
            <span className="font-mono text-[11px] uppercase text-mu">{safe}</span>
          </div>

          <div
            ref={area}
            role="slider"
            tabIndex={0}
            aria-label={`${label} saturation and lightness`}
            aria-valuetext={`${Math.round(current.s * 100)}% saturation, ${Math.round(current.l * 100)}% lightness`}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromArea(e) }}
            onPointerMove={(e) => { if (e.buttons) fromArea(e) }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02
              const next = { ...current }
              if (e.key === 'ArrowLeft') next.s = clamp(current.s - step, 0, 1)
              else if (e.key === 'ArrowRight') next.s = clamp(current.s + step, 0, 1)
              else if (e.key === 'ArrowUp') next.l = clamp(current.l + step, 0, 1)
              else if (e.key === 'ArrowDown') next.l = clamp(current.l - step, 0, 1)
              else return
              e.preventDefault()
              apply(hslToHex(next))
            }}
            className="relative h-36 cursor-crosshair touch-none rounded-lg border border-white/20 outline-none focus-visible:ring-2 focus-visible:ring-ac/60"
            style={{
              background: `linear-gradient(to bottom, #fff 0%, rgb(255 255 255 / 0) 50%, #000 100%), linear-gradient(to right, hsl(${hue} 0% 50%), hsl(${hue} 100% 50%))`,
            }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0_/_55%)]"
              style={{ left: `${current.s * 100}%`, top: `${(1 - current.l) * 100}%`, backgroundColor: safe }}
            />
          </div>

          <div
            data-hue
            role="slider"
            tabIndex={0}
            aria-label={`${label} hue`}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hue)}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromHue(e) }}
            onPointerMove={(e) => { if (e.buttons) fromHue(e) }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 20 : 3
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const h = (hue + (e.key === 'ArrowRight' ? step : -step) + 360) % 360
              setHue(h)
              apply(hslToHex({ h, s: current.s || 0.7, l: current.l }))
            }}
            className="relative h-3 cursor-ew-resize touch-none rounded-full border border-white/25 outline-none focus-visible:ring-2 focus-visible:ring-ac/60"
            style={{ background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)' }}
          >
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgb(0_0_0_/_55%)]" style={{ left: `${hue / 3.6}%` }} />
          </div>

          <div className="flex flex-wrap gap-1.5" aria-label={`Suggested ${role} colors`}>
            {suggestions.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                title={color}
                onClick={() => { const next = hexToHsl(color); setHue(next.h); apply(color) }}
                className={cx('size-6 rounded-md border transition-transform hover:scale-110', color.toLowerCase() === safe ? 'border-ac ring-1 ring-ac' : 'border-white/25')}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-mu">
            <span className="shrink-0">Hex</span>
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                const next = e.target.value.trim()
                if (/^#[0-9a-f]{6}$/i.test(next)) {
                  const hsl = hexToHsl(next)
                  if (hsl.s > 0.02) setHue(hsl.h)
                  onChange(next.toLowerCase())
                }
              }}
              onBlur={() => setText(safe)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
              aria-label={`${label} hex value`}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-bor bg-surf px-2 py-1.5 font-mono text-xs uppercase outline-none focus:ring-2 focus:ring-ac/40"
            />
          </label>
        </div>,
        document.body,
      )}
    </div>
  )
}
