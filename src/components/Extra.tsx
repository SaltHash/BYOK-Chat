import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Info, X, Server, Play, MessageSquare, Keyboard, ArrowUp, ArrowDown, MessagesSquare, RotateCcw, Download, Upload, FileText, Trash2, CircleCheck, CircleX, Gauge, ShieldCheck, DatabaseBackup, GitMerge, CalendarDays, RefreshCw, ArchiveRestore } from 'lucide-react'
import { useS, dl, BLANK, THEMES, themePatch, DEFAULT_FEATURES, DEFAULT_PREFS, DEFAULT_PARAMS, DEFAULT_WIDGET_PREFS, DEFAULT_CUSTOM_DARK_THEME, DEFAULT_CUSTOM_LIGHT_THEME, normCustomTheme, modelsOf, modelNameOf, normSearch, normAdvanced, normFeatureOrder, normDocs, featOn, errText, storageUsage, QUOTA_FLAG, type Ep, type Kind, type FeatureId } from '../store'
import { normSkills } from '../skills'
import { normMcpServers } from '../mcp'
import { normImageGen } from '../imagegen'
import { normCodeRun } from '../codesandbox'
import { normVoice } from '../voice'
import { normGlobalPrompt } from '../flair'
import { combo, fmt, rec as R, testEp } from '../engine'
import { probeProviderCors, resolveProvider } from '../providerAdapter'
import { KEYS, TOOLS, DEFAULT_TOOLS } from '../meta'
import { Btn, Toggle, Checkbox, Confirm, Modal, Surface, Input, cx, type Ic } from './ui'
import { Panel, Anchor, Section } from './Settings'
import { detectAvailableCategories, buildExportPayload, chatsInDateRange } from '../configIO'
import { getAutoBackup, setAutoBackup, runLocalBackup, listLocalBackups, readLocalBackup, deleteLocalBackup, getLastBackup, type BackupMeta } from '../storage/localBackup'
import { readSyncConflicts, dismissSyncConflict, clearSyncConflicts, conflictChat, type SyncConflict } from '../storage/syncConflicts'
import { encryptBackup, decryptBackup, isEncryptedBackup } from '../storage/backupCrypto'
import { SyncBox } from './SyncBox'
import { DEVICE_SYNC_ENABLED } from '../storage/syncRuntime'

export function Notice({ cfg }: { cfg: (t: string) => void }) {
  const n = useS((s) => s.notice), patch = useS((s) => s.patch)
  if (!n) return null
  return (
    <div className="mb-2 flex flex-wrap items-start gap-2 rounded-xl bg-surf p-3 text-sm max-sm:flex-col">
      <Info size={18} className="mt-0.5 shrink-0 text-ac" />
      <p className="min-w-0 flex-1 break-words leading-6">{n.t}</p>
      {n.href && <a href={n.href} target="_blank" rel="noreferrer" className="inline-flex h-9 shrink-0 items-center rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80">{n.label ?? 'Open link'}</a>}
      {n.tab && <Btn v="soft" onClick={() => { patch({ notice: null }); cfg(n.tab!) }}>{n.label ?? 'Open settings'}</Btn>}
      <Btn sm icon={X} title="Dismiss" onClick={() => patch({ notice: null })} />
    </div>
  )
}

export function Tutorial({ cfg }: { cfg: (t: string) => void }) {
  const { eps, add } = useS(useShallow((s) => ({ eps: s.eps, add: s.add })))
  const steps: [Ic, string, string][] = [
    [Server, 'Add an endpoint', 'Pick a provider preset or enter any base URL, then paste your API key and the model id. Keys are stored in this browser and only sent to the providers you choose (or relayed through this app’s own server when a provider blocks browser requests).'],
    [Play, 'Test it', 'Press Test connection on the endpoint. You will see whether it answers and how long it takes.'],
    [MessageSquare, 'Send a message', 'Type below and press Enter. Type / for commands and @ for tools.'],
  ]
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col justify-center gap-6 px-4 py-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Connect a model to begin</h2>
        <p className="text-sm text-mu">{eps.length ? 'Your endpoints are disabled or incomplete. Each one must be enabled and have a base URL and a model id.' : 'No models are built in. Bring your own endpoint and key.'}</p>
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
        <Btn v="solid" icon={Server} onClick={() => { if (!eps.length) add('eps'); cfg('eps') }}>{eps.length ? 'Open endpoints' : 'Add an endpoint'}</Btn>
        <Btn v="soft" icon={Keyboard} onClick={() => cfg('keys')}>Keyboard shortcuts</Btn>
      </div>
      <p className="text-xs text-mu">Later: playlists try several models in order, commands (/) wrap a prompt around an input, and tools (@) stay off until you allow them.</p>
    </div>
  )
}

export function TestRow({ e }: { e: Ep }) {
  const [r, setR] = useState<{ s: 'run' | 'ok' | 'err'; t: string; model: string }[]>([])
  const [cors, setCors] = useState<{ s: 'run' | 'ok' | 'err'; t: string } | null>(null)
  const provider = resolveProvider({ preset: e.preset, url: e.url })
  const checkCors = async () => {
    if (!provider || cors?.s === 'run') return
    setCors({ s: 'run', t: `Checking browser access to ${provider.name}…` })
    const result = await probeProviderCors(provider, e)
    setCors({
      s: result.ok ? 'ok' : 'err',
      t: result.ok
        ? `${provider.name} allows this origin (HTTP ${result.status}${result.allowOrigin ? `, Access-Control-Allow-Origin: ${result.allowOrigin}` : ''}).`
        : `${result.error ?? `${provider.name} failed its CORS preflight.`} Requests will be relayed through this app's server (Settings → Endpoints → Request routing).`,
    })
  }
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
      <div className="flex flex-wrap items-center gap-2">
        <Btn v="soft" icon={Play} disabled={r.some((x) => x.s === 'run')} onClick={run}>Test all model connections</Btn>
        {provider && <Btn v="soft" icon={ShieldCheck} disabled={cors?.s === 'run'} onClick={() => void checkCors()}>Check browser access (CORS)</Btn>}
      </div>
      {cors && <div className={cx('flex items-start gap-2 text-sm', cors.s === 'err' ? 'text-er' : cors.s === 'ok' ? 'text-ac' : 'text-mu')}>
        {cors.s === 'err' ? <CircleX size={14} className="mt-0.5 shrink-0" /> : cors.s === 'ok' ? <CircleCheck size={14} className="mt-0.5 shrink-0" /> : null}
        <span>{cors.t}</span>
      </div>}
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
  const { stats: t, features } = useS(useShallow((s) => ({ stats: s.stats, features: s.features })))
  const [cf, setCf] = useState(false)
  if (!featOn({ features }, 'stats')) return null
  const card = (I: Ic, l: string, v: number, d: string) => (
    <div className="rounded-xl bg-surf p-4">
      <div className="flex items-center gap-2 text-sm text-mu"><I size={16} className="text-ac" />{l}</div>
      <div className="mt-2 text-2xl font-semibold">{v.toLocaleString()}</div>
      <div className="text-xs text-mu">{d}</div>
    </div>
  )
  return (
    <Panel id="stats">
      <Section title="Totals" desc="All-time counters. They are not affected by deleting chats.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Anchor id="tokens-sent">{card(ArrowUp, 'Tokens sent', t.tin, `${t.explicitIn.toLocaleString()} explicitly sent · ${t.historyIn.toLocaleString()} history + tool calls`)}</Anchor>
        <Anchor id="tokens-generated">{card(ArrowDown, 'Tokens generated', t.tout, 'Reply tokens, including partial replies')}</Anchor>
        <Anchor id="messages-sent">{card(MessageSquare, 'Messages sent', t.sent, 'Includes edited and resent messages')}</Anchor>
        <Anchor id="chats-started">{card(MessagesSquare, 'Chats started', t.chats, 'A chat counts when its first message is sent')}</Anchor>
      </div>
      <p className="text-xs text-mu">Total {(t.tin + t.tout).toLocaleString()} tokens since {new Date(t.since).toLocaleDateString()}. Totals are all-time and are not affected by deleting chats. They use token counts reported by the provider when available, and a rough 4-characters-per-token estimate otherwise.</p>
      <p className="text-xs text-mu">Tokens sent are split into what you wrote (explicitly sent) and everything that travelled with it: the system prompt, the chat history, and any tool calls and their results (history + tool calls).</p>
      </Section>
      <Section title="Reset" desc="Start the counters over.">
      <Anchor id="reset-stats"><Btn v="danger" icon={RotateCcw} onClick={() => setCf(true)}>Reset stats</Btn></Anchor>
      </Section>
      {cf && <Confirm title="Reset all stats?" text="Tokens, messages and chats-started totals go back to zero. Your chats and settings are not affected." ok="Reset" close={() => setCf(false)} run={() => useS.getState().resetStats()} />}
    </Panel>
  )
}

export function KeysTab() {
  const { keys, features, patch } = useS(useShallow((s) => ({ keys: s.keys, features: s.features, patch: s.patch })))
  const off = !featOn({ features }, 'shortcuts')
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
      <Section title="Shortcuts" desc="Press Change, then the keys you want. Shortcuts need Ctrl/Cmd or Alt.">
      <div className="space-y-2">
        {KEYS.map(([id, label, def]) => {
          const cur = keys[id] ?? def
          return (
            <Anchor key={id} id={`key-${id}`}>
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surf p-3">
              <span className="min-w-40 flex-1 text-sm">{label}</span>
              {rec === id ? <span className="text-sm text-ac">Press the new keys…</span>
                : <span className="flex gap-1">{cur.split('+').map((k, i) => <kbd key={i} className="rounded-md bg-hov px-1.5 py-0.5 text-xs font-medium">{fmt(k)}</kbd>)}</span>}
              <Btn v="soft" onClick={() => { setErr(''); setRec(rec === id ? '' : id) }}>{rec === id ? 'Cancel' : 'Change'}</Btn>
              <Btn sm icon={RotateCcw} title="Reset to default" disabled={cur === def} onClick={() => patch({ keys: { ...keys, [id]: def } })} />
            </div>
            </Anchor>
          )
        })}
      </div>
      {err && <p className="text-sm text-er">{err}</p>}
      <div className="flex items-center gap-3">
        <Anchor id="reset-all-keys"><Btn v="soft" icon={RotateCcw} onClick={() => patch({ keys: Object.fromEntries(KEYS.map(([k, , d]) => [k, d])) })}>Reset all</Btn></Anchor>
        <span className="text-xs text-mu">Press Escape while recording to cancel. Some browser shortcuts, such as opening a new tab, cannot be overridden.</span>
      </div>
      </Section>
    </Panel>
  )
}

function StorageBox() {
  const compactStorage = useS((s) => s.compactStorage)
  const [info, setInfo] = useState<{ localBytes: number; quota?: number; usage?: number } | null>(null)
  const [durable, setDurable] = useState<{ localBytes: number; durableBytes: number; opfs: boolean; backend: string } | null>(null)
  const [quotaFull, setQuotaFull] = useState(false)
  const [note, setNote] = useState('')
  const refresh = useCallback(() => {
    void storageUsage().then(setInfo)
    void import('../storage/durable').then(({ durableUsage }) => durableUsage().then(setDurable).catch(() => {}))
    try { setQuotaFull(localStorage.getItem(QUOTA_FLAG) != null) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    // Mount-only measurement plus a background compaction timer. Neither
    // depends on the chat list: compaction reads the live store when it fires,
    // so a streamed reply must not tear down and rebuild the interval.
    let live = true
    void storageUsage().then((v) => { if (live) setInfo(v) })
    void import('../storage/durable').then(({ durableUsage }) => durableUsage().then((v) => { if (live) setDurable(v) }).catch(() => {}))
    try { setQuotaFull(localStorage.getItem(QUOTA_FLAG) != null) } catch { /* ignore */ }
    // Background compaction every 5 min: prune durable + clear quota flag.
    const timer = setInterval(() => {
      void import('../storage/boot').then(({ compactDurable }) => compactDurable(useS.getState().chats as never).catch(() => null))
    }, 300_000)
    return () => { live = false; clearInterval(timer) }
  }, [])
  const kb = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`
  const desc = info ? `Settings ~${kb(info.localBytes)}${durable ? ` · durable chats/workspaces ~${kb(durable.durableBytes)} (${durable.backend}${durable.opfs ? '+OPFS' : ''})` : ''}.` : 'Measure how much app data this browser holds.'
  return (
    <Box icon={Gauge} t="Browser storage" d={desc}>
      <Btn v="soft" onClick={refresh}>Refresh</Btn>
      <Btn v="soft" onClick={() => { setNote(compactStorage()); refresh() }}>Compact</Btn>
      <Btn v="soft" onClick={() => {
        void import('../storage/boot').then(({ compactDurable }) => compactDurable(useS.getState().chats as never).then((r) => setNote(`Durable compaction: ${(r.freedChars / 1024).toFixed(1)} KB freed${r.droppedChats ? `, ${r.droppedChats} expired chats removed` : ''}.`)).catch(() => setNote('Durable compaction failed.')))
      }}>Compact durable</Btn>
      {quotaFull && <span className="basis-full text-xs text-er">The last save did not fit: settings were kept and bulky history was compacted automatically. Use Compact or delete old chats to free space.</span>}
      {note && <span className="basis-full text-xs text-mu">{note}</span>}
      <LargestChats kb={kb} />
    </Box>
  )
}

/** Per-chat storage breakdown: the five heaviest chats by serialized size,
 *  so a space emergency can be fixed chat by chat instead of by compaction. */
function LargestChats({ kb }: { kb: (n: number) => string }) {
  const chats = useS((s) => s.chats)
  const [show, setShow] = useState(false)
  const sizes = useCallback(() => {
    const out: { id: string; title: string; chars: number }[] = []
    for (const c of useS.getState().chats) {
      let chars = 0
      try { chars = JSON.stringify(c.msgs ?? []).length } catch { /* unserializable attachments: skip counting this chat */ continue }
      out.push({ id: c.id, title: c.title || 'Untitled chat', chars })
    }
    return out.sort((a, b) => b.chars - a.chars).slice(0, 5)
  }, [])
  const [top, setTop] = useState(sizes)
  const del = (id: string) => {
    const st = useS.getState()
    const remaining = st.chats.filter((c) => c.id !== id)
    st.patch({ chats: remaining, chat: st.chat === id ? remaining[0]?.id ?? '' : st.chat })
    setTop(sizes())
  }
  return (
    <div className="basis-full">
      <button onClick={() => { if (!show) setTop(sizes()); setShow((v) => !v) }} aria-expanded={show} className="text-xs font-medium text-mu hover:text-tx">
        {show ? 'Hide largest chats' : 'Largest chats'}
      </button>
      {show && (
        <div className="mt-1.5 space-y-1">
          {top.length ? top.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-bg px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate text-tx" title={c.title}>{c.title}</span>
              <span className="shrink-0 text-mu">~{kb(c.chars)}</span>
              <button onClick={() => del(c.id)} title="Delete this chat" aria-label={`Delete ${c.title}`} className="grid size-5 shrink-0 place-items-center rounded-sm text-mu hover:text-er"><Trash2 size={12} /></button>
            </div>
          )) : <span className="text-xs text-mu">No chats stored.</span>}
        </div>
      )}
    </div>
  )
}

/* ---- local backups ---- */
function LocalBackups({ onRestore }: { onRestore: (j: Record<string, any>) => void }) {
  const [auto, setAuto] = useState(getAutoBackup)
  const [items, setItems] = useState<BackupMeta[]>([])
  const [last, setLast] = useState(getLastBackup)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(() => {
    void listLocalBackups().then((v) => setItems(v)).catch(() => setItems([]))
    setLast(getLastBackup())
  }, [])
  useEffect(() => { refresh() }, [refresh])
  const kb = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`
  const make = async () => {
    setBusy(true); setNote('')
    const r = await runLocalBackup(true)
    setBusy(false)
    setNote(r.ok ? `Backed up ${new Date(r.meta!.at).toLocaleString()}.` : `Backup failed: ${r.error ?? 'unknown error'}`)
    refresh()
  }
  const restore = async (id: string) => {
    setNote('')
    const raw = await readLocalBackup(id)
    if (!raw) { setNote('That local backup could not be read.'); return }
    try { onRestore(JSON.parse(raw)) } catch { setNote('That local backup is not valid JSON.') }
  }
  const download = async (id: string) => {
    const raw = await readLocalBackup(id)
    if (!raw) return
    dl(`chat-backup-${new Date(Number(id.split('-').pop()) || Date.now()).toISOString().slice(0, 10)}.json`, raw, 'application/json')
  }
  return (
    <div className="space-y-3 rounded-xl bg-surf p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium"><DatabaseBackup size={16} className="text-ac" />Local backups <span className="text-xs font-normal text-mu">on this device only{last ? ` · last ${new Date(last).toLocaleString()}` : ''}</span></div>
      <p className="text-xs text-mu">A rolling snapshot of settings, prompts, projects and chats, written to this browser&rsquo;s IndexedDB. No API keys and no uploaded file bytes are included, and nothing is sent to a remote server. Automatic backups run at most once a day while the app is open.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox checked={auto} set={(v) => { setAuto(v); setAutoBackup(v) }} label="Daily automatic backup" />
        <Btn v="solid" icon={DatabaseBackup} disabled={busy} onClick={() => void make()}>{busy ? 'Backing up…' : 'Back up now'}</Btn>
        <Btn v="soft" icon={RefreshCw} onClick={refresh}>Refresh</Btn>
      </div>
      {note && <p className="text-xs text-mu">{note}</p>}
      {items.length ? (
        <div className="space-y-1.5">
          {items.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg px-2.5 py-2 text-xs">
              <CalendarDays size={13} className="shrink-0 text-ac" />
              <span className="min-w-0 flex-1 truncate">{new Date(b.at).toLocaleString()} <span className="text-mu">· {kb(b.bytes)}</span></span>
              <button type="button" onClick={() => void restore(b.id)} title="Load this backup into the import dialog" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-mu hover:bg-hov hover:text-tx"><ArchiveRestore size={13} />Restore</button>
              <button type="button" onClick={() => void download(b.id)} title="Download this backup" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-mu hover:bg-hov hover:text-tx"><Download size={13} />Download</button>
              <button type="button" onClick={() => { void deleteLocalBackup(b.id).then(refresh) }} title="Delete this backup" className="grid size-6 place-items-center rounded-md text-mu hover:bg-hov hover:text-er"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-mu">No local backups yet. Turn on daily backups or press Back up now.</p>}
    </div>
  )
}

/* ---- visible sync conflicts ---- */
function ConflictsBox() {
  const [items, setItems] = useState<SyncConflict[]>(readSyncConflicts)
  const [note, setNote] = useState('')
  const refresh = () => setItems(readSyncConflicts())
  const restore = (c: SyncConflict, side: 'local' | 'remote') => {
    const chat = conflictChat(c, side)
    if (!chat) { setNote('That side of the conflict could not be restored.'); return }
    const st = useS.getState()
    const exists = st.chats.some((x) => x.id === (chat as { id: string }).id)
    const chats = exists ? st.chats.map((x) => (x.id === (chat as { id: string }).id ? chat as never : x)) : [chat as never, ...st.chats]
    st.patch({ chats, chat: (chat as { id: string }).id })
    setItems(dismissSyncConflict(c.id))
    setNote(`Restored the ${side} version of “${c.title}”.`)
  }
  if (!items.length) return null
  return (
    <div className="space-y-2 rounded-xl border border-er/30 bg-er/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium"><GitMerge size={16} className="text-er" />Sync conflicts <span className="text-xs font-normal text-mu">{items.length}</span></div>
      <p className="text-xs text-mu">Both devices added different messages to these chats. The merge kept the richer copy; restore whichever side you meant to keep. This replaces that chat locally and the choice syncs on the next push.</p>
      {items.map((c) => (
        <div key={c.id} className="space-y-2 rounded-lg bg-bg p-2.5 text-xs">
          <div className="font-medium">{c.title}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['local', 'remote'] as const).map((side) => (
              <div key={side} className="space-y-1 rounded-md bg-surf p-2">
                <div className="flex items-center justify-between gap-2"><span className="font-medium capitalize">{side === 'local' ? 'This device' : 'Other device'}</span><span className="text-mu">{c[side].msgs} messages</span></div>
                <p className="line-clamp-3 text-mu">{c[side].last || 'No visible text'}</p>
                <button type="button" onClick={() => restore(c, side)} className="rounded-md bg-hov px-2 py-1 font-medium hover:bg-ac hover:text-acx">Restore this side</button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {note && <p className="text-xs text-mu">{note}</p>}
      <div className="flex gap-2"><button type="button" onClick={() => { clearSyncConflicts(); refresh() }} className="text-xs text-mu hover:text-tx">Dismiss all</button></div>
    </div>
  )
}

export function DataTab() {
  /* The export payload needs the whole store, but only at click time: this
     reads it from the live state instead of subscribing to it, so the tab only
     re-renders when the feature switches or the chat count change. */
  const { features, chatCount, patch } = useS(useShallow((s) => ({ features: s.features, chatCount: s.chats.length, patch: s.patch })))
  const [withKeys, setWithKeys] = useState(false)
  const catFeature: Record<string, FeatureId> = { prompts: 'prompts', pls: 'playlists', cmds: 'commands', skills: 'skills', memory: 'memory', keys: 'shortcuts', tools: 'tools', widgets: 'widgets', stats: 'stats' }
  const categories = ([['eps', 'Endpoints'], ['prompts', 'Prompts'], ['pls', 'Playlists'], ['cmds', 'Commands'], ['skills', 'Skills'], ['memory', 'Memory'], ['keys', 'Shortcuts'], ['appearance', 'Appearance'], ['features', 'Features'], ['tools', 'Tools'], ['tuning', 'Model tuning'], ['widgets', 'Widget settings'], ['stats', 'Usage stats'], ['chats', 'Chat history']] as [string, string][]).filter(([id]) => !catFeature[id] || featOn({ features }, catFeature[id])) as unknown as [['eps', 'Endpoints'], ['prompts', 'Prompts'], ['pls', 'Playlists'], ['cmds', 'Commands'], ['skills', 'Skills'], ['memory', 'Memory'], ['keys', 'Shortcuts'], ['appearance', 'Appearance'], ['features', 'Features'], ['tools', 'Tools'], ['tuning', 'Model tuning'], ['widgets', 'Widget settings'], ['stats', 'Usage stats'], ['chats', 'Chat history']]
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
  // Export password: empty exports plain JSON, non-empty encrypts the file.
  const [expPw, setExpPw] = useState('')
  const [expMsg, setExpMsg] = useState('')
  // Optional active-date window for chat history exports.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // A chosen file that is password-encrypted, awaiting its password before it
  // can be parsed and offered for import.
  const [pendingEnc, setPendingEnc] = useState<{ text: string } | null>(null)
  const [impPw, setImpPw] = useState('')
  const [impErr, setImpErr] = useState('')
  useEffect(() => {
    const f = (e: Event) => {
      const j = (e as CustomEvent).detail
      if (!j || typeof j !== 'object') return
      try {
        // Read live features: the listener is mounted once, so a render-time
        // category list can be stale after a feature toggle.
        const live = useS.getState().features
        const has = detectAvailableCategories(j, THEMES)
        setAvailable(has)
        setImports(Object.fromEntries((Object.keys(allOn) as Category[]).map((id) => [id, (!catFeature[id] || featOn({ features: live }, catFeature[id])) && (has as Record<string, boolean>)[id]]) ) as Record<Category, boolean>)
        setFileData(j)
        setMerge(true)
        setMsg('')
      } catch { setMsg('Import failed: that file is not a valid data export.') }
    }
    window.addEventListener('byok:import-backup', f)
    return () => window.removeEventListener('byok:import-backup', f)
  }, [])
  const exp = async () => {
    const live = useS.getState()
    const chats = exports.chats ? chatsInDateRange(live.chats, fromDate || undefined, toDate || undefined) : live.chats
    const data = buildExportPayload({ ...(live as unknown as Parameters<typeof buildExportPayload>[0]), chats }, exports, withKeys, normSkills, normSearch)
    const json = JSON.stringify(data, null, 1)
    if (!expPw) { dl('chat-config.json', json, 'application/json'); return }
    setExpMsg('Encrypting…')
    try {
      const enc = await encryptBackup(json, expPw)
      dl('chat-config.encrypted.json', enc, 'application/json')
      setExpMsg('Exported an encrypted data file. Import it with the same password.')
    } catch (e) { setExpMsg(`Export failed: ${(e as Error).message}`) }
  }
  const loadParsed = (j: Record<string, any>) => {
    const has = detectAvailableCategories(j, THEMES)
    setAvailable(has)
    setImports(Object.fromEntries(categories.map(([id]) => [id, has[id]])) as Record<Category, boolean>)
    setFileData(j)
    setMerge(true)
    setMsg('')
  }
  /* Restoring a local snapshot opens the same review dialog as importing a
   * file, but defaults to Replace so it actually rolls back instead of merging
   * today's data into yesterday's copy. */
  const restoreParsed = (j: Record<string, any>) => {
    loadParsed(j)
    setMerge(false)
  }
  const chooseFile = async (f?: File) => {
    if (!f) return
    // A data export is a few hundred KB at most. Refuse giant files
    // up front instead of freezing the tab on a multi-megabyte JSON.parse.
    if (f.size > 5 * 1024 * 1024) { setMsg('Import failed: that file is over 5 MB and is not a data export.'); return }
    try {
      const text = await f.text()
      // An encrypted file cannot be parsed until its password is supplied.
      if (isEncryptedBackup(text)) { setPendingEnc({ text }); setImpPw(''); setImpErr(''); return }
      const j = JSON.parse(text)
      if (!j || typeof j !== 'object') throw 0
      loadParsed(j)
    } catch { setMsg('Import failed: that file is not a valid data export.') }
  }
  const decryptAndLoad = async () => {
    if (!pendingEnc) return
    try {
      const j = JSON.parse(await decryptBackup(pendingEnc.text, impPw))
      if (!j || typeof j !== 'object') throw 0
      setPendingEnc(null); setImpPw(''); setImpErr('')
      loadParsed(j)
    } catch (e) { setImpErr((e as Error).message) }
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
      const cleanFeatures = (v: unknown): Record<string, boolean> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k, val]) => Object.hasOwn(DEFAULT_FEATURES, k) && typeof val === 'boolean')) as Record<string, boolean> : {})
      // Widget settings are spread into state: accept only known keys with the
      // right primitive types, and only shortcut ids that actually exist.
      const cleanWidgetPrefs = (v: unknown): Record<string, any> => {
        if (!v || typeof v !== 'object') return {}
        const w = v as Record<string, unknown>
        const out: Record<string, any> = {}
        for (const k of ['usageGroup', 'usageMode', 'usageFormat', 'usagePeriod', 'timeUnit', 'usageFrom', 'usageTo']) if (typeof w[k] === 'string') out[k] = w[k]
        for (const k of ['usageTotal', 'lastSpeed', 'showDisabledEndpoints', 'activePromptsOnly', 'hideDoneTodos']) if (typeof w[k] === 'boolean') out[k] = w[k]
        for (const k of ['contextLimit', 'scratchRows', 'snippetLimit', 'costDecimals', 'charsPerToken']) if (Number.isFinite(Number(w[k]))) out[k] = Number(w[k])
        for (const k of ['widgetOrder', 'shortcuts']) if (Array.isArray(w[k])) out[k] = (w[k] as unknown[]).filter((x): x is string => typeof x === 'string' && (k !== 'shortcuts' || KEYS.some(([id]) => id === x)))
        return out
      }
      useS.setState((st) => {
        const importedChats = Array.isArray(j.chats) ? j.chats
          .filter((c: any) => c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.msgs))
          .map((c: any) => ({ ...c, msgs: c.msgs.filter((m: any) => m && typeof m.id === 'string' && typeof m.t === 'string') })) : []
        // Projects were renamed from folders; legacy config exports still
        // carry `folders`, so accept both keys here.
        const importedProjects = (Array.isArray(j.projects) ? j.projects : Array.isArray(j.folders) ? j.folders : []).filter((f: any) => f && typeof f.id === 'string' && typeof f.name === 'string')

        const projects = !imports.chats ? st.projects : merge ? [...st.projects.filter((f) => !importedProjects.some((x: any) => x.id === f.id)), ...importedProjects] : importedProjects
        const chats = !imports.chats ? st.chats : merge ? [...st.chats.filter((c) => !importedChats.some((x: any) => x.id === c.id)), ...importedChats] : importedChats
        const validSel = j.sel && typeof j.sel === 'object' && (j.sel.k === 'ep' || j.sel.k === 'pl') && typeof j.sel.id === 'string'
          ? { k: j.sel.k, id: j.sel.id, ...(typeof j.sel.model === 'string' && j.sel.model ? { model: j.sel.model } : {}) } : null
        const validFavs = Array.isArray(j.favs) ? j.favs.filter((x: unknown): x is string => typeof x === 'string' && x.includes('::')) : []
        const validMemories = Array.isArray(j.memories) ? j.memories.filter((x: any) => x && typeof x.id === 'string' && typeof x.text === 'string').map((x: any) => ({ id: x.id, text: String(x.text).slice(0, 500), category: typeof x.category === 'string' ? x.category.slice(0, 60) || 'General' : 'General', createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(), updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : Date.now() })) : []
        const validTodos = Array.isArray(j.todos) ? j.todos.filter((x: any) => x && typeof x.id === 'string' && typeof x.t === 'string').map((x: any) => ({ id: x.id, t: String(x.t).slice(0, 500), done: x.done === true })) : []
        return {
        ...(imports.eps ? { eps: m('eps', st.eps).map((e: Ep) => ({ ...e, models: Array.isArray(e.models) ? e.models.filter((x: unknown) => typeof x === 'string') : [], key: merge && !e.key ? st.eps.find((x) => x.id === e.id)?.key || '' : e.key })), ...(validSel ? { sel: validSel } : {}), ...(Array.isArray(j.favs) ? { favs: merge ? [...new Set([...st.favs, ...validFavs])] : validFavs } : {}) } : {}),
        ...(imports.prompts ? { prompts: m('prompts', st.prompts), ...(typeof j.pr === 'string' ? { pr: j.pr } : {}), ...(j.globalPrompt && typeof j.globalPrompt === 'object' ? { globalPrompt: normGlobalPrompt(j.globalPrompt) } : {}) } : {}),
        ...(imports.pls ? { pls: m('pls', st.pls) } : {}), ...(imports.cmds ? { cmds: m('cmds', st.cmds) } : {}),
        ...(imports.skills && Array.isArray(j.skills) ? { skills: normSkills(merge ? [...(st as any).skills ?? [], ...j.skills] : j.skills).skills } : {}),
        ...(imports.memory ? { ...(Array.isArray(j.memories) ? { memories: merge ? [...st.memories.filter((x) => !validMemories.some((y: any) => y.id === x.id)), ...validMemories] : validMemories } : {}), ...(j.memoryPrefs && typeof j.memoryPrefs === 'object' ? { memoryPrefs: { ...st.memoryPrefs, ...(merge ? {} : { enabled: false, intent: 'balanced', recall: 'contextual', method: 'local', classifierEp: '', classifierModel: '' }), ...Object.fromEntries(Object.entries(j.memoryPrefs).filter(([k]) => ['enabled', 'intent', 'recall', 'method', 'classifierEp', 'classifierModel'].includes(k))) } } : {}) } : {}),
        ...(imports.keys ? { keys: merge ? { ...st.keys, ...cleanStrings(j.keys) } : Object.fromEntries(Object.entries(cleanStrings(j.keys)).filter(([k]) => KEYS.some(([id]) => id === k))) } : {}),
        ...(imports.appearance ? { ...(j.themeMode === 'dark' || j.themeMode === 'light' ? { themeMode: j.themeMode } : {}), ...(Object.hasOwn(THEMES, j.themeDark) ? { themeDark: j.themeDark } : {}), ...(Object.hasOwn(THEMES, j.themeLight) ? { themeLight: j.themeLight } : {}), ...(j.customDarkColors && typeof j.customDarkColors === 'object' ? { customDarkColors: merge ? { ...st.customDarkColors, ...j.customDarkColors } : j.customDarkColors } : {}), ...(j.customLightColors && typeof j.customLightColors === 'object' ? { customLightColors: merge ? { ...st.customLightColors, ...j.customLightColors } : j.customLightColors } : {}), ...(j.customDarkTheme && typeof j.customDarkTheme === 'object' ? { customDarkTheme: normCustomTheme(merge ? { ...st.customDarkTheme, ...j.customDarkTheme } : j.customDarkTheme, st.customDarkTheme) } : {}), ...(j.customLightTheme && typeof j.customLightTheme === 'object' ? { customLightTheme: normCustomTheme(merge ? { ...st.customLightTheme, ...j.customLightTheme } : j.customLightTheme, st.customLightTheme) } : {}), ...(Object.hasOwn(THEMES, j.theme) ? themePatch(st, j.theme) : {}), ...(j.customColors && typeof j.customColors === 'object' ? { customDarkColors: merge ? { ...st.customDarkColors, ...j.customColors } : j.customColors } : {}), ...(j.prefs && typeof j.prefs === 'object' ? { prefs: merge ? { ...st.prefs, ...j.prefs } : { ...DEFAULT_PREFS, ...j.prefs } } : {}) } : {}),
        ...(imports.features ? { ...(j.features && typeof j.features === 'object' ? { features: merge ? { ...st.features, ...cleanFeatures(j.features) } : { ...DEFAULT_FEATURES, ...cleanFeatures(j.features) } } : {}), ...(j.libraryShow && typeof j.libraryShow === 'object' ? { libraryShow: merge ? { ...st.libraryShow, ...j.libraryShow } : j.libraryShow } : {}), ...(Array.isArray(j.featureOrder) ? { featureOrder: normFeatureOrder(merge ? [...st.featureOrder ?? [], ...j.featureOrder] : j.featureOrder) } : {}), ...(j.advanced && typeof j.advanced === 'object' ? { advanced: normAdvanced(merge ? { ...st.advanced, ...j.advanced } : j.advanced) } : {}) } : {}),
        ...(imports.tools ? { tools: merge ? { ...st.tools, ...cleanTools(j.tools) } : { ...DEFAULT_TOOLS, ...cleanTools(j.tools) }, ...(Array.isArray(j.mcps) ? (() => { const incoming = normMcpServers(j.mcps); return { mcps: merge ? [...st.mcps.filter((x) => !incoming.some((y) => y.id === x.id)), ...incoming] : incoming } })() : {}), ...(j.imageGen && typeof j.imageGen === 'object' ? { imageGen: normImageGen(merge ? { ...st.imageGen, ...j.imageGen } : j.imageGen) } : {}), ...(j.codeRun && typeof j.codeRun === 'object' ? { codeRun: normCodeRun(merge ? { ...st.codeRun, ...j.codeRun } : j.codeRun) } : {}), ...(j.search && typeof j.search === 'object' ? (() => {
          const current = normSearch((st as any).search)
          const incoming = normSearch(j.search)
          const keys: Record<string, string> = {}
          for (const p of Object.keys(current.keys)) keys[p] = merge ? ((incoming.keys as Record<string, string>)[p] || current.keys[p as keyof typeof current.keys] || '') : ((incoming.keys as Record<string, string>)[p] || '')
          return { search: { ...incoming, keys } }
        })() : {}) } : {}),
        ...(imports.tuning ? { ...(j.params && typeof j.params === 'object' ? { params: { ...(merge ? st.params : DEFAULT_PARAMS), ...Object.fromEntries(Object.entries(j.params).filter(([k]) => ['def', 'temp', 'topp', 'max', 'maxToolRounds', 'highToolsUnlocked'].includes(k))) } } : {}), ...(j.effort && typeof j.effort === 'object' ? { effort: merge ? { ...st.effort, ...cleanStrings(j.effort) } : cleanStrings(j.effort) } : {}), ...(j.workspacePrefs && typeof j.workspacePrefs === 'object' ? (() => { const w = j.workspacePrefs as Record<string, unknown>; const clean: Record<string, any> = {}; if (typeof w.defaultView === 'string') clean.defaultView = w.defaultView; if (typeof w.autoOpen === 'boolean') clean.autoOpen = w.autoOpen; if (typeof w.autoFollow === 'boolean') clean.autoFollow = w.autoFollow; return { workspacePrefs: { ...(merge ? st.workspacePrefs : { defaultView: 'latest', autoOpen: true, autoFollow: true }), ...clean } } })() : {}), ...(j.docPrefs && typeof j.docPrefs === 'object' ? { docPrefs: normDocs(merge ? { ...st.docPrefs, ...j.docPrefs } : j.docPrefs) } : {}), ...(j.voicePrefs && typeof j.voicePrefs === 'object' ? { voicePrefs: normVoice(merge ? { ...st.voicePrefs, ...j.voicePrefs } : j.voicePrefs) } : {}) } : {}),
        ...(imports.widgets ? { widgets: merge ? { ...st.widgets, ...cleanBools(j.widgets) } : cleanBools(j.widgets), widgetPrefs: j.widgetPrefs ? { ...(merge ? st.widgetPrefs : { ...DEFAULT_WIDGET_PREFS, widgetOrder: [...DEFAULT_WIDGET_PREFS.widgetOrder], shortcuts: [...DEFAULT_WIDGET_PREFS.shortcuts] }), ...cleanWidgetPrefs(j.widgetPrefs) } : st.widgetPrefs } : {}),
        ...(imports.stats && j.stats && typeof j.stats === 'object' ? { stats: merge ? { ...st.stats, ...j.stats } : j.stats } : {}),
        ...(imports.stats && j.routeStats && typeof j.routeStats === 'object' && !Array.isArray(j.routeStats) ? { routeStats: merge ? { ...st.routeStats, ...j.routeStats } : j.routeStats } : {}),
        ...(imports.chats ? { chats, projects, chat: chats.some((c) => c.id === st.chat) ? st.chat : chats[0]?.id ?? '', ...(Array.isArray(j.todos) ? { todos: merge ? [...st.todos.filter((x) => !validTodos.some((y: any) => y.id === x.id)), ...validTodos] : validTodos } : {}), ...(Array.isArray(j.snips) ? { snips: merge ? [...st.snips, ...j.snips.filter((x: any) => typeof x === 'string')] : j.snips.filter((x: any) => typeof x === 'string') } : {}), ...(typeof j.pad === 'string' ? { pad: merge && st.pad ? st.pad : j.pad } : {}) } : {}),
      }})
      setFileData(null)
      setMsg(merge ? 'Imported the selected data and merged it with existing settings.' : 'Imported the selected data and replaced those settings.')
    } catch { setMsg('Import failed: that file is not a valid data export.') }
  }
  return (
    <Panel id="data">
      <Section title="Transfer and backups" desc="Back up or move your setup somewhere else.">
      {DEVICE_SYNC_ENABLED && <Anchor id="device-sync"><SyncBox /></Anchor>}
      {DEVICE_SYNC_ENABLED && <Anchor id="sync-conflicts"><ConflictsBox /></Anchor>}
      <Anchor id="local-backups"><LocalBackups onRestore={restoreParsed} /></Anchor>
      <Anchor id="export">
      <Box icon={Download} t="Export data" d="Choose which data to include in a JSON file. Add a password to encrypt it.">
        <Btn v="soft" onClick={() => { setExpMsg(''); setCf(3) }}>Export</Btn>
        {expMsg && <span className="basis-full text-xs text-mu">{expMsg}</span>}
      </Box>
      </Anchor>
      <Anchor id="import">
      <Box icon={Upload} t="Import data" d="Choose a JSON data file, then select what to import.">
        <label className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-hov px-3 text-sm font-medium hover:opacity-80">
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { chooseFile(e.target.files?.[0]); e.target.value = '' }} />Choose file
        </label>
        {msg && <span className="basis-full text-xs text-mu">{msg}</span>}
      </Box>
      </Anchor>
      </Section>
      <Section title="Storage" desc="What this browser holds for the app.">
      <Anchor id="browser-storage"><StorageBox /></Anchor>
      </Section>
      <Section title="Danger zone" desc="Actions that remove data from this browser.">
      <Anchor id="chat-history">
      <Box icon={FileText} t="Chat history" d="Include conversations in data exports, or delete them all. Stats are kept.">
        <Btn v="danger" disabled={!chatCount} onClick={() => setCf(1)}>Delete all</Btn>
      </Box>
      </Anchor>
      <Anchor id="erase-everything">
      <Box icon={Trash2} t="Erase everything" d="Removes all endpoints, keys, prompts, skills, memories, chats, stats and settings from this browser.">
        <Btn v="danger" onClick={() => setCf(2)}>Erase</Btn>
      </Box>
      </Anchor>
      </Section>
      {cf === 1 && <Confirm title="Delete all chats?" text="Every saved chat is removed. Stats and settings are kept." ok="Delete all" close={() => setCf(0)} run={() => patch({ chats: [], chat: '' })} />}
      {cf === 2 && <Confirm title="Erase everything?" text="Endpoints, API keys, prompts, playlists, commands, skills, memories, chats, stats and all other settings are removed from this browser. This cannot be undone." ok="Erase" close={() => setCf(0)} run={() => { void (async () => {
        // Cancel queued writes first: a pending persist flush or durable
        // mirror would otherwise recreate what we are about to delete.
        try { await useS.persist.clearStorage() } catch { try { localStorage.removeItem('byok.v1') } catch { /* ignore */ } }
        for (const k of ['byok.sync.token', 'byok.sync.auto', 'byok.sync.last']) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
        const { beginDurableErase } = await import('../storage/boot')
        beginDurableErase()
        const { durableEraseAll } = await import('../storage/durable')
        await durableEraseAll().catch(() => {})
        location.reload()
      })() }} />}
      {cf === 3 && <Modal close={() => setCf(0)}><section role="dialog" aria-modal="true" aria-labelledby="export-title" className="w-full max-w-xl space-y-5 rounded-2xl border border-bor bg-bg p-5 shadow-2xl">
        <div><h2 id="export-title" className="text-lg font-semibold">Export data</h2><p className="mt-1 text-sm text-mu">Choose the data to include in this file.</p></div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surf p-3 sm:grid-cols-3">{categories.map(([id, label]) => <Checkbox key={id} checked={exports[id]} set={(checked) => setExports({ ...exports, [id]: checked })} label={label} />)}</div>
        {exports.eps && <div className="rounded-xl bg-surf p-3"><Checkbox checked={withKeys} set={setWithKeys} label="Include API keys" /></div>}
        {exports.chats && (
          <div className="space-y-1.5 rounded-xl bg-surf p-3">
            <div className="text-xs font-medium">Only chats active between (optional)</div>
            <div className="flex items-center gap-2">
              <input type="date" aria-label="Export chats from date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
              <span className="text-xs text-mu">to</span>
              <input type="date" aria-label="Export chats to date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="min-w-0 flex-1 rounded-md bg-bg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
            </div>
            <p className="text-xs text-mu">A chat is included when any message was sent in the window. Leave both empty to include every chat.</p>
          </div>
        )}
        <div className="space-y-1.5 rounded-xl bg-surf p-3">
          <Input type="password" value={expPw} set={setExpPw} placeholder="Password (optional)" />
          <p className="text-xs text-mu">Leave empty for a plain JSON file. With a password this export is encrypted (AES-GCM-256) and can only be imported with the same password.</p>
        </div>
        <div className="flex justify-end gap-2"><Btn v="soft" onClick={() => setCf(0)}>Cancel</Btn><Btn v="solid" icon={Download} onClick={() => { void exp(); setCf(0) }}>Export</Btn></div>
      </section></Modal>}
      {pendingEnc && <Modal close={() => setPendingEnc(null)}><section role="dialog" aria-modal="true" aria-labelledby="decrypt-title" className="w-full max-w-sm space-y-4 rounded-2xl border border-bor bg-bg p-5 shadow-2xl">
        <div><h2 id="decrypt-title" className="text-lg font-semibold">Encrypted file</h2><p className="mt-1 text-sm text-mu">This data file is password-protected. Enter the password used when it was exported.</p></div>
        <Input type="password" value={impPw} set={setImpPw} placeholder="File password" />
        {impErr && <p className="text-sm text-er">{impErr}</p>}
        <div className="flex justify-end gap-2"><Btn v="soft" onClick={() => setPendingEnc(null)}>Cancel</Btn><Btn v="solid" disabled={!impPw} onClick={() => void decryptAndLoad()}>Decrypt</Btn></div>
      </section></Modal>}
      {fileData && <Modal close={() => setFileData(null)}><section role="dialog" aria-modal="true" aria-labelledby="import-title" className="w-full max-w-xl space-y-5 rounded-2xl border border-bor bg-bg p-5 shadow-2xl">
        <div><h2 id="import-title" className="text-lg font-semibold">Import data</h2><p className="mt-1 text-sm text-mu">Choose the parts of this file to import. Sections not included in the file are unavailable.</p></div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surf p-3 sm:grid-cols-3">{categories.map(([id, label]) => <Checkbox key={id} checked={imports[id]} disabled={!available[id]} set={(checked) => setImports({ ...imports, [id]: checked })} label={label} />)}</div>
        <div className="rounded-xl bg-surf p-3"><Checkbox checked={merge} set={setMerge} label="Merge with existing data" /></div>
        <div className="flex justify-end gap-2"><Btn v="soft" onClick={() => setFileData(null)}>Cancel</Btn><Btn v="solid" icon={Upload} onClick={imp} disabled={!Object.values(imports).some(Boolean)}>Import</Btn></div>
      </section></Modal>}
    </Panel>
  )
}
