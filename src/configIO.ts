/* Pure config import/export helpers (no React, no store). UI stays in Extra.tsx. */

export type ExportCategory =
  | 'eps' | 'prompts' | 'pls' | 'cmds' | 'skills' | 'memory' | 'keys'
  | 'appearance' | 'features' | 'tools' | 'tuning' | 'widgets' | 'stats' | 'chats'

/** Which categories are present in an imported JSON blob. */
export function detectAvailableCategories(j: Record<string, unknown>, themes: Record<string, unknown>): Record<ExportCategory, boolean> {
  const o = (v: unknown) => !!v && typeof v === 'object'
  return {
    eps: Array.isArray(j.eps) || o(j.sel),
    prompts: Array.isArray(j.prompts) || typeof j.pr === 'string' || o(j.globalPrompt),
    pls: Array.isArray(j.pls),
    cmds: Array.isArray(j.cmds),
    skills: Array.isArray(j.skills),
    memory: Array.isArray(j.memories) || o(j.memoryPrefs),
    keys: o(j.keys),
    appearance: (typeof j.themeMode === 'string' && (j.themeMode === 'dark' || j.themeMode === 'light'))
      || (typeof j.themeDark === 'string' && (j.themeDark as string) in themes)
      || (typeof j.themeLight === 'string' && (j.themeLight as string) in themes)
      || o(j.customDarkColors) || o(j.customLightColors)
      || (typeof j.theme === 'string' && (j.theme as string) in themes) || o(j.customColors) || o(j.prefs),
    features: o(j.features) || Array.isArray(j.featureOrder) || o(j.libraryShow) || o(j.advanced),
    tools: o(j.tools) || o(j.search),
    tuning: o(j.params) || o(j.effort) || o(j.workspacePrefs),
    widgets: o(j.widgets) || o(j.widgetPrefs),
    stats: o(j.stats),
    chats: Array.isArray(j.chats) || Array.isArray(j.todos) || Array.isArray(j.snips) || typeof j.pad === 'string',
  }
}

type ExportState = {
  themeMode: unknown; themeDark: unknown; themeLight: unknown
  customDarkColors: unknown; customLightColors: unknown; prefs: unknown
  keys: unknown; eps: { key: string }[] & Array<Record<string, unknown>>; sel: unknown
  prompts: unknown; pr: unknown; globalPrompt: unknown
  pls: unknown; cmds: unknown; skills: unknown
  memories: unknown; memoryPrefs: unknown
  features: unknown; featureOrder: unknown; libraryShow: unknown; advanced: unknown
  tools: unknown; search: { keys: Record<string, string> }
  params: unknown; effort: unknown; workspacePrefs: unknown
  widgets: unknown; widgetPrefs: unknown; stats: unknown
  chats: unknown; folders: unknown; chat: unknown; todos: unknown; snips: unknown; pad: unknown
}

/** Build the JSON payload for `dl('chat-config.json', …)` (pure). */
export function buildExportPayload(
  s: ExportState,
  exports: Record<ExportCategory, boolean>,
  withKeys: boolean,
  normSkills: (v: unknown) => { skills: unknown },
  normSearch: (v: unknown) => { keys: Record<string, string> } & Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = { v: 4 }
  if (exports.appearance) { data.themeMode = s.themeMode; data.themeDark = s.themeDark; data.themeLight = s.themeLight; data.customDarkColors = s.customDarkColors; data.customLightColors = s.customLightColors; data.prefs = s.prefs }
  if (exports.keys) data.keys = s.keys
  if (exports.eps) { data.eps = (s.eps as Record<string, unknown>[]).map((e) => ({ ...e, key: withKeys ? (e as { key: unknown }).key : '' })); data.sel = s.sel }
  if (exports.prompts) { data.prompts = s.prompts; data.pr = s.pr; data.globalPrompt = s.globalPrompt }
  if (exports.pls) data.pls = s.pls
  if (exports.cmds) data.cmds = s.cmds
  if (exports.skills) data.skills = normSkills(s.skills).skills
  if (exports.memory) { data.memories = s.memories; data.memoryPrefs = s.memoryPrefs }
  if (exports.features) { data.features = s.features; data.featureOrder = s.featureOrder; data.libraryShow = s.libraryShow; data.advanced = s.advanced }
  if (exports.tools) { data.tools = s.tools; const sp = normSearch(s.search); data.search = withKeys ? sp : { ...sp, keys: { tinyfish: '', you: '', exa: '', firecrawl: '', brightdata: '' } } }
  if (exports.tuning) { data.params = s.params; data.effort = s.effort; data.workspacePrefs = s.workspacePrefs }
  if (exports.widgets) { data.widgets = s.widgets; data.widgetPrefs = s.widgetPrefs }
  if (exports.stats) data.stats = s.stats
  if (exports.chats) { data.chats = s.chats; data.folders = s.folders; data.chat = s.chat; data.todos = s.todos; data.snips = s.snips; data.pad = s.pad }
  return data
}
