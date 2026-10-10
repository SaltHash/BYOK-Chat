import { useRef, useState } from 'react'
import { Plus, FileUp, FileText, Image as ImageIcon, ArrowUp, Square, ChevronDown, ListMusic, Cpu, ScrollText, Settings, Search, X, TriangleAlert, Wrench } from 'lucide-react'
import { useS, usable, modelsOf, modelNameOf, type Att } from '../store'
import { CI, TOOLS } from '../meta'
import { can, fmt, readAtt, supportsEffort } from '../engine'
import { Btn, Item, Pop, Seg, cx, type Ic } from './ui'
import { Notice } from './Extra'

const chip = 'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-mu hover:bg-hov hover:text-tx'

function ModelMenu({ close, cfg }: { close: () => void; cfg: (t: string) => void }) {
  const s = useS()
  const [t, setT] = useState<'pl' | 'ep'>(s.sel?.k ?? 'ep')
  const [q, setQ] = useState('')
  const L: any[] = (t === 'pl' ? s.pls : s.eps).filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || (t === 'ep' && modelsOf(x).some((model) => model.toLowerCase().includes(q.toLowerCase()))))
  return (
    <>
      <Seg v={t} set={setT} opts={[['pl', 'Playlists', ListMusic], ['ep', 'Models', Cpu]]} />
      <div className="relative my-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-full rounded-lg bg-surf pl-9 pr-3 text-sm outline-none" />
      </div>
      {t === 'ep' && <Item icon={Cpu} on={!s.sel} sub="list order" onClick={() => { s.patch({ sel: null }); close() }}>All endpoints</Item>}
      {L.map((x) => (
        <div key={x.id}>
          {t === 'pl' || x.modelsMode === 'playlist'
            ? <Item icon={t === 'pl' ? ListMusic : Cpu} off={x.on === false} on={s.sel?.id === x.id && !s.sel.model} sub={t === 'pl' ? `${x.e.length} models` : `${modelsOf(x).length} model playlist`} onClick={() => { s.patch({ sel: { k: t, id: x.id } }); close() }}>{x.name}</Item>
            : <>
              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-mu">{x.name}</div>
              {modelsOf(x).map((model) => {
                const showName = s.prefs.modelDisplay === 'name' || s.prefs.modelDisplay === 'both'
                const showProvider = s.prefs.modelDisplay === 'provider' || s.prefs.modelDisplay === 'both'
                const alias = modelNameOf(x, model)
                const title = s.prefs.modelDisplay === 'provider' ? x.name : s.prefs.modelDisplay === 'none' ? model : alias
                return <Item key={model} icon={Cpu} off={x.on === false} on={s.sel?.id === x.id && s.sel.model === model} sub={s.prefs.modelDisplay === 'both' ? x.name : ''} onClick={() => { s.patch({ sel: { k: 'ep', id: x.id, model } }); close() }}>{title}</Item>
              })}
            </>}
          {t === 'ep' && modelsOf(x).filter((model: string) => supportsEffort(model, x.type)).map((model: string) => {
            const effort = s.effort[model] ?? 0
            return <label key={model} className="block px-3 pb-2 pt-1 text-xs text-mu" onClick={(e) => e.stopPropagation()}>
              <span className="flex justify-between"><span>{model} effort</span><span>{effort === 0 ? 'Off' : effort < 34 ? 'Low' : effort < 68 ? 'Medium' : 'High'}</span></span>
              <input aria-label={`${model} reasoning effort`} type="range" min="0" max="100" step="25" value={effort} onChange={(e) => s.patch({ effort: { ...s.effort, [model]: Number(e.target.value) } })} className="mt-1 w-full accent-ac" />
            </label>
          })}
        </div>
      ))}
      {!L.length && <p className="px-2.5 py-3 text-sm text-mu">Nothing here yet.</p>}
      <div className="mt-2 border-t border-hov px-1 pt-2">
        <Item icon={Settings} className="bg-surf/70 hover:bg-surf" onClick={() => { close(); cfg(t === 'pl' ? 'pls' : 'eps') }}>Manage…</Item>
      </div>
    </>
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
  const menu: { k: string; icon: Ic; label: string; hint: string; pick: () => void }[] | null = /^\/\S*$/.test(v)
    ? s.cmds.filter((c) => c.on && c.name.startsWith(v.slice(1))).map((c) => ({ k: c.id, icon: CI[c.in], label: '/' + c.name, hint: c.desc || c.in, pick: () => s.patch({ draft: '/' + c.name + ' ' }) }))
    : tw
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
    for (const f of [...l]) { const r = await readAtt(f); if (typeof r === 'string') s.patch({ notice: { t: r } }); else out.push(r) }
    setAtt((a) => [...a, ...out])
  }
  const ready = !!v.trim() || att.length > 0
  const submit = async () => {
    if (s.busy || !ready) return
    const raw = v, files = att
    if (await s.send(raw, files)) {
      if (useS.getState().draft === raw) s.patch({ draft: '' })
      setAtt([])
      if (ta.current) ta.current.style.height = 'auto'
    }
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
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
                <span className="truncate px-1 text-[10px] text-mu" title={a.name}>{a.name}</span>
                <button aria-label={`Remove ${a.name}`} onClick={() => setAtt(att.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/preview:opacity-100 focus:opacity-100"><X size={12} /></button>
                {bad(a) && <span className="absolute left-1 right-1 top-7 rounded bg-er/90 px-1 py-0.5 text-center text-[9px] text-white"><TriangleAlert size={11} className="inline" /> Unsupported</span>}
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
          id="composer" ref={ta} rows={1} value={v} placeholder={s.eps.some(usable) ? 'Message, / for commands, @ for tools' : 'Add a model endpoint to start (press Send for a walkthrough)'}
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
          <Pop up w="w-80" trigger={() => (
            <button className={chip}>
              {s.sel?.k === 'pl' ? <ListMusic size={16} /> : <Cpu size={16} />}
              <span className="max-w-40 truncate">{sel ? (s.sel?.model && s.sel.k === 'ep' ? modelNameOf(sel as any, s.sel.model) : sel.name) : 'All endpoints'}</span><ChevronDown size={14} />
            </button>
          )}>{(close) => <ModelMenu close={close} cfg={cfg} />}</Pop>
          <Pop up trigger={() => (
            <button className={chip}><ScrollText size={16} /><span className="max-w-32 truncate">{pr ? pr.name : 'No prompt'}</span><ChevronDown size={14} /></button>
          )}>
            {(close) => (
              <>
                <Item icon={X} on={!s.pr} onClick={() => { s.patch({ pr: '' }); close() }}>No override</Item>
                {s.prompts.map((p) => <Item key={p.id} icon={ScrollText} on={s.pr === p.id} onClick={() => { s.patch({ pr: p.id }); close() }}>{p.name}</Item>)}
                <Item icon={Settings} onClick={() => { close(); cfg('prompts') }}>Manage…</Item>
              </>
            )}
          </Pop>
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
