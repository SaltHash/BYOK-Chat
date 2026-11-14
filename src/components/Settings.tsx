import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X, Plus, Trash2, ArrowUp, ArrowDown, CornerDownRight, ChevronDown, ChevronRight, Eye, EyeOff, Play, ShieldCheck, Shield, Download, Check, CircleCheck, CircleX, Cpu, Route, GripVertical, Server, ListMusic, ScrollText, Terminal, Wrench, Palette, FolderOpen, PanelRight, TrendingUp, Keyboard, Search, Brain, Pencil, Sparkles, RotateCcw, SlidersHorizontal, FlaskConical, Library, Database, Lock, LockOpen, LayoutTemplate, Share2, Plug, Image as ImageIcon, Volume2, AudioLines, Code2, Star } from 'lucide-react'
import { modelListEdit } from '../models'
import { useS, useSConfig, PRE, BLANK, THEMES, DARK_THEMES, LIGHT_THEMES, THEME_COLOR_KEYS, THEME_COLOR_LABELS, THEME_COLORS, defaultCustomTheme, customThemeColors, normCustomTheme, SEARCH_PROVIDERS, READER_PROVIDERS, FEATURES, LIBRARY_ITEMS, FEATURE_TABS, FEATURE_WIDGETS, DEFAULT_LIBRARY_SHOW, DEFAULT_ADVANCED, featOn, normSearch, normAdvanced, normLogDetail, normDocs, usable, modelsOf, modelNameOf, helperRef, splitHelperRef, favRef, toggleFavRef, effortClassifierOf, TOOL_ROUNDS_DEFAULT, TOOL_ROUNDS_MIN, TOOL_ROUNDS_BASE_MAX, TOOL_ROUNDS_MAX, toolRoundLimitOf, isToolRoundsUnlimited, GENERAL_PROMPT_TEXT, STARTUP_MODES, normStartup, PROMPT_RECALL_MODES, normPromptRecall, uid, REPLY_METRICS, DEFAULT_REPLY_STATS, type PromptRecallMode, type ReplyMetric, type ReplyModelLabel, type Kind, type FeatureId, type DocPrefs, type ModelPrice } from '../store'
import { normSkills, resolveSkill, validateCustomSkill, enabledSkills, BUILTIN_SKILLS, SKILL_TOOL_NAME, type SkillState } from '../skills'
import { findDuplicatePairs, mergeMemory } from '../recall'
import { TOOL_REGISTRY, can, stream } from '../engine'
import { CI, TOOLS, WIDGETS, KEYS, orderTools } from '../meta'
import { SETTINGS_TABS, SETTINGS_GROUPS, visibleTabs, searchSettings, splitSettingTarget, settingDomId } from '../settingsCatalog'
import { normQualityFavs, type GlobalPrompt, type PromptQuality, type Quality } from '../flair'
import { DataTab, KeysTab, TestRow, TestAllEndpoints } from './Extra'
import { ToolAccessCard } from './ToolAccess'
import { Btn, Field, Input, Area, Sel, SearchSelect, Toggle, Seg, RangeSlider, Checkbox, Modal, Surface, Chip, Item, Confirm, cx, useMenuNav, type Ic } from './ui'
import { Anchor, Panel, Section, SettingRow } from './settingsPrimitives'
import { SortableList, useFlipAnimate, type SortHandleProps, type SortItemApi } from './dnd'
import { fetchModelCatalogCached, clearCatalogCache, prefetchModelCatalog, fetchModelProviders, filterCatalogByEndpoint, prioritizeProviderRows, discoverEndpointModels, clearModelDiscoveryCache, type CatalogEntry, type CatalogProvider, type CatalogSource } from '../catalog'
import { resolveProvider } from '../providerRegistry'
import { parseCurlCommand, type CurlProvider } from '../curlImport'
import { ENDPOINT_AUTH_OPTIONS, endpointAuthOf, headerBlockOf, type EndpointAuth } from '../endpointAuth'
import { providerFetch } from '../net'
import { WORKSPACE_TEMPLATES } from '../workspace'
import { probeMcpServer, mcpToolName, type McpServer } from '../mcp'
import { BLANK_IMAGE_GEN, IMAGE_SIZES, normImageGen } from '../imagegen'
import { BLANK_CODE_RUN, CODE_OUTPUT_MAX, CODE_TIMEOUT_MAX, CODE_TIMEOUT_MIN, normCodeRun, PYODIDE_DEFAULT_URL } from '../codesandbox'
import { normVoice, VOICE_LANGS, speak, stopSpeaking, speechAvailable, dictationAvailable } from '../voice'
import { DENSITIES, DENSITY_IDS, SPACING_LIMITS, STYLE_PRESETS, STYLE_PRESET_IDS, hasSpacingOverrides, resolveSpacing } from '../style'
import { USAGE_PERIODS } from '../usageStats'
import { normCompactAt } from '../compaction'
import { ARCHIVE_RETENTION_NEVER, archiveRetentionLabel, normArchiveDays } from '../archive'
import { ErrorBoundary } from './ErrorBoundary'
import { AppearanceSettings } from './AppearanceSettings'

const TABS = SETTINGS_TABS
// The stats dashboard is a large, self-contained surface. Keep it out of the
// Settings chunk until its tab is actually opened.
const UsageStats = lazy(() => import('./UsageStats').then((m) => ({ default: m.UsageStats })))
/** Briefly highlight a deep-linked section after scrolling to it. */
export function flashAnchor(anchor: string) {
  try {
    const el = document.getElementById(settingDomId(anchor))
    if (!el) return
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    el.classList.add('setting-flash')
    setTimeout(() => el.classList.remove('setting-flash'), 1600)
  } catch { /* ignore */ }
}
/** Jump to another setting from inside a tab (tabs don't receive setTab). */
export const goSetting = (t: string) => {
  try { window.dispatchEvent(new CustomEvent('byok:setting', { detail: t })) } catch { /* ignore */ }
}
/** Readable label for a helper-model ref (`<epId>::<model>` or ''). */
export const helperLabel = (s: { eps: any[] }, ref: string, emptyLabel: string) => {
  if (!ref) return emptyLabel
  const [id, model] = splitHelperRef(ref)
  const e = s.eps.find((x) => x.id === id)
  if (!e) return 'Removed endpoint'
  const m = model && modelsOf(e).includes(model) ? model : e.model
  return `${e.name} · ${modelNameOf(e, m || model)}`
}
/** Pointer card replacing a removed duplicate helper-model picker. */
function HelperPointer({ anchor, title, current }: { anchor: string; title: string; current: string }) {
  return (
    <Anchor id={anchor}>
      <SettingRow label={<><span className="block">{title}</span><span className="mt-0.5 block text-xs text-mu">Current: <span className="text-tx">{current}</span></span></>}>
        <Btn v="soft" icon={Cpu} onClick={() => goSetting('eps#helper-models')}>Open helper models</Btn>
      </SettingRow>
    </Anchor>
  )
}
/** The single quick-add control on the Endpoints tab. The main half creates
 *  an OpenAI-compatible endpoint right away; the arrow half opens a menu that
 *  can also create an Anthropic-compatible one. cURL import stays a separate
 *  button beside it. */
function AddEndpointSplit({ onAdd }: { onAdd: (type: 'openai' | 'anthropic') => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuKeys = useMenuNav(open, menu, () => setOpen(false), () => trigger.current?.focus())
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    addEventListener('mousedown', f)
    return () => removeEventListener('mousedown', f)
  }, [open])
  const pick = (t: 'openai' | 'anthropic') => { setOpen(false); onAdd(t); trigger.current?.focus() }
  return (
    <div ref={ref} className="relative inline-flex">
      <Btn v="solid" icon={Plus} className="!rounded-r-none" onClick={() => pick('openai')}>Add endpoint</Btn>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose the API format"
        title="Choose the API format"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-7 items-center justify-center rounded-lg rounded-l-none border-l border-black/15 bg-ac text-acx transition-opacity hover:opacity-90"
      >
        <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Endpoint type" onKeyDown={menuKeys} className="menu-surface absolute left-0 top-full z-20 mt-1.5 w-64 rounded-xl bg-surf p-1.5">
          <Item role="menuitem" icon={Cpu} onClick={() => pick('openai')} sub="Most providers, local servers, OpenRouter">OpenAI-compatible</Item>
          <Item role="menuitem" icon={ScrollText} onClick={() => pick('anthropic')} sub="Anthropic Messages API shape">Anthropic-compatible</Item>
        </div>
      )}
    </div>
  )
}

/* Anchors inside a collapsed card are not in the DOM, so a deep link
 * (palette → Settings) could not reach them. `Card` collects the `Anchor` ids
 * in its children and opens itself when one of them is requested. */
const collectAnchors = (node: ReactNode, out: string[] = []): string[] => {
  if (Array.isArray(node)) { for (const n of node) collectAnchors(n, out); return out }
  if (!node || typeof node !== 'object' || !('props' in (node as object))) return out
  const el = node as { type?: unknown; props?: { id?: unknown; children?: ReactNode } }
  if (el.type === Anchor && typeof el.props?.id === 'string') out.push(el.props.id)
  if (el.props?.children !== undefined) collectAnchors(el.props.children, out)
  return out
}

export function Card({ icon: I, title, sub, right, open0, handle, children, muted }: { icon: Ic; title: ReactNode; sub?: string; right?: ReactNode; open0?: boolean; handle?: SortHandleProps | null; children?: ReactNode; muted?: boolean }) {
  const [o, setO] = useState(!!open0)
  const hasBody = children != null && children !== false
  const anchorKey = useMemo(() => collectAnchors(children).join('|'), [children])
  useEffect(() => {
    if (!anchorKey) return
    const ids = anchorKey.split('|')
    const onRequest = (e: Event) => {
      const a = (e as CustomEvent<string>).detail
      if (typeof a === 'string' && ids.includes(a)) setO(true)
    }
    window.addEventListener('byok:anchor', onRequest)
    return () => window.removeEventListener('byok:anchor', onRequest)
  }, [anchorKey])
  return (
    <div>
      <div className="flex items-center gap-3 py-3">
        {handle && <span {...handle} title="Drag to reorder" className="dnd-handle -mr-1 cursor-grab text-mu"><GripVertical size={16} /></span>}
        <div role={hasBody ? 'button' : undefined} tabIndex={hasBody ? 0 : undefined} onClick={hasBody ? () => setO(!o) : undefined} onKeyDown={hasBody ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setO(!o) } } : undefined} className={cx('flex min-w-0 flex-1 items-center gap-2.5 text-left', hasBody && 'cursor-pointer')}>
          <I size={16} className={cx('shrink-0', muted ? 'text-mu/60' : 'text-mu')} />
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{title}</span>{sub && <span className="block truncate text-xs text-mu">{sub}</span>}</span>
        </div>
        {right}
        {hasBody && <Btn sm icon={ChevronRight} title={o ? 'Collapse' : 'Expand'} onClick={() => setO(!o)} className={cx('transition-transform', o && 'rotate-90')} />}
      </div>
      {hasBody && o && <div className="space-y-4 pb-4">{children}</div>}
    </div>
  )
}

/** Vertical reorder list for settings cards with continuous spatial reflow. */
function SortableCards({ k, ids, label, renderCard }: { k: Kind; ids: string[]; label: string; renderCard: (id: string, handle: SortHandleProps) => ReactNode }) {
  const reorder = useS((s) => s.reorder)
  return (
    <SortableList
      ids={ids}
      onCommit={(from, to) => { if (from !== to) reorder(k, ids[from], ids[to]) }}
      label={label}
      className="space-y-3"
      renderItem={(id, api: SortItemApi) => renderCard(id, api.handleProps(`Reorder ${label}`))}
    />
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
  const { move, del } = useSConfig()
  return (
    <div className="flex items-center gap-1 pt-1">
      <Btn icon={ArrowUp} title="Move up" onClick={() => move(k, id, -1)} />
      <Btn icon={ArrowDown} title="Move down" onClick={() => move(k, id, 1)} />
      <span className="flex-1" />
      <Btn v="danger" icon={Trash2} onClick={() => del(k, id)}>Remove</Btn>
    </div>
  )
}

function ProviderStat({ icon: I, title, children }: { icon: Ic; title: string; children: ReactNode }) {
  return <span title={title} className="inline-flex min-w-0 items-center gap-1 rounded-md border border-bor bg-surf px-1.5 py-1 text-[11px] text-mu"><I size={11} className="shrink-0" aria-hidden="true" /><span className="truncate">{children}</span></span>
}

/** Per-model inference provider picker (OpenRouter only). Kept behind one
 *  low-key button under a model row so it stays out of the way for the many
 *  users who never care which provider serves a model. */
function ProviderPicker({ e, model, openRouter, update }: { e: any; model: string; openRouter: boolean; update: (p: object) => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [providers, setProviders] = useState<CatalogProvider[]>([])
  const [manual, setManual] = useState('')
  const current: { tag: string; name: string } | undefined = e.modelProviders?.[model]
  if (!openRouter || !model) return null
  const load = async () => {
    setOpen(true); setStatus('Loading providers…')
    const { providers: found, error } = await fetchModelProviders(model, e)
    setProviders(found)
    setStatus(error && !found.length ? `${error} You can enter a provider slug below.`
      : found.length ? `${found.length} provider${found.length === 1 ? '' : 's'} currently serve this model.`
        : 'No providers were returned. You can enter a provider slug below.')
  }
  const pick = (tag: string, name: string) => {
    update({ modelProviders: { ...(e.modelProviders ?? {}), [model]: { tag, name } } })
    setOpen(false)
  }
  const clear = () => {
    const next = { ...(e.modelProviders ?? {}) }
    delete next[model]
    update({ modelProviders: next })
    setOpen(false)
  }
  return <>
    <button type="button" onClick={() => void load()} title="Choose the inference provider for this model" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-hov hover:text-tx">
      <Server size={12} />Provider: <span className={current ? 'font-medium text-tx' : ''}>{current?.name ?? 'Automatic'}</span>
    </button>
    {open && <Modal close={() => setOpen(false)} label="Inference provider">
      <div className="modal-panel flex max-h-[80dvh] w-full max-w-lg flex-col gap-3 rounded-2xl bg-bg p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 font-semibold">Inference provider</h3>
            <p className="mt-0.5 truncate text-xs text-mu">{model}</p>
          </div>
          <button onClick={() => setOpen(false)} className="grid size-8 shrink-0 place-items-center rounded-lg text-mu hover:bg-hov hover:text-tx" aria-label="Close provider picker"><X size={16} /></button>
        </div>
        <button onClick={() => void load()} className="self-start rounded-lg bg-hov px-3 py-2 text-xs text-tx">Refresh providers</button>
        <p className="text-xs text-mu">{status}</p>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto">
          <button onClick={clear} className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov', !current && 'bg-hov')}>
            <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center self-start rounded-full border', !current ? 'border-ac' : 'border-mu/60')}>{!current && <span className="size-2 rounded-full bg-ac" />}</span>
            <span className="min-w-0"><span className="block">Automatic</span></span>
          </button>
          {providers.map((p) => {
            const on = current?.tag === p.tag
            return <button key={p.tag} onClick={() => pick(p.tag, p.name)} className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov', on && 'bg-hov')}>
              <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center self-start rounded-full border', on ? 'border-ac' : 'border-mu/60')}>{on && <span className="size-2 rounded-full bg-ac" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="mt-1 flex flex-wrap gap-1 text-[11px] text-mu">
                  {p.throughput !== undefined && <ProviderStat icon={TrendingUp} title="Measured output speed over the last 30 minutes">{Math.round(p.throughput)} tok/s</ProviderStat>}
                  {p.context !== undefined && <ProviderStat icon={Database} title="Maximum context window">{contextLabel(p.context)} ctx</ProviderStat>}
                  {p.inputPrice !== undefined && <ProviderStat icon={ArrowDown} title={`$${p.inputPrice.toFixed(2)} per million input tokens`}>${p.inputPrice.toFixed(2)}/M in</ProviderStat>}
                  {p.outputPrice !== undefined && <ProviderStat icon={ArrowUp} title={`$${p.outputPrice.toFixed(2)} per million output tokens`}>${p.outputPrice.toFixed(2)}/M out</ProviderStat>}
                  {p.cacheReadPrice !== undefined && <ProviderStat icon={Route} title={`$${p.cacheReadPrice.toFixed(2)} per million cached input tokens`}>${p.cacheReadPrice.toFixed(2)}/M cache</ProviderStat>}
                  {p.quantization && <ProviderStat icon={Cpu} title="Quantization">{p.quantization}</ProviderStat>}
                </span>
              </span>
            </button>
          })}
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-medium">Or enter a provider slug</span>
          <div className="flex gap-2">
            <input value={manual} onChange={(ev) => setManual(ev.target.value)} placeholder="e.g. amazon-bedrock" className="min-w-0 flex-1 rounded-lg bg-surf px-3 py-2 text-sm outline-none" />
            <button disabled={!manual.trim()} onClick={() => pick(manual.trim(), manual.trim())} className="rounded-lg bg-ac px-3 py-2 text-xs text-acx disabled:opacity-40">Use</button>
          </div>
        </div>
      </div>
    </Modal>}
  </>
}

function ModelsEditor({ e, update }: { e: any; update: (p: object) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const [picker, setPicker] = useState(false)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [catalogState, setCatalogState] = useState('')
  const [catalogSource, setCatalogSource] = useState<CatalogSource>('openrouter')
  const [query, setQuery] = useState('')
  const [searchIdea, setSearchIdea] = useState<string | null>(null)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const favs = useS((st) => st.favs)
  const models: string[] = e.models ?? [e.model]
  const presetInfo = (e.preset && PRE[e.preset]) || presetForUrl(e.url)?.[1]
  const endpointId = e.endpointId ?? presetInfo?.[2] ?? ''
  const endpointFilter = e.endpointFilter ?? presetInfo?.[3] ?? 'author'
  const isOpenRouter = /openrouter\.ai/i.test(e.url)
  // Direct provider lists return bare, endpoint-native IDs. Only aggregated
  // catalogs need the OpenRouter-style `author/model` prefix added or removed.
  const directCatalog = catalogSource === 'provider' || catalogSource === 'base'
  const storedId = (id: string) => !isOpenRouter && endpointFilter === 'author' && endpointId && id.toLowerCase().startsWith(`${endpointId.toLowerCase()}/`) ? id.slice(endpointId.length + 1) : id
  const catalogId = (id: string) => directCatalog ? id : !id.includes('/') && endpointFilter === 'author' && endpointId ? `${endpointId}/${id}` : id
  const priceSource = catalogSource === 'openrouter' ? 'openrouter' as const : 'provider' as const
  const priceFrom = (item: CatalogEntry | undefined) => item && item.inputPrice !== undefined && item.outputPrice !== undefined
    ? { input: item.inputPrice, output: item.outputPrice, source: priceSource, ...(item.cacheReadPrice !== undefined ? { cacheRead: item.cacheReadPrice } : {}) }
    : undefined
  useEffect(() => {
    if (!picker) return
    const dismiss = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); setPicker(false) } }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [picker])
  // Every model-list edit stamps each added or removed id, so a deletion is
  // something the sync merge can represent instead of a shorter array that a
  // stale copy can overwrite.
  const setModels = (next: string[]) => update(modelListEdit({ ...e, models }, next))
  // Stable row identities (value + occurrence) so rows keep their content across reorders.
  const rowIds = useMemo(() => {
    const seen = new Map<string, number>()
    return models.map((m) => { const n = (seen.get(m) ?? 0) + 1; seen.set(m, n); return `${n}#${m}` })
  }, [models])
  const indexOfRow = (rid: string) => rowIds.indexOf(rid)
  const loadCatalog = async () => {
    setPicker(true); setCatalogState('Loading documented models…')
    try {
      const { entries, error, source = 'openrouter', stale } = await fetchModelCatalogCached(e)
      setCatalogSource(source)
      if (error && !entries.length) { setCatalogState(`${error} You can still enter a model ID below.`); return }
      // The request awaited: re-read the live endpoint so edits made meanwhile
      // are not overwritten by the write below with a stale snapshot.
      const cur = useS.getState().eps.find((x) => x.id === e.id) ?? e
      const liveModels = Array.isArray(cur.models) ? cur.models : models
      // A provider's own list is already scoped to that provider. Aggregated
      // OpenRouter/LiteLLM catalogs still need endpoint-brand filtering.
      let found = source === 'provider' || source === 'base'
        ? entries
        : endpointId ? filterCatalogByEndpoint(entries, endpointId, endpointFilter) : entries
      if (source === 'openrouter') found = prioritizeProviderRows(found, endpointId, endpointFilter)
      setCatalog(found)
      const detectedEntries = found.filter(x => liveModels.includes(storedId(x.id)) && x.source === 'auto' && !cur.modelEffortSource?.[storedId(x.id)])
      const detected = Object.fromEntries(detectedEntries.map(x => [storedId(x.id), x.efforts]))
      const detectedSources = Object.fromEntries(detectedEntries.map(x => [storedId(x.id), 'auto']))
      const providedNames = Object.fromEntries(found.filter(x => liveModels.includes(storedId(x.id)) && x.name && !cur.modelNames?.[storedId(x.id)]).map(x => [storedId(x.id), x.name]))
      const providedContext = Object.fromEntries(found.filter(x => liveModels.includes(storedId(x.id)) && x.context && Number(x.context) > 0).map(x => [storedId(x.id), Number(x.context)]))
      const providedPrices = Object.fromEntries(found.filter(x => liveModels.includes(storedId(x.id)) && !cur.prices?.[storedId(x.id)] && x.inputPrice !== undefined && x.outputPrice !== undefined).map(x => [storedId(x.id), { input: x.inputPrice!, output: x.outputPrice!, source: source === 'openrouter' ? 'openrouter' as const : 'provider' as const, ...(x.cacheReadPrice !== undefined ? { cacheRead: x.cacheReadPrice } : {}) }]))
      if (Object.keys(detected).length || Object.keys(providedNames).length || Object.keys(providedContext).length || Object.keys(providedPrices).length) update({ modelEfforts: { ...cur.modelEfforts, ...detected }, modelEffortSource: { ...cur.modelEffortSource, ...detectedSources }, modelNames: { ...cur.modelNames, ...providedNames }, modelContext: { ...cur.modelContext, ...providedContext }, ...(Object.keys(providedPrices).length ? { prices: { ...cur.prices, ...providedPrices } } : {}) })
      const from = source === 'provider' ? 'this provider' : source === 'openrouter' ? 'OpenRouter' : source === 'litellm' ? 'the LiteLLM catalog' : 'this server'
      const staleNote = stale && error ? ` Showing the last known list because the refresh failed: ${error}` : ''
      setCatalogState(found.length ? `${found.length} models found from ${from}.${staleNote || ' Catalog entries are suggestions; confirm any model ID.'}` : 'No catalog entries were returned. Enter a model ID below.')
    } catch (err: any) { setCatalogState(`${err?.message || 'Catalog lookup failed.'} You can still enter a model ID below.`) }
  }
  const addModel = (id: string, efforts: string[] = [], autoDetected = false) => {
    const clean = storedId(id.trim())
    if (!clean) return
    if (!models.includes(clean)) setModels([...models.filter(Boolean), clean])
    const item = catalog.find(x => storedId(x.id) === clean)
    const providedName = item?.name
    const providedCtx = item?.context
    const providedPrice = priceFrom(item)
    update({ modelEfforts: { ...e.modelEfforts, [clean]: efforts }, modelEffortSource: { ...e.modelEffortSource, [clean]: autoDetected ? (efforts.length ? 'auto' : item?.source ?? 'manual') : 'manual' }, ...(providedName && !e.modelNames?.[clean] ? { modelNames: { ...e.modelNames, [clean]: providedName } } : {}), ...(providedCtx && Number(providedCtx) > 0 ? { modelContext: { ...e.modelContext, [clean]: Number(providedCtx) } } : {}), ...(providedPrice && !e.prices?.[clean] ? { prices: { ...e.prices, [clean]: providedPrice } } : {}) })
    setPicker(false); setQuery(''); setSearchIdea(null)
  }
  // Bulk-add from the picker. Extracted from the button so pricing and effort
  // metadata from direct provider lists stay in one place.
  const addSelected = () => {
    const adding = [...new Set([...selectedModels, ...(searchIdea ? [searchIdea] : [])])]
    const next = [...new Set([...models.filter(Boolean), ...adding])]
    const itemFor = (id: string) => catalog.find(x => storedId(x.id) === id)
    const effortEntries = selectedModels.flatMap(id => { const item = itemFor(id); return item ? [[id, item.efforts] as const] : [] })
    const modelNames = Object.fromEntries(adding.flatMap(id => { const name = itemFor(id)?.name; return name ? [[id, name] as const] : [] }))
    const modelCtx = Object.fromEntries(adding.flatMap(id => { const ctx = itemFor(id)?.context; return ctx && Number(ctx) > 0 ? [[id, Number(ctx)] as const] : [] }))
    const modelPrices = Object.fromEntries(adding.flatMap(id => { const price = priceFrom(itemFor(id)); return price && !e.prices?.[id] ? [[id, price] as const] : [] }))
    update({ ...modelListEdit({ ...e, models }, next), modelNames: { ...e.modelNames, ...modelNames }, modelContext: { ...e.modelContext, ...modelCtx }, ...(Object.keys(modelPrices).length ? { prices: { ...e.prices, ...modelPrices } } : {}), modelEfforts: { ...e.modelEfforts, ...Object.fromEntries(effortEntries) }, modelEffortSource: { ...e.modelEffortSource, ...Object.fromEntries(effortEntries.map(([id, levels]) => [id, levels.length ? 'auto' : itemFor(id)?.source ?? 'manual'])) } })
    setPicker(false); setSelectedModels([]); setSearchIdea(null)
  }
  return <div className="space-y-2">
    <SortableList
      ids={rowIds}
      onCommit={(from, to) => { if (from === to) return; const next = [...models]; const [x] = next.splice(from, 1); next.splice(to, 0, x); setModels(next) }}
      label="Model"
      className="space-y-2"
      renderItem={(rid, api) => {
        const i = indexOfRow(rid)
        if (i < 0) return null
        const model = models[i] ?? ''
        return <div className="rounded-xl bg-bg p-2">
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2">
      <span {...api.handleProps(`Reorder model ${i + 1}`)} title="Drag to reorder" className="dnd-handle cursor-grab text-mu"><GripVertical size={16} /></span>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-hov text-xs text-mu">{i + 1}</span>
      <input ref={(el) => { refs.current[i] = el }} value={model} onChange={(ev) => { const next = [...models]; next[i] = ev.target.value; setModels(next) }} onKeyDown={(ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); if (i < models.length - 1) refs.current[i + 1]?.focus(); else if (model.trim()) { setModels([...models, '']); setTimeout(() => refs.current[i + 1]?.focus(), 0) } }
      }} placeholder="Model ID" aria-label={`Model ID ${i + 1}`} className="min-w-0 bg-transparent px-2 py-1 text-sm outline-none" />
      <input value={model ? modelNameOf(e, model).replace(/^~+/, '') : ''} onChange={(ev) => update({ modelNames: { ...e.modelNames, [model]: ev.target.value } })} placeholder="Model name" aria-label={`Model name ${i + 1}`} className="min-w-0 rounded-md bg-surf px-2 py-1 text-sm outline-none" />
      <button type="button" title={favs.includes(favRef(e.id, model)) ? 'Remove from favorites' : 'Add to favorites'} aria-label={favs.includes(favRef(e.id, model)) ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={favs.includes(favRef(e.id, model))} disabled={!model} onClick={() => { if (model) useS.getState().patch({ favs: toggleFavRef(favs, favRef(e.id, model)) }) }} className={cx('grid size-7 place-items-center rounded-md hover:bg-hov hover:text-tx disabled:opacity-0', favs.includes(favRef(e.id, model)) ? 'text-ac' : 'text-mu')}><Star size={14} fill={favs.includes(favRef(e.id, model)) ? 'currentColor' : 'none'} /></button>
      <button title="Remove model" onClick={() => setModels(models.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-md text-mu hover:bg-hov hover:text-er"><Trash2 size={14} /></button>
      </div>
      {!!model && (isOpenRouter || e.modelEffortSource?.[model] !== 'auto') && <div className="ml-8 mt-1 flex flex-wrap items-center gap-3 text-xs text-mu">
        <ProviderPicker e={e} model={model} openRouter={isOpenRouter} update={update} />
        {e.modelEffortSource?.[model] !== 'auto' && <span className="flex flex-wrap items-center gap-2"><span>Reasoning effort support:</span>{(['low','medium','high','xhigh','max','minimal','none'] as const).map(level => { const levels: string[] = e.modelEfforts?.[model] ?? []; const checked = levels.includes(level); return <button key={level} type="button" role="checkbox" aria-checked={checked} onClick={() => update({ modelEfforts: { ...e.modelEfforts, [model]: checked ? levels.filter(x => x !== level) : [...new Set([...levels, level])] }, modelEffortSource: { ...e.modelEffortSource, [model]: 'manual' } })} className="inline-flex items-center gap-1.5 capitalize"><span className={cx('grid size-4 place-items-center rounded border transition-colors', checked ? 'border-ac bg-ac text-acx' : 'border-mu bg-surf')}>{checked && <Check size={12} strokeWidth={3}/>}</span>{level}</button> })}<span className="opacity-70">(manual)</span></span>}
      </div>}
    </div>
      }}
    />
    <button onClick={() => { setPicker(true); setSelectedModels([]); void loadCatalog() }} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-bor py-2 text-sm text-mu hover:text-tx"><Plus size={14} />Add model</button>
    {picker && <Modal close={() => setPicker(false)} keyboard={false}><div className="modal-panel flex max-h-[80dvh] w-full max-w-xl flex-col gap-3 rounded-2xl bg-bg p-5 shadow-2xl">
      <div className="flex items-center justify-between"><div><h3 className="flex items-center gap-1.5 font-semibold">Choose a model</h3><p className="mt-0.5 text-xs text-mu">{e.name}{endpointId ? ` · ${endpointId}` : ''}</p></div><button onClick={() => setPicker(false)} className="grid size-8 place-items-center rounded-lg text-mu hover:bg-hov hover:text-tx" aria-label="Close model picker"><X size={16}/></button></div>
      <div className="flex flex-wrap gap-2"><button onClick={loadCatalog} className="rounded-lg bg-hov px-3 py-2 text-xs text-tx">{catalog.length ? 'Refresh model catalog' : 'Load available models'}</button>
      <button onClick={() => { clearModelDiscoveryCache(e.url); clearCatalogCache(e.id); void loadCatalog() }} title="Clear cached working and failed model-list URLs for this endpoint, then probe them again." className="rounded-lg px-3 py-2 text-xs text-mu hover:bg-hov hover:text-tx">Retry model-list checks</button></div>
      {catalogState && <p className="text-xs text-mu">{catalogState}</p>}
      <input value={query} onChange={ev => setQuery(ev.target.value)} placeholder="Search available models" className="w-full rounded-lg bg-surf px-3 py-2 text-sm outline-none"/>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">{[...catalog].sort((a,b) => modelIdCompare(storedId(a.id).replace(/^~+/, ''), storedId(b.id).replace(/^~+/, ''))).filter(x => `${x.name.replace(/^~+/, '')} ${storedId(x.id).replace(/^~+/, '')}`.toLowerCase().includes(query.toLowerCase()) && !models.includes(storedId(x.id))).slice(0,250).map(x => { const id = storedId(x.id), visibleId = id.replace(/^~+/, ''), checked = selectedModels.includes(id); return <button key={x.id} onClick={() => setSelectedModels(checked ? selectedModels.filter(m => m !== id) : [...selectedModels, id])} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov"><span className={cx('grid size-4 shrink-0 place-items-center rounded border', checked ? 'border-ac bg-ac text-acx' : 'border-mu/60')}>{checked && <Check size={12}/>}</span><span className="min-w-0 flex-1"><span className="block truncate">{visibleId}</span>{(x.context || x.inputPrice !== undefined || x.outputPrice !== undefined) && <span className="block text-xs text-mu">{[x.context ? `${contextLabel(x.context)} context` : '', x.inputPrice !== undefined ? `$${x.inputPrice.toFixed(2)}/M in` : '', x.outputPrice !== undefined ? `$${x.outputPrice.toFixed(2)}/M out` : ''].filter(Boolean).join(' · ')}</span>}</span></button>})}
        {query.trim() && !models.includes(catalogId(query.trim())) && <button type="button" role="checkbox" aria-checked={searchIdea === catalogId(query.trim())} onClick={() => setSearchIdea(searchIdea === catalogId(query.trim()) ? null : catalogId(query.trim()))} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov"><span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center rounded border', searchIdea === catalogId(query.trim()) ? 'border-ac bg-ac text-acx' : 'border-mu/60')}>{searchIdea === catalogId(query.trim()) && <Check size={12}/>}</span><span className="min-w-0 truncate">Add “{catalogId(query.trim())}” model</span></button>}
      </div>
      {(selectedModels.length > 0 || searchIdea) && <button onClick={addSelected} className="self-start rounded-lg bg-ac px-3 py-2 text-xs text-acx">Add selected models ({selectedModels.length + (searchIdea ? 1 : 0)})</button>}
    </div></Modal>}
  </div>
}

function FeaturesTab() {
  const s = useSConfig()
  const F = s.features
  const setF = (id: FeatureId, on: boolean) => s.patch({ features: { ...F, [id]: on } })
  const [confirm, setConfirm] = useState<'stats' | 'memory' | null>(null)
  const toggle = (id: FeatureId, on: boolean) => {
    // Destructive-adjacent disables ask first: delete existing data or keep it dormant.
    if (!on && (id === 'stats' || id === 'memory')) { setConfirm(id); return }
    setF(id, on)
    if (id === 'widgets' && on === false) s.patch({ rail: false })
  }
  // Each feature row uses its own settings tab icon; features without a tab keep a fallback.
  const iconFor = (id: FeatureId): Ic => {
    if (id === 'library') return Library
    return TABS.find(([k]) => (FEATURE_TABS[id] ?? []).includes(k))?.[2] ?? SlidersHorizontal
  }
  const show = s.libraryShow ?? DEFAULT_LIBRARY_SHOW
  const order = (s.featureOrder ?? []).filter((id) => FEATURES.some(([f]) => f === id))
  for (const [id] of FEATURES) if (!order.includes(id)) order.push(id)
  const move = (id: FeatureId, d: number) => {
    const next = [...order], i = next.indexOf(id), j = i + d
    if (i < 0 || j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    s.patch({ featureOrder: next })
  }
  const byId = (id: FeatureId) => FEATURES.find(([f]) => f === id)!
  return (
    <Panel id="features">
      <Section title="Feature switches">
      <Anchor id="show-disabled-features">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Show disabled features</div>
        </div>
        <Toggle on={s.prefs.showDisabledFeatures === true} set={(showDisabledFeatures) => s.patch({ prefs: { ...s.prefs, showDisabledFeatures } })} label="Show disabled features" />
      </div>
      </Anchor>
      {order.map((id) => {
        const [, label, desc] = byId(id)
        return (
        <Anchor key={id} id={`feature-${id}`}>
        <Card icon={iconFor(id)} title={label} muted={!F[id]} right={<span className="flex items-center gap-1"><Btn sm icon={ArrowUp} title={`Move ${label} up`} disabled={order.indexOf(id) === 0} onClick={() => move(id, -1)} /><Btn sm icon={ArrowDown} title={`Move ${label} down`} disabled={order.indexOf(id) === order.length - 1} onClick={() => move(id, 1)} /><Toggle on={!!F[id]} set={(on) => toggle(id, on)} label={`Enable ${label}`} /></span>}>
          {id === 'library' && !!F[id] && (
            <Anchor id="library-entries">
            <Field label="Library entries">
              <div className="grid grid-cols-2 gap-2">
                {LIBRARY_ITEMS.map(([k, l]) => <Checkbox key={k} checked={show[k] ?? true} set={(v) => s.patch({ libraryShow: { ...show, [k]: v } })} label={l} />)}
              </div>
            </Field>
            </Anchor>
          )}
        </Card>
        </Anchor>
        )
      })}
      </Section>
      {confirm === 'stats' && (
        <Modal close={() => setConfirm(null)}>
          <div className="modal-panel w-full max-w-sm space-y-4 rounded-2xl bg-bg p-5">
            <div className="flex items-center gap-2 font-semibold"><TrendingUp size={18} className="text-ac" />Turn off stats?</div>
            <div className="flex flex-col gap-2">
              <Btn v="danger" onClick={() => { s.resetStats(); setF('stats', false); setConfirm(null) }}>Delete totals and turn off</Btn>
              <Btn v="soft" onClick={() => { setF('stats', false); setConfirm(null) }}>Keep totals and turn off</Btn>
              <Btn v="soft" onClick={() => setConfirm(null)}>Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
      {confirm === 'memory' && (
        <Modal close={() => setConfirm(null)}>
          <div className="modal-panel w-full max-w-sm space-y-4 rounded-2xl bg-bg p-5">
            <div className="flex items-center gap-2 font-semibold"><Brain size={18} className="text-ac" />Turn off memory?</div>
            <div className="flex flex-col gap-2">
              <Btn v="danger" onClick={() => { s.patch({ memories: [] }); setF('memory', false); setConfirm(null) }}>Delete all memories and turn off</Btn>
              <Btn v="soft" onClick={() => { setF('memory', false); setConfirm(null) }}>Keep memories and turn off</Btn>
              <Btn v="soft" onClick={() => setConfirm(null)}>Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  )
}

function HelperModels() {
  const s = useSConfig()
  const refs = {
    cls: helperRef(s.memoryPrefs.classifierEp, s.memoryPrefs.classifierModel),
    eff: helperRef(s.prefs.effortEp, s.prefs.effortModel),
    recall: helperRef(s.prefs.recallEp, s.prefs.recallModel),
    title: helperRef(s.prefs.titleEp, s.prefs.titleModel),
    compact: helperRef(s.prefs.compactEp ?? '', s.prefs.compactModel),
  }
  const unique = new Set(Object.values(refs))
  const mixed = unique.size > 1
  const main = mixed ? '__mixed__' : refs.cls
  const refLabel = (ref: string) => {
    if (!ref) return 'None'
    const [id, model] = splitHelperRef(ref)
    const e = s.eps.find((x) => x.id === id)
    if (!e) return 'Removed endpoint'
    const m = model && modelsOf(e).includes(model) ? model : e.model
    return `${e.name} · ${modelNameOf(e, m || model)}`
  }
  const opts: [string, string][] = [
    ['', 'None'],
    ...(mixed ? [['__mixed__', 'Mixed'] as [string, string]] : []),
    ...s.eps.flatMap((e) => modelsOf(e).map((m) => [`${e.id}::${m}`, `${e.name} · ${modelNameOf(e, m)}`] as [string, string])),
  ]
  const singleOpts: [string, string][] = [
    ['', 'None'],
    ...s.eps.flatMap((e) => modelsOf(e).map((m) => [`${e.id}::${m}`, `${e.name} · ${modelNameOf(e, m)}`] as [string, string])),
  ]
  const setAll = (ref: string) => {
    if (ref === '__mixed__') return
    const [ep, model] = splitHelperRef(ref)
    s.patch({ prefs: { ...s.prefs, titleEp: ep, titleModel: model, effortEp: ep, effortModel: model, recallEp: ep, recallModel: model, compactEp: ep, compactModel: model }, memoryPrefs: { ...s.memoryPrefs, classifierEp: ep, classifierModel: model } })
  }
  const setOne = (which: 'cls' | 'title' | 'eff' | 'recall' | 'compact', ref: string) => {
    const [ep, model] = splitHelperRef(ref)
    if (which === 'cls') s.patch({ memoryPrefs: { ...s.memoryPrefs, classifierEp: ep, classifierModel: model } })
    else if (which === 'title') s.patch({ prefs: { ...s.prefs, titleEp: ep, titleModel: model } })
    else if (which === 'recall') s.patch({ prefs: { ...s.prefs, recallEp: ep, recallModel: model } })
    else if (which === 'compact') s.patch({ prefs: { ...s.prefs, compactEp: ep, compactModel: model } })
    else s.patch({ prefs: { ...s.prefs, effortEp: ep, effortModel: model } })
  }
  const row = (label: string, ref: string, set: (v: string) => void) => (
    <SettingRow label={label}><div className="w-60 max-w-full"><Sel value={ref} set={set} opts={singleOpts} inline /></div></SettingRow>
  )
  return (
    <Anchor id="helper-models">
      <div className="py-1">
        <SettingRow label="Model for all helpers"><div className="w-60 max-w-full"><Sel value={main} set={setAll} opts={opts} inline /></div></SettingRow>
        <details className="group" open>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
            <span>Per-task models</span>
            <ChevronDown size={16} className="text-mu transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 pb-3">
            <div className="space-y-1">
              <p className="px-0 text-xs font-medium text-mu">Decision helpers</p>
              {row('Model routing', refs.cls, (v) => setOne('cls', v))}
              {row('Reasoning level', refs.eff, (v) => setOne('eff', v))}
              {row('Memory recall', refs.recall, (v) => setOne('recall', v))}
            </div>
            <div className="space-y-1">
              <p className="px-0 text-xs font-medium text-mu">Writing helpers</p>
              {row('Chat titles', refs.title, (v) => setOne('title', v))}
              {row('Context handoff', refs.compact, (v) => setOne('compact', v))}
            </div>
          </div>
        </details>
      </div>
    </Anchor>
  )
}
/* Paste a copied cURL command, inspect what was understood, then create the
 * endpoint. Discovery runs after the endpoint exists, so a slow or blocked
 * model list never prevents the provider from being added. */
function CurlImportModal({ close, importProvider }: { close: () => void; importProvider: (provider: CurlProvider) => Promise<string> }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [format, setFormat] = useState<'openai' | 'anthropic'>('openai')
  const [auth, setAuth] = useState<EndpointAuth>('bearer')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [done, setDone] = useState('')
  const parsed = useMemo(() => parseCurlCommand(text), [text])
  const parsedKey = parsed.ok ? [parsed.provider.baseUrl, parsed.provider.type, parsed.provider.auth, parsed.provider.key, parsed.provider.model].join('\n') : ''
  useEffect(() => {
    if (!parsed.ok) return
    setName(parsed.provider.name)
    setFormat(parsed.provider.type)
    setAuth(parsed.provider.auth)
  }, [parsedKey])
  useEffect(() => { setTestResult(null) }, [text])
  const draftEndpoint = () => {
    if (!parsed.ok) return null
    return {
      ...BLANK.eps(),
      name: name.trim() || parsed.provider.name,
      type: format,
      url: parsed.provider.baseUrl,
      key: parsed.provider.key,
      auth,
      headers: headerBlockOf(parsed.provider.headers),
      model: parsed.provider.model,
    }
  }
  const testIt = async () => {
    if (!parsed.ok || busy || testing) return
    const endpoint = draftEndpoint()
    if (!endpoint || !endpoint.model) {
      setTestResult({ ok: false, text: 'Add a model id before testing the connection.' })
      return
    }
    setTesting(true)
    setTestResult(null)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 20_000)
    try {
      const out = await stream(endpoint, '', [{ role: 'user', content: 'Reply with exactly: OK' }], () => {}, ac, { cap: 24, temp: 0 })
      setTestResult({ ok: true, text: out.text.trim().slice(0, 300) || '(connected, but the reply was empty)' })
    } catch (err: any) {
      setTestResult({ ok: false, text: err?.message || 'The connection test failed.' })
    } finally {
      clearTimeout(timer)
      setTesting(false)
    }
  }
  const importIt = async () => {
    if (!parsed.ok || busy) return
    setBusy(true)
    try {
      const message = await importProvider({ ...parsed.provider, name: name.trim() || parsed.provider.name, type: format, auth })
      setDone(message)
    } catch (err: any) {
      setDone(`Could not add the provider: ${err?.message ?? 'unknown error'}`)
    } finally { setBusy(false) }
  }
  const mask = (key: string) => !key ? 'No key found' : `••••${key.slice(-4)}`
  return <Modal close={close} label="Add provider from cURL">
    <div className="modal-panel flex max-h-[88dvh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-bg p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Terminal size={18} className="text-ac" />Add provider from cURL</h3>

        </div>
        <button onClick={close} className="grid size-8 shrink-0 place-items-center rounded-lg text-mu hover:bg-hov hover:text-tx" aria-label="Close cURL importer"><X size={16} /></button>
      </div>
      {done ? <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl bg-surf p-3 text-sm"><CircleCheck size={18} className="mt-0.5 shrink-0 text-ac" /><span>{done}</span></div>
        <div className="flex justify-end gap-2"><Btn v="soft" onClick={() => { setDone(''); setText(''); setName('') }}>Add another</Btn><Btn v="solid" onClick={close}>Close</Btn></div>
      </div> : <>
        <Area rows={8} value={text} set={setText} spellCheck={false} placeholder={`curl https://api.example.com/v1/chat/completions \\\n  -H "Authorization: Bearer sk-..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"example-model","messages":[{"role":"user","content":"Hi"}]}'`} className="w-full resize-y rounded-lg bg-surf px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ac/40" />
        {text.trim() && !parsed.ok && <p className="rounded-lg bg-er/10 p-2.5 text-sm text-er">{parsed.error}</p>}
        {parsed.ok && <div className="space-y-3 rounded-xl bg-surf p-3">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <label className="space-y-1 text-xs text-mu">Provider name<input value={name} onChange={(ev) => setName(ev.target.value)} className="w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-tx outline-none focus:ring-2 focus:ring-ac/40" /></label>
            <div className="space-y-1 text-xs text-mu">API format<Seg v={format} set={setFormat} opts={[['openai', 'OpenAI'], ['anthropic', 'Anthropic']]} /></div>
            <div className="space-y-1 text-xs text-mu sm:col-span-2">Base URL<div className="truncate rounded-lg bg-bg px-2.5 py-2 font-mono text-xs text-tx">{parsed.provider.baseUrl}</div></div>
            <div className="space-y-1 text-xs text-mu">API key<div className="rounded-lg bg-bg px-2.5 py-2 font-mono text-xs text-tx">{mask(parsed.provider.key)}</div></div>
            <div className="space-y-1 text-xs text-mu">Model<div className="truncate rounded-lg bg-bg px-2.5 py-2 font-mono text-xs text-tx">{parsed.provider.model || 'Not set'}</div></div>
            <div className="space-y-1 text-xs text-mu">Auth<Sel value={auth} set={(v) => setAuth(v as EndpointAuth)} opts={ENDPOINT_AUTH_OPTIONS} placeholder="Choose auth" /></div>
            <div className="space-y-1 text-xs text-mu">Extra headers<div className="rounded-lg bg-bg px-2.5 py-2 text-sm text-tx">{Object.keys(parsed.provider.headers).length ? `${Object.keys(parsed.provider.headers).length} custom header${Object.keys(parsed.provider.headers).length === 1 ? '' : 's'}` : 'None'}</div></div>
          </div>
          {!!parsed.provider.warnings.length && <ul className="space-y-1 text-xs text-mu">{parsed.provider.warnings.map((warning, i) => <li key={i} className="flex gap-1.5"><span className="text-c3">•</span><span>{warning}</span></li>)}</ul>}
          {testResult && <div className={cx('flex items-start gap-2 rounded-lg p-2.5 text-sm', testResult.ok ? 'bg-ac/10 text-ac' : 'bg-er/10 text-er')}>{testResult.ok ? <CircleCheck size={16} className="mt-0.5 shrink-0" /> : <CircleX size={16} className="mt-0.5 shrink-0" />}<span className="min-w-0 break-words">{testResult.ok ? `Connected. Reply: ${testResult.text}` : testResult.text}</span></div>}
        </div>}
        <div className="flex flex-wrap justify-end gap-2"><Btn v="soft" onClick={close}>Cancel</Btn><Btn v="soft" icon={Play} disabled={!parsed.ok || busy || testing || !parsed.provider.model} onClick={testIt}>{testing ? 'Testing…' : 'Test connection'}</Btn><Btn v="solid" icon={Plus} disabled={!parsed.ok || busy || testing} onClick={importIt}>{busy ? 'Adding…' : 'Add provider'}</Btn></div>
      </>}
    </div>
  </Modal>
}

function Eps() {
  const { eps, upd } = useSConfig()
  const s = useSConfig()
  // Warm every enabled endpoint's catalog while the tab is being read, so
  // opening a model editor is instant instead of a fresh network wait.
  useEffect(() => { for (const e of eps) if (e.on !== false && e.url) prefetchModelCatalog(e) }, [eps])
  const [show, setShow] = useState('')
  const [editingName, setEditingName] = useState('')
  const [advanced, setAdvanced] = useState<string[]>([])
  const [curlOpen, setCurlOpen] = useState(false)
  const catalogPrefs = (endpointId: string) => Object.values(PRE).find((x) => x[2] && x[2] === endpointId)?.[3] ?? 'author'
  const selectPreset = (id: string, name: string) => {
    const [type, url, endpointId, endpointFilter] = PRE[name]
    upd('eps', id, { preset: name, type, url, name, endpointId, endpointFilter })
  }
  const addCompatible = (type: 'openai' | 'anthropic') => {
    const endpoint = {
      ...BLANK.eps(),
      name: type === 'anthropic' ? 'Anthropic-compatible' : 'OpenAI-compatible',
      type,
      preset: type === 'anthropic' ? 'Other Anthropic-compatible' : 'Other OpenAI-compatible',
    }
    // New quick-adds land at the top so the new card is visible immediately.
    const state = useS.getState()
    state.patch({ eps: [endpoint, ...state.eps] })
  }
  const importCurl = async (provider: CurlProvider): Promise<string> => {
    const endpoint = {
      ...BLANK.eps(),
      name: provider.name,
      type: provider.type,
      url: provider.baseUrl,
      key: provider.key,
      auth: provider.auth,
      headers: headerBlockOf(provider.headers),
      model: provider.model,
      models: provider.model ? [provider.model] : [''],
      preset: provider.type === 'anthropic' ? 'Other Anthropic-compatible' : 'Other OpenAI-compatible',
    }
    const state = useS.getState()
    state.patch({ eps: [endpoint, ...state.eps] })
    const found = await discoverEndpointModels(endpoint, providerFetch)
    const live = useS.getState().eps.find((x) => x.id === endpoint.id)
    if (!live) return 'The endpoint was added, then removed before discovery finished.'
    const ids = found.entries.map((x) => x.id).filter(Boolean)
    if (provider.model && !ids.includes(provider.model)) ids.unshift(provider.model)
    const models = ids.length ? [...new Set(ids)] : (provider.model ? [provider.model] : [''])
    const names = Object.fromEntries(found.entries.filter((x) => x.name).map((x) => [x.id, x.name]))
    const contexts = Object.fromEntries(found.entries.filter((x) => x.context && x.context > 0).map((x) => [x.id, x.context!]))
    s.upd('eps', endpoint.id, {
      ...modelListEdit({ ...live, models: live.models ?? endpoint.models }, models, Date.now(), provider.model || models[0] || ''),
      ...(Object.keys(names).length ? { modelNames: { ...live.modelNames, ...names } } : {}),
      ...(Object.keys(contexts).length ? { modelContext: { ...live.modelContext, ...contexts } } : {}),
    })
    if (found.entries.length) return `Added ${provider.name}. Found ${found.entries.length} model${found.entries.length === 1 ? '' : 's'} at ${found.workingUrl}.`
    return `Added ${provider.name}. ${found.error || 'No model list was found.'} The model from the cURL command is still ready to use, and failed model-list URLs are cached so they are not retried.`
  }
  const quickActions = <div className="flex flex-wrap gap-2">
    <AddEndpointSplit onAdd={addCompatible} />
    <Btn v="soft" icon={Terminal} onClick={() => setCurlOpen(true)}>Add provider from cURL</Btn>
  </div>
  return (
    <Panel id="eps" n={eps.length}>
      <Section title="Endpoints">
      <Anchor id="add-endpoint">{quickActions}</Anchor>
      <SortableCards k="eps" ids={eps.map((x) => x.id)} label="Endpoint" renderCard={(eid, handle) => {
        const e = eps.find((x) => x.id === eid)
        if (!e) return null
        const u = (p: object) => upd('eps', e.id, p)
        const provider = resolveProvider({ preset: e.preset, url: e.url })
        return (
          <Anchor key={eid} id={`ep-${e.id}`}>
          <Card handle={handle} icon={Server} title={editingName === e.id
            ? <input autoFocus value={e.name} onChange={(ev) => u({ name: ev.target.value })} onBlur={() => setEditingName('')} onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); setEditingName('') } }} onClick={(ev) => ev.stopPropagation()} aria-label="Endpoint name" className="w-full min-w-0 rounded-md bg-bg px-2 py-1 font-medium outline-none focus:ring-2 focus:ring-ac/40" />
            : <span className="inline-flex min-w-0 items-center gap-1.5"><span className="truncate">{e.name}</span><button type="button" title="Rename endpoint" aria-label="Rename endpoint" onClick={(ev) => { ev.stopPropagation(); setEditingName(e.id) }} className="grid size-6 shrink-0 place-items-center rounded-sm text-mu hover:bg-hov hover:text-tx"><Pencil size={13}/></button></span>} sub={e.model || 'No model id'} open0={!e.model && !e.key} muted={!e.on} right={<Toggle on={e.on} set={(v) => u({ on: v })} label={`Enable ${e.name}`} />}>
            <div className="space-y-3">
              <Anchor id="models"><section className="space-y-3 rounded-xl bg-bg p-3">
              <Field label="Preset"><SearchSelect ariaLabel="Endpoint preset" value={e.preset ?? presetForUrl(e.url)?.[0] ?? ''} set={(v) => v ? selectPreset(e.id, v) : u({ preset: '', endpointId: '', endpointFilter: 'author' })} opts={[[ '', 'Choose a preset'], ...Object.keys(PRE).map((k) => [k, k] as [string, string])]} placeholder="Search endpoints" /></Field>
              <Field label="Models">
                <ModelsEditor e={e} update={u} />
              </Field>
              <Anchor id="model-behavior"><Field label="Model behavior" row>
                <Seg v={e.modelsMode ?? 'separate'} set={(modelsMode) => u({ modelsMode })} opts={[["separate", "Separate models"], ["playlist", "Treat as playlist"]]} />
              </Field></Anchor>
              </section></Anchor>
              <Anchor id="credentials"><section className="space-y-3 rounded-xl bg-bg p-3"><div className="text-sm font-medium">Credentials</div>
              <Field label="API key">
                <div className="relative">
                  <Input aria-label="Endpoint API key" type={show === e.id ? 'text' : 'password'} value={e.key} set={(v) => u({ key: v })} placeholder="Leave empty for local servers" />
                  <button onClick={() => setShow(show === e.id ? '' : e.id)} aria-label={show === e.id ? 'Hide API key' : 'Show API key'} title={show === e.id ? 'Hide API key' : 'Show API key'} className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{show === e.id ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </Field>
              {!provider && <Field label="Auth method" row>
                <Sel value={endpointAuthOf(e)} set={(v) => u({ auth: v as EndpointAuth })} opts={ENDPOINT_AUTH_OPTIONS} placeholder="Choose auth" />
              </Field>}
              <Field label="Extra headers">
                <Area rows={3} value={e.headers ?? ''} set={(v) => u({ headers: v })} placeholder={'HTTP-Referer: https://example.com\nX-Title: BYOK Chat'} className="font-mono text-xs" spellCheck={false} />
              </Field>
              </section></Anchor>
              <Anchor id="advanced-connection"><details open={advanced.includes(e.id)} onToggle={(ev) => { const isOpen = ev.currentTarget.open; setAdvanced(current => isOpen ? [...new Set([...current, e.id])] : current.filter(id => id !== e.id)) }} className="rounded-xl bg-bg px-3"><summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-mu"><span>Advanced connection settings</span><ChevronRight size={16} aria-hidden="true" className={cx('transition-transform', advanced.includes(e.id) && 'rotate-90')} /></summary><div className="space-y-3 pb-3">
                <Field label="Base URL"><Input value={e.url} set={(v) => { const match = presetForUrl(v); u({ url: v, ...(match ? { preset: match[0], endpointId: match[1][2], endpointFilter: match[1][3] } : { preset: '', endpointId: '', endpointFilter: 'author' }) }) }} placeholder="https://…/v1" /></Field>
                <Field label="API format" row><Seg label="API format" v={e.type} set={(v) => u({ type: v })} opts={[[ 'openai', 'OpenAI-compatible'], ['anthropic', 'Anthropic Messages']]} /></Field>
                <Field label="Endpoint ID"><Input value={e.endpointId ?? presetForUrl(e.url)?.[1][2] ?? ''} set={(endpointId) => u({ endpointId, endpointFilter: catalogPrefs(endpointId) })} placeholder="e.g. anthropic" /></Field>
                {provider?.accountScoped && <Field label="Account ID"><Input value={e.accountId ?? ''} set={(accountId) => u({ accountId })} placeholder="Cloudflare account ID" /></Field>}
                {provider?.gatewayHeader && <Field label={provider.gatewayHeader.label}><Input value={e.gatewayId ?? ''} set={(gatewayId) => u({ gatewayId })} placeholder="Optional AI Gateway id" /></Field>}
                <Field label="Request routing" row>
                  <Seg label="Request routing" v={(s.prefs.proxyMode ?? 'auto') as 'auto' | 'always' | 'off'} set={(v) => s.patch({ prefs: { ...s.prefs, proxyMode: v } })} opts={[['auto', 'Auto'], ['always', 'Always relay'], ['off', 'Direct only']]} />
                </Field>
              </div></details></Anchor>
            </div>
            {useS.getState().prefs.showModelPricing && modelsOf(e).length > 0 && <Anchor id="model-pricing"><div className="space-y-3 rounded-xl bg-bg p-3">
              <div className="text-sm font-medium">Model pricing</div>
              {modelsOf(e).map((model) => {
                const price = e.prices?.[model] ?? { input: 0, output: 0 }
                const detect = async () => {
                  try {
                    const base = e.url.trim().replace(/\/+$/, '')
                    const res = await providerFetch(`${base}/models`, { headers: e.key ? { authorization: `Bearer ${e.key}` } : {} })
                    if (!res.ok) throw Error(`Catalog request failed (HTTP ${res.status})`)
                    const body = await res.json()
                    const item = body.data?.find((x: any) => x.id === model)
                    if (!item?.pricing?.prompt || !item?.pricing?.completion) throw Error('This model has no published token pricing in the catalog.')
                    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
                    // Re-read after the fetch: prices edited while it was in
                    // flight must not be overwritten by the stale snapshot.
                    const cur = useS.getState().eps.find((x) => x.id === e.id) ?? e
                    // OpenRouter publishes the cache rates alongside the base
                    // ones; keep them so cached prompt tokens can be billed at
                    // their real (discounted / surcharged) price.
                    const read = Number(item.pricing.input_cache_read ?? 0) * 1e6
                    const write = Number(item.pricing.input_cache_write ?? 0) * 1e6
                    u({ prices: { ...cur.prices, [model]: { input: round2(Number(item.pricing.prompt) * 1e6), output: round2(Number(item.pricing.completion) * 1e6), source: 'openrouter', ...(read > 0 ? { cacheRead: round2(read) } : {}), ...(write > 0 ? { cacheWrite: round2(write) } : {}) } }, ...(Number(item.context_length) > 0 ? { modelContext: { ...cur.modelContext, [model]: Number(item.context_length) } } : {}) })
                  } catch (x: any) { useS.getState().patch({ notice: { t: x?.message ?? 'Could not detect a price.' } }) }
                }
                const setPrice = (kind: 'input' | 'output', value: string) => u({ prices: { ...e.prices, [model]: { ...price, [kind]: Math.max(0, Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100), source: 'manual' } } })
                // Cache rates are optional: clearing a field deletes the key so
                // prices fall back to the plain input rate again.
                const setCache = (kind: 'cacheRead' | 'cacheWrite', value: string) => {
                  const next: ModelPrice = { ...price }
                  if (value.trim() === '') delete next[kind]
                  else next[kind] = Math.max(0, Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100)
                  u({ prices: { ...e.prices, [model]: next } })
                }
                return <div key={model} className="rounded-lg bg-surf p-3">
                  <div className="mb-2 truncate text-sm font-medium">{model}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-mu">Input $/1M<input type="number" min="0" step="0.01" value={price.input} onChange={(ev) => setPrice('input', ev.target.value)} className="mt-1 w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-tx" /></label>
                    <label className="text-xs text-mu">Output $/1M<input type="number" min="0" step="0.01" value={price.output} onChange={(ev) => setPrice('output', ev.target.value)} className="mt-1 w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-tx" /></label>
                    <label className="text-xs text-mu">Cache read $/1M<input type="number" min="0" step="0.01" value={price.cacheRead ?? ''} placeholder={String(price.input)} onChange={(ev) => setCache('cacheRead', ev.target.value)} className="mt-1 w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-tx" /></label>
                    <label className="text-xs text-mu">Cache write $/1M<input type="number" min="0" step="0.01" value={price.cacheWrite ?? ''} placeholder={String(price.input)} onChange={(ev) => setCache('cacheWrite', ev.target.value)} className="mt-1 w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-tx" /></label>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-mu">{price.source === 'openrouter' || price.source === 'provider' ? 'Detected price' : e.prices?.[model] ? 'Entered manually' : 'No price set'}</span>{/openrouter\.ai/i.test(e.url) && <Btn sm icon={Search} onClick={detect}>Auto-detect</Btn>}</div>
                </div>
              })}
            </div></Anchor>}
            <Anchor id="test-connection"><TestRow e={e} /></Anchor>
            <Acts k="eps" id={e.id} />
          </Card>
          </Anchor>
        )
      }} />
      {!!eps.length && <TestAllEndpoints eps={eps} />}
      </Section>
      <Section title="Helper models">
        <HelperModels />
        <Anchor id="model-pricing-toggle">
          <SettingRow label="Show model pricing controls"><Toggle on={s.prefs.showModelPricing} set={(showModelPricing) => s.patch({ prefs: { ...s.prefs, showModelPricing } })} label="Show model pricing controls" /></SettingRow>
        </Anchor>
      </Section>
      {curlOpen && <CurlImportModal close={() => setCurlOpen(false)} importProvider={importCurl} />}
    </Panel>
  )
}



/* The {variable} placeholders a system prompt can use, described in the
 * help tooltip instead of insert buttons. */

function QualityEditor({ initial, existingIds, close, save }: { initial?: Quality; existingIds: string[]; close: () => void; save: (q: Quality) => void }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [desc, setDesc] = useState(initial?.desc ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const [effort, setEffort] = useState<'none' | 'lowest' | 'highest'>(initial?.effect?.effort ?? 'none')
  const [skillsOff, setSkillsOff] = useState(initial?.effect?.skillsOff === true)
  const [safetyAsk, setSafetyAsk] = useState(initial?.effect?.safety === 'ask')
  const ok = label.trim().length > 0
  const submit = () => {
    if (!ok) return
    const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `quality-${uid()}`
    let id = initial?.id ?? base
    if (!initial) {
      let n = 2
      while (existingIds.includes(id)) id = `${base}-${n++}`
    }
    const effect = {
      ...(effort !== 'none' ? { effort } : {}),
      ...(skillsOff ? { skillsOff: true } : {}),
      ...(safetyAsk ? { safety: 'ask' as const } : {}),
    }
    save({ id, label: label.trim().slice(0, 60), desc: desc.trim().slice(0, 200), text, ...(Object.keys(effect).length ? { effect } : {}) })
  }
  return (
    <Modal close={close} label={initial ? `Edit ${initial.label}` : 'Add a quality'}>
      <div className="modal-panel flex max-h-[85dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl bg-bg p-5">
        <div className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-ac" />{initial ? 'Edit quality' : 'New quality'}</div>
        <Field label="Name"><Input value={label} set={setLabel} placeholder="e.g. Evidence-led" maxLength={60} /></Field>
        <Field label="Short description"><Input value={desc} set={setDesc} placeholder="What this quality changes" maxLength={200} /></Field>
        <Field label="Prompt addition"><Area rows={6} value={text} set={setText} placeholder="Write the instruction the model should always follow…" /></Field>
        <Field label="Reasoning effort"><Seg v={effort} set={setEffort} opts={[['none', 'Model default'], ['lowest', 'Lowest'], ['highest', 'Highest']]} /></Field>
        <div className="flex items-center justify-between gap-3 text-sm"><span>Turn off all skills</span><Toggle on={skillsOff} set={setSkillsOff} label="Turn off all skills" /></div>
        <div className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 flex-1">Always ask before using a tool</span><Toggle on={safetyAsk} set={setSafetyAsk} label="Always ask before using a tool" /></div>
        <div className="flex justify-end gap-2 pt-1"><Btn v="soft" onClick={close}>Cancel</Btn><Btn v="solid" disabled={!ok} onClick={submit}>{initial ? 'Save quality' : 'Add quality'}</Btn></div>
      </div>
    </Modal>
  )
}

function QualitiesTab() {
  const { prompts, upd, patch, globalPrompt } = useSConfig()
  const prefs = useS((s) => s.prefs)
  const qualityList = useS((s) => s.qualities)
  const [editQ, setEditQ] = useState<Quality | 'new' | null>(null)
  const g = globalPrompt ?? { on: false, text: '', qualities: [] }
  const qualities = g.qualities ?? []
  const setG = (v: Partial<GlobalPrompt>) => patch({ globalPrompt: { ...g, ...v } })
  const favs = normQualityFavs(prefs.qualityFavs, qualityList.map((q) => q.id))
  const isFav = (id: string) => favs.includes(id)
  const toggleFav = (id: string) => {
    const next = isFav(id) ? favs.filter((x) => x !== id) : [...favs, id]
    patch({ prefs: { ...prefs, qualityFavs: next } })
  }
  const toggleQuality = (id: PromptQuality) => {
    const on = qualities.includes(id)
    setG({ qualities: on ? qualities.filter((x) => x !== id) : [...qualities, id] })
  }
  const moveQuality = (id: string, delta: number) => {
    const from = qualityList.findIndex((q) => q.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= qualityList.length) return
    const next = [...qualityList]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    patch({ qualities: next })
  }
  const saveQuality = (q: Quality) => {
    const exists = qualityList.some((x) => x.id === q.id)
    patch({ qualities: exists ? qualityList.map((x) => (x.id === q.id ? q : x)) : [...qualityList, q] })
    setEditQ(null)
  }
  return (
    <Panel id="prompts">
      <Section title="System prompt">
        <Anchor id="global-prompt">
          <div className="space-y-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 text-sm">Global system prompt</div>
              <button type="button" aria-pressed={isFav('global')} onClick={() => toggleFav('global')} title={isFav('global') ? 'Remove from the composer' : 'Pin to the composer for quick switching'} className={cx('grid size-9 shrink-0 place-items-center rounded-lg border transition-colors', isFav('global') ? 'border-ac/50 bg-ac/10 text-ac' : 'border-bor text-mu hover:bg-hov hover:text-tx')}><Star size={16} fill={isFav('global') ? 'currentColor' : 'none'} /></button>
              <Toggle on={g.on} set={(on) => setG({ on })} label="Apply global prompt to every message" />
            </div>
            <Field label="Prompt text">
              <Area rows={8} value={g.text} set={(v) => setG({ text: v })} className="border border-bor bg-bg" />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="shrink-0 text-sm">Copy from</span>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <div className="w-64 max-w-full">
                  <Sel value="" set={(v) => { const p = prompts.find((x) => x.id === v); if (p) setG({ text: p.text }) }} opts={[['', 'Choose a chat prompt…'], ...prompts.map((p) => [p.id, p.name] as [string, string])]} inline />
                </div>
                <Btn v="soft" icon={CornerDownRight} onClick={() => setG({ on: true, text: GENERAL_PROMPT_TEXT, qualities: [] })}>Revert to default</Btn>
              </div>
            </div>
          </div>
        </Anchor>
      </Section>

      <Section title="Qualities">
        <Anchor id="qualities">
          <div className="py-4">
            <div className="mb-3 flex justify-end">
              <Btn v="soft" icon={Plus} onClick={() => setEditQ('new')}>Add quality</Btn>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {qualityList.map((q, qi) => {
                const on = qualities.includes(q.id)
                const fav = isFav(q.id)
                const effect = q.effect
                return (
                  <div
                    key={q.id}
                    role="switch"
                    aria-checked={on}
                    tabIndex={0}
                    onClick={() => toggleQuality(q.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleQuality(q.id) } }}
                    className={cx('flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ac/40', on ? 'border-ac/50 bg-ac/[0.06]' : 'border-bor bg-surf/40 hover:bg-hov/60')}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cx('grid size-4 shrink-0 place-items-center rounded border transition-colors', on ? 'border-ac bg-ac text-acx' : 'border-bor bg-bg')}>{on && <Check size={11} strokeWidth={3} />}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{q.label}</span>
                      <button type="button" aria-label={`Move ${q.label} up`} disabled={qi === 0} onClick={(e) => { e.stopPropagation(); moveQuality(q.id, -1) }} title="Move up" className="grid size-6 shrink-0 place-items-center rounded-md text-mu/70 transition-colors hover:bg-hov hover:text-tx disabled:cursor-not-allowed disabled:opacity-25"><ArrowUp size={13} /></button>
                      <button type="button" aria-label={`Move ${q.label} down`} disabled={qi === qualityList.length - 1} onClick={(e) => { e.stopPropagation(); moveQuality(q.id, 1) }} title="Move down" className="grid size-6 shrink-0 place-items-center rounded-md text-mu/70 transition-colors hover:bg-hov hover:text-tx disabled:cursor-not-allowed disabled:opacity-25"><ArrowDown size={13} /></button>
                      <button type="button" aria-pressed={fav} aria-label={fav ? `Unpin ${q.label}` : `Pin ${q.label} to the composer`} onClick={(e) => { e.stopPropagation(); toggleFav(q.id) }} title={fav ? 'Pinned to the composer' : 'Pin to the composer'} className={cx('grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-hov', fav ? 'text-ac' : 'text-mu/70 hover:text-tx')}><Star size={14} fill={fav ? 'currentColor' : 'none'} /></button>
                      <button type="button" aria-label={`Edit ${q.label}`} onClick={(e) => { e.stopPropagation(); setEditQ(q) }} title="Edit quality" className="grid size-6 shrink-0 place-items-center rounded-md text-mu/70 transition-colors hover:bg-hov hover:text-tx"><Pencil size={13} /></button>
                    </div>
                    <p className="text-xs leading-relaxed text-mu">{q.desc}</p>
                    {(effect?.effort || effect?.skillsOff || effect?.safety) && (
                      <div className="mt-auto flex flex-wrap gap-1.5 pt-0.5">
                        {effect.effort && <span className="rounded-md bg-bg px-1.5 py-0.5 text-[11px] text-mu">{effect.effort === 'highest' ? 'Highest reasoning' : 'Lowest reasoning'}</span>}
                        {effect.skillsOff && <span className="rounded-md bg-bg px-1.5 py-0.5 text-[11px] text-mu">Skills off</span>}
                        {effect.safety === 'ask' && <span className="rounded-md bg-bg px-1.5 py-0.5 text-[11px] text-mu">Always asks</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </Anchor>
      </Section>

      {editQ && <QualityEditor key={editQ === 'new' ? 'new' : editQ.id} {...(editQ === 'new' ? {} : { initial: editQ })} existingIds={qualityList.map((q) => q.id)} close={() => setEditQ(null)} save={saveQuality} />}

      <Section>
        <div className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Reusable prompts</p>

          </div>
          <Btn v="soft" icon={Plus} onClick={() => useS.getState().add('prompts')}>Add prompt</Btn>
        </div>
        <SortableCards k="prompts" ids={prompts.map((x) => x.id)} label="Prompt" renderCard={(pid, handle) => {
          const p = prompts.find((x) => x.id === pid)
          if (!p) return null
          return (
            <Anchor key={pid} id={`prompt-${p.id}`}>
              <Card handle={handle} icon={ScrollText} title={p.name} sub={p.text.slice(0, 70)}>
                <Field label="Name"><Input value={p.name} set={(v) => upd('prompts', p.id, { name: v })} /></Field>
                <Field label="System prompt"><Area rows={6} value={p.text} set={(v) => upd('prompts', p.id, { text: v })} /></Field>
                <Acts k="prompts" id={p.id} />
              </Card>
            </Anchor>
          )
        }} />
      </Section>
    </Panel>
  )
}
function Pls() {
  const { pls, eps, upd } = useSConfig()
  const routingMode = useS((s) => s.prefs.routingMode ?? 'ordered')
  const routeStats = useS((s) => s.routeStats ?? {})
  const statRows = Object.entries(routeStats)
    .map(([key, st]) => {
      const [epId, ...rest] = key.split('::')
      const e = eps.find((x) => x.id === epId)
      return { key, name: e ? `${e.name} · ${rest.join('::')}` : key, ...st, avg: st.calls ? Math.round(st.ms / st.calls) : 0 }
    })
    .sort((a, b) => b.calls - a.calls)
  return (
    <Panel id="pls" k="pls" add="Add playlist">
      <Section>
      {!pls.length && <p className="py-6 text-center text-sm text-mu">No playlists yet.</p>}
      <SortableCards k="pls" ids={pls.map((x) => x.id)} label="Playlist" renderCard={(plid, handle) => {
        const p = pls.find((x) => x.id === plid)
        if (!p) return null
        const u = (x: object) => upd('pls', p.id, x)
        return (
          <Anchor key={plid} id={`playlist-${p.id}`}>
          <Card handle={handle} icon={ListMusic} title={p.name} sub={`${p.e.length} entries${p.cls ? ' · classifier' : ''}`}>
            <Field label="Name"><Input value={p.name} set={(v) => u({ name: v })} /></Field>
            <Field label="System prompt"><Area value={p.sys} set={(v) => u({ sys: v })} /></Field>
            <Field label="Models">
              <div className="space-y-1.5">
                <SortableList
                  ids={(() => { const seen = new Map<string, number>(); return p.e.map((r) => { const n = (seen.get(r) ?? 0) + 1; seen.set(r, n); return `${p.id}#${n}#${r}` }) })()}
                  onCommit={(from, to) => { if (from === to) return; const a = [...p.e]; const [x] = a.splice(from, 1); a.splice(to, 0, x); u({ e: a }) }}
                  label="Playlist entry"
                  className="space-y-1.5"
                  renderItem={(iid, entryApi) => {
                    const idsNow: string[] = (() => { const seen = new Map<string, number>(); return p.e.map((r) => { const n = (seen.get(r) ?? 0) + 1; seen.set(r, n); return `${p.id}#${n}#${r}` }) })()
                    const i = idsNow.indexOf(iid)
                    const ref = p.e[i]
                    if (i < 0 || ref == null) return null
                    const [id, model] = ref.includes('::') ? [ref.slice(0, ref.indexOf('::')), ref.slice(ref.indexOf('::') + 2)] : [ref, '']
                    const e = eps.find((x) => x.id === id)
                    return (
                      <div className="flex items-center gap-2 rounded-lg bg-bg px-2 py-1.5 text-sm">
                        <span {...entryApi.handleProps('Reorder playlist entry')} title="Drag to reorder" className="dnd-handle cursor-grab text-mu"><GripVertical size={16} /></span><span className="w-5 text-mu">{i + 1}</span><Cpu size={15} className="text-mu" />
                        <span className="flex-1 truncate">{e?.name ?? 'Removed endpoint'}<span className="ml-2 text-mu">{model || 'All models'}</span></span>
                        <Btn sm icon={X} title="Remove entry" onClick={() => u({ e: p.e.filter((x) => x !== ref) })} />
                      </div>
                    )
                  }}
                />
                <Sel value="" set={(v) => v && u({ e: [...p.e, v] })} opts={[['', 'Add model…'], ...eps.flatMap((ep) => modelsOf(ep).map((model) => [`${ep.id}::${model}`, `${ep.name} · ${model}`] as [string, string])).filter(([ref]) => !p.e.includes(ref))]} />
              </div>
            </Field>
            <div className="space-y-3 rounded-xl bg-bg p-3">
              <Anchor id="classifier-routing"><div className="flex items-center gap-2 text-sm font-medium"><Route size={16} className="text-ac" />Classifier routing</div></Anchor>
              <Field label="Classifier endpoint" row>
                <Sel value={p.cls} set={(v) => u({ cls: v })} opts={[[ '', useS.getState().memoryPrefs.classifierEp ? 'None, use helper model' : 'None, use list order'], ...eps.map((e) => [e.id, e.name] as [string, string])]} />
              </Field>
              {p.cls && eps.find((e) => e.id === p.cls) && <Field label="Classifier model" row><Sel value={p.clsModel ?? ""} set={(v) => u({ clsModel: v })} opts={[["", "Default model"], ...modelsOf(eps.find((e) => e.id === p.cls)!).map((model) => [model, modelNameOf(eps.find((e) => e.id === p.cls)!, model) + " · " + model] as [string, string])]} /></Field>}
              <Field label="Routing instructions"><Area rows={3} value={p.rule} set={(v) => u({ rule: v })} /></Field>
            </div>
            <Acts k="pls" id={p.id} />
          </Card>
          </Anchor>
        )
      }} />
      </Section>
      <Section title="Routing">
      <Anchor id="routing-mode"><Card icon={Route} title="Routing mode">
        <Field label="Candidate order" row>
          <Seg v={routingMode} set={(v) => useS.getState().patch({ prefs: { ...useS.getState().prefs, routingMode: v as typeof routingMode } })} opts={[['ordered', 'Ordered'], ['fastest', 'Fastest'], ['cheapest', 'Cheapest']]} />
        </Field>
        <div className="space-y-1">
          <Anchor id="observed-performance"><div className="flex items-center justify-between"><span className="text-sm font-medium">Observed performance</span><Btn v="soft" disabled={!statRows.length} onClick={() => useS.getState().patch({ routeStats: {} })}>Reset</Btn></div></Anchor>
          {statRows.slice(0, 12).map((r) => (
            <div key={r.key} className="flex items-center gap-2 rounded-lg bg-bg px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-mu">{r.calls} tries · {r.fails} failed · ~{r.avg} ms</span>
            </div>
          ))}
        </div>
      </Card></Anchor>
      </Section>
    </Panel>
  )
}

function Cmds() {
  const { cmds, pls, upd } = useSConfig()
  return (
    <Panel id="cmds" k="cmds" add="Add command">
      <Section>
      {!cmds.length && <p className="py-6 text-center text-sm text-mu">No commands yet.</p>}
      <SortableCards k="cmds" ids={cmds.map((x) => x.id)} label="Command" renderCard={(cid, handle) => {
        const c = cmds.find((x) => x.id === cid)
        if (!c) return null
        const u = (x: object) => upd('cmds', c.id, x)
        return (
          <Anchor key={cid} id={`command-${c.id}`}>
          <Card handle={handle} icon={CI[c.in]} title={'/' + c.name} sub={c.desc || c.in} muted={!c.on} right={<Toggle on={c.on} set={(v) => u({ on: v })} label={`Enable /${c.name}`} />}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name"><Input value={c.name} set={(v) => u({ name: v.replace(/[^\w-]/g, '') })} /></Field>
              <Field label="Description"><Input value={c.desc} set={(v) => u({ desc: v })} /></Field>
              <Field label="Argument hint"><Input value={c.args ?? ''} set={(v) => u({ args: v })} placeholder="<topic>" /></Field>
            </div>
            <Field label="Input type" row><Seg v={c.in} set={(v) => u({ in: v })} opts={[['text', 'Text', CI.text], ['image', 'Image', CI.image], ['image+text', 'Image + text', CI['image+text']], ['doc', 'Document', CI.doc]]} /></Field>
            <Field label="System prompt"><Area value={c.sys} set={(v) => u({ sys: v })} /></Field>
            <Field label="Message template"><Area rows={3} value={c.tpl} set={(v) => u({ tpl: v })} /></Field>
            <Field label="Run on" row>
              <Sel value={c.pl} set={(v) => u({ pl: v })} opts={[['', 'Any enabled endpoint, in list order'], ...pls.map((p) => [p.id, 'Playlist: ' + p.name] as [string, string])]} />
            </Field>
            <Acts k="cmds" id={c.id} />
          </Card>
          </Anchor>
        )
      }} />
      </Section>
    </Panel>
  )
}

function ToolLimitCard() {
  const s = useSConfig()
  const p = s.params as { maxToolRounds?: unknown; highToolsUnlocked?: unknown }
  const unlocked = p?.highToolsUnlocked === true
  const unlimited = isToolRoundsUnlimited(p)
  const limit = toolRoundLimitOf(p)
  const sliderMax = unlocked ? TOOL_ROUNDS_MAX + 1 : TOOL_ROUNDS_BASE_MAX
  const sliderVal = unlimited ? TOOL_ROUNDS_MAX + 1 : Math.max(TOOL_ROUNDS_MIN, Math.min(sliderMax, limit))
  const [warn, setWarn] = useState(false)
  const set = (maxToolRounds: number) => s.patch({ params: { ...s.params, maxToolRounds } })
  const relock = () => {
    const cur = toolRoundLimitOf({ ...p, highToolsUnlocked: true })
    s.patch({ params: { ...s.params, highToolsUnlocked: false, maxToolRounds: Number.isFinite(cur) ? Math.min(cur, TOOL_ROUNDS_BASE_MAX) : TOOL_ROUNDS_DEFAULT } })
  }
  return (
    <Anchor id="tool-limit">
    <Card icon={Wrench} title="Tool execution limit" sub={unlimited ? 'Unlimited (unlocked)' : `${sliderVal} round${sliderVal === 1 ? '' : 's'}`} open0>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <RangeSlider label="Tool execution limit" min={TOOL_ROUNDS_MIN} max={sliderMax} step={1} value={sliderVal} valueText={unlimited ? 'Unlimited' : `${sliderVal} rounds`} set={(n) => set(n > TOOL_ROUNDS_MAX ? 0 : Math.round(n))} />
        </div>
        <Btn sm icon={unlocked ? LockOpen : Lock} title={unlocked ? 'Lock back to 32 rounds' : 'Unlock up to 64 rounds plus unlimited'} onClick={() => (unlocked ? relock() : setWarn(true))} />
      </div>
      {warn && (
        <Modal close={() => setWarn(false)}>
          <div className="modal-panel w-full max-w-sm space-y-4 rounded-2xl bg-bg p-5">
            <div className="flex items-center gap-2 font-semibold"><Lock size={18} className="text-ac" />Unlock higher tool limits?</div>
            <p className="text-sm text-mu">Above {TOOL_ROUNDS_BASE_MAX} rounds (up to {TOOL_ROUNDS_MAX}, plus unlimited) a looping model can run for a long time, burn through tokens, and grow the context until requests fail. Only raise this for long tool chains you trust. You can stop any reply with Stop.</p>
            <div className="flex justify-end gap-2">
              <Btn v="soft" onClick={() => setWarn(false)}>Cancel</Btn>
              <Btn v="solid" onClick={() => { s.patch({ params: { ...s.params, highToolsUnlocked: true } }); setWarn(false) }}>Unlock higher limits</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Card>
    </Anchor>
  )
}

function DocumentsSettings() {
  const s = useSConfig()
  const d = normDocs(s.docPrefs)
  const set = (p: Partial<DocPrefs>) => s.patch({ docPrefs: { ...d, ...p } })
  const visionEps = s.eps.filter((e) => usable(e) && can(e, 'img'))
  const ocrEp = s.eps.find((e) => e.id === d.ocrEp)
  return (
    <Anchor id="documents">
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Extract PDF text</div><Toggle on={d.pdfText} set={(pdfText) => set({ pdfText })} label="Extract PDF text" /></div>
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Read Office documents</div><Toggle on={d.office} set={(office) => set({ office })} label="Read Office documents" /></div>
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Unpack archives</div><Toggle on={d.archives} set={(archives) => set({ archives })} label="Unpack archives" /></div>
      <Field label="Image text extraction (OCR)" row>
        <Seg v={d.ocr} set={(ocr) => set({ ocr })} opts={[['off', 'Off'], ['auto', 'Auto'], ['always', 'Always']]} />
      </Field>
      <Anchor id="ocr">
      {d.ocr !== 'off' && (
        <div className="space-y-3">
          <Field label="OCR vision endpoint" row><Sel value={d.ocrEp} set={(ocrEp) => set({ ocrEp, ocrModel: '' })} opts={[['', 'First vision-capable endpoint'], ...visionEps.map((e) => [e.id, e.name] as [string, string])]} /></Field>
          {ocrEp && <Field label="OCR model" row><Sel value={d.ocrModel} set={(ocrModel) => set({ ocrModel })} opts={[['', 'Endpoint default'], ...modelsOf(ocrEp).map((m) => [m, m] as [string, string])]} /></Field>}
          {!visionEps.length && <p className="text-xs text-er">No usable vision-capable endpoint yet. Add one in Settings → Endpoints for OCR to work.</p>}
        </div>
      )}
      </Anchor>
      <Anchor id="per-file-chars">
      <Field label="Text per document" row>
        <Sel value={String(d.perFileChars)} set={(v) => set({ perFileChars: Number(v) })} opts={[['15000', '15k characters'], ['30000', '30k characters'], ['60000', '60k characters'], ['100000', '100k characters'], ['200000', '200k characters (max)']]} />
      </Field>
      </Anchor>
      <Anchor id="total-file-chars">
      <Field label="Text across all files" row>
        <Sel value={String(d.totalChars)} set={(v) => set({ totalChars: Number(v) })} opts={[['100000', '100k characters'], ['250000', '250k characters'], ['500000', '500k characters (default)'], ['750000', '750k characters'], ['1000000', '1M characters']]} />
      </Field>
      </Anchor>
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Private file names</div><Toggle on={d.privateNames} set={(privateNames) => set({ privateNames })} label="Private file names" /></div>
    </div>
    </Anchor>
  )
}

function ImageGenCard() {
  const s = useSConfig()
  const g = normImageGen(s.imageGen)
  const set = (p: Partial<typeof g>) => s.patch({ imageGen: { ...g, ...p } })
  const eps = s.eps.filter((e) => usable(e) && e.type === 'openai')
  const ep = s.eps.find((e) => e.id === g.ep && usable(e)) ?? eps[0]
  return (
    <Anchor id="image-generation">
      <Card icon={ImageIcon} title="Image generation" sub={g.on ? `@generate_image · On${ep ? ` · ${ep.name}${g.model ? ` · ${g.model}` : ''}` : ' · no OpenAI-compatible endpoint'}` : '@generate_image · Off'} muted={!g.on} open0={g.on && !eps.length} right={<Toggle on={g.on} set={(on) => set({ on })} label="Allow image generation" />}>
        {!eps.length && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">No enabled OpenAI-compatible endpoint is available. Add one in Endpoints first.</p>}
        <Field label="Image endpoint" row>
          <Sel value={g.ep && s.eps.some((e) => e.id === g.ep) ? g.ep : ''} set={(id) => set({ ep: id })} opts={[['', eps[0] ? `First usable · ${eps[0].name}` : 'First usable OpenAI-compatible'], ...s.eps.filter((e) => e.type === 'openai').map((e) => [e.id, `${e.name}${e.on ? '' : ' (disabled)'}`] as [string, string])]} />
        </Field>
        <Field label="Image model">
          <Input value={g.model} set={(model) => set({ model })} placeholder={ep?.model ? `Default: ${ep.model}` : 'e.g. gpt-image-1'} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Size" row>
            <Sel value={g.size} set={(size) => set({ size })} opts={IMAGE_SIZES} />
          </Field>
          <Field label="Images per call" row>
            <Sel value={String(g.count)} set={(v) => set({ count: Number(v) })} opts={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-bg p-2.5">
          <div className="min-w-0 text-sm font-medium">Require approval</div>
          <Toggle on={!!s.toolApproval.generate_image} set={(v) => s.patch({ toolApproval: { ...s.toolApproval, generate_image: v } })} label="Require approval for image generation" />
        </div>
        <div className="flex justify-end"><Btn v="soft" icon={RotateCcw} onClick={() => s.patch({ imageGen: { ...BLANK_IMAGE_GEN, on: g.on } })}>Reset sizes and endpoint</Btn></div>
      </Card>
    </Anchor>
  )
}

/* Runs short snippets in a disposable Web Worker. Off by default; JavaScript
 * works with no setup, Python downloads Pyodide on first use. */
function CodeRunCard() {
  const s = useSConfig()
  const c = normCodeRun(s.codeRun)
  const set = (p: Partial<typeof c>) => s.patch({ codeRun: { ...c, ...p } })
  const secs = c.timeoutMs / 1000
  return (
    <Anchor id="code-execution">
      <Card icon={Code2} title="Code execution" sub={c.on ? `@run_code · On · JavaScript${c.python ? ' and Python' : ''} · ${secs}s limit` : '@run_code · Off'} muted={!c.on} right={<Toggle on={c.on} set={(on) => set({ on })} label="Allow code execution" />}>
        <Anchor id="code-timeout">
          <Field label={`Time limit · ${secs}s`}>
            <RangeSlider label="Code time limit" min={CODE_TIMEOUT_MIN / 1000} max={CODE_TIMEOUT_MAX / 1000} step={1} value={secs} valueText={`${secs} second${secs === 1 ? '' : 's'}`} set={(n) => set({ timeoutMs: Math.round(n) * 1000 })} className="w-full" />
          </Field>
        </Anchor>
        <Anchor id="code-output">
          <Field label="Output limit" row>
            <Sel value={String(c.maxOutput)} set={(v) => set({ maxOutput: Number(v) })} opts={[['5000', '5k characters'], ['20000', '20k characters'], ['50000', '50k characters'], [String(CODE_OUTPUT_MAX), '100k characters (max)']]} />
          </Field>
        </Anchor>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">Enable Python</div>
          <Toggle on={c.python} set={(python) => set({ python })} label="Allow Python code execution" />
        </div>
        {c.python && <>
          <Anchor id="code-packages">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-sm font-medium">Load Python packages</div>
              <Toggle on={c.pyPackages} set={(pyPackages) => set({ pyPackages })} label="Load Python packages on demand" />
            </div>
          </Anchor>
          <Anchor id="code-pyodide-url">
            <Field label="Pyodide URL">
              <Input value={c.pyodideUrl} set={(pyodideUrl) => set({ pyodideUrl })} placeholder={PYODIDE_DEFAULT_URL} />
            </Field>
          </Anchor>
          <p role="note" className="rounded-lg bg-bg px-3 py-2 text-xs text-mu">Python runs locally, but its runtime can reach the network through its JavaScript bridge. Only keep Python enabled if you trust code the model writes. Pyodide URL changes apply to the next run.</p>
        </>}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-bg p-2.5">
          <div className="min-w-0 text-sm font-medium">Require approval</div>
          <Toggle on={!!s.toolApproval.run_code} set={(v) => s.patch({ toolApproval: { ...s.toolApproval, run_code: v } })} label="Require approval for code execution" />
        </div>
        <div className="flex justify-end"><Btn v="soft" icon={RotateCcw} onClick={() => s.patch({ codeRun: { ...BLANK_CODE_RUN, on: c.on } })}>Reset limits</Btn></div>
      </Card>
    </Anchor>
  )
}

/* Tools that read the device ask before they switch on. One answer silences
 * the prompt for all of them, so the user never answers it four times. */
const DEVICE_TOOLS = new Set(['location', 'clipboard', 'date', 'time'])

/** Nearest scroll container of a card, used to hold the list still while a
 *  tool is re-sorted to the top. */
const scrollBoxOf = (el: HTMLElement | null): HTMLElement | null => {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p
  }
  return null
}

function Tools() {
  const s = useSConfig()
  const [ask, setAsk] = useState<string | null>(null)
  const [askAlways, setAskAlways] = useState(false)
  const [askApprove, setAskApprove] = useState(true)
  const [showSearchKey, setShowSearchKey] = useState(false)
  const [showReaderKey, setShowReaderKey] = useState(false)
  const [health, setHealth] = useState<{ searchConfigured?: boolean; apiProviders?: Record<string, { label: string; configured: boolean; needsZone?: boolean; optionalKey?: boolean }> } | null>(null)
  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((x) => setHealth(x)).catch(() => setHealth({ searchConfigured: false }))
  }, [])
  /* True once the user silenced the allow prompt for every device tool. */
  const consent = s.toolConsent === true
  const search = normSearch(s.search)
  /* Always build on the store's current search settings, never on this
   * render's snapshot: two edits in one tick (pick a provider, paste a key)
   * would otherwise write back the older object and silently erase the key
   * that was just set. Nested `keys` maps merge per provider for the same
   * reason — one provider's key must not drop another's. */
  const setSearch = (p: Partial<Omit<typeof search, 'keys'>> & { keys?: Partial<typeof search.keys> }) => {
    const cur = normSearch(useS.getState().search)
    const next = { ...cur, ...p }
    if (p.keys) next.keys = { ...cur.keys, ...p.keys }
    s.patch({ search: next as typeof cur })
  }
  const ownKey = (search.keys[search.provider] || '').trim()
  const keyless = !!health?.apiProviders?.[search.provider]?.optionalKey
  /* The page-summary picker lists every endpoint model, so the user picks
   * the exact model (not just an endpoint) that writes page summaries. */
  const summaryRef = search.readerSummaryEp ? `${search.readerSummaryEp}::${search.readerSummaryModel ?? ''}` : ''
  const summaryOpts: [string, string][] = [
    ['', 'None (send the raw page)'],
    ...s.eps.flatMap((e) => modelsOf(e).map((m) => [`${e.id}::${m}`, `${e.name} · ${modelNameOf(e, m)}`] as [string, string])),
  ]
  const setSummaryRef = (ref: string) => {
    const i = ref.indexOf('::')
    setSearch({ readerSummaryEp: i < 0 ? '' : ref.slice(0, i), readerSummaryModel: i < 0 ? '' : ref.slice(i + 2) })
  }
  /* The model-flow mode picks a source, not a model: an endpoint's default
   * model and the rest of its model list, or a whole playlist's entries,
   * form the flow in order. Playlist values are prefixed with `pl:` so one
   * dropdown can hold both kinds of source. */
  const summaryFlowRef = search.readerSummaryPl ? `pl:${search.readerSummaryPl}` : search.readerSummaryEp
  const summaryEpOpts: [string, string][] = [
    ['', 'None (send the raw page)'],
    ...s.eps.filter(usable).map((e) => [e.id, `${e.name} · ${e.model}`] as [string, string]),
    ...(featOn(s, 'playlists') ? s.pls.map((p) => [`pl:${p.id}`, `Playlist: ${p.name} (${p.e.length} entries)`] as [string, string]) : []),
  ]
  const setSummaryFlowRef = (ref: string) => {
    if (ref.startsWith('pl:')) setSearch({ readerSummaryPl: ref.slice(3), readerSummaryEp: '', readerSummaryModel: '' })
    else setSearch({ readerSummaryEp: ref, readerSummaryPl: '', readerSummaryModel: '' })
  }
  /* Enabling a tool re-sorts the list. Capture the scroll position first so the
   * page stays where the reader was instead of following the card that moved. */
  const cardEls = useRef(new Map<string, HTMLElement>())
  const keepScroll = useRef<{ el: HTMLElement; top: number } | null>(null)
  const rememberScroll = (k: string) => {
    const box = scrollBoxOf(cardEls.current.get(k) ?? null)
    if (box) keepScroll.current = { el: box, top: box.scrollTop }
  }
  const setTool = (k: string, on: boolean) => {
    rememberScroll(k)
    s.patch({ tools: { ...s.tools, [k]: on } })
  }
  /* Device tools ask first unless the user silenced the prompt; every other
   * tool switches on directly. */
  const toggleTool = (k: string, v: boolean) => {
    if (!v || consent || !DEVICE_TOOLS.has(k)) { setTool(k, v); return }
    rememberScroll(k)
    setAskAlways(false)
    setAskApprove(s.toolApproval[k] ?? true)
    setAsk(k)
  }
  const allowTool = (k: string, always: boolean) => {
    rememberScroll(k)
    s.patch({
      tools: { ...s.tools, [k]: true },
      toolApproval: { ...s.toolApproval, [k]: askApprove },
      ...(always ? { toolConsent: true } : {}),
    })
    setAsk(null)
    setAskAlways(false)
  }
  /* Enabled tools first, then everything else; both groups keep relevance order. */
  const listed = orderTools(s.tools)
  const asked = TOOLS.find((x) => x[0] === ask)
  const layoutKey = listed.map(([k]) => k).join(',')
  const reducedMotion = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  /* Cards glide to their new slot instead of jumping, and the scroll position
   * captured above is restored before paint so the list never chases the card. */
  useFlipAnimate(cardEls, reducedMotion, layoutKey)
  useLayoutEffect(() => {
    const keep = keepScroll.current
    if (!keep) return
    keepScroll.current = null
    if (keep.el.scrollTop !== keep.top) keep.el.scrollTop = keep.top
  }, [layoutKey])
  return (
    <Panel id="tools">
      <Section title="Execution">
      <ToolAccessCard />
      <ToolLimitCard />
      <CodeRunCard />
      </Section>
      <Section title="Capabilities">
      <ImageGenCard />
      <Anchor id="deep-research">
      <Card icon={Brain} title="Deep research" sub="@research(query)" />
      </Anchor>
      </Section>
      <Section title="Tools">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">Ask before enabling device tools</div>
        <Toggle on={!consent} set={(v) => s.patch({ toolConsent: !v })} label="Ask before enabling device tools" />
      </div>
      {listed.map(([k, n, I, u, d, p]) => (
        <div key={k} ref={(el) => { if (el) cardEls.current.set(k, el); else cardEls.current.delete(k) }}>
        <Anchor id={`tool-${k}`}>
        <Card icon={I} title={n} sub={u} muted={!s.tools[k]} right={
          <>
            <span className="hidden items-center gap-1.5 text-xs text-mu sm:flex">{s.tools[k] ? <ShieldCheck size={14} className="text-ac" /> : <Shield size={14} />}{s.tools[k] ? 'Allowed' : 'Off'}</span>
            <Toggle on={!!s.tools[k]} set={(v) => toggleTool(k, v)} label={`Enable ${n} tool`} />
          </>
        }>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-bg p-2.5">
            <div className="flex items-center gap-1.5 text-sm font-medium">Require approval</div>
            <Toggle on={!!s.toolApproval[k]} set={(v) => s.patch({ toolApproval: { ...s.toolApproval, [k]: v } })} label={`Require approval for ${n}`} />
          </div>
          {k === 'workspace_upsert' && <Anchor id="workspace-view"><div className="space-y-3 rounded-xl bg-bg p-3">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Default view for workspace tiles</div><Seg v={s.workspacePrefs?.defaultView ?? 'pinned'} set={(defaultView) => s.patch({ workspacePrefs: { ...s.workspacePrefs, defaultView } })} opts={[['pinned', 'Pinned'], ['latest', 'Latest']]} /></div>
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Auto-open workspace panel</div><Toggle on={s.workspacePrefs?.autoOpen ?? true} set={(autoOpen) => s.patch({ workspacePrefs: { ...s.workspacePrefs, autoOpen } })} label="Auto-open workspace panel" /></div>
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Auto-follow active file</div><Toggle on={s.workspacePrefs?.autoFollow ?? true} set={(autoFollow) => s.patch({ workspacePrefs: { ...s.workspacePrefs, autoFollow } })} label="Auto-follow active file" /></div>
          </div></Anchor>}
          {k === 'search' && <div className="space-y-3 rounded-xl bg-bg p-3">
            <Anchor id="search-provider">
            <Field label="API provider" row>
              <Sel value={search.provider} set={(provider) => { setShowSearchKey(false); setSearch({ provider: provider as typeof search.provider }) }} opts={SEARCH_PROVIDERS.map(([id, label]) => [id, label] as [string, string])} />
            </Field>
            </Anchor>
            {!ownKey && !keyless && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">No {health?.apiProviders?.[search.provider]?.label ?? search.provider} key saved in this browser yet. Searches will fail until you paste one below.</p>}
            {keyless && !ownKey && <p className="rounded-lg bg-hov px-3 py-2 text-xs text-mu">{health?.apiProviders?.[search.provider]?.label ?? search.provider} works without a key at a lower rate limit. Add one to raise the limits.</p>}
            <Anchor id="search-key">
            <Field label={`${health?.apiProviders?.[search.provider]?.label ?? search.provider} API key`}>
              <div className="relative">
                <Input type={showSearchKey ? 'text' : 'password'} value={search.keys[search.provider] ?? ''} set={(v) => setSearch({ keys: { [search.provider]: v } })} placeholder="Paste your search API key" />
                <button onClick={() => setShowSearchKey(!showSearchKey)} title="Show or hide key" className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{showSearchKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </Field>
            </Anchor>
            {search.provider === 'brightdata' && <Anchor id="search-zone"><Field label="SERP zone"><Input value={search.zone} set={(zone) => setSearch({ zone })} placeholder="e.g. serp_api1" /></Field></Anchor>}
            <Anchor id="search-max-results">
            <Field label={`Results per search · ${search.maxResults}`}>
              <RangeSlider label="Results per search" min={1} max={10} step={1} value={search.maxResults} valueText={`${search.maxResults} result${search.maxResults === 1 ? '' : 's'}`} set={(maxResults) => setSearch({ maxResults: Math.round(maxResults) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="search-timeout">
            <Field label={`Request timeout · ${(search.timeoutMs / 1000).toFixed(search.timeoutMs % 1000 ? 1 : 0)}s`}>
              <RangeSlider label="Request timeout" min={1000} max={30000} step={1000} value={search.timeoutMs} valueText={`${(search.timeoutMs / 1000).toFixed(search.timeoutMs % 1000 ? 1 : 0)} seconds`} set={(timeoutMs) => setSearch({ timeoutMs: Math.round(timeoutMs) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="search-snippet">
            <Field label={`Snippet length · ${search.maxSnippetChars} characters`}>
              <RangeSlider label="Snippet length" min={200} max={3000} step={100} value={search.maxSnippetChars} valueText={`${search.maxSnippetChars.toLocaleString()} characters`} set={(maxSnippetChars) => setSearch({ maxSnippetChars: Math.round(maxSnippetChars) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="search-retries">
            <Field label="Retries" row>
              <Sel value={String(search.maxRetries)} set={(v) => setSearch({ maxRetries: Number(v) })} opts={[['0', '0 · none'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 · max']]} />
            </Field>
            </Anchor>
            <Anchor id="search-retry-delay">
            <Field label="Retry base delay" row>
              <Sel value={String(search.retryBaseMs)} set={(v) => setSearch({ retryBaseMs: Number(v) })} opts={[['50', '50ms'], ['100', '100ms'], ['300', '300ms'], ['500', '500ms'], ['1000', '1s'], ['2000', '2s · max']]} />
            </Field>
            </Anchor>
            <Anchor id="citations">
            <div className="space-y-3 rounded-xl bg-surf p-3">
              <div className="text-sm font-medium">Sources & transparency</div>
              <Field label="Inline citations" row>
                <Seg v={search.citeStyle} set={(citeStyle) => setSearch({ citeStyle })} opts={[['off', 'Off'], ['pills', 'Pills'], ['links', 'Links']]} />
              </Field>
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Expand Sources by default</div><Toggle on={search.sourcesOpen} set={(sourcesOpen) => setSearch({ sourcesOpen })} label="Expand Sources by default" /></div>
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Strict citation warnings</div><Toggle on={search.strictCitations} set={(strictCitations) => setSearch({ strictCitations })} label="Strict citation warnings" /></div>
            </div>
            </Anchor>
          </div>}
          {k === 'fetch_page' && <div className="space-y-3 rounded-xl bg-bg p-3">
            <Anchor id="page-reader">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Page reader</div><Toggle on={search.reader} set={(reader) => setSearch({ reader })} label="Page reader" /></div>
            </Anchor>
            <Anchor id="reader-api">
            <Field label="Page reader API" row>
              <Sel value={search.readerProvider} set={(readerProvider) => setSearch({ readerProvider: readerProvider as typeof search.readerProvider })} opts={READER_PROVIDERS.map(([id, label]) => [id, label] as [string, string])} />
            </Field>
            </Anchor>
            {search.readerProvider !== 'direct' && <>
              <Anchor id="reader-key">
              <Field label="Reader API key">
                <div className="relative">
                  <Input type={showReaderKey ? 'text' : 'password'} value={search.readerKey} set={(v) => setSearch({ readerKey: v })} placeholder={search.readerProvider === 'custom' ? 'Optional' : 'Paste your reader API key'} />
                  <button onClick={() => setShowReaderKey(!showReaderKey)} title="Show or hide key" className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{showReaderKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </Field>
              </Anchor>
              {search.readerProvider === 'custom' && <Anchor id="reader-url">
              <Field label="Reader API URL">
                <Input value={search.readerUrl} set={(v) => setSearch({ readerUrl: v })} placeholder="https://example.com/read?url={url}" />
              </Field>
              </Anchor>}
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Fall back to direct page fetch</div><Toggle on={search.readerFallback} set={(readerFallback) => setSearch({ readerFallback })} label="Fall back to direct page fetch" /></div>
            </>}
            <Anchor id="reader-summary">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-sm font-medium">Summarize pages with another model</div><Toggle on={search.readerSummary} set={(readerSummary) => setSearch({ readerSummary })} label="Summarize pages with another model" /></div>
            </Anchor>
            {search.readerSummary && <>
              <Anchor id="reader-summary-mode">
              <Field label="Summary model" row>
                <Seg v={search.readerSummaryFlow ? 'flow' : 'picked'} set={(v) => setSearch({ readerSummaryFlow: v === 'flow' })} opts={[['picked', 'Picked model'], ['flow', 'Model flow']]} />
              </Field>
              </Anchor>
              {search.readerSummaryFlow ? (
                <Anchor id="reader-summary-endpoint">
                <Field label="Summary flow source" row>
                  <Sel value={summaryFlowRef} set={setSummaryFlowRef} opts={summaryEpOpts} />
                </Field>
                </Anchor>
              ) : (
                <Anchor id="reader-summary-model">
                <Field label="Summary model" row>
                  <Sel value={summaryRef} set={setSummaryRef} opts={summaryOpts} />
                </Field>
                </Anchor>
              )}
              <Anchor id="reader-summary-length">
              <Field label={`Summary length · ${search.readerSummaryChars.toLocaleString()} characters`}>
                <RangeSlider label="Summary length" min={400} max={8000} step={200} value={search.readerSummaryChars} valueText={`${search.readerSummaryChars.toLocaleString()} characters`} set={(readerSummaryChars) => setSearch({ readerSummaryChars: Math.round(readerSummaryChars) })} className="w-full" />
              </Field>
              </Anchor>
            </>}
            <Anchor id="fetch-timeout">
            <Field label={`Page request timeout · ${(search.fetchTimeoutMs / 1000).toFixed(search.fetchTimeoutMs % 1000 ? 1 : 0)}s`}>
              <RangeSlider label="Page request timeout" min={1000} max={30000} step={1000} value={search.fetchTimeoutMs} valueText={`${(search.fetchTimeoutMs / 1000).toFixed(search.fetchTimeoutMs % 1000 ? 1 : 0)} seconds`} set={(fetchTimeoutMs) => setSearch({ fetchTimeoutMs: Math.round(fetchTimeoutMs) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="fetch-chars">
            <Field label={`Text kept per page · ${(search.fetchMaxChars / 1000).toFixed(search.fetchMaxChars % 1000 ? 1 : 0)}k characters`}>
              <RangeSlider label="Text kept per page" min={1000} max={50000} step={1000} value={search.fetchMaxChars} valueText={`${search.fetchMaxChars.toLocaleString()} characters`} set={(fetchMaxChars) => setSearch({ fetchMaxChars: Math.round(fetchMaxChars) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="fetch-retries">
            <Field label="Page retries" row>
              <Sel value={String(search.fetchMaxRetries)} set={(v) => setSearch({ fetchMaxRetries: Number(v) })} opts={[['0', '0 · none'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 · max']]} />
            </Field>
            </Anchor>
            <Anchor id="fetch-retry-delay">
            <Field label="Page retry base delay" row>
              <Sel value={String(search.fetchRetryBaseMs)} set={(v) => setSearch({ fetchRetryBaseMs: Number(v) })} opts={[['50', '50ms'], ['100', '100ms'], ['300', '300ms'], ['500', '500ms'], ['1000', '1s'], ['2000', '2s · max']]} />
            </Field>
            </Anchor>
          </div>}
        </Card>
        </Anchor>
        </div>
      ))}
      </Section>
      {featOn(s, 'advanced') && s.advanced?.showHiddenTools && (
        <Section title="Additional capabilities">
        <Anchor id="hidden-capabilities">
        <Card icon={FlaskConical} title="Additional capabilities">
          {Object.keys(TOOL_REGISTRY)
            .filter((name) => name === 'memory' || !TOOLS.some(([t]) => t === name))
            .map((name) => {
              const spec = TOOL_REGISTRY[name]
              const live = name === SKILL_TOOL_NAME
                ? featOn(s, 'skills') && enabledSkills(normSkills(s.skills).skills).length > 0
                : name === 'memory'
                  ? featOn(s, 'memory') && s.memoryPrefs.enabled
                  : !!s.tools[name]
              const why = name === SKILL_TOOL_NAME
                ? (featOn(s, 'skills') ? (enabledSkills(normSkills(s.skills).skills).length ? 'Offered while enabled skills exist' : 'Idle: no enabled skills') : 'Idle: the Skills feature is off')
                : name === 'memory'
                  ? (featOn(s, 'memory') ? (s.memoryPrefs.enabled ? 'Offered while the memory tool is enabled' : 'Idle: the memory tool is disabled in Memory settings') : 'Idle: the Memory feature is off')
                  : ''
              return (
                <div key={name} className="space-y-1 rounded-xl bg-bg p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="font-mono">{name}</span>
                    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-mu">{live ? <ShieldCheck size={14} className="text-ac" /> : <Shield size={14} />}{live ? 'Allowed' : 'Off'}</span>
                  </div>
                  <p className="text-sm">{spec.description}</p>
                  {why && <p className="text-xs text-mu">{why}</p>}
                </div>
              )
            })}
        </Card>
        </Anchor>
        </Section>
      )}
      {asked && (
        <Modal close={() => { setAsk(null); setAskAlways(false) }}>
          <div className="modal-panel w-full max-w-sm space-y-4 rounded-2xl bg-bg p-5">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-ac" />Enable {asked[1]}?</div>
            <p className="text-sm text-mu">{asked[5]}</p>
            <label className="flex items-start gap-3 rounded-xl bg-surf p-3 text-sm">
              <input type="checkbox" checked={askApprove} onChange={(e) => setAskApprove(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span className="font-medium">Require approval before each call</span>
            </label>
            <label className="flex items-start gap-3 rounded-xl bg-surf p-3 text-sm">
              <input type="checkbox" checked={askAlways} onChange={(e) => setAskAlways(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span className="font-medium">Do not show again</span>
            </label>
            <div className="flex justify-end gap-2">
              <Btn v="soft" onClick={() => { setAsk(null); setAskAlways(false) }}>Cancel</Btn>
              <Btn v="solid" icon={Check} onClick={() => allowTool(asked[0], askAlways)}>Enable</Btn>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  )
}

function SkillsTab() {
  const s = useSConfig()
  const { skills, warnings } = normSkills(s.skills)
  const setSkills = (next: SkillState[]) => s.patch({ skills: next })
  const upd = (id: string, p: Partial<SkillState>) => setSkills(skills.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const [draft, setDraft] = useState({ id: '', name: '', description: '', instructions: '' })
  const [error, setError] = useState('')
  const add = () => {
    try {
      const skill = validateCustomSkill({ ...draft })
      if (skills.some((x) => x.id === skill.id)) throw new Error(`A skill named "${skill.id}" already exists.`)
      setSkills([...skills, skill])
      setDraft({ id: '', name: '', description: '', instructions: '' })
      setError('')
    } catch (x: any) { setError(x?.message || 'Could not add the skill.') }
  }
  return (
    <Panel id="skills">
      <Section>
      {!!warnings.length && <p role="status" className="rounded-xl bg-er/10 px-3 py-2 text-xs text-er">{warnings[0]} Edit or reset the skill below to fix it.</p>}
      {skills.map((st) => {
        const def = resolveSkill(st)
        if (!def) return <Anchor key={st.id} id={`skill-${st.id}`}><Card icon={Sparkles} title={st.id} sub="Missing instructions" muted><p className="text-sm text-er">This skill has no instructions, so it can't be used. Edit it or remove it.</p><div><Btn v="danger" icon={Trash2} onClick={() => setSkills(skills.filter((x) => x.id !== st.id))}>Remove</Btn></div></Card></Anchor>
        const builtin = BUILTIN_SKILLS.some((b) => b.id === st.id)
        return (
          <Anchor key={st.id} id={`skill-${st.id}`}>
          <Card icon={Sparkles} title={def.name} muted={!st.enabled} right={<Toggle on={st.enabled} set={(enabled) => upd(st.id, { enabled })} label={`Enable skill ${def.name}`} />}>
            {def.source && <p className="text-xs text-mu">Source: {def.source}{def.license ? ` · ${def.license}` : ''}</p>}
            <Field label="When to use"><Input value={st.description ?? def.description} set={(description) => upd(st.id, { description })} placeholder="When this skill applies." /></Field>
            <Field label="Instructions"><Area rows={6} value={st.instructions ?? def.instructions} set={(instructions) => upd(st.id, { instructions })} /></Field>
            <div className="flex gap-2">
              {builtin && <Btn v="soft" icon={RotateCcw} onClick={() => upd(st.id, { name: undefined, description: undefined, instructions: undefined } as Partial<SkillState>)}>Reset</Btn>}
              {!builtin && <Btn v="danger" icon={Trash2} onClick={() => setSkills(skills.filter((x) => x.id !== st.id))}>Remove</Btn>}
            </div>
          </Card>
          </Anchor>
        )
      })}
      </Section>
      <Section title="Custom skills">
      <Anchor id="add-skill">
      <Card icon={Plus} title="Add a custom skill" open0={false}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ID"><Input value={draft.id} set={(id) => setDraft({ ...draft, id })} placeholder="e.g. api-docs" /></Field>
          <Field label="Name"><Input value={draft.name} set={(name) => setDraft({ ...draft, name })} placeholder="e.g. API docs" /></Field>
        </div>
        <Field label="When to use"><Input value={draft.description} set={(description) => setDraft({ ...draft, description })} placeholder="When this skill applies." /></Field>
        <Field label="Instructions"><Area rows={5} value={draft.instructions} set={(instructions) => setDraft({ ...draft, instructions })} /></Field>
        {error && <p role="alert" className="text-xs text-er">{error}</p>}
        <div><Btn v="solid" icon={Plus} onClick={add}>Add skill</Btn></div>
      </Card>
      </Anchor>
      </Section>
    </Panel>
  )
}

function VoiceTab() {
  const s = useSConfig()
  const v = normVoice(s.voicePrefs)
  const set = (p: Partial<typeof v>) => s.patch({ voicePrefs: { ...v, ...p } })
  const canDictate = dictationAvailable()
  const canSpeak = speechAvailable()
  return (
    <Panel id="voice">
      <Section title="Dictation">
        {!canDictate && <p role="status" className="py-3 text-sm text-er">This browser does not offer SpeechRecognition. Try Chrome, Edge, or Safari for dictation.</p>}
        <Anchor id="voice-dictation">
          <SettingRow label="Dictation language"><div className="w-56 max-w-full"><Sel value={v.dictLang} set={(dictLang) => set({ dictLang })} opts={VOICE_LANGS} inline /></div></SettingRow>
        </Anchor>
      </Section>
      <Section title="Read aloud">
        {!canSpeak && <p role="status" className="py-3 text-sm text-er">This browser does not offer speechSynthesis, so read-aloud is unavailable.</p>}
        <Anchor id="voice-read-aloud">
          <SettingRow label="Speaking language"><div className="w-56 max-w-full"><Sel value={v.speakLang} set={(speakLang) => set({ speakLang })} opts={VOICE_LANGS} inline /></div></SettingRow>
        </Anchor>
        <SettingRow label="Speaking rate">
          <RangeSlider label="Speaking rate" min={0.5} max={2} step={0.05} value={v.rate} valueText={`${v.rate.toFixed(2)}x`} set={(rate) => set({ rate: Math.round(rate * 100) / 100 })} className="w-40" />
          <span className="w-14 text-right text-sm tabular-nums">{v.rate.toFixed(2)}×</span>
        </SettingRow>
        <SettingRow label="Read every new reply automatically"><Toggle on={v.autoRead} set={(autoRead) => set({ autoRead })} label="Read replies automatically" /></SettingRow>
        <div className="flex gap-2 py-3">
          <Btn v="soft" icon={Play} disabled={!canSpeak} onClick={() => speak('This is how replies will sound. You can change the language and the speed here at any time.', v)}>Test voice</Btn>
          <Btn v="soft" icon={X} disabled={!canSpeak} onClick={() => stopSpeaking()}>Stop</Btn>
        </div>
      </Section>
    </Panel>
  )
}

function McpTab() {
  const s = useSConfig()
  const { mcps, add, upd, del } = s
  const [busy, setBusy] = useState('')
  const toolsOn = featOn(s, 'tools')
  const test = async (m: McpServer) => {
    if (!m.url.trim()) { upd('mcps', m.id, { error: 'Enter the server URL first.' }); return }
    setBusy(m.id)
    upd('mcps', m.id, { error: undefined })
    try {
      const { tools, serverInfo } = await probeMcpServer(m.url, m.headers)
      upd('mcps', m.id, {
        tools,
        toolsAt: Date.now(),
        error: undefined,
        ...(m.name === 'New MCP server' && serverInfo?.name ? { name: serverInfo.name } : {}),
      })
      s.patch({ notice: { t: `Connected to ${serverInfo?.name || m.name}: ${tools.length} tool${tools.length === 1 ? '' : 's'} loaded.` } })
    } catch (x: any) {
      upd('mcps', m.id, { error: String(x?.message ?? x) })
    } finally {
      setBusy('')
    }
  }
  return (
    <Panel id="mcp" k="mcps" add="Add server">
      <Section>
      {!toolsOn && <p role="status" className="py-3 text-sm text-er">The Tools feature is off, so no MCP tool can be called. Turn on Tools in Settings → Features.</p>}
      {!mcps.length && <p className="py-6 text-center text-sm text-mu">No servers yet.</p>}
      {mcps.map((m) => {
        const tools = m.tools ?? []
        return (
          <Anchor key={m.id} id={`mcp-${m.id}`}>
            <Card
              icon={Plug}
              title={m.name || 'MCP server'}
              sub={tools.length ? `${tools.length} tool${tools.length === 1 ? '' : 's'} loaded` : m.url ? 'No tools loaded yet' : 'No URL yet'}
              muted={!m.on}
              open0={!m.url}
              right={<Toggle on={m.on} set={(on) => upd('mcps', m.id, { on })} label={`Enable ${m.name}`} />}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><Input value={m.name} set={(name) => upd('mcps', m.id, { name })} placeholder="e.g. Filesystem" /></Field>
                <Field label="Server URL"><Input value={m.url} set={(url) => upd('mcps', m.id, { url, error: undefined })} placeholder="https://example.com/mcp" /></Field>
              </div>
              <Field label="Headers">
                <Area rows={3} value={m.headers} set={(headers) => upd('mcps', m.id, { headers })} placeholder={'Authorization: Bearer …'} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Btn v="soft" icon={Play} disabled={busy === m.id || !m.url.trim()} onClick={() => void test(m)}>{busy === m.id ? 'Connecting…' : tools.length ? 'Reconnect and refresh tools' : 'Test connection & load tools'}</Btn>
                {tools.length > 0 && m.toolsAt && <span className="text-xs text-mu">Loaded {new Date(m.toolsAt).toLocaleString()}</span>}
                <span className="flex-1" />
                <Btn v="danger" icon={Trash2} onClick={() => del('mcps', m.id)}>Remove</Btn>
              </div>
              {m.error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-er/10 px-3 py-2 text-xs text-er"><CircleX size={14} className="mt-0.5 shrink-0" />{m.error}</p>}
              {tools.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">Tools offered to the model</div>
                  {tools.map((t) => (
                    <div key={t.name} className="rounded-lg bg-surf p-2.5 text-sm">
                      <div className="font-mono text-xs text-ac">{mcpToolName(m, t.name)}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">{t.title || t.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Anchor>
        )
      })}
      </Section>
    </Panel>
  )
}

function MemoryTab() {
  const s = useSConfig(), mp = s.memoryPrefs
  const [draft, setDraft] = useState('')
  const [category, setCategory] = useState('General')
  const [dupes, setDupes] = useState<{ a: string; b: string; score: number }[] | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const setPrefs = (p: Partial<typeof mp>) => s.patch({ memoryPrefs: { ...mp, ...p } })
  const addMemory = () => {
    const text = draft.trim(); if (!text) return
    const now = Date.now()
    const { memories, merged, id } = mergeMemory(s.memories, { id: Math.random().toString(36).slice(2, 9), text, category: category.trim() || 'General', createdAt: now, updatedAt: now })
    s.patch({ memories })
    setDraft('')
    if (merged) s.patch({ notice: { t: `Merged into an existing near-duplicate memory instead of storing a copy.` } })
    void id
  }
  const mergePair = (a: string, b: string) => {
    const A = s.memories.find((m) => m.id === a), B = s.memories.find((m) => m.id === b)
    if (!A || !B) return
    const kept = A.text.length >= B.text.length ? A : B
    const dropped = kept === A ? B : A
    s.patch({ memories: s.memories.filter((m) => m.id !== dropped.id).map((m) => m.id === kept.id ? { ...m, category: kept.category, updatedAt: Date.now() } : m) })
    setDupes((d) => (d ?? []).filter((p) => p.a !== a && p.b !== b && p.a !== b && p.b !== a))
  }
  return <Panel id="memory">
    <Section>
      <Anchor id="memory-tool"><SettingRow label="Memory tool"><Toggle on={mp.enabled} set={(enabled) => setPrefs({ enabled })} label="Memory tool" /></SettingRow></Anchor>
      <SettingRow label="Require approval"><Toggle on={!!s.toolApproval.memory} set={(v) => s.patch({ toolApproval: { ...s.toolApproval, memory: v } })} label="Require approval for memory writes" /></SettingRow>
      <Anchor id="memory-mode">
        <SettingRow label="Memory mode"><Seg v={mp.intent} set={(intent) => setPrefs({ intent })} opts={[["intentional", "Intentional"], ["balanced", "Balanced"], ["aggressive", "Aggressive"]]} /></SettingRow>
      </Anchor>
      <Anchor id="memory-temp-chats">
        <SettingRow label="Use memory in temporary chats"><Toggle on={mp.tempChats !== false} set={(tempChats) => setPrefs({ tempChats })} label="Use memory in temporary chats" /></SettingRow>
      </Anchor>
      <Anchor id="recall-method">
        <SettingRow label="Recall method"><Seg v={mp.method ?? 'local'} set={(method) => setPrefs({ method })} opts={[["local", "Local rank"], ["classifier", "Classifier call"]]} /></SettingRow>
      </Anchor>
      <Anchor id="recall-mode">
        <SettingRow label="Recall mode"><Seg v={mp.recall} set={(recall) => setPrefs({ recall })} opts={[["holistic", "Holistic"], ["contextual", "Contextual"], ["specific", "Specific"]]} /></SettingRow>
      </Anchor>
      {(mp.method ?? 'local') === 'classifier' && mp.recall !== 'holistic' && <HelperPointer anchor="recall-classifier" title="Memory recall model" current={helperLabel(s, helperRef(s.prefs.recallEp, s.prefs.recallModel) || helperRef(mp.classifierEp, mp.classifierModel), 'Classification model (fallback)')} />}
    </Section>
    <Section title="Your memories">
    <Anchor id="add-memory">
      <div className="space-y-2 py-3">
        <Area rows={2} value={draft} set={setDraft} placeholder="A short fact, preference, or reminder…" />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-40 flex-1"><Input value={category} set={setCategory} placeholder="Category" /></div>
          <Btn v="solid" icon={Plus} onClick={addMemory}>Add memory</Btn>
        </div>
      </div>
    </Anchor>
    <Anchor id="stored-memories">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-3">
        <span className="text-sm">Stored memories ({s.memories.length})</span>
        <div className="flex gap-2"><Btn v="soft" disabled={s.memories.length < 2} onClick={() => setDupes(findDuplicatePairs(s.memories))}>Check duplicates</Btn><Btn v="danger" icon={Trash2} disabled={!s.memories.length} onClick={() => setClearOpen(true)}>Delete all</Btn></div>
      </div>
    </Anchor>
    {clearOpen && <Confirm title="Delete all stored memories?" text="Every memory stored in this browser is removed. Chats and settings are not affected." ok="Delete all" close={() => setClearOpen(false)} run={() => s.patch({ memories: [] })} />}
    {dupes && (
      <Anchor id="check-duplicates">
      <div className="rounded-xl bg-surf p-4 space-y-2">
        <div className="text-sm font-medium">{dupes.length ? `${dupes.length} near-duplicate pair${dupes.length === 1 ? '' : 's'}` : 'No near-duplicates found.'}</div>
        {dupes.map((p) => {
          const A = s.memories.find((m) => m.id === p.a), B = s.memories.find((m) => m.id === p.b)
          if (!A || !B) return null
          return (
            <div key={`${p.a}-${p.b}`} className="space-y-1 rounded-lg bg-bg p-3 text-sm">
              <p><span className="text-mu">A · {A.category}:</span> {A.text}</p>
              <p><span className="text-mu">B · {B.category}:</span> {B.text}</p>
              <div className="flex items-center justify-between"><span className="text-xs text-mu">{Math.round(p.score * 100)}% similar</span><Btn v="soft" onClick={() => mergePair(p.a, p.b)}>Merge (keep longer)</Btn></div>
            </div>
          )
        })}
      </div>
      </Anchor>
    )}
    {s.memories.map((m) => <div key={m.id} className="rounded-xl bg-surf p-3 space-y-2"><div className="flex gap-2"><Input value={m.category} set={(category) => s.patch({ memories: s.memories.map((x) => x.id === m.id ? { ...x, category, updatedAt: Date.now() } : x) })} placeholder="Category" /><Btn v="danger" icon={Trash2} title="Delete memory" onClick={() => s.patch({ memories: s.memories.filter((x) => x.id !== m.id) })}>Delete</Btn></div><Area rows={2} value={m.text} set={(text) => s.patch({ memories: s.memories.map((x) => x.id === m.id ? { ...x, text, updatedAt: Date.now() } : x) })} /></div>)}
    {!s.memories.length && <p className="py-3 text-sm text-mu">No memories stored.</p>}
    </Section>
  </Panel>
}

function WidgetsTab() {
  const s = useSConfig()
  const wp = s.widgetPrefs
  const setWp = (p: Partial<typeof wp>) => s.patch({ widgetPrefs: { ...wp, ...p } })
  const blockedBy = (k: string): string | null => {
    for (const [f, ids] of Object.entries(FEATURE_WIDGETS)) {
      if ((ids as string[]).includes(k) && !featOn(s, f as FeatureId)) return (FEATURES.find(([id]) => id === f)?.[1] ?? f)
    }
    return null
  }
  return (
    <Panel id="widgets">
      <Section title="Context meter">
        <Anchor id="context-meter"><SettingRow label="Show context meter"><Toggle on={s.prefs.showContextMeter ?? true} set={(showContextMeter) => s.patch({ prefs: { ...s.prefs, showContextMeter } })} label="Show context meter" /></SettingRow></Anchor>
        <Anchor id="context-limit"><SettingRow label="Manual context limit"><div className="w-32"><Input type="number" min="1000" step="1000" value={s.widgetPrefs.contextLimit} set={(v) => s.patch({ widgetPrefs: { ...s.widgetPrefs, contextLimit: Math.max(1000, Number(v) || 1000) } })} /></div></SettingRow></Anchor>
        <SettingRow label="Characters per estimated token"><div className="w-32"><Input type="number" min="1" max="10" value={s.widgetPrefs.charsPerToken} set={(v) => s.patch({ widgetPrefs: { ...s.widgetPrefs, charsPerToken: Math.min(10, Math.max(1, Number(v) || 4)) } })} /></div></SettingRow>
        <SettingRow label="Compact automatically"><Toggle on={s.prefs.compactAuto !== false} set={(compactAuto) => s.patch({ prefs: { ...s.prefs, compactAuto } })} label="Compact automatically" /></SettingRow>
        <Anchor id="context-compact">
          <SettingRow label="Auto-compact threshold">
            <RangeSlider label="Auto-compact threshold" min={5} max={100} step={5} disabled={s.prefs.compactAuto === false} value={normCompactAt(s.prefs.compactAt)} set={(compactAt) => s.patch({ prefs: { ...s.prefs, compactAt: normCompactAt(compactAt) } })} className={cx('w-40', s.prefs.compactAuto === false && 'opacity-50')} />
            <span className="w-12 text-right text-sm tabular-nums">{normCompactAt(s.prefs.compactAt)}%</span>
          </SettingRow>
        </Anchor>
      </Section>
      <Section title="Panels">
      {/* Enabled panels first; the rest keep their relevance order. */}
      {WIDGETS.map((w, i) => ({ w, i })).sort((a, b) => (s.widgets[a.w[0]] ? 0 : 1) - (s.widgets[b.w[0]] ? 0 : 1) || a.i - b.i).map(({ w: [k, n, I, d] }) => {
        const blocked = blockedBy(k)
        return (
        <Anchor key={k} id={`widget-${k}`}>
        <Card icon={I} title={n} sub={blocked ? `Needs the ${blocked} feature` : undefined} muted={!!blocked || !s.widgets[k]} right={blocked
          ? <span className="shrink-0 rounded-md bg-hov px-2 py-1 text-xs text-mu">Off</span>
          : <Toggle on={!!s.widgets[k]} set={(v) => s.patch({ widgets: { ...s.widgets, [k]: v }, rail: v || s.rail })} label={`Enable ${n} widget`} />}>
          <div className={blocked ? 'pointer-events-none opacity-50' : ''}>
          {k === 'usage' && <Anchor id="usage-settings"><div className="space-y-3">
            <Field label="Group usage" row><Seg v={wp.usageGroup} set={(usageGroup) => setWp({ usageGroup })} opts={[["endpoint", "Endpoint totals"], ["model", "Individual models"]]} /></Field>
            <Field label="Show" row><Seg v={wp.usageMode} set={(usageMode) => setWp({ usageMode })} opts={[["success", "OK / fails"], ["tokens", "Tokens"]]} /></Field>
            {wp.usageMode === 'tokens' && <Field label="Token format" row><div className="w-48"><Input value={wp.usageFormat} set={(usageFormat) => setWp({ usageFormat })} /></div></Field>}
            <Field label="Usage period" row><div className="w-44 max-w-full"><Sel value={wp.usagePeriod} set={(usagePeriod) => setWp({ usagePeriod: usagePeriod as typeof wp.usagePeriod })} opts={USAGE_PERIODS} inline /></div></Field>
            {wp.usagePeriod === 'custom' && <div className="grid grid-cols-2 gap-3"><Field label="From"><Input type="date" value={wp.usageFrom ?? ''} set={(usageFrom) => setWp({ usageFrom })} /></Field><Field label="Through"><Input type="date" value={wp.usageTo ?? ''} set={(usageTo) => setWp({ usageTo })} /></Field></div>}
            <Checkbox checked={wp.usageTotal} set={(usageTotal) => setWp({ usageTotal })} label="Show total across models and endpoints" />
          </div></Anchor>}
          {k === 'last' && <Anchor id="last-settings"><div className="space-y-3"><Checkbox checked={wp.lastSpeed} set={(lastSpeed) => setWp({ lastSpeed })} label="Show response speed" /><Field label="Time unit" row><Seg v={wp.timeUnit} set={(timeUnit) => setWp({ timeUnit })} opts={[["auto", "Auto"], ["ms", "Milliseconds"], ["s", "Seconds"]]} /></Field></div></Anchor>}
          {k === 'keys' && <Anchor id="shortcut-list"><div className="grid gap-2 sm:grid-cols-2">{KEYS.map(([id, label]) => <Checkbox key={id} checked={wp.shortcuts.includes(id)} set={(checked) => setWp({ shortcuts: checked ? [...wp.shortcuts, id] : wp.shortcuts.filter((x) => x !== id) })} label={label} />)}</div></Anchor>}
          {k === 'eps' && <Anchor id="show-disabled"><Checkbox checked={wp.showDisabledEndpoints} set={(showDisabledEndpoints) => setWp({ showDisabledEndpoints })} label="Show disabled endpoints" /></Anchor>}
          {k === 'pad' && <Anchor id="scratch-rows"><Field label="Visible note height" row><div className="w-24"><Input type="number" min="2" max="20" value={wp.scratchRows} set={(v) => setWp({ scratchRows: Math.min(20, Math.max(2, Number(v) || 6)) })} /></div></Field></Anchor>}
          {k === 'snips' && <Anchor id="snippet-limit"><Field label="Maximum snippets shown" row><div className="w-24"><Input type="number" min="1" max="100" value={wp.snippetLimit} set={(v) => setWp({ snippetLimit: Math.min(100, Math.max(1, Number(v) || 20)) })} /></div></Field></Anchor>}
          {k === 'cost' && <Anchor id="cost-decimals"><Field label="Decimal places" row><div className="w-24"><Input type="number" min="0" max="8" value={wp.costDecimals} set={(v) => setWp({ costDecimals: Math.min(8, Math.max(0, Number(v) || 0)) })} /></div></Field></Anchor>}
          {k === 'prompts' && <Anchor id="active-prompts-only"><Checkbox checked={wp.activePromptsOnly} set={(activePromptsOnly) => setWp({ activePromptsOnly })} label="Show only the selected prompt" /></Anchor>}
          {k === 'draft' && <Anchor id="chars-per-token"><Field label="Characters per estimated token" row><div className="w-24"><Input type="number" min="1" max="10" value={wp.charsPerToken} set={(v) => setWp({ charsPerToken: Math.min(10, Math.max(1, Number(v) || 4)) })} /></div></Field></Anchor>}
          {k === 'todo' && <Anchor id="hide-done"><Checkbox checked={wp.hideDoneTodos} set={(hideDoneTodos) => setWp({ hideDoneTodos })} label="Hide completed tasks" /></Anchor>}
          </div>
        </Card>
        </Anchor>
        )
      })}
      </Section>
    </Panel>
  )
}

function AdvancedTab() {
  const s = useSConfig()
  if (!featOn(s, 'advanced')) return null
  const a = { ...DEFAULT_ADVANCED, ...s.advanced }
  const setA = (p: Partial<typeof a>) => s.patch({ advanced: { ...a, ...p } })
  const row = (anchor: string, k: 'verboseErrors' | 'showHiddenTools' | 'showSystemPrompt' | 'showToolPayloads' | 'showTokenCounts' | 'showModelParams', t: string, d: string) => (
    <Anchor id={anchor}>
    <div className="flex items-center gap-3 py-3">
      <div className="flex flex-1 items-center gap-2 text-sm">{t}</div>
      <Toggle on={a[k]} set={(v) => setA({ [k]: v })} label={t} />
    </div>
    </Anchor>
  )
  return (
    <Panel id="adv">
      <Section title="Diagnostics">
      {row('verbose-errors', 'verboseErrors', 'Verbose errors', 'Show exact provider error messages in the process log and failure replies. The endpoint key is still masked; other key-like tokens are shown verbatim.')}
      {row('show-system-prompt', 'showSystemPrompt', 'Show full system prompt', 'Save the exact system prompt sent with each reply and show it in the process log: global prompt, selected prompt, tool guidance, skill catalog, and memory context.')}
      {row('show-tool-payloads', 'showToolPayloads', 'Show tool arguments and results', 'Render the full JSON arguments and returned text of every tool call in the process log instead of one-line summaries.')}
      {row('show-token-counts', 'showTokenCounts', 'Show per-step token counts', 'List reported input/output tokens beside each process-log entry when the provider reports them.')}
      </Section>
      <Section title="Interface">
      {row('show-hidden-tools', 'showHiddenTools', 'Show additional capabilities', 'List capabilities owned by other features in Settings → Tools. They stay read-only and cannot be toggled there.')}
      {row('show-model-params', 'showModelParams', 'Model parameters', 'Show the temperature, top-p, and max-tokens controls in the chat header. Turn off to hide them even while the Advanced feature stays on.')}
      </Section>
    </Panel>
  )
}

function WorkspaceTab() {
  const wp = useS((s) => s.workspacePrefs ?? { defaultView: 'latest', autoOpen: true, autoFollow: true })
  const set = (p: Partial<typeof wp>) => useS.getState().patch({ workspacePrefs: { ...useS.getState().workspacePrefs, ...p } })
  const gistToken = useS((s) => s.gistToken ?? '')
  const [showToken, setShowToken] = useState(false)
  const draft = useS((s) => s.draft)
  return (
    <Panel id="workspace">
      <Section title="Panel">
        <Anchor id="default-view"><SettingRow label="Default view"><Seg v={wp.defaultView ?? 'pinned'} set={(defaultView) => set({ defaultView: defaultView as typeof wp.defaultView })} opts={[['pinned', 'Pinned'], ['latest', 'Latest']]} /></SettingRow></Anchor>
        <Anchor id="auto-open"><SettingRow label="Auto-open panel"><Toggle on={wp.autoOpen ?? true} set={(autoOpen) => set({ autoOpen })} label="Auto-open panel" /></SettingRow></Anchor>
        <Anchor id="auto-follow"><SettingRow label="Auto-follow file"><Toggle on={wp.autoFollow ?? true} set={(autoFollow) => set({ autoFollow })} label="Auto-follow file" /></SettingRow></Anchor>
      </Section>
      <Section>
      <Anchor id="templates">
      <Card icon={LayoutTemplate} title="Project templates">
        <div className="space-y-2">
          {WORKSPACE_TEMPLATES.map((t) => (
            <Anchor key={t.id} id={`template-${t.id}`}>
            <div className="rounded-xl bg-bg p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{t.id}</span>
                <span className="text-sm">{t.name}</span>
                <span className="ml-auto text-xs text-mu">{t.files.length} files</span>
                <Btn v="soft" onClick={() => {
                  const st = useS.getState()
                  st.patch({ draft: `${draft ? `${draft}\n` : ''}Scaffold a "${t.name}" project (${t.files.map((f) => f.path).join(', ')}). Call workspace_upsert once with createNew:true, a workspaceName, template:"${t.id}", and a revisionName, then refine the files.` })
                }}>Draft prompt</Btn>
              </div>
              <p className="mt-1 text-xs text-mu">{t.description}</p>
              <p className="mt-1 font-mono text-xs text-mu">{t.files.map((f) => f.path).join(' · ')}</p>
            </div>
            </Anchor>
          ))}
        </div>
      </Card>
      </Anchor>
      </Section>
      <Section title="Sharing">
      <Anchor id="gist-sharing">
      <Card icon={Share2} title="GitHub Gist sharing">
        <Field label="Gist token (classic, gist scope)">
          <div className="relative">
            <Input type={showToken ? 'text' : 'password'} value={gistToken} set={(v) => useS.getState().patch({ gistToken: v })} placeholder="ghp_…" />
            <button onClick={() => setShowToken(!showToken)} title="Show or hide token" className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{showToken ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
        </Field>
      </Card>
      </Anchor>
      </Section>
    </Panel>
  )
}

function Chats() {
  const s = useSConfig()
  const { prefs } = s
  const patch = (p: Partial<typeof prefs>) => s.patch({ prefs: { ...prefs, ...p } })
  const toggle = (anchor: string, key: keyof typeof prefs, label: string) => (
    <Anchor id={anchor}><SettingRow label={label}><Toggle on={key === 'seasonal' ? prefs[key] !== false : !!prefs[key]} set={(v) => patch({ [key]: v } as Partial<typeof prefs>)} label={label} /></SettingRow></Anchor>
  )
  const footerStats = prefs.replyStats ?? DEFAULT_REPLY_STATS
  const toggleFooterStat = (id: ReplyMetric) => {
    const next = new Set(footerStats)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    patch({ replyStats: REPLY_METRICS.map((metric) => metric.id).filter((metric) => next.has(metric)) })
  }
  return (
    <Panel id="chats">
      <Section title="Replies">
        {toggle('show-by', 'showBy', 'Show which model answered')}
        <Anchor id="reply-model-label">
          <SettingRow label="Model label">
            <div className="w-60 max-w-full">
              <Sel
                value={prefs.replyModelLabel ?? 'name'}
                set={(value) => patch({ replyModelLabel: value as ReplyModelLabel })}
                opts={[['name', 'Display name'], ['slug', 'Model slug'], ['name-endpoint', 'Name + endpoint'], ['slug-endpoint', 'Slug + endpoint']]}
                inline
              />
            </div>
          </SettingRow>
        </Anchor>
        {toggle('show-log', 'showLog', 'Show model-use details')}
        <Anchor id="reply-footer">
          <SettingRow label="Reply footer">
            <div role="group" aria-label="Reply footer metrics" className="flex flex-wrap items-center gap-1.5">
              {REPLY_METRICS.map((metric) => {
                const on = footerStats.includes(metric.id)
                return (
                  <button
                    key={metric.id}
                    type="button"
                    aria-pressed={on}
                    title={`${on ? 'Hide' : 'Show'} ${metric.label.toLowerCase()} below replies`}
                    onClick={() => toggleFooterStat(metric.id)}
                    className={cx('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', on ? 'border-ac/40 bg-ac/10 text-ac' : 'border-bor text-mu hover:bg-surf hover:text-tx')}
                  >
                    {metric.label}
                  </button>
                )
              })}
            </div>
          </SettingRow>
        </Anchor>
        {toggle('stream-md', 'streamMd', 'Render markdown while streaming')}
        {toggle('custom-search', 'customSearch', 'Custom find in conversation (Ctrl+F)')}
        {toggle('remote-images', 'remoteImages', 'Load remote images')}
        {toggle('pinned-context', 'pinContext', 'Include the pinned reply in context')}
        <Anchor id="pinned-share">
          <SettingRow label="Pinned reply share">
            <RangeSlider label="Pinned reply share" min={5} max={50} step={5} value={prefs.pinContextPercent ?? 50} set={(pinContextPercent) => patch({ pinContextPercent })} disabled={prefs.pinContext === false} className="w-40" />
            <span className="w-12 text-right text-sm tabular-nums">{prefs.pinContextPercent ?? 50}%</span>
          </SettingRow>
        </Anchor>
        <Anchor id="stream-fade">
          <SettingRow label="Reply fade-in">
            <RangeSlider label="Reply fade-in duration" min={0} max={1} step={0.1} value={prefs.streamFade} set={(streamFade) => patch({ streamFade })} className="w-40" />
            <span className="w-14 text-right text-sm tabular-nums">{prefs.streamFade === 0 ? 'Off' : `${Math.round(prefs.streamFade * 1000)}ms`}</span>
          </SettingRow>
        </Anchor>
      </Section>

      <Section title="Process to answer">
        <Anchor id="process-detail">
          <SettingRow label="Detail level">
            <Seg v={prefs.logDetail ?? 'standard'} set={(v) => patch({ logDetail: normLogDetail(v) })} opts={[['compact', 'Compact'], ['standard', 'Standard'], ['verbose', 'Detailed']]} />
          </SettingRow>
        </Anchor>
        {toggle('process-timing', 'logTiming', 'Show step timings')}
        {toggle('process-models', 'logModels', 'Show the model on each step')}
      </Section>

      <Anchor id="temporary-chats">
        <Section title="Temporary chats">
          {toggle('temporary-default', 'temporaryByDefault', 'New chats are temporary by default')}
          <Anchor id="temp-retention">
            <SettingRow label="Temporary chat retention">
              <RangeSlider label="Temporary chat retention" min={0} max={48} step={1} value={prefs.tempHours} set={(tempHours) => patch({ tempHours })} className="w-40" />
              <span className="w-20 text-right text-sm tabular-nums">{prefs.tempHours === 0 ? 'Immediate' : `${prefs.tempHours} hours`}</span>
            </SettingRow>
          </Anchor>
          <Anchor id="temp-visible">
            <SettingRow label="Temporary chats shown">
              <RangeSlider label="Temporary chats shown" min={0} max={6} step={1} value={prefs.tempShow ?? 2} set={(tempShow) => patch({ tempShow })} className="w-40" />
              <span className="w-20 text-right text-sm tabular-nums">{(prefs.tempShow ?? 2) === 0 ? 'Current only' : (prefs.tempShow ?? 2) >= 6 ? 'All' : `${prefs.tempShow ?? 2} chat${(prefs.tempShow ?? 2) === 1 ? '' : 's'}`}</span>
            </SettingRow>
          </Anchor>
          {toggle('temp-streaming', 'tempShowStreaming', 'Keep replying temporary chats listed')}
          {toggle('temp-finished', 'tempShowDone', 'Keep finished temporary chats listed')}
        </Section>
      </Anchor>

      <Anchor id="archived-chats">
        <Section title="Archived chats">
          <Anchor id="archive-retention">
            <SettingRow label="Archived chat retention">
              <RangeSlider label="Archived chat retention" min={1} max={ARCHIVE_RETENTION_NEVER} step={1} value={normArchiveDays(prefs.archiveDays)} valueText={archiveRetentionLabel(prefs.archiveDays)} set={(n) => patch({ archiveDays: normArchiveDays(n) })} className="w-40" />
              <span className="w-20 text-right text-sm tabular-nums">{archiveRetentionLabel(prefs.archiveDays)}</span>
            </SettingRow>
          </Anchor>
        </Section>
      </Anchor>

      <Section title="Behavior">
        {toggle('enter-sends', 'enterSends', 'Enter sends the message')}
        <Anchor id="send-while-busy">
          <SettingRow label="Sending while a reply is running">
            <Seg v={(prefs.sendWhileBusy ?? 'queue') as 'queue' | 'stop'} set={(sendWhileBusy) => patch({ sendWhileBusy })} opts={[['queue', 'Queue'], ['stop', 'Stop first']]} />
          </SettingRow>
        </Anchor>
        <Anchor id="prompt-recall">
          <SettingRow label="Prompt recall (↑ / ↓)">
            <div className="w-52 max-w-full"><Sel value={normPromptRecall(prefs.promptRecall)} set={(promptRecall) => patch({ promptRecall: normPromptRecall(promptRecall) })} opts={PROMPT_RECALL_MODES as unknown as [string, string][]} inline /></div>
          </SettingRow>
        </Anchor>
        {toggle('auto-title', 'autoTitle', 'Auto-generate chat names')}
        <Anchor id="startup">
          <SettingRow label="Open on load">
            <div className="w-52 max-w-full"><Sel value={normStartup(prefs.startup)} set={(startup) => patch({ startup: normStartup(startup) })} opts={STARTUP_MODES as [string, string][]} inline /></div>
          </SettingRow>
        </Anchor>
        <Anchor id="draft-survival">
          <SettingRow label="Drafts across reloads">
            <div className="w-52 max-w-full"><Sel value={prefs.draftSurvive ?? 'both'} set={(draftSurvive) => patch({ draftSurvive: draftSurvive as typeof prefs.draftSurvive })} opts={[['off', 'Never'], ['new', 'New chat screen'], ['chats', 'Existing chats'], ['both', 'Both']]} inline /></div>
          </SettingRow>
        </Anchor>
      </Section>

      <Section title="Documents">
        <DocumentsSettings />
        <HelperPointer anchor="title-model" title="Title generation model" current={helperLabel(s, helperRef(prefs.titleEp, prefs.titleModel), 'Default (model that answered)')} />
      </Section>
    </Panel>
  )
}

const VIEWS: Record<string, () => ReactNode> = { features: FeaturesTab, eps: Eps, prompts: QualitiesTab, skills: SkillsTab, pls: Pls, cmds: Cmds, workspace: WorkspaceTab, tools: Tools, mcp: McpTab, memory: MemoryTab, widgets: WidgetsTab, look: AppearanceSettings, chats: Chats, voice: VoiceTab, keys: KeysTab, data: DataTab, adv: AdvancedTab }

export function Settings({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const features = useS((s) => s.features)
  const showOff = useS((s) => s.prefs.showDisabledFeatures === true)
  const tabs = visibleTabs(features)
  // Disabled features disappear from the nav unless the reader asked to keep
  // them listed (then they stay, marked Off).
  const navGroups = SETTINGS_GROUPS
    .map((g) => ({ label: g.label, tabs: g.tabs.filter((id) => showOff || tabs.some(([visible]) => visible === id)) }))
    .filter((g) => g.tabs.length)
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchSettings(query), [query])
  const { tab: rawTab, anchor } = splitSettingTarget(tab)
  const active = SETTINGS_TABS.some(([k]) => k === rawTab) ? rawTab : 'features'
  const disabledFeature = Object.entries(FEATURE_TABS).find(([f, ids]) => (ids as string[]).includes(active) && !featOn({ features }, f as FeatureId))?.[0] as FeatureId | undefined
  const featureLabel = FEATURES.find(([id]) => id === disabledFeature)?.[1] ?? 'This feature'
  const openResult = (target: string) => { setQuery(''); setTab(target) }
  const V = VIEWS[active] ?? FeaturesTab
  const settingsOpacity = useS((s) => s.prefs.settingsOpacity)
  const settingsWidth = useS((s) => s.prefs.settingsWidth ?? 1024)
  const settingsHeight = useS((s) => s.prefs.settingsHeight ?? 780)
  useEffect(() => {
    if (!anchor) return
    // Cards listen for this and open themselves when the anchor lives inside
    // one: the element does not exist in the DOM until they do, so dispatching
    // before the scroll is what makes deep links into collapsed cards work.
    try { window.dispatchEvent(new CustomEvent('byok:anchor', { detail: anchor })) } catch { /* scroll still runs */ }
    const t = setTimeout(() => flashAnchor(anchor), 60)
    return () => clearTimeout(t)
  }, [active, anchor, disabledFeature])
  useEffect(() => {
    const jump = (e: Event) => {
      const t = (e as CustomEvent<string>).detail
      if (typeof t === 'string' && t) setTab(t)
    }
    window.addEventListener('byok:setting', jump)
    return () => window.removeEventListener('byok:setting', jump)
  }, [setTab])
  return (
    <Modal close={() => setTab('')} blur={false} opacity={settingsOpacity} labelledBy="settings-title">
      <div style={{ width: `min(${settingsWidth}px, 100%)`, height: `min(${settingsHeight}px, 92dvh)` }} className="settings-root modal-panel flex flex-col overflow-hidden rounded-xl bg-bg">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-bor px-4">
          <h2 id="settings-title" className="text-sm font-semibold">Settings</h2>
          <button type="button" aria-label="Close settings" title="Close settings" onClick={() => setTab('')} className="grid size-7 place-items-center rounded-md text-mu transition-colors hover:bg-hov hover:text-tx"><X size={16} /></button>
        </div>
        <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="hidden w-52 shrink-0 flex-col border-r border-bor p-2.5 sm:flex">
          <label className="relative mb-2 block">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mu" />
            <input aria-label="Search settings" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className="w-full rounded-md bg-surf py-1.5 pl-8 pr-2.5 text-sm outline-none placeholder:text-mu focus:ring-2 focus:ring-ac/40" />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {query.trim() ? (<>
              {results.map(result => <button key={result.target} onClick={() => openResult(result.target)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surf"><span className="block">{result.title}</span><span className="block text-xs text-mu">{result.section}</span></button>)}
              {!results.length && <p className="px-2 py-2 text-sm text-mu">No settings found.</p>}
            </>) : navGroups.map((group, gi) => (
              <div key={group.label} className={cx(gi > 0 && 'mt-2 border-t border-bor pt-2')}>
                <div className="px-2 pb-1 text-xs font-medium text-mu">{group.label}</div>
                {group.tabs.map(id => {
                  const [k, l, I] = SETTINGS_TABS.find(([x]) => x === id)!
                  const off = !tabs.some(([visible]) => visible === k)
                  return <button key={k} onClick={() => setTab(k)} aria-current={active === k ? 'page' : undefined} className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors', active === k ? 'bg-hov text-tx' : 'text-mu hover:bg-surf hover:text-tx')}><I size={16} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{l}</span>{off && <span className="text-xs">Off</span>}</button>
                })}
              </div>
            ))}
          </div>
        </nav>
        <div className="relative min-w-0 flex-1">
          <div className="h-full overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-8 sm:py-5">
            <div className="mb-4 space-y-2 sm:hidden">
              <label className="relative block">
                <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mu" />
                <input aria-label="Search settings" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings" className="w-full rounded-md bg-surf py-2 pl-8 pr-3 text-sm outline-none placeholder:text-mu focus:ring-2 focus:ring-ac/40" />
              </label>
              {query.trim() ? <div className="max-h-48 overflow-y-auto rounded-md border border-bor">{results.map(result => <button key={result.target} onClick={() => openResult(result.target)} className="block w-full px-3 py-2 text-left text-sm hover:bg-hov">{result.title}<span className="ml-2 text-xs text-mu">{result.section}</span></button>)}{!results.length && <p className="p-3 text-sm text-mu">No settings found.</p>}</div> : <SearchSelect ariaLabel="Settings section" value={active} set={setTab} opts={SETTINGS_TABS.filter(([k]) => showOff || tabs.some(([v]) => v === k)).map(([k, l]) => [k, `${l}${tabs.some(([v]) => v === k) ? '' : ' (off)'}`] as [string, string])} />}
            </div>
            {disabledFeature ? <div className="space-y-3"><h2 className="text-lg font-semibold">{featureLabel} is off</h2><p className="text-sm text-mu">Turn it on in Features to use its settings.</p><Btn v="soft" onClick={() => setTab(`features#feature-${disabledFeature}`)}>Open Features</Btn></div> : active === 'stats'
              ? <Suspense fallback={<div role="status" className="py-10 text-center text-sm text-mu">Loading stats…</div>}><UsageStats onOpenChat={(chatId, messageId) => { useS.getState().patch({ chat: chatId, flashMsg: messageId, activeProject: '' }); setTab('') }} /></Suspense>
              : <ErrorBoundary compact title="These settings could not render"><V /></ErrorBoundary>}
          </div>
        </div>
        </div>
      </div>
    </Modal>
  )
}
