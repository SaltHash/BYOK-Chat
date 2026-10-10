import { useEffect, useState, type ReactNode } from 'react'
import { Info, X, Server, Play, MessageSquare, Keyboard, ArrowUp, ArrowDown, MessagesSquare, RotateCcw, Download, Upload, FileText, Trash2, CircleCheck, CircleX, Gauge } from 'lucide-react'
import { useS, dl, chatMd, BLANK, THEMES, modelsOf, modelNameOf, type Ep, type Kind } from '../store'
import { combo, fmt, rec as R, testEp, redact } from '../engine'
import { KEYS } from '../meta'
import { Btn, Toggle, Confirm, cx, type Ic } from './ui'
import { Panel } from './Settings'

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
        setR((rows) => rows.map((r) => r.model === model ? { ...r, s: 'err', t: redact(e, x.message) } : r))
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
        setRows((items) => items.map((row) => row.key === key ? { ...row, s: 'err', t: redact(e, x?.message ?? x) } : row))
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
  <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surf p-3">
    <span className="grid size-9 place-items-center rounded-lg bg-hov text-ac"><I size={18} /></span>
    <div className="min-w-48 flex-1"><div className="text-sm font-medium">{t}</div><div className="text-xs text-mu">{d}</div></div>
    {children}
  </div>
)

export function StatsTab() {
  const s = useS(), t = s.stats
  const [cf, setCf] = useState(false)
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
  const { keys, patch } = useS()
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

export function DataTab() {
  const s = useS()
  const [withKeys, setWithKeys] = useState(false)
  const [imports, setImports] = useState({ eps: true, prompts: true, pls: true, cmds: true, keys: true, appearance: true, tools: true, widgets: true, stats: true })
  const [cf, setCf] = useState(0)
  const [msg, setMsg] = useState('')
  const exp = () => dl('chat-config.json', JSON.stringify({ v: 3, theme: s.theme, keys: s.keys, eps: s.eps.map((e) => ({ ...e, key: withKeys ? e.key : '' })), prompts: s.prompts, pls: s.pls, cmds: s.cmds, tools: s.tools, widgets: s.widgets, widgetPrefs: s.widgetPrefs, stats: s.stats }, null, 1), 'application/json')
  const imp = async (f?: File) => {
    if (!f) return
    try {
      const j = JSON.parse(await f.text())
      if (!j || typeof j !== 'object') throw 0
      const fix = (k: Kind) => (Array.isArray(j[k]) ? j[k] : []).filter((y: any) => y && typeof y.id === 'string').map((y: any) => ({ ...BLANK[k](), ...y }))
      const m = (k: Kind, a: any[]) => { const b = fix(k); return [...a.filter((x) => !b.some((y: any) => y.id === x.id)), ...b] }
      useS.setState((st) => ({
        ...(imports.eps ? { eps: m('eps', st.eps).map((e: Ep) => ({ ...e, key: e.key || st.eps.find((x) => x.id === e.id)?.key || '' })) } : {}),
        ...(imports.prompts ? { prompts: m('prompts', st.prompts) } : {}), ...(imports.pls ? { pls: m('pls', st.pls) } : {}), ...(imports.cmds ? { cmds: m('cmds', st.cmds) } : {}),
        ...(imports.keys ? { keys: { ...st.keys, ...(j.keys && typeof j.keys === 'object' ? j.keys : {}) } } : {}),
        ...(imports.appearance && j.theme in THEMES ? { theme: j.theme } : {}),
        ...(imports.tools ? { tools: { ...st.tools, ...(j.tools && typeof j.tools === 'object' ? j.tools : {}) } } : {}),
        ...(imports.widgets ? { widgets: { ...st.widgets, ...(j.widgets && typeof j.widgets === 'object' ? j.widgets : {}) }, widgetPrefs: { ...st.widgetPrefs, ...(j.widgetPrefs && typeof j.widgetPrefs === 'object' ? j.widgetPrefs : {}) } } : {}),
        ...(imports.stats && j.stats && typeof j.stats === 'object' ? { stats: { ...st.stats, ...j.stats } } : {}),
      }))
      setMsg('Imported the selected data. Existing keys were kept when the file did not include one.')
    } catch { setMsg('Import failed: that file is not a valid configuration export.') }
  }
  return (
    <Panel id="data">
      <Box icon={Download} t="Export configuration" d="Setup, widget preferences, shortcuts, appearance and usage stats as JSON.">
        <label className="flex items-center gap-2 text-xs text-mu">Include keys<Toggle on={withKeys} set={setWithKeys} /></label>
        <Btn v="soft" onClick={exp}>Export</Btn>
      </Box>
      <Box icon={Upload} t="Import configuration" d="Choose which parts of the file to apply. Items with a matching id are replaced.">
        <div className="basis-full grid grid-cols-2 gap-2 rounded-lg bg-bg p-3 sm:grid-cols-3">{([['eps', 'Endpoints'], ['prompts', 'Prompts'], ['pls', 'Playlists'], ['cmds', 'Commands'], ['keys', 'Shortcuts'], ['appearance', 'Appearance'], ['tools', 'Tools'], ['widgets', 'Widget settings'], ['stats', 'Usage stats']] as const).map(([id, label]) => <label key={id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={imports[id]} onChange={(e) => setImports({ ...imports, [id]: e.target.checked })} />{label}</label>)}</div>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80">
          <input type="file" accept=".json" hidden onChange={(e) => { imp(e.target.files?.[0]); e.target.value = '' }} />Choose file
        </label>
        {msg && <span className="basis-full text-xs text-mu">{msg}</span>}
      </Box>
      <Box icon={FileText} t="Chat history" d="Export every chat as one Markdown file, or delete them all. Stats are kept.">
        <Btn v="soft" onClick={() => s.chats.length ? dl('chats.md', s.chats.map(chatMd).join('\n\n\n'), 'text/markdown') : setMsg('There are no chats to export.')}>Export</Btn>
        <Btn v="danger" disabled={!s.chats.length} onClick={() => setCf(1)}>Delete all</Btn>
      </Box>
      <Box icon={Trash2} t="Erase everything" d="Removes endpoints, keys, chats, stats and shortcuts from this browser.">
        <Btn v="danger" onClick={() => setCf(2)}>Erase</Btn>
      </Box>
      {cf === 1 && <Confirm title="Delete all chats?" text="Every saved chat is removed. Stats and settings are kept." ok="Delete all" close={() => setCf(0)} run={() => s.patch({ chats: [], chat: '' })} />}
      {cf === 2 && <Confirm title="Erase everything?" text="Endpoints, API keys, prompts, playlists, commands, chats, stats and shortcuts are removed from this browser. This cannot be undone." ok="Erase" close={() => setCf(0)} run={() => { localStorage.removeItem('byok.v1'); location.reload() }} />}
    </Panel>
  )
}
