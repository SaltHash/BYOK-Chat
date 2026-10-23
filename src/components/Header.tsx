import { useState } from 'react'
import { PanelLeft, PanelRight, Download, Command, SlidersHorizontal, Share2, MoreVertical, Bookmark, Hourglass, Settings2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useS, exportChat, featOn, DEFAULT_ADVANCED } from '../store'
import { Btn, Pop, Toggle, RangeSlider, Item, cx } from './ui'
import { ContextMeter } from './ContextMeter'
import { ShareDialog } from './ShareDialog'

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

/** Playful but unmistakable marker for a chat that will disappear. Clicking it
 *  scrolls settings to the top of the temporary-chats section. */
function TemporaryFlair({ cfg, expiresAt, tempHours }: { cfg: (t: string) => void; expiresAt?: number; tempHours: number }) {
  const left = expiresAt != null ? Math.max(0, expiresAt - Date.now()) : null
  const detail = tempHours === 0
    ? 'Poofs when you leave'
    : left != null
      ? left < 60_000 ? 'Poofs in under a minute' : `Poofs in ${Math.ceil(left / 3_600_000) || 1}h`
      : 'Kept briefly'
  return (
    <button
      type="button"
      onClick={() => cfg('chats#temporary-chats')}
      title={`Temporary chat · ${detail}. Open temporary chat settings`}
      aria-label={`Temporary chat, ${detail}. Open temporary chat settings`}
      className="temp-flair group inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium text-tx transition-colors"
    >
      <span aria-hidden="true" className="temp-flair-mark grid size-5 shrink-0 place-items-center rounded-full">
        <Hourglass size={12} className="temp-flair-icon text-ac" />
      </span>
      <span className="whitespace-nowrap">Temporary<span className="hidden sm:inline"> chat</span></span>
      <span className="hidden whitespace-nowrap text-mu lg:inline">· {detail}</span>
      <Settings2 size={12} className="shrink-0 text-mu transition-colors group-hover:text-tx" aria-hidden="true" />
    </button>
  )
}

export function Header({ side, toggle, cfg, pal, title }: { side: boolean; toggle: () => void; cfg: (t: string) => void; pal: () => void; title: string }) {
  const { params: p, patch, widgets, rail, features, advanced } = useS(useShallow((s) => ({ params: s.params, patch: s.patch, widgets: s.widgets, rail: s.rail, features: s.features, advanced: s.advanced })))
  // Narrow boolean slices: the header re-renders only when these flip, not on
  // every streamed chunk of the open chat.
  const hasChat = useS((s) => s.chats.some((c) => c.id === s.chat))
  const curTemporary = useS((s) => { const c = s.chats.find((x) => x.id === s.chat); return c?.temporary === true || (s.chat === '' && s.newChatPending === 'temporary') })
  const tempExpiresAt = useS((s) => { const c = s.chats.find((x) => x.id === s.chat); return c?.temporary ? c.expiresAt : undefined })
  const tempHours = useS((s) => s.prefs.tempHours)
  const [shareChat, setShareChat] = useState<string | null>(null)
  const openShare = () => {
    const st = useS.getState()
    if (!st.chats.some((c) => c.id === st.chat)) { st.patch({ notice: { t: 'Open or start a chat first, then share it.' } }); return }
    setShareChat(st.chat)
  }
  const keepPermanent = () => {
    const st = useS.getState()
    const c = st.chats.find((x) => x.id === st.chat)
    if (!c?.temporary) return
    st.promoteChat(c.id)
    st.patch({ notice: { t: 'Saved as a permanent chat.' } })
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
      {curTemporary && <TemporaryFlair cfg={cfg} expiresAt={tempExpiresAt} tempHours={tempHours} />}
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
      <Btn icon={Share2} title="Share a read-only link" onClick={openShare} disabled={!hasChat} className="hidden sm:inline-flex" />
      <Btn icon={Download} title="Export chat" onClick={exportChat} className="hidden sm:inline-flex" />
      <Btn icon={Bookmark} title={curTemporary ? 'Save as a permanent chat' : 'This chat is already permanent'} onClick={keepPermanent} disabled={!curTemporary} className="hidden sm:inline-flex" />
      {featOn({ features }, 'widgets') && <Btn icon={PanelRight} title="Widgets" onClick={() => (anyW ? patch({ rail: !rail }) : cfg('widgets'))} className="hidden sm:inline-flex" />}
      {/* Narrow layout: one overflow menu holds the secondary actions. */}
      <span className="sm:hidden">
        <Pop right w="w-64" trigger={() => <Btn icon={MoreVertical} title="More actions" />}>
          {(close) => (
            <>
              <Item icon={Command} onClick={() => { close(); pal() }}>Command palette</Item>
              <Item icon={Share2} off={!hasChat} onClick={() => { close(); openShare() }}>Share read-only link</Item>
              <Item icon={Download} onClick={() => { close(); exportChat() }}>Export chat</Item>
              <Item icon={Bookmark} off={!curTemporary} onClick={() => { close(); keepPermanent() }}>Save as permanent chat</Item>
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
      {shareChat && <ShareDialog chatId={shareChat} close={() => setShareChat(null)} />}
    </header>
  )
}
