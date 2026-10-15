import { useRef, useState } from 'react'
import { Plus, FileUp, FileText, Image as ImageIcon, ArrowUp, Square, ChevronRight, ListMusic, Cpu, ScrollText, Settings, Search, X, TriangleAlert, Wrench } from 'lucide-react'
import { useS, usable, modelsOf, modelNameOf, featOn, type Att } from '../store'
import { CI, TOOLS } from '../meta'
import { composerWidth } from '../layout'
import { can, fmt, readAtt } from '../engine'
import { Btn, Item, Pop, Seg, RangeSlider, Toggle, cx, type Ic } from './ui'
import { Notice } from './Extra'

const chip = 'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-mu hover:bg-hov hover:text-tx'

function ModelMenu({ close, cfg }: { close: () => void; cfg: (t: string) => void }) {
  const s = useS()
  const plsOn = featOn(s, 'playlists')
  const [t, setT] = useState<'pl' | 'ep'>(plsOn ? s.sel?.k ?? 'ep' : 'ep')
  const [q, setQ] = useState('')
  const L: any[] = (t === 'pl' && plsOn ? s.pls : s.eps).filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || (t === 'ep' && modelsOf(x).some((model) => model.toLowerCase().includes(q.toLowerCase()))))
  const activeEp = t === 'ep' && s.sel?.k === 'ep' && s.sel.model ? s.eps.find((x) => x.id === s.sel?.id) : undefined
  const activeModel = activeEp && s.sel?.model
  const efforts: string[] = activeModel ? activeEp?.modelEfforts?.[activeModel] ?? [] : []
  const effortRank: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 }
  const effortChoices = [...efforts].sort((a, b) => (effortRank[a.toLowerCase()] ?? 50) - (effortRank[b.toLowerCase()] ?? 50))
  const storedEffort = activeModel ? s.effort[activeModel] : undefined
  const effortValue = storedEffort && effortChoices.includes(storedEffort) ? storedEffort : effortChoices[0]
  const effortIndex = Math.max(0, effortChoices.indexOf(effortValue))
  const activeEffort = effortChoices[effortIndex]
  return (
    <div className="flex flex-col" style={{ maxHeight: `min(${s.prefs.modelPickerHeight ?? 480}px, 85dvh)` }}>
      {plsOn && <Seg v={t} set={setT} opts={[['pl', 'Playlists', ListMusic], ['ep', 'Models', Cpu]]} />}
      <div className="relative my-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-full rounded-lg bg-surf pl-9 pr-3 text-sm outline-none" />
      </div>
      {activeModel && efforts.length > 0 && <div className="shrink-0 border-b border-hov px-2.5 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between text-xs"><span className="truncate pr-2 font-medium text-tx">Effort · {modelNameOf(activeEp!, activeModel).replace(/^~+/, '')}</span><span className="text-ac capitalize">{activeEffort}</span></div>
        <RangeSlider label={`${modelNameOf(activeEp!, activeModel).replace(/^~+/, '')} reasoning effort`} min={0} max={effortChoices.length - 1} step={1} value={effortIndex} valueText={effortChoices[effortIndex]} set={(n) => s.patch({ effort: { ...s.effort, [activeModel]: effortChoices[n] } })} className="mt-1 w-full" />
        <div className="mt-1 flex justify-between text-xs capitalize text-mu"><span>{effortChoices[0]}</span><span>{effortChoices.at(-1)}</span></div>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {t === 'ep' && <Item icon={Cpu} on={!s.sel} sub="list order" onClick={() => { s.patch({ sel: null }); close() }}>All endpoints</Item>}
      {L.map((x) => (
        <div key={x.id}>
          {t === 'pl' || (plsOn && x.modelsMode === 'playlist')
            ? <Item icon={t === 'pl' ? ListMusic : Cpu} off={x.on === false} on={s.sel?.id === x.id && !s.sel.model} sub={t === 'pl' ? `${x.e.length} models` : `${modelsOf(x).length} model playlist`} onClick={() => { s.patch({ sel: { k: t, id: x.id } }); close() }}>{x.name}</Item>
            : <>
              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-mu">{x.name}</div>
              {modelsOf(x).map((model) => {
                const primary = s.prefs.modelPrimary ?? 'name'
                const secondary = s.prefs.modelSecondary ?? 'none'
                const alias = modelNameOf(x, model)
                const title = (primary === 'name' ? alias : model).replace(/^~+/, '')
                const sub = secondary === 'provider' ? x.name : secondary === 'none' || secondary === primary ? '' : (secondary === 'name' ? alias : model).replace(/^~+/, '')
                return <Item key={model} icon={Cpu} off={x.on === false} on={s.sel?.id === x.id && s.sel.model === model} sub={sub} onClick={() => { s.patch({ sel: { k: 'ep', id: x.id, model } }); close() }}>{title}</Item>
              })}
            </>}
        </div>
      ))}
      {!L.length && <p className="px-2.5 py-3 text-sm text-mu">Nothing here yet.</p>}
      </div>
      <div className="shrink-0 border-t border-hov px-1 pt-2">
        <Item icon={Settings} className="bg-surf/70 hover:bg-surf" onClick={() => { close(); cfg(t === 'pl' && plsOn ? 'pls' : 'eps') }}>Manage…</Item>
      </div>
    </div>
  )
}

export function Composer({ cfg }: { cfg: (t: string) => void }) {
  const s = useS()
  const [att, setAtt] = useState<Att[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const fi = useRef<HTMLInputElement>(null)
  const v = s.draft
  const [hi, setHi] = useState(0)
  const tw = v.match(/(?:^|\s)(@\w*)$/)?.[1]
  const menu: { k: string; icon: Ic; label: string; hint: string; pick: () => void }[] | null = /^\/\S*$/.test(v) && featOn(s, 'commands')
    ? s.cmds.filter((c) => c.on && c.name.startsWith(v.slice(1))).map((c) => ({ k: c.id, icon: CI[c.in], label: '/' + c.name, hint: c.desc || c.in, pick: () => s.patch({ draft: '/' + c.name + ' ' }) }))
    : tw && featOn(s, 'tools')
      ? TOOLS.filter((t) => t[3].startsWith(tw.toLowerCase())).map((t) => ({ k: t[0], icon: t[2], label: t[3].split('(')[0], hint: s.tools[t[0]] ? t[4] : 'Off. Enable in Settings → Tools', pick: () => s.patch({ draft: v.slice(0, v.length - tw.length) + '@' + t[0] + (/^(calc|count|json|base64|search|random|hash)$/.test(t[0]) ? '(' : ' ') }) }))
      : null
  const hl = Math.min(hi, Math.max((menu?.length ?? 1) - 1, 0))
  const sel = s.sel ? (s.sel.k === 'pl' ? s.pls : s.eps).find((x) => x.id === s.sel!.id) : undefined
  const ep = s.sel?.k === 'ep' ? s.eps.find((e) => e.id === s.sel!.id) : undefined
  const pr = s.prompts.find((p) => p.id === s.pr)
  const bad = (a: Att) => !!ep && a.kind !== 'txt' && !can(ep, a.kind)
  const pick = (accept: string) => { if (fi.current) { fi.current.accept = accept; fi.current.click() } }
  const add = async (l: FileList | null) => {
    if (!l) return
    const out: Att[] = []
    let txtChars = att.reduce((a, x) => a + (x.text?.length ?? 0), 0)
    for (const f of [...l]) {
      const r = await readAtt(f, txtChars)
      if (!r.ok) s.patch({ notice: { t: r.message } })
      else { out.push(r.att); txtChars += r.att.text?.length ?? 0 }
    }
    setAtt((a) => [...a, ...out])
  }
  const ready = !!v.trim() || att.length > 0
  const submit = async () => {
    if (s.busy) return
    if (!s.eps.length) {
      s.add('eps')
      s.patch({ notice: { t: 'I opened a new endpoint for you. Choose a provider preset, add a model and key, then test the connection before sending again.', tab: 'eps', label: 'Add endpoint' } })
      cfg('eps')
      return
    }
    if (!ready) return
    const raw = v, files = att
    if (await s.send(raw, files)) {
      if (useS.getState().draft === raw) s.patch({ draft: '' })
      setAtt([])
      if (ta.current) ta.current.style.height = 'auto'
    }
  }
  return (
    <div className="mx-auto w-full self-center px-4 pb-4" style={{ maxWidth: composerWidth(s.prefs.chatWidth) }}>
      <Notice cfg={cfg} />
      <div className="relative rounded-2xl bg-surf p-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}>
        {menu && (
          <div className="absolute inset-x-0 bottom-full mb-2 rounded-xl bg-hov p-1.5">
            {menu.length ? menu.map((o, i) => (
              <Item key={o.k} icon={o.icon} on={i === hl} sub={o.hint} onClick={() => { o.pick(); ta.current?.focus() }}>{o.label}</Item>
            )) : <p className="px-2.5 py-3 text-sm text-mu">{v.startsWith('/') ? 'No enabled command matches. Manage commands in Settings.' : 'No tool matches.'}</p>}
          </div>
        )}
        {att.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {att.map((a, i) => a.kind === 'img' && a.data ? (
              <div key={i} className={cx('group/preview relative flex h-24 w-28 flex-col overflow-hidden rounded-lg bg-hov p-1.5 ring-1 ring-hov', bad(a) && 'ring-er')} title={a.name}>
                <img src={`data:${a.mime || 'image/*'};base64,${a.data}`} alt={a.name} className="min-h-0 flex-1 rounded object-contain p-1" />
                <span className="truncate px-1 text-xs text-mu" title={a.name}>{a.name}</span>
                <button aria-label={`Remove ${a.name}`} onClick={() => setAtt(att.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/preview:opacity-100 focus:opacity-100"><X size={12} /></button>
                {bad(a) && <span className="absolute left-1 right-1 top-7 rounded bg-er/90 px-1 py-0.5 text-center text-xs text-white"><TriangleAlert size={11} className="inline" /> Unsupported</span>}
              </div>
            ) : (
              <span key={i} title={bad(a) ? 'The selected model cannot process this file' : undefined} className={cx('inline-flex items-center gap-1.5 rounded-lg bg-hov py-1 pl-2 pr-1 text-xs', bad(a) && 'text-er')}>
                {bad(a) ? <TriangleAlert size={13} /> : <FileText size={13} />}{a.name}<span className="text-mu">{a.size}</span>
                <button onClick={() => setAtt(att.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded hover:bg-surf"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <textarea
          id="composer" ref={ta} rows={1} value={v} placeholder={s.eps.some(usable) ? (featOn(s, 'commands') && featOn(s, 'tools') ? 'Message, / for commands, @ for tools' : featOn(s, 'commands') ? 'Message, / for commands' : featOn(s, 'tools') ? 'Message, @ for tools' : 'Message') : 'Add a model endpoint to start (press Send for a walkthrough)'}
          onChange={(e) => { s.patch({ draft: e.target.value }); setHi(0) }}
          onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 208) + 'px' }}
          onKeyDown={(e) => {
            if (menu?.length && !e.shiftKey && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
              e.preventDefault()
              if (e.key === 'ArrowDown') setHi((hl + 1) % menu.length)
              else if (e.key === 'ArrowUp') setHi((hl - 1 + menu.length) % menu.length)
              else menu[hl].pick()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && s.prefs.enterSends) { e.preventDefault(); submit() }
          }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); add(e.clipboardData.files) } }}
          className="max-h-52 w-full resize-none bg-transparent px-1 py-1 outline-none"
        />
        <input ref={fi} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <div className="mt-2 flex items-center gap-1">
          <Pop up w="w-64" trigger={() => <Btn icon={Plus} title="Attach files or manage tools" className="rounded-full" />}>
            {(close) => (
              <>
                <Item icon={FileUp} onClick={() => { pick(''); close() }}>Upload a file</Item>
                <Item icon={Wrench} onClick={() => { close(); cfg('tools') }}>Manage tools…</Item>
              </>
            )}
          </Pop>
          <Pop up w="w-80" scroll={false} trigger={(o) => (
            <button className={chip}>
              {s.sel?.k === 'pl' && featOn(s, 'playlists') ? <ListMusic size={16} /> : <Cpu size={16} />}
              <span className="max-w-40 truncate">{sel ? (s.sel?.model && s.sel.k === 'ep' ? modelNameOf(sel as any, s.sel.model) : sel.name) : 'All endpoints'}</span><ChevronRight size={14} className={cx('transition-transform', o && 'rotate-90')} />
            </button>
          )}>{(close) => <ModelMenu close={close} cfg={cfg} />}</Pop>
          {featOn(s, 'prompts') && <Pop up trigger={(o) => (
            <button className={chip}><ScrollText size={16} /><span className="max-w-32 truncate">{pr ? pr.name : 'No prompt'}</span>{s.globalPrompt?.on && <span className="size-1.5 shrink-0 rounded-full bg-ac" title="Global system prompt on" />}<ChevronRight size={14} className={cx('transition-transform', o && 'rotate-90')} /></button>
          )}>
            {(close) => {
              const g = s.globalPrompt ?? { on: false, text: '' }
              return (
                <>
                  <Item icon={X} on={!s.pr} onClick={() => { s.patch({ pr: '' }); close() }}>No override</Item>
                  {s.prompts.map((p) => <Item key={p.id} icon={ScrollText} on={s.pr === p.id} onClick={() => { s.patch({ pr: p.id }); close() }}>{p.name}</Item>)}
                  <div className="mx-1 mb-1 mt-2 rounded-xl border border-ac/30 bg-ac/5 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium">Global system prompt</span>
                      <Toggle on={g.on} set={(on) => s.patch({ globalPrompt: { ...g, on } })} label="Toggle global system prompt" />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-mu">{g.on ? (g.text.trim() ? 'On — applies to every message in every chat.' : 'On, but no text set yet — add one in Manage.') : 'Off — applies to every message in every chat when on.'}</p>
                    <Item icon={Settings} onClick={() => { close(); cfg('prompts') }}>Manage global…</Item>
                  </div>
                  <Item icon={Settings} onClick={() => { close(); cfg('prompts') }}>Manage…</Item>
                </>
              )
            }}
          </Pop>}
          <span className="flex-1" />
          <button onClick={s.busy ? s.stop : submit} title={s.busy ? 'Stop' : 'Send'} className={cx('grid size-9 place-items-center rounded-full transition-colors', s.busy || ready ? 'bg-ac text-acx' : 'bg-hov text-mu')}>
            {s.busy ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </div>
      <p className="pt-2 text-center text-xs text-mu">{`Enter to send · Shift+Enter for a new line · ${fmt(s.keys.palette ?? 'Mod+K')} for the palette`}</p>
    </div>
  )
}
