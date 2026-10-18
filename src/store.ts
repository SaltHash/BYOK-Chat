import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { DEFAULT_TOOLS, KEYS, WIDGETS } from './meta'
import { est, redact, stream, wire, trimHistory, estimateHistoryTokens, runToolLoop, type ToolCall, type ToolResult, searchWeb, formatSearch, fetchPage, formatPage, can, ocrImage, clearSessionCache } from './engine'
import { DEFAULT_SKILL_STATE, normSkills, enabledSkills, getSkillInstructions, composeSystemPrompt, SKILL_TOOL_NAME, type SkillState, type ResolvedSkill } from './skills'
import { BLANK_RESEARCH, PLAN_SCOPE_MAX, PLAN_SCOPE_SYSTEM, RESEARCH_ABSTRACT_ASK, RESEARCH_MIN_SEARCHES, RESEARCH_REASONING_CHARS, RESEARCH_REPORT_ASK, RESEARCH_TIERS, citationRepairAsk, citationUncitedAsk, compactResearchRounds, estimateResearchUsage, fallbackPlan, looksLikeReport, normResearch, parseResearchPlan, parseResearchRequest, planUserAsk, reportSample, researchAbstract, researchMinAsk, researchSystemNote, sanitizeCitations, setStep, tierOf, withStepLead, type ResearchPlan, type ResearchState, type ResearchTierId } from './research'
export { BLANK_RESEARCH, normResearch, tierOf, RESEARCH_TIERS }
export type { ResearchState, ResearchTierId, ResearchPlan, ResearchPlanStep } from './research'
import { collectMessageSources, citationCoverage } from './citations'
import { hintForLog, getErrorCode, classifyModelError, type ErrorCode } from './errors'
import { celebrate } from './flair'
// Set by workspace writes; read once when a reply ends to decide on the completion cue.
let workspaceWritesPending = false
/* Guards the awaited vision-OCR pass inside send(): `busy` is not set yet at
 * that point (the user message is only appended afterwards), so a second
 * Enter could otherwise pass the busy check and send the message twice. */
let sendPause = false
import { usable, modelsOf, modelNameOf } from './models'
import { splitEntry, playlistEntries, applyCommandTemplate, composeFullInput, planRequest } from './chatPlan'
import { migrateLegacyCanvasGroups, applyWorkspaceCall, type Workspace, type WorkspaceRevision } from './workspace'
import { BLANK_DOCS, normDocs, type DocPrefs } from './docs'
export { BLANK_DOCS, normDocs, type DocPrefs }
import { rankMemories, mergeMemory, RouteCache, orderEndpoints, recordRoute, type RouteStat, type RoutingMode } from './recall'
export type { RouteStat, RoutingMode }
import { QUOTA_FLAG, prunePersisted, storageUsage, persistStorage, createPersistMapper, STORE_VERSION, withoutExpiredTemps } from './persistence'

export { QUOTA_FLAG, prunePersisted, storageUsage }

export { usable, modelsOf, modelNameOf }

export type Kind = 'eps' | 'prompts' | 'pls' | 'cmds'
export type ModelPrice = { input: number; output: number; source?: 'manual' | 'openrouter'; cacheRead?: number; cacheWrite?: number }
/* Per-model inference provider pin (OpenRouter only): `tag` is the routing
 * slug sent as `provider.order` (e.g. `amazon-bedrock`), `name` is its label. */
export type ModelProvider = { tag: string; name: string }
/* Explicit names (preferred for new code); short aliases kept as deprecated. */
export type Endpoint = { id: string; name: string; type: 'openai' | 'anthropic'; url: string; key: string; model: string; preset?: string; endpointId?: string; endpointFilter?: 'author' | 'provider'; models?: string[]; modelNames?: Record<string, string>; modelContext?: Record<string, number>; modelProviders?: Record<string, ModelProvider>; modelEfforts?: Record<string, string[]>; modelEffortSource?: Record<string, 'auto' | 'manual'>; modelsMode?: 'separate' | 'playlist'; prices?: Record<string, ModelPrice>; on: boolean }
export type Ep = Endpoint
export type Playlist = { id: string; name: string; sys: string; e: string[]; cls: string; clsModel?: string; rule: string }
export type Pl = Playlist
export type Command = { id: string; name: string; desc: string; in: 'text' | 'image' | 'image+text' | 'doc'; sys: string; tpl: string; pl: string; on: boolean }
export type Cmd = Command
export type Attempt = { n: string; m: string; detail?: string; ms?: number; err?: string; errCode?: ErrorCode; tin?: number; tout?: number; cacheRead?: number; cacheWrite?: number; cost?: number; at?: number }
export type Try = Attempt
export type Attachment = { name: string; kind: 'img' | 'pdf' | 'txt' | 'media'; size: string; mime?: string; data?: string; text?: string; source?: string; pages?: number }
export type Att = Attachment
export type Message = { id: string; r: 'user' | 'assistant'; t: string; at?: number; by?: string; tps?: number; log?: Attempt[]; att?: Attachment[]; err?: boolean; trunc?: boolean; capped?: boolean; full?: string; ctx?: string[]; fx?: string; cmd?: string; alts?: Snap[]; ai?: number; historyTokens?: number; explicitTokens?: number; reasoning?: string; toolRounds?: { text: string; calls: ToolResult[] }[]; toolFinal?: string; sys?: string; workspaceIds?: string[]; research?: ResearchState }
export type Msg = Message
export type Snap = { t: string; by?: string; tps?: number; log?: Try[]; err?: boolean; toolRounds?: { text: string; calls: ToolResult[] }[]; toolFinal?: string }
export type Chat = { id: string; title: string; pin?: boolean; started?: boolean; folder?: string; msgs: Msg[]; temporary?: boolean; expiresAt?: number; titleAuto?: boolean }
export type Folder = { id: string; name: string; open: boolean }
export type Notice = { t: string; tab?: string; label?: string } | null
export type Stats = { tin: number; tout: number; historyIn: number; explicitIn: number; sent: number; chats: number; since: number; cost: number }
export type Memory = { id: string; text: string; category: string; createdAt: number; updatedAt: number }
/* Per-chat system prompt preset ({ id, name, text }; see BLANK.prompts). */
export type Prompt = { id: string; name: string; text: string }

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
  ['skills', 'Skills', 'Extra instructions the AI can use for specific tasks.'],
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
  ['advanced', 'Advanced', 'Debugging aids: verbose errors, hidden tools, system prompt, payloads and token counts.'],
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

export const THEMES = { plum: 'Plum', claude: 'Claude', obsidian: 'Obsidian', bronze: 'Bronze', paper: 'Paper', sage: 'Sage', frost: 'Frost', sunset: 'Sunset', custom: 'Custom' }
export const DARK_THEMES = ['plum', 'claude', 'obsidian', 'bronze'] as const
export const LIGHT_THEMES = ['paper', 'sage', 'frost', 'sunset'] as const
/** Migration map for theme keys removed from the palette. */
export const LEGACY_THEME_MAP: Record<string, string> = { nord: 'claude', amoled: 'obsidian', sepia: 'sunset', porcelain: 'frost', sand: 'sunset' }
/** Normalize a stored theme key: remap removed themes, keep 'custom', discard anything unknown. */
export const normThemeKeyOf = (key: unknown, isDark: boolean): string | null => {
  if (typeof key !== 'string') return null
  let k = LEGACY_THEME_MAP[key] ?? key
  if (k === 'custom') return k
  const valid = (isDark ? DARK_THEMES : LIGHT_THEMES) as readonly string[]
  if (!valid.includes(k)) return null
  return k
}
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
type Live = { tools: Record<string, ToolCall[]>; chunks: Record<string, string[]>; set: (mid: string, calls: ToolCall[]) => void; pushChunk: (mid: string, t: string) => void; clear: (mid: string) => void }
export const useLive = create<Live>()((set) => ({
  tools: {},
  chunks: {},
  set: (mid, calls) => set((s) => ({ tools: { ...s.tools, [mid]: calls } })),
  pushChunk: (mid, t) => set((s) => ({ chunks: { ...s.chunks, [mid]: [...(s.chunks[mid] ?? []), t] } })),
  clear: (mid) => set((s) => {
    if (!(mid in s.tools) && !(mid in s.chunks)) return s
    const tools = { ...s.tools }
    const chunks = { ...s.chunks }
    delete tools[mid]
    delete chunks[mid]
    return { tools, chunks }
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
  if (!c || !c.msgs.length) return s.patch({ notice: { t: 'This chat is empty, so there is nothing to export yet. Send a message first, then try again.' } })
  dl(c.title.replace(/[^\w-]+/g, '_') + '.md', chatMd(c), 'text/markdown')
}

export type SearchProvider = 'tinyfish' | 'you' | 'exa' | 'firecrawl' | 'brightdata'
export type CiteStyle = 'pills' | 'links' | 'off'
export const SEARCH_PROVIDERS: [SearchProvider, string][] = [['tinyfish', 'TinyFish'], ['you', 'You.com'], ['exa', 'Exa'], ['firecrawl', 'Firecrawl'], ['brightdata', 'Bright Data']]
export type SearchPrefs = { provider: SearchProvider; keys: Record<SearchProvider, string>; zone: string; maxResults: number; timeoutMs: number; maxSnippetChars: number; evidenceBudget: number; maxRetries: number; retryBaseMs: number; citeStyle: CiteStyle; sourcesOpen: boolean; reader: boolean; strictCitations: boolean }
export const BLANK_SEARCH: SearchPrefs = { provider: 'tinyfish', keys: { tinyfish: '', you: '', exa: '', firecrawl: '', brightdata: '' }, zone: '', maxResults: 8, timeoutMs: 8000, maxSnippetChars: 1800, evidenceBudget: 12000, maxRetries: 2, retryBaseMs: 300, citeStyle: 'pills', sourcesOpen: false, reader: true, strictCitations: false }

/* Default shapes for the settings objects a Data-tab import can replace
 * wholesale: keep the initial state and import "replace" mode on the same
 * literal so a sparse file can never leave undefined fields behind. */
export const DEFAULT_PREFS: S['prefs'] = { showBy: true, showLog: true, showTps: false, enterSends: true, autoTitle: true, temporaryByDefault: false, seasonal: true, cues: false, showModelPricing: false, showContextMeter: true, titleEp: '', titleModel: '', effortEp: '', effortModel: '', recallEp: '', recallModel: '', tempHours: 3, fontBody: 'system', fontMono: 'system', fontHeader: 'system', modelPrimary: 'name', modelSecondary: 'none', paletteMax: 320, chatWidth: 'standard', settingsWidth: 1024, settingsHeight: 780, modelPickerHeight: 480, sidebarWidth: 288, widgetWidth: 320, workspaceWidth: 0.4, workspaceSplit: 0.2, modalBlur: 12, settingsOpacity: 55, streamFade: 0.3, streamMd: true, remoteImages: false, glassComposer: true }
export const DEFAULT_PARAMS: S['params'] = { def: true, temp: 0.7, topp: 1, max: 4096, maxToolRounds: 8, highToolsUnlocked: false }
export const DEFAULT_WIDGET_PREFS: S['widgetPrefs'] = { usageGroup: 'endpoint', usageMode: 'success', usageFormat: '{in}/{out}', usageTotal: false, usagePeriod: 'all', lastSpeed: true, timeUnit: 'auto', widgetOrder: WIDGETS.map(([k]) => k), shortcuts: KEYS.map(([k]) => k), contextLimit: 128000, showDisabledEndpoints: true, scratchRows: 6, snippetLimit: 20, costDecimals: 4, activePromptsOnly: false, charsPerToken: 4, hideDoneTodos: false }
const SEARCH_VALID_PROVIDERS: SearchProvider[] = ['tinyfish', 'you', 'exa', 'firecrawl', 'brightdata']
const clampInt = (v: unknown, fallback: number, min: number, max: number): number =>
  Number.isInteger(v) ? Math.max(min, Math.min(max, v as number)) : fallback
export const normSearch = (v: any): SearchPrefs => {
  const keys = { ...BLANK_SEARCH.keys, ...((v?.keys ?? {}) as Record<string, string>) }
  for (const k of SEARCH_VALID_PROVIDERS) keys[k] = typeof keys[k] === 'string' ? keys[k] : ''
  return {
    provider: SEARCH_VALID_PROVIDERS.includes(v?.provider) ? v.provider : BLANK_SEARCH.provider,
    keys,
    zone: typeof v?.zone === 'string' ? v.zone : '',
    maxResults: clampInt(v?.maxResults, BLANK_SEARCH.maxResults, 1, 8),
    timeoutMs: clampInt(v?.timeoutMs, BLANK_SEARCH.timeoutMs, 1000, 30000),
    maxSnippetChars: clampInt(v?.maxSnippetChars, BLANK_SEARCH.maxSnippetChars, 200, 3000),
    evidenceBudget: clampInt(v?.evidenceBudget, BLANK_SEARCH.evidenceBudget, 1000, 16000),
    maxRetries: clampInt(v?.maxRetries, BLANK_SEARCH.maxRetries, 0, 4),
    retryBaseMs: clampInt(v?.retryBaseMs, BLANK_SEARCH.retryBaseMs, 50, 2000),
    citeStyle: v?.citeStyle === 'links' ? 'links' : v?.citeStyle === 'off' ? 'off' : 'pills',
    sourcesOpen: v?.sourcesOpen === true,
    reader: v?.reader !== false,
    strictCitations: v?.strictCitations === true,
  }
}
export const searchKeyOf = (s: any) => String(s?.keys?.[s?.provider] ?? '').trim()
/* Results per search: the model may request fewer via its count parameter,
 * but never more than the user's max. Defaults to the user's max. */
export const searchCountOf = (prefs: Pick<SearchPrefs, 'maxResults'>, requested?: unknown): number => {
  const max = Number.isInteger((prefs as { maxResults?: unknown })?.maxResults)
    ? Math.max(1, Math.min(8, (prefs as { maxResults: number }).maxResults))
    : BLANK_SEARCH.maxResults
  return Number.isInteger(requested) ? Math.max(1, Math.min(max, requested as number)) : max
}
/* Full per-request search options from the user's search settings. */
export const searchOptsOf = (prefs: SearchPrefs, requested?: unknown) => ({
  provider: prefs.provider,
  apiKey: searchKeyOf(prefs),
  zone: prefs.zone,
  count: searchCountOf(prefs, requested),
  timeoutMs: prefs.timeoutMs,
  maxSnippetChars: prefs.maxSnippetChars,
  evidenceBudget: prefs.evidenceBudget,
  maxRetries: prefs.maxRetries,
  retryBaseMs: prefs.retryBaseMs,
})

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
  prefs: { showBy: boolean; showLog: boolean; showTps: boolean; enterSends: boolean; autoTitle: boolean; temporaryByDefault: boolean; seasonal?: boolean; cues?: boolean; showModelPricing: boolean; showContextMeter: boolean; titleEp: string; titleModel?: string; effortEp: string; effortModel?: string; recallEp: string; recallModel?: string; tempHours: number; fontBody: string; fontMono: string; fontHeader: string; modelPrimary: 'id' | 'name'; modelSecondary: 'none' | 'provider' | 'id' | 'name'; modelDisplay?: 'none' | 'name' | 'provider' | 'both'; paletteMax: number; chatWidth: 'narrow' | 'standard' | 'wide'; settingsWidth: number; settingsHeight: number; modelPickerHeight: number; sidebarWidth?: number; widgetWidth?: number; workspaceWidth?: number; workspaceSplit?: number; modalBlur: number; settingsOpacity: number; routingMode?: RoutingMode; streamFade: number; streamMd: boolean; remoteImages?: boolean; glassComposer?: boolean }
  widgets: Record<string, boolean>; widgetPrefs: { usageGroup: 'endpoint' | 'model'; usageMode: 'success' | 'tokens'; usageFormat: string; usageTotal: boolean; usagePeriod: 'session' | 'day' | 'week' | 'custom' | 'all'; usageFrom?: string; usageTo?: string; lastSpeed: boolean; timeUnit: 'ms' | 's' | 'auto'; widgetOrder: string[]; shortcuts: string[]; contextLimit: number; showDisabledEndpoints: boolean; scratchRows: number; snippetLimit: number; costDecimals: number; activePromptsOnly: boolean; charsPerToken: number; hideDoneTodos: boolean }; rail: boolean; pad: string; snips: string[]
  params: { def: boolean; temp: number; topp: number; max: number; maxToolRounds: number; highToolsUnlocked: boolean }; effort: Record<string, string>
  workspacePrefs: WorkspacePrefs
  advanced: AdvancedPrefs
  stats: Stats; keys: Record<string, string>
  memories: Memory[]; memoryPrefs: { enabled: boolean; intent: 'intentional' | 'balanced' | 'aggressive'; recall: 'holistic' | 'contextual' | 'specific'; method: 'local' | 'classifier'; classifierEp: string; classifierModel: string }
  docPrefs: DocPrefs
  research: { defaultTier: ResearchTierId }
  folders: Folder[]; price: { in: number; out: number }; todos: { id: string; t: string; done: boolean }[]
  routeStats: Record<string, RouteStat>
  flashMsg: string | null
  draft: string; drafts: Record<string, string>; busy: boolean; notice: Notice
  /* Workspace (first-class entity) */
  workspaces: Record<string, Workspace>
  selectedRevision: Record<string, string>
  researchPanel: { mid: string } | null
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
  editMsg: (id: string, t: string) => boolean
  chooseResearchTier: (mid: string, tier: ResearchTierId) => void
  startResearch: (mid: string) => void
  resumeResearch: (mid: string) => void
  updateResearchPlan: (mid: string, plan: ResearchPlan) => void
  stopResearch: (mid: string) => void
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

export { splitEntry }
export const ents = playlistEntries
export const body = applyCommandTemplate
export const full = composeFullInput
/* Structured failure hint: prefers coded errors, falls back to classifying
 * legacy string messages so stored logs still get a useful hint. */
const hint = (l: Try[]) => hintForLog(l)
const errCodeOf = (x: unknown): ErrorCode => classifyModelError((x as { message?: unknown })?.message ?? x)
/* One automatic retry is worth it for transient failures (dropped
 * connections, provider hiccups, throttling, a stalled stream); permanent
 * ones (bad key, bad request, billing) move straight to the next endpoint. */
const RETRYABLE_CODES: ErrorCode[] = ['network', 'cors', 'timeout', 'rate_limited', 'upstream_unavailable', 'empty_response', 'stalled']
const isRetryableFailure = (x: unknown, code: ErrorCode) => (x as { retryable?: unknown })?.retryable === true || RETRYABLE_CODES.includes(code)
const RETRY_DELAY_MS = 600
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

/* Centralized helper models: one model shared by playlist classification,
 * title generation, effort auto-detection, and memory recall. Each task reads
 * its own ref (see prefs.titleEp/titleModel, memoryPrefs.classifierEp/
 * classifierModel, prefs.effortEp/effortModel, prefs.recallEp/recallModel);
 * the Endpoints tab sets all four at once. */
export const helperRef = (ep: string, model?: string) => (ep ? `${ep}::${model ?? ''}` : '')
export const splitHelperRef = (ref: string): [string, string] => {
  const i = ref.indexOf('::')
  return i < 0 ? ['', ''] : [ref.slice(0, i), ref.slice(i + 2)]
}
/** Resolve the playlist routing classifier: the playlist's own classifier
 * when set, otherwise the global helper classification model as fallback. */
export const playlistClassifierOf = (s: { eps: Ep[]; memoryPrefs: { classifierEp: string; classifierModel: string } }, pl: Pl): Ep | undefined => {
  const pick = (epId: string, model?: string): Ep | undefined => {
    if (!epId) return undefined
    const found = s.eps.find((e) => e.id === epId && usable(e))
    if (!found) return undefined
    return { ...found, model: model && modelsOf(found).includes(model) ? model : found.model }
  }
  return pick(pl.cls, pl.clsModel) ?? pick(s.memoryPrefs.classifierEp, s.memoryPrefs.classifierModel)
}
/** Resolve the configured effort-detection model, if usable. */
export const effortClassifierOf = (s: { eps: Ep[]; prefs: { effortEp: string; effortModel?: string } }): Ep | undefined => {
  if (!s.prefs?.effortEp) return undefined
  const found = s.eps.find((e) => e.id === s.prefs.effortEp && usable(e))
  if (!found) return undefined
  return { ...found, model: s.prefs.effortModel && modelsOf(found).includes(s.prefs.effortModel) ? s.prefs.effortModel : found.model }
}
/** Resolve the configured memory-recall model, if usable. Prefers the
 * dedicated recall slot; falls back to the legacy classification slot. */
export const recallClassifierOf = (s: { eps: Ep[]; prefs: { recallEp: string; recallModel?: string }; memoryPrefs: { classifierEp: string; classifierModel: string } }): Ep | undefined => {
  const pick = (epId: string, model?: string): Ep | undefined => {
    if (!epId) return undefined
    const found = s.eps.find((e) => e.id === epId && usable(e))
    if (!found) return undefined
    return { ...found, model: model && modelsOf(found).includes(model) ? model : found.model }
  }
  return pick(s.prefs?.recallEp, s.prefs?.recallModel) ?? pick(s.memoryPrefs.classifierEp, s.memoryPrefs.classifierModel)
}
/** Lowest thinking level a model supports, or '' when none is known.
 * Classifier calls use this so background routing stays cheap. */
const EFFORT_RANK: Record<string, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 }
export const lowestEffortOf = (e: Ep): string => {
  const levels = e.modelEfforts?.[e.model] ?? []
  if (!levels.length) return ''
  return [...levels].sort((a, b) => (EFFORT_RANK[a.toLowerCase()] ?? 50) - (EFFORT_RANK[b.toLowerCase()] ?? 50))[0] ?? ''
}
/* Ask the effort-detection model to pick one of `levels` for the request.
 * Strict JSON only: {"effort":"<one available level>"}. Returns '' when
 * unconfigured, unusable, or the output fails validation. */
export async function classifyEffort(query: string, levels: string[]): Promise<{ level: string; tin: number; tout: number; by: string; cost?: number; cacheRead?: number; cacheWrite?: number }> {
  const none = { level: '', tin: 0, tout: 0, by: '' }
  const uniq = [...new Set(levels.filter(Boolean))]
  if (!uniq.length) return none
  let s: { eps: Ep[]; prefs: { effortEp: string; effortModel?: string } }
  try { s = useS.getState() } catch { return none }
  const c = effortClassifierOf(s)
  if (!c) return none
  try {
    const x = await stream(c,
      `Pick the reasoning effort for the user's request. Available effort levels: ${JSON.stringify(uniq)}. Reply with strict JSON only, no other text: {"effort":"<one available level>"}`,
      [{ role: 'user', content: query.slice(0, 4000) }], () => {}, new AbortController(), { cap: 100, effort: lowestEffortOf(c) })
    const j = JSON.parse(x.text.match(/\{[\s\S]*\}/)?.[0] ?? '')
    if (!j || typeof j !== 'object' || Object.keys(j).join() !== 'effort' || typeof j.effort !== 'string' || !uniq.includes(j.effort)) throw Error('rejected: ' + x.text.slice(0, 80))
    return { level: j.effort, tin: x.tin, tout: x.tout, cost: (x as any).cost ?? 0, cacheRead: (x as any).cacheRead ?? 0, cacheWrite: (x as any).cacheWrite ?? 0, by: `${c.name} · ${c.model}` }
  } catch { return none }
}

type Run = { stopped: boolean; ctl: AbortController | null }
let cur: Run | null = null

/* Classifier routing decisions are cached per playlist + request (TTL 1h):
 * repeat questions skip the extra model call. */
const routeCache = new RouteCache()
export const __routeCache = routeCache

/* Per-chat memo for the persisted copy: only the chat that changed is
 * re-mapped per store write (see persistence.ts). */
const mapPersistChats = createPersistMapper()

export const useS = create<S>()(
  persist(
    (baseSet, get) => {
      /* Every state write funnels through here so per-chat drafts stay
         coherent: `draft` always mirrors the active chat, and switching
         `chat` stages the outgoing draft and restores the incoming chat's own
         draft, so a half-typed message never leaks between chats. */
      const set = ((p: any, replace?: boolean) => (baseSet as any)((s: S) => {
        const n = typeof p === 'function' ? p(s) : p
        if (!n || typeof n !== 'object') return n
        const hasChat = 'chat' in n, hasDraft = 'draft' in n
        if (!hasChat && !hasDraft) return n
        const drafts: Record<string, string> = { ...(n.drafts ?? s.drafts) }
        const target = ((hasChat ? n.chat : s.chat) ?? '') as string
        if (hasDraft && target && target === s.chat) drafts[target] = (n.draft as string) ?? ''
        if (hasChat && n.chat !== s.chat) {
          // Stash the outgoing draft only while its chat still exists: a
          // deleted chat must not keep its draft alive in the stash.
          const next = (n.chats ?? s.chats) as Chat[]
          if (s.chat && next.some((c) => c.id === s.chat)) drafts[s.chat] = ((hasDraft ? n.draft : s.draft) as string) ?? ''
          return { ...n, draft: drafts[(n.chat as string) ?? ''] ?? '', drafts }
        }
        return { ...n, drafts }
      }, replace)) as typeof baseSet
      const bump = (tin: number, tout: number, historyIn = tin, explicitIn = 0) => { if (!featOn(get(), 'stats')) return; set((s) => ({ stats: { ...s.stats, tin: s.stats.tin + tin, tout: s.stats.tout + tout, historyIn: s.stats.historyIn + historyIn, explicitIn: s.stats.explicitIn + explicitIn } })) }
      const addCost = (e: Ep, model: string, tin: number, tout: number, reportedCost = 0, usage?: { cacheRead?: number; cacheWrite?: number }) => {
        if (!featOn(get(), 'stats')) return
        // Prefer the provider-reported spend (OpenRouter `usage.cost`) when
        // present: it already accounts for cached/discounted pricing. Fall
        // back to the user's per-model price table otherwise.
        if (Number.isFinite(reportedCost) && reportedCost > 0) {
          set((s) => ({ stats: { ...s.stats, cost: s.stats.cost + reportedCost } }))
          return
        }
        const price = e.prices?.[model]
        if (!price) return
        // `tin` counts uncached prompt tokens only, so cache traffic is billed
        // separately: at the table's cache rate when one is set, else at the
        // plain input rate.
        const read = usage?.cacheRead ?? 0, write = usage?.cacheWrite ?? 0
        const cost = (tin * price.input + read * (price.cacheRead ?? price.input) + write * (price.cacheWrite ?? price.input) + tout * price.output) / 1e6
        set((s) => ({ stats: { ...s.stats, cost: s.stats.cost + cost } }))
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
        const c = playlistClassifierOf(get(), pl)
        if (!c) { log.push({ n: 'Classifier', m: '', err: 'no playlist classifier or helper classification model is set; using list order' }); return cand }
        const ids = [...new Set(cand.map((e) => e.model))], t0 = Date.now()
        const cached = routeCache.get(pl.id, q)
        if (cached && ids.includes(cached)) {
          log.push({ n: c.name + ' (classifier)', m: c.model, detail: `Reused a cached routing decision for this request (${ids.length} allowed model IDs).`, ms: 0, at: Date.now() })
          const f = cand.find((e) => e.model === cached)!
          return [f, ...cand.filter((e) => e !== f)]
        }
        try {
          r.ctl = new AbortController()
          const x = await stream(c, `Choose the best model for the user's request. ${pl.rule || ''}\nAllowed model ids: ${JSON.stringify(ids)}\nReply with only JSON: {"model":"<one allowed id>"}`, [{ role: 'user', content: q.slice(0, 4000) }], () => {}, r.ctl, { cap: 200, effort: lowestEffortOf(c) })
          bump(x.tin, x.tout)
          addCost(c, c.model, x.tin, x.tout, (x as any).cost ?? 0, x)
          const j = JSON.parse(x.text.match(/\{[\s\S]*\}/)?.[0] ?? '')
          if (!j || typeof j !== 'object' || Object.keys(j).join() !== 'model' || !ids.includes(j.model)) throw Error('output rejected (wrong shape, or an id outside this playlist): ' + x.text.slice(0, 80))
          routeCache.set(pl.id, q, j.model)
          log.push({ n: c.name + ' (classifier)', m: c.model, detail: `Compared the request (${q.slice(0, 4000).length} characters) against ${ids.length} allowed model IDs using ${pl.cls ? 'playlist rule' : 'helper classification model'}${pl.rule ? `: “${pl.rule.slice(0, 180)}${pl.rule.length > 180 ? '…' : ''}”` : ' (no custom rule)'}.`, ms: Date.now() - t0, tin: x.tin, tout: x.tout, cacheRead: (x as any).cacheRead ?? 0, cacheWrite: (x as any).cacheWrite ?? 0, cost: (x as any).cost ?? 0, at: Date.now() })
          const f = cand.find((e) => e.model === j.model)!
          return [f, ...cand.filter((e) => e !== f)]
        } catch (x: any) {
          if (!r.stopped) log.push({ n: c.name + ' (classifier)', m: c.model, ms: Date.now() - t0, err: errText(c, x.message), errCode: getErrorCode(x) ?? errCodeOf(x), at: Date.now() })
          return cand
        }
      }

      /* Append a fresh tier-pick research card after `msgs` in `chatId` and
       * mark the request as busy. Used by send and by regen / editMsg when
       * the (re)sent message is a @research request. */
      function startResearchTierPick(chatId: string, msgs: Msg[], query: string) {
        const mid = uid()
        const rq: ResearchState = { id: uid(), query, tier: null, status: 'tier-pick', steps: [], startedAt: Date.now() }
        set({ busy: false, chats: get().chats.map((x) => (x.id === chatId ? { ...x, msgs: [...msgs, { id: mid, r: 'assistant', t: '', at: Date.now(), by: '', log: [], research: rq }] } : x)) })
      }

      const researchMsg = (chatId: string, mid: string) =>
        get().chats.find((c) => c.id === chatId)?.msgs.find((m) => m.id === mid)
      const patchRs = (chatId: string, mid: string, f: (rs: ResearchState) => ResearchState) =>
        edit(chatId, mid, (m) => (m.research ? { ...m, research: f(m.research) } : m))

      /** Tool registry for a research run: only the search and page-reader tools
       * (plus skills when enabled). Unrelated tools — workspaces, prompt chips,
       * navigation — are deliberately excluded so they cannot derail a run.
       * Rebuilt for every endpoint attempt so a retry never inherits a tool the
       * previous attempt disabled or a spent budget. */
      function researchEnabled(p: ReturnType<typeof plan>): Record<string, boolean> {
        const g = get()
        const prefs = normSearch(g.search)
        const base: Record<string, boolean> = { search: true, fetch_page: prefs.reader !== false }
        if (featOn(g, 'skills') && (p.skills ?? []).length) base[SKILL_TOOL_NAME] = true
        return base
      }

      /** The hidden skill loader, shared by chat and research so a skill enabled
       * during a research run actually resolves (it would otherwise fall back to
       * the registry's placeholder). */
      const skillHandler = ({ id: skillId }: { id?: string }) => {
        const states = normSkills(get().skills).skills
        const def = getSkillInstructions(String(skillId || ''), states)
        if (!def) throw Error(`Unknown or disabled skill: ${String(skillId || '').trim() || '(empty)'}. Use an id from the Available skills list.`)
        return `Skill: ${def.name}\n${def.instructions}`
      }

      /** Conservative price ceiling for a research run: the most expensive of the
       * endpoint candidates it might fail over to, so the shown estimate is a
       * true worst case rather than only the first candidate's price. */
      const researchPriceCeiling = (cand: ReturnType<typeof plan>['cand']) => {
        const prices = cand
          .map((c) => c.prices?.[c.model])
          .filter((pr): pr is { input: number; output: number } => !!pr && (pr.input > 0 || pr.output > 0))
        return prices.length
          ? { input: Math.max(...prices.map((pr) => pr.input)), output: Math.max(...prices.map((pr) => pr.output)) }
          : null
      }

      /* The plan phase: draft a research plan, store it on the card, and wait
       * for the user to start (or edit) it. Shares `cur` with the run, so the
       * same Stop button cancels it. Falls back to a deterministic plan when
       * the planning reply cannot be parsed, so the flow never dead-ends. */
      async function planResearch(mid: string, um: Msg, query: string, tierId: ResearchTierId) {
        const chatId = get().chat
        const p = plan(get(), um)
        if (p.err) {
          patchRs(chatId, mid, (rs) => ({ ...rs, status: 'error', error: p.err?.t ?? 'No endpoint ready.', finishedAt: Date.now() }))
          set({ busy: false, notice: p.err })
          return
        }
        const tier = tierOf(tierId)
        const r: Run = { stopped: false, ctl: null }
        cur = r
        set({ busy: true })
        const log: Try[] = []
        const prefs = normSearch(get().search)
        const searchOpts = searchOptsOf(prefs)
        const price = researchPriceCeiling(p.cand)
        patchRs(chatId, mid, (rs) => ({ ...rs, status: 'planning', scope: 0, tier: tier.id, error: undefined, finishedAt: undefined, estimate: estimateResearchUsage(tier, price) }))
        let text = ''
        let used: Ep | null = null
        // Scope the topic with a few context searches before drafting the plan,
        // so the plan reflects what is actually out there. Budgeted separately
        // from the run's own search budget and capped at PLAN_SCOPE_MAX.
        const scopeEnabled: Record<string, boolean> = { search: true }
        let scopeUsed = 0
        let scopeRounds: { text: string; calls: ToolResult[] }[] = []
        for (const e of p.cand) {
          if (r.stopped) break
          try {
            r.ctl = new AbortController()
            const effRaw = get().effort[e.model] ?? ''
            const o = { ...(get().params.def ? {} : { max: get().params.max, temp: get().params.temp, topp: get().params.topp }), effort: effRaw === 'auto' ? '' : effRaw }
            const sys = `${p.sys}${p.sys ? '\n\n' : ''}${PLAN_SCOPE_SYSTEM}`
            const ask = planUserAsk(query, tier)
            const wirePlan = (rounds: { text: string; calls: ToolResult[] }[]) => wire(e, [
              { id: mid, r: 'user' as const, t: ask },
              ...(rounds.length ? [{ id: mid, r: 'assistant' as const, t: '', toolRounds: rounds }] : []),
            ])
            const t0 = Date.now()
            let x: Awaited<ReturnType<typeof runToolLoop>>
            try {
              x = await runToolLoop(e, sys, wirePlan, scopeEnabled, () => {}, r.ctl, o, () => {}, (rounds) => { scopeRounds = rounds }, PLAN_SCOPE_MAX + 3, {
                search: async ({ query: q }: { query: string }) => {
                  if (r.stopped) throw Error('Research stopped.')
                  if (scopeUsed >= PLAN_SCOPE_MAX) {
                    // Disable the tool so the next round has nothing to call and
                    // the model has to return the plan instead of spinning.
                    scopeEnabled.search = false
                    return `Context search budget reached (${PLAN_SCOPE_MAX}). Draft the plan now from what you have.`
                  }
                  scopeUsed++
                  patchRs(chatId, mid, (rs) => ({ ...rs, scope: scopeUsed }))
                  try {
                    const data = await searchWeb(String(q ?? ''), { ...searchOpts, cache: true })
                    return formatSearch(data as never, { inlineCites: false })
                  } catch (err: any) {
                    // A failed context search must never dead-end planning: tell
                    // the model to adapt and keep going.
                    return `Search failed (${String(err?.message ?? err).slice(0, 200)}). Try a different query, or draft the plan from what you already know.`
                  }
                },
              }, () => {}, { maxParallel: 3 })
            } catch (err) {
              // The round cap with the tool still enabled: one final tool-free
              // round so the plan JSON is always produced.
              if (r.stopped || (getErrorCode(err) ?? errCodeOf(err)) !== 'tool_limit') throw err
              x = await runToolLoop(e, sys, () => wirePlan(scopeRounds), {}, () => {}, r.ctl, o, () => {}, () => {}, 1)
            }
            bump(x.tin, x.tout); addCost(e, e.model, x.tin, x.tout, (x as any).cost ?? 0, x)
            log.push({ n: e.name, m: e.model, detail: `Research plan for “${query.slice(0, 80)}” (${scopeUsed} context ${scopeUsed === 1 ? 'search' : 'searches'})`, ms: Date.now() - t0, tin: x.tin, tout: x.tout, cacheRead: (x as any).cacheRead ?? 0, cacheWrite: (x as any).cacheWrite ?? 0, cost: (x as any).cost ?? 0, at: Date.now() })
            text = x.finalText || x.text
            used = e
            break
          } catch (x: any) {
            if (r.stopped) break
            log.push({ n: e.name, m: e.model, err: errText(e, (x as Error)?.message), errCode: getErrorCode(x) ?? errCodeOf(x), at: Date.now() })
            if (p.ex) break
          }
        }
        if (r.stopped) { if (cur === r) { cur = null; set({ busy: false }) } return }
        const parsed = text ? parseResearchPlan(text) : null
        const finalPlan = parsed ?? fallbackPlan(query)
        const planWarn = parsed ? undefined : 'The model did not return a usable plan, so this default one is shown. Edit it or start the research.'
        patchRs(chatId, mid, (rs) => ({ ...rs, status: 'plan', plan: finalPlan, error: planWarn }))
        // A chat whose first message is a deep-research request is named after
        // the report's plan title (a short topic title) instead of the raw user
        // message. Never clobber a title the user renamed.
        const planTitle = String(finalPlan.title ?? '').replace(/\s+/g, ' ').trim()
        if (planTitle) set((st) => ({
          chats: st.chats.map((c) => {
            if (c.id !== chatId) return c
            const first = c.msgs[0]?.r === 'user' && c.msgs[1]?.id === mid
            const auto = c.titleAuto || c.title === 'New chat' || !c.title || c.title === query.slice(0, 40)
            return first && auto ? { ...c, title: planTitle.slice(0, 60) } : c
          }),
        }))
        edit(chatId, mid, (m) => ({ ...m, by: used ? `${used.name} · ${used.model} · Research plan` : (m.by || 'Research plan'), log }))
        if (cur === r) { cur = null; set({ busy: false }) }
      }

      async function runResearch(mid: string, um: Msg, query: string, tierId: ResearchTierId, resume = false) {
        const chatId = get().chat
        const p = plan(get(), um)
        if (p.err) {
          patchRs(chatId, mid, (rs) => ({ ...rs, status: 'error', error: p.err?.t ?? 'No endpoint ready.', finishedAt: Date.now() }))
          set({ busy: false, notice: p.err })
          if (cur) cur = null
          return
        }
        const tier = tierOf(tierId)
        const r: Run = { stopped: false, ctl: null }
        cur = r
        set({ busy: true })
        const log: Try[] = []
        const t0 = Date.now()
        const setSteps = (steps: ResearchState['steps']) => patchRs(chatId, mid, (rs) => ({ ...rs, steps }))
        const getSteps = () => (researchMsg(chatId, mid)?.research?.steps ?? [])
        const getResearch = () => researchMsg(chatId, mid)?.research
        const prefs = normSearch(get().search)
        const searchOpts = searchOptsOf(prefs)
        const cpt = Math.min(10, Math.max(1, Number(get().widgetPrefs?.charsPerToken) || 4))
        const ctxLimit = Math.max(2000, Number(get().widgetPrefs?.contextLimit) || 128000)
        const baseSteps = resume ? (getResearch()?.steps ?? []) : []
        const baseRounds = resume ? (researchMsg(chatId, mid)?.toolRounds ?? []) : []
        const baseSearches = baseSteps.filter((s) => s.kind === 'search').length
        const baseReads = baseSteps.filter((s) => s.kind === 'read').length
        const planApproved = getResearch()?.plan ?? null
        const system = `${p.sys}${p.sys ? '\n\n' : ''}${researchSystemNote(query, tier, new Date(), planApproved)}`
        const histFor = () => (get().chats.find((c) => c.id === chatId)?.msgs ?? []).filter((m) => m.id !== mid)
        if (!resume || !getResearch()?.estimate) {
          // A run can fail over to any candidate, so the ceiling uses the most
          // expensive one rather than only the first (the estimate is a "worst
          // case" the user sees before starting).
          const price = researchPriceCeiling(p.cand)
          patchRs(chatId, mid, (rs) => ({ ...rs, estimate: rs.estimate ?? estimateResearchUsage(tier, price) }))
        }
        // Absolute, run-wide citation ids: every search result and page read
        // gets one S<n> for the whole run, counting up without restarting.
        // Duplicate URLs reuse their first id so the model's [S<n>] is exact.
        // Kept across endpoint retries so ids stay unique and monotonic.
        const citeByUrl = new Map<string, string>()
        let nextCite = 1
        const urlKeyOf = (url: string) => {
          try {
            const u = new URL(url)
            u.hash = ''
            return u.toString().replace(/\/$/, '').toLowerCase()
          } catch { return String(url ?? '').toLowerCase() }
        }
        const citeIdFor = (url: string): string => {
          const k = urlKeyOf(url)
          const hit = citeByUrl.get(k)
          if (hit) return hit
          const id = `S${nextCite++}`
          citeByUrl.set(k, id)
          return id
        }
        let order = p.cand
        try {
          if ((get().features ?? DEFAULT_FEATURES).playlists && p.pl && order.length > 1 && playlistClassifierOf(get(), p.pl)) order = await route(p.pl, order, um.full ?? um.t, log, r)
        } catch { /* routing is best-effort */ }
        let ok = false
        // Run-wide, monotonic state: the transcript and the budgets carry over
        // between endpoint attempts, so a failure on one endpoint never throws
        // away the evidence (or resets the budget) another already gathered. The
        // deadline is fixed for the whole run — retries and resumes reuse it
        // rather than restarting the clock — so the tier's time budget bounds
        // the run.
        let usedSearches = baseSearches
        let usedReads = baseReads
        let stepN = baseSteps.length
        let liveRounds: { text: string; calls: ToolResult[] }[] = [...baseRounds]
        const priorDeadline = getResearch()?.deadlineAt
        const deadline = typeof priorDeadline === 'number' && priorDeadline > 0 ? priorDeadline : Date.now() + tier.timeoutMs
        if (!priorDeadline) patchRs(chatId, mid, (rs) => ({ ...rs, deadlineAt: deadline }))
        for (const e of order) {
          if (r.stopped) break
          edit(chatId, mid, (m) => ({ ...m, by: `${e.name} · ${e.model} · Deep research (${tier.label})` }))
          let txt = ''
          let report = ''
          let tin = 0, tout = 0, cacheRead = 0, cacheWrite = 0, usageCost = 0
          const enabledTools = researchEnabled(p)
          patchRs(chatId, mid, (rs) => ({ ...rs, status: 'running', note: '' }))
          // Older tool rounds are compacted before they are re-sent, keeping
          // the transcript inside the context window on long runs; citation
          // ids survive so the report's [S<n>] still resolve. Chat history is
          // trimmed oldest-first against the same context limit.
          const wireRounds = (cand: Ep, rounds: { text: string; calls: ToolResult[] }[], assistantText = '', tail: Msg[] = []) => {
            const built: Msg = { id: mid, r: 'assistant', t: assistantText, toolRounds: compactResearchRounds(rounds) }
            // Trim only the chat history (oldest-first); the research message
            // and its evidence are always kept, since dropping them would
            // leave the model with nothing to search or write from.
            const hist = trimHistory(histFor(), { limit: ctxLimit, sys: system, charsPerToken: cpt }).msgs
            return wire(cand, [...hist, built, ...tail])
          }
          try {
            r.ctl = new AbortController()
            let researchEffort = get().effort[e.model] ?? ''
            if (researchEffort === 'auto') {
              const picked = await classifyEffort(query, e.modelEfforts?.[e.model] ?? [])
              if (picked.level) { researchEffort = picked.level; bump(picked.tin, picked.tout); const ce = effortClassifierOf(get()); if (ce) addCost(ce, ce.model, picked.tin, picked.tout, (picked as any).cost ?? 0, picked); log.push({ n: `${picked.by} (effort)`, m: picked.level, detail: `Auto effort for ${e.model}: chose ${picked.level}.`, ms: 0, tin: picked.tin, tout: picked.tout, cacheRead: (picked as any).cacheRead ?? 0, cacheWrite: (picked as any).cacheWrite ?? 0, cost: (picked as any).cost ?? 0, at: Date.now() }) }
              else researchEffort = ''
            }
            const o = { ...(get().params.def ? {} : { max: get().params.max, temp: get().params.temp, topp: get().params.topp }), effort: researchEffort }
            // The round's narration streams above the searches it is about to
            // make — exactly where its first step will land.
            const note = (t: string) => patchRs(chatId, mid, (rs) => ({ ...rs, note: (rs.note ?? '') + t }))
            const onReasoning = (t: string) => patchRs(chatId, mid, (rs) => ({ ...rs, reasoning: ((rs.reasoning ?? '') + t).slice(-RESEARCH_REASONING_CHARS) }))
            // The search/read budget and time checks live in the handlers; tool
            // errors steer the model instead of failing the whole run.
            const toolHandlers: Record<string, (args: any) => unknown | Promise<unknown>> = {
              search: async ({ query: q, count }: { query: string; count?: number }) => {
                if (r.stopped) throw Error('Research stopped.')
                if (Date.now() > deadline) {
                  enabledTools.search = false
                  return 'Research time limit reached. No further searches are available — close the research with your short abstract of the report you are about to write.'
                }
                if (usedSearches >= tier.maxSearches) {
                  // Drop the tool so the next round has nothing to call and the
                  // model has to answer with its abstract instead of spinning.
                  enabledTools.search = false
                  return `Search budget reached (${tier.maxSearches} searches for ${tier.label}). No further searches are available — close the research with your short abstract of the report you are about to write.`
                }
                usedSearches++
                stepN++
                const id = `s${stepN}`
                patchRs(chatId, mid, (rs) => withStepLead(rs, { id, kind: 'search', label: `Search ${usedSearches}`, query: String(q ?? '').slice(0, 120), state: 'running' }))
                try {
                  const data = await searchWeb(String(q ?? ''), { ...searchOpts, count: searchCountOf(prefs, count), cache: true })
                  const results = (data as { results?: { id: string; url: string }[] }).results ?? []
                  for (const item of results) item.id = citeIdFor(item.url)
                  const out = formatSearch(data as never, { inlineCites: prefs.citeStyle !== 'off' })
                  setSteps(setStep(getSteps(), id, { state: 'done', sources: results.length }))
                  return results.length ? out : `${out}\nNo results matched this query. Rewrite it with different wording, fewer qualifiers, or a more specific domain, then search once more before moving on.`
                } catch (err: any) {
                  const msg = String(err?.message ?? err).slice(0, 200)
                  setSteps(setStep(getSteps(), id, { state: 'error', error: msg }))
                  // Surface an instructive tool error so the model rewrites the
                  // query instead of the call failing the whole run.
                  throw Error(`Search failed (${msg}). Rewrite the query or try another angle; do not stop the research over one failed search.`)
                }
              },
              fetch_page: async ({ url }: { url: string }) => {
                if (prefs.reader === false) throw Error('The page reader is off.')
                if (r.stopped) throw Error('Research stopped.')
                if (Date.now() > deadline) {
                  enabledTools.fetch_page = false
                  return 'Research time limit reached. No further page reads are available — close the research with your short abstract of the report you are about to write.'
                }
                if (usedReads >= tier.maxReads) {
                  enabledTools.fetch_page = false
                  return `Read budget reached (${tier.maxReads} pages for ${tier.label}). No further page reads are available — close the research with your short abstract of the report you are about to write.`
                }
                usedReads++
                stepN++
                const id = `s${stepN}`
                patchRs(chatId, mid, (rs) => withStepLead(rs, { id, kind: 'read', label: `Read ${usedReads}`, query: String(url ?? '').slice(0, 120), state: 'running' }))
                try {
                  const page = await fetchPage(String(url ?? ''), { cache: true })
                  const citeId = citeIdFor(page.url || String(url ?? ''))
                  const out = formatPage(page, { citeId })
                  setSteps(setStep(getSteps(), id, { state: 'done' }))
                  return out
                } catch (err: any) {
                  const msg = String(err?.message ?? err).slice(0, 200)
                  setSteps(setStep(getSteps(), id, { state: 'error', error: msg }))
                  throw Error(`Could not read that page (${msg}). Try another result URL; do not stop the research over one unreadable page.`)
                }
              },
            }
            if (featOn(get(), 'skills') && (p.skills ?? []).length) toolHandlers[SKILL_TOOL_NAME] = skillHandler
            const onToolDeltaCb = (calls: ToolCall[]) => { useLive.getState().set(mid, calls.map((c) => ({ ...c }))) }
            // One page read at a time; searches in small parallel batches.
            const execTools = { serialize: ['fetch_page'], maxParallel: 3 }
            // Run the loop seeded from the evidence gathered so far. onRound
            // snapshots the accumulated rounds, so a retry (or the min-evidence
            // nudge below) continues the transcript instead of restarting it.
            const ctl = new AbortController()
            r.ctl = ctl
            const runLoop = (seedText: string, tail: Msg[], maxRounds: number) => {
              const roundBase = liveRounds
              return runToolLoop(e, system, () => wireRounds(e, liveRounds, seedText, tail), enabledTools, note, ctl, o, onReasoning, (rounds) => {
                liveRounds = [...roundBase, ...rounds]
                edit(chatId, mid, (m) => ({ ...m, toolRounds: [...liveRounds] }))
              }, maxRounds, toolHandlers, onToolDeltaCb, execTools)
            }
            let x: Awaited<ReturnType<typeof runToolLoop>>
            // The search phase can take more than one loop pass (a retried
            // attempt or the evidence-floor nudge below), so the token/cost
            // totals are accumulated rather than overwritten.
            const loopTok = { tin: 0, tout: 0, cost: 0, cacheRead: 0, cacheWrite: 0 }
            const addLoop = (r0: Awaited<ReturnType<typeof runToolLoop>>) => {
              loopTok.tin += r0.tin; loopTok.tout += r0.tout; loopTok.cost += (r0 as any).cost ?? 0
              loopTok.cacheRead += (r0 as any).cacheRead ?? 0; loopTok.cacheWrite += (r0 as any).cacheWrite ?? 0
            }
            try {
              x = await runLoop('', [], Math.max(4, tier.maxRounds - liveRounds.length))
              addLoop(x)
            } catch (err) {
              // A tool-round limit with no text-only round yet: give the model
              // one final tool-free round so an abstract is always produced.
              if (r.stopped || (getErrorCode(err) ?? errCodeOf(err)) !== 'tool_limit') throw err
              x = await runToolLoop(e, `${system}\n\n${RESEARCH_ABSTRACT_ASK}`, () => wireRounds(e, liveRounds), {}, note, ctl, o, () => {}, () => {}, 1)
              addLoop(x)
            }
            // Evidence floor: never let a single search become a "deep research"
            // report. Nudge the model once to keep researching, unless the budget
            // or the run's time is already spent.
            if (!r.stopped && usedSearches < RESEARCH_MIN_SEARCHES && usedSearches < tier.maxSearches && Date.now() <= deadline) {
              try {
                x = await runLoop(x.text, [{ id: `${mid}-min`, r: 'user' as const, t: researchMinAsk(usedSearches, RESEARCH_MIN_SEARCHES) }], Math.min(6, Math.max(1, tier.maxRounds - liveRounds.length)))
                addLoop(x)
              } catch { /* the nudge is best-effort; keep the abstract we already have */ }
            }
            // The model closes the search phase with a short abstract. That is
            // the report card's sample text; the report itself is written next
            // and streams into the side panel.
            const closing = researchAbstract(x)
            bump(loopTok.tin, loopTok.tout); addCost(e, e.model, loopTok.tin, loopTok.tout, loopTok.cost, loopTok)
            tin = loopTok.tin; tout = loopTok.tout; cacheRead = loopTok.cacheRead; cacheWrite = loopTok.cacheWrite; usageCost = loopTok.cost
            const ready = looksLikeReport(closing)
            patchRs(chatId, mid, (rs) => ({ ...rs, note: '', status: 'writing', summary: ready ? reportSample(closing) : closing }))
            set({ researchPanel: { mid } })
            // Write the report, falling back to the other candidate endpoints
            // if the chosen one dies at the report pass: the evidence is
            // already gathered, so the run's value is never lost to one drop.
            const cands = [e, ...order.filter((o2) => o2.id !== e.id || o2.model !== e.model)]
            const streamReport = async (cand: Ep, assistantText: string, ask: string) => {
              const effRaw = get().effort[cand.model] ?? ''
              const oo = { ...(get().params.def ? {} : { max: get().params.max, temp: get().params.temp, topp: get().params.topp }), effort: effRaw === 'auto' ? '' : effRaw }
              return runToolLoop(cand, system, () => wireRounds(cand, liveRounds, assistantText, [{ id: `${mid}-report`, r: 'user' as const, t: ask }]), {}, (t) => { report += t; edit(chatId, mid, (m) => ({ ...m, t: report, toolFinal: report })) }, r.ctl ?? new AbortController(), oo, () => {}, () => {}, 1)
            }
            const writeReport = async (ask: string, assistantText: string) => {
              let lastErr: unknown = null
              for (const cand of cands) {
                if (r.stopped) return
                report = ''
                edit(chatId, mid, (m) => ({ ...m, t: '', toolFinal: '' }))
                try {
                  const y = await streamReport(cand, assistantText, ask)
                  bump(y.tin, y.tout); addCost(cand, cand.model, y.tin, y.tout, (y as any).cost ?? 0, y)
                  tin += y.tin; tout += y.tout; cacheRead += (y as any).cacheRead ?? 0; cacheWrite += (y as any).cacheWrite ?? 0; usageCost += (y as any).cost ?? 0
                  if (report.trim()) return
                  lastErr = Error('The model returned no report text.')
                } catch (err) {
                  lastErr = err
                  if (r.stopped) return
                  log.push({ n: cand.name, m: cand.model, err: errText(cand, (err as Error)?.message), errCode: getErrorCode(err) ?? errCodeOf(err), at: Date.now() })
                }
              }
              if (lastErr) throw lastErr
            }
            if (ready) {
              // The model wrote the whole report instead of an abstract: keep it
              // rather than paying for a second pass over the same text.
              report = closing
              edit(chatId, mid, (m) => ({ ...m, t: report, toolFinal: report }))
            } else {
              await writeReport(RESEARCH_REPORT_ASK, closing)
            }
            let txtCandidate = report.trim()
            if (!txtCandidate) throw Error('The model returned no report text.')
            // Citation integrity: repair ids the model invented, then drop any
            // that still do not match a real source so the report never links
            // to nothing. Both passes are best-effort and never fail the run.
            const srcList = collectMessageSources(liveRounds)
            const validIds = srcList.map((s) => s.citeId)
            try {
              let cov = citationCoverage(txtCandidate, srcList)
              if (cov.unknown.length && !r.stopped) {
                await writeReport(citationRepairAsk(cov.unknown, validIds), txtCandidate)
                if (report.trim()) { txtCandidate = report.trim(); cov = citationCoverage(txtCandidate, srcList) }
              }
              // A report that makes claims but cites nothing is repaired too, so
              // the sources the run paid for actually reach the reader.
              if (cov.uncited && validIds.length && !r.stopped) {
                await writeReport(citationUncitedAsk(validIds), txtCandidate)
                if (report.trim()) txtCandidate = report.trim()
                log.push({ n: 'Citations', m: '', detail: `Repaired a report that cited no sources (${validIds.length} available).`, ms: 0, at: Date.now() })
              }
            } catch { /* repair is best-effort */ }
            const sane = sanitizeCitations(txtCandidate, validIds)
            if (sane.removed.length) {
              txtCandidate = sane.text.trim() || txtCandidate
              log.push({ n: 'Citations', m: '', detail: `Removed ${sane.removed.length} citation(s) with no matching source: ${sane.removed.join(', ')}.`, ms: 0, at: Date.now() })
            }
            txt = txtCandidate.trim()
            if (!txt) throw Error('The model returned no report text.')
            log.push({ n: e.name, m: e.model, detail: `Deep research (${tier.label}) on “${query.slice(0, 80)}”: ${usedSearches} searches, ${usedReads} reads`, ms: Date.now() - t0, tin, tout, cacheRead, cacheWrite, cost: usageCost, at: Date.now() })
            edit(chatId, mid, (m) => ({ ...m, t: txt, toolRounds: liveRounds.length ? liveRounds : x.rounds, toolFinal: txt, sys: system, log, research: m.research ? { ...m.research, status: 'done', finishedAt: Date.now() } : m.research }))
            celebrate(get().prefs.cues === true)
            ok = true
            break
          } catch (x: any) {
            if (r.stopped) break
            log.push({ n: e.name, m: e.model, err: errText(e, (x as Error)?.message), errCode: getErrorCode(x) ?? errCodeOf(x), at: Date.now() })
            if (p.ex) break
          }
        }
        if (!ok && !r.stopped) {
          patchRs(chatId, mid, (rs) => ({ ...rs, status: 'error', error: 'No model responded.', finishedAt: Date.now() }))
          edit(chatId, mid, (m) => ({ ...m, sys: system, log, err: !m.t, by: m.by || 'No model responded', t: m.t || log.filter((x) => x.err).map((x) => `${x.n}${x.m ? ' · ' + x.m : ''}: ${x.err}`).join('\n') }))
        }
        useLive.getState().clear(mid)
        if (cur === r) { cur = null; set({ busy: false }) }
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
              const ce = recallClassifierOf(memoryState)
              if (ce) try {
                const classifier = ce
                const classifierPrompt = `Select relevant stored memories. Return strict JSON only: {"memory_ids":["id"]}. Use only supplied ids. ${mp.recall === 'contextual' ? 'Include somewhat relevant memories.' : 'Include only memories directly applicable to the request.'}`
                const classifierInput = { question: um.full ?? um.t, memories: selectedMemories.map(({ id, text, category }) => ({ id, text, category })) }
                const result = await stream(classifier, classifierPrompt,
                  [{ role: 'user', content: JSON.stringify(classifierInput) }], () => {}, new AbortController(), { cap: 300, effort: lowestEffortOf(classifier) })
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
          if (FP.playlists && p.pl && order.length > 1 && playlistClassifierOf(get(), p.pl)) order = await route(p.pl, order, um.full ?? um.t, log, r)
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
          /* Endpoint queue, not a plain iteration: a transient failure puts
             the same endpoint back at the head once (automatic retry) before
             the next candidate is tried. */
          const queue: Ep[] = [...order]
          const attempts = new Map<string, number>()
          const effortCache = new Map<string, string>()
          while (queue.length) {
            const e = queue.shift()!
            if (r.stopped) break
            const attemptNo = (attempts.get(e.id) ?? 0) + 1
            attempts.set(e.id, attemptNo)
            let txt = ''
            const t0 = Date.now(), q = get().params
            // Effort is classified once per model: a retry must not re-bill
            // the helper classification call.
            let effort = effortCache.get(e.model) ?? get().effort[e.model] ?? ''
            if (effort === 'auto') {
              const levels = e.modelEfforts?.[e.model] ?? []
              const picked = await classifyEffort(um.full ?? um.t, levels)
              if (picked.level) {
                effort = picked.level
                bump(picked.tin, picked.tout)
                const ce = effortClassifierOf(get())
                if (ce) addCost(ce, ce.model, picked.tin, picked.tout, (picked as any).cost ?? 0, picked)
                log.push({ n: `${picked.by} (effort)`, m: picked.level, detail: `Auto effort for ${e.model}: chose ${picked.level} from ${levels.length} available levels (${levels.join(', ')}).`, ms: 0, tin: picked.tin, tout: picked.tout, cacheRead: (picked as any).cacheRead ?? 0, cacheWrite: (picked as any).cacheWrite ?? 0, cost: (picked as any).cost ?? 0, at: Date.now() })
              } else {
                effort = ''
                log.push({ n: 'Effort (auto)', m: '', err: `Auto effort failed validation or no helper model is usable for ${e.model}; using the default level.`, at: Date.now() })
              }
            }
            effortCache.set(e.model, effort)
            edit(id, mid, (m) => ({ ...m, by: `${e.name} · ${e.model}`, t: '' }))
            // A failed attempt leaves its streamed chunks behind; clear them so
            // the live preview cannot show text the committed reply does not.
            useLive.getState().clear(mid)
            const toolRounds: { text: string; calls: ToolResult[] }[] = []
            let responseTokensIn = 0, responseTokensOut = 0
            // Generation-speed accounting: runToolLoop reports the total time
            // spent inside stream() across every round, so intermediate
            // tool-call rounds count toward tokens/s while local tool
            // execution (which runs outside stream()) is excluded.
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
                txt += t
                edit(id, mid, (m) => ({ ...m, t: txt }))
                useLive.getState().pushChunk(mid, t)
              }, r.ctl, { ...(q.def ? {} : { max: q.max, temp: q.temp, topp: q.topp }), effort }, (summary) => {
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
                search: async ({ query, count }: { query: string; count?: number }) => {
                  const prefs = normSearch(get().search)
                  if (typeof query !== 'string') throw Error('query must be a string')
                  return formatSearch(await searchWeb(query, { ...searchOptsOf(prefs), count: searchCountOf(prefs, count) }), { inlineCites: prefs.citeStyle !== 'off' })
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
                if (action !== 'delete') workspaceWritesPending = true
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
              log.push({ n: e.name, m: e.model, detail: `Answered ${p.tgt} with ${(um.att ?? []).length} attachments and ${(() => { const g = get(); return featOn(g, 'tools') ? Object.values(g.tools).filter(Boolean).length : 0 })()} enabled tools`, ms: Math.max(0, elapsed - toolElapsed), tin: responseTokensIn, tout: responseTokensOut, cacheRead: (x as any).cacheRead ?? 0, cacheWrite: (x as any).cacheWrite ?? 0, cost: (x as any).cost ?? 0, at: Date.now() })
              const sum = (um.historyTokens ?? 0) + (um.explicitTokens ?? 0), explicit = sum ? Math.round(x.tin * (um.explicitTokens ?? 0) / sum) : 0
              bump(responseTokensIn, responseTokensOut, responseTokensIn - explicit, explicit); ok = true
              track(e, Date.now() - t0, false)
              addCost(e, e.model, responseTokensIn, responseTokensOut, (x as any).cost ?? 0, x)
              // Tokens/sec over generated output tokens (including tokens written
              // across tool rounds), measured over total LLM streaming time
              // across all rounds. Local tool execution runs outside stream()
              // so it is excluded by construction.
              const rawStreamMs = (x as { streamMs?: number }).streamMs ?? 0
              const genMs = rawStreamMs > 0 ? rawStreamMs : Math.max(0, elapsed - toolElapsed)
              // Extract workspace IDs from tool rounds (check both arguments and result)
              const workspaceIds = [...new Set(toolRounds.flatMap((r) => r.calls).filter((c) => c.name === 'workspace_upsert').map((c) => {
                // First check arguments
                try { const args = JSON.parse(c.arguments || '{}'); if (args.workspaceId) return args.workspaceId } catch {}
                // Then check result (for newly created workspaces)
                try { const res = JSON.parse(c.result || '{}'); if (res.workspaceId) return res.workspaceId } catch {}
                return null
              }).filter(Boolean))]
              edit(id, mid, (m) => ({ ...m, tps: Math.round(responseTokensOut / Math.max(genMs / 1000, 0.001) * 10) / 10, toolRounds, ...(toolRounds.length ? { toolFinal: x.text } : {}), ...(x.finish === 'length' || x.finish === 'max_tokens' ? { trunc: true } : {}), workspaceIds }))
              usedEp = e
              break
            } catch (x: any) {
              if (r.stopped) break
              const elapsed = Date.now() - t0
              track(e, elapsed, true)
              const code = getErrorCode(x) ?? errCodeOf(x)
              const toolElapsed = toolRounds.reduce((total, round) => total + Math.max(0, ...round.calls.map((call) => call.ms ?? 0)), 0)
              log.push({ n: e.name, m: e.model, ms: Math.max(0, elapsed - toolElapsed), err: errText(e, x.message), errCode: code, at: Date.now() })
              // The tool-round cap is not a model failure: keep whatever the
              // model already wrote and flag the message, instead of replacing
              // the partial reply with an error card.
              if (code === 'tool_limit' && txt.trim()) {
                const capped = txt.trimEnd()
                edit(id, mid, (m) => ({ ...m, t: capped, capped: true }))
                ok = true
                break
              }
              // One automatic retry for transient failures before the next
              // candidate endpoint is tried.
              if (attemptNo === 1 && isRetryableFailure(x, code)) {
                log.push({ n: `${e.name} (retry)`, m: e.model, detail: `Transient failure — ${errText(e, x.message)} Retrying this endpoint once.`, at: Date.now() })
                await new Promise((run) => setTimeout(run, RETRY_DELAY_MS))
                if (r.stopped) break
                queue.unshift(e)
                continue
              }
              if (p.ex) break
            }
          }
        } catch (x: any) { log.push({ n: 'engine', m: '', err: String(x?.message ?? x), errCode: getErrorCode(x) ?? errCodeOf(x) }) }
        useLive.getState().clear(mid)
        if (r.stopped && !ok) {
          // A cancelled reply is discarded, never stored: drop the in-progress
          // assistant message entirely. For a regeneration, fall back to the
          // previous alternative so the earlier answer is not lost.
          const last = prev?.[prev.length - 1]
          if (last) edit(id, mid, (m) => ({ ...m, ...last, alts: prev, ai: prev!.length - 1 }))
          else set((st) => ({ chats: st.chats.map((c) => (c.id === id ? { ...c, msgs: c.msgs.filter((m) => m.id !== mid) } : c)) }))
        } else {
          edit(id, mid, (m) => ok ? { ...m, sys: system, log }
            : { ...m, sys: system, log, err: true, by: 'No model responded', t: log.filter((x) => x.err).map((x) => `${x.n}${x.m ? ' · ' + x.m : ''}: ${x.err}`).join('\n') + hint(log) })
          if (prev) edit(id, mid, (m) => ({ ...m, alts: [...prev, snap(m)], ai: prev.length }))
        }
        // Workspace cue: only for a reply that wrote a workspace and finished without an error.
        const workspaceTouched = workspaceWritesPending
        workspaceWritesPending = false
        if (ok && !r.stopped && workspaceTouched) celebrate(get().prefs.cues === true)
        if (cur === r) { cur = null; set({ busy: false }) }
        // Sync push is handled by the background runtime (storage/syncRuntime).
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
        chats: [], chat: '', drafts: {}, memories: [], memoryPrefs: { enabled: false, intent: 'balanced', recall: 'contextual', method: 'local', classifierEp: '', classifierModel: '' }, docPrefs: { ...BLANK_DOCS }, research: { ...BLANK_RESEARCH }, tools: { ...DEFAULT_TOOLS }, search: { ...BLANK_SEARCH, keys: { ...BLANK_SEARCH.keys } }, skills: DEFAULT_SKILL_STATE.map((s) => ({ ...s })), widgets: {}, widgetPrefs: { ...DEFAULT_WIDGET_PREFS, widgetOrder: [...DEFAULT_WIDGET_PREFS.widgetOrder], shortcuts: [...DEFAULT_WIDGET_PREFS.shortcuts] }, rail: false, pad: '', snips: [],
        params: { ...DEFAULT_PARAMS }, effort: {},
        workspacePrefs: { defaultView: 'latest', autoOpen: true, autoFollow: true },
        advanced: { ...DEFAULT_ADVANCED },
        sel: null, pr: 'general', globalPrompt: { on: false, text: '' }, features: { ...DEFAULT_FEATURES }, featureOrder: FEATURES.map(([id]) => id), libraryShow: { ...DEFAULT_LIBRARY_SHOW }, themeMode: 'dark', themeDark: 'plum', themeLight: 'paper', customDarkColors: { ...DEFAULT_CUSTOM_COLORS }, customLightColors: { ...DEFAULT_CUSTOM_LIGHT_COLORS }, setupDone: false, prefs: { ...DEFAULT_PREFS },
        stats: ZERO(), keys: Object.fromEntries(KEYS.map(([k, , d]) => [k, d])),
        folders: [], price: { in: 0, out: 0 }, todos: [],
        routeStats: {}, flashMsg: null,
        draft: '', busy: false, notice: null,
        /* Workspace (first-class entity) */
        workspaces: {}, selectedRevision: {},            researchPanel: null,

        patch: (p) => {
          // Search responses are cached per provider + zone + limits: tuning
          // changes must drop the cache so the next search re-fetches instead
          // of replaying results fetched under the old settings.
          if (p && typeof p === 'object' && 'search' in p) clearSessionCache()
          set(p)
        },
        add: (k) => set((s) => ({ [k]: [...(s[k] as any[]), BLANK[k]()] }) as Partial<S>),
        upd: (k, id, p) => set((s) => ({ [k]: (s[k] as any[]).map((x) => (x.id === id ? { ...x, ...p } : x)) }) as Partial<S>),
        del: (k, id) => set((s) => {
          const n: any = { [k]: (s[k] as any[]).filter((x) => x.id !== id) }
          if (k === 'eps') {
            n.pls = s.pls.map((p) => ({ ...p, e: p.e.filter((x) => splitEntry(x)[0] !== id), cls: p.cls === id ? '' : p.cls, clsModel: p.cls === id ? '' : p.clsModel }))
            if (s.prefs.titleEp === id) n.prefs = { ...s.prefs, titleEp: '', titleModel: '' }
            if (s.prefs.effortEp === id) n.prefs = { ...(n.prefs ?? s.prefs), effortEp: '', effortModel: '' }
            if (s.prefs.recallEp === id) n.prefs = { ...(n.prefs ?? s.prefs), recallEp: '', recallModel: '' }
            if (s.memoryPrefs.classifierEp === id) n.memoryPrefs = { ...s.memoryPrefs, classifierEp: '', classifierModel: '' }
          }
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
          if (c && !c.msgs.length && !!c.temporary === !!temporary) return { notice: null }
          const n: Chat = { id: uid(), title: temporary ? 'Temporary chat' : 'New chat', msgs: [], temporary, expiresAt: temporary && s.prefs.tempHours > 0 ? Date.now() + s.prefs.tempHours * 3600000 : undefined }
          return { chats: [n, ...s.chats.filter((x) => !(x.temporary && s.prefs.tempHours === 0))], chat: n.id, notice: null }
        }),
        chatOp: (id, op) => {
          if (op === 'del') {
            const gone = get().chats.find((c) => c.id === id)
            if (gone?.msgs.length) void import('./storage/boot').then(({ dropAttachmentBytes }) => dropAttachmentBytes(gone.msgs).catch(() => {})).catch(() => {})
          }
          set((s) => {
            const chats = op === 'del' ? s.chats.filter((c) => c.id !== id) : s.chats.map((c) => (c.id === id ? { ...c, pin: !c.pin } : c))
            // Drop the deleted chat's stashed draft along with the chat.
            const drafts = { ...s.drafts }
            if (op === 'del') delete drafts[id]
            return { chats, chat: s.chat === id && op === 'del' ? chats[0]?.id ?? '' : s.chat, drafts }
          })
        },

        send: async (v, att) => {
          if (sendPause) return false
          const s = get()
          if (s.busy) return false
          const raw = v.trim()
          if (!raw && !att.length) return false
          const researchReq = parseResearchRequest(raw)
          if (researchReq && !att.length) {
            const pre = plan(s, { id: 'tmp', r: 'user', t: raw } as Msg)
            if (pre.err) return warn(pre.err)
            const um: Msg = { id: uid(), r: 'user', t: raw, at: Date.now(), att, full: raw }
            um.historyTokens = 0
            um.explicitTokens = est(raw)
            const mid = uid()
            const rq: ResearchState = { id: uid(), query: researchReq.query, tier: null, status: 'tier-pick', steps: [], startedAt: Date.now() }
            set((st) => {
              const old = st.chats.find((c) => c.id === st.chat)
              const base: Chat = old ?? { id: uid(), title: 'New chat', msgs: [] }
              const next: Chat = { ...base, started: true, titleAuto: base.msgs.length ? base.titleAuto : st.prefs.autoTitle, title: base.msgs.length ? base.title : researchReq.query.slice(0, 40), msgs: [...base.msgs, um, { id: mid, r: 'assistant', t: '', at: Date.now(), by: '', log: [], research: rq }] }
              return { chat: base.id, chats: old ? st.chats.map((c) => (c.id === base.id ? next : c)) : [next, ...st.chats], notice: null }
            })
            return true
          }
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
          // The chat the user is sending from, captured before any await: the
          // OCR pass below can take seconds and the user may switch chats
          // while it runs.
          const chatId = s.chat
          // Vision OCR (Documents setting): when no usable endpoint can take
          // images natively (or OCR is set to always), transcribe images to
          // text first so plan() sees text-backed attachments.
          let files = att
          {
            const dp = normDocs((s as unknown as { docPrefs?: unknown }).docPrefs)
            const bare = att.filter((a) => a.kind === 'img' && a.data && !a.text)
            if (bare.length && dp.ocr !== 'off') {
              // `busy` is only set once the message is appended; the flag
              // keeps a second send from slipping through this await window.
              sendPause = true
              try {
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
              } finally { sendPause = false }
            }
          }
          // Re-read after the awaited OCR pass: plan and append against the
          // chat the message was sent from, not whichever one is open now.
          const s2 = get()
          const pre = plan(s2, um)
          if (pre.err) return warn(pre.err)
          // Attachment bytes are only worth writing once the message is really
          // going to be stored (a failed plan must not leave orphan blobs).
          void import('./storage/boot').then(({ persistAttachmentBytes }) => persistAttachmentBytes(um.id, files).catch(() => {})).catch(() => {})
          um.ctx = []
          // Every attachment with extracted text (txt, PDF text layer, Office
          // docs, transcripts, OCR) rides inline; native binaries (images on
          // vision endpoints, PDFs on Anthropic) ride alongside in wire().
          um.fx = files.filter((a) => a.text).map((a) => `\n\n[file: ${a.name}]\n${a.text ?? ''}`).join('')
          um.full = full(body(cmd, text), um.ctx, um.fx)
          const previous = s2.chats.find((c) => c.id === chatId)?.msgs ?? []
          const cpt = Math.min(10, Math.max(1, Number(s2.widgetPrefs?.charsPerToken) || 4))
          um.historyTokens = estimateHistoryTokens(previous, '', cpt)
          um.explicitTokens = est(um.full + JSON.stringify(files.map(a => ({ name: a.name, text: a.text }))))
          set((st) => {
            const old = st.chats.find((c) => c.id === chatId)
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
          // A resent message that was a @research request re-enters the
          // research flow (tier pick) instead of a plain reply.
          const rreq = parseResearchRequest(um.t ?? '')
          if (rreq && !um.att?.length) {
            startResearchTierPick(c.id, c.msgs.slice(0, i + 1), rreq.query)
            return
          }
          void answer(um, prev)
        },
        delMsg: (id) => {
          const gone = get().chats.flatMap((c) => c.msgs).find((m) => m.id === id)
          if (gone?.att?.length) void import('./storage/boot').then(({ dropAttachmentBytes }) => dropAttachmentBytes([gone]).catch(() => {})).catch(() => {})
          set((s) => ({ chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.filter((m) => m.id !== id) })) }))
        },
        chooseResearchTier: (mid, tier) => {
          const s = get()
          if (s.busy) return
          const c = s.chats.find((x) => x.id === s.chat)
          if (!c) return
          const i = c.msgs.findIndex((m) => m.id === mid)
          if (i < 0) return
          const msg = c.msgs[i]
          if (!msg.research || msg.research.status !== 'tier-pick') return
          const um = [...c.msgs.slice(0, i)].reverse().find((m) => m.r === 'user')
          if (!um) return
          set((st) => ({
            chats: st.chats.map((x) => (x.id === c.id ? { ...x, msgs: x.msgs.map((m) => (m.id === mid && m.research ? { ...m, research: { ...m.research, tier } } : m)) } : x)),
            research: { ...st.research, defaultTier: tier },
          }))
          void planResearch(mid, um, msg.research.query, tier)
        },
        startResearch: (mid) => {
          const s = get()
          if (s.busy) return
          const c = s.chats.find((x) => x.id === s.chat)
          if (!c) return
          const i = c.msgs.findIndex((m) => m.id === mid)
          if (i < 0) return
          const msg = c.msgs[i]
          if (!msg.research || msg.research.status !== 'plan') return
          const um = [...c.msgs.slice(0, i)].reverse().find((m) => m.r === 'user')
          if (!um) return
          void runResearch(mid, um, msg.research.query, msg.research.tier ?? s.research.defaultTier)
        },
        resumeResearch: (mid) => {
          const s = get()
          if (s.busy) return
          const c = s.chats.find((x) => x.msgs.some((m) => m.id === mid))
          if (!c) return
          const msg = c.msgs.find((m) => m.id === mid)
          if (!msg?.research || msg.research.status !== 'stopped') return
          const i = c.msgs.findIndex((m) => m.id === mid)
          const um = [...c.msgs.slice(0, i)].reverse().find((m) => m.r === 'user')
          if (!um) return
          const used = msg.research.steps.filter((st) => st.kind === 'search').length
          const tier = tierOf(msg.research.tier ?? s.research.defaultTier)
          if (used >= tier.maxSearches) return
          void runResearch(mid, um, msg.research.query, tier.id, true)
        },
        updateResearchPlan: (mid, plan) => set((s) => ({
          chats: s.chats.map((c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === mid && m.research ? { ...m, research: { ...m.research, plan } } : m)) })),
        })),
        stopResearch: (mid) => {
          const s = get()
          const c = s.chats.find((x) => x.msgs.some((m) => m.id === mid))
          if (!c) return
          if (cur) { cur.stopped = true; cur.ctl?.abort() }
          set((st) => ({
            busy: false,
            chats: st.chats.map((x) => (x.id === c.id ? { ...x, msgs: x.msgs.map((m) => (m.id === mid && m.research && (m.research.status === 'running' || m.research.status === 'writing' || m.research.status === 'tier-pick' || m.research.status === 'planning' || m.research.status === 'plan') ? { ...m, research: { ...m.research, status: 'stopped', finishedAt: Date.now() } } : m)) } : x)),
          }))
        },
        editMsg: (id, t) => {
          const s = get(), c = s.chats.find((x) => x.id === s.chat), i = c ? c.msgs.findIndex((m) => m.id === id) : -1
          if (!c || i < 0) return false
          if (s.busy) { set({ notice: { t: 'A reply is still in progress. Stop it first, then edit your message.' } }); return false }
          const o = c.msgs[i]
          if (!t.trim() && !o.att?.length) return false
          const m = t.match(/^\/(\S+)(?:\s+([\s\S]*))?$/), cmd = m && featOn(s, 'commands') ? s.cmds.find((x) => x.name === m[1]) : (!m && featOn(s, 'commands') ? s.cmds.find((x) => x.id === o.cmd) : undefined)
          const um: Msg = { ...o, t: t.trim(), cmd: cmd?.id, full: full(body(cmd, m && cmd ? (m[2] ?? '').trim() : t.trim()), o.ctx, o.fx) }
          { const pre = plan(s, um); if (pre.err) { set({ notice: pre.err }); return false } }
          set((st) => ({ chats: st.chats.map((x) => (x.id === c.id ? { ...x, msgs: [...c.msgs.slice(0, i), um] } : x)), stats: featOn(st, 'stats') ? { ...st.stats, sent: st.stats.sent + 1 } : st.stats } ))
          // Editing a message into a @research request re-enters the research
          // flow (tier pick) instead of a plain reply.
          const rreq = parseResearchRequest(um.t ?? '')
          if (rreq && !o.att?.length) {
            startResearchTierPick(c.id, [...c.msgs.slice(0, i), um], rreq.query)
            return true
          }
          void answer(um)
          return true
        },
        resetStats: () => set({ stats: ZERO() }),
        compactStorage: () => {
          const s = get(), now = Date.now()
          const before = JSON.stringify({ chats: s.chats, workspaces: s.workspaces }).length
          const chats = s.chats
            .filter((c) => !(c.temporary && c.expiresAt != null && c.expiresAt <= now))
            .map((c) => {
              const lastAi = [...c.msgs].reverse().find((m) => m.r === 'assistant' && m.reasoning)?.id
              return { ...c, msgs: c.msgs.map((m) => ({ ...m, reasoning: m.id === lastAi ? m.reasoning : undefined })) }
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
      name: 'byok.v1', version: STORE_VERSION, storage: persistStorage,
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
          const normDark = normThemeKeyOf(p.themeDark, true)
          const normLight = normThemeKeyOf(p.themeLight, false)
          p.themeDark = (normDark ?? 'plum') as any
          p.themeLight = (normLight ?? 'paper') as any
          const oldKey = normThemeKeyOf(old, (p.themeMode ?? 'dark') !== 'light')
          if (oldKey && oldKey !== 'custom') { p.themeMode = 'dark' as any; p.themeDark = oldKey as any }
          else if (oldKey === 'custom' || old === 'custom') p.themeDark = 'custom'
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
          return { ...e, ...(preset ? { preset } : {}), name: oldGoogle && e.name === 'Gemini' ? 'Google' : e.name, endpointId, endpointFilter: e.endpointFilter ?? (preset ? PRE[preset]?.[3] : undefined), model: strip(e.model), models: e.models?.map(strip), modelNames: remap(e.modelNames), modelContext: remap(e.modelContext), modelProviders: remap(e.modelProviders), modelEfforts: remap(e.modelEfforts), modelEffortSource: remap(e.modelEffortSource), prices: remap(e.prices) }
        })
        if (p.effort) p.effort = Object.fromEntries(Object.entries(p.effort).map(([id, value]: [string, any]) => [id, value === 'auto' ? 'auto' : typeof value === 'number' ? (value <= 0 ? '' : value < 34 ? 'low' : value < 68 ? 'medium' : 'high') : value]).filter(([, value]) => value && String(value).toLowerCase() !== 'off'))
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
        p.prefs = { ...p.prefs, tempHours: p.prefs?.tempHours ?? 3, fontBody: p.prefs?.fontBody ?? 'system', fontMono: p.prefs?.fontMono ?? 'system', fontHeader: p.prefs?.fontHeader ?? 'system', modelPrimary: p.prefs?.modelPrimary ?? ({ none: 'id', name: 'name', provider: 'id', both: 'name' } as const)[(p.prefs?.modelDisplay as string) ?? 'both'] ?? 'name', modelSecondary: p.prefs?.modelSecondary ?? ({ none: 'none', name: 'none', provider: 'provider', both: 'provider' } as const)[(p.prefs?.modelDisplay as string) ?? 'both'] ?? 'none', paletteMax: p.prefs?.paletteMax ?? 320, chatWidth: p.prefs?.chatWidth ?? 'standard', settingsWidth: p.prefs?.settingsWidth ?? 1024, settingsHeight: p.prefs?.settingsHeight ?? 780, modelPickerHeight: p.prefs?.modelPickerHeight ?? 480, showModelPricing: p.prefs?.showModelPricing ?? false, showContextMeter: p.prefs?.showContextMeter ?? true, titleEp: p.prefs?.titleEp ?? '', titleModel: p.prefs?.titleModel ?? '', effortEp: p.prefs?.effortEp ?? '', effortModel: p.prefs?.effortModel ?? '', recallEp: p.prefs?.recallEp ?? '', recallModel: p.prefs?.recallModel ?? '', routingMode: ['ordered', 'fastest', 'cheapest'].includes(p.prefs?.routingMode) ? p.prefs.routingMode : 'ordered', sidebarWidth: p.prefs?.sidebarWidth ?? 288, widgetWidth: p.prefs?.widgetWidth ?? 320, workspaceWidth: typeof p.prefs?.workspaceWidth === 'number' && p.prefs.workspaceWidth <= 1 ? p.prefs.workspaceWidth : 0.4, workspaceSplit: typeof p.prefs?.workspaceSplit === 'number' ? p.prefs.workspaceSplit : 0.2, modalBlur: p.prefs?.modalBlur ?? 12, settingsOpacity: p.prefs?.settingsOpacity ?? 55, temporaryByDefault: p.prefs?.temporaryByDefault ?? false, streamFade: typeof p.prefs?.streamFade === 'number' && p.prefs.streamFade >= 0 && p.prefs.streamFade <= 1 ? p.prefs.streamFade : 0.3, streamMd: p.prefs?.streamMd ?? true, glassComposer: p.prefs?.glassComposer ?? true }
        p.tools = { ...DEFAULT_TOOLS, ...(p.tools ?? {}) }
        p.search = normSearch(p.search)
        p.research = normResearch(p.research)
        p.researchPanel = null
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
        p.widgetPrefs.widgetOrder = [...new Set([...(p.widgetPrefs.widgetOrder ?? []), ...WIDGETS.map(([k]) => k)])].filter((k) => k !== 'ctx')
        p.stats = { ...ZERO(), ...p.stats }
        p.eps = (p.eps ?? []).map((e: Ep) => ({ ...e, modelsMode: e.modelsMode ?? 'separate', models: e.models?.length ? e.models : [e.model], modelNames: e.modelNames ?? {}, modelContext: e.modelContext ?? {}, modelProviders: e.modelProviders ?? {}, prices: e.prices ?? {} }))
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
      // Runs on every rehydrate (migrate only runs on version bumps): remap
      // removed theme keys and drop anything unknown so `data-t` is always valid.
      merge: (persisted, current) => {
        const p = { ...current, ...(persisted as any) }
        const dk = normThemeKeyOf(p.themeDark, true)
        const lk = normThemeKeyOf(p.themeLight, false)
        if (dk) p.themeDark = dk as any
        if (lk) p.themeLight = lk as any
        // The word fade-in feature was removed: drop its stale persisted
        // settings and per-message events so they never carry forward.
        if (p.prefs && typeof p.prefs === 'object' && 'fade' in p.prefs) delete p.prefs.fade
        // A run cannot survive a reload, so reap any research card that was
        // mid-flight when the tab closed; otherwise it shows "researching"
        // forever. Cards waiting on the user (tier-pick / plan) are kept.
        if (Array.isArray(p.chats)) p.chats = p.chats.map((c: any) => Array.isArray(c?.msgs) ? {
          ...c,
          msgs: c.msgs.map((m: any) => {
            const st = m?.research?.status
            const next = st === 'running' || st === 'writing' || st === 'planning'
              ? { ...m, research: { ...m.research, status: 'stopped', finishedAt: m.research.finishedAt ?? Date.now() } }
              : m
            if (next && typeof next === 'object' && 'fadeEvents' in next) {
              const copy = { ...next }
              delete copy.fadeEvents
              return copy
            }
            return next
          }),
        } : c)
        return p as S
      },
      partialize: (s) => ({
        ...s, busy: false, draft: '', drafts: {}, notice: null, flashMsg: null,
        // Per-chat memoized: only the chat that changed is re-mapped.
        chats: mapPersistChats(withoutExpiredTemps(s.chats)),
      }),
    },
  ),
)

/* Live fields that change while a reply streams (or while the user types).
 * Panels that do not render live chat text subscribe through `useSConfig`
 * instead of `useS()`: the slice stays reference-equal for every streamed
 * chunk, so they are off the streaming render path entirely. Components that
 * need any of these fields must use their own selector. */
export const useSConfig = () => useS(useShallow((s) => {
  const { chats, drafts, busy, draft, notice, flashMsg, ...config } = s
  void chats; void drafts; void busy; void draft; void notice; void flashMsg
  return config
}))
