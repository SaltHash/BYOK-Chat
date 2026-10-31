import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X, Plus, Trash2, ArrowUp, ArrowDown, CornerDownRight, ChevronDown, ChevronRight, Eye, EyeOff, Play, ShieldCheck, Shield, Download, Upload, Check, CircleCheck, CircleX, Cpu, Route, GripVertical, Server, ListMusic, ScrollText, Terminal, Wrench, Palette, FolderOpen, FileText, PanelRight, TrendingUp, Keyboard, Search, Brain, Pencil, Sparkles, RotateCcw, SlidersHorizontal, FlaskConical, Library, Database, Lock, LockOpen, LayoutTemplate, Share2, Plug, Image as ImageIcon, Volume2, AudioLines, Code2, Star } from 'lucide-react'
import { useS, useSConfig, PRE, BLANK, THEMES, DARK_THEMES, LIGHT_THEMES, BASE_THEMES, THEME_COLOR_KEYS, THEME_COLOR_LABELS, THEME_COLORS, defaultCustomTheme, customThemeColors, normCustomTheme, accentHue, SEARCH_PROVIDERS, READER_PROVIDERS, FEATURES, LIBRARY_ITEMS, FEATURE_TABS, FEATURE_WIDGETS, DEFAULT_LIBRARY_SHOW, DEFAULT_ADVANCED, featOn, normSearch, normAdvanced, normLogDetail, normDocs, usable, modelsOf, modelNameOf, helperRef, splitHelperRef, favRef, toggleFavRef, effortClassifierOf, TOOL_ROUNDS_DEFAULT, TOOL_ROUNDS_MIN, TOOL_ROUNDS_BASE_MAX, TOOL_ROUNDS_MAX, toolRoundLimitOf, isToolRoundsUnlimited, GENERAL_PROMPT_TEXT, STARTUP_MODES, normStartup, PROMPT_RECALL_MODES, normPromptRecall, type PromptRecallMode, type Kind, type FeatureId, type DocPrefs, type ModelPrice } from '../store'
import { normSkills, resolveSkill, validateCustomSkill, enabledSkills, BUILTIN_SKILLS, SKILL_TOOL_NAME, type SkillState } from '../skills'
import { findDuplicatePairs, mergeMemory } from '../recall'
import { TOOL_REGISTRY, can, stream } from '../engine'
import { CI, TOOLS, WIDGETS, KEYS, orderTools } from '../meta'
import { SETTINGS_TABS, SETTINGS_GROUPS, searchSettings, splitSettingTarget, settingDomId } from '../settingsCatalog'
import { PROMPT_QUALITIES, type GlobalPrompt } from '../flair'
import { PROMPT_VARS } from '../promptVars'
import { DataTab, KeysTab, TestRow, TestAllEndpoints } from './Extra'
import { Btn, Field, Input, Area, Sel, SearchSelect, Toggle, Seg, RangeSlider, Checkbox, HelpTip, Modal, Surface, Chip, Item, cx, useEscapeClose, type Ic } from './ui'
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
import { accentOnlyColors } from '../theme'
import { USAGE_PERIODS } from '../usageStats'
import { UsageStats } from './UsageStats'

const TABS = SETTINGS_TABS
/** Tabs hidden while their owning feature is disabled. */
export const visibleTabs = (features?: Record<FeatureId, boolean>) => {
  const hidden = new Set<string>()
  for (const [f, tabs] of Object.entries(FEATURE_TABS)) {
    if (!featOn({ features }, f as FeatureId)) for (const t of tabs as string[]) hidden.add(t)
  }
  return SETTINGS_TABS.filter(([k]) => !hidden.has(k))
}
/** Addressable wrapper: renders id="setting-<anchor>" so the palette can
 *  deep-link to an individual setting. Unknown anchors still open the tab. */
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return <div id={settingDomId(id)} data-anchor={id} className="scroll-mt-6">{children}</div>
}
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
function HelperPointer({ anchor, title, desc, current }: { anchor: string; title: string; desc: string; current: string }) {
  return (
    <Anchor id={anchor}>
    <div className="rounded-xl bg-surf p-3 space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-mu">{desc}</div>
      <div className="text-xs text-mu">Current: <span className="text-tx">{current}</span></div>
      <div><Btn v="soft" icon={Cpu} onClick={() => goSetting('eps#helper-models')}>Open helper models</Btn></div>
    </div>
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
  useEscapeClose(() => { setOpen(false); trigger.current?.focus() }, open)
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
        <div ref={menu} role="menu" onKeyDown={(e) => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []); const i = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus() }} className="edge-border absolute left-0 top-full z-20 mt-1.5 w-64 rounded-xl bg-hov p-1.5">
          <Item icon={Cpu} onClick={() => pick('openai')} sub="Most providers, local servers, OpenRouter">OpenAI-compatible</Item>
          <Item icon={ScrollText} onClick={() => pick('anthropic')} sub="Anthropic Messages API shape">Anthropic-compatible</Item>
        </div>
      )}
    </div>
  )
}

const INFO: Record<string, string> = {
  features: 'Turn whole features on or off. A disabled feature is hidden everywhere and is never used by the AI or the app until you turn it back on.',
  library: 'Choose which shortcuts appear in the sidebar library.',
  eps: 'Model APIs you connect with your own key. Add several, disable any, and test each one.',
  prompts: 'Reusable system prompts. Pick one from the prompt menu under the chat box to override a playlist prompt. A global system prompt can also apply to every message in every chat.',
  skills: 'Extra instructions the AI can use for specific tasks. Turn on the ones you want available.',
  pls: 'Ordered lists of models from your endpoints. A request tries each model from top to bottom and stops at the first that succeeds. An optional classifier model picks one entry first.',
  cmds: 'Slash commands apply a system prompt and template to a typed input and run on the first endpoint that accepts that input type.',
  tools: 'Model tools such as date, calculator, and web search. Only enabled tools are sent to the provider.',
  mcp: 'External tool servers speaking the Model Context Protocol. Connect a server, load its tools, and every enabled server\u2019s tools join the normal tool loop. URLs and headers stay in this browser.',
  voice: 'Dictate messages with the microphone and have replies read aloud. Both use the browser\u2019s own speech features, with the language and speed you choose.',
  memory: 'Optional local memory. When enabled, the memory tool summarizes durable details and adds selected memories to future requests.',
  widgets: 'Optional panels beside the chat. Widgets are off by default; enable them here and drag the grip in the panel to rearrange them.',
  stats: 'Windowed usage dashboard built from every saved reply, including replies from temporary, archived and deleted chats: cost, tokens, models and recent attempts. The lifetime counters at the bottom are separate all-time totals that survive deleting chats.',
  keys: 'Click Change, then press the keys you want. Shortcuts need Ctrl/Cmd or Alt so they never fire while you type.',
  look: 'Theme, display options, and auto-generated chat names settings.',
  data: 'Export or import your setup. Exports leave API keys out unless you include them.',
  adv: 'Debugging aids for understanding what the model sees and does. Everything here is off by default; enable the Advanced feature to use it.',
}

/** A titled group of related settings inside a tab. Sections give every
 *  settings page the same shape: a header, then the settings that belong
 *  together. */
export function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-bor pb-1.5">
        <h3 className="text-sm font-semibold tracking-wide text-tx">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-mu">{desc}</p>}
      </div>
      {children}
    </section>
  )
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

export function Card({ icon: I, title, sub, right, open0, handle, children, muted }: { icon: Ic; title: ReactNode; sub?: string; right?: ReactNode; open0?: boolean; handle?: SortHandleProps | null; children: ReactNode; muted?: boolean }) {
  const [o, setO] = useState(!!open0)
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
    <Surface padded={false}>
      <div className="flex items-center gap-3 p-3">
        {handle && <span {...handle} title="Drag to reorder" className="dnd-handle -mr-1 cursor-grab text-mu"><GripVertical size={16} /></span>}
        <div role="button" tabIndex={0} onClick={() => setO(!o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setO(!o) } }} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
          <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg bg-hov', muted ? 'text-mu' : 'text-ac')}><I size={18} className={muted ? 'opacity-60' : undefined} /></span>
          <span className="min-w-0"><span className="block truncate font-medium">{title}</span>{sub && <span className="block truncate text-sm text-mu">{sub}</span>}</span>
        </div>
        {right}
        <Btn sm icon={ChevronRight} title={o ? 'Collapse' : 'Expand'} onClick={() => setO(!o)} className={cx('transition-transform', o && 'rotate-90')} />
      </div>
      {o && <div className="space-y-4 px-3 pb-4">{children}</div>}
    </Surface>
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
    {open && <Modal close={() => setOpen(false)}>
      <div className="modal-panel flex max-h-[80dvh] w-full max-w-lg flex-col gap-3 rounded-2xl bg-bg p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">Inference provider</h3>
            <p className="mt-0.5 truncate text-xs text-mu">{model}</p>
          </div>
          <button onClick={() => setOpen(false)} className="grid size-8 shrink-0 place-items-center rounded-lg text-mu hover:bg-hov hover:text-tx" aria-label="Close provider picker"><X size={16} /></button>
        </div>
        <p className="text-xs text-mu">Choose which OpenRouter provider serves this model. Requests use only the selected provider, with no fallback. The list comes from OpenRouter's live endpoint data.</p>
        <button onClick={() => void load()} className="self-start rounded-lg bg-hov px-3 py-2 text-xs text-tx">Refresh providers</button>
        <p className="text-xs text-mu">{status}</p>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto">
          <button onClick={clear} className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov', !current && 'bg-hov')}>
            <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center self-start rounded-full border', !current ? 'border-ac' : 'border-mu/60')}>{!current && <span className="size-2 rounded-full bg-ac" />}</span>
            <span className="min-w-0"><span className="block">Automatic</span><span className="block text-xs text-mu">Let OpenRouter route and load-balance.</span></span>
          </button>
          {providers.map((p) => {
            const on = current?.tag === p.tag
            return <button key={p.tag} onClick={() => pick(p.tag, p.name)} className={cx('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hov', on && 'bg-hov')}>
              <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center self-start rounded-full border', on ? 'border-ac' : 'border-mu/60')}>{on && <span className="size-2 rounded-full bg-ac" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block truncate text-xs text-mu">{[p.context ? `${contextLabel(p.context)} context` : '', p.throughput ? `${Math.round(p.throughput)} tok/s` : '', p.inputPrice !== undefined ? `$${p.inputPrice.toFixed(2)}/M in` : '', p.outputPrice !== undefined ? `$${p.outputPrice.toFixed(2)}/M out` : '', p.cacheReadPrice !== undefined ? `$${p.cacheReadPrice.toFixed(2)}/M cache read` : '', p.quantization].filter(Boolean).join(' · ')}</span>
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
  const setModels = (next: string[]) => update({ models: next, model: next.find((m) => m.trim())?.trim() ?? '' })
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
    update({ models: next, model: next[0] ?? '', modelNames: { ...e.modelNames, ...modelNames }, modelContext: { ...e.modelContext, ...modelCtx }, ...(Object.keys(modelPrices).length ? { prices: { ...e.prices, ...modelPrices } } : {}), modelEfforts: { ...e.modelEfforts, ...Object.fromEntries(effortEntries) }, modelEffortSource: { ...e.modelEffortSource, ...Object.fromEntries(effortEntries.map(([id, levels]) => [id, levels.length ? 'auto' : itemFor(id)?.source ?? 'manual'])) } })
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
      <div className="flex items-center justify-between"><div><h3 className="font-semibold">Choose a model</h3><p className="mt-0.5 text-xs text-mu">{e.name}{endpointId ? ` · ${endpointId}` : ''}</p></div><button onClick={() => setPicker(false)} className="grid size-8 place-items-center rounded-lg text-mu hover:bg-hov hover:text-tx" aria-label="Close model picker"><X size={16}/></button></div>
      <div className="flex flex-wrap gap-2"><button onClick={loadCatalog} className="rounded-lg bg-hov px-3 py-2 text-xs text-tx">{catalog.length ? 'Refresh model catalog' : 'Load available models'}</button>
      <button onClick={() => { clearModelDiscoveryCache(e.url); clearCatalogCache(e.id); void loadCatalog() }} title="Clear cached working and failed model-list URLs for this endpoint, then probe them again." className="rounded-lg px-3 py-2 text-xs text-mu hover:bg-hov hover:text-tx">Retry model-list checks</button></div>
      <p className="text-xs text-mu">{catalogState || 'Loads this endpoint’s own model list when the provider offers one, then public catalogs when unavailable.'} Catalog entries may not be enabled on your endpoint.</p>
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
      <Section title="Features" desc="Turn whole features on or off. A disabled feature is hidden everywhere.">
      <Anchor id="show-disabled-features">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Show disabled features<HelpTip text="Off: a disabled feature's settings tabs disappear completely. On: they stay listed and marked Off, so you can see what exists before turning it on." label="Help: Show disabled features" /></div>
          <div className="text-xs text-mu">Keep a disabled feature's settings visible, marked Off, instead of hiding them.</div>
        </div>
        <Toggle on={s.prefs.showDisabledFeatures === true} set={(showDisabledFeatures) => s.patch({ prefs: { ...s.prefs, showDisabledFeatures } })} label="Show disabled features" />
      </div>
      </Anchor>
      {order.map((id) => {
        const [, label, desc] = byId(id)
        return (
        <Anchor key={id} id={`feature-${id}`}>
        <Card icon={iconFor(id)} title={label} sub={F[id] ? 'On' : 'Off'} muted={!F[id]} right={<span className="flex items-center gap-1"><Btn sm icon={ArrowUp} title={`Move ${label} up`} disabled={order.indexOf(id) === 0} onClick={() => move(id, -1)} /><Btn sm icon={ArrowDown} title={`Move ${label} down`} disabled={order.indexOf(id) === order.length - 1} onClick={() => move(id, 1)} /><Toggle on={!!F[id]} set={(on) => toggle(id, on)} /></span>}>
          <p className="text-sm text-mu">{desc}</p>
          {id === 'library' && !!F[id] && (
            <Anchor id="library-entries">
            <Field label="Library entries" hint="Choose which shortcuts appear in the sidebar library.">
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
            <p className="text-sm text-mu">Stats stop counting immediately. Delete the existing totals, or keep them stored but frozen until you turn stats back on.</p>
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
            <p className="text-sm text-mu">The memory tool stops being offered and no stored context is read. Delete every stored memory, or keep them stored but unused until you turn memory back on.</p>
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
  const [open, setOpen] = useState(false)
  const clsRef = helperRef(s.memoryPrefs.classifierEp, s.memoryPrefs.classifierModel)
  const titleRef = helperRef(s.prefs.titleEp, s.prefs.titleModel)
  const effRef = helperRef(s.prefs.effortEp, s.prefs.effortModel)
  const recallRef = helperRef(s.prefs.recallEp, s.prefs.recallModel)
  const mixed = !(clsRef === titleRef && titleRef === effRef && effRef === recallRef)
  const main = mixed ? '__mixed__' : clsRef
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
  const setAll = (ref: string) => {
    if (ref === '__mixed__') return
    const [ep, model] = splitHelperRef(ref)
    s.patch({ prefs: { ...s.prefs, titleEp: ep, titleModel: model, effortEp: ep, effortModel: model, recallEp: ep, recallModel: model }, memoryPrefs: { ...s.memoryPrefs, classifierEp: ep, classifierModel: model } })
  }
  const setOne = (which: 'cls' | 'title' | 'eff' | 'recall', ref: string) => {
    const [ep, model] = splitHelperRef(ref)
    if (which === 'cls') s.patch({ memoryPrefs: { ...s.memoryPrefs, classifierEp: ep, classifierModel: model } })
    else if (which === 'title') s.patch({ prefs: { ...s.prefs, titleEp: ep, titleModel: model } })
    else if (which === 'recall') s.patch({ prefs: { ...s.prefs, recallEp: ep, recallModel: model } })
    else s.patch({ prefs: { ...s.prefs, effortEp: ep, effortModel: model } })
  }
  const singleOpts: [string, string][] = [
    ['', 'None'],
    ...s.eps.flatMap((e) => modelsOf(e).map((m) => [`${e.id}::${m}`, `${e.name} · ${modelNameOf(e, m)}`] as [string, string])),
  ]
  return (
    <Anchor id="helper-models">
    <Surface>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <Cpu size={18} className="shrink-0 text-ac" />
        <span className="min-w-0 flex-1"><span className="block font-medium">Helper models</span><span className="block truncate text-sm text-mu">Classification · title generation · effort detection · memory recall</span></span>
        <ChevronRight size={16} aria-hidden="true" className={cx('shrink-0 text-mu transition-transform', open && 'rotate-90')} />
      </button>
      <div className="mt-3">
        <Field label="Model for all helpers" hint="One model for playlist classification, chat-title generation, automatic effort detection, and memory recall. Expand below to set each one individually.">
          <Sel value={main} set={setAll} opts={opts} />
        </Field>
        {opts.find(([k]) => k === main)?.[1] === undefined && <p className="text-xs text-mu">Current: {refLabel(main)}</p>}
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-bg p-3">
          <Field label="Classification model" hint="Picks the best model in a playlist for each request. Playlists with their own classifier keep using it."><Sel value={clsRef} set={(v) => setOne('cls', v)} opts={singleOpts} /></Field>
          <Field label="Title generation model" hint="Names new chats. None uses the model that answered."><Sel value={titleRef} set={(v) => setOne('title', v)} opts={singleOpts} /></Field>
          <Field label="Effort detection model" hint="Chooses how hard the model thinks when a model is set to Auto."><Sel value={effRef} set={(v) => setOne('eff', v)} opts={singleOpts} /></Field>
          <Field label="Memory recall model" hint="Chooses which saved memories matter for each reply. Empty falls back to the classification model."><Sel value={recallRef} set={(v) => setOne('recall', v)} opts={singleOpts} /></Field>
        </div>
      )}
    </Surface>
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
  return <Modal close={close}>
    <div className="modal-panel flex max-h-[88dvh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-bg p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Terminal size={18} className="text-ac" />Add provider from cURL</h3>
          <p className="mt-1 text-xs text-mu">Paste a cURL command from the provider's docs. The URL, key, API format, and model are read locally; nothing is sent until you add the provider.</p>
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
          <p className="text-xs text-mu">After adding, common model-list locations are checked once. Working and failed URLs are remembered so later catalog loads do not repeat dead requests.</p>
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
      models,
      model: provider.model || models[0] || '',
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
      <Section title="Endpoints" desc="The model APIs you connect with your own key.">
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
              <Field label="Models" hint="Press Enter to add the next row. Every row uses this endpoint and API key.">
                <ModelsEditor e={e} update={u} />
              </Field>
              <Anchor id="model-behavior"><Field label="Model behavior" hint="Playlist mode groups this endpoint's models into a single playlist entry and tries them in order.">
                <Seg v={e.modelsMode ?? 'separate'} set={(modelsMode) => u({ modelsMode })} opts={[["separate", "Separate models"], ["playlist", "Treat as playlist"]]} />
              </Field></Anchor>
              </section></Anchor>
              <Anchor id="credentials"><section className="space-y-3 rounded-xl bg-bg p-3"><div className="text-sm font-medium">Credentials</div>
              <Field label="API key" hint="Stored unencrypted in this browser and sent only to the base URL.">
                <div className="relative">
                  <Input aria-label="Endpoint API key" type={show === e.id ? 'text' : 'password'} value={e.key} set={(v) => u({ key: v })} placeholder="Leave empty for local servers" />
                  <button onClick={() => setShow(show === e.id ? '' : e.id)} aria-label={show === e.id ? 'Hide API key' : 'Show API key'} title={show === e.id ? 'Hide API key' : 'Show API key'} className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{show === e.id ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </Field>
              {!provider && <Field label="Auth method" hint="How the key is sent. Custom endpoints use this; named presets keep their own auth scheme.">
                <Sel value={endpointAuthOf(e)} set={(v) => u({ auth: v as EndpointAuth })} opts={ENDPOINT_AUTH_OPTIONS} placeholder="Choose auth" />
              </Field>}
              <Field label="Extra headers" hint="Optional. One Name: value per line. Sent with chat and model-list requests. Auth headers here override the auth method.">
                <Area rows={3} value={e.headers ?? ''} set={(v) => u({ headers: v })} placeholder={'HTTP-Referer: https://example.com\nX-Title: BYOK Chat'} className="font-mono text-xs" spellCheck={false} />
              </Field>
              </section></Anchor>
              <Anchor id="advanced-connection"><details open={advanced.includes(e.id)} onToggle={(ev) => { const isOpen = ev.currentTarget.open; setAdvanced(current => isOpen ? [...new Set([...current, e.id])] : current.filter(id => id !== e.id)) }} className="rounded-xl bg-bg px-3"><summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-mu"><span>Advanced connection settings</span><ChevronRight size={16} aria-hidden="true" className={cx('transition-transform', advanced.includes(e.id) && 'rotate-90')} /></summary><div className="space-y-3 pb-3">
                <Field label="Base URL" hint="The app adds the API path to this URL automatically."><Input value={e.url} set={(v) => { const match = presetForUrl(v); u({ url: v, ...(match ? { preset: match[0], endpointId: match[1][2], endpointFilter: match[1][3] } : { preset: '', endpointId: '', endpointFilter: 'author' }) }) }} placeholder="https://…/v1" /></Field>
                <Field label="API format"><Seg v={e.type} set={(v) => u({ type: v })} opts={[[ 'openai', 'OpenAI-compatible'], ['anthropic', 'Anthropic Messages']]} /></Field>
                <Field label="Endpoint ID" hint="Used to limit OpenRouter catalog suggestions to this brand or hosting provider."><Input value={e.endpointId ?? presetForUrl(e.url)?.[1][2] ?? ''} set={(endpointId) => u({ endpointId, endpointFilter: catalogPrefs(endpointId) })} placeholder="e.g. anthropic" /></Field>
                {provider?.accountScoped && <Field label="Account ID" hint="Cloudflare account-scoped APIs put this in the base URL. Find it in the Cloudflare dashboard; it is stored in this browser with the key."><Input value={e.accountId ?? ''} set={(accountId) => u({ accountId })} placeholder="Cloudflare account ID" /></Field>}
                {provider?.gatewayHeader && <Field label={provider.gatewayHeader.label} hint={`Sent as the ${provider.gatewayHeader.header} header. Workers AI models (${provider.gatewayHeader.modelPrefix ?? '@cf/'}) require an AI Gateway.`}><Input value={e.gatewayId ?? ''} set={(gatewayId) => u({ gatewayId })} placeholder="Optional AI Gateway id" /></Field>}
                {provider && <p className="text-xs text-mu">Browser access to {provider.name}: <span className={provider.cors === 'blocked' ? 'text-er' : provider.cors === 'confirmed' ? 'text-ac' : 'text-mu'}>{provider.cors}</span>. {provider.corsNote} Providers that block browser requests still work through the relay below.</p>}
                <Field label="Request routing" hint="Auto tries the provider directly and relays through this app's server only when the browser blocks it (CORS). Always relay sends every provider request through this server — it works for any provider, but the server sees the key in transit (it is never stored or logged). Direct only never relays.">
                  <Seg v={(s.prefs.proxyMode ?? 'auto') as 'auto' | 'always' | 'off'} set={(v) => s.patch({ prefs: { ...s.prefs, proxyMode: v } })} opts={[['auto', 'Auto'], ['always', 'Always relay'], ['off', 'Direct only']]} />
                </Field>
              </div></details></Anchor>
            </div>
            {useS.getState().prefs.showModelPricing && modelsOf(e).length > 0 && <Anchor id="model-pricing"><div className="space-y-3 rounded-xl bg-bg p-3">
              <div><div className="text-sm font-medium">Model pricing</div><div className="text-xs text-mu">USD per 1 million tokens. Estimates use reported token counts.</div></div>
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
                  <div className="mt-2 text-xs text-mu">Cache rates are optional. Empty falls back to the input rate; loading a model catalog fills them when the provider publishes them.</div>
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
      <Section title="Helper models" desc="The models that do the small jobs behind the scenes.">
      <HelperModels />
      <Anchor id="model-pricing-toggle">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <label className="flex items-center justify-between gap-3 text-sm">Show model pricing controls<Toggle on={s.prefs.showModelPricing} set={(showModelPricing) => s.patch({ prefs: { ...s.prefs, showModelPricing } })} /></label>
        <div className="text-xs text-mu">Adds per-model pricing fields to each endpoint. Off by default.</div>
      </div>
      </Anchor>
      </Section>
      {curlOpen && <CurlImportModal close={() => setCurlOpen(false)} importProvider={importCurl} />}
    </Panel>
  )
}



/* The {variable} placeholders a system prompt can use, described in the
 * help tooltip instead of insert buttons. */
const PROMPT_VAR_HINT = `${PROMPT_VARS.map((v) => `{${v.id}} — ${v.desc}`).join(' · ')}`

function Prompts() {
  const { prompts, upd, patch, globalPrompt } = useSConfig()
  const g = globalPrompt ?? { on: false, text: '', qualities: [] }
  const qualities = g.qualities ?? []
  const setG = (v: Partial<GlobalPrompt>) => patch({ globalPrompt: { ...g, ...v } })
  return (
    <Panel id="prompts" k="prompts" n={prompts.length} add="Add prompt">
      <Section title="Global prompt" desc="Applied to every message in every chat.">
      <Anchor id="global-prompt"><Card icon={ScrollText} title="Global system prompt" sub={g.on ? (g.text.trim() || qualities.length ? 'On · applies to every message in every chat' : 'On · no text yet') : 'Off'} muted={!g.on}>
        <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Apply to every message</div><div className="text-xs text-mu">Added before everything else in every chat, alongside the per-chat prompt.</div></div><Toggle on={g.on} set={(on) => setG({ on })} /></div>
        <Field label="Or pick an existing prompt" hint="Copies its text into the global box.">
          <Sel value="" set={(v) => { const p = prompts.find((x) => x.id === v); if (p) setG({ text: p.text }) }} opts={[['', 'Choose a prompt…'], ...prompts.map((p) => [p.id, p.name] as [string, string])]} />
        </Field>
        <Field label="Qualities" hint="Adds a short tone instruction after the base prompt. Pick any that fit; the base stays authoritative.">
          <div className="flex flex-wrap gap-2">{PROMPT_QUALITIES.map((q) => {
            const on = qualities.includes(q.id)
            return <button key={q.id} type="button" aria-pressed={on} title={q.text} onClick={() => {
              const next = on ? qualities.filter((id) => id !== q.id) : [...qualities, q.id]
              setG({ qualities: next, ...(on ? {} : { on: true }) })
            }} className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors', on ? 'border-ac/50 bg-ac/10 text-tx' : 'border-bor bg-surf text-mu hover:bg-hov hover:text-tx')}>
              {on && <Check size={13} strokeWidth={3} className="text-ac" />}
              {q.label}
            </button>
          })}</div>
        </Field>
        <Field label="Global system prompt" hint={`This is the base. Write one from scratch, or copy an existing prompt above. You can use {variable} placeholders, replaced with the current UTC values when the request is sent: ${PROMPT_VAR_HINT}`}><Area rows={6} value={g.text} set={(v) => setG({ text: v })} /></Field>
        <div className="flex justify-end"><Btn v="soft" icon={CornerDownRight} onClick={() => setG({ on: true, text: GENERAL_PROMPT_TEXT, qualities: [] })}>Revert to default</Btn></div>
      </Card></Anchor>
      </Section>
      <Section title="Chat prompts" desc="Reusable system prompts you pick per chat.">
      <Anchor id="add-prompt"><span className="block text-xs text-mu">Use Add prompt above for per-chat prompts; each prompt below is individually addressable.</span></Anchor>
      <SortableCards k="prompts" ids={prompts.map((x) => x.id)} label="Prompt" renderCard={(pid, handle) => {
        const p = prompts.find((x) => x.id === pid)
        if (!p) return null
        return (
        <Anchor key={pid} id={`prompt-${p.id}`}>
        <Card handle={handle} icon={ScrollText} title={p.name} sub={p.text.slice(0, 70)}>
          <Field label="Name"><Input value={p.name} set={(v) => upd('prompts', p.id, { name: v })} /></Field>
          <Field label="System prompt" hint={`Sent as the system prompt when this prompt is selected. {variable} placeholders are replaced with the current UTC values when the request is sent: ${PROMPT_VAR_HINT}`}><Area rows={6} value={p.text} set={(v) => upd('prompts', p.id, { text: v })} /></Field>
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
    <Panel id="pls" k="pls" n={pls.length} add="Add playlist">
      <Section title="Routing" desc="How a request picks the model that answers it.">
      <Anchor id="routing-mode"><Card icon={Route} title="Routing mode" sub="How multi-model requests try models">
        <Field label="Candidate order" hint="Ordered tries list order. Fastest tries the quickest-measured models first (new models go first until measured). Cheapest tries the lowest input price first (models without a price go last). A playlist classifier, when set, still picks first; the mode orders the rest.">
          <Seg v={routingMode} set={(v) => useS.getState().patch({ prefs: { ...useS.getState().prefs, routingMode: v as typeof routingMode } })} opts={[['ordered', 'Ordered'], ['fastest', 'Fastest'], ['cheapest', 'Cheapest']]} />
        </Field>
        <div className="space-y-1">
          <Anchor id="observed-performance"><div className="flex items-center justify-between"><span className="text-sm font-medium">Observed performance</span><Btn v="soft" disabled={!statRows.length} onClick={() => useS.getState().patch({ routeStats: {} })}>Reset</Btn></div></Anchor>
          {!statRows.length && <p className="text-xs text-mu">No attempts recorded yet. Averages appear here after replies run.</p>}
          {statRows.slice(0, 12).map((r) => (
            <div key={r.key} className="flex items-center gap-2 rounded-lg bg-bg px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-mu">{r.calls} tries · {r.fails} failed · ~{r.avg} ms</span>
            </div>
          ))}
        </div>
      </Card></Anchor>
      </Section>
      <Section title="Playlists" desc="Ordered lists of models tried one after another.">
      <Anchor id="add-playlist"><span className="block text-xs text-mu">Use Add playlist above; each playlist below is individually addressable.</span></Anchor>
      <SortableCards k="pls" ids={pls.map((x) => x.id)} label="Playlist" renderCard={(plid, handle) => {
        const p = pls.find((x) => x.id === plid)
        if (!p) return null
        const u = (x: object) => upd('pls', p.id, x)
        return (
          <Anchor key={plid} id={`playlist-${p.id}`}>
          <Card handle={handle} icon={ListMusic} title={p.name} sub={`${p.e.length} entries${p.cls ? ' · classifier' : ''}`}>
            <Field label="Name"><Input value={p.name} set={(v) => u({ name: v })} /></Field>
            <Field label="System prompt" hint={`Optional. Used when this playlist is selected and no prompt override is chosen. {variable} placeholders are replaced with the current UTC values when the request is sent: ${PROMPT_VAR_HINT}`}><Area value={p.sys} set={(v) => u({ sys: v })} /></Field>
            <Field label="Models" hint="Each entry is one model from an endpoint. Tried top to bottom until one responds without error.">
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
              <Field label="Classifier endpoint" hint="Picks which model in this playlist answers each request. Replies that don't pick a model from this list are ignored. Empty uses the helper classification model from Endpoints when one is set, otherwise list order.">
                <Sel value={p.cls} set={(v) => u({ cls: v })} opts={[[ '', useS.getState().memoryPrefs.classifierEp ? 'None, use helper model' : 'None, use list order'], ...eps.map((e) => [e.id, e.name] as [string, string])]} />
              </Field>
              {p.cls && eps.find((e) => e.id === p.cls) && <Field label="Classifier model"><Sel value={p.clsModel ?? ""} set={(v) => u({ clsModel: v })} opts={[["", "Default model"], ...modelsOf(eps.find((e) => e.id === p.cls)!).map((model) => [model, modelNameOf(eps.find((e) => e.id === p.cls)!, model) + " · " + model] as [string, string])]} /></Field>}
              <Field label="Routing instructions"><Area rows={3} value={p.rule} set={(v) => u({ rule: v })} /></Field>
              <code className="block rounded-lg bg-surf px-3 py-2 text-xs text-mu">{'{"model":"<id from this playlist>"}'}</code>
            </div>
            <Acts k="pls" id={p.id} />
          </Card>
          </Anchor>
        )
      }} />
      </Section>
    </Panel>
  )
}

function Cmds() {
  const { cmds, pls, upd } = useSConfig()
  return (
    <Panel id="cmds" k="cmds" n={cmds.length} add="Add command">
      <Section title="Commands" desc="Slash commands that apply a system prompt to a typed input.">
      <Anchor id="add-command"><span className="block text-xs text-mu">Use Add command above; each command below is individually addressable.</span></Anchor>
      <SortableCards k="cmds" ids={cmds.map((x) => x.id)} label="Command" renderCard={(cid, handle) => {
        const c = cmds.find((x) => x.id === cid)
        if (!c) return null
        const u = (x: object) => upd('cmds', c.id, x)
        return (
          <Anchor key={cid} id={`command-${c.id}`}>
          <Card handle={handle} icon={CI[c.in]} title={'/' + c.name} sub={c.desc || c.in} muted={!c.on} right={<Toggle on={c.on} set={(v) => u({ on: v })} />}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" hint="Typed after /"><Input value={c.name} set={(v) => u({ name: v.replace(/[^\w-]/g, '') })} /></Field>
              <Field label="Description"><Input value={c.desc} set={(v) => u({ desc: v })} /></Field>
              <Field label="Argument hint" hint="Shown after the command name in the / menu, e.g. <topic> or [language]. This is guidance only; it is not sent to the model."><Input value={c.args ?? ''} set={(v) => u({ args: v })} placeholder="<topic>" /></Field>
            </div>
            <Field label="Input type"><Seg v={c.in} set={(v) => u({ in: v })} opts={[['text', 'Text', CI.text], ['image', 'Image', CI.image], ['image+text', 'Image + text', CI['image+text']], ['doc', 'Document', CI.doc]]} /></Field>
            <Field label="System prompt" hint={`Sent as the system prompt when the command runs. {variable} placeholders are replaced with the current UTC values when the request is sent: ${PROMPT_VAR_HINT}`}><Area value={c.sys} set={(v) => u({ sys: v })} /></Field>
            <Field label="Message template" hint="{{input}} is replaced by the text typed after the command."><Area rows={3} value={c.tpl} set={(v) => u({ tpl: v })} /></Field>
            <Field label="Run on" hint="The first endpoint that accepts the input type is used; the rest are fallbacks.">
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
        <span aria-live="polite" className="w-24 shrink-0 text-right text-sm text-mu">{unlimited ? 'Unlimited' : `${sliderVal} rounds`}</span>
        <Btn sm icon={unlocked ? LockOpen : Lock} title={unlocked ? 'Lock back to 32 rounds' : 'Unlock up to 64 rounds plus unlimited'} onClick={() => (unlocked ? relock() : setWarn(true))} />
      </div>
      <p className="text-xs text-mu">
        {unlocked
          ? 'Higher limits unlocked: the top tick is unlimited. Each round is another billed model request; a looping model can run long, cost tokens, and outgrow context. Press Stop any time.'
          : `Caps sequential model → tool → model rounds at ${TOOL_ROUNDS_BASE_MAX} or fewer. Unlock for up to ${TOOL_ROUNDS_MAX}, plus an unlimited top tick.`}
      </p>
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

function DocumentsCard() {
  const s = useSConfig()
  const d = normDocs(s.docPrefs)
  const set = (p: Partial<DocPrefs>) => s.patch({ docPrefs: { ...d, ...p } })
  const visionEps = s.eps.filter((e) => usable(e) && can(e, 'img'))
  const ocrEp = s.eps.find((e) => e.id === d.ocrEp)
  return (
    <Anchor id="documents">
    <Card icon={FileText} title="Documents" sub="PDF text, Office files, archives, transcripts, image OCR">
      <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Extract PDF text</div><div className="text-xs text-mu">Read the text layer of PDFs so every endpoint (not just Anthropic) can use them. Scanned pages still need OCR or a vision endpoint.</div></div><Toggle on={d.pdfText} set={(pdfText) => set({ pdfText })} /></div>
      <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Read Office documents</div><div className="text-xs text-mu">Extract text from .docx, .odt, .rtf, .pptx and first-sheet .xlsx locally. Legacy .doc/.xls/.ppt still need conversion.</div></div><Toggle on={d.office} set={(office) => set({ office })} /></div>
      <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Unpack archives</div><div className="text-xs text-mu">Expand .zip and .gz attachments into individual files (up to 25 entries). Pair .vtt/.srt transcripts with matching audio/video automatically.</div></div><Toggle on={d.archives} set={(archives) => set({ archives })} /></div>
      <Field label="Image text extraction (OCR)" hint="Auto transcribes images only when the answering model can't read images itself. Always transcribes every image. Uses the vision endpoint below.">
        <Seg v={d.ocr} set={(ocr) => set({ ocr })} opts={[['off', 'Off'], ['auto', 'Auto'], ['always', 'Always']]} />
      </Field>
      <Anchor id="ocr">
      {d.ocr !== 'off' && (
        <div className="space-y-2 rounded-lg bg-bg p-3">
          <Field label="OCR vision endpoint"><Sel value={d.ocrEp} set={(ocrEp) => set({ ocrEp, ocrModel: '' })} opts={[['', 'First vision-capable endpoint'], ...visionEps.map((e) => [e.id, e.name] as [string, string])]} /></Field>
          {ocrEp && <Field label="OCR model"><Sel value={d.ocrModel} set={(ocrModel) => set({ ocrModel })} opts={[['', 'Endpoint default'], ...modelsOf(ocrEp).map((m) => [m, m] as [string, string])]} /></Field>}
          {!visionEps.length && <p className="text-xs text-er">No usable vision-capable endpoint yet. Add one in Settings → Endpoints for OCR to work.</p>}
        </div>
      )}
      </Anchor>
      <Anchor id="per-file-chars">
      <Field label="Text per document" hint="Character budget for each extracted document. The message-wide text budget still applies.">
        <Sel value={String(d.perFileChars)} set={(v) => set({ perFileChars: Number(v) })} opts={[['15000', '15k characters'], ['30000', '30k characters'], ['60000', '60k characters'], ['100000', '100k characters'], ['200000', '200k characters (max)']]} />
      </Field>
      </Anchor>
    </Card>
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
        <p className="text-sm">Lets the model generate pictures with an OpenAI-compatible <code>/images/generations</code> endpoint. Images appear beside the reply and are stored in this browser so they survive a reload; nothing binary is added to the chat or the context window.</p>
        <p className="text-sm text-mu">Anthropic endpoints cannot generate images. Requests use the endpoint below with your key, like any other model call.</p>
        {!eps.length && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">No enabled OpenAI-compatible endpoint is available. Add one in Endpoints first.</p>}
        <Field label="Image endpoint" hint="Which endpoint receives the image request. Empty uses the first usable OpenAI-compatible endpoint.">
          <Sel value={g.ep && s.eps.some((e) => e.id === g.ep) ? g.ep : ''} set={(id) => set({ ep: id })} opts={[['', eps[0] ? `First usable · ${eps[0].name}` : 'First usable OpenAI-compatible'], ...s.eps.filter((e) => e.type === 'openai').map((e) => [e.id, `${e.name}${e.on ? '' : ' (disabled)'}`] as [string, string])]} />
        </Field>
        <Field label="Image model" hint="Model id for the image endpoint, for example gpt-image-1, dall-e-3, or a Flux model served by a compatible API. Empty uses the endpoint's default model.">
          <Input value={g.model} set={(model) => set({ model })} placeholder={ep?.model ? `Default: ${ep.model}` : 'e.g. gpt-image-1'} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Size" hint="Sizes the endpoint accepts. Unsupported sizes fail with the provider's own message.">
            <Sel value={g.size} set={(size) => set({ size })} opts={IMAGE_SIZES} />
          </Field>
          <Field label="Images per call" hint="How many images one request generates. 1-4.">
            <Sel value={String(g.count)} set={(v) => set({ count: Number(v) })} opts={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} />
          </Field>
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
        <p className="text-sm">Lets the model run short snippets and read their stdout. Every run happens in a disposable Web Worker in this browser: no page DOM, no app storage, no files, and no network for JavaScript. The worker is stopped when the time limit runs out, so an infinite loop cannot freeze the app.</p>
        <p className="text-sm text-mu">Each run starts fresh, so nothing carries between calls. Code and output are capped, and results are returned to the model as text.</p>
        <Anchor id="code-timeout">
          <Field label={`Time limit · ${secs}s`} hint="Wall-clock budget for the snippet once it starts running: the worker is terminated when it runs out. Python runtime startup and package downloads have their own 60 s guard so a slow download does not eat the execution budget.">
            <RangeSlider label="Code time limit" min={CODE_TIMEOUT_MIN / 1000} max={CODE_TIMEOUT_MAX / 1000} step={1} value={secs} valueText={`${secs} second${secs === 1 ? '' : 's'}`} set={(n) => set({ timeoutMs: Math.round(n) * 1000 })} className="w-full" />
          </Field>
        </Anchor>
        <Anchor id="code-output">
          <Field label="Output limit" hint="Maximum characters of stdout and result kept from a run. Longer output is truncated with a notice.">
            <Sel value={String(c.maxOutput)} set={(v) => set({ maxOutput: Number(v) })} opts={[['5000', '5k characters'], ['20000', '20k characters'], ['50000', '50k characters'], [String(CODE_OUTPUT_MAX), '100k characters (max)']]} />
          </Field>
        </Anchor>
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-sm font-medium">Enable Python</div><div className="text-xs text-mu">Python runs through Pyodide (CPython compiled to WebAssembly). The first run downloads roughly 10 MB; later runs load it from the browser cache.</div></div>
          <Toggle on={c.python} set={(python) => set({ python })} label="Allow Python code execution" />
        </div>
        {c.python && <>
          <Anchor id="code-packages">
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">Load Python packages</div><div className="text-xs text-mu">Fetch prebuilt wheels (numpy, pandas, scipy, matplotlib and others) when a snippet imports them, then run offline. Each package downloads once and is cached by the browser; large ones can be tens of megabytes.</div></div>
              <Toggle on={c.pyPackages} set={(pyPackages) => set({ pyPackages })} label="Load Python packages on demand" />
            </div>
          </Anchor>
          <Anchor id="code-pyodide-url">
            <Field label="Pyodide URL" hint="Directory containing pyodide.js, or a full pyodide.js link. Point this at a self-hosted copy to avoid the CDN. Invalid values fall back to the pinned CDN.">
              <Input value={c.pyodideUrl} set={(pyodideUrl) => set({ pyodideUrl })} placeholder={PYODIDE_DEFAULT_URL} />
            </Field>
          </Anchor>
          <p role="note" className="rounded-lg bg-bg px-3 py-2 text-xs text-mu">Python runs locally, but its runtime can reach the network through its JavaScript bridge. Only keep Python enabled if you trust code the model writes. Pyodide URL changes apply to the next run.</p>
        </>}
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
    setAsk(k)
  }
  const allowTool = (k: string, always: boolean) => {
    rememberScroll(k)
    s.patch({ tools: { ...s.tools, [k]: true }, ...(always ? { toolConsent: true } : {}) })
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
      <Section title="Execution" desc="How many model → tool rounds a single reply may run, and the extra capabilities the model can call.">
      <ToolLimitCard />
      <CodeRunCard />
      </Section>
      <Section title="Capabilities" desc="Optional features that add their own tools to every request.">
      <ImageGenCard />
      <Anchor id="deep-research">
      <Card icon={Brain} title="Deep research" sub="@research(query)">
        <p className="text-sm">Multi-step investigation: the model drafts a research plan for you to review, then searches and reads on its own within the depth budget, narrating progress as it goes, ending in a long cited report opened from a card in a document-styled side panel.</p>
        <p className="text-sm text-mu">Start with @research(topic), the + menu → Deep research…, or a model-suggested “Deep research …” chip. Every run asks for Quick, Standard, or Thorough, then shows a plan you can edit or start; a stopped run can be resumed where it left off.</p>
        <p className="text-sm text-mu">Failed searches and unreadable pages are shown in the progress card but do not use up the run's search or page budget.</p>
      </Card>
      </Anchor>
      </Section>
      <Section title="Tools" desc="The tools the model may call. Enabled tools are sorted to the top and stay where you are reading.">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0"><div className="text-sm font-medium">Ask before enabling device tools</div><div className="text-xs text-mu">Shows one allow prompt for Location, Clipboard, Date and Date and time. The answer covers all four, so they never ask again.</div></div>
        <Toggle on={!consent} set={(v) => s.patch({ toolConsent: !v })} label="Ask before enabling device tools" />
      </div>
      {listed.map(([k, n, I, u, d, p]) => (
        <div key={k} ref={(el) => { if (el) cardEls.current.set(k, el); else cardEls.current.delete(k) }}>
        <Anchor id={`tool-${k}`}>
        <Card icon={I} title={n} sub={u} muted={!s.tools[k]} right={
          <>
            <span className="hidden items-center gap-1.5 text-xs text-mu sm:flex">{s.tools[k] ? <ShieldCheck size={14} className="text-ac" /> : <Shield size={14} />}{s.tools[k] ? 'Allowed' : 'Off'}</span>
            <Toggle on={!!s.tools[k]} set={(v) => toggleTool(k, v)} />
          </>
        }>
          <p className="text-sm">{d}</p>
          <p className="text-sm text-mu">Permission: {p}</p>
          {k === 'workspace_upsert' && <Anchor id="workspace-view"><div className="space-y-3 rounded-xl bg-bg p-3">
            <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Default view for workspace tiles</div><div className="text-xs text-mu">Pinned shows the revision created by each message. Latest shows the most recent revision with a dropdown to go back.</div></div><Seg v={s.workspacePrefs?.defaultView ?? 'pinned'} set={(defaultView) => s.patch({ workspacePrefs: { ...s.workspacePrefs, defaultView } })} opts={[['pinned', 'Pinned'], ['latest', 'Latest']]} /></div>
            <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Auto-open workspace panel</div><div className="text-xs text-mu">Automatically open the side panel when the AI starts writing files.</div></div><Toggle on={s.workspacePrefs?.autoOpen ?? true} set={(autoOpen) => s.patch({ workspacePrefs: { ...s.workspacePrefs, autoOpen } })} /></div>
            <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Auto-follow active file</div><div className="text-xs text-mu">When the AI switches to writing a different file, automatically select it in the panel.</div></div><Toggle on={s.workspacePrefs?.autoFollow ?? true} set={(autoFollow) => s.patch({ workspacePrefs: { ...s.workspacePrefs, autoFollow } })} /></div>
          </div></Anchor>}
          {k === 'search' && <div className="space-y-3 rounded-xl bg-bg p-3">
            <Anchor id="search-provider">
            <Field label="API provider" hint="Your searches run through this provider with your own key below. The results ground the reply and become its sources. Jina AI works without a key at a lower rate limit.">
              <Sel value={search.provider} set={(provider) => { setShowSearchKey(false); setSearch({ provider: provider as typeof search.provider }) }} opts={SEARCH_PROVIDERS.map(([id, label]) => [id, label] as [string, string])} />
            </Field>
            </Anchor>
            {!ownKey && !keyless && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">No {health?.apiProviders?.[search.provider]?.label ?? search.provider} key saved in this browser yet. Searches will fail until you paste one below.</p>}
            {keyless && !ownKey && <p className="rounded-lg bg-hov px-3 py-2 text-xs text-mu">{health?.apiProviders?.[search.provider]?.label ?? search.provider} works without a key at a lower rate limit. Add one to raise the limits.</p>}
            <Anchor id="search-key">
            <Field label={`${health?.apiProviders?.[search.provider]?.label ?? search.provider} API key`} hint="Bring your own key. Stored unencrypted in this browser and sent only to your search backend with each query.">
              <div className="relative">
                <Input type={showSearchKey ? 'text' : 'password'} value={search.keys[search.provider] ?? ''} set={(v) => setSearch({ keys: { [search.provider]: v } })} placeholder="Paste your search API key" />
                <button onClick={() => setShowSearchKey(!showSearchKey)} title="Show or hide key" className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{showSearchKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </Field>
            </Anchor>
            {search.provider === 'brightdata' && <Anchor id="search-zone"><Field label="SERP zone" hint="Your Bright Data SERP API zone name. Stored in this browser like the key."><Input value={search.zone} set={(zone) => setSearch({ zone })} placeholder="e.g. serp_api1" /></Field></Anchor>}
            <Anchor id="search-max-results">
            <Field label={`Results per search · ${search.maxResults}`} hint="How many search results the model gets each time. The model may ask for fewer, but never more than this. Most search APIs top out at 10.">
              <RangeSlider label="Results per search" min={1} max={10} step={1} value={search.maxResults} valueText={`${search.maxResults} result${search.maxResults === 1 ? '' : 's'}`} set={(maxResults) => setSearch({ maxResults: Math.round(maxResults) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="search-timeout">
            <Field label={`Request timeout · ${(search.timeoutMs / 1000).toFixed(search.timeoutMs % 1000 ? 1 : 0)}s`} hint="How long to wait for the search provider before retrying or failing.">
              <RangeSlider label="Request timeout" min={1000} max={30000} step={1000} value={search.timeoutMs} valueText={`${(search.timeoutMs / 1000).toFixed(search.timeoutMs % 1000 ? 1 : 0)} seconds`} set={(timeoutMs) => setSearch({ timeoutMs: Math.round(timeoutMs) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="search-snippet">
            <Field label={`Text per result · ${search.maxSnippetChars} characters`} hint="How much text to keep from each search result. More text means more detail but uses more of the model's context.">
              <RangeSlider label="Text per result" min={200} max={3000} step={100} value={search.maxSnippetChars} valueText={`${search.maxSnippetChars.toLocaleString()} characters`} set={(maxSnippetChars) => setSearch({ maxSnippetChars: Math.round(maxSnippetChars) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="search-evidence">
            <Field label={`Total text per search · ${search.evidenceBudget.toLocaleString()} characters`} hint="The overall text budget for one search, shared by all results. Raise it if results get cut short, lower it to save context.">
              <RangeSlider label="Total text per search" min={1000} max={24000} step={500} value={search.evidenceBudget} valueText={`${search.evidenceBudget.toLocaleString()} characters`} set={(evidenceBudget) => setSearch({ evidenceBudget: Math.round(evidenceBudget) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="search-retries">
            <Field label="Retries" hint="Bounded retries for transient failures (429/5xx/timeouts). Permanent errors are never retried.">
              <Sel value={String(search.maxRetries)} set={(v) => setSearch({ maxRetries: Number(v) })} opts={[['0', '0 · none'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 · max']]} />
            </Field>
            </Anchor>
            <Anchor id="search-retry-delay">
            <Field label="Retry base delay" hint="Base backoff between retries (doubles each attempt, capped at 4s).">
              <Sel value={String(search.retryBaseMs)} set={(v) => setSearch({ retryBaseMs: Number(v) })} opts={[['50', '50ms'], ['100', '100ms'], ['300', '300ms'], ['500', '500ms'], ['1000', '1s'], ['2000', '2s · max']]} />
            </Field>
            </Anchor>
            <Anchor id="citations">
            <div className="space-y-3 rounded-xl bg-surf p-3">
              <div className="text-sm font-medium">Sources & transparency</div>
              <Field label="Inline citations" hint="Off hides [S1] markers in replies (Sources list stays below the reply). Pills jump to the Sources list below the reply (description first, Open button inside). Links render as plain markdown links.">
                <Seg v={search.citeStyle} set={(citeStyle) => setSearch({ citeStyle })} opts={[['off', 'Off'], ['pills', 'Pills'], ['links', 'Links']]} />
              </Field>
              <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Expand Sources by default</div><div className="text-xs text-mu">Show the source list open on every grounded reply instead of behind the Sources button.</div></div><Toggle on={search.sourcesOpen} set={(sourcesOpen) => setSearch({ sourcesOpen })} /></div>
              <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Strict citation warnings</div><div className="text-xs text-mu">Flag grounded replies that cite nothing, or cite sources they weren't given.</div></div><Toggle on={search.strictCitations} set={(strictCitations) => setSearch({ strictCitations })} /></div>
            </div>
            </Anchor>
          </div>}
          {k === 'fetch_page' && <div className="space-y-3 rounded-xl bg-bg p-3">
            <Anchor id="page-reader">
            <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Page reader</div><div className="text-xs text-mu">Let the model open a search result to read the full page. Turn off to keep grounding to snippets.</div></div><Toggle on={search.reader} set={(reader) => setSearch({ reader })} /></div>
            </Anchor>
            <Anchor id="reader-api">
            <Field label="Reader API" hint="Which service reads a page when the model opens a search result. Pick a different service than your search API to use a separate provider and key.">
              <Sel value={search.readerProvider} set={(readerProvider) => setSearch({ readerProvider: readerProvider as typeof search.readerProvider })} opts={READER_PROVIDERS.map(([id, label]) => [id, label] as [string, string])} />
            </Field>
            </Anchor>
            {search.readerProvider !== 'builtin' && <>
              <Anchor id="reader-key">
              <Field label="Reader API key" hint={search.readerProvider === 'exa'
                ? 'Required by Exa. Stored in this browser like the search key. Your Exa search key is reused when this is empty.'
                : search.readerProvider === 'jina'
                  ? 'Optional for Jina Reader. Leave empty to use Jina without a key.'
                  : search.readerProvider === 'firecrawl'
                    ? 'Optional for Firecrawl. Leave empty to use your Firecrawl search key.'
                    : 'Optional. Sent as a bearer token to your reader service.'}>
                <div className="relative">
                  <Input type={showReaderKey ? 'text' : 'password'} value={search.readerKey} set={(v) => setSearch({ readerKey: v })} placeholder={search.readerProvider === 'exa' ? 'Paste your reader API key' : 'Optional'} />
                  <button onClick={() => setShowReaderKey(!showReaderKey)} title="Show or hide key" className="absolute right-2 top-1/2 -translate-y-1/2 text-mu hover:text-tx">{showReaderKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </Field>
              </Anchor>
              {search.readerProvider === 'custom' && <Anchor id="reader-url">
              <Field label="Reader API URL" hint="Your own reader endpoint. Use {url} where the page address should go, for example https://example.com/read?url={url}. It must return JSON with a text field, or plain text.">
                <Input value={search.readerUrl} set={(v) => setSearch({ readerUrl: v })} placeholder="https://example.com/read?url={url}" />
              </Field>
              </Anchor>}
              <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Fall back to the built-in reader</div><div className="text-xs text-mu">If the reader API fails or has no key, read the page directly instead of failing the read.</div></div><Toggle on={search.readerFallback} set={(readerFallback) => setSearch({ readerFallback })} /></div>
            </>}
            <Anchor id="reader-summary">
            <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Summarize pages with another model</div><div className="text-xs text-mu">Send the page to a second model that returns a clean summary. The main model then gets the summary instead of the whole page, which keeps long articles from filling up the context.</div></div><Toggle on={search.readerSummary} set={(readerSummary) => setSearch({ readerSummary })} /></div>
            </Anchor>
            {search.readerSummary && <>
              <Anchor id="reader-summary-mode">
              <Field label="Summary model" hint="Use one exact model, or a model flow: an endpoint's models in order, or an entire playlist, until one works.">
                <Seg v={search.readerSummaryFlow ? 'flow' : 'picked'} set={(v) => setSearch({ readerSummaryFlow: v === 'flow' })} opts={[['picked', 'Picked model'], ['flow', 'Model flow']]} />
              </Field>
              </Anchor>
              {search.readerSummaryFlow ? (
                <Anchor id="reader-summary-endpoint">
                <Field label="Summary flow source" hint="The flow tries every model in this source in order: an endpoint's default model first, then the rest of its models — or every entry of a playlist. A model that fails is skipped for the rest of the reply; if every model fails, the raw page text is used.">
                  <Sel value={summaryFlowRef} set={setSummaryFlowRef} opts={summaryEpOpts} />
                </Field>
                </Anchor>
              ) : (
                <Anchor id="reader-summary-model">
                <Field label="Summary model" hint="The exact model that writes the summary. Pick the endpoint and the model id; there is no silent fallback, and a failed summary uses the raw page instead.">
                  <Sel value={summaryRef} set={setSummaryRef} opts={summaryOpts} />
                </Field>
                </Anchor>
              )}
              <Anchor id="reader-summary-length">
              <Field label={`Summary length · ${search.readerSummaryChars.toLocaleString()} characters`} hint="Roughly how long a page summary may be. Shorter keeps the context small, longer keeps more detail.">
                <RangeSlider label="Summary length" min={400} max={8000} step={200} value={search.readerSummaryChars} valueText={`${search.readerSummaryChars.toLocaleString()} characters`} set={(readerSummaryChars) => setSearch({ readerSummaryChars: Math.round(readerSummaryChars) })} className="w-full" />
              </Field>
              </Anchor>
            </>}
            <Anchor id="fetch-timeout">
            <Field label={`Page request timeout · ${(search.fetchTimeoutMs / 1000).toFixed(search.fetchTimeoutMs % 1000 ? 1 : 0)}s`} hint="How long to wait for a page before retrying or failing.">
              <RangeSlider label="Page request timeout" min={1000} max={30000} step={1000} value={search.fetchTimeoutMs} valueText={`${(search.fetchTimeoutMs / 1000).toFixed(search.fetchTimeoutMs % 1000 ? 1 : 0)} seconds`} set={(fetchTimeoutMs) => setSearch({ fetchTimeoutMs: Math.round(fetchTimeoutMs) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="fetch-chars">
            <Field label={`Text kept per page · ${(search.fetchMaxChars / 1000).toFixed(search.fetchMaxChars % 1000 ? 1 : 0)}k characters`} hint="How much page text to read. Capped at 50,000 characters. When summaries are on, this is the text the summary model sees.">
              <RangeSlider label="Text kept per page" min={1000} max={50000} step={1000} value={search.fetchMaxChars} valueText={`${search.fetchMaxChars.toLocaleString()} characters`} set={(fetchMaxChars) => setSearch({ fetchMaxChars: Math.round(fetchMaxChars) })} className="w-full" />
            </Field>
            </Anchor>
            <Anchor id="fetch-retries">
            <Field label="Page retries" hint="Bounded retries for transient failures (429/5xx/timeouts). Permanent errors are never retried.">
              <Sel value={String(search.fetchMaxRetries)} set={(v) => setSearch({ fetchMaxRetries: Number(v) })} opts={[['0', '0 · none'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4 · max']]} />
            </Field>
            </Anchor>
            <Anchor id="fetch-retry-delay">
            <Field label="Page retry base delay" hint="Base backoff between page retries (doubles each attempt, capped at 4s).">
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
        <Section title="Additional capabilities" desc="Owned by other features · read-only">
        <Anchor id="hidden-capabilities">
        <Card icon={FlaskConical} title="Additional capabilities" sub="Owned by other features · read-only">
          <p className="text-sm text-mu">These capabilities turn on automatically with their feature and can't be toggled here.</p>
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
              <input type="checkbox" checked={askAlways} onChange={(e) => setAskAlways(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span><span className="font-medium">Do not show again</span><span className="mt-0.5 block text-xs text-mu">Skips this prompt for Location, Clipboard, Date and Date and time. Turn it back on with Ask before enabling device tools.</span></span>
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
      <Section title="Skills" desc="Extra instructions the model can load for specific tasks.">
      {!!warnings.length && <p role="status" className="rounded-xl bg-er/10 px-3 py-2 text-xs text-er">{warnings[0]} Edit or reset the skill below to fix it.</p>}
      {skills.map((st) => {
        const def = resolveSkill(st)
        if (!def) return <Anchor key={st.id} id={`skill-${st.id}`}><Card icon={Sparkles} title={st.id} sub="Missing instructions" muted><p className="text-sm text-er">This skill has no instructions, so it can't be used. Edit it or remove it.</p><div><Btn v="danger" icon={Trash2} onClick={() => setSkills(skills.filter((x) => x.id !== st.id))}>Remove</Btn></div></Card></Anchor>
        const builtin = BUILTIN_SKILLS.some((b) => b.id === st.id)
        return (
          <Anchor key={st.id} id={`skill-${st.id}`}>
          <Card icon={Sparkles} title={def.name} sub={`${st.enabled ? 'On' : 'Off'} · id: ${st.id}`} muted={!st.enabled} right={<Toggle on={st.enabled} set={(enabled) => upd(st.id, { enabled })} />}>
            <p className="text-xs text-mu">Skill id: <span className="font-mono">{st.id}</span></p>
            {def.source && <p className="text-xs text-mu">Source: {def.source}{def.license ? ` · ${def.license}` : ''}</p>}
            <Field label="When to use" hint="Short description of when this skill applies."><Input value={st.description ?? def.description} set={(description) => upd(st.id, { description })} placeholder="When this skill applies." /></Field>
            <Field label="Instructions" hint={builtin ? 'What to do when this skill is used. Editing overrides the built-in text for this browser. Reset restores it.' : 'What to do when this skill is used.'}><Area rows={6} value={st.instructions ?? def.instructions} set={(instructions) => upd(st.id, { instructions })} /></Field>
            <div className="flex gap-2">
              {builtin && <Btn v="soft" icon={RotateCcw} onClick={() => upd(st.id, { name: undefined, description: undefined, instructions: undefined } as Partial<SkillState>)}>Reset</Btn>}
              {!builtin && <Btn v="danger" icon={Trash2} onClick={() => setSkills(skills.filter((x) => x.id !== st.id))}>Remove</Btn>}
            </div>
          </Card>
          </Anchor>
        )
      })}
      </Section>
      <Section title="Custom skills" desc="Your own reusable instructions.">
      <Anchor id="add-skill">
      <Card icon={Plus} title="Add a custom skill" sub="Your own reusable instructions" open0={false}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ID" hint="Lowercase letters, numbers, hyphens."><Input value={draft.id} set={(id) => setDraft({ ...draft, id })} placeholder="e.g. api-docs" /></Field>
          <Field label="Name"><Input value={draft.name} set={(name) => setDraft({ ...draft, name })} placeholder="e.g. API docs" /></Field>
        </div>
        <Field label="When to use" hint="The model reads this to decide whether to load the skill."><Input value={draft.description} set={(description) => setDraft({ ...draft, description })} placeholder="When this skill applies." /></Field>
        <Field label="Instructions" hint="Full steps the model follows after loading the skill."><Area rows={5} value={draft.instructions} set={(instructions) => setDraft({ ...draft, instructions })} /></Field>
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
      <Section title="Dictation" desc="Turn speech into a message with the microphone.">
      <Anchor id="voice-dictation">
      <Card icon={AudioLines} title="Dictation" sub={canDictate ? 'Microphone button in the composer' : 'Not supported in this browser'} muted={!canDictate}>
        <p className="text-sm">Press the microphone beside Send and speak; the words land in the message box. Recognition stops on its own after a pause, and the transcript stays editable before you send.</p>
        <p className="text-sm text-mu">The browser does the conversion and may use its own cloud service (Chrome and Edge do; the audio is not sent anywhere by this app). Firefox has no speech recognition API, so the button is hidden there.</p>
        {!canDictate && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">This browser does not offer SpeechRecognition. Try Chrome, Edge, or Safari for dictation.</p>}
        <Field label="Dictation language" hint="Language the microphone should expect. Browser default follows your system language.">
          <Sel value={v.dictLang} set={(dictLang) => set({ dictLang })} opts={VOICE_LANGS} />
        </Field>
      </Card>
      </Anchor>
      </Section>
      <Section title="Read aloud" desc="Speak replies with the browser's own voice.">
      <Anchor id="voice-read-aloud">
      <Card icon={Volume2} title="Read aloud" sub={canSpeak ? (v.autoRead ? 'On · reads every new reply' : 'Button on each reply') : 'Not supported in this browser'} muted={!canSpeak}>
        <p className="text-sm">A speaker button on every reply reads it aloud with the browser\u2019s speech synthesis. Code blocks and links are skipped; only the prose is spoken.</p>
        {!canSpeak && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">This browser does not offer speechSynthesis, so read-aloud is unavailable.</p>}
        <Field label="Speaking language" hint="Voice used for read-aloud. Browser default picks the system voice.">
          <Sel value={v.speakLang} set={(speakLang) => set({ speakLang })} opts={VOICE_LANGS} />
        </Field>
        <div className="space-y-2">
          <div className="text-sm font-medium">Speaking rate</div>
          <div className="flex items-center gap-3">
            <RangeSlider label="Speaking rate" min={0.5} max={2} step={0.05} value={v.rate} valueText={`${v.rate.toFixed(2)}x`} set={(rate) => set({ rate: Math.round(rate * 100) / 100 })} className="flex-1" />
            <span className="w-16 text-right text-sm">{v.rate.toFixed(2)}×</span>
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">Read every new reply automatically<Toggle on={v.autoRead} set={(autoRead) => set({ autoRead })} label="Read replies automatically" /></label>
        <div className="flex gap-2">
          <Btn v="soft" icon={Play} disabled={!canSpeak} onClick={() => speak('This is how replies will sound. You can change the language and the speed here at any time.', v)}>Test voice</Btn>
          <Btn v="soft" icon={X} disabled={!canSpeak} onClick={() => stopSpeaking()}>Stop</Btn>
        </div>
      </Card>
      </Anchor>
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
    <Panel id="mcp" k="mcps" n={mcps.length} add="Add server">
      <Section title="Servers" desc="External tool servers whose tools join the normal tool loop.">
      <div className="space-y-2 rounded-xl bg-surf p-4 text-sm">
        <p>Servers speak MCP over Streamable HTTP. Press Test connection to run the handshake and load the tools; from then on every enabled server&rsquo;s tools are sent to the model with the rest of the tool list.</p>
        <p className="text-xs text-mu">Requests normally go straight from this browser to the server; if the server refuses browser origins (CORS), they are retried through this app&rsquo;s relay (Settings → Endpoints → Request routing). URLs, headers, and tokens stay in this browser and are never stored by this app&rsquo;s backend. Custom headers use one <code>Name: value</code> pair per line, for example <code>Authorization: Bearer …</code>.</p>
        {!toolsOn && <p role="status" className="rounded-lg bg-er/10 px-3 py-2 text-xs text-er">The Tools feature is off, so no MCP tool can be called. Turn on Tools in Settings &rarr; Features.</p>}
      </div>
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
                <Field label="Server URL" hint="The MCP endpoint, usually ending in /mcp or /sse. Must be reachable from this page."><Input value={m.url} set={(url) => upd('mcps', m.id, { url, error: undefined })} placeholder="https://example.com/mcp" /></Field>
              </div>
              <Field label="Headers" hint="Optional. One Name: value pair per line. Stored unencrypted in this browser, so prefer a scoped token.">
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
                      <div className="mt-0.5">{t.title || t.name}</div>
                      {t.description && <p className="mt-0.5 text-xs text-mu">{t.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Anchor>
        )
      })}
      <Anchor id="add-mcp-server"><span className="block text-xs text-mu">Use Add server above. A server with no loaded tools contributes nothing until you test it.</span></Anchor>
      </Section>
    </Panel>
  )
}

function MemoryTab() {
  const s = useSConfig(), mp = s.memoryPrefs
  const [draft, setDraft] = useState('')
  const [category, setCategory] = useState('General')
  const [dupes, setDupes] = useState<{ a: string; b: string; score: number }[] | null>(null)
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
    <Section title="Memory tool" desc="How the model stores and recalls things about you.">
    <Anchor id="memory-tool">
    <div className="rounded-xl bg-surf p-4 space-y-3">
      <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Memory tool</div><div className="text-sm text-mu">Disabled by default. Memories stay in this browser and are sent to your selected model when recalled.</div></div><Toggle on={mp.enabled} set={(enabled) => setPrefs({ enabled })} /></div>
      <Anchor id="memory-mode">
      <Field label="Memory mode" hint="Intentional stores explicit remember requests. Balanced also stores important disclosures. Aggressive includes smaller details and preferences.">
        <Seg v={mp.intent} set={(intent) => setPrefs({ intent })} opts={[["intentional", "Intentional"], ["balanced", "Balanced"], ["aggressive", "Aggressive"]]} />
      </Field>
      </Anchor>
      <Anchor id="memory-temp-chats">
      <div className="flex items-center justify-between gap-3 border-t border-bor pt-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Use memory in temporary chats</div>
          <div className="text-xs text-mu">Recall saved memories and let the model save new ones while writing in a temporary chat. The transcript still expires; memories are kept separately in Settings → Memory.</div>
        </div>
        <Toggle on={mp.tempChats !== false} set={(tempChats) => setPrefs({ tempChats })} label="Use memory in temporary chats" />
      </div>
      </Anchor>
      <Anchor id="recall-method">
      <Field label="Recall method" hint="Local rank picks memories on this device with no model calls (fast, free, offline). Classifier call asks a model to choose, and costs a request per reply.">
        <Seg v={mp.method ?? 'local'} set={(method) => setPrefs({ method })} opts={[["local", "Local rank"], ["classifier", "Classifier call"]]} />
      </Field>
      </Anchor>
      <Anchor id="recall-mode">
      <Field label="Recall mode" hint="Holistic sends every memory. Contextual and Specific rank to the most relevant ones.">
        <Seg v={mp.recall} set={(recall) => setPrefs({ recall })} opts={[["holistic", "Holistic"], ["contextual", "Contextual"], ["specific", "Specific"]]} />
      </Field>
      </Anchor>
      {(mp.method ?? 'local') === 'classifier' && mp.recall !== 'holistic' && <HelperPointer anchor="recall-classifier" title="Memory recall model" desc="Set in Endpoints → Helper models. Chooses which saved memories matter for each reply." current={helperLabel(s, helperRef(s.prefs.recallEp, s.prefs.recallModel) || helperRef(mp.classifierEp, mp.classifierModel), 'Classification model (fallback)')} />}
    </div>
    </Anchor>
    </Section>
    <Section title="Your memories" desc="Everything stored in this browser.">
    <Anchor id="add-memory">
    <div className="rounded-xl bg-surf p-4 space-y-3"><div className="font-medium">Add a memory</div><Area rows={2} value={draft} set={setDraft} placeholder="A short fact, preference, or reminder…" /><div className="flex gap-2"><Input value={category} set={setCategory} placeholder="Category" /><Btn v="solid" icon={Plus} onClick={addMemory}>Add memory</Btn></div>
      <p className="text-xs text-mu">New memories merge into near-duplicates automatically instead of piling up copies.</p></div>
    </Anchor>
    <Anchor id="stored-memories">
    <div className="flex items-center justify-between"><div className="text-sm font-medium">Stored memories ({s.memories.length})</div><div className="flex gap-2"><Btn v="soft" disabled={s.memories.length < 2} onClick={() => setDupes(findDuplicatePairs(s.memories))}>Check duplicates</Btn><Btn v="danger" icon={Trash2} disabled={!s.memories.length} onClick={() => { if (window.confirm('Delete all stored memories?')) s.patch({ memories: [] }) }}>Delete all</Btn></div></div>
    </Anchor>
    <Anchor id="check-duplicates">
    {dupes && (
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
    )}
    </Anchor>
    {s.memories.map((m) => <div key={m.id} className="rounded-xl bg-surf p-3 space-y-2"><div className="flex gap-2"><Input value={m.category} set={(category) => s.patch({ memories: s.memories.map((x) => x.id === m.id ? { ...x, category, updatedAt: Date.now() } : x) })} placeholder="Category" /><Btn v="danger" icon={Trash2} title="Delete memory" onClick={() => s.patch({ memories: s.memories.filter((x) => x.id !== m.id) })}>Delete</Btn></div><Area rows={2} value={m.text} set={(text) => s.patch({ memories: s.memories.map((x) => x.id === m.id ? { ...x, text, updatedAt: Date.now() } : x) })} /></div>)}
    {!s.memories.length && <p className="rounded-xl bg-surf p-4 text-sm text-mu">No memories stored yet. Add one here or enable memory and choose a mode.</p>}
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
      <Section title="Context meter" desc="The token ring in the chat header.">
      <Anchor id="context-meter">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm">Show context meter<Toggle on={s.prefs.showContextMeter ?? true} set={(showContextMeter) => s.patch({ prefs: { ...s.prefs, showContextMeter } })} /></label>
        <div className="text-xs text-mu">A ring in the chat header showing estimated tokens in the open chat. Click it for the reported input, output, and cache-token breakdown.</div>
        <Anchor id="context-limit"><Field label="Manual context limit" hint="Fallback scale when the model has no published context size. This does not change the model's actual context window."><Input type="number" min="1000" step="1000" value={s.widgetPrefs.contextLimit} set={(v) => s.patch({ widgetPrefs: { ...s.widgetPrefs, contextLimit: Math.max(1000, Number(v) || 1000) } })} /></Field></Anchor>
        <Field label="Characters per estimated token" hint="A rough estimate; 4 is a common default for English text."><Input type="number" min="1" max="10" value={s.widgetPrefs.charsPerToken} set={(v) => s.patch({ widgetPrefs: { ...s.widgetPrefs, charsPerToken: Math.min(10, Math.max(1, Number(v) || 4)) } })} /></Field>
      </div>
      </Anchor>
      </Section>
      <Section title="Panels" desc="The optional panels beside the chat. Enabled panels are listed first.">
      {/* Enabled panels first; the rest keep their relevance order. */}
      {WIDGETS.map((w, i) => ({ w, i })).sort((a, b) => (s.widgets[a.w[0]] ? 0 : 1) - (s.widgets[b.w[0]] ? 0 : 1) || a.i - b.i).map(({ w: [k, n, I, d] }) => {
        const blocked = blockedBy(k)
        return (
        <Anchor key={k} id={`widget-${k}`}>
        <Card icon={I} title={n} sub={blocked ? `Needs the ${blocked} feature` : d} muted={!!blocked || !s.widgets[k]} right={blocked
          ? <span className="shrink-0 rounded-md bg-hov px-2 py-1 text-xs text-mu">Off</span>
          : <Toggle on={!!s.widgets[k]} set={(v) => s.patch({ widgets: { ...s.widgets, [k]: v }, rail: v || s.rail })} />}>
          <div className={blocked ? 'pointer-events-none opacity-50' : ''}>
          <p className="text-sm text-mu">Shown in the panel at the right of the chat. Open or close that panel with the panel button in the chat header.</p>
          {k === 'usage' && <Anchor id="usage-settings"><div className="space-y-3 rounded-xl bg-bg p-3">
            <Field label="Group usage"><Seg v={wp.usageGroup} set={(usageGroup) => setWp({ usageGroup })} opts={[["endpoint", "Endpoint totals"], ["model", "Individual models"]]} /></Field>
            <Field label="Show"><Seg v={wp.usageMode} set={(usageMode) => setWp({ usageMode })} opts={[["success", "OK / fails"], ["tokens", "Tokens"]]} /></Field>
            {wp.usageMode === 'tokens' && <Field label="Token format" hint="Use {in} and {out} where input and output totals should appear."><Input value={wp.usageFormat} set={(usageFormat) => setWp({ usageFormat })} /></Field>}
            <Field label="Usage period"><Seg v={wp.usagePeriod} set={(usagePeriod) => setWp({ usagePeriod })} opts={USAGE_PERIODS} /></Field>
            {wp.usagePeriod === 'custom' && <div className="grid grid-cols-2 gap-2"><Field label="From"><Input type="date" value={wp.usageFrom ?? ''} set={(usageFrom) => setWp({ usageFrom })} /></Field><Field label="Through"><Input type="date" value={wp.usageTo ?? ''} set={(usageTo) => setWp({ usageTo })} /></Field></div>}
            <Checkbox checked={wp.usageTotal} set={(usageTotal) => setWp({ usageTotal })} label="Show total across models and endpoints" />
          </div></Anchor>}
          {k === 'last' && <Anchor id="last-settings"><div className="space-y-3"><div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.lastSpeed} set={(lastSpeed) => setWp({ lastSpeed })} label="Show response speed" /></div><Field label="Time unit"><Seg v={wp.timeUnit} set={(timeUnit) => setWp({ timeUnit })} opts={[["auto", "Auto"], ["ms", "Milliseconds"], ["s", "Seconds"]]} /></Field></div></Anchor>}
          {k === 'keys' && <Anchor id="shortcut-list"><div className="grid gap-2 rounded-xl bg-bg p-3 sm:grid-cols-2">{KEYS.map(([id, label]) => <Checkbox key={id} checked={wp.shortcuts.includes(id)} set={(checked) => setWp({ shortcuts: checked ? [...wp.shortcuts, id] : wp.shortcuts.filter((x) => x !== id) })} label={label} />)}</div></Anchor>}
          {k === 'eps' && <Anchor id="show-disabled"><div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.showDisabledEndpoints} set={(showDisabledEndpoints) => setWp({ showDisabledEndpoints })} label="Show disabled endpoints" /></div></Anchor>}
          {k === 'pad' && <Anchor id="scratch-rows"><Field label="Visible note height" hint="Number of text rows before scrolling."><Input type="number" min="2" max="20" value={wp.scratchRows} set={(v) => setWp({ scratchRows: Math.min(20, Math.max(2, Number(v) || 6)) })} /></Field></Anchor>}
          {k === 'snips' && <Anchor id="snippet-limit"><Field label="Maximum snippets shown" hint="Older snippets remain saved and can be found by removing newer ones."><Input type="number" min="1" max="100" value={wp.snippetLimit} set={(v) => setWp({ snippetLimit: Math.min(100, Math.max(1, Number(v) || 20)) })} /></Field></Anchor>}
          {k === 'cost' && <Anchor id="cost-decimals"><Field label="Decimal places"><Input type="number" min="0" max="8" value={wp.costDecimals} set={(v) => setWp({ costDecimals: Math.min(8, Math.max(0, Number(v) || 0)) })} /></Field></Anchor>}
          {k === 'prompts' && <Anchor id="active-prompts-only"><div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.activePromptsOnly} set={(activePromptsOnly) => setWp({ activePromptsOnly })} label="Show only the selected prompt" /></div></Anchor>}
          {k === 'draft' && <Anchor id="chars-per-token"><Field label="Characters per estimated token" hint="A rough estimate; 4 is a common default for English text."><Input type="number" min="1" max="10" value={wp.charsPerToken} set={(v) => setWp({ charsPerToken: Math.min(10, Math.max(1, Number(v) || 4)) })} /></Field></Anchor>}
          {k === 'todo' && <Anchor id="hide-done"><div className="rounded-xl bg-bg p-3"><Checkbox checked={wp.hideDoneTodos} set={(hideDoneTodos) => setWp({ hideDoneTodos })} label="Hide completed tasks" /></div></Anchor>}
          </div>
        </Card>
        </Anchor>
        )
      })}
      </Section>
    </Panel>
  )
}

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
    {open && <div className="settings-dropdown dd-list absolute inset-x-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-xl bg-hov p-1.5 shadow-md">
      {matches.map(([font, label]) => <button type="button" key={font} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(font)} className="block w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surf">{label}</button>)}
      {!matches.length && query.trim() && <p className="px-2.5 py-2 text-xs text-mu">Press Enter to use “{query.trim()}”.</p>}
    </div>}
  </div>
}

type PrefToggle = 'showBy' | 'showLog' | 'showTps' | 'enterSends' | 'autoTitle' | 'temporaryByDefault' | 'streamMd' | 'seasonal' | 'cues' | 'remoteImages' | 'showTimestamps' | 'alwaysShowActions' | 'codeWrap' | 'reduceTransparency' | 'customSearch'

/** One boolean preference rendered as a labelled toggle row. */
function prefRow(s: ReturnType<typeof useSConfig>, anchor: string, k: PrefToggle, t: string, d: string) {
  return (
    <Anchor id={anchor}>
    <div className="flex items-center gap-3 rounded-xl bg-surf p-3">
      <div className="flex flex-1 items-center gap-2 text-sm font-medium">{t}<HelpTip text={d} label={`Help: ${t}`} /></div>
      <Toggle on={k === 'seasonal' ? s.prefs[k] !== false : !!s.prefs[k]} set={(v) => s.patch({ prefs: { ...s.prefs, [k]: v } })} label={t} />
    </div>
    </Anchor>
  )
}

function Look() {
  const s = useSConfig()
  const glassOn = s.prefs.glassComposer !== false
  const glassBlur = s.prefs.glassBlur ?? 14
  const glassOpacity = s.prefs.glassOpacity ?? 80
  const settingsWidth = s.prefs.settingsWidth ?? 1024
  const settingsHeight = s.prefs.settingsHeight ?? 780
  const modelPickerHeight = s.prefs.modelPickerHeight ?? 480
  const [colorPicker, setColorPicker] = useState<string | null>(null)
  const row = (anchor: string, k: PrefToggle, t: string, d: string) => prefRow(s, anchor, k, t, d)
  return (
    <Panel id="look">
      <Section title="Appearance" desc="Theme, colors and the small flourishes.">
      <Anchor id="appearance-mode">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Appearance mode</div>
        <div className="text-xs text-mu">Dark and light each keep their own theme and custom colors.</div>
        <div className="mt-1"><Seg v={s.themeMode} set={(themeMode) => s.patch({ themeMode })} opts={[['dark', 'Dark'], ['light', 'Light']]} /></div>
      </div>
      </Anchor>
      <Anchor id="theme-picker">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[...(s.themeMode === 'light' ? LIGHT_THEMES : DARK_THEMES), 'custom'].map((k) => {
          const n = THEMES[k as keyof typeof THEMES]
          const active = (s.themeMode === 'light' ? s.themeLight : s.themeDark) === k
          const custom = s.themeMode === 'light' ? s.customLightColors : s.customDarkColors
          return (
          <button key={k} onClick={() => {
            const before = s.themeMode === 'light' ? s.themeLight : s.themeDark
            // Entering custom adopts the theme you were just on as its base,
            // so the palette starts from where you left off instead of plum.
            if (k === 'custom' && before !== 'custom') s.patch(s.themeMode === 'light' ? { themeLight: 'custom' as const, customLightTheme: { ...(s.themeMode === 'light' ? s.customLightTheme : s.customDarkTheme), base: before as typeof s.customDarkTheme.base, hue: accentHue(THEME_COLORS[before]) } } : { themeDark: 'custom' as const, customDarkTheme: { ...(s.themeMode === 'dark' ? s.customDarkTheme : s.customLightTheme), base: before as typeof s.customDarkTheme.base, hue: accentHue(THEME_COLORS[before]) } })
            else s.patch(s.themeMode === 'light' ? { themeLight: k as typeof s.themeLight } : { themeDark: k as typeof s.themeDark })
          }} className={cx('space-y-2 rounded-xl bg-surf p-2 text-left text-sm', active && 'ring-2 ring-ac')}>
            <div className="flex h-16 overflow-hidden rounded-lg">
              <div className="w-1/4" style={{ background: k === 'custom' ? custom.side : THEME_COLORS[k].side }} />
              <div className="flex-1 p-2" style={{ background: k === 'custom' ? custom.bg : THEME_COLORS[k].bg }}><div className="h-2 w-2/3 rounded-sm" style={{ background: k === 'custom' ? custom.ac : THEME_COLORS[k].ac }} /></div>
            </div>
            <span className="flex items-center justify-between px-1">{n}{active && <Check size={14} className="text-ac" />}</span>
          </button>
          )
        })}
      </div>
      </Anchor>
      {((s.themeMode === 'light' ? s.themeLight : s.themeDark) === 'custom') && (() => {
        const mode = s.themeMode === 'light' ? 'light' : 'dark'
        const custom = s.themeMode === 'light' ? s.customLightTheme : s.customDarkTheme
        const colors = s.themeMode === 'light' ? s.customLightColors : s.customDarkColors
        const setCustomTheme = (next: typeof custom) => {
          const norm = normCustomTheme(next, defaultCustomTheme(custom.base))
          const setColors = customThemeColors(norm)
          s.patch(mode === 'light' ? { customLightTheme: norm, customLightColors: setColors } : { customDarkTheme: norm, customDarkColors: setColors })
        }
        const base = custom.base
        const isDarkBase = (DARK_THEMES as readonly string[]).includes(base)
        const hue = custom.hue
        const sat = custom.sat
        const bright = custom.bright
        const contrast = custom.contrast
        return <Anchor id="custom-colors"><div className="rounded-xl bg-surf p-3 space-y-4">
        <div><div className="text-sm font-medium">Custom theme</div><div className="text-xs text-mu">Pick a base theme, then fine-tune hue, saturation, brightness, and contrast. Syntax colours, the error colour, and text are always left alone.</div></div>
        <div className="space-y-2">
          <div className="text-xs text-mu">Base theme</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BASE_THEMES.map((k) => {
              const active = k === base
              return (
                <button key={k} type="button" onClick={() => setCustomTheme({ ...custom, base: k, hue: accentHue(THEME_COLORS[k]) })} className={cx('flex items-center gap-2 rounded-lg bg-bg p-2 text-left text-sm', active && 'ring-2 ring-ac')}>
                  <span className="size-6 rounded-md border border-bor" style={{ background: THEME_COLORS[k].ac }} />
                  <span className="flex-1">{THEMES[k as keyof typeof THEMES]}</span>
                  {active && <Check size={14} className="text-ac" />}
                </button>
              )
            })}
          </div>
          <div className="text-[11px] text-mu">{isDarkBase ? 'Dark base' : 'Light base'} · Base accent hue {Math.round(accentHue(THEME_COLORS[base]))}°</div>
        </div>
        <div className="space-y-2 rounded-lg bg-bg p-2.5">
          <div className="text-sm font-medium">Accent-only palette</div>
          <div className="text-xs text-mu">Pick one colour and build the whole palette around it: surfaces get a restrained tint, the accent is used exactly as picked, and text on the accent flips for contrast. Replaces the sliders above until you adjust them.</div>
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Accent colour" value={/^#[0-9a-f]{6}$/i.test(colors.ac) ? colors.ac : '#888888'} onChange={(e) => {
              const next = accentOnlyColors(THEME_COLORS[base], e.target.value) as typeof colors
              s.patch(mode === 'light' ? { customLightColors: next } : { customDarkColors: next })
            }} className="h-9 w-12 cursor-pointer rounded-md border border-bor bg-transparent p-1" />
            <span className="font-mono text-xs uppercase text-mu">{colors.ac}</span>
            <Btn v="ghost" className="ml-auto px-2 py-1" onClick={() => setCustomTheme({ ...custom, hue: accentHue(THEME_COLORS[base]) })}>Rebuild from base accent</Btn>
          </div>
        </div>
        <div className="space-y-3">
          <Field label={`Hue · ${hue}°`} hint="Rotates colours except syntax highlighting. Starts at the base accent hue."><RangeSlider label="Hue" min={0} max={360} step={1} value={hue} set={(v) => setCustomTheme({ ...custom, hue: Math.round(v) })} className="w-full" /></Field>
          <Field label={`Saturation · ${sat.toFixed(2)}x`} hint="Scales colour intensity across everything except syntax highlighting and the error colour."><RangeSlider label="Saturation" min={0} max={2} step={0.01} value={sat} set={(v) => setCustomTheme({ ...custom, sat: Math.round(v * 100) / 100 })} className="w-full" /></Field>
          <Field label={`Brightness · ${bright.toFixed(2)}x`} hint="Scales brightness across everything except syntax highlighting, the error colour, and text."><RangeSlider label="Brightness" min={0} max={3} step={0.01} value={bright} set={(v) => setCustomTheme({ ...custom, bright: Math.round(v * 100) / 100 })} className="w-full" /></Field>
          <Field label={`Contrast · ${contrast.toFixed(2)}x`} hint="Increases the brightness contrast: lights get brighter and darks get darker around mid-brightness. Never touches syntax, error or text colours."><RangeSlider label="Contrast" min={1} max={2} step={0.01} value={contrast} set={(v) => setCustomTheme({ ...custom, contrast: Math.round(v * 100) / 100 })} className="w-full" /></Field>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mu">
            <span>Syntax colours and the error colour never change. Text colours are never dimmed by brightness.</span>
            <Btn v="ghost" className="px-2 py-1" onClick={() => setCustomTheme(defaultCustomTheme(base))}>Reset to base defaults</Btn>
          </div>
        </div>
        <div className="space-y-2"><div className="text-sm font-medium">Live preview</div><div className="flex h-14 overflow-hidden rounded-lg border border-bor"><div className="w-1/4" style={{ background: colors.side }} /><div className="flex-1 flex items-center gap-2 p-2" style={{ background: colors.bg }}><div className="h-2 w-10 rounded-sm" style={{ background: colors.ac }} /><span className="text-xs" style={{ color: colors.tx }}>Text</span><span className="text-xs" style={{ color: colors.mu }}>Muted</span></div><div className="w-1/4" style={{ background: colors.surf }} /></div></div>
        <details className="rounded-lg bg-bg p-2"><summary className="cursor-pointer text-xs text-mu">Advanced: edit hex colours directly</summary>
        <p className="mt-1 text-[11px] text-mu">Hand-tuned here stays until a slider or base theme is changed — those rebuild the palette from the base theme.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{THEME_COLOR_KEYS.map((key) => <div key={key} className="relative flex items-center gap-2 rounded-lg bg-surf p-2 text-sm">
          <button type="button" aria-label={`Choose ${THEME_COLOR_LABELS[key]} color`} aria-expanded={colorPicker === key} onClick={() => setColorPicker(colorPicker === key ? null : key)} className="size-9 shrink-0 rounded-lg border border-white/30 shadow-sm" style={{ backgroundColor: colors[key] }} />
          <span className="min-w-0 flex-1 leading-tight">{THEME_COLOR_LABELS[key]}</span>
          <input aria-label={`${THEME_COLOR_LABELS[key]} hex color`} value={colors[key]} onChange={(e) => { const value = e.target.value; if (/^#[\da-f]{0,6}$/i.test(value)) { const next = { ...colors, [key]: value }; s.patch(mode === 'light' ? { customLightColors: next } : { customDarkColors: next }) } }} onBlur={() => { if (!/^#[\da-f]{6}$/i.test(colors[key])) { const next = { ...colors, [key]: '#000000' }; s.patch(mode === 'light' ? { customLightColors: next } : { customDarkColors: next }) } }} className="w-20 rounded-md border border-white/20 bg-transparent px-1.5 py-1 font-mono text-xs uppercase" />
          {colorPicker === key && <div className="settings-dropdown absolute left-2 top-full z-30 mt-1 w-56 rounded-xl bg-bg p-3"><label className="flex items-center justify-between gap-3 text-xs text-mu">Choose color<input type="color" aria-label={`Choose ${THEME_COLOR_LABELS[key]} color`} value={colors[key]} onChange={(e) => { const next = { ...colors, [key]: e.target.value }; s.patch(mode === 'light' ? { customLightColors: next } : { customDarkColors: next }) }} className="h-9 w-12 cursor-pointer rounded-md border border-bor bg-transparent p-1" /></label></div>}
        </div>)}</div>
        </details>
      </div>
      </Anchor>
      })()}
      {row('seasonal', 'seasonal', 'Seasonal touches', 'Show a festive greeting on holidays. Turn off to keep the greeting plain.')}
      {row('completion-cues', 'cues', 'Completion cues', 'A soft chime and a little confetti when deep research or a workspace update finishes.')}
      <Anchor id="temp-glow">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Temporary chat glow</div>
        <div className="text-xs text-mu">Edge glow while a temporary chat is still empty; it waves in intensity and never goes dark. 0x turns it off.</div>
        <div className="flex items-center gap-3">
          <RangeSlider label="Temporary chat glow intensity" min={0} max={2} step={0.05} value={s.prefs.tempGlow ?? 1} set={(tempGlow) => s.patch({ prefs: { ...s.prefs, tempGlow: Math.round(tempGlow * 100) / 100 } })} className="flex-1" />
          <span className="w-20 text-right text-sm">{(s.prefs.tempGlow ?? 1) === 0 ? 'Off' : `${(s.prefs.tempGlow ?? 1).toFixed(2)}x`}</span>
        </div>
      </div>
      </Anchor>
      <Anchor id="temp-glow-sent">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Glow after a message is sent</div>
        <div className="text-xs text-mu">How much glow remains once the chat has messages, as a share of the empty-chat glow. 0x turns it off.</div>
        <div className="flex items-center gap-3">
          <RangeSlider label="Temporary chat glow sent intensity (relative)" min={0} max={2} step={0.05} value={s.prefs.tempGlowSent ?? 0.5} set={(tempGlowSent) => s.patch({ prefs: { ...s.prefs, tempGlowSent: Math.round(tempGlowSent * 100) / 100 } })} className="flex-1" />
          <span className="w-20 text-right text-sm">{(s.prefs.tempGlowSent ?? 0.5) === 0 ? 'Off' : `${(s.prefs.tempGlowSent ?? 0.5).toFixed(2)}x`}</span>
        </div>
      </div>
      </Anchor>
      </Section>
      <Section title="Style" desc="The shape of surfaces and how much room the chat breathes.">
      <Anchor id="style-preset">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Style preset</div><div className="text-xs text-mu">Changes corner rounding and elevation across the whole app. Colours, fonts, and layout stay where they are. Each tile previews its own preset.</div></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STYLE_PRESET_IDS.map((id) => {
            const active = (s.prefs.stylePreset ?? 'modern') === id
            return (
              <button key={id} type="button" aria-pressed={active} onClick={() => s.patch({ prefs: { ...s.prefs, stylePreset: id } })} className={cx('space-y-2 rounded-xl border p-2 text-left text-sm transition-colors', active ? 'border-ac ring-1 ring-ac' : 'border-bor hover:bg-hov')}>
                <span data-style={id} aria-hidden="true" className="flex h-12 items-center gap-1.5 rounded-lg bg-bg p-2">
                  <i className="size-6 shrink-0 rounded-md bg-hov" />
                  <i className="h-6 flex-1 rounded-lg bg-surf shadow-md" />
                  <i className="h-6 w-3 shrink-0 rounded-2xl bg-ac/40" />
                </span>
                <span className="flex items-center justify-between gap-1 font-medium">{STYLE_PRESETS[id].label}{active && <Check size={14} className="text-ac" />}</span>
                <span className="block text-[11px] font-normal leading-4 text-mu">{STYLE_PRESETS[id].description}</span>
              </button>
            )
          })}
        </div>
      </div>
      </Anchor>
      {(() => {
        const spacing = resolveSpacing(s.prefs.density, s.prefs.uiSpacing)
        const custom = hasSpacingOverrides(s.prefs.uiSpacing)
        const setSpacing = (patch: Partial<NonNullable<typeof s.prefs.uiSpacing>>) =>
          s.patch({ prefs: { ...s.prefs, uiSpacing: { ...(s.prefs.uiSpacing ?? {}), ...patch } } })
        return (
          <>
          <Anchor id="density">
          <div className="rounded-xl bg-surf p-3 space-y-2">
            <div><div className="text-sm font-medium">Density</div><div className="text-xs text-mu">A single scale for every structural surface: the top bar, the conversation, the sidebar, the composer, the side panels and code blocks.</div></div>
            <Seg v={s.prefs.density ?? 'comfortable'} set={(density) => s.patch({ prefs: { ...s.prefs, density, uiSpacing: custom ? s.prefs.uiSpacing : {} } })} opts={DENSITY_IDS.map((id) => [id, DENSITIES[id].label] as [typeof id, string])} />
            <div className="text-xs text-mu">{DENSITIES[s.prefs.density ?? 'comfortable'].description}</div>
          </div>
          </Anchor>
          <Anchor id="density-advanced">
          <details className="rounded-xl bg-surf p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">Advanced spacing overrides{custom && <span className="rounded-full bg-ac/15 px-2 py-0.5 text-[11px] text-ac">custom</span>}</summary>
            <p className="mt-1 text-xs text-mu">Fine-tune each area without changing the density preset. Values are in pixels; the conversation's vertical margins follow its horizontal margin.</p>
            <div className="mt-3 space-y-3">
              <div className="text-xs font-medium uppercase tracking-wide text-mu">Top bar</div>
              <Field label={`Inline padding · ${spacing.headerPad}px`}><RangeSlider label="Top bar inline padding" min={SPACING_LIMITS.headerPad.min} max={SPACING_LIMITS.headerPad.max} step={1} value={spacing.headerPad} set={(headerPad) => setSpacing({ headerPad })} className="w-full" /></Field>
              <Field label={`Vertical padding · ${spacing.headerPadY}px`} hint="Extra breathing room above and below the title row."><RangeSlider label="Top bar vertical padding" min={SPACING_LIMITS.headerPadY.min} max={SPACING_LIMITS.headerPadY.max} step={1} value={spacing.headerPadY} set={(headerPadY) => setSpacing({ headerPadY })} className="w-full" /></Field>
              <div className="pt-2 text-xs font-medium uppercase tracking-wide text-mu">Conversation</div>
              <Field label={`Container margins · ${spacing.chatPad}px`}><RangeSlider label="Chat container margins" min={SPACING_LIMITS.chatPad.min} max={SPACING_LIMITS.chatPad.max} step={1} value={spacing.chatPad} set={(chatPad) => setSpacing({ chatPad })} className="w-full" /></Field>
              <Field label={`Message spacing · ${spacing.messageGap}px`}><RangeSlider label="Message spacing" min={SPACING_LIMITS.messageGap.min} max={SPACING_LIMITS.messageGap.max} step={1} value={spacing.messageGap} set={(messageGap) => setSpacing({ messageGap })} className="w-full" /></Field>
              <div className="pt-2 text-xs font-medium uppercase tracking-wide text-mu">Sidebar</div>
              <Field label={`Outer padding · ${spacing.sidePad}px`}><RangeSlider label="Sidebar outer padding" min={SPACING_LIMITS.sidePad.min} max={SPACING_LIMITS.sidePad.max} step={1} value={spacing.sidePad} set={(sidePad) => setSpacing({ sidePad })} className="w-full" /></Field>
              <Field label={`Section gap · ${spacing.sideGap}px`} hint="Space between the toolbar, search, chat list and library."><RangeSlider label="Sidebar section gap" min={SPACING_LIMITS.sideGap.min} max={SPACING_LIMITS.sideGap.max} step={1} value={spacing.sideGap} set={(sideGap) => setSpacing({ sideGap })} className="w-full" /></Field>
              <Field label={`Item padding · ${spacing.sideItemPad}px`} hint="Vertical padding inside each chat and item row."><RangeSlider label="Sidebar item padding" min={SPACING_LIMITS.sideItemPad.min} max={SPACING_LIMITS.sideItemPad.max} step={1} value={spacing.sideItemPad} set={(sideItemPad) => setSpacing({ sideItemPad })} className="w-full" /></Field>
              <Field label={`Item spacing · ${spacing.sideItemGap}px`} hint="Space between the rows in the chat list."><RangeSlider label="Sidebar item spacing" min={SPACING_LIMITS.sideItemGap.min} max={SPACING_LIMITS.sideItemGap.max} step={1} value={spacing.sideItemGap} set={(sideItemGap) => setSpacing({ sideItemGap })} className="w-full" /></Field>
              <div className="pt-2 text-xs font-medium uppercase tracking-wide text-mu">Composer &amp; panels</div>
              <Field label={`Composer padding · ${spacing.composerPad}px`}><RangeSlider label="Composer padding" min={SPACING_LIMITS.composerPad.min} max={SPACING_LIMITS.composerPad.max} step={1} value={spacing.composerPad} set={(composerPad) => setSpacing({ composerPad })} className="w-full" /></Field>
              <Field label={`Side panel padding · ${spacing.panelPad}px`} hint="The widget rail, the workspace tile and panel, and similar docked cards."><RangeSlider label="Side panel padding" min={SPACING_LIMITS.panelPad.min} max={SPACING_LIMITS.panelPad.max} step={1} value={spacing.panelPad} set={(panelPad) => setSpacing({ panelPad })} className="w-full" /></Field>
              <div className="pt-2 text-xs font-medium uppercase tracking-wide text-mu">Code blocks</div>
              <Field label={`Body padding X · ${spacing.codePadX}px`}><RangeSlider label="Code body horizontal padding" min={SPACING_LIMITS.codePadX.min} max={SPACING_LIMITS.codePadX.max} step={1} value={spacing.codePadX} set={(codePadX) => setSpacing({ codePadX })} className="w-full" /></Field>
              <Field label={`Body padding Y · ${spacing.codePadY}px`}><RangeSlider label="Code body vertical padding" min={SPACING_LIMITS.codePadY.min} max={SPACING_LIMITS.codePadY.max} step={1} value={spacing.codePadY} set={(codePadY) => setSpacing({ codePadY })} className="w-full" /></Field>
              <Field label={`Header padding X · ${spacing.codeHeadPadX}px`}><RangeSlider label="Code header horizontal padding" min={SPACING_LIMITS.codeHeadPadX.min} max={SPACING_LIMITS.codeHeadPadX.max} step={1} value={spacing.codeHeadPadX} set={(codeHeadPadX) => setSpacing({ codeHeadPadX })} className="w-full" /></Field>
              <Field label={`Header padding Y · ${spacing.codeHeadPadY}px`}><RangeSlider label="Code header vertical padding" min={SPACING_LIMITS.codeHeadPadY.min} max={SPACING_LIMITS.codeHeadPadY.max} step={1} value={spacing.codeHeadPadY} set={(codeHeadPadY) => setSpacing({ codeHeadPadY })} className="w-full" /></Field>
              <div className="flex items-center justify-between gap-2 text-xs text-mu">
                <span>Overrides apply on top of the density preset.</span>
                <Btn v="ghost" className="px-2 py-1" disabled={!custom} onClick={() => s.patch({ prefs: { ...s.prefs, uiSpacing: {} } })}>Reset to density defaults</Btn>
              </div>
            </div>
          </details>
          </Anchor>
          </>
        )
      })()}
      </Section>
      <Section title="Messages" desc="Extra details around each reply.">
      {row('message-times', 'showTimestamps', 'Message times', 'Show the time each message was sent: beside the model label on replies and above your own messages.')}
      {row('message-actions', 'alwaysShowActions', 'Always show message actions', 'Keep copy, read aloud, regenerate, branch and delete visible on every reply instead of revealing them on hover.')}
      </Section>
      <Section title="Model picker" desc="What the model menu shows and how tall it may grow.">
      <Anchor id="model-picker-labels">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Model picker main label</div>
        <div className="text-xs text-mu">The main identifier shown on the left of each model.</div>
        <Seg v={s.prefs.modelPrimary ?? 'name'} set={(modelPrimary) => {
          const secondary = s.prefs.modelSecondary ?? 'none'
          s.patch({ prefs: { ...s.prefs, modelPrimary, modelSecondary: secondary === modelPrimary ? (modelPrimary === 'name' ? 'id' : 'name') : secondary } })
        }} opts={[["name", "Model name"], ["id", "Model ID"]]} />
      </div>
      </Anchor>
      <Anchor id="model-picker-labels-secondary">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Model picker secondary label</div>
        <div className="text-xs text-mu">The detail shown on the right of each model.</div>
        <Seg v={s.prefs.modelSecondary ?? 'none'} set={(modelSecondary) => s.patch({ prefs: { ...s.prefs, modelSecondary } })} opts={(s.prefs.modelPrimary ?? 'name') === 'name' ? [["provider", "Provider"], ["id", "Model ID"], ["none", "None"]] : [["provider", "Provider"], ["name", "Model name"], ["none", "None"]]} />
      </div>
      </Anchor>
      <Anchor id="model-picker-height">
      <div className="rounded-xl bg-surf p-3 space-y-2"><div className="text-sm font-medium">Model picker height</div><div className="text-xs text-mu">Maximum height of the model and playlist menu. Smaller screens constrain it to fit.</div><Field label={`Height · ${modelPickerHeight}px`}><RangeSlider label="Model picker height" min={320} max={720} step={20} value={modelPickerHeight} set={(modelPickerHeight) => s.patch({ prefs: { ...s.prefs, modelPickerHeight } })} className="w-full" /></Field></div>
      </Anchor>
      <Anchor id="model-favorites">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div>
          <div className="text-sm font-medium">Favorite models</div>
          <div className="text-xs text-mu">Star a model in the model menu or an endpoint's model list to pin it to a Favorites section at the top of the picker.</div>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">Show Favorites section<Toggle on={s.prefs.favoritesSection !== false} set={(favoritesSection) => s.patch({ prefs: { ...s.prefs, favoritesSection } })} label="Show Favorites section" /></label>
        <label className="flex items-center justify-between gap-3 text-sm">Hide favorites from provider lists<Toggle on={s.prefs.hideFavoritesInProviders !== false} set={(hideFavoritesInProviders) => s.patch({ prefs: { ...s.prefs, hideFavoritesInProviders } })} label="Hide favorites from provider lists" /></label>
        <label className="flex items-center justify-between gap-3 text-sm">Show provider beside favorite names<Toggle on={s.prefs.hideFavoriteProvider !== true} set={(show) => s.patch({ prefs: { ...s.prefs, hideFavoriteProvider: !show } })} label="Show provider beside favorite names" /></label>
        {(s.favs?.length ?? 0) > 0 ? <>
          <div className="space-y-1">{(s.favs ?? []).map((ref) => {
            const [id, model] = splitHelperRef(ref)
            const e = s.eps.find((x) => x.id === id)
            return <div key={ref} className="flex items-center gap-2 rounded-lg bg-bg px-2.5 py-2 text-sm">
              <Star size={13} fill="currentColor" className="shrink-0 text-ac" />
              <span className="min-w-0 flex-1 truncate">{e ? `${e.name} · ${modelNameOf(e, model)}` : 'Removed endpoint'}</span>
              <button type="button" onClick={() => s.patch({ favs: (s.favs ?? []).filter((x) => x !== ref) })} title="Remove from favorites" aria-label="Remove from favorites" className="grid size-6 shrink-0 place-items-center rounded-md text-mu hover:bg-hov hover:text-tx"><X size={13} /></button>
            </div>
          })}</div>
          <button type="button" onClick={() => s.patch({ favs: [] })} className="text-xs text-mu hover:text-er">Clear all favorites</button>
        </> : <p className="text-xs text-mu">No favorites yet. Hover a model in the picker and click its star.</p>}
        {(s.prefs.collapsedProviders?.length ?? 0) > 0 && <button type="button" onClick={() => s.patch({ prefs: { ...s.prefs, collapsedProviders: [] } })} className="block text-xs text-mu hover:text-tx">Expand all collapsed provider groups</button>}
      </div>
      </Anchor>
      </Section>
      <Section title="Layout" desc="Sizes and spacing of the chat, the composer and the panels.">
      <Anchor id="palette-height">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Command palette height</div>
        <div className="text-xs text-mu">Maximum height of the result list before it scrolls.</div>
        <div className="flex items-center gap-3"><RangeSlider label="Command palette maximum height" min={200} max={720} step={20} value={s.prefs.paletteMax} set={(paletteMax) => s.patch({ prefs: { ...s.prefs, paletteMax } })} className="flex-1" /><span className="w-20 text-right text-sm">{s.prefs.paletteMax}px</span></div>
      </div>
      </Anchor>
      <Anchor id="chat-width">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Message width</div>
        <div className="text-xs text-mu">Set the maximum width of the conversation column.</div>
        <Seg v={s.prefs.chatWidth} set={(chatWidth) => s.patch({ prefs: { ...s.prefs, chatWidth } })} opts={[["narrow", "Narrow"], ["standard", "Standard"], ["wide", "Wide"]]} />
      </div>
      </Anchor>
      <Anchor id="glass-composer">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm">Glass composer<Toggle on={glassOn} set={(glassComposer) => s.patch({ prefs: { ...s.prefs, glassComposer } })} label="Glass composer" /></label>
        <div className="text-xs text-mu">Give the message box a translucent, blurred surface. Blur softens whatever sits behind it; opacity sets how solid the surface itself is. 100% is fully opaque.</div>
        <Field label={`Blur · ${glassBlur}px`}><RangeSlider label="Glass composer blur" min={0} max={40} step={1} value={glassBlur} set={(v) => s.patch({ prefs: { ...s.prefs, glassBlur: Math.round(v) } })} disabled={!glassOn} className="w-full" /></Field>
        <Field label={`Opacity · ${glassOpacity}%`}><RangeSlider label="Glass composer opacity" min={20} max={100} step={5} value={glassOpacity} set={(v) => s.patch({ prefs: { ...s.prefs, glassOpacity: Math.round(v) } })} disabled={!glassOn} className="w-full" /></Field>
      </div>
      </Anchor>
      <Anchor id="reduce-transparency">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Reduce transparency<HelpTip text="Removes glass, background blur and dropped shadows across the app for flat, opaque surfaces. Easier to read on slow GPUs, and skips the blur work entirely." label="Help: Reduce transparency" /></div>
          <div className="text-xs text-mu">Flat, opaque surfaces: no glass, no background blur, no dropped shadows.</div>
        </div>
        <Toggle on={s.prefs.reduceTransparency === true} set={(reduceTransparency) => s.patch({ prefs: { ...s.prefs, reduceTransparency } })} label="Reduce transparency" />
      </div>
      </Anchor>
      <Anchor id="high-contrast">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">High contrast<HelpTip text="Pushes muted text and hairline borders toward full strength, beyond what the theme defines. Works on every theme, including custom ones." label="Help: High contrast" /></div>
          <div className="text-xs text-mu">Stronger muted text and borders for easier reading.</div>
        </div>
        <Toggle on={s.prefs.highContrast === true} set={(highContrast) => s.patch({ prefs: { ...s.prefs, highContrast } })} label="High contrast" />
      </div>
      </Anchor>
      <Anchor id="settings-size">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Settings window size</div><div className="text-xs text-mu">Set the maximum width and height of the settings window. Smaller screens constrain it to fit.</div></div>
        <Field label={`Width · ${settingsWidth}px`}><RangeSlider label="Settings window width" min={720} max={1440} step={40} value={settingsWidth} set={(settingsWidth) => s.patch({ prefs: { ...s.prefs, settingsWidth } })} className="w-full" /></Field>
        <Field label={`Height · ${settingsHeight}px`}><RangeSlider label="Settings window height" min={520} max={1000} step={20} value={settingsHeight} set={(settingsHeight) => s.patch({ prefs: { ...s.prefs, settingsHeight } })} className="w-full" /></Field>
      </div>
      </Anchor>
      <Anchor id="overlay">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Overlay appearance</div><div className="text-xs text-mu">Control how dialogs and the settings panel sit over the workspace.</div></div>
        <Field label={`Modal background blur · ${s.prefs.modalBlur}px`} hint="Blur behind confirmation and selection dialogs. Settings itself stays sharp."><RangeSlider label="Modal background blur" min={0} max={24} step={1} value={s.prefs.modalBlur} set={(modalBlur) => s.patch({ prefs: { ...s.prefs, modalBlur } })} className="w-full" /></Field>
        <Field label={`Settings background opacity · ${s.prefs.settingsOpacity}%`} hint="How much the settings backdrop dims the workspace behind the settings panel."><RangeSlider label="Settings background opacity" min={0} max={100} step={5} value={s.prefs.settingsOpacity} set={(settingsOpacity) => s.patch({ prefs: { ...s.prefs, settingsOpacity } })} className="w-full" /></Field>
      </div>
      </Anchor>
      </Section>
      <Section title="Typography" desc="The fonts used across the app.">
      <Anchor id="fonts">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Fonts</div><div className="text-xs text-mu">Fonts already loaded in the app are reused; other choices load from Google Fonts.</div></div>
        <Field label="Body font"><FontPicker value={s.prefs.fontBody} set={(fontBody) => s.patch({ prefs: { ...s.prefs, fontBody } })} options={FONT_OPTIONS} /></Field>
        <Field label="Heading font"><FontPicker value={s.prefs.fontHeader} set={(fontHeader) => s.patch({ prefs: { ...s.prefs, fontHeader } })} options={FONT_OPTIONS} /></Field>
        <Field label="Monospace font"><FontPicker value={s.prefs.fontMono} set={(fontMono) => s.patch({ prefs: { ...s.prefs, fontMono } })} options={MONO_OPTIONS} /></Field>
      </div>
      </Anchor>
      <Anchor id="text-size">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Text size</div>
        <div className="text-xs text-mu">Scales every text together — chat, replies and settings — on top of the font choices. 100% is the app default.</div>
        <div className="flex items-center gap-3">
          <RangeSlider label="Text size" min={85} max={135} step={5} value={s.prefs.textScale ?? 100} set={(textScale) => s.patch({ prefs: { ...s.prefs, textScale } })} className="flex-1" />
          <span className="w-14 text-right text-sm">{s.prefs.textScale ?? 100}%</span>
        </div>
      </div>
      </Anchor>
      {row('code-wrap', 'codeWrap', 'Wrap long code lines', 'Soft-wrap long lines inside code blocks instead of scrolling them sideways.')}
      <Anchor id="code-line-numbers">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Code line numbers</div>
          <div className="text-xs text-mu">Show a fixed gutter of line numbers beside highlighted code blocks. Copying still copies only the code.</div>
        </div>
        <Toggle on={s.prefs.codeLines === true} set={(codeLines) => s.patch({ prefs: { ...s.prefs, codeLines } })} label="Code line numbers" />
      </div>
      </Anchor>
      <Anchor id="code-max-height">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Code block height</div>
        <div className="text-xs text-mu">Cap how tall a code block grows before it scrolls internally. Long replies stay readable without the page jumping. 0 means no cap.</div>
        <div className="flex items-center gap-3">
          <RangeSlider label="Code block maximum height" min={0} max={1200} step={40} value={s.prefs.codeMaxHeight ?? 0} set={(codeMaxHeight) => s.patch({ prefs: { ...s.prefs, codeMaxHeight } })} className="flex-1" />
          <span className="w-20 text-right text-sm">{s.prefs.codeMaxHeight ? `${s.prefs.codeMaxHeight}px` : 'No cap'}</span>
        </div>
      </div>
      </Anchor>
      </Section>
    </Panel>
  )
}

const FONT_OPTIONS: [string, string][] = [['system', 'System default'], ['Arial', 'Arial'], ['Verdana', 'Verdana'], ['Georgia', 'Georgia'], ['Trebuchet MS', 'Trebuchet MS'], ['Times New Roman', 'Times New Roman'], ['Inter', 'Inter'], ['Roboto', 'Roboto'], ['Open Sans', 'Open Sans'], ['Segoe UI', 'Segoe UI'], ['Helvetica Neue', 'Helvetica Neue']]
const MONO_OPTIONS: [string, string][] = [['system', 'System monospace'], ['Consolas', 'Consolas'], ['Menlo', 'Menlo'], ['Monaco', 'Monaco'], ['Courier New', 'Courier New'], ['Cascadia Code', 'Cascadia Code'], ['JetBrains Mono', 'JetBrains Mono'], ['Fira Code', 'Fira Code']]

function AdvancedTab() {
  const s = useSConfig()
  if (!featOn(s, 'advanced')) return null
  const a = { ...DEFAULT_ADVANCED, ...s.advanced }
  const setA = (p: Partial<typeof a>) => s.patch({ advanced: { ...a, ...p } })
  const row = (anchor: string, k: 'verboseErrors' | 'showHiddenTools' | 'showSystemPrompt' | 'showToolPayloads' | 'showTokenCounts' | 'showModelParams', t: string, d: string) => (
    <Anchor id={anchor}>
    <div className="flex items-center gap-3 rounded-xl bg-surf p-3">
      <div className="flex flex-1 items-center gap-2 text-sm font-medium">{t}<HelpTip text={d} label={`Help: ${t}`} /></div>
      <Toggle on={a[k]} set={(v) => setA({ [k]: v })} />
    </div>
    </Anchor>
  )
  return (
    <Panel id="adv">
      <Section title="Diagnostics" desc="What the app shows about the requests it makes.">
      {row('verbose-errors', 'verboseErrors', 'Verbose errors', 'Show exact provider error messages in the process log and failure replies. The endpoint key is still masked; other key-like tokens are shown verbatim.')}
      {row('show-system-prompt', 'showSystemPrompt', 'Show full system prompt', 'Save the exact system prompt sent with each reply and show it in the process log: global prompt, selected prompt, tool guidance, skill catalog, and memory context.')}
      {row('show-tool-payloads', 'showToolPayloads', 'Show tool arguments and results', 'Render the full JSON arguments and returned text of every tool call in the process log instead of one-line summaries.')}
      {row('show-token-counts', 'showTokenCounts', 'Show per-step token counts', 'List reported input/output tokens beside each process-log entry when the provider reports them.')}
      </Section>
      <Section title="Interface" desc="Extra details in the chat and the settings.">
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
      <Section title="Panel" desc="How the workspace side panel behaves.">
      <div className="space-y-3">
        <Anchor id="default-view"><Field label="Default view"><Seg v={wp.defaultView ?? 'pinned'} set={(defaultView) => set({ defaultView: defaultView as typeof wp.defaultView })} opts={[['pinned', 'Pinned'], ['latest', 'Latest']]} /></Field></Anchor>
        <Anchor id="auto-open"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Auto-open panel</div><div className="text-xs text-mu">Open the side panel when the AI starts writing files.</div></div><Toggle on={wp.autoOpen ?? true} set={(autoOpen) => set({ autoOpen })} /></div></Anchor>
        <Anchor id="auto-follow"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium">Auto-follow file</div><div className="text-xs text-mu">Select the file the AI is writing automatically.</div></div><Toggle on={wp.autoFollow ?? true} set={(autoFollow) => set({ autoFollow })} /></div></Anchor>
      </div>
      </Section>
      <Section title="Project templates" desc="Starter file sets the model can scaffold.">
      <Anchor id="templates">
      <Card icon={LayoutTemplate} title="Project templates" sub="Starter file sets the model can scaffold with template + createNew">
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
      <Section title="Sharing" desc="Send workspace files to a GitHub Gist.">
      <Anchor id="gist-sharing">
      <Card icon={Share2} title="GitHub Gist sharing" sub="Optional personal token · saved with your settings">
        <Field label="Gist token (classic, gist scope)" hint="Only used when you press Share in a workspace panel. Leave empty to disable sharing. When device sync is on, it is included in the encrypted sync payload.">
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
  const row = (anchor: string, k: PrefToggle, t: string, d: string) => prefRow(s, anchor, k, t, d)
  return (
    <Panel id="chats">
      <Section title="Replies" desc="What each reply shows and how it is rendered.">
      {row('show-by', 'showBy', 'Show which model answered', 'Label each reply with the endpoint and model that produced it.')}
      {row('show-log', 'showLog', 'Show model-use details', 'Show the Process to answer panel under each reply: every helper, model round and tool call, with its timing, model and any failure.')}
      {row('show-tps', 'showTps', 'Show generation speed', 'Show tokens per second below each reply.')}
      {row('stream-md', 'streamMd', 'Render markdown while streaming', 'Format each completed line as markdown as it arrives instead of plain text. Off shows plain text until the reply finishes.')}
      {row('custom-search', 'customSearch', 'Custom find in conversation (Ctrl+F)', 'Enable the in-chat search box that highlights matches in text and code blocks.')}
      <Anchor id="copy-replies">
      <div className="rounded-xl bg-surf p-3">
        <div className="text-sm font-medium">Copying replies</div>
        <div className="text-xs text-mu">The copy button writes rich text, so headings, lists, tables and code blocks keep their formatting in a word processor. Shift-click copies Markdown with citation links; Ctrl/Cmd-click copies plain prose.</div>
      </div>
      </Anchor>
      <Anchor id="pinned-context">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Include the pinned reply in context</div>
            <div className="text-xs text-mu">A pinned reply (the pin on any answer) is added to the model's context on every request, so its guidance survives even when the original message has scrolled out of the working history.</div>
          </div>
          <Toggle on={s.prefs.pinContext !== false} set={(pinContext) => s.patch({ prefs: { ...s.prefs, pinContext } })} label="Include pinned reply in context" />
        </div>
        <div className={cx('space-y-2', s.prefs.pinContext === false && 'opacity-50')}>
          <div className="flex items-center gap-3">
            <RangeSlider label="Pinned reply context share" min={5} max={50} step={5} value={s.prefs.pinContextPercent ?? 50} set={(pinContextPercent) => s.patch({ prefs: { ...s.prefs, pinContextPercent } })} className="flex-1" />
            <span className="w-20 text-right text-sm">≤{s.prefs.pinContextPercent ?? 50}%</span>
          </div>
          <p className="text-[11px] text-mu">The pin is included whole while it fits under this share of the model's context window; past that it is truncated. Keeping it at or below 50% leaves room for the conversation itself.</p>
        </div>
      </div>
      </Anchor>
      {row('remote-images', 'remoteImages', 'Load remote images', 'Render images that replies link to over the network. Off keeps them behind a click-to-load button, so reading a reply never contacts third-party hosts.')}
      <Anchor id="stream-fade">
      <div className="rounded-xl bg-surf p-3 space-y-3">
        <div><div className="text-sm font-medium">Reply fade-in</div><div className="text-xs text-mu">Each chunk of a streaming reply fades in as it arrives. Off disables it entirely.</div></div>
        <div className="flex items-center gap-3">
          <RangeSlider label="Reply fade-in duration" min={0} max={1} step={0.1} value={s.prefs.streamFade} set={(streamFade) => s.patch({ prefs: { ...s.prefs, streamFade } })} className="flex-1" />
          <span className="w-24 text-right text-sm">{s.prefs.streamFade === 0 ? 'Off' : `${Math.round(s.prefs.streamFade * 1000)}ms`}</span>
        </div>
      </div>
      </Anchor>
      </Section>
      <Section title="Process to answer" desc="The step list saved with each reply: what was called, how long it took, and why.">
      <Anchor id="process-detail">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Detail level</div>
        <div className="text-xs text-mu">Compact keeps each step to its name and timing. Standard adds a short explanation and clips anything long behind a read-more. Detailed shows every saved explanation in full.</div>
        <Seg v={s.prefs.logDetail ?? 'standard'} set={(v) => s.patch({ prefs: { ...s.prefs, logDetail: normLogDetail(v) } })} opts={[['compact', 'Compact'], ['standard', 'Standard'], ['verbose', 'Detailed']]} />
      </div>
      </Anchor>
      <Anchor id="process-timing">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0"><div className="text-sm font-medium">Show step timings</div><div className="text-xs text-mu">Print each step's duration, and the panel total, on the right of its row.</div></div>
        <Toggle on={s.prefs.logTiming !== false} set={(logTiming) => s.patch({ prefs: { ...s.prefs, logTiming } })} label="Show step timings" />
      </div>
      </Anchor>
      <Anchor id="process-models">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-surf p-3">
        <div className="min-w-0"><div className="text-sm font-medium">Show the model on each step</div><div className="text-xs text-mu">Label every step with the endpoint and model that served it, not just the endpoint name.</div></div>
        <Toggle on={s.prefs.logModels !== false} set={(logModels) => s.patch({ prefs: { ...s.prefs, logModels } })} label="Show the model on each step" />
      </div>
      </Anchor>
      <p className="px-1 text-xs text-mu">Per-step token counts, tool arguments and results, and the full system prompt live in Settings → Advanced → Diagnostics.</p>
      </Section>
      <Anchor id="temporary-chats">
      <Section title="Temporary chats" desc="Chats that are removed automatically after a while.">
      {row('temporary-default', 'temporaryByDefault', 'New chats are temporary by default', 'New chats are deleted after the retention period, or when you leave if retention is set to Immediate.')}
      <Anchor id="temp-retention">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Temporary chat retention</div>
        <div className="text-xs text-mu">Temporary chats are removed automatically after this time. Immediate also removes them when you start another chat or leave this page.</div>
        <div className="flex items-center gap-3"><RangeSlider label="Temporary chat retention" min={0} max={48} step={1} value={s.prefs.tempHours} set={(tempHours) => s.patch({ prefs: { ...s.prefs, tempHours } })} className="flex-1" /><span className="w-24 text-right text-sm">{s.prefs.tempHours === 0 ? 'Immediate' : `${s.prefs.tempHours} hours`}</span></div>
      </div>
      </Anchor>
      <Anchor id="temp-visible">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Temporary chats shown</div>
        <div className="text-xs text-mu">How many temporary chats the sidebar lists before you need to expand it. The first tick shows only the one you are reading; the last shows them all.</div>
        <div className="flex items-center gap-3">
          <RangeSlider label="Temporary chats shown" min={0} max={6} step={1} value={s.prefs.tempShow ?? 2} set={(tempShow) => s.patch({ prefs: { ...s.prefs, tempShow } })} className="flex-1" />
          <span className="w-28 text-right text-sm">{(s.prefs.tempShow ?? 2) === 0 ? 'Current only' : (s.prefs.tempShow ?? 2) >= 6 ? 'All' : `${s.prefs.tempShow ?? 2} chat${(s.prefs.tempShow ?? 2) === 1 ? '' : 's'}`}</span>
        </div>
      </div>
      </Anchor>
      <div className="pt-1"><Btn v="soft" icon={Sparkles} onClick={() => goSetting('look#temp-glow')}>Open glow settings</Btn></div>
      </Section>
      </Anchor>
      <Section title="Behavior" desc="How the app handles sending messages and opening chats.">
      {row('enter-sends', 'enterSends', 'Enter sends the message', 'Turn off to send with the button and use Enter for new lines.')}
      <Anchor id="prompt-recall">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Prompt recall (↑ / ↓)</div>
        <div className="text-xs text-mu">When the up and down arrows recall the messages you sent this session. While walking, both keys step through the history; typing exits it. Off also stops recording them.</div>
        <Seg v={normPromptRecall(s.prefs.promptRecall)} set={(promptRecall) => s.patch({ prefs: { ...s.prefs, promptRecall: normPromptRecall(promptRecall) } })} opts={PROMPT_RECALL_MODES as unknown as [string, string][]} />
      </div>
      </Anchor>
      {row('auto-title', 'autoTitle', 'Auto-generate chat names', 'Automatically generate a concise title after the first reply.')}
      <Anchor id="startup">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Open on load</div>
        <div className="text-xs text-mu">Most recent chat restores the last selected chat on this device. Most recent permanent chat skips temporary and archived chats.</div>
        <Sel value={normStartup(s.prefs.startup)} set={(startup) => s.patch({ prefs: { ...s.prefs, startup: normStartup(startup) } })} opts={STARTUP_MODES as [string, string][]} />
      </div>
      </Anchor>
      <Anchor id="draft-survival">
      <div className="rounded-xl bg-surf p-3 space-y-2">
        <div className="text-sm font-medium">Drafts across reloads</div>
        <div className="text-xs text-mu">Keep half-typed messages when you close or reload the page. New chat screen covers a chat you have not sent to yet; existing chats covers everything already named.</div>
        <Seg v={(s.prefs.draftSurvive ?? 'both') as 'off' | 'new' | 'chats' | 'both'} set={(draftSurvive) => s.patch({ prefs: { ...s.prefs, draftSurvive } })} opts={[['off', 'Never'], ['new', 'New chat screen'], ['chats', 'Existing chats'], ['both', 'Both']]} />
      </div>
      </Anchor>
      </Section>
      <Section title="Documents" desc="Reading attached files and images.">
      <DocumentsCard />
      <HelperPointer anchor="title-model" title="Title generation model" desc="Set in Endpoints → Helper models. Names new chats automatically; when empty, the model that answered is used." current={helperLabel(s, helperRef(s.prefs.titleEp, s.prefs.titleModel), 'Default (model that answered)')} />
      </Section>
    </Panel>
  )
}

const VIEWS: Record<string, () => ReactNode> = { features: FeaturesTab, eps: Eps, prompts: Prompts, skills: SkillsTab, pls: Pls, cmds: Cmds, workspace: WorkspaceTab, tools: Tools, mcp: McpTab, memory: MemoryTab, widgets: WidgetsTab, look: Look, chats: Chats, voice: VoiceTab, keys: KeysTab, data: DataTab, adv: AdvancedTab }

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
      <div style={{ width: `min(${settingsWidth}px, 100%)`, height: `min(${settingsHeight}px, 92dvh)` }} className="settings-root modal-panel flex overflow-hidden rounded-2xl bg-bg">
        <span id="settings-title" className="sr-only">Settings</span>
        <nav aria-label="Settings sections" className="hidden w-56 shrink-0 flex-col border-r border-bor bg-side p-3 sm:flex">
          <h2 className="px-3 pb-3 text-lg font-semibold">Settings</h2>
          <input aria-label="Search settings" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings" className="mb-3 w-full rounded-lg bg-surf px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40" />
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {query.trim() ? results.map(result => <button key={result.target} onClick={() => openResult(result.target)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surf"><span className="block">{result.title}</span><span className="block text-xs text-mu">{result.section}</span></button>) : navGroups.map(group => <div key={group.label}><h3 className="px-3 pb-1 text-xs font-medium text-mu">{group.label}</h3>{group.tabs.map(id => { const entry = SETTINGS_TABS.find(([k]) => k === id)!; const [k, l, I] = entry; const off = !tabs.some(([visible]) => visible === k); return <button key={k} onClick={() => setTab(k)} aria-current={active === k ? 'page' : undefined} className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm', active === k ? 'bg-hov' : 'text-mu hover:bg-surf hover:text-tx')}><I size={16} /><span className="min-w-0 flex-1">{l}</span>{off && <span className="text-xs">Off</span>}</button> })}</div>)}
            {query.trim() && !results.length && <p className="px-3 py-2 text-sm text-mu">No settings found.</p>}
          </div>
        </nav>
        <div className="relative min-w-0 flex-1">
          <div className="absolute right-3 top-3 z-30"><Btn icon={X} title="Close settings" onClick={() => setTab('')} /></div>
          <div className="h-full overflow-y-auto p-4 sm:p-6">
            <div className="mb-4 space-y-2 pr-12 sm:hidden"><h2 id="settings-mobile-title" className="text-lg font-semibold">Settings</h2><input aria-label="Search settings" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search settings" className="w-full rounded-lg bg-surf px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ac/40" />{query.trim() ? <div className="max-h-48 overflow-y-auto rounded-lg bg-surf">{results.map(result => <button key={result.target} onClick={() => openResult(result.target)} className="block w-full px-3 py-2 text-left text-sm hover:bg-hov">{result.title}<span className="ml-2 text-xs text-mu">{result.section}</span></button>)}{!results.length && <p className="p-3 text-sm text-mu">No settings found.</p>}</div> : <SearchSelect ariaLabel="Settings section" value={active} set={setTab} opts={SETTINGS_TABS.filter(([k]) => showOff || tabs.some(([v]) => v === k)).map(([k, l]) => [k, `${l}${tabs.some(([v]) => v === k) ? '' : ' (off)'}`] as [string, string])} />}</div>
            {disabledFeature ? <div className="space-y-3"><h2 className="text-lg font-semibold">{featureLabel} is off</h2><p className="text-sm text-mu">Turn it on in Features to use its settings.</p><Btn v="soft" onClick={() => setTab(`features#feature-${disabledFeature}`)}>Open Features</Btn></div> : active === 'stats'
              ? <UsageStats onOpenChat={(chatId, messageId) => { useS.getState().patch({ chat: chatId, flashMsg: messageId, activeProject: '' }); setTab('') }} />
              : <V />}
          </div>
        </div>
      </div>
    </Modal>
  )
}
