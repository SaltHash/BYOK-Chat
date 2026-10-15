import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_TOOLS, KEYS, WIDGETS } from './meta'
import { est, redact, stream, wire, trimHistory, estimateHistoryTokens, runToolLoop, type ToolCall, type ToolResult, searchWeb, formatSearch, fetchPage, formatPage, can, ocrImage } from './engine'
import { DEFAULT_SKILL_STATE, normSkills, enabledSkills, getSkillInstructions, composeSystemPrompt, SKILL_TOOL_NAME, type SkillState, type ResolvedSkill } from './skills'
import { hintForLog, getErrorCode, classifyModelError, type ErrorCode } from './errors'
import { usable, modelsOf, modelNameOf } from './models'
import { splitEntry, playlistEntries, applyCommandTemplate, composeFullInput, planRequest } from './chatPlan'
import { migrateLegacyCanvasGroups, applyWorkspaceCall, type Workspace, type WorkspaceRevision } from './workspace'
import { BLANK_DOCS, normDocs, type DocPrefs } from './docs'
export { BLANK_DOCS, normDocs, type DocPrefs }
import { rankMemories, mergeMemory, RouteCache, orderEndpoints, recordRoute, type RouteStat, type RoutingMode } from './recall'
export type { RouteStat, RoutingMode }
import { QUOTA_FLAG, prunePersisted, storageUsage, persistStorage } from './persistence'

export { QUOTA_FLAG, prunePersisted, storageUsage }

export { usable, modelsOf, modelNameOf }

export type Kind = 'eps' | 'prompts' | 'pls' | 'cmds'
export type ModelPrice = { input: number; output: number; source?: 'manual' | 'openrouter' }
/* Explicit names (preferred for new code); short aliases kept as deprecated. */
export type Endpoint = { id: string; name: string; type: 'openai' | 'anthropic'; url: string; key: string; model: string; preset?: string; endpointId?: string; endpointFilter?: 'author' | 'provider'; models?: string[]; modelNames?: Record<string, string>; modelEfforts?: Record<string, string[]>; modelEffortSource?: Record<string, 'auto' | 'manual'>; modelsMode?: 'separate' | 'playlist'; prices?: Record<string, ModelPrice>; on: boolean }
export type Ep = Endpoint
export type Playlist = { id: string; name: string; sys: string; e: string[]; cls: string; clsModel?: string; rule: string }
export type Pl = Playlist
export type Command = { id: string; name: string; desc: string; in: 'text' | 'image' | 'image+text' | 'doc'; sys: string; tpl: string; pl: string; on: boolean }
export type Cmd = Command
export type Attempt = { n: string; m: string; detail?: string; ms?: number; err?: string; errCode?: ErrorCode; tin?: number; tout?: number; at?: number }
export type Try = Attempt
export type Attachment = { name: string; kind: 'img' | 'pdf' | 'txt' | 'media'; size: string; mime?: string; data?: string; text?: string; source?: string; pages?: number }
export type Att = Attachment
export type FadeEvent = { text: string; at: number }
export type Message = { id: string; r: 'user' | 'assistant'; t: string; at?: number; fadeEvents?: FadeEvent[]; by?: string; tps?: number; log?: Attempt[]; att?: Attachment[]; err?: boolean; full?: string; ctx?: string[]; fx?: string; cmd?: string; alts?: Snap[]; ai?: number; historyTokens?: number; explicitTokens?: number; reasoning?: string; toolRounds?: { text: string; calls: ToolResult[] }[]; toolFinal?: string; sys?: string; workspaceIds?: string[] }
export type Msg = Message
export type Snap = { t: string; by?: string; tps?: number; log?: Try[]; err?: boolean; toolRounds?: { text: string; calls: ToolResult[] }[]; toolFinal?: string }
export type Chat = { id: string; title: string; pin?: boolean; started?: boolean; folder?: string; msgs: Msg[]; temporary?: boolean; expiresAt?: number; titleAuto?: boolean }
export type Folder = { id: string; name: string; open: boolean }
export type Notice = { t: string; tab?: string; label?: string } | null
export type Stats = { tin: number; tout: number; historyIn: number; explicitIn: number; sent: number; chats: number; since: number; cost: number }
export type Memory = { id: string; text: string; category: string; createdAt: number; updatedAt: number }

/* Workspace (first-class entity) */
export type WorkspaceViewDefault = 'pinned' | 'latest'
export type WorkspacePrefs = { defaultView: WorkspaceViewDefault; autoOpen: boolean; autoFollow: boolean }

/* Advanced debugging aids. All off by default; only take effect while the
   `advanced` feature is enabled. */
export type AdvancedPrefs = { verboseErrors: boolean; showHiddenTools: boolean; showSystemPrompt: boolean; showToolPayloads: boolean; showTokenCounts: boolean }
export const DEFAULT_ADVANCED: AdvancedPrefs = { verboseErrors: false, showHiddenTools: false, showSystemPrompt: false, showToolPayloads: false, showTokenCounts: false }
export const normAdvanced = (v: any): AdvancedPrefs => {
  const out = { ...DEFAULT_ADVANCED }
  if (v && typeof v === 'object') for (const k of Object.keys(DEFAULT_ADVANCED) as (keyof AdvancedPrefs)[]) if (typeof v[k] === 'boolean') out[k] = v[k]
  return out
}
/* Persisted feature display order: drop unknown ids, append missing features in default order. */
export const normFeatureOrder = (v: any): FeatureId[] => {
  const order = Array.isArray(v) ? [...new Set(v.filter((x: unknown) => typeof x === 'string' && x in DEFAULT_FEATURES))] as FeatureId[] : []
  for (const k of Object.keys(DEFAULT_FEATURES) as FeatureId[]) if (!order.includes(k)) order.push(k)
  return order
}

/* Feature kill-switches. A disabled feature must not be used by the AI or the
   program in any capacity until turned back on. `library` is off by default. */
export type FeatureId = 'prompts' | 'skills' | 'tools' | 'playlists' | 'commands' | 'stats' | 'memory' | 'widgets' | 'shortcuts' | 'library' | 'advanced' | 'workspace' | 'routing'
export const FEATURES: [FeatureId, string, string][] = [
  ['prompts', 'Prompts', 'Per-chat system prompts and the global system prompt. Off hides the prompt picker everywhere.'],
  ['skills', 'Skills', 'Skill catalogs the model can load on demand with use_skill.'],
  ['tools', 'Tools', 'Every model tool: @-mentions, web search, workspace files. The AI cannot call any tool while off.'],
  ['playlists', 'Playlists', 'Ordered model lists and classifier routing. Off leaves endpoint-only model selection.'],
  ['commands', 'Commands', 'Slash commands, their templates, and the home-screen command shortcuts.'],
  ['stats', 'Stats', 'Token, message, and cost totals. Turning off asks whether to delete existing totals.'],
  ['memory', 'Memory', 'Stored memories and the memory tool. Turning off asks whether to delete all memories.'],
  ['widgets', 'Widgets', 'The side widget panel and every widget inside it.'],
  ['shortcuts', 'Shortcuts', 'Every keyboard shortcut, plus the shortcut cheat-sheet widget.'],
  ['library', 'Library', 'The sidebar shortcut list below your chats.'],
  ['workspace', 'Workspace', 'Workspace file panel and workspace settings.'],
  ['routing', 'Routing', 'Playlist classifier routing and routing rules.'],
]
export const DEFAULT_FEATURES: Record<FeatureId, boolean> = { prompts: true, skills: true, tools: true, playlists: true, commands: true, stats: true, memory: true, widgets: true, shortcuts: true, library: false, advanced: false, workspace: true, routing: true }
export const LIBRARY_ITEMS: [string, string][] = [['eps', 'Endpoints'], ['pls', 'Playlists'], ['prompts', 'Prompts'], ['cmds', 'Commands'], ['tools', 'Tools'], ['memory', 'Memory'], ['widgets', 'Widgets']]
export const DEFAULT_LIBRARY_SHOW: Record<string, boolean> = { eps: true, pls: true, prompts: true, cmds: true, tools: true, memory: true, widgets: true }
/** Widgets that belong to a feature and must go dark with it. */
export const FEATURE_WIDGETS: Partial<Record<FeatureId, string[]>> = { prompts: ['prompts'], shortcuts: ['keys'], stats: ['usage', 'cost', 'last'] }
/** Settings tabs hidden while their feature is off. */
export const FEATURE_TABS: Partial<Record<FeatureId, string[]>> = { prompts: ['prompts'], skills: ['skills'], tools: ['tools'], playlists: ['pls'], commands: ['cmds'], stats: ['stats'], memory: ['memory'], widgets: ['widgets'], shortcuts: ['keys'], advanced: ['adv'], workspace: ['workspace'], routing: ['routing'] }
export const featOn = (s: { features?: Record<FeatureId, boolean> } | null | undefined, f: FeatureId): boolean => s?.features?.[f] ?? DEFAULT_FEATURES[f]
/** Whether a widget may render: widgets feature on, its owning feature on, and itself enabled. */
export const widgetOn = (s: { features?: Record<FeatureId, boolean>; widgets: Record<string, boolean> }, id: string): boolean => {
  if (!featOn(s, 'widgets')) return false
  for (const [f, ids] of Object.entries(FEATURE_WIDGETS)) {
    if ((ids as string[]).includes(id) && !featOn(s, f as FeatureId)) return false
  }
  return !!s.widgets[id]
}

export const THEMES = { plum: 'Plum', claude: 'Claude', nord: 'Nord', amoled: 'AMOLED', paper: 'Paper', sepia: 'Sepia', porcelain: 'Porcelain', sand: 'Sand', custom: 'Custom' }
export const DARK_THEMES = ['plum', 'claude', 'nord', 'amoled'] as const
export const LIGHT_THEMES = ['paper', 'sepia', 'porcelain', 'sand'] as const
export type ThemeMode = 'dark' | 'light'
export type DarkTheme = typeof DARK_THEMES[number] | 'custom'
export type LightTheme = typeof LIGHT_THEMES[number] | 'custom'
/** Effective `data-t` value for the current mode (custom stays `custom`; vars come from the mode's custom colors). */
export const themeKeyOf = (s: { themeMode: ThemeMode; themeDark: DarkTheme; themeLight: LightTheme }) => {
  const t = s.themeMode === 'light' ? s.themeLight : s.themeDark
  return (t === 'custom' ? 'custom' : t) as keyof typeof THEMES
}
/** Custom colors for the active mode, or null when a built-in theme is active. */
export const themeCustomOf = (s: { themeMode: ThemeMode; themeDark: DarkTheme; themeLight: LightTheme; customDarkColors: ThemeColors; customLightColors: ThemeColors }) =>
  s.themeMode === 'light'
    ? (s.themeLight === 'custom' ? s.customLightColors : null)
    : (s.themeDark === 'custom' ? s.customDarkColors : null)
/** Patch selecting a theme key, switching mode when the key belongs to the other palette. `custom` applies to the current mode. */
export const themePatch = (s: { themeMode: ThemeMode }, key: keyof typeof THEMES) => {
  if (key === 'custom') return s.themeMode === 'light' ? { themeLight: 'custom' as LightTheme } : { themeDark: 'custom' as DarkTheme }
  if ((DARK_THEMES as readonly string[]).includes(key)) return { themeMode: 'dark' as ThemeMode, themeDark: key as DarkTheme }
  return { themeMode: 'light' as ThemeMode, themeLight: key as LightTheme }
}
export const THEME_COLOR_KEYS = ['bg', 'side', 'surf', 'hov', 'tx', 'mu', 'ac', 'acx', 'er', 'code', 'codeh', 'c2', 'c3', 'c4', 'c5'] as const
export type ThemeColorKey = typeof THEME_COLOR_KEYS[number]
export type ThemeColors = Record<ThemeColorKey, string>
export const THEME_COLOR_LABELS: Record<ThemeColorKey, string> = { bg: 'Main background', side: 'Sidebar', surf: 'Panel surface', hov: 'Hover and selection', tx: 'Main text', mu: 'Muted text', ac: 'Accent', acx: 'Text on accent', er: 'Error', code: 'Code block', codeh: 'Code block header', c2: 'Syntax: strings', c3: 'Syntax: numbers', c4: 'Syntax: titles', c5: 'Syntax: types' }
export const DEFAULT_CUSTOM_COLORS: ThemeColors = { bg: '#17101c', side: '#120c16', surf: '#211828', hov: '#2c2036', tx: '#f3eaf7', mu: '#a893b4', ac: '#dc8ad8', acx: '#1b1020', er: '#ff8fa3', code: '#100b15', codeh: '#2f2040', c2: '#9fe3c5', c3: '#f2b98b', c4: '#8fb9ff', c5: '#c7a6ff' }
export const DEFAULT_CUSTOM_LIGHT_COLORS: ThemeColors = { bg: '#fbfbf9', side: '#f1f1ec', surf: '#efefe9', hov: '#e4e4dc', tx: '#1d1d1b', mu: '#6f6f66', ac: '#3b5bdb', acx: '#ffffff', er: '#c92a2a', code: '#e6e5dd', codeh: '#d3d2c6', c2: '#2b8a3e', c3: '#d9480f', c4: '#7048e8', c5: '#0b7285' }
export const PRE: Record<string, ['openai' | 'anthropic', string, string, 'author' | 'provider']> = {
  Anthropic: ['anthropic', 'https://api.anthropic.com/v1', 'anthropic', 'author'],
  Google: ['openai', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'google', 'author'],
  DeepSeek: ['openai', 'https://api.deepseek.com/v1', 'deepseek', 'author'],
  xAI: ['openai', 'https://api.x.ai/v1', 'x-ai', 'author'],
  Mistral: ['openai', 'https://api.mistral.ai/v1', 'mistralai', 'author'],
  Together: ['openai', 'https://api.together.xyz/v1', 'Together', 'provider'],
  Fireworks: ['openai', 'https://api.fireworks.ai/inference/v1', 'Fireworks', 'provider'],
  Cerebras: ['openai', 'https://api.cerebras.ai/v1', 'cerebras', 'author'],
  Perplexity: ['openai', 'https://api.perplexity.ai', 'perplexity', 'author'],
  Groq: ['openai', 'https://api.groq.com/openai/v1', 'Groq', 'provider'],
  'Ollama (local)': ['openai', 'http://localhost:11434/v1', 'ollama', 'provider'],
  OpenAI: ['openai', 'https://api.openai.com/v1', 'openai', 'author'],
  OpenRouter: ['openai', 'https://openrouter.ai/api/v1', '', 'author'],
  'Other OpenAI-compatible': ['openai', '', '', 'author'],
}
export const GENERAL_PROMPT_TEXT = 'You are a helpful general-purpose assistant. Follow the user\u2019s instructions carefully and answer directly. Be clear, accurate, and concise, adapting the level of detail to what the request needs. Reason step by step when a problem calls for it, and distinguish what you know from what you infer. Ask a brief clarifying question only when it would materially change your answer. Never present invented content as fact, and never fabricate sources, quotes, or capabilities. Write naturally, like a thoughtful person speaking plainly: use varied, concrete language and avoid stock phrases, filler transitions, and cliches. Never use em dashes (—); use commas, periods, colons, or parentheses instead. This applies even when summarizing, structuring, or formatting: no em dashes anywhere in your reply.'
export const CREATIVITY_PROMPT_TEXT = 'You are a creativity-focused assistant. Favor original ideas, imaginative angles, and unconventional approaches over the most obvious answer. Explore multiple possibilities, make surprising but useful connections between seemingly unrelated concepts, and write richly and expressively when the task calls for it. Adapt to the user\u2019s requested style, tone, genre, and constraints, and experiment freely within them. Stay factually honest: never present invented content as fact, and never fabricate sources, evidence, quotes, or capabilities.'
export const CONCISE_PROMPT_TEXT = 'Answer briefly and directly. Skip preamble.'
export const uid = () => Math.random().toString(36).slice(2, 9)

/* Tool-loop round cap. `maxToolRounds` of 0 means unlimited; otherwise 1..64.
 * Values above BASE_MAX require an explicit unlock in Settings → Tools. */
export const TOOL_ROUNDS_DEFAULT = 8
export const TOOL_ROUNDS_MIN = 1
export const TOOL_ROUNDS_BASE_MAX = 32
export const TOOL_ROUNDS_MAX = 64
export const toolRoundLimitOf = (p: { maxToolRounds?: unknown; highToolsUnlocked?: unknown } | null | undefined): number => {
  const raw = Number((p as { maxToolRounds?: unknown } | null | undefined)?.maxToolRounds)
  if (raw === 0) {
    return (p as { highToolsUnlocked?: unknown } | null | undefined)?.highToolsUnlocked === true ? Infinity : TOOL_ROUNDS_DEFAULT
  }
  if (!Number.isFinite(raw)) return TOOL_ROUNDS_DEFAULT
  const unlocked = (p as { highToolsUnlocked?: unknown } | null | undefined)?.highToolsUnlocked === true
  const cap = unlocked ? TOOL_ROUNDS_MAX : TOOL_ROUNDS_BASE_MAX
  return Math.max(TOOL_ROUNDS_MIN, Math.min(cap, Math.floor(raw) || TOOL_ROUNDS_DEFAULT))
}
export const isToolRoundsUnlimited = (p: { maxToolRounds?: unknown; highToolsUnlocked?: unknown } | null | undefined): boolean =>
  Number(p?.maxToolRounds) === 0 && p?.highToolsUnlocked === true

/* Ephemeral per-reply streaming tool calls (live canvas preview). Deliberately
   outside the persisted store: cleared when each reply completes. */
type Live = { tools: Record<string, ToolCall[]>; set: (mid: string, calls: ToolCall[]) => void; clear: (mid: string) => void }
export const useLive = create<Live>()((set) => ({
  tools: {},
  set: (mid, calls) => set((s) => ({ tools: { ...s.tools, [mid]: calls } })),
  clear: (mid) => set((s) => {
    if (!(mid in s.tools)) return s
    const tools = { ...s.tools }
    delete tools[mid]
    return { tools }
  }),
}))
export const BLANK: Record<Kind, () => any> = {
  eps: () => ({ id: uid(), name: 'New endpoint', type: 'openai', url: '', key: '', model: '', models: [''], modelsMode: 'separate', prices: {}, on: true }),
  prompts: () => ({ id: uid(), name: 'New prompt', text: '' }),
  pls: () => ({ id: uid(), name: 'New playlist', sys: '', e: [], cls: '', rule: '' }),
  cmds: () => ({ id: uid(), name: 'command', desc: '', in: 'text', sys: '', tpl: '{{input}}', pl: '', on: true }),
}
const ZERO = (): Stats => ({ tin: 0, tout: 0, historyIn: 0, explicitIn: 0, sent: 0, chats: 0, since: Date.now(), cost: 0 })
export const dl = (n: string, t: string, m: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: m })); a.download = n; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 999) }
export const chatMd = (c: Chat) => `# ${c.title}\n\n` + c.msgs.map((m) => `**${m.r === 'user' ? 'You' : m.by || 'Assistant'}**\n\n${m.t}`).join('\n\n---\n\n')
export const exportChat = () => {
  const s = useS.getState(), c = s.chats.find((x) => x.id === s.chat)
  if (!c || !c.msgs.length) return s.patch({ notice: { t: 'This chat is empty, so there is nothing to export.' } })
  dl(c.title.replace(/[^\w-]+/g, '_') + '.md', chatMd(c), 'text/markdown')
}

export type SearchMode = 'api' | 'searxng'
export type SearchProvider = 'tinyfish' | 'you' | 'exa' | 'firecrawl' | 'brightdata'
export type CiteStyle = 'pills' | 'links'
export const SEARCH_MODES: [SearchMode, string][] = [['api', 'API'], ['searxng', 'SearXNG']]
export const SEARCH_PROVIDERS: [SearchProvider, string][] = [['tinyfish', 'TinyFish'], ['you', 'You.com'], ['exa', 'Exa'], ['firecrawl', 'Firecrawl'], ['brightdata', 'Bright Data']]
export type SearchPrefs = { mode: SearchMode; provider: SearchProvider; fallback: boolean; keys: Record<SearchProvider, string>; zone: string; citeStyle: CiteStyle; sourcesOpen: boolean; reader: boolean; strictCitations: boolean }
export const BLANK_SEARCH: SearchPrefs = { mode: 'api', provider: 'tinyfish', fallback: true, keys: { tinyfish: '', you: '', exa: '', firecrawl: '', brightdata: '' }, zone: '', citeStyle: 'pills', sourcesOpen: false, reader: true, strictCitations: false }
const SEARCH_VALID_MODES: SearchMode[] = ['api', 'searxng']
const SEARCH_VALID_PROVIDERS: SearchProvider[] = ['tinyfish', 'you', 'exa', 'firecrawl', 'brightdata']
export const normSearch = (v: any): SearchPrefs => {
  const legacyFallback = v?.mode === 'api-fallback'
  const keys = { ...BLANK_SEARCH.keys, ...((v?.keys ?? {}) as Record<string, string>) }
  for (const k of SEARCH_VALID_PROVIDERS) keys[k] = typeof keys[k] === 'string' ? keys[k] : ''
  return {
    mode: SEARCH_VALID_MODES.includes(v?.mode) ? v.mode : legacyFallback ? 'api' : BLANK_SEARCH.mode,
    provider: SEARCH_VALID_PROVIDERS.includes(v?.provider) ? v.provider : BLANK_SEARCH.provider,
    fallback: typeof v?.fallback === 'boolean' ? v.fallback : true,
    keys,
    zone: typeof v?.zone === 'string' ? v.zone : '',
    citeStyle: v?.citeStyle === 'links' ? 'links' : 'pills',
    sourcesOpen: v?.sourcesOpen === true,
    reader: v?.reader !== false,
    strictCitations: v?.strictCitations === true,
  }
}
export const searchKeyOf = (s: any) => String(s?.keys?.[s?.provider] ?? '').trim()

type S = {
  eps: Ep[]; prompts: Prompt[]; pls: Pl[]; cmds: Cmd[]; chats: Chat[]; chat: string
  tools: Record<string, boolean>
  search: SearchPrefs
  skills: SkillState[]
  sel: { k: 'ep' | 'pl'; id: string; model?: string } | null; pr: string
  globalPrompt: { on: boolean; text: string }
  features: Record<FeatureId, boolean>
  featureOrder: FeatureId[]
  libraryShow: Record<string, boolean>
  themeMode: ThemeMode
  themeDark: DarkTheme
  themeLight: LightTheme
  customDarkColors: ThemeColors
  customLightColors: ThemeColors
  setupDone: boolean
  prefs: { showBy: boolean; showLog: boolean; showTps: boolean; enterSends: boolean; autoTitle: boolean; temporaryByDefault: boolean; showModelPricing: boolean; titleEp: string; titleModel?: string; fade: number; tempHours: number; fontBody: string; fontMono: string; fontHeader: string; modelPrimary: 'id' | 'name'; modelSecondary: 'none' | 'provider' | 'id' | 'name'; modelDisplay?: 'none' | 'name' | 'provider' | 'both'; paletteMax: number; chatWidth: 'narrow' | 'standard' | 'wide'; settingsWidth: number; settingsHeight: number; modelPickerHeight: number; sidebarWidth?: number; widgetWidth?: number; workspaceWidth?: number; workspaceSplit?: number; modalBlur: number; settingsOpacity: number; routingMode?: RoutingMode }
  widgets: Record<string, boolean>; widgetPrefs: { usageGroup: 'endpoint' | 'model'; usageMode: 'success' | 'tokens'; usageFormat: string; usageTotal: boolean; usagePeriod: 'session' | 'day' | 'week' | 'custom' | 'all'; usageFrom?: string; usageTo?: string; lastSpeed: boolean; timeUnit: 'ms' | 's' | 'auto'; widgetOrder: string[]; shortcuts: string[]; contextLimit: number; showDisabledEndpoints: boolean; scratchRows: number; snippetLimit: number; costDecimals: number; activePromptsOnly: boolean; charsPerToken: number; hideDoneTodos: boolean }; rail: boolean; pad: string; snips: string[]
  params: { def: boolean; temp: number; topp: number; max: number; maxToolRounds: number; highToolsUnlocked: boolean }; effort: Record<string, string>
  workspacePrefs: WorkspacePrefs
  advanced: AdvancedPrefs
  stats: Stats; keys: Record<string, string>
  memories: Memory[]; memoryPrefs: { enabled: boolean; intent: 'intentional' | 'balanced' | 'aggressive'; recall: 'holistic' | 'contextual' | 'specific'; method: 'local' | 'classifier'; classifierEp: string; classifierModel: string }
  docPrefs: DocPrefs
  folders: Folder[]; price: { in: number; out: number }; todos: { id: string; t: string; done: boolean }[]
  routeStats: Record<string, RouteStat>
  flashMsg: string | null
  draft: string; busy: boolean; notice: Notice
  /* Workspace (first-class entity) */
  workspaces: Record<string, Workspace>
  selectedRevision: Record<string, string>
  patch: (p: Partial<S>) => void
  add: (k: Kind) => void
  upd: (k: Kind, id: string, p: object) => void
  del: (k: Kind, id: string) => void
  move: (k: Kind, id: string, d: number) => void
  newChat: (temporary?: boolean) => void
  chatOp: (id: string, op: 'pin' | 'del') => void
  send: (v: string, att: Att[]) => Promise<boolean>
  stop: () => void
  regen: () => void
  delMsg: (id: string) => void
  editMsg: (id: string, t: string) => void
  resetStats: () => void
  compactStorage: () => string
  rename: (id: string, t: string) => void
  reorder: (k: Kind, from: string, to: string) => void
  addFolder: () => string
  renameFolder: (id: string, name: string) => void
  toggleFolder: (id: string) => void
  delFolder: (id: string) => void
  moveChat: (id: string, folder: string) => void
  branch: (mid: string) => void
  variant: (mid: string, idx: number) => void
}

export { splitEntry, playlistEntries as ents, applyCommandTemplate as body, composeFullInput as full }
/* Structured failure hint: prefers coded errors, falls back to classifying
 * legacy string messages so stored logs still get a useful hint. */
const hint = (l: Try[]) => hintForLog(l)
const errCodeOf = (x: unknown): ErrorCode => classifyModelError((x as { message?: unknown })?.message ?? x)
/* Error text for the process log and failure messages. By default messages
   are redacted (API keys and key-like tokens masked). With Advanced →
   verbose errors, the exact message is shown — the endpoint's own key is
   still masked. */
export const errText = (e: Ep, message: unknown) => {
  const s = String(message ?? 'unknown error')
  let verbose = false
  try { verbose = useS.getState().advanced?.verboseErrors === true && featOn(useS.getState(), 'advanced') } catch { /* store not ready */ }
  return verbose ? s.split(e.key || '\u0000').join('•••') : redact(e, s)
}

const snap = (m: Msg): Snap => ({ t: m.t, by: m.by, tps: m.tps, log: m.log, err: m.err, toolRounds: m.toolRounds, toolFinal: m.toolFinal })

function plan(s: S, um: Msg) {
  return planRequest(s, um, DEFAULT_FEATURES)
}

/* System prompt for the process log when a reply has no saved `sys` (older
   replies). Rebuilt from the preceding user message with current settings,
   so it is an approximation — memory recall in particular may have differed. */
export const previewSysFor = (msgId: string): string | null => {
  const s = useS.getState()
  const chat = s.chats.find((c) => c.msgs.some((m) => m.id === msgId))
  if (!chat) return null
  const i = chat.msgs.findIndex((m) => m.id === msgId)
  const um = [...chat.msgs.slice(0, i)].reverse().find((m) => m.r === 'user')
  if (!um) return null
  try {
    const sys = plan(s, um).sys
    return sys ? sys : null
  } catch { return null }
}

type Run = { stopped: boolean; ctl: AbortController | null }
let cur: Run | null = null

/* Classifier routing decisions are cached per playlist + request (TTL 1h):
 * repeat questions skip the extra model call. */
const routeCache = new RouteCache()
export const __routeCache = routeCache

export const useS = create<S>()(
  persist(
    (set, get) => {
      const bump = (tin: number, tout: number, historyIn = tin, explicitIn = 0) => { if (!featOn(get(), 'stats')) return; set((s) => ({ stats: { ...s.stats, tin: s.stats.tin + tin, tout: s.stats.tout + tout, historyIn: s.stats.historyIn + historyIn, explicitIn: s.stats.explicitIn + explicitIn } })) }
      const addCost = (e: Ep, model: string, tin: number, tout: number) => {
        if (!featOn(get(), 'stats')) return
        const price = e.prices?.[model]
        if (price) set((s) => ({ stats: { ...s.stats, cost: s.stats.cost + (tin * price.input + tout * price.output) / 1e6 } }))
      }
      const edit = (id: string, mid: string, f: (m: Msg) => Msg) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, msgs: c.msgs.map((m) => (m.id === mid ? f(m) : m)) } : c)) }))
      const warn = (n: Notice) => { set({ notice: n }); return false }

      async function generateTitle(chatId: string, usedEp?: Ep, responseStart = '') {
        const s = get()
        if (!s.prefs.autoTitle) return
        const chat = s.chats.find(c => c.id === chatId)
        if (!chat || chat.msgs.length < 1 || (!chat.titleAuto && chat.title !== 'New chat')) return

        let ep = usedEp
        if (s.prefs.titleEp) {
          const customEp = s.eps.find(e => e.id === s.prefs.titleEp && usable(e))
          if (customEp) ep = { ...customEp, model: s.prefs.titleModel && modelsOf(customEp).includes(s.prefs.titleModel) ? s.prefs.titleModel : customEp.model }
        }
        if (!ep || !usable(ep)) {
          ep = s.eps.find(usable)
        }
        if (!ep) return

        const promptMessages = chat.msgs.filter(m => m.r === 'user' || m.t).slice(0, 4).map(m => ({
          role: m.r === 'user' ? 'user' as const : 'assistant' as const,
          content: m.t || '[attachment]'
        }))
        if (responseStart && !promptMessages.some(m => m.role === 'assistant')) promptMessages.push({ role: 'assistant', content: responseStart.slice(0, 500) })
        promptMessages.push({ role: 'user', content: 'Give this conversation a brief, specific 3–6 word title. Use the fewest words needed to name the central topic. Avoid unnecessary adjectives and promotional words (for example, use “Markdown Syntax Reference,” not “Comprehensive Markdown Syntax Reference”). Paraphrase the topic; never repeat the latest user message verbatim. Return only the title.' })

        try {
          const ctrl = new AbortController()
          const res = await stream(ep, 'Create a brief, specific topic label for the conversation. Use the fewest words needed to name the central topic. Avoid unnecessary adjectives and promotional words. Do not copy the user message verbatim. Return only a 3 to 6 word title.', promptMessages, () => {}, ctrl, { cap: 30 })
          let title = res.text.trim().replace(/^["']|["']$/g, '')
          const firstUser = chat.msgs.find(m => m.r === 'user')?.t.trim()
          if (firstUser && title.toLowerCase() === firstUser.toLowerCase()) title = `Chat about ${firstUser}`
          if (title) {
            set(state => ({ chats: state.chats.map(c => c.id === chatId && (c.titleAuto || c.title === 'New chat') ? { ...c, title: title.slice(0, 60), titleAuto: false } : c) }))
          }
        } catch {
          // Ignore title generation errors silently
        }
      }

      async function route(pl: Pl, cand: Ep[], q: string, log: Try[], r: Run) {
        const selected = get().eps.find((e) => e.id === pl.cls && usable(e))
        const c = selected ? { ...selected, model: pl.clsModel && modelsOf(selected).includes(pl.clsModel) ? pl.clsModel : selected.model } : undefined
        if (!c) { log.push({ n: 'Classifier', m: '', err: 'endpoint is missing, disabled or incomplete; using list order' }); return cand }
        const ids = [...new Set(cand.map((e) => e.model))], t0 = Date.now()
        const cached = routeCache.get(pl.id, q)
        if (cached && ids.includes(cached)) {
          log.push({ n: c.name + ' (classifier)', m: c.model, detail: `Reused a cached routing decision for this request (${ids.length} allowed model IDs).`, ms: 0, at: Date.now() })
          const f = cand.find((e) => e.model === cached)!
          return [f, ...cand.filter((e) => e !== f)]
        }
        try {
          r.ctl = new AbortController()
          const x = await stream(c, `Choose the best model for the user's request. ${pl.rule || ''}\nAllowed model ids: ${JSON.stringify(ids)}\nReply with only JSON: {"model":"<one allowed id>"}`, [{ role: 'user', content: q.slice(0, 4000) }], () => {}, r.ctl, { cap: 200 })
          bump(x.tin, x.tout)
          addCost(c, c.model, x.tin, x.tout)
          const j = JSON.parse(x.text.match(/\{[\s\S]*\}/)?.[0] ?? '')
          if (!j || typeof j !== 'object' || Object.keys(j).join() !== 'model' || !ids.includes(j.model)) throw Error('output rejected (wrong shape, or an id outside this playlist): ' + x.text.slice(0, 80))
          routeCache.set(pl.id, q, j.model)
          log.push({ n: c.name + ' (classifier)', m: c.model, detail: `Compared the request (${q.slice(0, 4000).length} characters) against ${ids.length} allowed model IDs using playlist rule${pl.rule ? `: “${pl.rule.slice(0, 180)}${pl.rule.length > 180 ? '…' : ''}”` : ' (no custom rule)'}.`, ms: Date.now() - t0, tin: x.tin, tout: x.tout, at: Date.now() })
          const f = cand.find((e) => e.model === j.model)!
          return [f, ...cand.filter((e) => e !== f)]
        } catch (x: any) {
          if (!r.stopped) log.push({ n: c.name + ' (classifier)', m: c.model, ms: Date.now() - t0, err: errText(c, x.message), errCode: getErrorCode(x) ?? errCodeOf(x), at: Date.now() })
          return cand
        }
      }

      async function answer(um: Msg, prev?: Snap[]) {
        const s = get(), id = s.chat, p = plan(s, um)
        if (p.err) { set({ notice: p.err }); return }
        const r: Run = { stopped: false, ctl: null }
        cur = r
        const mid = uid(), log: Try[] = []
        useLive.getState().clear(mid)
        set((st) => ({ busy: true, notice: null, chats: st.chats.map((c) => (c.id === id ? { ...c, msgs: [...c.msgs, { id: mid, r: 'assistant', t: '', at: Date.now(), by: '', log: [], ...(prev ? { alts: prev, ai: prev.length } : {}) }] } : c)) }))
        const hist = () => (get().chats.find((c) => c.id === id)?.msgs ?? []).filter((m) => m.id !== mid)
        let order = p.cand, ok = false, usedEp: Ep | undefined, system = p.sys
        // Last partially-streamed reply kept when a stream aborts mid-reply,
        // so a failed attempt never wipes what the model already sent.
        let interrupted: { t: string; by: string; toolRounds: { text: string; calls: ToolResult[] }[] } | null = null
        // Context budgeting: the wire payload (not stored history) is trimmed
        // oldest-first so system + history fits the meter's limit minus a
        // reserve for the reply. The trim is reported in the process log.
        const budgetOf = () => {
          const st = get()
          const limit = Math.max(1000, Math.floor(Number(st.widgetPrefs?.contextLimit) || 128000))
          const cpt = Math.min(10, Math.max(1, Number(st.widgetPrefs?.charsPerToken) || 4))
          const outReserve = st.params?.def ? 8000 : Math.max(4096, Math.floor(Number(st.params?.max) || 4096) + 4000)
          const reserve = Math.min(16000, Math.max(4000, Math.min(Math.floor(limit * 0.1), outReserve)))
          return { limit, cpt, reserve }
        }
        let trimLogged = false
        const histFor = () => {
          const h = hist()
          if (h.length <= 1) return h
          const { limit, cpt, reserve } = budgetOf()
          const { msgs, dropped, estimated, budget } = trimHistory(h, { limit, reserve, charsPerToken: cpt, sys: system })
          if (dropped > 0 && !trimLogged) {
            trimLogged = true
            log.push({ n: 'Context trim', m: '', detail: `Sent the latest ${msgs.length} of ${h.length} messages: dropped ${dropped} older message${dropped > 1 ? 's' : ''} to fit ~${estimated.toLocaleString()} estimated tokens into a ${budget.toLocaleString()}-token budget (limit ${limit.toLocaleString()} minus ${reserve.toLocaleString()} reserve). Full history is kept in the chat.`, at: Date.now() })
          }
          return msgs
        }
        const memoryState = get(), mp = memoryState.memoryPrefs
        const memOn = featOn(memoryState, 'memory') && mp.enabled
        // Capture the memory context decision for the visible process log without exposing memory text.
        let memoryTrace: string | undefined
        if (memOn) system += `${system ? '\n\n' : ''}Memory tool policy: memories are user-controlled local data. Use action list to find exact IDs before updating or deleting; never guess an ID. Use add only for short, summarized durable details. ${mp.intent === 'intentional' ? 'Add only when the user explicitly asks you to remember something.' : mp.intent === 'balanced' ? 'Add details the user explicitly asks you to remember and important durable information they disclose.' : 'Add explicit requests, important disclosures, and smaller useful preferences or details.'} Update or delete only when the user asks to change or forget a memory. Never store secrets or sensitive personal information.`
        if (!memOn) memoryTrace = 'Memory was disabled; no stored context was read.'
        else if (!memoryState.memories.length) memoryTrace = 'Memory was enabled, but there were no saved entries to recall.'
        if (memOn && memoryState.memories.length) {
          let selectedMemories = memoryState.memories
          const availableCount = selectedMemories.length
          const method = mp.method === 'classifier' ? 'classifier' : 'local'
          if (mp.recall === 'holistic') {
            memoryTrace = `Memory recall used holistic mode: all ${availableCount} saved entries were added to context.`
          } else if (method === 'local') {
            selectedMemories = rankMemories(selectedMemories, um.full ?? um.t, mp.recall)
            memoryTrace = `Memory recall used ${mp.recall} mode with local ranking: picked ${selectedMemories.length} of ${availableCount} saved entries for the current question (no model call).`
          } else {
            const memKey = `memory:${selectedMemories.map((m) => m.id).join(',')}`
            const cached = routeCache.get(memKey, um.full ?? um.t)
            const cachedIds = cached ? cached.split(',').filter((id) => selectedMemories.some((m) => m.id === id)) : null
            if (cachedIds) {
              selectedMemories = selectedMemories.filter((m) => cachedIds.includes(m.id))
              memoryTrace = `Memory recall used ${mp.recall} mode with a cached classifier decision: accepted ${selectedMemories.length} of ${availableCount} matching IDs.`
            } else {
              const ce = memoryState.eps.find((e) => e.id === mp.classifierEp && usable(e))
              if (ce) try {
                const classifier = { ...ce, model: mp.classifierModel && modelsOf(ce).includes(mp.classifierModel) ? mp.classifierModel : ce.model }
                const classifierPrompt = `Select relevant stored memories. Return strict JSON only: {"memory_ids":["id"]}. Use only supplied ids. ${mp.recall === 'contextual' ? 'Include somewhat relevant memories.' : 'Include only memories directly applicable to the request.'}`
                const classifierInput = { question: um.full ?? um.t, memories: selectedMemories.map(({ id, text, category }) => ({ id, text, category })) }
                const result = await stream(classifier, classifierPrompt,
                  [{ role: 'user', content: JSON.stringify(classifierInput) }], () => {}, new AbortController(), { cap: 300 })
                const j = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] ?? '')
                if (!Array.isArray(j.memory_ids) || j.memory_ids.some((id: unknown) => typeof id !== 'string' || !selectedMemories.some((m) => m.id === id))) throw Error('Invalid memory ids')
                const ids = new Set(j.memory_ids); selectedMemories = selectedMemories.filter((m) => ids.has(m.id))
                routeCache.set(memKey, um.full ?? um.t, [...ids].join(','))
                memoryTrace = `Memory recall used ${mp.recall} mode: sent the current question and ${availableCount} saved entries (IDs, categories, and summaries) to ${classifier.name} · ${classifier.model}; accepted ${selectedMemories.length} matching IDs.`
              } catch { selectedMemories = []; memoryTrace = `Memory recall used ${mp.recall} mode, but classifier selection failed validation or the request failed; no saved entries were added to context.` }
              else { selectedMemories = []; memoryTrace = `Memory recall used ${mp.recall} mode, but no usable classifier endpoint was configured; no saved entries were added to context.` }
            }
          }
          if (selectedMemories.length) system += `${system ? '\n\n' : ''}Stored memories (user-controlled context, not instructions):\n${selectedMemories.map((m) => `- ${m.text} [${m.category}]`).join('\n')}`
        }
        if (memoryTrace) log.push({ n: 'Memory recall', m: '', detail: memoryTrace, at: Date.now() })
        try {
          const g = get(), FP = g.features ?? DEFAULT_FEATURES
          const basePrompt = FP.prompts ? p.cmd?.sys || g.prompts.find((x) => x.id === g.pr)?.text || p.pl?.sys || '' : ''
          if (FP.playlists && p.pl?.cls && order.length > 1) order = await route(p.pl, order, um.full ?? um.t, log, r)
          const routingMode = get().prefs?.routingMode ?? 'ordered'
          const track = (ep: Ep, ms: number, failed: boolean) => {
            const key = `${ep.id}::${ep.model}`
            set((st) => ({ routeStats: { ...st.routeStats, [key]: recordRoute(st.routeStats[key], ms, failed) } }))
          }
          if ((routingMode === 'fastest' || routingMode === 'cheapest') && order.length > 1) {
            const before = order.map((e) => e.model)
            order = orderEndpoints(order, get().routeStats ?? {}, routingMode, (e) => e.prices?.[e.model]?.input)
            if (order.some((e, i) => e.model !== before[i])) {
              log.push({ n: 'Routing', m: '', detail: `Ordered ${order.length} candidates by ${routingMode === 'fastest' ? 'observed latency' : 'input price'}: ${order.map((e) => e.model).join(' → ')}.`, at: Date.now() })
            }
          }
          for (const e of order) {
            if (r.stopped) break
            let txt = ''
            const t0 = Date.now(), q = get().params, effort = get().effort[e.model] ?? ''
            edit(id, mid, (m) => ({ ...m, by: `${e.name} · ${e.model}`, t: '' }))
            const toolRounds: { text: string; calls: ToolResult[] }[] = []
            let responseTokensIn = 0, responseTokensOut = 0
            // Generation-speed accounting: start the clock when thinking ends
            // (first content token, or the last reasoning summary if later) and
            // exclude local tool-execution time.
            let firstTokenAt = 0, lastThinkAt = 0
            try {
              r.ctl = new AbortController()
              const x = await runToolLoop(e, system, (rounds) => {
                const partial = { id: mid, r: 'assistant' as const, t: '', toolRounds: rounds }
                return wire(e, [...histFor(), partial])
              }, (() => {
                const g = get(), GF = g.features ?? DEFAULT_FEATURES
                const base: Record<string, boolean> = GF.tools ? { ...g.tools, memory: memOn } : {}
                // use_skill is a hidden model capability (not listed in Settings → Tools).
                if (featOn(get(), 'skills') && (p.skills ?? []).length) base[SKILL_TOOL_NAME] = true
                return base
              })(), (t) => {
                if (t && !firstTokenAt) firstTokenAt = Date.now()
                txt += t
                const at = performance.now(), duration = get().prefs.fade * 1000
                edit(id, mid, (m) => ({ ...m, t: txt, fadeEvents: duration > 0 && /\S/.test(t)
                  ? [...(m.fadeEvents ?? []).filter((x) => at - x.at < duration), { text: t, at }]
                  : (m.fadeEvents ?? []).filter((x) => at - x.at < duration) }))
              }, r.ctl, { ...(q.def ? {} : { max: q.max, temp: q.temp, topp: q.topp }), effort }, (summary) => {
                if (summary) lastThinkAt = Date.now()
                edit(id, mid, (m) => ({ ...m, reasoning: (m.reasoning ?? '') + summary }))
              }, (rounds) => {
                toolRounds.splice(0, toolRounds.length, ...rounds)
                edit(id, mid, (m) => ({ ...m, toolRounds: [...rounds] }))
              }, toolRoundLimitOf(get().params), {
                [SKILL_TOOL_NAME]: ({ id: skillId }: { id?: string }) => {
                  const states = normSkills(get().skills).skills
                  const def = getSkillInstructions(String(skillId || ''), states)
                  if (!def) throw Error(`Unknown or disabled skill: ${String(skillId || '').trim() || '(empty)'}. Use an id from the Available skills list.`)
                  return `Skill: ${def.name}\n${def.instructions}`
                },
                search: async ({ query }: { query: string }) => {
                  const prefs = normSearch(get().search)
                  return formatSearch(await searchWeb(query, { mode: prefs.mode, provider: prefs.provider, fallback: prefs.fallback, apiKey: searchKeyOf(prefs), zone: prefs.zone }))
                },
                fetch_page: async ({ url }: { url: string }) => {
                  const prefs = normSearch(get().search)
                  if (prefs.reader === false) throw Error('The page reader is off. Enable it in Settings → Tools → Web search → Sources.')
                  if (typeof url !== 'string' || !url.trim()) throw Error('Provide a page URL, preferably a search-result URL.')
                  return formatPage(await fetchPage(url))
                },
                memory: ({ action, id, text, category }: { action: 'list' | 'add' | 'update' | 'delete'; id?: string; text?: string; category?: string }) => {
                const state = get(), prefs = state.memoryPrefs
                if (!prefs.enabled) throw Error('Memory is disabled')
                if (action === 'list') return state.memories.length ? state.memories.map((m) => `${m.id} | ${m.category} | ${m.text}`).join('\n') : 'No memories are stored.'
                if (action === 'add') {
                  const explicit = /\b(remember that|please remember|remember this|don't forget)\b/i.test(um.t)
                  if (prefs.intent === 'intentional' && !explicit) throw Error('Intentional memory mode only stores details the user explicitly asked to remember')
                  if (typeof text !== 'string' || !text.trim()) throw Error('Provide a concise memory summary')
                  const now = Date.now()
                  const entry = { id: uid(), text: text.trim().slice(0, 500), category: String(category || 'General').trim().slice(0, 60) || 'General', createdAt: now, updatedAt: now }
                  const outcome = mergeMemory(state.memories, entry)
                  set(() => ({ memories: mergeMemory(state.memories, entry).memories }))
                  return outcome.merged
                    ? `Merged into existing memory ${outcome.id} (near-duplicate): ${outcome.memories.find((m) => m.id === outcome.id)?.text}`
                    : `Stored memory ${outcome.id}: ${entry.text}`
                }
                if (!id) throw Error(`Provide the exact memory id to ${action}`)
                const current = state.memories.find((m) => m.id === id)
                if (!current) throw Error(`No memory found with id ${id}`)
                if (action === 'delete') {
                  set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }))
                  return `Deleted memory ${id}: ${current.text}`
                }
                if (action === 'update') {
                  if (typeof text !== 'string' || !text.trim()) throw Error('Provide the revised memory summary')
                  const updated = { ...current, text: text.trim().slice(0, 500), category: category == null ? current.category : String(category).trim().slice(0, 60) || 'General', updatedAt: Date.now() }
                  set((s) => ({ memories: s.memories.map((m) => m.id === id ? updated : m) }))
                  return `Updated memory ${id}: ${updated.text} [${updated.category}]`
                }
                throw Error('Choose list, add, update, or delete')
              },
              workspace_upsert: async ({ workspaceId, createNew, workspaceName, revisionName, action, path, language, content, files, template }: {
                workspaceId?: string; createNew?: boolean; workspaceName?: string; revisionName: string;
                action: 'create' | 'update' | 'delete' | 'continue' | 'patch'; path: string; language?: string; content?: string;
                files?: { path?: string; language?: string; content?: string; action?: string }[]; template?: string
              }) => {
                // All file semantics live in applyWorkspaceCall (pure,
                // unit-tested); this handler only commits the result.
                const { workspaces, selectedRevisionId, result } = applyWorkspaceCall(
                  get().workspaces,
                  { workspaceId, createNew, workspaceName, revisionName, action, path, language, content, files, template },
                  { msgId: mid, uid },
                )
                const wid = result.workspaceId
                set((s) => ({
                  workspaces: { ...s.workspaces, [wid]: workspaces[wid] },
                  selectedRevision: { ...s.selectedRevision, [wid]: selectedRevisionId },
                }))
                return JSON.stringify({ ...result, action: action === 'delete' && !(files ?? []).length ? 'deleted' : 'ready' })
              },
              // Live tool deltas feed the ephemeral streaming preview; rewritten
              // wholesale each chunk so backspaces re-render instead of appending.
            }, (calls) => { useLive.getState().set(mid, calls.map((c) => ({ ...c }))) })
              txt = x.text
              responseTokensIn = x.tin; responseTokensOut = x.tout
              const current = get().chats.find(c => c.id === id)
              if (txt.trim() && current && (current.titleAuto || current.title === 'New chat' || !current.title)) void generateTitle(id, e, txt)

              const elapsed = Date.now() - t0
              const toolElapsed = toolRounds.reduce((total, round) => total + Math.max(0, ...round.calls.map((call) => call.ms ?? 0)), 0)
              log.push({ n: e.name, m: e.model, detail: `Answered ${p.tgt} with ${(um.att ?? []).length} attachments and ${(() => { const g = get(); return featOn(g, 'tools') ? Object.values(g.tools).filter(Boolean).length : 0 })()} enabled tools`, ms: Math.max(0, elapsed - toolElapsed), tin: responseTokensIn, tout: responseTokensOut, at: Date.now() })
              const sum = (um.historyTokens ?? 0) + (um.explicitTokens ?? 0), explicit = sum ? Math.round(x.tin * (um.explicitTokens ?? 0) / sum) : 0
              bump(responseTokensIn, responseTokensOut, responseTokensIn - explicit, explicit); ok = true
              track(e, Date.now() - t0, false)
              addCost(e, e.model, responseTokensIn, responseTokensOut)
              // Tokens/sec over generated output tokens (including tokens written
              // across tool rounds), measured from the end of thinking and
              // excluding local tool-execution time.
              const genEnd = Date.now()
              const genToolMs = toolRounds.reduce((total, round) => total + Math.max(0, ...round.calls.map((call) => call.ms ?? 0)), 0)
              const thinkEnd = Math.max(firstTokenAt || t0, lastThinkAt || t0)
              const genMs = Math.max(0, genEnd - thinkEnd - genToolMs)
              // Extract workspace IDs from tool rounds (check both arguments and result)
              const workspaceIds = [...new Set(toolRounds.flatMap((r) => r.calls).filter((c) => c.name === 'workspace_upsert').map((c) => {
                // First check arguments
                try { const args = JSON.parse(c.arguments || '{}'); if (args.workspaceId) return args.workspaceId } catch {}
                // Then check result (for newly created workspaces)
                try { const res = JSON.parse(c.result || '{}'); if (res.workspaceId) return res.workspaceId } catch {}
                return null
              }).filter(Boolean))]
              edit(id, mid, (m) => ({ ...m, tps: Math.round(responseTokensOut / Math.max(genMs / 1000, 0.001) * 10) / 10, toolRounds, ...(toolRounds.length ? { toolFinal: x.text } : {}), workspaceIds }))
              usedEp = e
              break
            } catch (x: any) {
              if (r.stopped) { if (txt) bump(0, est(txt)); break }
              const elapsed = Date.now() - t0
              track(e, elapsed, true)
              const toolElapsed = toolRounds.reduce((total, round) => total + Math.max(0, ...round.calls.map((call) => call.ms ?? 0)), 0)
              log.push({ n: e.name, m: e.model, ms: Math.max(0, elapsed - toolElapsed), err: errText(e, x.message), errCode: getErrorCode(x) ?? errCodeOf(x), at: Date.now() })
              // Preserve whatever the model streamed before aborting. `on()`
              // already wrote it into `txt` (flushed synchronously on error),
              // with `error.partial` as fallback. Keep it on the message now
              // so a later "No model responded" summary cannot wipe it.
              const partial = (typeof x?.partial === 'string' && x.partial) || txt
              if (partial && partial.trim()) {
                const by = `${e.name} · ${e.model}`
                interrupted = { t: partial, by, toolRounds: toolRounds.map((round) => ({ ...round })) }
                if (typeof x?.tin === 'number' || typeof x?.tout === 'number') {
                  const ptin = typeof x?.tin === 'number' ? x.tin : 0
                  const ptout = typeof x?.tout === 'number' ? x.tout : est(partial)
                  bump(ptin, ptout); addCost(e, e.model, ptin, ptout)
                }
                edit(id, mid, (m) => ({ ...m, t: partial, toolRounds: [...toolRounds] }))
              }
              if (p.ex) break
            }
          }
        } catch (x: any) { log.push({ n: 'engine', m: '', err: String(x?.message ?? x), errCode: getErrorCode(x) ?? errCodeOf(x) }) }
        edit(id, mid, (m) => r.stopped
          ? { ...m, sys: system, log, by: m.by ? m.by + ' (stopped)' : 'Stopped', t: m.t || '(stopped before any text arrived)' }
          : ok ? { ...m, sys: system, log }
          : interrupted
            ? { ...m, sys: system, log, t: interrupted.t, toolRounds: interrupted.toolRounds, ...(interrupted.toolRounds.length ? { toolFinal: interrupted.t } : {}), by: `${interrupted.by} (interrupted)`, err: undefined }
            : { ...m, sys: system, log, err: true, by: 'No model responded', t: log.filter((x) => x.err).map((x) => `${x.n}${x.m ? ' · ' + x.m : ''}: ${x.err}`).join('\n') + hint(log) })
        useLive.getState().clear(mid)
        if (prev) edit(id, mid, (m) => ({ ...m, alts: [...prev, snap(m)], ai: prev.length }))
        if (cur === r) { cur = null; set({ busy: false }) }
        // Auto-push sync slot when enabled (fire-and-forget, never blocks UI).
        try {
          if (typeof localStorage !== 'undefined' && localStorage.getItem('byok.sync.auto') === '1') {
            const token = localStorage.getItem('byok.sync.token') || ''
            if (token) {
              void import('./storage/sync').then(({ buildSyncPayload }) => Promise.all([
                import('./storage/durable').then((d) => Promise.all([d.durableGetChats().catch(() => null), d.durableGetWorkspaces().catch(() => null)])),
                import('./storage/syncClient').then((c) => c.syncPush),
              ]).then(([[dChats, dWs], push]) => {
                const st = get()
                const { chats: _c, workspaces: _w, selectedRevision: _sr, ...settings } = st as unknown as Record<string, unknown>
                void _c; void _w; void _sr
                return push(token, buildSyncPayload({ storeVersion: 18, settings, chats: dChats ?? st.chats, workspaces: dWs ?? st.workspaces, selectedRevision: (st as unknown as { selectedRevision: unknown }).selectedRevision }))
              }).catch(() => {})).catch(() => {})
            }
          }
        } catch { /* sync is best-effort */ }
      }

      return {
        eps: [], pls: [],
        prompts: [
          { id: 'general', name: 'General', text: GENERAL_PROMPT_TEXT },
          { id: 'creativity', name: 'Creativity', text: CREATIVITY_PROMPT_TEXT },
          { id: 'concise', name: 'Concise', text: CONCISE_PROMPT_TEXT },
        ],
        cmds: [
          { id: 'k1', name: 'describe', desc: 'Describe an image', in: 'image', sys: 'Describe images accurately and objectively.', tpl: 'Describe this image.', pl: '', on: true },
          { id: 'k2', name: 'summarize', desc: 'Summarize a document', in: 'doc', sys: 'Summarize documents faithfully in under 150 words.', tpl: 'Summarize the attached document. {{input}}', pl: '', on: true },
          { id: 'k3', name: 'ask', desc: 'Ask about an image', in: 'image+text', sys: '', tpl: '{{input}}', pl: '', on: false },
          { id: 'k4', name: 'explain', desc: 'Explain a concept clearly', in: 'text', sys: 'Explain the topic clearly, define unfamiliar terms, and use a concrete example.', tpl: '{{input}}', pl: '', on: true },
          { id: 'k5', name: 'rewrite', desc: 'Rewrite text for clarity', in: 'text', sys: 'Rewrite the provided text for clarity and flow while preserving its meaning. Return only the rewrite.', tpl: '{{input}}', pl: '', on: true },
          { id: 'k6', name: 'translate', desc: 'Translate text', in: 'text', sys: 'Translate the provided text into the language requested. If no target language is specified, ask which language.', tpl: '{{input}}', pl: '', on: true },
          { id: 'k7', name: 'brainstorm', desc: 'Generate useful ideas', in: 'text', sys: 'Generate varied, practical ideas. Keep each idea distinct and briefly explain why it may work.', tpl: '{{input}}', pl: '', on: true },
        ],
        chats: [], chat: '', memories: [], memoryPrefs: { enabled: false, intent: 'balanced', recall: 'contextual', method: 'local', classifierEp: '', classifierModel: '' }, docPrefs: { ...BLANK_DOCS }, tools: { ...DEFAULT_TOOLS }, search: { ...BLANK_SEARCH, keys: { ...BLANK_SEARCH.keys } }, skills: DEFAULT_SKILL_STATE.map((s) => ({ ...s })), widgets: {}, widgetPrefs: { usageGroup: 'endpoint', usageMode: 'success', usageFormat: '{in}/{out}', usageTotal: false, usagePeriod: 'all', lastSpeed: true, timeUnit: 'auto', widgetOrder: WIDGETS.map(([k]) => k), shortcuts: KEYS.map(([k]) => k), contextLimit: 128000, showDisabledEndpoints: true, scratchRows: 6, snippetLimit: 20, costDecimals: 4, activePromptsOnly: false, charsPerToken: 4, hideDoneTodos: false }, rail: false, pad: '', snips: [],
        params: { def: true, temp: 0.7, topp: 1, max: 4096, maxToolRounds: 8, highToolsUnlocked: false }, effort: {},
        workspacePrefs: { defaultView: 'latest', autoOpen: true, autoFollow: true },
        advanced: { ...DEFAULT_ADVANCED },
        sel: null, pr: 'general', globalPrompt: { on: false, text: '' }, features: { ...DEFAULT_FEATURES }, featureOrder: FEATURES.map(([id]) => id), libraryShow: { ...DEFAULT_LIBRARY_SHOW }, themeMode: 'dark', themeDark: 'claude', themeLight: 'paper', customDarkColors: { ...DEFAULT_CUSTOM_COLORS }, customLightColors: { ...DEFAULT_CUSTOM_LIGHT_COLORS }, setupDone: false, prefs: { showBy: true, showLog: true, showTps: false, enterSends: true, autoTitle: true, temporaryByDefault: false, showModelPricing: false, titleEp: '', titleModel: '', fade: 0.4, tempHours: 3, fontBody: 'system', fontMono: 'system', fontHeader: 'system', modelPrimary: 'name', modelSecondary: 'none', paletteMax: 320, chatWidth: 'standard', settingsWidth: 1024, settingsHeight: 780, modelPickerHeight: 480, sidebarWidth: 288, widgetWidth: 320, workspaceWidth: 0.4, workspaceSplit: 0.2, modalBlur: 12, settingsOpacity: 55 },
        stats: ZERO(), keys: Object.fromEntries(KEYS.map(([k, , d]) => [k, d])),
        folders: [], price: { in: 0, out: 0 }, todos: [],
        routeStats: {}, flashMsg: null,
        draft: '', busy: false, notice: null,
        /* Workspace (first-class entity) */
        workspaces: {}, selectedRevision: {},

        patch: (p) => set(p),
        add: (k) => set((s) => ({ [k]: [...(s[k] as any[]), BLANK[k]()] }) as Partial<S>),
        upd: (k, id, p) => set((s) => ({ [k]: (s[k] as any[]).map((x) => (x.id === id ? { ...x, ...p } : x)) }) as Partial<S>),
        del: (k, id) => set((s) => {
          const n: any = { [k]: (s[k] as any[]).filter((x) => x.id !== id) }
          if (k === 'eps') n.pls = s.pls.map((p) => ({ ...p, e: p.e.filter((x) => splitEntry(x)[0] !== id), cls: p.cls === id ? '' : p.cls, clsModel: p.cls === id ? '' : p.clsModel }))
          if (k === 'pls') n.cmds = s.cmds.map((c) => (c.pl === id ? { ...c, pl: '' } : c))
          if (s.sel?.id === id) n.sel = null
          if (s.pr === id) n.pr = ''
          return n
        }),
        move: (k, id, d) => set((s) => {
          const a = [...(s[k] as any[])], i = a.findIndex((x) => x.id === id), j = i + d
          if (i < 0 || j < 0 || j >= a.length) return s
          ;[a[i], a[j]] = [a[j], a[i]]
          return { [k]: a } as Partial<S>
        }),
        newChat: (temporary) => set((s) => {
          temporary ??= s.prefs.temporaryByDefault
          const c = s.chats.find((x) => x.id === s.chat)
          if (c && !c.msgs.length && !temporary && !c.temporary) return { notice: null }
          const n: Chat = { id: uid(), title: temporary ? 'Temporary chat' : 'New chat', msgs: [], temporary, expiresAt: temporary && s.prefs.tempHours > 0 ? Date.now() + s.prefs.tempHours * 3600000 : undefined }
          return { chats: [n, ...s.chats.filter((x) => !(x.temporary && s.prefs.tempHours === 0))], chat: n.id, notice: null }
        }),
        chatOp: (id, op) => set((s) => {
          const chats = op === 'del' ? s.chats.filter((c) => c.id !== id) : s.chats.map((c) => (c.id === id ? { ...c, pin: !c.pin } : c))
          return { chats, chat: s.chat === id && op === 'del' ? chats[0]?.id ?? '' : s.chat }
        }),

        send: async (v, att) => {
          const s = get()
          if (s.busy) return false
          const raw = v.trim()
          if (!raw && !att.length) return false
          let text = raw, cmd: Cmd | undefined
          const m = v.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
          if (m && featOn(s, 'commands')) {
            cmd = s.cmds.find((c) => c.name === m[1])
            if (!cmd) return warn({ t: `/${m[1]} is not a saved command. Start the message with a space to send it as plain text.`, tab: 'cmds', label: 'Manage commands' })
            if (!cmd.on) return warn({ t: `/${cmd.name} is disabled. Enable it in Settings → Commands.`, tab: 'cmds', label: 'Open commands' })
            text = (m[2] ?? '').trim()
            const i = att.some((a) => a.kind === 'img'), d = att.some((a) => a.kind !== 'img')
            const miss = { text: !text && 'text', image: !i && 'an image', 'image+text': (!i || !text) && 'an image and some text', doc: !d && 'a document (PDF or text file)' }[cmd.in]
            if (miss) return warn({ t: `/${cmd.name} needs ${miss}. Attach it with the + button, then send again.` })
          }
          const um: Msg = { id: uid(), r: 'user', t: raw, at: Date.now(), att, cmd: cmd?.id }
          // Vision OCR (Documents setting): when no usable endpoint can take
          // images natively (or OCR is set to always), transcribe images to
          // text first so plan() sees text-backed attachments.
          let files = att
          {
            const dp = normDocs((s as unknown as { docPrefs?: unknown }).docPrefs)
            const bare = att.filter((a) => a.kind === 'img' && a.data && !a.text)
            if (bare.length && dp.ocr !== 'off') {
              const visionEps = s.eps.filter((e) => usable(e) && can(e, 'img'))
              if (dp.ocr === 'always' || !visionEps.length) {
                const picked = s.eps.find((e) => e.id === dp.ocrEp && usable(e) && can(e, 'img')) ?? visionEps[0]
                if (!picked) return warn({ t: 'These images need text extraction, but no usable vision-capable endpoint is configured. Add one in Settings → Endpoints, pick it as the OCR endpoint in Settings → Tools → Documents, or remove the images.', tab: 'eps', label: 'Open endpoints' })
                const model = picked.id === dp.ocrEp && dp.ocrModel && modelsOf(picked).includes(dp.ocrModel) ? dp.ocrModel : picked.model
                try {
                  files = await Promise.all(att.map(async (a) => {
                    if (a.kind !== 'img' || !a.data || a.text) return a
                    const text = await ocrImage(picked, model, a)
                    return { ...a, text: `[ocr: transcribed from ${a.name}]\n${text}`, source: 'ocr' }
                  }))
                  um.att = files
                } catch (x: any) {
                  if (!visionEps.length) return warn({ t: `Image transcription failed (${String(x?.message ?? x)}). Add a vision-capable endpoint or remove the images.`, tab: 'eps', label: 'Open endpoints' })
                }
              }
            }
          }
          void import('./storage/boot').then(({ persistAttachmentBytes }) => persistAttachmentBytes(um.id, files).catch(() => {})).catch(() => {})
          const pre = plan(s, um)
          if (pre.err) return warn(pre.err)
          um.ctx = []
          // Every attachment with extracted text (txt, PDF text layer, Office
          // docs, transcripts, OCR) rides inline; native binaries (images on
          // vision endpoints, PDFs on Anthropic) ride alongside in wire().
          um.fx = files.filter((a) => a.text).map((a) => `\n\n[file: ${a.name}]\n${a.text ?? ''}`).join('')
          um.full = full(body(cmd, text), um.ctx, um.fx)
          const previous = s.chats.find((c) => c.id === s.chat)?.msgs ?? []
          const cpt = Math.min(10, Math.max(1, Number(s.widgetPrefs?.charsPerToken) || 4))
          um.historyTokens = estimateHistoryTokens(previous, '', cpt)
          um.explicitTokens = est(um.full + JSON.stringify(files.map(a => ({ name: a.name, text: a.text }))))
          set((st) => {
            const old = st.chats.find((c) => c.id === st.chat)
            const base: Chat = old ?? { id: uid(), title: 'New chat', msgs: [] }
            const next: Chat = { ...base, started: true, titleAuto: base.msgs.length ? base.titleAuto : st.prefs.autoTitle, title: base.msgs.length ? base.title : (raw || files[0]?.name || 'New chat').slice(0, 40), msgs: [...base.msgs, um] }
            return { chat: base.id, chats: old ? st.chats.map((c) => (c.id === base.id ? next : c)) : [next, ...st.chats], notice: null, stats: featOn(st, 'stats') ? { ...st.stats, sent: st.stats.sent + 1, chats: st.stats.chats + (base.started ? 0 : 1) } : st.stats }
          })
          void answer(um)
          return true
        },
        stop: () => { if (cur) { cur.stopped = true; cur.ctl?.abort() } set({ busy: false }) },
        regen: () => {
          const s = get(), c = s.chats.find((x) => x.id === s.chat)
          if (s.busy || !c) return
          let i = c.msgs.length - 1
          while (i >= 0 && c.msgs[i].r !== 'user') i--
          if (i < 0) return
          const um = c.msgs[i], pre = plan(s, um)
          if (pre.err) { set({ notice: pre.err }); return }
          const old = c.msgs.slice(i + 1).find((m) => m.r === 'assistant')
          const prev = old ? old.alts ?? [snap(old)] : undefined
          set({ chats: s.chats.map((x) => (x.id === c.id ? { ...x, msgs: c.msgs.slice(0, i + 1) } : x)) })
          void answer(um, prev)
        },
        delMsg: (id) => set((s) => ({ chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.filter((m) => m.id !== id) })) })),
        editMsg: (id, t) => {
          const s = get(), c = s.chats.find((x) => x.id === s.chat), i = c ? c.msgs.findIndex((m) => m.id === id) : -1
          if (!c || i < 0) return
          if (s.busy) { set({ notice: { t: 'Stop the current reply before editing a message.' } }); return }
          const o = c.msgs[i]
          if (!t.trim() && !o.att?.length) return
          const m = t.match(/^\/(\S+)(?:\s+([\s\S]*))?$/), cmd = m && featOn(s, 'commands') ? s.cmds.find((x) => x.name === m[1]) : (!m && featOn(s, 'commands') ? s.cmds.find((x) => x.id === o.cmd) : undefined)
          const um: Msg = { ...o, t: t.trim(), cmd: cmd?.id, full: full(body(cmd, m && cmd ? (m[2] ?? '').trim() : t.trim()), o.ctx, o.fx) }
          { const pre = plan(s, um); if (pre.err) { set({ notice: pre.err }); return } }
          set((st) => ({ chats: st.chats.map((x) => (x.id === c.id ? { ...x, msgs: [...c.msgs.slice(0, i), um] } : x)), stats: featOn(st, 'stats') ? { ...st.stats, sent: st.stats.sent + 1 } : st.stats } ))
          void answer(um)
        },
        resetStats: () => set({ stats: ZERO() }),
        compactStorage: () => {
          const s = get(), now = Date.now()
          const before = JSON.stringify({ chats: s.chats, workspaces: s.workspaces }).length
          const chats = s.chats
            .filter((c) => !(c.temporary && c.expiresAt != null && c.expiresAt <= now))
            .map((c) => {
              const lastAi = [...c.msgs].reverse().find((m) => m.r === 'assistant' && m.reasoning)?.id
              return { ...c, msgs: c.msgs.map((m) => ({ ...m, fadeEvents: undefined, reasoning: m.id === lastAi ? m.reasoning : undefined })) }
            })
          const droppedChats = s.chats.length - chats.length
          set({ chats, chat: chats.some((c) => c.id === s.chat) ? s.chat : chats[0]?.id ?? '' })
          try { localStorage.removeItem(QUOTA_FLAG) } catch { /* ignore */ }
          const after = JSON.stringify({ chats: get().chats, workspaces: get().workspaces }).length
          const freed = Math.max(0, before - after)
          return `Compacted stored data (~${(freed / 1024).toFixed(1)} KB freed${droppedChats ? `, ${droppedChats} expired temporary chat${droppedChats > 1 ? 's' : ''} removed` : ''}). Older reasoning traces were cleared; messages, tool history, and workspace files are untouched.`
        },
        rename: (id, t) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, title: t.slice(0, 80), titleAuto: false } : c)) })),
        reorder: (k, f, t) => set((s) => {
          const a = [...(s[k] as any[])], i = a.findIndex((x) => x.id === f), j = a.findIndex((x) => x.id === t)
          if (i < 0 || j < 0 || i === j) return s
          const [x] = a.splice(i, 1); a.splice(j, 0, x)
          return { [k]: a } as Partial<S>
        }),
        addFolder: () => { const id = uid(); set((s) => ({ folders: [...s.folders, { id, name: 'New folder', open: true }] })); return id },
        renameFolder: (id, name) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.slice(0, 40) } : f)) })),
        toggleFolder: (id) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, open: !f.open } : f)) })),
        delFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id), chats: s.chats.map((c) => (c.folder === id ? { ...c, folder: undefined } : c)) })),
        moveChat: (id, folder) => set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, folder: folder || undefined } : c)) })),
        branch: (mid) => set((s) => {
          const c = s.chats.find((x) => x.msgs.some((m) => m.id === mid))
          if (!c) return s
          const i = c.msgs.findIndex((m) => m.id === mid)
          const n: Chat = { id: uid(), title: (c.title + ' (branch)').slice(0, 80), folder: c.folder, started: true, msgs: c.msgs.slice(0, i + 1).map((m) => ({ ...m, id: uid() })) }
          return { chats: [n, ...s.chats], chat: n.id }
        }),
        variant: (mid, idx) => set((s) => ({ chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.map((m) => { const v = m.alts?.[idx]; return m.id === mid && v ? { ...m, ...v, ai: idx } : m }) })) }))
      }
    },
    {
      name: 'byok.v1', version: 18, storage: persistStorage,
      migrate: (p: any, v: number) => {
        delete p.settingsScope
        if (v < 11) {
          const hasUserData = !!(p.eps?.length || p.chats?.length || p.pls?.length || p.prompts?.some((x: any) => !['general', 'creativity', 'concise', 's1', 's2', 's3'].includes(x.id)))
          p.setupDone = hasUserData
        }
        if (v < 18) {
          const old = typeof p.theme === 'string' ? p.theme : undefined
          const oldCustom = p.customColors
          if (typeof p.themeMode !== 'string') p.themeMode = 'dark'
          if (typeof p.themeDark !== 'string') p.themeDark = 'claude'
          if (typeof p.themeLight !== 'string') p.themeLight = 'paper'
          if (old && old !== 'custom' && (DARK_THEMES as readonly string[]).includes(old)) p.themeDark = old
          else if (old && old !== 'custom' && (LIGHT_THEMES as readonly string[]).includes(old)) { p.themeMode = 'light'; p.themeLight = old }
          else if (old === 'custom') p.themeDark = 'custom'
          if (oldCustom && typeof oldCustom === 'object') p.customDarkColors = { ...DEFAULT_CUSTOM_COLORS, ...oldCustom }
          delete p.theme
          delete p.customColors
        }
        p.customDarkColors = { ...DEFAULT_CUSTOM_COLORS, ...(p.customDarkColors ?? {}) }
        p.customLightColors = { ...DEFAULT_CUSTOM_LIGHT_COLORS, ...(p.customLightColors ?? {}) }
        p.eps = (p.eps ?? []).map((e: Ep) => {
          const oldGoogle = e.preset === 'Gemini' || (/generativelanguage\.googleapis\.com/i.test(e.url) && e.name === 'Gemini')
          const preset = oldGoogle ? 'Google' : e.preset
          const endpointId = e.endpointId ?? (preset ? PRE[preset]?.[2] : '')
          const directAuthor = !/openrouter\.ai/i.test(e.url) && (e.endpointFilter ?? (preset ? PRE[preset]?.[3] : 'author')) === 'author' ? endpointId : ''
          const strip = (id: string) => directAuthor && id.toLowerCase().startsWith(`${directAuthor.toLowerCase()}/`) ? id.slice(directAuthor.length + 1) : id
          const remap = (obj?: Record<string, any>) => obj ? Object.fromEntries(Object.entries(obj).map(([id, value]) => [strip(id), value])) : obj
          return { ...e, ...(preset ? { preset } : {}), name: oldGoogle && e.name === 'Gemini' ? 'Google' : e.name, endpointId, endpointFilter: e.endpointFilter ?? (preset ? PRE[preset]?.[3] : undefined), model: strip(e.model), models: e.models?.map(strip), modelNames: remap(e.modelNames), modelEfforts: remap(e.modelEfforts), modelEffortSource: remap(e.modelEffortSource), prices: remap(e.prices) }
        })
        if (p.effort) p.effort = Object.fromEntries(Object.entries(p.effort).map(([id, value]: [string, any]) => [id, typeof value === 'number' ? (value <= 0 ? '' : value < 34 ? 'low' : value < 68 ? 'medium' : 'high') : value]).filter(([, value]) => value && String(value).toLowerCase() !== 'off'))
        delete p.allow
        delete p.fetchMode
        if (p.tools) delete p.tools.fetch
        if (v < 2) {
          p.eps = (p.eps ?? []).filter((e: any) => !(['e1', 'e2'].includes(e.id) && !e.key))
          p.pls = (p.pls ?? []).filter((x: any) => x.id !== 'p1')
          p.chats = (p.chats ?? []).filter((c: any) => !['c1', 'c2', 'c3'].includes(c.id))
          p.sel = null; p.chat = ''
        }
        if (p.prefs && p.prefs.autoTitle === undefined) {
          p.prefs.autoTitle = true
          p.prefs.titleEp = ''
        }
        if (p.prefs && p.prefs.showTps === undefined) p.prefs.showTps = false
        p.prefs = { ...p.prefs, fade: p.prefs?.fade ?? 0.4, tempHours: p.prefs?.tempHours ?? 3, fontBody: p.prefs?.fontBody ?? 'system', fontMono: p.prefs?.fontMono ?? 'system', fontHeader: p.prefs?.fontHeader ?? 'system', modelPrimary: p.prefs?.modelPrimary ?? ({ none: 'id', name: 'name', provider: 'id', both: 'name' } as const)[(p.prefs?.modelDisplay as string) ?? 'both'] ?? 'name', modelSecondary: p.prefs?.modelSecondary ?? ({ none: 'none', name: 'none', provider: 'provider', both: 'provider' } as const)[(p.prefs?.modelDisplay as string) ?? 'both'] ?? 'none', paletteMax: p.prefs?.paletteMax ?? 320, chatWidth: p.prefs?.chatWidth ?? 'standard', settingsWidth: p.prefs?.settingsWidth ?? 1024, settingsHeight: p.prefs?.settingsHeight ?? 780, modelPickerHeight: p.prefs?.modelPickerHeight ?? 480, showModelPricing: p.prefs?.showModelPricing ?? false, titleEp: p.prefs?.titleEp ?? '', titleModel: p.prefs?.titleModel ?? '', routingMode: ['ordered', 'fastest', 'cheapest'].includes(p.prefs?.routingMode) ? p.prefs.routingMode : 'ordered', sidebarWidth: p.prefs?.sidebarWidth ?? 288, widgetWidth: p.prefs?.widgetWidth ?? 320, workspaceWidth: typeof p.prefs?.workspaceWidth === 'number' && p.prefs.workspaceWidth <= 1 ? p.prefs.workspaceWidth : 0.4, workspaceSplit: typeof p.prefs?.workspaceSplit === 'number' ? p.prefs.workspaceSplit : 0.2, modalBlur: p.prefs?.modalBlur ?? 12, settingsOpacity: p.prefs?.settingsOpacity ?? 55, temporaryByDefault: p.prefs?.temporaryByDefault ?? false }
        p.tools = { ...DEFAULT_TOOLS, ...(p.tools ?? {}) }
        p.search = normSearch(p.search)
        p.skills = normSkills(p.skills).skills
        if (typeof p.pr !== 'string') p.pr = ''
        // Fresh installs start on the general-purpose prompt. Existing custom
        // prompts are never deleted here; coding expertise now lives in skills.
        if (!Array.isArray(p.prompts) || !p.prompts.length) {
          p.prompts = [
            { id: 'general', name: 'General', text: GENERAL_PROMPT_TEXT },
            { id: 'creativity', name: 'Creativity', text: CREATIVITY_PROMPT_TEXT },
            { id: 'concise', name: 'Concise', text: CONCISE_PROMPT_TEXT },
          ]
          if (!p.pr) p.pr = 'general'
        } else if (!p.pr && p.prompts.some((x: Prompt) => x.id === 'general')) {
          p.pr = 'general'
        }
        p.memories = Array.isArray(p.memories) ? p.memories : []
        p.globalPrompt = { on: false, text: '', ...(typeof p.globalPrompt === 'object' && p.globalPrompt ? p.globalPrompt : {}) }
        if (typeof p.globalPrompt.on !== 'boolean') p.globalPrompt.on = false
        if (typeof p.globalPrompt.text !== 'string') p.globalPrompt.text = ''
        p.features = { ...DEFAULT_FEATURES, ...(typeof p.features === 'object' && p.features ? p.features : {}) }
        for (const k of Object.keys(DEFAULT_FEATURES) as FeatureId[]) if (typeof (p.features as Record<string, unknown>)[k] !== 'boolean') (p.features as Record<string, unknown>)[k] = DEFAULT_FEATURES[k]
        // Persisted feature order: drop unknown ids, append any missing features in default order.
        p.featureOrder = normFeatureOrder(p.featureOrder)
        p.libraryShow = { ...DEFAULT_LIBRARY_SHOW, ...(typeof p.libraryShow === 'object' && p.libraryShow ? p.libraryShow : {}) }
        // Migrate legacy canvasPrefs to workspacePrefs
        p.workspacePrefs = { defaultView: 'pinned', autoOpen: true, autoFollow: true, ...(p.workspacePrefs ?? {}) }
        // Migrate legacy per-message canvas groups into first-class Workspace entities
        if (!p.workspaces) {
          const { workspaces, selectedRevision } = migrateLegacyCanvasGroups(p.chats ?? [])
          p.workspaces = workspaces
          p.selectedRevision = selectedRevision
        } else {
          p.workspaces = p.workspaces ?? {}
          p.selectedRevision = p.selectedRevision ?? {}
        }
        p.advanced = normAdvanced(p.advanced)
        p.memoryPrefs = { enabled: false, intent: 'balanced', recall: 'contextual', method: 'local', classifierEp: '', classifierModel: '', ...(p.memoryPrefs ?? {}) }
        if (p.memoryPrefs.method !== 'local' && p.memoryPrefs.method !== 'classifier') p.memoryPrefs.method = 'local'
        if (!p.routeStats || typeof p.routeStats !== 'object') p.routeStats = {}
        else {
          for (const [k, v] of Object.entries(p.routeStats)) {
            if (!v || typeof v !== 'object' || !Number.isFinite((v as RouteStat).calls)) delete (p.routeStats as Record<string, unknown>)[k]
            else (p.routeStats as Record<string, RouteStat>)[k] = { calls: Math.max(0, Math.floor((v as RouteStat).calls)), fails: Math.max(0, Math.floor((v as RouteStat).fails ?? 0)), ms: Math.max(0, Number((v as RouteStat).ms) || 0) }
          }
          const keys = Object.keys(p.routeStats).slice(-300)
          if (Object.keys(p.routeStats).length > 300) p.routeStats = Object.fromEntries(keys.map((k) => [k, p.routeStats[k]]))
        }
        p.flashMsg = null
        p.docPrefs = normDocs(p.docPrefs)
        p.widgetPrefs = { usageGroup: 'endpoint', usageMode: 'success', usageFormat: '{in}/{out}', usageTotal: false, usagePeriod: 'all', lastSpeed: true, timeUnit: 'auto', widgetOrder: WIDGETS.map(([k]) => k), shortcuts: KEYS.map(([k]) => k), contextLimit: 128000, showDisabledEndpoints: true, scratchRows: 6, snippetLimit: 20, costDecimals: 4, activePromptsOnly: false, charsPerToken: 4, hideDoneTodos: false, ...(p.widgetPrefs ?? {}) }
        p.widgetPrefs.widgetOrder = [...new Set([...(p.widgetPrefs.widgetOrder ?? []), ...WIDGETS.map(([k]) => k)])]
        p.stats = { ...ZERO(), ...p.stats }
        p.eps = (p.eps ?? []).map((e: Ep) => ({ ...e, modelsMode: e.modelsMode ?? 'separate', models: e.models?.length ? e.models : [e.model], modelNames: e.modelNames ?? {}, prices: e.prices ?? {} }))
        p.pls = (p.pls ?? []).map((pl: Pl) => ({ ...pl, e: (pl.e ?? []).flatMap((ref) => {
          if (ref.includes('::')) return [ref]
          const ep = p.eps.find((item: Ep) => item.id === ref)
          return ep ? modelsOf(ep).map((model) => `${ep.id}::${model}`) : [ref]
        }) }))
        if (Array.isArray(p.cmds)) {
          const defaults: Cmd[] = [
            { id: 'k4', name: 'explain', desc: 'Explain a concept clearly', in: 'text', sys: 'Explain the topic clearly, define unfamiliar terms, and use a concrete example.', tpl: '{{input}}', pl: '', on: true },
            { id: 'k5', name: 'rewrite', desc: 'Rewrite text for clarity', in: 'text', sys: 'Rewrite the provided text for clarity and flow while preserving its meaning. Return only the rewrite.', tpl: '{{input}}', pl: '', on: true },
            { id: 'k6', name: 'translate', desc: 'Translate text', in: 'text', sys: 'Translate the provided text into the language requested. If no target language is specified, ask which language.', tpl: '{{input}}', pl: '', on: true },
            { id: 'k7', name: 'brainstorm', desc: 'Generate useful ideas', in: 'text', sys: 'Generate varied, practical ideas. Keep each idea distinct and briefly explain why it may work.', tpl: '{{input}}', pl: '', on: true },
          ]
          for (const c of defaults) if (!p.cmds.some((x: Cmd) => x.name === c.name || x.id === c.id)) p.cmds.push(c)
        }
        return p
      },
      partialize: (s) => ({
        ...s, busy: false, draft: '', notice: null, flashMsg: null,
        chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.filter((m) => !(m.r === 'assistant' && !m.t && !m.err)).map((m) => ({ ...m, fadeEvents: undefined, att: m.att?.map(({ name, kind, size, mime, source, pages }) => ({ name, kind, size, ...(mime ? { mime } : {}), ...(source ? { source } : {}), ...(pages ? { pages } : {}) })) })) })),
        workspaces: s.workspaces,
        selectedRevision: s.selectedRevision,
      }),
    },
  ),
)
