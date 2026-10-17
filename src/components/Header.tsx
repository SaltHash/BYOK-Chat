import { PanelLeft, PanelRight, Download, Eraser, Command, SlidersHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useS, exportChat, featOn } from '../store'
import { Btn, Pop, Toggle, RangeSlider } from './ui'
import { ContextMeter } from './ContextMeter'

const Slider = ({ l, v, min, max, step, set, off }: { l: string; v: number; min: number; max: number; step: number; set: (n: number) => void; off: boolean }) => (
  <div className={off ? 'opacity-40' : ''}>
    <div className="mb-1 flex justify-between text-sm"><span>{l}</span><span className="text-mu">{v}</span></div>
    <RangeSlider label={l} disabled={off} min={min} max={max} step={step} value={v} set={set} className="w-full" />
  </div>
)

export function Header({ side, toggle, cfg, pal, title }: { side: boolean; toggle: () => void; cfg: (t: string) => void; pal: () => void; title: string }) {
  const { params: p, patch, widgets, rail, features } = useS(useShallow((s) => ({ params: s.params, patch: s.patch, widgets: s.widgets, rail: s.rail, features: s.features })))
  const u = (x: Partial<typeof p>) => patch({ params: { ...p, ...x } })
  const anyW = featOn({ features }, 'widgets') && Object.values(widgets).some(Boolean)
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-3">
      {!side && <Btn icon={PanelLeft} title="Show sidebar" onClick={toggle} />}
      <h1 className="min-w-0 flex-1 truncate px-2 font-medium">{title}</h1>
      <ContextMeter />
      <Btn icon={Command} title="Command palette" onClick={pal} />
      <Pop right w="w-72" trigger={() => <Btn icon={SlidersHorizontal} title="Generation parameters" />}>
        {() => (
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between text-sm"><span>Use model defaults</span><Toggle on={p.def} set={(v) => u({ def: v })} /></div>
            <Slider l="Temperature" v={p.temp} min={0} max={2} step={0.1} set={(n) => u({ temp: n })} off={p.def} />
            <Slider l="Top p" v={p.topp} min={0} max={1} step={0.05} set={(n) => u({ topp: n })} off={p.def} />
            <Slider l="Max tokens" v={p.max} min={256} max={32768} step={256} set={(n) => u({ max: n })} off={p.def} />
          </div>
        )}
      </Pop>
      <Btn icon={Download} title="Export chat" onClick={exportChat} />
      <Btn icon={Eraser} title="Clear chat" onClick={() => { const st = useS.getState(); patch({ chats: st.chats.map((c) => (c.id === st.chat ? { ...c, msgs: [] } : c)) }) }} />
      {featOn({ features }, 'widgets') && <Btn icon={PanelRight} title="Widgets" onClick={() => (anyW ? patch({ rail: !rail }) : cfg('widgets'))} />}
    </header>
  )
}
