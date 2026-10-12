import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X, Plus, Trash2, ArrowUp, ArrowDown, ChevronDown, Eye, EyeOff, Play, ShieldCheck, Shield, Download, Upload, Check, CircleCheck, Cpu, Route, GripVertical, Server, ListMusic, ScrollText, Terminal, Wrench, Palette, Database, FileText, PanelRight, TrendingUp, Keyboard, Search, Brain, Pencil } from 'lucide-react'
import { useS, PRE, THEMES, THEME_COLOR_KEYS, THEME_COLOR_LABELS, modelsOf, modelNameOf, type Kind } from '../store'
import { CI, TOOLS, WIDGETS, KEYS } from '../meta'
import { DataTab, StatsTab, KeysTab, TestRow, TestAllEndpoints } from './Extra'
import { Btn, Field, Input, Area, Sel, Toggle, Seg, RangeSlider, Checkbox, HelpTip, Modal, Chip, cx, type Ic } from './ui'

const TABS: [string, string, Ic][] = [
  ['eps', 'Endpoints', Server], ['prompts', 'Prompts', ScrollText], ['pls', 'Playlists', ListMusic],
  ['cmds', 'Commands', Terminal], ['tools', 'Tools', Wrench], ['memory', 'Memory', Brain], ['widgets', 'Widgets', PanelRight], ['stats', 'Stats', TrendingUp], ['keys', 'Shortcuts', Keyboard], ['look', 'Appearance', Palette], ['data', 'Data controls', Database],
]
const INFO: Record<string, string> = {
  eps: 'Model APIs you connect with your own key. Add several, disable any, and test each one.',
  prompts: 'Reusable system prompts. Pick one from the prompt menu under the chat box to override a playlist prompt.',
  pls: 'Ordered lists of models from your endpoints. A request tries each model from top to bottom and stops at the first that succeeds. An optional classifier model picks one entry first.',
  cmds: 'Slash commands apply a system prompt and template to a typed input and run on the first endpoint that accepts that input type.',
  tools: 'Model tools such as date, calculator, and web search. Only enabled tools are sent to the provider.',
  memory: 'Optional local memory. When enabled, the memory tool summarizes durable details and adds selected memories to future requests.',
  widgets: 'Optional panels beside the chat. Widgets are off by default; enable them here and drag the grip in the panel to rearrange them.',
  stats: 'All-time totals of tokens sent and generated, messages sent and chats started.',
  keys: 'Click Change, then press the keys you want. Shortcuts need Ctrl/Cmd or Alt so they never fire while you type.',
  look: 'Theme, display options, and auto-generated chat names settings.',
  data: 'Export or import your setup. Exports leave API keys out unless you include them.',
}

export function Panel({ id, k, n, add, children }: { id: string; k?: Kind; n?: number; add?: string; children: ReactNode }) {
  const a = useS((s) => s.add)
  const t = TABS.find((x) => x[0] === id)!
  const I = t[2]
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 pr-10">
        <div className="flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><I size={20} className="text-ac" />{t[1]}</h2>
          <p className="mt-1 text-sm text-mu">{INFO[id]}</p>
        </div>
        {k && <Btn v="solid" icon={Plus} onClick={() => a(k)}>{add}</Btn>}
      </div>
      <div className="space-y-3">
        {n === 0 && <p className="rounded-xl bg-surf p-6 text-center text-sm text-mu">{id === 'eps' ? 'No endpoints yet. Press Add endpoint, choose a provider preset, paste your API key, enter the model id, then press Test connection.' : 'Nothing here yet. Use the button above to add one.'}</p>}
        {children}
      </div>
    </div>
  )
}

export function Card({ icon: I, title, sub, right, open0, dk, did, children }: { icon: Ic; title: ReactNode; sub?: string; right?: ReactNode; open0?: boolean; dk?: Kind; did?: string; children: ReactNode }) {
  const [o, setO] = useState(!!open0)
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className={cx('rounded-xl bg-surf', over && 'ring-2 ring-ac')}
      onDragOver={dk ? (e) => { e.preventDefault(); setOver(true) } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={dk ? (e) => { e.preventDefault(); setOver(false); const [k, f] = e.dataTransfer.getData('text/plain').split(':'); if (k === dk && f && did && f !== did) useS.getState().reorder(dk, f, did) } : undefined}>
      <div className="flex items-center gap-3 p-3">
        {dk && <span draggable title="Drag to reorder" onDragStart={(e) => { e.dataTransfer.setData('text/plain', dk + ':' + did); if (ref.current) e.dataTransfer.setDragImage(ref.current, 24, 24) }} className="-mr-1 cursor-grab text-mu"><GripVertical size={16} /></span>}
        <div role="button" tabIndex={0} onClick={() => setO(!o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setO(!o) } }} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hov text-ac"><I size={18} /></span>
          <span className="min-w-0"><span className="block truncate font-medium">{title}</span>{sub && <span className="block truncate text-sm text-mu">{sub}</span>}</span>
        </div>
        {right}
        <Btn sm icon={ChevronDown} title={o ? 'Collapse' : 'Expand'} onClick={() => setO(!o)} className={o ? 'rotate-180' : ''} />
      </div>
      {o && <div className="space-y-4 px-3 pb-4">{children}</div>}
    </div>
  )
}

const presetForUrl = (url: string) => Object.entries(PRE).find(([, p]) => p[1] && (() => { try { return new URL(p[1]).host === new URL(url).host } catch { return false } })())
const modelIdCompare = (a: string, b: string) => {
  const aa = a.match(/\d+|\D+/g) ?? [a], bb = b.match(/\d+|\D+/g) ?? [b]
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(bb[i])
    const cmp = an && bn ? Number(bb[i]) - Number(aa[i]) : aa[i].localeCompare(bb[i], undefined, { sensitivity: 'base' })
    if (cmp) return cmp
  }
  return bb.length - aa.length
}
const contextLabel = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.00$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n)

function Acts({ k, id }: { k: Kind; id: string }) {
  const { move, del } = useS()
  return (
    <div className="flex items-center gap-1 pt-1">
      <Btn icon={ArrowUp} title="Move up" onClick={() => move(k, id, -1)} />
      <Btn icon={ArrowDown} title="Move down" onClick={() => move(k, id, 1)} />
      <span className="flex-1" />
      <Btn v="danger" icon={Trash2} onClick={() => del(k, id)}>Remove</Btn>
    </div>
  )
}

function ModelsEditor({ e, update }: { e: any; update: (p: object) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const [drag, setDrag] = useState(-1)
  const [over, setOver] = useState(-1)
  const [picker, setPicker] = useState(false)
  const [catalog, setCatalog] = useState<{ id: string; efforts: string[]; source: 'auto' | 'manual'; providerId: string; name: string; context?: number; inputPrice?: number; outputPrice?: number }[]>([])
  const [catalogState, setCatalogState] = useState('')
  const [query, setQuery] = useState('')
  const [searchIdea, setSearchIdea] = useState<string | null>(null)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const models: string[] = e.models ?? [e.model]
  const presetInfo = (e.preset && PRE[e.preset]) || presetForUrl(e.url)?.[1]
  const endpointId = e.endpointId ?? presetInfo?.[2] ?? ''
  const endpointFilter = e.endpointFilter ?? presetInfo?.[3] ?? 'author'
  const isOpenRouter = /openrouter\.ai/i.test(e.url)
  const storedId = (id: string) => !isOpenRouter && endpointFilter === 'author' && endpointId && id.toLowerCase().startsWith(`${endpointId.toLowerCase()}/`) ? id.slice(endpointId.length + 1) : id
  const catalogId = (id: string) => !id.includes('/') && endpointFilter === 'author' && endpointId ? `${endpointId}/${id}` : id
  useEffect(() => {
    if (!picker) return
    const dismiss = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); setPicker(false) } }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [picker])
  const setModels = (next: string[]) => update({ models: next, model: next.find((m) => m.trim())?.trim() ?? '' })
  const reorder = (to: number) => { if (drag < 0 || drag === to) return; const next = [...models]; next.splice(to, 0, next.splice(drag, 1)[0]); setModels(next); setDrag(-1) }
  const loadCatalog = async () => {
    setPicker(true); setCatalogState('Loading documented models…')
    const base = String(e.url || '').trim().replace(/\/+$/, '')
    const headers = e.key ? { authorization: `Bearer ${e.key}` } : {}
    const openRouterHeaders = /openrouter\.ai/i.test(base) && e.key ? headers : {}
    const query = endpointId ? `?${endpointFilter === 'provider' ? 'providers' : 'model_authors'}=${encodeURIComponent(endpointId)}` : ''
    const parseModels = (body: any) => {
      const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : Array.isArray(body?.model_catalog) ? body.model_catalog : Array.isArray(body) ? body : []
      return rows.map((x: any) => {
        const params = x.supported_parameters ?? []
        const supportedEfforts = x.reasoning?.supported_efforts ?? x.supported_efforts ?? x.supported_reasoning_efforts
        const efforts = Array.isArray(supportedEfforts) ? supportedEfforts.map(String) : []
        const claimsReasoning = params.includes('reasoning') || params.includes('reasoning_effort') || x.supports_reasoning || x.supports_reasoning_effort
        const effortKnown = efforts.length > 0 || (!claimsReasoning && (Array.isArray(x.supported_parameters) || x.supports_reasoning === false))
        const id = String(x.id ?? x.model_id ?? x.model_name ?? '')
        const name = String(x.name ?? x.display_name ?? '')
        const providerId = String(x.provider ?? x.litellm_provider ?? x.provider_name ?? '')
        const modelLabel = name.replace(/^~+/, '').replace(/^([^:]+):\s*/, (full, prefix: string) => [providerId, endpointId, e.name, id.split('/')[0]].some(owner => owner && owner.toLowerCase() === prefix.trim().toLowerCase()) ? '' : full)
        const context = Number(x.context_length ?? x.context_window ?? x.max_input_tokens)
        const inputPrice = Number(x.pricing?.prompt), outputPrice = Number(x.pricing?.completion)
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
        return { id, efforts, source: effortKnown ? 'auto' as const : 'manual' as const, providerId, name: modelLabel, ...(context > 0 ? { context } : {}), ...(Number.isFinite(inputPrice) && inputPrice > 0 ? { inputPrice: round2(inputPrice * 1e6) } : {}), ...(Number.isFinite(outputPrice) && outputPrice > 0 ? { outputPrice: round2(outputPrice * 1e6) } : {}) }
      }).filter((x: any) => x.id && !/batch/i.test(x.id) && !/batch/i.test(x.name))
    }
    try {
      let found: { id: string; efforts: string[]; source: 'auto' | 'manual'; providerId: string; name: string }[] = [], firstError = ''
      try {
        const r = await fetch(`https://openrouter.ai/api/v1/models${query}`, { headers: openRouterHeaders })
        if (!r.ok) throw Error(`OpenRouter catalog HTTP ${r.status}`)
        found = parseModels(await r.json())
      } catch (err: any) { firstError = err?.message || 'OpenRouter lookup failed.' }
      const generalProvider = ['Groq', 'Together', 'Fireworks', 'Ollama (local)', 'Other OpenAI-compatible'].includes(e.preset ?? '')
      if (generalProvider && base) { try { const r = await fetch(`${base}/models`, { headers }); if (r.ok) found = parseModels(await r.json()) } catch { /* fall back to public catalogs */ } }
      if (!found.length) {
        try {
          const r = await fetch('https://models.litellm.ai/model_catalog')
          if (!r.ok) throw Error(`LiteLLM catalog HTTP ${r.status}`)
          found = parseModels(await r.json())
        } catch (err: any) {
          if (base) try { const r = await fetch(`${base}/models`, { headers }); if (r.ok) found = parseModels(await r.json()) } catch { /* keep catalog error for the manual entry path */ }
          if (!found.length) throw Error(`${firstError}; ${err?.message || 'LiteLLM lookup failed.'}`)
        }
      }
      if (endpointId) found = found.filter((x) => endpointFilter === 'provider'
        ? x.providerId.toLowerCase() === endpointId.toLowerCase() || (!x.id.includes('/') && x.id.toLowerCase().startsWith(`${endpointId.toLowerCase()}-`))
        : x.id.toLowerCase().startsWith(`${endpointId.toLowerCase()}/`))
      if (isOpenRouter) {
        const providerRows = endpointId ? found.filter((x) => endpointFilter === 'provider' ? x.providerId.toLowerCase() === endpointId.toLowerCase() || (!x.id.includes('/') && x.id.toLowerCase().startsWith(`${endpointId.toLowerCase()}-`)) : x.id.toLowerCase().startsWith(`${endpointId.toLowerCase()}/`)) : found
        const topCount = Math.min(providerRows.length, 10, Math.max(3, Math.floor(providerRows.length * 0.2)))
        found = [...providerRows.slice(0, topCount), ...found.filter((x) => !providerRows.slice(0, topCount).includes(x))]
      }
      setCatalog(found)
      const detectedEntries = found.filter(x => models.includes(storedId(x.id)) && x.source === 'auto' && !e.modelEffortSource?.[storedId(x.id)])
      const detected = Object.fromEntries(detectedEntries.map(x => [storedId(x.id), x.efforts]))
      const detectedSources = Object.fromEntries(detectedEntries.map(x => [storedId(x.id), 'auto']))
      const providedNames = Object.fromEntries(found.filter(x => models.includes(storedId(x.id)) && x.name && !e.modelNames?.[storedId(x.id)]).map(x => [storedId(x.id), x.name]))
      if (Object.keys(detected).length || Object.keys(providedNames).length) update({ modelEfforts: { ...e.modelEfforts, ...detected }, modelEffortSource: { ...e.modelEffortSource, ...detectedSources }, modelNames: { ...e.modelNames, ...providedNames } })
      setCatalogState(found.length ? `${found.length} models found. Catalog entries are suggestions; confirm any model ID.` : 'No catalog entries were returned. Enter a model ID below.')
    } catch (err: any) { setCatalogState(`${err?.message || 'Catalog lookup failed.'} You can still enter a model ID below.`) }
  }
  const addModel = (id: string, efforts: string[] = [], autoDetected = false) => {
    const clean = storedId(id.trim())
    if (!clean) return
    if (!models.includes(clean)) setModels([...models.filter(Boolean), clean])
    const providedName = catalog.find(x => storedId(x.id) === clean)?.name
    update({ modelEfforts: { ...e.modelEfforts, [clean]: efforts }, modelEffortSource: { ...e.modelEffortSource, [clean]: autoDetected ? (efforts.length ? 'auto' : catalog.find(x => storedId(x.id) === clean)?.source ?? 'manual') : 'manual' }, ...(providedName && !e.modelNames?.[clean] ? { modelNames: { ...e.modelNames, [clean]: providedName } } : {}) })
    setPicker(false); setQuery(''); setSearchIdea(null)
  }
  return <div className="space-y-2">
    {models.map((model, i) => <div key={i} className="rounded-xl bg-bg p-2">
      <div onDragOver={(ev) => { ev.preventDefault(); ev.stopPropagation(); setOver(i) }} onDragLeave={(ev) => { ev.stopPropagation(); setOver(-1) }} onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); reorder(i); setOver(-1) }} className={cx('grid grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2', drag === i && 'opacity-40', over === i && 'ring-2 ring-ac')}>
      <span draggable title="Drag to reorder" onDragStart={(ev) => { ev.stopPropagation(); setDrag(i) }} onDragEnd={(ev) => { ev.stopPropagation(); setDrag(-1); setOver(-1) }} className="cursor-grab text-mu"><GripVertical size={16} /></span>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-hov text-xs text-mu">{i + 1}</span>
      <input ref={(el) => { refs.current[i] = el }} value={model} onChange={(ev) => { const next = [...models]; next[i] = ev.target.value; setModels(next) }} onKeyDown={(ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); if (i < models.length - 1) refs.current[i + 1]?.focus(); else if (model.trim()) { setModels([...models, '']); setTimeout(() => refs.current[i + 1]?.focus(), 0) } }
      }} placeholder="Model ID" aria-label={`Model ID ${i + 1}`} className="min-w-0 bg-transparent px-2 py-1 text-sm outline-none" />
      <input value={model ? modelNameOf(e, model).replace(/^~+/, '') : ''} onChange={(ev) => update({ modelNames: { ...e.modelNames, [model]: ev.target.value } })} placeholder="Model name" aria-label={`Model name ${i + 1}`} className="min-w-0 rounded-md bg-surf px-2 py-1 text-sm outline-none" />
      <button title="Remove model" onClick={() => setModels(models.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-md text-mu hover:bg-hov hover:text-er"><Trash2 size={14} /></button>
      </div>
      {!!model && e.modelEffortSource?.[model] !== 'auto' && <div className="ml-8 mt-1 flex flex-wrap items-center gap-2 text-xs text-mu"><span>Reasoning effort support:</span>{(['low','medium','high','xhigh','max','minimal','none'] as const).map(level => { const levels: string[] = e.modelEfforts?.[model] ?? []; const checked = levels.includes(level); return <button key={level} type="button" role="checkbox" aria-checked={checked} onClick={() => update({ modelEfforts: { ...e.modelEfforts, [model]: checked ? levels.filter(x => x !== level) : [...new Set([...levels, level])] }, modelEffortSource: { ...e.modelEffortSource, [model]: 'manual' } })} className="inline-flex items-center gap-1.5 capitalize"><span className={cx('grid size-4 place-items-center rounded border transition-colors', checked ? 'border-ac bg-ac text-acx' : 'border-mu bg-surf')}>{checked && <Check size={12} strokeWidth={3}/>}</span>{level}</button> })}<span className="opacity-70">(manual)</span></div>}
    </div>)}
    <button onClick={() => { setPicker(true); setSelectedModels([]); void loadCatalog() }} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-hov py-2 text-sm text-mu hover:text-tx"><Plus size={14} />Add model</button>
    {picker && <Modal close={() => setPicker(false)} keyboard={false}><div className="flex max-h-[82dvh] w-full max-w-xl flex-col gap-3 rounded-2xl bg-bg p-5 shadow-2xl">
      <div className="flex items-center justify-between"><div><h3 className="font-semibold">Choose a model</h3><p className="mt-0.5 text-xs text-mu">{e.name}{endpointId ? ` · ${endpointId}` : ''}</p></div><button onClick={() => setPicker(false)} className="grid size-8 place-items-center rounded-lg text-mu hover:bg-hov hover:text-tx" aria-label="Close model picker"><X size={16}/></button></div>
      <button onClick={loadCatalog} className="self-start rounded-lg bg-hov px-3 py-2 text-xs text-tx">{catalog.length ? 'Refresh model catalog' : 'Load available models'}</button>
      <p className="text-xs text-mu">{catalogState || 'Loads models from the provider API, then public catalogs when unavailable.'} Catalog entries may not be enabled on your endpoint.</p>
      <input value={query} onChange={ev => setQuery(ev.target.value)} placeholder="Search available models" className="w-full rounded-lg bg-surf px-3 py-2 text-sm outline-none"/>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">{[...catalog].sort((a,b) => modelIdCompare(storedId(a.id).replace(/^~+/, ''), storedId(b.id).replace(/^~+/, ''))).filter(x => `${x.name.replace(/^~+/, '')} ${storedId(x.id).replace(/^~+/, '')}`.toLowerCase().includes(query.toLowerCase()) && !models.includes(storedId(x.id))).slice(0,250).map(x => { const id = storedId(x.id), visibleId = id.replace(/^~+/, ''), checked = selectedModels.includes(id); return <button key={x.id} onClick={() => setSelectedModels(checked ? selectedModels.filter(m => m !== id) : [...selectedModels, id])} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov"><span className={cx('grid size-4 shrink-0 place-items-center rounded border', checked ? 'border-ac bg-ac text-acx' : 'border-mu/60')}>{checked && <Check size={12}/>}</span><span className="min-w-0 flex-1"><span className="block truncate">{visibleId}</span>{(x.context || x.inputPrice !== undefined || x.outputPrice !== undefined) && <span className="block text-xs text-mu">{[x.context ? `${contextLabel(x.context)} context` : '', x.inputPrice !== undefined ? `$${x.inputPrice.toFixed(2)}/M in` : '', x.outputPrice !== undefined ? `$${x.outputPrice.toFixed(2)}/M out` : ''].filter(Boolean).join(' · ')}</span>}</span></button>})}
        {query.trim() && !models.includes(catalogId(query.trim())) && <button type="button" role="checkbox" aria-checked={searchIdea === catalogId(query.trim())} onClick={() => setSearchIdea(searchIdea === catalogId(query.trim()) ? null : catalogId(query.trim()))} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov"><span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center rounded border', searchIdea === catalogId(query.trim()) ? 'border-ac bg-ac text-acx' : 'border-mu/60')}>{searchIdea === catalogId(query.trim()) && <Check size={12}/>}</span><span className="min-w-0 truncate">Add “{catalogId(query.trim())}” model</span></button>}
      </div>
      {(selectedModels.length > 0 || searchIdea) && <button onClick={() => { const adding = [...new Set([...selectedModels, ...(searchIdea ? [searchIdea] : [])])]; const next = [...new Set([...models.filter(Boolean), ...adding])]; const effortEntries = selectedModels.map(id => { const item = catalog.find(x => storedId(x.id) === id); return item ? [id, item.efforts] as const : null }).filter(Boolean) as [string, string[]][]; const modelNames = Object.fromEntries(adding.map(id => [id, catalog.find(x => storedId(x.id) === id)?.name]).filter(([, name]) => !!name)); update({ models: next, model: next[0] ?? '', modelNames: { ...e.modelNames, ...modelNames }, modelEfforts: { ...e.modelEfforts, ...Object.fromEntries(effortEntries) }, modelEffortSource: { ...e.modelEffortSource, ...Object.fromEntries(effortEntries.map(([id, levels]) => [id, levels.length ? 'auto' : catalog.find(x => storedId(x.id) === id)?.source ?? 'manual'])) } }); setPicker(false); setSelectedModels([]); setSearchIdea(null) }} className="self-start rounded-lg bg-ac px-3 py-2 text-xs text-acx">Add selected models ({selectedModels.length + (searchIdea ? 1 : 0)})</button>}
    </div></Modal>}
  </div>
}

function Eps() {
  const { eps, upd } = useS()
  const [show, setShow] = useState('')
  const [editingName, setEditingName] = useState('')
  const [advanced, setAdvanced] = useState<string[]>([])
  const catalogPrefs = (endpointId: string) => Object.values(PRE).find((x) => x[2] && x[2] === endpointId)?.[3] ?? 'author'
  const selectPreset = (id: string, name: string) => {
    const [type, url, endpointId, endpointFilter] = PRE[name]
    upd('eps', id, { preset: name, type, url, name, endpointId, endpointFilter })
  }
  return (
    <Panel id="eps" k="eps" n={eps.length} add="Add endpoint">
      {eps.map((e) => {
        const u = (p: object) => upd('eps', e.id, p)
        return (
          <Card key={e.id} dk="eps" did={e.id} icon={Server} title={<span className="inline-flex min-w-0 items-center gap-1.5"><span className="truncate">{e.name}</span><button type="button" title="Edit endpoint name" aria-label="Edit endpoint name" onClick={(ev) => { ev.stopPropagation(); setEditingName(e.id) }} className="grid size-6 shrink-0 place-items-center rounded text-mu hover:bg-hov hover:text-tx"><Pencil size={13}/></button></span>} sub={e.model || 'No model id'} open0={!e.model && !e.key} right={<Toggle on={e.on} set={(v) => u({ on: v })} />}>
            <div className="space-y-3">
              {editingName === e.id && <Field label="Endpoint name"><Input autoFocus value={e.name} set={(name) => u({ name })} onBlur={() => setEditingName('')} onKeyDown={(ev) => { if (ev.key === 'Enter') setEditingName('') }} /></Field>}
              <section className="space-y-3 rounded-xl bg-bg p-3"><div className="text-sm font-medium">Models</div>
              <Field label="Preset"><Sel value={e.preset ?? presetForUrl(e.url)?.[0] ?? ''} set={(v) => v ? selectPreset(e.id, v) : u({ preset: '', endpointId: '', endpointFilter: 'author' })} opts={[[ '', 'Choose a preset'], ...Object.keys(PRE).map((k) => [k, k] as [string, string])]} /></Field>
              <Field label="Models" hint="Press Enter to add the next row. Every row uses this endpoint and API key.">
                <ModelsEditor e={e} update={u} />
              </Field>
              <Field label="Model behavior" hint="Playlist mode groups model ids under one endpoint choice and tries them in order.">
                <Seg v={e.modelsMode ?? 'separate'} set={(modelsMode) => u({ modelsMode })} opts={[["separate", "Separate models"], ["playlist", "Treat as playlist"]]} />
              </Field>
              </section>
              <section className="space-y-3 rounded-xl bg-bg p-3"><div className="text-sm font-medium">Credentials</div>
              <Field label="API key" hint="Stored unencrypted in this browser and sent only to the base URL.">
                <div className="relative">
                  <Input type={show === e.id ? 'text' : 'password'} value={e.key} set={(v) => u({ key: v })} placeholder="Leave empty for local servers" />
                  <button onClick={() => setShow(show === e.id ? '' : e.id)} title="Show or hide key" className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{show === e.id ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </Field>
              </section>
              <details open={advanced.includes(e.id)} onToggle={(ev) => { const isOpen = ev.currentTarget.open; setAdvanced(current => isOpen ? [...new Set([...current, e.id])] : current.filter(id => id !== e.id)) }} className="rounded-xl bg-bg px-3"><summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-mu"><span>Advanced connection settings</span><ChevronDown size={16} aria-hidden="true" className={cx('transition-transform', !advanced.includes(e.id) && '-rotate-90')} /></summary><div className="space-y-3 pb-3">
                <Field label="Base URL" hint="The format's path is appended to this URL."><Input value={e.url} set={(v) => { const match = presetForUrl(v); u({ url: v, ...(match ? { preset: match[0], endpointId: match[1][2], endpointFilter: match[1][3] } : { preset: '', endpointId: '', endpointFilter: 'author' }) }) }} placeholder="https://…/v1" /></Field>
                <Field label="API format"><Seg v={e.type} set={(v) => u({ type: v })} opts={[[ 'openai', 'OpenAI-compatible'], ['anthropic', 'Anthropic Messages']]} /></Field>
                <Field label="Endpoint ID" hint="Used to limit OpenRouter catalog suggestions to this brand or hosting provider."><Input value={e.endpointId ?? presetForUrl(e.url)?.[1][2] ?? ''} set={(endpointId) => u({ endpointId, endpointFilter: catalogPrefs(endpointId) })} placeholder="e.g. anthropic" /></Field>
              </div></details>
            </div>
            {useS.getState().prefs.showModelPricing && modelsOf(e).length > 0 && <div className="space-y-3 rounded-xl bg-bg p-3">
              <div><div className="text-sm font-medium">Model pricing</div><div className="text-xs text-mu">USD per 1 million tokens. Estimates use reported token counts.</div></div>
              {modelsOf(e).map((model) => {
                const price = e.prices?.[model] ?? { input: 0, output: 0 }
                const detect = async () => {
                  try {
                    const base = e.url.trim().replace(/\/+$/, '')
                    const res = await fetch(`${base}/models`, { headers: e.key ? { authorization: `Bearer ${e.key}` } : {} })
                    if (!res.ok) throw Error(`Catalog request failed (HTTP ${res.status})`)
                    const body = await res.json()
                    const item = body.data?.find((x: any) => x.id === model)
                    if (!item?.pricing?.prompt || !item?.pricing?.completion) throw Error('This model has no published token pricing in the catalog.')
                    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
                    u({ prices: { ...e.prices, [model]: { input: round2(Number(item.pricing.prompt) * 1e6), output: round2(Number(item.pricing.completion) * 1e6), source: 'openrouter' } } })
                  } catch (x: any) { useS.getState().patch({ notice: { t: x?.message ?? 'Could not detect a price.' } }) }
                }
                const setPrice = (kind: 'input' | 'output', value: string) => u({ prices: { ...e.prices, [model]: { ...price, [kind]: Math.max(0, Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100), source: 'manual' } } })
                return <div key={model} className="rounded-lg bg-surf p-3">
                  <div className="mb-2 truncate text-sm font-medium">{model}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-mu">Input $/1M<input type="number" min="0" step="0.01" value={price.input} onChange={(ev) => setPrice('input', ev.target.value)} className="mt-1 w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-tx" /></label>
                    <label className="text-xs text-mu">Output $/1M<input type="number" min="0" step="0.01" value={price.output} onChange={(ev) => setPrice('output', ev.target.value)} className="mt-1 w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-tx" /></label>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-mu">{price.source === 'openrouter' ? 'Detected price' : e.prices?.[model] ? 'Entered manually' : 'No price set'}</span>{/openrouter\.ai/i.test(e.url) && <Btn sm icon={Search} onClick={detect}>Auto-detect</Btn>}</div>
                </div>
              })}
            </div>}
            <TestRow e={e} />
            <Acts k="eps" id={e.id} />
          </Card>
        )
      })}
      {!!eps.length && <TestAllEndpoints eps={eps} />}
    </Panel>
  )
}

function Prompts() {
  const { prompts, upd } = useS()
  return (
    <Panel id="prompts" k="prompts" n={prompts.length} add="Add prompt">
      {prompts.map((p) => (
        <Card key={p.id} dk="prompts" did={p.id} icon={ScrollText} title={p.name} sub={p.text.slice(0, 70)}>
          <Field label="Name"><Input value={p.name} set={(v) => upd('prompts', p.id, { name: v })} /></Field>
          <Field label="System prompt"><Area rows={6} value={p.text} set={(v) => upd('prompts', p.id, { text: v })} /></Field>
          <Acts k="prompts" id={p.id} />
        </Card>
      ))}
    </Panel>
  )
}

function Pls() {
  const { pls, eps, upd } = useS()
  const [drag, setDrag] = useState(-1)
  return (
    <Panel id="pls" k="pls" n={pls.length} add="Add playlist">
      {pls.map((p) => {
        const u = (x: object) => upd('pls', p.id, x)
        const dnd = (i: number, j: number) => { if (i < 0 || i === j) return; const a = [...p.e]; a.splice(j, 0, a.splice(i, 1)[0]); u({ e: a }); setDrag(-1) }
        return (
          <Card key={p.id} dk="pls" did={p.id} icon={ListMusic} title={p.name} sub={`${p.e.length} entries${p.cls ? ' · classifier' : ''}`}>
            <Field label="Name"><Input value={p.name} set={(v) => u({ name: v })} /></Field>
            <Field label="System prompt" hint="Optional. Used when this playlist is selected and no prompt override is chosen."><Area value={p.sys} set={(v) => u({ sys: v })} /></Field>
            <Field label="Models" hint="Each entry is one model from an endpoint. Tried top to bottom until one responds without error.">
              <div className="space-y-1.5">
                {p.e.map((ref, i) => {
                  const [id, model] = ref.includes('::') ? [ref.slice(0, ref.indexOf('::')), ref.slice(ref.indexOf('::') + 2)] : [ref, '']
                  const e = eps.find((x) => x.id === id)
                  return (
                    <div key={ref} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => dnd(drag, i)} className={cx('flex items-center gap-2 rounded-lg bg-bg px-2 py-1.5 text-sm', drag === i && 'opacity-40')}>
                      <GripVertical size={16} className="text-mu" /><span className="w-5 text-mu">{i + 1}</span><Cpu size={15} className="text-mu" />
                      <span className="flex-1 truncate">{e?.name ?? 'Removed endpoint'}<span className="ml-2 text-mu">{model || 'All models'}</span></span>
                      
                      <Btn sm icon={X} title="Remove entry" onClick={() => u({ e: p.e.filter((x) => x !== ref) })} />
                    </div>
                  )
                })}
                <Sel value="" set={(v) => v && u({ e: [...p.e, v] })} opts={[['', 'Add model…'], ...eps.flatMap((ep) => modelsOf(ep).map((model) => [`${ep.id}::${model}`, `${ep.name} · ${model}`] as [string, string])).filter(([ref]) => !p.e.includes(ref))]} />
              </div>
            </Field>
            <div className="space-y-3 rounded-xl bg-bg p-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Route size={16} className="text-ac" />Classifier routing</div>
              <Field label="Classifier endpoint" hint="Must reply with JSON only. Output that fails validation, or names a model outside this playlist, is ignored.">
                <Sel value={p.cls} set={(v) => u({ cls: v })} opts={[['', 'None, use list order'], ...eps.map((e) => [e.id, e.name] as [string, string])]} />
              </Field>
              {p.cls && eps.find((e) => e.id === p.cls) && <Field label="Classifier model"><Sel value={p.clsModel ?? ""} set={(v) => u({ clsModel: v })} opts={[["", "Default model"], ...modelsOf(eps.find((e) => e.id === p.cls)!).map((model) => [model, modelNameOf(eps.find((e) => e.id === p.cls)!, model) + " · " + model] as [string, string])]} /></Field>}
              <Field label="Routing instructions"><Area rows={3} value={p.rule} set={(v) => u({ rule: v })} /></Field>
              <code className="block rounded-lg bg-surf px-3 py-2 text-xs text-mu">{'{"model":"<id from this playlist>"}'}</code>
            </div>
            <Acts k="pls" id={p.id} />
          </Card>
        )
      })}
    </Panel>
  )
}

function Cmds() {
  const { cmds, pls, upd } = useS()
  return (
    <Panel id="cmds" k="cmds" n={cmds.length} add="Add command">
      {cmds.map((c) => {
        const u = (x: object) => upd('cmds', c.id, x)
        return (
          <Card key={c.id} dk="cmds" did={c.id} icon={CI[c.in]} title={'/' + c.name} sub={c.desc || c.in} right={<Toggle on={c.on} set={(v) => u({ on: v })} />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint="Typed after /"><Input value={c.name} set={(v) => u({ name: v.replace(/[^\w-]/g, '') })} /></Field>
              <Field label="Description"><Input value={c.desc} set={(v) => u({ desc: v })} /></Field>
            </div>
            <Field label="Input type"><Seg v={c.in} set={(v) => u({ in: v })} opts={[['text', 'Text', CI.text], ['image', 'Image', CI.image], ['image+text', 'Image + text', CI['image+text']], ['doc', 'Document', CI.doc]]} /></Field>
            <Field label="System prompt"><Area value={c.sys} set={(v) => u({ sys: v })} /></Field>
            <Field label="Message template" hint="{{input}} is replaced by the text typed after the command."><Area rows={3} value={c.tpl} set={(v) => u({ tpl: v })} /></Field>
            <Field label="Run on" hint="The first endpoint that accepts the input type is used; the rest are fallbacks.">
              <Sel value={c.pl} set={(v) => u({ pl: v })} opts={[['', 'Any enabled endpoint, in list order'], ...pls.map((p) => [p.id, 'Playlist: ' + p.name] as [string, string])]} />
            </Field>
            <Acts k="cmds" id={c.id} />
          </Card>
        )
      })}
    </Panel>
  )
}

function Tools() {
  const s = useS()
  const [ask, setAsk] = useState<string | null>(null)
  const [searchReady, setSearchReady] = useState<boolean | null>(null)
  useEffect(() => {
    if (s.settingsScope !== 'power-user') return
    fetch('/api/health').then((r) => r.json()).then((x) => setSearchReady(!!x.searchConfigured)).catch(() => setSearchReady(false))
  }, [s.settingsScope])
  const t = TOOLS.find((x) => x[0] === ask)
  return (
    <Panel id="tools">
      {TOOLS.filter(([k]) => k !== 'memory' && !(k === 'search' && s.settingsScope !== 'power-user')).map(([k, n, I, u, d, p]) => (
        <Card key={k} icon={I} title={n} sub={u} right={
          <>
            <span className="hidden items-center gap-1.5 text-xs text-mu sm:flex">{s.tools[k] ? <ShieldCheck size={14} className="text-ac" /> : <Shield size={14} />}{s.tools[k] ? 'Allowed' : 'Off'}</span>
            <Toggle on={!!s.tools[k]} set={(v) => (v ? setAsk(k) : s.patch({ tools: { ...s.tools, [k]: false } }))} />
          </>
        }>
          <p className="text-sm">{d}</p>
          <p className="text-sm text-mu">Permission: {p}</p>
          {k === 'search' && <p className="text-xs text-mu">{searchReady === null ? 'Checking search service…' : searchReady ? 'SearXNG is configured. When allowed, messages about current or recent information can use web results. You can also write @search(query).' : 'SearXNG is unavailable. Check the server’s SEARXNG_BASE_URL and restart it. When allowed, current-information questions will use web results.'}</p>}
        </Card>
      ))}
      {t && (
        <Modal close={() => setAsk(null)}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-bg p-5">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-ac" />Allow {t[1]}?</div>
            <p className="text-sm text-mu">{t[5]}</p>
            <div className="flex justify-end gap-2">
              <Btn v="soft" onClick={() => setAsk(null)}>Cancel</Btn>
              <Btn v="solid" icon={Check} onClick={() => { s.patch({ tools: { ...s.tools, [t[0]]: true } }); setAsk(null) }}>Allow</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  )
}

function MemoryTab() {
  const s = useS(), mp = s.memoryPrefs
  const [draft, setDraft] = useState('')
  const [category, setCategory] = useState('General')
  const setPrefs = (p: Partial<typeof mp>) => s.patch({ memoryPrefs: { ...mp, ...p } })
  const addMemory = () => {
    const text = draft.trim(); if (!text) return
    const now = Date.now()
    s.patch({ memories: [...s.memories, { id: Math.random().toString(36).slice(2, 9), text, category: category.trim() || 'General', createdAt: now, updatedAt: now }] })
    setDraft('')
  }
  return <Panel id="memory">
    <div className="rounded-xl bg-surf p-4 space-y-3">
      <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Memory tool</div><div className="text-sm text-mu">Disabled by default. Memories stay in this browser and are sent to your selected model when recalled.</div></div><Toggle on={mp.enabled} set={(enabled) => setPrefs({ enabled })} /></div>
      <Field label="Memory mode" hint="Intentional stores explicit remember requests. Balanced also stores important disclosures. Aggressive includes smaller details and preferences.">
        <Seg v={mp.intent} set={(intent) => setPrefs({ intent })} opts={[["intentional", "Intentional"], ["balanced", "Balanced"], ["aggressive", "Aggressive"]]} />
      </Field>
      <Field label="Recall mode" hint="Contextual and Specific use the classifier below, which must return JSON with memory IDs.">
        <Seg v={mp.recall} set={(recall) => setPrefs({ recall })} opts={[["holistic", "Holistic"], ["contextual", "Contextual"], ["specific", "Specific"]]} />
      </Field>
      {mp.recall !== 'holistic' && <div className="space-y-2 rounded-lg bg-bg p-3"><Field label="Recall classifier endpoint"><Sel value={mp.classifierEp} set={(classifierEp) => setPrefs({ classifierEp, classifierModel: '' })} opts={[["", "Choose endpoint…"], ...s.eps.map((e) => [e.id, e.name] as [string, string])]} /></Field>
        {mp.classifierEp && s.eps.find((e) => e.id === mp.classifierEp) && <Field label="Classifier model"><Sel value={mp.classifierModel} set={(classifierModel) => setPrefs({ classifierModel })} opts={[["", "Endpoint default"], ...modelsOf(s.eps.find((e) => e.id === mp.classifierEp)!).map((m) => [m, m] as [string, string])]} /></Field>}
        <p className="text-xs text-mu">The classifier is prompted for strict JSON and any response containing unknown memory IDs is rejected.</p></div>}
    </div>
    <div className="rounded-xl bg-surf p-4 space-y-3"><div className="font-medium">Add a memory</div><Area rows={2} value={draft} set={setDraft} placeholder="A short fact, preference, or reminder…" /><div className="flex gap-2"><Input value={category} set={setCategory} placeholder="Category" /><Btn v="solid" icon={Plus} onClick={addMemory}>Add memory</Btn></div></div>
    <div className="flex items-center justify-between"><div className="text-sm font-medium">Stored memories ({s.memories.length})</div><Btn v="danger" icon={Trash2} disabled={!s.memories.length} onClick={() => { if (window.confirm('Delete all stored memories?')) s.patch({ memories: [] }) }}>Delete all</Btn></div>
    {s.memories.map((m) => <div key={m.id} className="rounded-xl bg-surf p-3 space-y-2"><div className="flex gap-2"><Input value={m.category} set={(category) => s.patch({ memories: s.memories.map((x) => x.id === m.id ? { ...x, category, updatedAt: Date.now() } : x) })} placeholder="Category" /><Btn v="danger" icon={Trash2} title="Delete memory" onClick={() => s.patch({ memories: s.memories.filter((x) => x.id !== m.id) })}>Delete</Btn></div><Area rows={2} value={m.text} set={(text) => s.patch({ memories: s.memories.map((x) => x.id === m.id ? { ...x, text, updatedAt: Date.now() } : x) })} /></div>)}
    {!s.memories.length && <p className="rounded-xl bg-surf p-4 text-sm text-mu">No memories stored yet. Add one here or enable memory and choose a mode.</p>}
  </Panel>
}

function WidgetsTab() {
  const s = useS()
  const wp = s.widgetPrefs
  const setWp = (p: Partial<typeof wp>) => s.patch({ widgetPrefs: { ...wp, ...p } })
  return (
    <Panel id="widgets">
      {WIDGETS.map(([k, n, I, d]) => (
        <Card key={k} icon={I} title={n} sub={d} right={<Toggle on={!!s.widgets[k]} set={(v) => s.patch({ widgets: { ...s.widgets, [k]: v }, rail: v || s.rail })} />}>
          <p className="text-sm text-mu">Shown in the panel at the right of the chat. Open or close that panel with the panel button in the chat header.</p>
          {k === 'usage' && <div className="space-y-3 rounded-xl bg-bg p-3">
            <Field label="Group usage"><Seg v={wp.usageGroup} set={(usageGroup) => setWp({ usageGroup })} opts={[["endpoint", "Endpoint totals"], ["model", "Individual models"]]} /></Field>
            <Field label="Show"><Seg v={wp.usageMode} set={(usageMode) => setWp({ usageMode })} opts={[["success", "OK / fails"], ["tokens", "Tokens"]]} /></Field>
            {wp.usageMode === 'tokens' && <Field label="Token format" hint="Use {in} and {out} where input and output totals should appear."><Input value={wp.usageFormat} set={(usageFormat) => setWp({ usageFormat })} /></Field>}
            <Field label="Usage period"><Seg v={wp.usagePeriod} set={(usagePeriod) => setWp({ usagePeriod })} opts={[["session", "Session"], ["day", "Day"], ["week", "Week"], ["custom", "Custom"], ["all", "All time"]]} /></Field>
            {wp.usagePeriod === 'custom' && <div className="grid grid-cols-2 gap-2"><Field label="From"><Input type="date" value={wp.usageFrom ?? ''} set={(usageFrom) => setWp({ usageFrom })} /></Field><Field label="Through"><Input type="date" value={wp.usageTo ?? ''} set={(usageTo) => setWp({ usageTo })} /></Field></div>}
            <Checkbox checked={wp.usageTotal} set={(usageTotal) => setWp({ usageTotal })} label="Show total across models and endpoints" />
          </div>}
          {k === 'last' && <div className="space-y-3"><div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.lastSpeed} set={(lastSpeed) => setWp({ lastSpeed })} label="Show response speed" /></div><Field label="Time unit"><Seg v={wp.timeUnit} set={(timeUnit) => setWp({ timeUnit })} opts={[["auto", "Auto"], ["ms", "Milliseconds"], ["s", "Seconds"]]} /></Field></div>}
          {k === 'keys' && <div className="grid gap-2 rounded-xl bg-bg p-3 sm:grid-cols-2">{KEYS.map(([id, label]) => <Checkbox key={id} checked={wp.shortcuts.includes(id)} set={(checked) => setWp({ shortcuts: checked ? [...wp.shortcuts, id] : wp.shortcuts.filter((x) => x !== id) })} label={label} />)}</div>}
          {k === 'ctx' && s.settingsScope === 'power-user' && <Field label="Estimated context limit" hint="Sets the scale of the meter. This does not change the model's actual context window."><Input type="number" min="1000" step="1000" value={wp.contextLimit} set={(v) => setWp({ contextLimit: Math.max(1000, Number(v) || 1000) })} /></Field>}
          {k === 'eps' && <div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.showDisabledEndpoints} set={(showDisabledEndpoints) => setWp({ showDisabledEndpoints })} label="Show disabled endpoints" /></div>}
          {k === 'pad' && <Field label="Visible note height" hint="Number of text rows before scrolling."><Input type="number" min="2" max="20" value={wp.scratchRows} set={(v) => setWp({ scratchRows: Math.min(20, Math.max(2, Number(v) || 6)) })} /></Field>}
          {k === 'snips' && <Field label="Maximum snippets shown" hint="Older snippets remain saved and can be found by removing newer ones."><Input type="number" min="1" max="100" value={wp.snippetLimit} set={(v) => setWp({ snippetLimit: Math.min(100, Math.max(1, Number(v) || 20)) })} /></Field>}
          {k === 'cost' && <Field label="Decimal places"><Input type="number" min="0" max="8" value={wp.costDecimals} set={(v) => setWp({ costDecimals: Math.min(8, Math.max(0, Number(v) || 0)) })} /></Field>}
          {k === 'prompts' && <div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.activePromptsOnly} set={(activePromptsOnly) => setWp({ activePromptsOnly })} label="Show only the selected prompt" /></div>}
          {k === 'draft' && <Field label="Characters per estimated token" hint="A rough estimate; 4 is a common default for English text."><Input type="number" min="1" max="10" value={wp.charsPerToken} set={(v) => setWp({ charsPerToken: Math.min(10, Math.max(1, Number(v) || 4)) })} /></Field>}
          {k === 'todo' && <div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.hideDoneTodos} set={(hideDoneTodos) => setWp({ hideDoneTodos })} label="Hide completed tasks" /></div>}
        </Card>
      ))}
    </Panel>
  )
}

const PAL: Record<string, string[]> = { plum: ['#120c16', '#17101c', '#dc8ad8'], graphite: ['#0e0e0e', '#141414', '#8ab4f8'], paper: ['#f1f1ec', '#fbfbf9', '#3b5bdb'], sepia: ['#ede2ca', '#f6eedd', '#9c4a1a'] }

function FontPicker({ value, set, options }: { value: string; set: (v: string) => void; options: [string, string][] }) {
  const [query, setQuery] = useState(value === 'system' ? '' : value)
  const [open, setOpen] = useState(false)
  const matches = options.filter(([font, label]) => `${font} ${label}`.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => setQuery(value === 'system' ? '' : value), [value])
  const choose = (font: string) => { set(font); setQuery(font === 'system' ? '' : font); setOpen(false) }
  return <div className="relative">
    <input value={query} placeholder="Search fonts or type a name" onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true) }} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={(e) => {
      if (e.key === 'Enter') { e.preventDefault(); const q = query.trim(); if (q) { const exact = options.find(([font, label]) => font.toLowerCase() === q.toLowerCase() || label.toLowerCase() === q.toLowerCase()); choose(exact?.[0] ?? q) } }
      if (e.key === 'Escape') setOpen(false)
    }} className="w-full rounded-lg bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
    {open && <div className="settings-dropdown absolute inset-x-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-xl bg-hov p-1.5 shadow-md">
      {matches.map(([font, label]) => <button type="button" key={font} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(font)} className="block w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surf">{label}</button>)}
      {!matches.length && query.trim() && <p className="px-2.5 py-2 text-xs text-mu">Press Enter to use “{query.trim()}”.</p>}
    </div>}
  </div>
}

function Look() {
  const s = useS()
  const settingsWidth = s.prefs.settingsWidth ?? 1024
  const settingsHeight = s.prefs.settingsHeight ?? 780
  const modelPickerHeight = s.prefs.modelPickerHeight ?? 480
  const [colorPicker, setColorPicker] = useState<string | null>(null)
  const [fadeInput, setFadeInput] = useState(String(s.prefs.fade))
  useEffect(() => setFadeInput(String(s.prefs.fade)), [s.prefs.fade])
  const row = (k: 'showBy' | 'showLog' | 'showTps' | 'enterSends' | 'autoTitle' | 'temporaryByDefault', t: string, d: string) => (
    <div className="flex items-center gap-3 rounded-xl bg-surf p-3">
      <div className="flex flex-1 items-center gap-2 text-sm font-medium">{t}<HelpTip text={d} label={`Help: ${t}`} /></div>
      <Toggle on={s.prefs[k]} set={(v) => s.patch({ prefs: { ...s.prefs, [k]: v } })} />
    </div>
  )
  return (
    <Panel id="look">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(THEMES).map(([k, n]) => (
          <button key={k} onClick={() => s.patch({ theme: k as keyof typeof THEMES })} className={cx('space-y-2 rounded-xl bg-surf p-2 text-left text-sm', s.theme === k && 'ring-2 ring-ac')}>
            <div className="flex h-16 overflow-hidden rounded-lg">
              <div className="w-1/4" style={{ background: k === 'custom' ? s.customColors.side : PAL[k][0] }} />
              <div className="flex-1 p-2" style={{ background: k === 'custom' ? s.customColors.bg : PAL[k][1] }}><div className="h-2 w-2/3 rounded" style={{ background: k === 'custom' ? s.customColors.ac : PAL[k][2] }} /></div>
            </div>
            <span className="flex items-center justify-between px-1">{n}{s.theme === k && <Check size={14} className="text-ac" />}</span>
          </button>
        ))}
      </div>
      {s.theme === 'custom' && <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Custom theme colors</div><div className="text-xs text-mu">Choose the colors used by every surface, text style, accent, and syntax highlight in the app.</div></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{THEME_COLOR_KEYS.map((key) => <div key={key} className="relative flex items-center gap-2 rounded-lg bg-bg p-2 text-sm">
          <button type="button" aria-label={`Choose ${THEME_COLOR_LABELS[key]} color`} aria-expanded={colorPicker === key} onClick={() => setColorPicker(colorPicker === key ? null : key)} className="size-9 shrink-0 rounded-lg border border-white/30 shadow-sm" style={{ backgroundColor: s.customColors[key] }} />
          <span className="min-w-0 flex-1 leading-tight">{THEME_COLOR_LABELS[key]}</span>
          <input aria-label={`${THEME_COLOR_LABELS[key]} hex color`} value={s.customColors[key]} onChange={(e) => { const value = e.target.value; if (/^#[\da-f]{0,6}$/i.test(value)) s.patch({ customColors: { ...s.customColors, [key]: value } }) }} onBlur={() => { if (!/^#[\da-f]{6}$/i.test(s.customColors[key])) s.patch({ customColors: { ...s.customColors, [key]: '#000000' } }) }} className="w-[5.2rem] rounded-md border border-white/20 bg-transparent px-1.5 py-1 font-mono text-xs uppercase" />
          {colorPicker === key && <div className="settings-dropdown absolute left-2 top-full z-30 mt-1 w-56 rounded-xl bg-bg p-3"><label className="flex items-center justify-between gap-3 text-xs text-mu">Choose color<input type="color" aria-label={`Choose ${THEME_COLOR_LABELS[key]} color`} value={s.customColors[key]} onChange={(e) => s.patch({ customColors: { ...s.customColors, [key]: e.target.value } })} className="h-9 w-12 cursor-pointer rounded-md border border-hov bg-transparent p-1" /></label></div>}
        </div>)}</div>
      </div>}
      {row('showBy', 'Show which model answered', 'Label each reply with the endpoint and model that produced it.')}
      {row('showLog', 'Show model-use details', 'List every model called for a reply, including classifiers and failures.')}
      {row('showTps', 'Show generation speed', 'Show tokens per second below each reply.')}
      {row('enterSends', 'Enter sends the message', 'Turn off to send with the button and use Enter for new lines.')}
      {row('autoTitle', 'Auto-generate chat names', 'Automatically generate a concise title after the first reply.')}
      {row('temporaryByDefault', 'New chats are temporary by default', 'New chats are deleted after the retention period, or when you leave if retention is set to Immediate.')}
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Model picker labels</div>
        <div className="text-xs text-mu">Choose which name details appear next to each model. Models remain grouped under their endpoint.</div>
        <Seg v={s.prefs.modelDisplay} set={(modelDisplay) => s.patch({ prefs: { ...s.prefs, modelDisplay } })} opts={[["none", "Neither"], ["name", "Model name"], ["provider", "Provider"], ["both", "Name + provider"]]} />
      </div>
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Command palette height</div>
        <div className="text-xs text-mu">Maximum height of the result list before it scrolls.</div>
        <div className="flex items-center gap-3"><RangeSlider label="Command palette maximum height" min={200} max={720} step={20} value={s.prefs.paletteMax} set={(paletteMax) => s.patch({ prefs: { ...s.prefs, paletteMax } })} className="flex-1" /><span className="w-20 text-right text-sm">{s.prefs.paletteMax}px</span></div>
      </div>
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Message width</div>
        <div className="text-xs text-mu">Set the maximum width of the conversation column.</div>
        <Seg v={s.prefs.chatWidth} set={(chatWidth) => s.patch({ prefs: { ...s.prefs, chatWidth } })} opts={[["narrow", "Narrow"], ["standard", "Standard"], ["wide", "Wide"]]} />
      </div>
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Settings window size</div><div className="text-xs text-mu">Set the maximum width and height of the settings window. Smaller screens constrain it to fit.</div></div>
        <Field label={`Width · ${settingsWidth}px`}><RangeSlider label="Settings window width" min={720} max={1440} step={40} value={settingsWidth} set={(settingsWidth) => s.patch({ prefs: { ...s.prefs, settingsWidth } })} className="w-full" /></Field>
        <Field label={`Height · ${settingsHeight}px`}><RangeSlider label="Settings window height" min={520} max={1000} step={20} value={settingsHeight} set={(settingsHeight) => s.patch({ prefs: { ...s.prefs, settingsHeight } })} className="w-full" /></Field>
      </div>
      <div className="rounded-xl bg-surf p-3 space-y-2"><div className="text-sm font-medium">Model picker height</div><div className="text-xs text-mu">Maximum height of the model and playlist menu. Smaller screens constrain it to fit.</div><Field label={`Height · ${modelPickerHeight}px`}><RangeSlider label="Model picker height" min={320} max={720} step={20} value={modelPickerHeight} set={(modelPickerHeight) => s.patch({ prefs: { ...s.prefs, modelPickerHeight } })} className="w-full" /></Field></div>
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <label className="flex items-center justify-between gap-3 text-sm">Show model pricing controls<Toggle on={s.prefs.showModelPricing} set={(showModelPricing) => s.patch({ prefs: { ...s.prefs, showModelPricing } })} /></label>
        <div className="text-xs text-mu">Adds per-model pricing fields to each endpoint. Off by default.</div>
      </div>
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Overlay appearance</div><div className="text-xs text-mu">Control how dialogs and the settings panel sit over the workspace.</div></div>
        <Field label={`Modal background blur · ${s.prefs.modalBlur}px`} hint="Blur behind confirmation and selection dialogs. Settings itself stays sharp."><RangeSlider label="Modal background blur" min={0} max={24} step={1} value={s.prefs.modalBlur} set={(modalBlur) => s.patch({ prefs: { ...s.prefs, modalBlur } })} className="w-full" /></Field>
        <Field label={`Settings background opacity · ${s.prefs.settingsOpacity}%`} hint="How much the settings backdrop dims the workspace behind the settings panel."><RangeSlider label="Settings background opacity" min={0} max={100} step={5} value={s.prefs.settingsOpacity} set={(settingsOpacity) => s.patch({ prefs: { ...s.prefs, settingsOpacity } })} className="w-full" /></Field>
      </div>
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Text fade-in duration</div>
        <div className="text-xs text-mu">Set to 0 to turn it off, or choose up to 1 second.</div>
        <div className="flex items-center gap-3">
          <RangeSlider label="Text fade-in duration" min={0} max={1} step={0.1} value={s.prefs.fade} set={(fade) => s.patch({ prefs: { ...s.prefs, fade } })} className="flex-1" />
          <input aria-label="Text fade-in seconds" type="number" min="0" max="1" step="0.1" value={fadeInput} onChange={(e) => setFadeInput(e.target.value)} onBlur={() => { const x = Number(fadeInput); if (fadeInput !== '' && Number.isFinite(x)) s.patch({ prefs: { ...s.prefs, fade: Math.max(0, Math.min(1, Math.round(x * 10) / 10)) } }); else setFadeInput(String(s.prefs.fade)) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} className="w-20 rounded-lg bg-bg px-2 py-1.5 text-sm" />
          <span className="text-sm text-mu">seconds</span>
        </div>
      </div>
      {s.settingsScope === 'power-user' && <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Temporary chat retention</div>
        <div className="text-xs text-mu">Temporary chats are removed automatically after this time. Immediate also removes them when you start another chat or leave this page.</div>
        <div className="flex items-center gap-3"><RangeSlider label="Temporary chat retention" min={0} max={48} step={1} value={s.prefs.tempHours} set={(tempHours) => s.patch({ prefs: { ...s.prefs, tempHours } })} className="flex-1" /><span className="w-24 text-right text-sm">{s.prefs.tempHours === 0 ? 'Immediate' : `${s.prefs.tempHours} hours`}</span></div>
      </div>}
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Fonts</div><div className="text-xs text-mu">Fonts already loaded in the app are reused; other choices load from Google Fonts.</div></div>
        <Field label="Body font"><FontPicker value={s.prefs.fontBody} set={(fontBody) => s.patch({ prefs: { ...s.prefs, fontBody } })} options={FONT_OPTIONS} /></Field>
        <Field label="Heading font"><FontPicker value={s.prefs.fontHeader} set={(fontHeader) => s.patch({ prefs: { ...s.prefs, fontHeader } })} options={FONT_OPTIONS} /></Field>
        <Field label="Monospace font"><FontPicker value={s.prefs.fontMono} set={(fontMono) => s.patch({ prefs: { ...s.prefs, fontMono } })} options={MONO_OPTIONS} /></Field>
      </div>
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Title generation model</div>
        <div className="text-xs text-mu">Choose a model to generate chat names, or leave on default (uses the responding model).</div>
        <Sel value={s.prefs.titleEp} set={(v) => s.patch({ prefs: { ...s.prefs, titleEp: v, titleModel: "" } })} opts={[['', 'Default (model that answered)'], ...s.eps.map((e) => [e.id, e.name] as [string, string])]} />
        {s.prefs.titleEp && s.eps.find((e) => e.id === s.prefs.titleEp) && <Sel value={s.prefs.titleModel ?? ""} set={(titleModel) => s.patch({ prefs: { ...s.prefs, titleModel } })} opts={[["", "Default model for this endpoint"], ...modelsOf(s.eps.find((e) => e.id === s.prefs.titleEp)!).map((m) => [m, modelNameOf(s.eps.find((e) => e.id === s.prefs.titleEp)!, m) + " · " + m] as [string, string])]} />}

      </div>
    </Panel>
  )
}

const FONT_OPTIONS: [string, string][] = [['system', 'System default'], ['Arial', 'Arial'], ['Verdana', 'Verdana'], ['Georgia', 'Georgia'], ['Trebuchet MS', 'Trebuchet MS'], ['Times New Roman', 'Times New Roman'], ['Inter', 'Inter'], ['Roboto', 'Roboto'], ['Open Sans', 'Open Sans'], ['Segoe UI', 'Segoe UI'], ['Helvetica Neue', 'Helvetica Neue']]
const MONO_OPTIONS: [string, string][] = [['system', 'System monospace'], ['Consolas', 'Consolas'], ['Menlo', 'Menlo'], ['Monaco', 'Monaco'], ['Courier New', 'Courier New'], ['Cascadia Code', 'Cascadia Code'], ['JetBrains Mono', 'JetBrains Mono'], ['Fira Code', 'Fira Code']]

const VIEWS: Record<string, () => ReactNode> = { eps: Eps, prompts: Prompts, pls: Pls, cmds: Cmds, tools: Tools, memory: MemoryTab, widgets: WidgetsTab, look: Look, stats: StatsTab, keys: KeysTab, data: DataTab }

export function Settings({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const V = VIEWS[tab] ?? Eps
  const scope = useS((s) => s.settingsScope)
  const settingsOpacity = useS((s) => s.prefs.settingsOpacity)
  const settingsWidth = useS((s) => s.prefs.settingsWidth ?? 1024)
  const settingsHeight = useS((s) => s.prefs.settingsHeight ?? 780)
  const advanced = scope === 'power-user'
  const standardTabs = ['eps', 'prompts', 'pls', 'tools', 'memory', 'widgets', 'look', 'data']
  const visibleTabs = advanced ? TABS : TABS.filter(([k]) => standardTabs.includes(k))
  const setScope = (v: boolean) => { useS.getState().patch({ settingsScope: v ? 'power-user' : 'standard' }); if (!v && !standardTabs.includes(tab)) setTab('eps') }
  return (
    <Modal close={() => setTab('')} blur={false} opacity={settingsOpacity}>
      <div style={{ width: `min(${settingsWidth}px, 96vw)`, height: `min(${settingsHeight}px, 92dvh)` }} className="settings-root flex overflow-hidden rounded-2xl bg-bg">
        <nav className="hidden w-56 shrink-0 flex-col bg-side p-3 sm:flex">
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {visibleTabs.map(([k, l, I]) => (
              <button key={k} onClick={() => setTab(k)} className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm', tab === k ? 'bg-hov' : 'text-mu hover:bg-surf hover:text-tx')}>
                <I size={16} />{l}
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-hov pt-3">
            <label className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-mu">Power user<Toggle on={advanced} set={setScope} /></label>
          </div>
        </nav>
        <div className="relative flex-1 overflow-y-auto p-6">
        <div className="absolute right-3 top-3 z-20"><Btn icon={X} title="Close settings" aria-label="Close settings" onClick={() => setTab('')} /></div>
          <div className="mb-4 pr-44 sm:hidden"><Sel value={tab} set={setTab} opts={visibleTabs.map(([k, l]) => [k, l] as [string, string])} /></div>
          <V />
        </div>
      </div>
    </Modal>
  )
}
