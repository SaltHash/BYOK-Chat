import { useEffect, useState, type ReactNode } from 'react'
import { Info, X, Server, Play, MessageSquare, Keyboard, ArrowUp, ArrowDown, MessagesSquare, RotateCcw, Download, Upload, FileText, Trash2, CircleCheck, CircleX, Gauge } from 'lucide-react'
import { useS, dl, BLANK, THEMES, themePatch, DEFAULT_FEATURES, modelsOf, modelNameOf, normSearch, normAdvanced, normFeatureOrder, normDocs, featOn, errText, storageUsage, QUOTA_FLAG, type Ep, type Kind, type FeatureId } from '../store'
import { normSkills } from '../skills'
import { combo, fmt, rec as R, testEp } from '../engine'
import { KEYS, TOOLS } from '../meta'
import { Btn, Toggle, Checkbox, Confirm, Modal, Surface, cx, type Ic } from './ui'
import { Panel } from './Settings'
import { detectAvailableCategories, buildExportPayload } from '../configIO'
import { SyncBox, EncryptedBackupBox } from './SyncBox'

export function Notice({ cfg }: { cfg: (t: string) => void }) {
  const n = useS((s) => s.notice), patch = useS((s) => s.patch)
  if (!n) return null
  return (
    <div className="mb-2 flex items-start gap-3 rounded-xl bg-surf p-3 text-sm">
      <Info size={18} className="mt-0.5 shrink-0 text-ac" />
      <p className="flex-1 leading-6">{n.t}</p>
      {n.tab && <Btn v="soft" onClick={() => { patch({ notice: null }); cfg(n.tab!) }}>{n.label ?? 'Open settings'}</Btn>}
      <Btn sm icon={X} title="Dismiss" onClick={() => patch({ notice: null })} />
    </div>
  )
}

export function Tutorial({ cfg }: { cfg: (t: string) => void }) {
  const s = useS()
  const steps: [Ic, string, string][] = [
    [Server, 'Add an endpoint', 'Pick a provider preset or enter any base URL, then paste your API key and the model id. Keys stay in this browser.'],
    [Play, 'Test it', 'Press Test connection on the endpoint. You will see whether it answers and how long it takes.'],
    [MessageSquare, 'Send a message', 'Type below and press Enter. Type / for commands and @ for tools.'],
  ]
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-6 px-4 py-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Connect a model to begin</h2>
        <p className="text-sm text-mu">{s.eps.length ? 'Your endpoints are disabled or incomplete. Each one must be enabled and have a base URL and a model id.' : 'No models are built in. Bring your own endpoint and key.'}</p>
      </div>
      <ol className="space-y-2">
        {steps.map(([I, t, d], i) => (
          <li key={t} className="flex gap-3 rounded-xl bg-surf p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-bg text-ac"><I size={18} /></span>
            <div><div className="text-sm font-medium">{i + 1}. {t}</div><div className="text-xs text-mu">{d}</div></div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Btn v="solid" icon={Server} onClick={() => { if (!s.eps.length) s.add('eps'); cfg('eps') }}>{s.eps.length ? 'Open endpoints' : 'Add an endpoint'}</Btn>
        <Btn v="soft" icon={Keyboard} onClick={() => cfg('keys')}>Keyboard shortcuts</Btn>
      </div>
      <p className="text-xs text-mu">Later: playlists try several models in order, commands (/) wrap a prompt around an input, and tools (@) stay off until you allow them.</p>
    </div>
  )
}

export function TestRow({ e }: { e: Ep }) {
  const [r, setR] = useState<{ s: 'run' | 'ok' | 'err'; t: string; model: string }[]>([])
  const run = async () => {
    const models = modelsOf(e)
    setR(models.map((model) => ({ model, s: 'run', t: 'Testing…' })))
    for (const model of models) {
      const t0 = Date.now()
      try {
        const x = await testEp({ ...e, model })
        setR((rows) => rows.map((r) => r.model === model ? { ...r, s: 'ok', t: `Reachable in ${Date.now() - t0} ms. Reply: ${x.slice(0, 40)}` } : r))
      } catch (x: any) {
        setR((rows) => rows.map((r) => r.model === model ? { ...r, s: 'err', t: errText(e, x.message) } : r))
      }
    }
  }
  return (
    <div className="space-y-2">
      <Btn v="soft" icon={Play} disabled={r.some((x) => x.s === 'run')} onClick={run}>Test all model connections</Btn>
      {r.map((x) => <div key={x.model} className={cx('flex items-start gap-2 text-sm', x.s === 'err' ? 'text-er' : x.s === 'ok' ? 'text-ac' : 'text-mu')}>
        {x.s === 'err' ? <CircleX size={14} className="mt-0.5 shrink-0" /> : x.s === 'ok' ? <CircleCheck size={14} className="mt-0.5 shrink-0" /> : null}
        <span><b>{modelNameOf(e, x.model)}</b> <span className="text-mu">({x.model})</span>: {x.t}</span>
      </div>)}
    </div>
  )
}

export function TestAllEndpoints({ eps }: { eps: Ep[] }) {
  const [rows, setRows] = useState<{ key: string; endpoint: string; model: string; s: 'run' | 'ok' | 'err'; t: string }[]>([])
  const [running, setRunning] = useState(false)
  const run = async () => {
    const all = eps.flatMap((e) => modelsOf(e).map((model) => ({ e, model, key: `${e.id}:${model}` })))
    if (!all.length || running) return
    setRunning(true)
    setRows(all.map(({ e, model, key }) => ({ key, endpoint: e.name, model, s: 'run', t: 'Waiting…' })))
    for (const { e, model, key } of all) {
      setRows((items) => items.map((x) => x.key === key ? { ...x, t: 'Testing…' } : x))
      const t0 = Date.now()
      try {
        const answer = await testEp({ ...e, model })
        setRows((items) => items.map((x) => x.key === key ? { ...x, s: 'ok', t: `Reachable in ${Date.now() - t0} ms. Reply: ${answer.slice(0, 40)}` } : x))
      } catch (x: any) {
        setRows((items) => items.map((row) => row.key === key ? { ...row, s: 'err', t: errText(e, x?.message ?? x) } : row))
      }
    }
    setRunning(false)
  }
  return <div className="space-y-2 rounded-xl bg-surf p-3">
    <div className="flex flex-wrap items-center gap-3">
      <Btn v="soft" icon={Play} disabled={running || !eps.some((e) => modelsOf(e).length)} onClick={run}>Test all endpoints</Btn>
      <span className="text-xs text-mu">Tests every configured model across all providers, including disabled endpoints.</span>
    </div>
    {rows.map((x) => <div key={x.key} className={cx('flex items-start gap-2 text-sm', x.s === 'err' ? 'text-er' : x.s === 'ok' ? 'text-ac' : 'text-mu')}>
      {x.s === 'err' ? <CircleX size={14} className="mt-0.5 shrink-0" /> : x.s === 'ok' ? <CircleCheck size={14} className="mt-0.5 shrink-0" /> : null}
      <span><b>{x.endpoint}</b> <span className="text-mu">· {x.model}</span>: {x.t}</span>
    </div>)}
  </div>
}

const Box = ({ icon: I, t, d, children }: { icon: Ic; t: string; d: string; children?: ReactNode }) => (
  <Surface className="flex flex-wrap items-center gap-3">
    <span className="grid size-9 place-items-center rounded-lg bg-hov text-ac"><I size={18} /></span>
    <div className="min-w-48 flex-1"><div className="text-sm font-medium">{t}</div><div className="text-xs text-mu">{d}</div></div>
    {children}
  </Surface>
)

export function StatsTab() {
  const s = useS(), t = s.stats
  const [cf, setCf] = useState(false)
  if (!featOn(s, 'stats')) return null
  const card = (I: Ic, l: string, v: number, d: string) => (
    <div className="rounded-xl bg-surf p-4">
      <div className="flex items-center gap-2 text-sm text-mu"><I size={16} className="text-ac" />{l}</div>
      <div className="mt-2 text-2xl font-semibold">{v.toLocaleString()}</div>
      <div className="text-xs text-mu">{d}</div>
    </div>
  )
  return (
    <Panel id="stats">
      <div className="grid gap-3 sm:grid-cols-2">
        {card(ArrowUp, 'Tokens sent', t.tin, `${t.historyIn.toLocaleString()} history · ${t.explicitIn.toLocaleString()} explicit input`)}
        {card(ArrowDown, 'Tokens generated', t.tout, 'Reply tokens, including partial replies')}
        {card(MessageSquare, 'Messages sent', t.sent, 'Includes edited and resent messages')}
        {card(MessagesSquare, 'Chats started', t.chats, 'A chat counts when its first message is sent')}
      </div>
      <p className="text-xs text-mu">Total {(t.tin + t.tout).toLocaleString()} tokens since {new Date(t.since).toLocaleDateString()}. Totals are all-time and are not affected by deleting chats. They use token counts reported by the provider when available, and a rough 4-characters-per-token estimate otherwise.</p>
      <Btn v="danger" icon={RotateCcw} onClick={() => setCf(true)}>Reset stats</Btn>
      {cf && <Confirm title="Reset all stats?" text="Tokens, messages and chats-started totals go back to zero. Your chats and settings are not affected." ok="Reset" close={() => setCf(false)} run={s.resetStats} />}
    </Panel>
  )
}

export function KeysTab() {
  const st = useS()
  const { keys, patch } = st
  const off = !featOn(st, 'shortcuts')
  const [rec, setRec] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!rec) return
    R.on = true
    const f = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRec(''); setErr(''); return }
      const c = combo(e); if (!c) return
      const k = c.split('+').pop()!
      if (k.length === 1 && !/Mod|Alt/.test(c)) { setErr('Add Ctrl/Cmd or Alt so the shortcut does not fire while you type.'); return }
      const dup = KEYS.find(([a]) => a !== rec && (keys[a] ?? '') === c)
      if (dup) { setErr(`${fmt(c)} is already used by "${dup[1]}".`); return }
      patch({ keys: { ...keys, [rec]: c } }); setRec(''); setErr('')
    }
    addEventListener('keydown', f, true)
    return () => { R.on = false; removeEventListener('keydown', f, true) }
  }, [rec, keys])
  if (off) return null
  return (
    <Panel id="keys">
      <div className="space-y-2">
        {KEYS.map(([id, label, def]) => {
          const cur = keys[id] ?? def
          return (
            <div key={id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surf p-3">
              <span className="min-w-40 flex-1 text-sm">{label}</span>
              {rec === id ? <span className="text-sm text-ac">Press the new keys…</span>
                : <span className="flex gap-1">{cur.split('+').map((k, i) => <kbd key={i} className="rounded-md bg-hov px-1.5 py-0.5 text-xs font-medium">{fmt(k)}</kbd>)}</span>}
              <Btn v="soft" onClick={() => { setErr(''); setRec(rec === id ? '' : id) }}>{rec === id ? 'Cancel' : 'Change'}</Btn>
              <Btn sm icon={RotateCcw} title="Reset to default" disabled={cur === def} onClick={() => patch({ keys: { ...keys, [id]: def } })} />
            </div>
          )
        })}
      </div>
      {err && <p className="text-sm text-er">{err}</p>}
      <div className="flex items-center gap-3">
        <Btn v="soft" icon={RotateCcw} onClick={() => patch({ keys: Object.fromEntries(KEYS.map(([k, , d]) => [k, d])) })}>Reset all</Btn>
        <span className="text-xs text-mu">Press Escape while recording to cancel. Some browser shortcuts, such as opening a new tab, cannot be overridden.</span>
      </div>
    </Panel>
  )
}

function StorageBox() {
  const s = useS()
  const [info, setInfo] = useState<{ localBytes: number; quota?: number; usage?: number } | null>(null)
  const [durable, setDurable] = useState<{ localBytes: number; durableBytes: number; opfs: boolean; backend: string } | null>(null)
  const [quotaFull, setQuotaFull] = useState(false)
  const [note, setNote] = useState('')
  const refresh = () => {
    void storageUsage().then(setInfo)
    void import('../storage/durable').then(({ durableUsage }) => durableUsage().then(setDurable).catch(() => {}))
    try { setQuotaFull(localStorage.getItem(QUOTA_FLAG) != null) } catch { /* ignore */ }
  }
  useEffect(() => {
    let live = true
    void storageUsage().then((v) => { if (live) setInfo(v) })
    void import('../storage/durable').then(({ durableUsage }) => durableUsage().then((v) => { if (live) setDurable(v) }).catch(() => {}))
    try { setQuotaFull(localStorage.getItem(QUOTA_FLAG) != null) } catch { /* ignore */ }
    // Background compaction every 5 min: prune durable + clear quota flag.
    const timer = setInterval(() => {
      void import('../storage/boot').then(({ compactDurable }) => compactDurable(useS.getState().chats as never).catch(() => null))
    }, 300_000)
    return () => { live = false; clearInterval(timer) }
  }, [s.chats, s.workspaces])
  const kb = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`
  const desc = info ? `Settings ~${kb(info.localBytes)}${durable ? ` · durable chats/workspaces ~${kb(durable.durableBytes)} (${durable.backend}${durable.opfs ? '+OPFS' : ''})` : ''}.` : 'Measure how much app data this browser holds.'
  return (
    <Box icon={Gauge} t="Browser storage" d={desc}>
      <Btn v="soft" onClick={refresh}>Refresh</Btn>
      <Btn v="soft" onClick={() => { setNote(s.compactStorage()); refresh() }}>Compact</Btn>
      <Btn v="soft" onClick={() => {
        void import('../storage/boot').then(({ compactDurable }) => compactDurable(useS.getState().chats as never).then((r) => setNote(`Durable compaction: ${(r.freedChars / 1024).toFixed(1)} KB freed${r.droppedChats ? `, ${r.droppedChats} expired chats removed` : ''}.`)).catch(() => setNote('Durable compaction failed.')))
      }}>Compact durable</Btn>
      {quotaFull && <span className="basis-full text-xs text-er">The last save did not fit: settings were kept and bulky history was compacted automatically. Use Compact or delete old chats to free space.</span>}
      {note && <span className="basis-full text-xs text-mu">{note}</span>}
    </Box>
  )
}

export function DataTab() {
  const s = useS()
  const [withKeys, setWithKeys] = useState(false)
  const catFeature: Record<string, FeatureId> = { prompts: 'prompts', pls: 'playlists', cmds: 'commands', skills: 'skills', memory: 'memory', keys: 'shortcuts', tools: 'tools', widgets: 'widgets', stats: 'stats' }
  const categories = [['eps', 'Endpoints'], ['prompts', 'Prompts'], ['pls', 'Playlists'], ['cmds', 'Commands'], ['skills', 'Skills'], ['memory', 'Memory'], ['keys', 'Shortcuts'], ['appearance', 'Appearance'], ['features', 'Features'], ['tools', 'Tools'], ['tuning', 'Model tuning'], ['widgets', 'Widget settings'], ['stats', 'Usage stats'], ['chats', 'Chat history']].filter(([id]) => !catFeature[id] || featOn(s, catFeature[id])) as unknown as [['eps', 'Endpoints'], ['prompts', 'Prompts'], ['pls', 'Playlists'], ['cmds', 'Commands'], ['skills', 'Skills'], ['memory', 'Memory'], ['keys', 'Shortcuts'], ['appearance', 'Appearance'], ['features', 'Features'], ['tools', 'Tools'], ['tuning', 'Model tuning'], ['widgets', 'Widget settings'], ['stats', 'Usage stats'], ['chats', 'Chat history']]
  type Category = typeof categories[number][0]
  const allOn = { eps: true, prompts: true, pls: true, cmds: true, skills: true, memory: true, keys: true, appearance: true, features: true, tools: true, tuning: true, widgets: true, stats: true, chats: true }
  const allOff = { eps: false, prompts: false, pls: false, cmds: false, skills: false, memory: false, keys: false, appearance: false, features: false, tools: false, tuning: false, widgets: false, stats: false, chats: false }
  const [exports, setExports] = useState<Record<Category, boolean>>({ ...allOn })
  const [fileData, setFileData] = useState<Record<string, any> | null>(null)
  const [imports, setImports] = useState<Record<Category, boolean>>({ ...allOff })
  const [available, setAvailable] = useState<Record<Category, boolean>>({ ...allOff })
  const [merge, setMerge] = useState(true)
  const [cf, setCf] = useState(0)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    const f = (e: Event) => {
      const j = (e as CustomEvent).detail
      if (!j || typeof j !== 'object') return
      try {
        const has = detectAvailableCategories(j, THEMES)
        setAvailable(has)
        setImports(Object.fromEntries(categories.map(([id]) => [id, (has as Record<string, boolean>)[id]])) as Record<Category, boolean>)
        setFileData(j)
        setMerge(true)
        setMsg('')
      } catch { setMsg('Import failed: that file is not a valid configuration export.') }
    }
    window.addEventListener('byok:import-backup', f)
    return () => window.removeEventListener('byok:import-backup', f)
  }, [])
  const exp = () => {
    const data = buildExportPayload(s as Parameters<typeof buildExportPayload>[0], exports, withKeys, normSkills, normSearch)
    dl('chat-config.json', JSON.stringify(data, null, 1), 'application/json')
  }
  const chooseFile = async (f?: File) => {
    if (!f) return
    try {
      const j = JSON.parse(await f.text())
      if (!j || typeof j !== 'object') throw 0
      const has = detectAvailableCategories(j, THEMES)
      setAvailable(has)
      setImports(Object.fromEntries(categories.map(([id]) => [id, has[id]])) as Record<Category, boolean>)
      setFileData(j)
      setMerge(true)
      setMsg('')
    } catch { setMsg('Import failed: that file is not a valid configuration export.') }
  }
  const imp = () => {
    if (!fileData) return
    try {
      const j = fileData
      const fix = (k: Kind) => (Array.isArray(j[k]) ? j[k] : []).filter((y: any) => y && typeof y.id === 'string').map((y: any) => ({ ...BLANK[k](), ...y }))
      const m = (k: Kind, a: any[]) => { const b = fix(k); return merge ? [...a.filter((x) => !b.some((y: any) => y.id === x.id)), ...b] : b }
      // Only known tool ids are accepted; hidden runtime capabilities (e.g. use_skill) are never stored.
      const toolIds = new Set(TOOLS.map(([name]) => name))
      const cleanBools = (v: unknown): Record<string, boolean> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, val]) => typeof val === 'boolean')) as Record<string, boolean> : {})
      const cleanTools = (v: unknown): Record<string, boolean> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k, val]) => toolIds.has(k) && typeof val === 'boolean')) as Record<string, boolean> : {})
      const cleanStrings = (v: unknown): Record<string, string> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, val]) => typeof val === 'string')) as Record<string, string> : {})
      const cleanFeatures = (v: unknown): Record<string, boolean> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k, val]) => k in DEFAULT_FEATURES && typeof val === 'boolean')) as Record<string, boolean> : {})
      useS.setState((st) => {
        const importedChats = Array.isArray(j.chats) ? j.chats.filter((c: any) => c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.msgs)) : []
        const importedFolders = Array.isArray(j.folders) ? j.folders.filter((f: any) => f && typeof f.id === 'string' && typeof f.name === 'string') : []
        const chats = !imports.chats ? st.chats : merge ? [...st.chats.filter((c) => !importedChats.some((x: any) => x.id === c.id)), ...importedChats] : importedChats
        const folders = !imports.chats ? st.folders : merge ? [...st.folders.filter((f) => !importedFolders.some((x: any) => x.id === f.id)), ...importedFolders] : importedFolders
        const validSel = j.sel && typeof j.sel === 'object' && (j.sel.k === 'ep' || j.sel.k === 'pl') && typeof j.sel.id === 'string'
          ? { k: j.sel.k, id: j.sel.id, ...(typeof j.sel.model === 'string' && j.sel.model ? { model: j.sel.model } : {}) } : null
        const validMemories = Array.isArray(j.memories) ? j.memories.filter((x: any) => x && typeof x.id === 'string' && typeof x.text === 'string').map((x: any) => ({ id: x.id, text: String(x.text).slice(0, 500), category: typeof x.category === 'string' ? x.category.slice(0, 60) || 'General' : 'General', createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(), updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : Date.now() })) : []
        const validTodos = Array.isArray(j.todos) ? j.todos.filter((x: any) => x && typeof x.id === 'string' && typeof x.t === 'string').map((x: any) => ({ id: x.id, t: String(x.t).slice(0, 500), done: x.done === true })) : []
        return {
        ...(imports.eps ? { eps: m('eps', st.eps).map((e: Ep) => ({ ...e, key: merge && !e.key ? st.eps.find((x) => x.id === e.id)?.key || '' : e.key })), ...(validSel ? { sel: validSel } : {}) } : {}),
        ...(imports.prompts ? { prompts: m('prompts', st.prompts), ...(typeof j.pr === 'string' ? { pr: j.pr } : {}), ...(j.globalPrompt && typeof j.globalPrompt === 'object' ? { globalPrompt: { on: j.globalPrompt.on === true, text: typeof j.globalPrompt.text === 'string' ? j.globalPrompt.text : '' } } : {}) } : {}),
        ...(imports.pls ? { pls: m('pls', st.pls) } : {}), ...(imports.cmds ? { cmds: m('cmds', st.cmds) } : {}),
        ...(imports.skills && Array.isArray(j.skills) ? { skills: normSkills(merge ? [...(st as any).skills ?? [], ...j.skills] : j.skills).skills } : {}),
        ...(imports.memory ? { ...(Array.isArray(j.memories) ? { memories: merge ? [...st.memories.filter((x) => !validMemories.some((y: any) => y.id === x.id)), ...validMemories] : validMemories } : {}), ...(j.memoryPrefs && typeof j.memoryPrefs === 'object' ? { memoryPrefs: { ...st.memoryPrefs, ...(merge ? {} : { enabled: false, intent: 'balanced', recall: 'contextual', method: 'local', classifierEp: '', classifierModel: '' }), ...Object.fromEntries(Object.entries(j.memoryPrefs).filter(([k]) => ['enabled', 'intent', 'recall', 'method', 'classifierEp', 'classifierModel'].includes(k))) } } : {}) } : {}),
        ...(imports.keys ? { keys: merge ? { ...st.keys, ...cleanStrings(j.keys) } : cleanStrings(j.keys) } : {}),
        ...(imports.appearance ? { ...(j.themeMode === 'dark' || j.themeMode === 'light' ? { themeMode: j.themeMode } : {}), ...(j.themeDark in THEMES ? { themeDark: j.themeDark } : {}), ...(j.themeLight in THEMES ? { themeLight: j.themeLight } : {}), ...(j.customDarkColors && typeof j.customDarkColors === 'object' ? { customDarkColors: merge ? { ...st.customDarkColors, ...j.customDarkColors } : j.customDarkColors } : {}), ...(j.customLightColors && typeof j.customLightColors === 'object' ? { customLightColors: merge ? { ...st.customLightColors, ...j.customLightColors } : j.customLightColors } : {}), ...(j.theme in THEMES ? themePatch(st, j.theme) : {}), ...(j.customColors && typeof j.customColors === 'object' ? { customDarkColors: merge ? { ...st.customDarkColors, ...j.customColors } : j.customColors } : {}), ...(j.prefs && typeof j.prefs === 'object' ? { prefs: merge ? { ...st.prefs, ...j.prefs } : { ...st.prefs, ...j.prefs } } : {}) } : {}),
        ...(imports.features ? { ...(j.features && typeof j.features === 'object' ? { features: merge ? { ...st.features, ...cleanFeatures(j.features) } : { ...DEFAULT_FEATURES, ...cleanFeatures(j.features) } } : {}), ...(j.libraryShow && typeof j.libraryShow === 'object' ? { libraryShow: merge ? { ...st.libraryShow, ...j.libraryShow } : j.libraryShow } : {}), ...(Array.isArray(j.featureOrder) ? { featureOrder: normFeatureOrder(merge ? [...st.featureOrder ?? [], ...j.featureOrder] : j.featureOrder) } : {}), ...(j.advanced && typeof j.advanced === 'object' ? { advanced: normAdvanced(merge ? { ...st.advanced, ...j.advanced } : j.advanced) } : {}) } : {}),
        ...(imports.tools ? { tools: merge ? { ...st.tools, ...cleanTools(j.tools) } : { ...st.tools, ...cleanTools(j.tools) }, ...(j.search && typeof j.search === 'object' ? (() => {
          const current = normSearch((st as any).search)
          const incoming = normSearch(j.search)
          const keys: Record<string, string> = {}
          for (const p of Object.keys(current.keys)) keys[p] = merge ? ((incoming.keys as Record<string, string>)[p] || current.keys[p as keyof typeof current.keys] || '') : ((incoming.keys as Record<string, string>)[p] || '')
          return { search: { ...incoming, keys } }
        })() : {}) } : {}),
        ...(imports.tuning ? { ...(j.params && typeof j.params === 'object' ? { params: { ...st.params, ...Object.fromEntries(Object.entries(j.params).filter(([k]) => ['def', 'temp', 'topp', 'max', 'maxToolRounds', 'highToolsUnlocked'].includes(k))) } } : {}), ...(j.effort && typeof j.effort === 'object' ? { effort: merge ? { ...st.effort, ...cleanStrings(j.effort) } : cleanStrings(j.effort) } : {}), ...(j.workspacePrefs && typeof j.workspacePrefs === 'object' ? { workspacePrefs: { ...st.workspacePrefs, ...Object.fromEntries(Object.entries(j.workspacePrefs).filter(([k]) => ['defaultView'].includes(k))) } } : {}), ...(j.docPrefs && typeof j.docPrefs === 'object' ? { docPrefs: normDocs(merge ? { ...st.docPrefs, ...j.docPrefs } : j.docPrefs) } : {}) } : {}),
        ...(imports.widgets ? { widgets: merge ? { ...st.widgets, ...cleanBools(j.widgets) } : cleanBools(j.widgets), widgetPrefs: j.widgetPrefs ? (merge ? { ...st.widgetPrefs, ...j.widgetPrefs } : { ...st.widgetPrefs, ...j.widgetPrefs }) : st.widgetPrefs } : {}),
        ...(imports.stats && j.stats && typeof j.stats === 'object' ? { stats: merge ? { ...st.stats, ...j.stats } : j.stats } : {}),
        ...(imports.stats && j.routeStats && typeof j.routeStats === 'object' && !Array.isArray(j.routeStats) ? { routeStats: merge ? { ...st.routeStats, ...j.routeStats } : j.routeStats } : {}),
        ...(imports.chats ? { chats, folders, chat: chats.some((c) => c.id === st.chat) ? st.chat : chats[0]?.id ?? '', ...(Array.isArray(j.todos) ? { todos: merge ? [...st.todos.filter((x) => !validTodos.some((y: any) => y.id === x.id)), ...validTodos] : validTodos } : {}), ...(Array.isArray(j.snips) ? { snips: merge ? [...st.snips, ...j.snips.filter((x: any) => typeof x === 'string')] : j.snips.filter((x: any) => typeof x === 'string') } : {}), ...(typeof j.pad === 'string' ? { pad: merge && st.pad ? st.pad : j.pad } : {}) } : {}),
      }})
      setFileData(null)
      setMsg(merge ? 'Imported the selected data and merged it with existing settings.' : 'Imported the selected data and replaced those settings.')
    } catch { setMsg('Import failed: that file is not a valid configuration export.') }
  }
  return (
    <Panel id="data">
      <SyncBox />
      <EncryptedBackupBox buildJson={() => JSON.stringify(buildExportPayload(s as Parameters<typeof buildExportPayload>[0], exports, withKeys, normSkills, normSearch), null, 1)} />
      <Box icon={Download} t="Export configuration" d="Choose which settings and chat history to include in a JSON backup.">
        <Btn v="soft" onClick={() => setCf(3)}>Export</Btn>
      </Box>
      <Box icon={Upload} t="Import configuration" d="Choose a JSON configuration file, then select what to import.">
        <label className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80">
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { chooseFile(e.target.files?.[0]); e.target.value = '' }} />Choose file
        </label>
        {msg && <span className="basis-full text-xs text-mu">{msg}</span>}
      </Box>
      <Box icon={FileText} t="Chat history" d="Include conversations in configuration exports, or delete them all. Stats are kept.">
        <Btn v="danger" disabled={!s.chats.length} onClick={() => setCf(1)}>Delete all</Btn>
      </Box>
      <StorageBox />
      <Box icon={Trash2} t="Erase everything" d="Removes all endpoints, keys, prompts, skills, memories, chats, stats and settings from this browser.">
        <Btn v="danger" onClick={() => setCf(2)}>Erase</Btn>
      </Box>
      {cf === 1 && <Confirm title="Delete all chats?" text="Every saved chat is removed. Stats and settings are kept." ok="Delete all" close={() => setCf(0)} run={() => s.patch({ chats: [], chat: '' })} />}
      {cf === 2 && <Confirm title="Erase everything?" text="Endpoints, API keys, prompts, playlists, commands, skills, memories, chats, stats and all other settings are removed from this browser. This cannot be undone." ok="Erase" close={() => setCf(0)} run={() => { localStorage.removeItem('byok.v1'); location.reload() }} />}
      {cf === 3 && <Modal close={() => setCf(0)}><section role="dialog" aria-modal="true" aria-labelledby="export-title" className="w-full max-w-xl space-y-5 rounded-2xl border border-hov bg-bg p-5 shadow-2xl">
        <div><h2 id="export-title" className="text-lg font-semibold">Export configuration</h2><p className="mt-1 text-sm text-mu">Choose the settings to include in this file.</p></div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surf p-3 sm:grid-cols-3">{categories.map(([id, label]) => <Checkbox key={id} checked={exports[id]} set={(checked) => setExports({ ...exports, [id]: checked })} label={label} />)}</div>
        {exports.eps && <div className="rounded-xl bg-surf p-3"><Checkbox checked={withKeys} set={setWithKeys} label="Include API keys" /></div>}
        <div className="flex justify-end gap-2"><Btn v="soft" onClick={() => setCf(0)}>Cancel</Btn><Btn v="solid" icon={Download} onClick={() => { exp(); setCf(0) }}>Export</Btn></div>
      </section></Modal>}
      {fileData && <Modal close={() => setFileData(null)}><section role="dialog" aria-modal="true" aria-labelledby="import-title" className="w-full max-w-xl space-y-5 rounded-2xl border border-hov bg-bg p-5 shadow-2xl">
        <div><h2 id="import-title" className="text-lg font-semibold">Import configuration</h2><p className="mt-1 text-sm text-mu">Choose the parts of this file to import. Sections not included in the file are unavailable.</p></div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surf p-3 sm:grid-cols-3">{categories.map(([id, label]) => <Checkbox key={id} checked={imports[id]} disabled={!available[id]} set={(checked) => setImports({ ...imports, [id]: checked })} label={label} />)}</div>
        <div className="rounded-xl bg-surf p-3"><Checkbox checked={merge} set={setMerge} label="Merge with existing data" /></div>
        <div className="flex justify-end gap-2"><Btn v="soft" onClick={() => setFileData(null)}>Cancel</Btn><Btn v="solid" icon={Upload} onClick={imp} disabled={!Object.values(imports).some(Boolean)}>Import</Btn></div>
      </section></Modal>}
    </Panel>
  )
}
