import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { useS, THEMES, THEME_COLORS, DARK_THEMES, LIGHT_THEMES, themeKeyOf, featOn } from '../store'
import { TOOLS, WIDGETS } from '../meta'
import { Btn, Modal, Seg, Toggle, cx } from './ui'

const RECOMMENDED = ['search', 'fetch_page', 'calc', 'workspace_upsert', 'memory']

export function Welcome({ addEndpoint, close }: { addEndpoint: () => void; close: () => void }) {
  const s = useS(useShallow((st) => ({
    tools: st.tools, prefs: st.prefs, features: st.features,
    themeMode: st.themeMode, themeLight: st.themeLight, themeDark: st.themeDark, patch: st.patch,
  })))
  const [step, setStep] = useState(0)
  const [toolSel, setToolSel] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const k of Object.keys(s.tools)) init[k] = RECOMMENDED.includes(k)
    return init
  })
  const [responseInfo, setResponseInfo] = useState(true)
  const apply = () => {
    const toolsPatch = featOn(s, 'tools') ? { tools: Object.fromEntries(Object.keys(s.tools).map(k => [k, !!toolSel[k]])) } : {}
    // Widgets stay off by default; enable them later in Settings → Widgets.
    const widgetsPatch = featOn(s, 'widgets') ? { widgets: Object.fromEntries(WIDGETS.map(([k]) => [k, false])), rail: false } : { rail: false }
    s.patch({ ...toolsPatch, ...widgetsPatch, setupDone: true, prefs: { ...s.prefs, showBy: responseInfo, showLog: responseInfo, showTps: responseInfo } })
  }
  const finish = (add: boolean) => { apply(); if (add) addEndpoint(); else close() }
  const titles = ['Make it yours', 'Choose your tools']
  const subtitles = [
    'Start with a look that feels right. You can change everything later in Settings → Appearance.',
    'Pick the tools the model can use. Widgets stay off; you can enable them later in Settings → Widgets.',
  ]
  const enabledCount = Object.values(toolSel).filter(Boolean).length
  const byId = new Map(TOOLS.map(t => [t[0], t] as const))
  const recommendedTools = RECOMMENDED.filter(id => byId.has(id)).map(id => byId.get(id)!)
  const moreTools = TOOLS.filter(([id]) => !RECOMMENDED.includes(id))
  const row = ([id, name, , , desc]: (typeof TOOLS)[number]) => (
    <label key={id} className="flex items-center justify-between gap-4 rounded-xl border border-bor bg-surf px-4 py-3">
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{name}</span><span className="mt-0.5 block text-xs text-mu">{desc}</span></span>
      <Toggle on={!!toolSel[id]} set={(v) => setToolSel(prev => ({ ...prev, [id]: v }))} label={name} />
    </label>
  )
  return <Modal close={() => {}} keyboard={false}>
    <section role="dialog" aria-modal="true" aria-labelledby={step === 2 ? 'welcome-final-title' : 'welcome-title'} className="w-full max-w-2xl self-center overflow-hidden rounded-3xl border border-bor bg-bg shadow-2xl">
      <header className="flex items-center justify-between border-b border-bor px-4 py-4 sm:px-6"><div className="flex items-center gap-2 text-sm text-mu"><Sparkles size={16} className="text-ac"/> A more personal chat space</div><span className="text-xs text-mu">{step + 1} / 3</span></header>
      <div className="max-h-[70dvh] overflow-y-auto px-4 py-6 sm:px-9 sm:py-7">
        {step !== 2 && <><h1 id="welcome-title" className="text-2xl font-semibold tracking-tight">{titles[step]}</h1><p className="mt-2 text-sm text-mu">{subtitles[step]}</p></>}
        {step === 0 && <div className="mt-6 space-y-6"><div><div className="mb-3 text-sm font-medium">Theme</div><div className="mb-3"><Seg v={s.themeMode} set={(themeMode) => s.patch({ themeMode })} opts={[['dark', 'Dark'], ['light', 'Light']]} /></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[...(s.themeMode === 'light' ? LIGHT_THEMES : DARK_THEMES)].map((key) => { const label = THEMES[key]; const active = (s.themeMode === 'light' ? s.themeLight : s.themeDark) === key; const { bg, side, surf, ac } = THEME_COLORS[key]; return <button key={key} onClick={() => s.patch(s.themeMode === 'light' ? { themeLight: key as typeof s.themeLight } : { themeDark: key as typeof s.themeDark })} className={cx('rounded-2xl border p-3 text-left transition hover:-translate-y-0.5', active ? 'border-ac ring-2 ring-ac/30' : 'border-bor')}><span className="mb-3 flex h-16 items-end gap-1 rounded-xl p-2" style={{ background: bg }}><i className="h-7 w-1/3 rounded-sm" style={{ background: side }} /><i className="h-10 flex-1 rounded-sm" style={{ background: surf }} /><i className="h-3 w-1/4 rounded-sm" style={{ background: ac }} /></span><span className="flex items-center justify-between text-sm font-medium">{label}{active && <Check size={15} className="text-ac" />}</span></button> })}</div></div><div className="rounded-2xl bg-surf p-4"><div className="mb-3 text-sm font-medium">A few appearance details</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Chat width<div className="mt-2"><Seg v={s.prefs.chatWidth} set={v=>s.patch({prefs:{...s.prefs,chatWidth:v as any}})} opts={[["narrow","Narrow"],["standard","Standard"],["wide","Wide"]]}/></div></label><div className="space-y-3"><label className="flex items-center justify-between gap-4 text-sm">Show response information<Toggle on={responseInfo} set={setResponseInfo}/></label><p className="text-xs text-mu">Show which model answered, model-use details, and generation speed.</p><label className="flex items-center justify-between gap-4 text-sm">Name chats automatically<Toggle on={s.prefs.autoTitle} set={(autoTitle)=>s.patch({prefs:{...s.prefs,autoTitle}})}/></label><p className="text-xs text-mu">Generate a short title after the first reply.</p></div></div></div><div className="flex items-center justify-end gap-2"><button onClick={()=>finish(false)} className="mr-auto text-sm text-mu hover:text-tx">Skip setup</button><Btn v="solid" icon={ChevronRight} onClick={()=>setStep(1)}>Continue</Btn></div></div>}
        {step === 1 && <div className="mt-6 space-y-5"><div><div className="mb-2 text-sm font-medium">Recommended</div><div className="grid gap-2">{recommendedTools.map(row)}</div></div><div><div className="mb-2 text-sm font-medium">More tools</div><div className="grid gap-2">{moreTools.map(row)}</div></div><div className="flex items-center justify-end gap-2"><button onClick={()=>finish(false)} className="mr-auto text-sm text-mu hover:text-tx">Skip setup</button><Btn v="solid" icon={ChevronRight} onClick={()=>setStep(2)}>Continue</Btn></div></div>}
        {step === 2 && <div className="mx-auto mt-8 flex max-w-md flex-col items-center text-center"><span className="grid size-14 place-items-center rounded-2xl bg-ac/10 text-ac"><Check size={25}/></span><h2 id="welcome-final-title" className="mt-4 text-lg font-semibold">Look at you, all set.</h2><p className="mt-2 text-sm leading-6 text-mu">{THEMES[themeKeyOf(s)]} theme · {enabledCount} tool{enabledCount === 1 ? '' : 's'} · widgets off</p><div className="mt-7 flex w-full flex-col items-center gap-3"><Btn v="solid" className="h-12 w-full px-5" onClick={()=>finish(true)}>Add an endpoint</Btn><button onClick={()=>finish(false)} className="h-12 w-full rounded-lg px-5 text-sm font-medium text-mu transition-colors hover:bg-hov hover:text-tx">Just looking, thanks</button></div></div>}
      </div>
      <footer className="flex justify-start border-t border-bor bg-side/40 px-4 py-4 sm:px-6">{step>0&&<Btn v="soft" icon={ChevronLeft} onClick={()=>setStep(step-1)}>Back</Btn>}</footer>
    </section>
  </Modal>
}
