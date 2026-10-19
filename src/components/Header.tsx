import { useState } from 'react'
import { PanelLeft, PanelRight, Download, Command, SlidersHorizontal, Share2, MoreVertical } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useS, exportChat, featOn, DEFAULT_ADVANCED } from '../store'
import { createShare } from '../share'
import { Btn, Pop, Toggle, RangeSlider, Item, cx } from './ui'
import { ContextMeter } from './ContextMeter'

const Slider = ({ l, v, min, max, step, set, off }: { l: string; v: number; min: number; max: number; step: number; set: (n: number) => void; off: boolean }) => (
  <div className={off ? 'opacity-40' : ''}>
    <div className="mb-1 flex justify-between text-sm"><span>{l}</span><span className="text-mu">{v}</span></div>
    <RangeSlider label={l} disabled={off} min={min} max={max} step={step} value={v} set={set} className="w-full" />
  </div>
)

type Params = { def: boolean; temp: number; topp: number; max: number }

/** Generation parameters shared by the desktop popover and the mobile overflow
 *  menu. Kept in one place so both stay in sync. */
function ParamsBody({ p, set }: { p: Params; set: (x: Partial<Params>) => void }) {
  return (
    <>
      <div className="flex items-center justify-between text-sm"><span>Use model defaults</span><Toggle on={p.def} set={(v) => set({ def: v })} /></div>
      <Slider l="Temperature" v={p.temp} min={0} max={2} step={0.1} set={(n) => set({ temp: n })} off={p.def} />
      <Slider l="Top p" v={p.topp} min={0} max={1} step={0.05} set={(n) => set({ topp: n })} off={p.def} />
      <Slider l="Max tokens" v={p.max} min={256} max={32768} step={256} set={(n) => set({ max: n })} off={p.def} />
    </>
  )
}

export function Header({ side, toggle, cfg, pal, title }: { side: boolean; toggle: () => void; cfg: (t: string) => void; pal: () => void; title: string }) {
  const { params: p, patch, widgets, rail, features, advanced } = useS(useShallow((s) => ({ params: s.params, patch: s.patch, widgets: s.widgets, rail: s.rail, features: s.features, advanced: s.advanced })))
  const [sharing, setSharing] = useState(false)
  const share = async () => {
    const st = useS.getState()
    const c = st.chats.find((x) => x.id === st.chat)
    if (!c || !c.msgs.length) { st.patch({ notice: { t: 'This chat is empty, so there is nothing to share yet. Send a message first, then press Share.' } }); return }
    if (sharing) return
    setSharing(true)
    try {
      const { url, messages } = await createShare(c)
      try { await navigator.clipboard?.writeText(url) } catch { /* clipboard may be blocked; the link is still shown */ }
      st.patch({ notice: { t: `Read-only link created for ${messages} message${messages === 1 ? '' : 's'} and copied to the clipboard. Anyone with the link can read this conversation.`, href: url, label: 'Open link' } })
    } catch (x: any) {
      st.patch({ notice: { t: `Could not create a share link: ${String(x?.message ?? x)}` } })
    } finally { setSharing(false) }
  }
  const u = (x: Partial<Params>) => patch({ params: { ...p, ...x } })
  const anyW = featOn({ features }, 'widgets') && Object.values(widgets).some(Boolean)
  // Model parameters are an advanced setting: hidden until the Advanced feature
  // is enabled and the dedicated toggle (Settings → Advanced) is on.
  const adv = { ...DEFAULT_ADVANCED, ...advanced }
  const paramsOn = featOn({ features }, 'advanced') && adv.showModelParams
  return (
    <header className="flex h-14 shrink-0 items-center gap-0.5 px-2 sm:gap-1 sm:px-3">
      {!side && <Btn icon={PanelLeft} title="Show sidebar" onClick={toggle} />}
      <h1 className="min-w-0 flex-1 truncate px-1 font-medium sm:px-2">{title}</h1>
      <ContextMeter />
      {/* Wide layout: each secondary action keeps its own icon button. */}
      <Btn icon={Command} title="Command palette" onClick={pal} className="hidden sm:inline-flex" />
      {paramsOn && (
        <span className="hidden sm:block">
          <Pop right w="w-72" trigger={() => <Btn icon={SlidersHorizontal} title="Model parameters" />}>
            {() => <div className="space-y-4 p-2"><ParamsBody p={p} set={u} /></div>}
          </Pop>
        </span>
      )}
      <Btn icon={Share2} title="Share a read-only link" onClick={() => void share()} className={cx('hidden sm:inline-flex', sharing && 'animate-pulse')} />
      <Btn icon={Download} title="Export chat" onClick={exportChat} className="hidden sm:inline-flex" />
      {featOn({ features }, 'widgets') && <Btn icon={PanelRight} title="Widgets" onClick={() => (anyW ? patch({ rail: !rail }) : cfg('widgets'))} className="hidden sm:inline-flex" />}
      {/* Narrow layout: one overflow menu holds the secondary actions. */}
      <span className="sm:hidden">
        <Pop right w="w-64" trigger={() => <Btn icon={MoreVertical} title="More actions" />}>
          {(close) => (
            <>
              <Item icon={Command} onClick={() => { close(); pal() }}>Command palette</Item>
              <Item icon={Share2} onClick={() => { close(); void share() }}>Share read-only link</Item>
              <Item icon={Download} onClick={() => { close(); exportChat() }}>Export chat</Item>
              {featOn({ features }, 'widgets') && <Item icon={PanelRight} on={anyW && rail} onClick={() => { close(); anyW ? patch({ rail: !rail }) : cfg('widgets') }}>Widgets panel</Item>}
              {paramsOn && (
                <div className="mt-1 space-y-4 border-t border-bor px-2 pb-1 pt-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-mu">Model parameters</div>
                  <ParamsBody p={p} set={u} />
                </div>
              )}
            </>
          )}
        </Pop>
      </span>
    </header>
  )
}
