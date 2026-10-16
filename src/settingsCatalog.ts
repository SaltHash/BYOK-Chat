import {
  SlidersHorizontal, Server, ScrollText, Sparkles, ListMusic, Terminal,
  FolderOpen, Wrench, Brain, PanelRight, Palette as PaletteIcon, Keyboard,
  TrendingUp, Database, FlaskConical,
} from 'lucide-react'
import type { Ic } from './components/ui'

/** Single source of truth for settings navigation.
 *  Previously the tab list was hardcoded in both Settings.tsx and Palette.tsx
 *  (with Palette covering only a subset). Everything — tabs, sections, and
 *  individual settings — is declared here so the command palette can jump
 *  to any of them without hand-maintaining parallel lists.
 */
export type SettingsTabId =
  | 'features' | 'eps' | 'prompts' | 'skills' | 'pls' | 'cmds'
  | 'workspace' | 'tools' | 'memory' | 'widgets' | 'look'
  | 'keys' | 'stats' | 'data' | 'adv'

export const SETTINGS_TABS: [SettingsTabId, string, Ic][] = [
  ['features', 'Features', SlidersHorizontal],
  ['eps', 'Endpoints', Server],
  ['prompts', 'Prompts', ScrollText],
  ['skills', 'Skills', Sparkles],
  ['pls', 'Playlists', ListMusic],
  ['cmds', 'Commands', Terminal],
  ['workspace', 'Workspace', FolderOpen],
  ['tools', 'Tools', Wrench],
  ['memory', 'Memory', Brain],
  ['widgets', 'Widgets', PanelRight],
  ['look', 'Appearance', PaletteIcon],
  ['keys', 'Shortcuts', Keyboard],
  ['stats', 'Stats', TrendingUp],
  ['data', 'Data controls', Database],
  ['adv', 'Advanced', FlaskConical],
]

export const TAB_KEYWORDS: Record<SettingsTabId, string> = {
  features: 'features toggles enable disable library routing advanced',
  eps: 'endpoints models providers api keys connections model aliases base url preset credentials pricing test helper classification title effort auto recall',
  prompts: 'prompts system instructions global',
  skills: 'skills instructions custom builtin extra tasks',
  pls: 'playlists routes groups ordered fastest cheapest classifier routing performance',
  cmds: 'commands slash input template run on playlist',
  workspace: 'workspace files panel templates gist share default view auto open follow',
  tools: 'tools helpers search fetch calculator date time clipboard location workspace memory navigate prompt poll count json base64 uuid random hash execution limit documents ocr pdf office archives citations reader',
  memory: 'memory tool mode recall method classifier add stored duplicates categories',
  widgets: 'widgets panels context meter endpoint status usage scratchpad snippets cost last reply prompts shortcuts draft counter checklist',
  look: 'appearance fonts theme display layout max height width message settings model picker palette blur opacity fade retention title pricing',
  keys: 'shortcuts keybinds keyboard reset bindings',
  stats: 'stats usage tokens cost messages chats reset totals',
  data: 'data import backup privacy export erase sync encrypted history storage compact',
  adv: 'advanced debugging verbose errors additional capabilities system prompt payloads token counts',
}

export type SettingLink = {
  tab: SettingsTabId
  /** Anchor rendered as id="setting-<anchor>" inside the tab. */
  anchor: string
  title: string
  keywords: string
}

/** Every individually addressable setting/section. `cfg("tab#anchor")` opens
 *  the tab and scrolls to the anchor; unknown anchors still open the tab. */
export const SETTING_LINKS: SettingLink[] = [
  // Features — one per feature toggle.
  { tab: 'features', anchor: 'feature-prompts', title: 'Feature: Prompts', keywords: 'feature prompts toggle system' },
  { tab: 'features', anchor: 'feature-skills', title: 'Feature: Skills', keywords: 'feature skills toggle' },
  { tab: 'features', anchor: 'feature-tools', title: 'Feature: Tools', keywords: 'feature tools toggle' },
  { tab: 'features', anchor: 'feature-playlists', title: 'Feature: Playlists', keywords: 'feature playlists toggle routes' },
  { tab: 'features', anchor: 'feature-commands', title: 'Feature: Commands', keywords: 'feature commands toggle slash' },
  { tab: 'features', anchor: 'feature-stats', title: 'Feature: Stats', keywords: 'feature stats toggle totals' },
  { tab: 'features', anchor: 'feature-memory', title: 'Feature: Memory', keywords: 'feature memory toggle' },
  { tab: 'features', anchor: 'feature-widgets', title: 'Feature: Widgets', keywords: 'feature widgets toggle panel' },
  { tab: 'features', anchor: 'feature-shortcuts', title: 'Feature: Shortcuts', keywords: 'feature shortcuts toggle keyboard' },
  { tab: 'features', anchor: 'feature-library', title: 'Feature: Library', keywords: 'feature library toggle sidebar' },
  { tab: 'features', anchor: 'library-entries', title: 'Library entries', keywords: 'library sidebar shortcuts entries show' },
  { tab: 'features', anchor: 'feature-workspace', title: 'Feature: Workspace', keywords: 'feature workspace toggle files' },
  { tab: 'features', anchor: 'feature-routing', title: 'Feature: Routing', keywords: 'feature routing toggle classifier' },
  { tab: 'features', anchor: 'feature-advanced', title: 'Feature: Advanced', keywords: 'feature advanced toggle debugging' },

  // Endpoints
  { tab: 'eps', anchor: 'helper-models', title: 'Helper models', keywords: 'helper classification title effort auto detection mixed model memory recall' },
  { tab: 'eps', anchor: 'add-endpoint', title: 'Add endpoint', keywords: 'add endpoint provider connection' },
  { tab: 'eps', anchor: 'models', title: 'Endpoint models', keywords: 'models preset picker catalog model id name effort' },
  { tab: 'eps', anchor: 'model-behavior', title: 'Model behavior (playlist mode)', keywords: 'playlist separate models mode behavior' },
  { tab: 'eps', anchor: 'credentials', title: 'Endpoint API key', keywords: 'api key credentials stored browser' },
  { tab: 'eps', anchor: 'advanced-connection', title: 'Advanced connection settings', keywords: 'base url api format endpoint id openrouter brand' },
  { tab: 'eps', anchor: 'model-pricing', title: 'Model pricing', keywords: 'pricing input output cost per million detected' },
  { tab: 'eps', anchor: 'test-connection', title: 'Test endpoint connections', keywords: 'test connection reachable all endpoints' },

  // Prompts
  { tab: 'prompts', anchor: 'global-prompt', title: 'Global system prompt', keywords: 'global system prompt every message' },
  { tab: 'prompts', anchor: 'add-prompt', title: 'Add prompt', keywords: 'add prompt new reusable' },

  // Skills
  { tab: 'skills', anchor: 'add-skill', title: 'Add a custom skill', keywords: 'add skill custom id instructions when to use' },

  // Playlists
  { tab: 'pls', anchor: 'routing-mode', title: 'Playlist routing mode', keywords: 'routing ordered fastest cheapest candidate order' },
  { tab: 'pls', anchor: 'observed-performance', title: 'Observed routing performance', keywords: 'observed performance latency tries fails reset stats' },
  { tab: 'pls', anchor: 'classifier-routing', title: 'Classifier routing', keywords: 'classifier endpoint model rule json routing instructions' },
  { tab: 'pls', anchor: 'add-playlist', title: 'Add playlist', keywords: 'add playlist new list models' },

  // Commands
  { tab: 'cmds', anchor: 'add-command', title: 'Add command', keywords: 'add command slash new' },

  // Workspace
  { tab: 'workspace', anchor: 'default-view', title: 'Workspace default view', keywords: 'workspace pinned latest default view' },
  { tab: 'workspace', anchor: 'auto-open', title: 'Workspace auto-open panel', keywords: 'auto open panel writing files' },
  { tab: 'workspace', anchor: 'auto-follow', title: 'Workspace auto-follow file', keywords: 'auto follow active file' },
  { tab: 'workspace', anchor: 'templates', title: 'Project templates', keywords: 'templates static site python markdown scaffold createNew' },
  { tab: 'workspace', anchor: 'gist-sharing', title: 'GitHub Gist sharing', keywords: 'gist token share github' },

  // Tools
  { tab: 'tools', anchor: 'tool-limit', title: 'Tool execution limit', keywords: 'tool rounds limit unlock unlimited sequential loop stop' },
  { tab: 'tools', anchor: 'documents', title: 'Document extraction (PDF / Office / archives)', keywords: 'pdf text office docx unpack zip transcripts' },
  { tab: 'tools', anchor: 'ocr', title: 'Image text extraction (OCR)', keywords: 'ocr vision endpoint auto always image transcription' },
  { tab: 'tools', anchor: 'per-file-chars', title: 'Text per document', keywords: 'per file characters budget document' },
  { tab: 'tools', anchor: 'deep-research', title: 'Deep research default depth', keywords: 'research quick standard thorough tier' },
  { tab: 'tools', anchor: 'search-provider', title: 'Search API provider', keywords: 'tinyfish you exa firecrawl brightdata provider' },
  { tab: 'tools', anchor: 'search-key', title: 'Search API key', keywords: 'search key bring your own stored browser' },
  { tab: 'tools', anchor: 'search-zone', title: 'Bright Data SERP zone', keywords: 'brightdata serp zone' },
  { tab: 'tools', anchor: 'search-max-results', title: 'Results per search', keywords: 'max results count per search' },
  { tab: 'tools', anchor: 'search-timeout', title: 'Search request timeout', keywords: 'search timeout wait retry' },
  { tab: 'tools', anchor: 'search-snippet', title: 'Search snippet length', keywords: 'snippet chars length per result' },
  { tab: 'tools', anchor: 'search-evidence', title: 'Search evidence budget', keywords: 'evidence budget total chars' },
  { tab: 'tools', anchor: 'search-retries', title: 'Search retries', keywords: 'retries transient backoff rate limit' },
  { tab: 'tools', anchor: 'search-retry-delay', title: 'Search retry delay', keywords: 'retry base delay backoff ms' },
  { tab: 'tools', anchor: 'citations', title: 'Sources and citations', keywords: 'citations off pills links sources open reader strict warnings fetch page' },
  { tab: 'tools', anchor: 'workspace-view', title: 'Workspace tool defaults', keywords: 'workspace pinned latest auto open follow tiles' },
  { tab: 'tools', anchor: 'hidden-capabilities', title: 'Additional capabilities', keywords: 'additional capabilities read only show' },

  // Memory
  { tab: 'memory', anchor: 'memory-tool', title: 'Memory tool toggle', keywords: 'memory enabled browser stored' },
  { tab: 'memory', anchor: 'memory-mode', title: 'Memory mode', keywords: 'intentional balanced aggressive store policy' },
  { tab: 'memory', anchor: 'recall-method', title: 'Memory recall method', keywords: 'local rank classifier call cost' },
  { tab: 'memory', anchor: 'recall-mode', title: 'Memory recall mode', keywords: 'holistic contextual specific rank relevant' },
  { tab: 'memory', anchor: 'recall-classifier', title: 'Memory recall classifier', keywords: 'classifier endpoint model memory selection json helper endpoints' },
  { tab: 'memory', anchor: 'add-memory', title: 'Add a memory', keywords: 'add memory fact preference category' },
  { tab: 'memory', anchor: 'stored-memories', title: 'Stored memories', keywords: 'stored memories list edit delete category' },
  { tab: 'memory', anchor: 'check-duplicates', title: 'Check memory duplicates', keywords: 'duplicates merge near duplicate similarity' },

  // Widgets (per-widget cards are dynamic; sub-settings are static)
  { tab: 'widgets', anchor: 'usage-settings', title: 'Usage widget settings', keywords: 'usage group endpoint model success tokens format period total' },
  { tab: 'widgets', anchor: 'last-settings', title: 'Last reply widget settings', keywords: 'last reply speed time unit ms seconds' },
  { tab: 'widgets', anchor: 'shortcut-list', title: 'Shortcut cheat-sheet content', keywords: 'shortcuts shown cheat sheet widget keys' },
  { tab: 'widgets', anchor: 'context-limit', title: 'Context meter limit', keywords: 'context limit estimated meter tokens' },
  { tab: 'widgets', anchor: 'show-disabled', title: 'Endpoint status: show disabled', keywords: 'show disabled endpoints status' },
  { tab: 'widgets', anchor: 'scratch-rows', title: 'Scratchpad note height', keywords: 'scratchpad rows visible note height' },
  { tab: 'widgets', anchor: 'snippet-limit', title: 'Snippets maximum shown', keywords: 'snippets limit maximum saved' },
  { tab: 'widgets', anchor: 'cost-decimals', title: 'Cost estimate decimals', keywords: 'cost decimals places estimate' },
  { tab: 'widgets', anchor: 'active-prompts-only', title: 'Prompt picker: selected only', keywords: 'active prompts only selected' },
  { tab: 'widgets', anchor: 'chars-per-token', title: 'Draft counter: chars per token', keywords: 'chars per token estimate draft counter' },
  { tab: 'widgets', anchor: 'hide-done', title: 'Checklist: hide completed', keywords: 'hide done completed todos checklist' },

  // Appearance
  { tab: 'look', anchor: 'appearance-mode', title: 'Appearance mode (dark / light)', keywords: 'dark light mode theme' },
  { tab: 'look', anchor: 'theme-picker', title: 'Theme picker', keywords: 'theme plum claude nord amoled paper sepia porcelain sand custom' },
  { tab: 'look', anchor: 'custom-colors', title: 'Custom theme colors', keywords: 'custom colors hex background accent text code syntax' },
  { tab: 'look', anchor: 'show-by', title: 'Show which model answered', keywords: 'show model answered label byline' },
  { tab: 'look', anchor: 'show-log', title: 'Show model-use details', keywords: 'process log details classifiers failures' },
  { tab: 'look', anchor: 'show-tps', title: 'Show generation speed', keywords: 'tokens per second speed tps' },
  { tab: 'look', anchor: 'enter-sends', title: 'Enter sends the message', keywords: 'enter sends newline button' },
  { tab: 'look', anchor: 'auto-title', title: 'Auto-generate chat names', keywords: 'auto title chat names concise' },
  { tab: 'look', anchor: 'temporary-default', title: 'New chats are temporary by default', keywords: 'temporary default retention expires' },
  { tab: 'look', anchor: 'model-picker-labels', title: 'Model picker labels', keywords: 'model picker primary secondary name id provider' },
  { tab: 'look', anchor: 'palette-height', title: 'Command palette height', keywords: 'palette height maximum result list scroll' },
  { tab: 'look', anchor: 'chat-width', title: 'Message width', keywords: 'narrow standard wide conversation column' },
  { tab: 'look', anchor: 'settings-size', title: 'Settings window size', keywords: 'settings width height window' },
  { tab: 'look', anchor: 'model-picker-height', title: 'Model picker height', keywords: 'model menu height picker' },
  { tab: 'look', anchor: 'model-pricing-toggle', title: 'Show model pricing controls', keywords: 'pricing fields endpoint per model' },
  { tab: 'look', anchor: 'overlay', title: 'Overlay appearance', keywords: 'modal blur settings opacity backdrop dim' },
  { tab: 'look', anchor: 'fade-duration', title: 'Text fade-in duration', keywords: 'fade seconds animation text' },
  { tab: 'look', anchor: 'temp-retention', title: 'Temporary chat retention', keywords: 'temporary retention hours immediate expires' },
  { tab: 'look', anchor: 'fonts', title: 'Fonts', keywords: 'body heading monospace font google' },
  { tab: 'look', anchor: 'title-model', title: 'Title generation model', keywords: 'title model chat names endpoint helper endpoints' },

  // Shortcuts (per-shortcut rows are dynamic)
  { tab: 'keys', anchor: 'reset-all-keys', title: 'Reset all shortcuts', keywords: 'reset all shortcuts defaults bindings' },

  // Stats
  { tab: 'stats', anchor: 'tokens-sent', title: 'Tokens sent', keywords: 'tokens sent history explicit input' },
  { tab: 'stats', anchor: 'tokens-generated', title: 'Tokens generated', keywords: 'tokens generated reply output' },
  { tab: 'stats', anchor: 'messages-sent', title: 'Messages sent', keywords: 'messages sent edited resent' },
  { tab: 'stats', anchor: 'chats-started', title: 'Chats started', keywords: 'chats started first message' },
  { tab: 'stats', anchor: 'reset-stats', title: 'Reset stats', keywords: 'reset zero totals' },

  // Data
  { tab: 'data', anchor: 'device-sync', title: 'Device sync', keywords: 'sync token push pull devices neon auto' },
  { tab: 'data', anchor: 'encrypted-backup', title: 'Encrypted backup', keywords: 'encrypted backup password aes export import' },
  { tab: 'data', anchor: 'export', title: 'Export configuration', keywords: 'export json backup categories include keys' },
  { tab: 'data', anchor: 'import', title: 'Import configuration', keywords: 'import json file merge replace categories' },
  { tab: 'data', anchor: 'chat-history', title: 'Chat history controls', keywords: 'delete all chats history stats kept' },
  { tab: 'data', anchor: 'browser-storage', title: 'Browser storage', keywords: 'storage refresh compact durable quota usage' },
  { tab: 'data', anchor: 'erase-everything', title: 'Erase everything', keywords: 'erase remove all endpoints keys chats reset' },

  // Advanced
  { tab: 'adv', anchor: 'verbose-errors', title: 'Verbose errors', keywords: 'verbose exact provider error redacted masked' },
  { tab: 'adv', anchor: 'show-hidden-tools', title: 'Show additional capabilities', keywords: 'additional capabilities read only' },
  { tab: 'adv', anchor: 'show-system-prompt', title: 'Show full system prompt', keywords: 'system prompt process log global skills memory' },
  { tab: 'adv', anchor: 'show-tool-payloads', title: 'Show tool arguments and results', keywords: 'payloads json arguments results summaries' },
  { tab: 'adv', anchor: 'show-token-counts', title: 'Show per-step token counts', keywords: 'token counts input output per step reported' },
]

/** Split a `cfg()` target like `"tools#search-mode"` into tab + anchor. */
export const splitSettingTarget = (target: string): { tab: string; anchor: string } => {
  const i = target.indexOf('#')
  if (i < 0) return { tab: target, anchor: '' }
  return { tab: target.slice(0, i), anchor: target.slice(i + 1) }
}

/** DOM id used for every addressable section/card. */
export const settingDomId = (anchor: string): string => `setting-${anchor}`
