import {
  SlidersHorizontal, Server, ScrollText, Sparkles, ListMusic, Terminal,
  FolderOpen, Wrench, Brain, PanelRight, Palette as PaletteIcon, Keyboard,
  TrendingUp, Database, FlaskConical, MessagesSquare, Plug, Volume2,
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
  | 'workspace' | 'tools' | 'mcp' | 'memory' | 'widgets' | 'look' | 'chats'
  | 'voice' | 'keys' | 'stats' | 'data' | 'adv'

export const SETTINGS_TABS: [SettingsTabId, string, Ic][] = [
  ['features', 'Features', SlidersHorizontal],
  ['eps', 'Endpoints', Server],
  ['prompts', 'Prompts', ScrollText],
  ['skills', 'Skills', Sparkles],
  ['pls', 'Playlists', ListMusic],
  ['cmds', 'Commands', Terminal],
  ['workspace', 'Workspace', FolderOpen],
  ['tools', 'Tools', Wrench],
  ['mcp', 'MCP servers', Plug],
  ['memory', 'Memory', Brain],
  ['widgets', 'Widgets', PanelRight],
  ['look', 'Appearance', PaletteIcon],
  ['chats', 'Chats', MessagesSquare],
  ['voice', 'Voice', Volume2],
  ['keys', 'Shortcuts', Keyboard],
  ['stats', 'Stats', TrendingUp],
  ['data', 'Data controls', Database],
  ['adv', 'Advanced', FlaskConical],
]

export const TAB_KEYWORDS: Record<SettingsTabId, string> = {
  features: 'features toggles enable disable library advanced',
  eps: 'endpoints models providers api keys connections model aliases base url preset credentials pricing test helper classification title effort auto recall aihubmix openrouter requesty portkey litellm bifrost',
  prompts: 'prompts system instructions global',
  skills: 'skills instructions custom builtin extra tasks',
  pls: 'playlists routes groups ordered fastest cheapest classifier routing performance',
  cmds: 'commands slash input template run on playlist',
  workspace: 'workspace files panel templates gist share default view auto open follow',
  tools: 'tools helpers search fetch calculator date time clipboard location workspace memory navigate prompt poll count json base64 uuid random hash execution limit citations reader jina firecrawl exa summary',
  mcp: 'mcp model context protocol servers tools external remote connect url headers bearer token',
  memory: 'memory tool mode recall method classifier add stored duplicates categories temporary temp chats recall save',
  widgets: 'widgets panels context meter endpoint status usage scratchpad snippets cost last reply prompts shortcuts draft counter checklist',
  look: 'appearance fonts theme dark light hue saturation brightness sliders display layout max height width message settings model picker palette blur opacity style preset radius rounded sharp bubbly floating density compact comfortable spacious spacing header padding margins gap overrides sidebar composer panel code blocks timestamps actions hover text size scale zoom wrap code lines transparency flat contrast',
  chats: 'chats conversation replies temporary retention hours immediate expires enter send title auto streaming markdown fade speed model answered log startup open load shown sidebar attachments documents pdf office archives ocr image transcription',
  voice: 'voice dictation microphone speech recognition read aloud speech synthesis language rate auto read',
  keys: 'shortcuts keybinds keyboard reset bindings',
  stats: 'stats usage dashboard tokens cost messages chats reset totals windowed period session 24 hours 7 days 30 days month custom range average per million cache read write output estimated unpriced model endpoint overview models over time trends activity bucket hourly daily weekly monthly lifetime',
  data: 'data import backup privacy export erase encrypted history storage compact',
  adv: 'advanced debugging verbose errors additional capabilities system prompt payloads token counts model parameters temperature top p max tokens',
}

/** Navigation groups preserve tab ids and deep links while organizing by task. */
export const SETTINGS_GROUPS: { label: string; tabs: SettingsTabId[] }[] = [
  { label: 'Chat', tabs: ['chats', 'prompts', 'cmds', 'voice', 'keys'] },
  { label: 'Models & providers', tabs: ['eps', 'pls'] },
  { label: 'Tools & research', tabs: ['tools', 'skills', 'mcp', 'memory', 'workspace'] },
  { label: 'Personalize', tabs: ['look', 'widgets', 'features'] },
  { label: 'Data & advanced', tabs: ['stats', 'data', 'adv'] },
]

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
  { tab: 'features', anchor: 'show-disabled-features', title: 'Show disabled features', keywords: 'disabled features off hidden settings tabs signpost show hide' },
  { tab: 'features', anchor: 'feature-workspace', title: 'Feature: Workspace', keywords: 'feature workspace toggle files' },
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
  { tab: 'prompts', anchor: 'global-prompt', title: 'Global system prompt', keywords: 'global system prompt every message qualities tone concise warm direct curious practical playful' },
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

  // MCP
  { tab: 'mcp', anchor: 'add-mcp-server', title: 'Add an MCP server', keywords: 'mcp model context protocol add server remote url' },

  // Tools
  { tab: 'tools', anchor: 'tool-limit', title: 'Tool execution limit', keywords: 'tool rounds limit unlock unlimited sequential loop stop' },
  { tab: 'tools', anchor: 'code-execution', title: 'Code execution', keywords: 'code execution run snippet javascript python sandbox pyodide timeout output limit stdout' },
  { tab: 'tools', anchor: 'code-timeout', title: 'Code time limit', keywords: 'code timeout seconds limit runaway loop infinite sandbox' },
  { tab: 'tools', anchor: 'code-output', title: 'Code output limit', keywords: 'code output characters limit truncate stdout sandbox' },
  { tab: 'tools', anchor: 'code-packages', title: 'Load Python packages', keywords: 'python packages numpy pandas scipy matplotlib wheels pyodide import install' },
  { tab: 'tools', anchor: 'code-pyodide-url', title: 'Pyodide URL', keywords: 'pyodide python runtime webassembly cdn self host url' },
  { tab: 'tools', anchor: 'image-generation', title: 'Image generation', keywords: 'image generation dalle gpt-image flux imagen stable diffusion endpoint model size' },
  { tab: 'chats', anchor: 'documents', title: 'Document extraction (PDF / Office / archives)', keywords: 'pdf text office docx unpack zip transcripts attachments' },
  { tab: 'chats', anchor: 'ocr', title: 'Image text extraction (OCR)', keywords: 'ocr vision endpoint auto always image transcription attachments' },
  { tab: 'chats', anchor: 'per-file-chars', title: 'Text per document', keywords: 'per file characters budget document attachments' },
  { tab: 'tools', anchor: 'deep-research', title: 'Deep research default depth', keywords: 'research quick standard thorough tier' },
  { tab: 'tools', anchor: 'search-provider', title: 'Search API provider', keywords: 'tinyfish you exa firecrawl brightdata jina provider grounding' },
  { tab: 'tools', anchor: 'search-key', title: 'Search API key', keywords: 'search key bring your own stored browser' },
  { tab: 'tools', anchor: 'search-zone', title: 'Bright Data SERP zone', keywords: 'brightdata serp zone' },
  { tab: 'tools', anchor: 'search-max-results', title: 'Results per search', keywords: 'max results count per search' },
  { tab: 'tools', anchor: 'search-timeout', title: 'Search request timeout', keywords: 'search timeout wait retry' },
  { tab: 'tools', anchor: 'search-snippet', title: 'Text per search result', keywords: 'snippet chars length per result text' },
  { tab: 'tools', anchor: 'search-evidence', title: 'Total text per search', keywords: 'evidence budget total chars text budget' },
  { tab: 'tools', anchor: 'search-retries', title: 'Search retries', keywords: 'retries transient backoff rate limit' },
  { tab: 'tools', anchor: 'search-retry-delay', title: 'Search retry delay', keywords: 'retry base delay backoff ms' },
  { tab: 'tools', anchor: 'fetch-timeout', title: 'Page request timeout', keywords: 'page reader fetch timeout wait retry' },
  { tab: 'tools', anchor: 'fetch-chars', title: 'Text kept per page', keywords: 'page reader fetch max chars characters limit text' },
  { tab: 'tools', anchor: 'page-reader', title: 'Page reader toggle', keywords: 'page reader enable grounding snippets read full page' },
  { tab: 'tools', anchor: 'reader-api', title: 'Page reader API', keywords: 'reader api service provider jina firecrawl exa custom separate from search' },
  { tab: 'tools', anchor: 'reader-key', title: 'Reader API key', keywords: 'reader key jina firecrawl exa credentials stored browser' },
  { tab: 'tools', anchor: 'reader-url', title: 'Custom reader API URL', keywords: 'reader url endpoint custom {url} json text' },
  { tab: 'tools', anchor: 'reader-summary', title: 'Summarize pages with another model', keywords: 'summary subagent summarize page model context clean' },
  { tab: 'tools', anchor: 'reader-summary-model', title: 'Page summary model', keywords: 'summary model endpoint model id picker helper' },
  { tab: 'tools', anchor: 'reader-summary-length', title: 'Page summary length', keywords: 'summary length characters size limit' },
  { tab: 'tools', anchor: 'fetch-retries', title: 'Page retries', keywords: 'page reader fetch retries transient backoff rate limit' },
  { tab: 'tools', anchor: 'fetch-retry-delay', title: 'Page retry delay', keywords: 'page reader fetch retry base delay backoff ms' },
  { tab: 'tools', anchor: 'citations', title: 'Sources and citations', keywords: 'citations off pills links sources open strict warnings' },
  { tab: 'tools', anchor: 'workspace-view', title: 'Workspace tool defaults', keywords: 'workspace pinned latest auto open follow tiles' },
  { tab: 'tools', anchor: 'hidden-capabilities', title: 'Additional capabilities', keywords: 'additional capabilities read only show' },

  // Memory
  { tab: 'memory', anchor: 'memory-tool', title: 'Memory tool toggle', keywords: 'memory enabled browser stored' },
  { tab: 'memory', anchor: 'memory-mode', title: 'Memory mode', keywords: 'intentional balanced aggressive store policy' },
  { tab: 'memory', anchor: 'memory-temp-chats', title: 'Memory in temporary chats', keywords: 'memory temporary temp chat recall save enabled' },
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
  { tab: 'widgets', anchor: 'show-disabled', title: 'Endpoint status: show disabled', keywords: 'show disabled endpoints status' },
  { tab: 'widgets', anchor: 'scratch-rows', title: 'Scratchpad note height', keywords: 'scratchpad rows visible note height' },
  { tab: 'widgets', anchor: 'snippet-limit', title: 'Snippets maximum shown', keywords: 'snippets limit maximum saved' },
  { tab: 'widgets', anchor: 'cost-decimals', title: 'Cost estimate decimals', keywords: 'cost decimals places estimate' },
  { tab: 'widgets', anchor: 'active-prompts-only', title: 'Prompt picker: selected only', keywords: 'active prompts only selected' },
  { tab: 'widgets', anchor: 'chars-per-token', title: 'Draft counter: chars per token', keywords: 'chars per token estimate draft counter' },
  { tab: 'widgets', anchor: 'hide-done', title: 'Checklist: hide completed', keywords: 'hide done completed todos checklist' },

  // Appearance
  { tab: 'look', anchor: 'appearance-mode', title: 'Appearance mode (dark / light)', keywords: 'dark light mode theme' },
  { tab: 'look', anchor: 'style-preset', title: 'Style preset', keywords: 'style preset feel modern sharp bubbly floating corners radius rounded shadows elevation' },
  { tab: 'look', anchor: 'density', title: 'Density', keywords: 'density compact comfortable spacious spacing layout' },
  { tab: 'look', anchor: 'density-advanced', title: 'Advanced spacing overrides', keywords: 'advanced spacing overrides header padding vertical chat margins message gap sidebar composer panel code blocks pixels fine tune' },
  { tab: 'look', anchor: 'high-contrast', title: 'High contrast', keywords: 'high contrast muted text borders readable accessibility theme' },
  { tab: 'look', anchor: 'message-times', title: 'Message times', keywords: 'message times timestamps clock sent at' },
  { tab: 'look', anchor: 'message-actions', title: 'Always show message actions', keywords: 'message actions hover always show copy regenerate delete' },
  { tab: 'widgets', anchor: 'context-meter', title: 'Context meter', keywords: 'context meter tokens circle header appearance' },
  { tab: 'look', anchor: 'context-limit', title: 'Context meter limit', keywords: 'context limit estimated meter tokens' },
  { tab: 'look', anchor: 'theme-picker', title: 'Theme picker', keywords: 'theme plum claude obsidian graphite paper sage frost sunset custom' },
  { tab: 'look', anchor: 'custom-colors', title: 'Custom theme sliders', keywords: 'custom theme base hue saturation brightness contrast sliders hex colors reset defaults' },
  { tab: 'look', anchor: 'seasonal', title: 'Seasonal touches', keywords: 'seasonal festive greeting holiday plain' },
  { tab: 'look', anchor: 'completion-cues', title: 'Completion cues', keywords: 'completion cues chime confetti deep research workspace finished' },
  { tab: 'look', anchor: 'temp-glow', title: 'Temporary chat glow', keywords: 'temporary chat glow edge intensity breathe wave rim indicator' },
  { tab: 'look', anchor: 'temp-glow-sent', title: 'Glow after a message is sent', keywords: 'temporary chat glow sent relative strength after first message steady foothold' },
  { tab: 'chats', anchor: 'show-by', title: 'Show which model answered', keywords: 'show model answered label byline' },
  { tab: 'chats', anchor: 'show-log', title: 'Show model-use details', keywords: 'process log details classifiers failures' },
  { tab: 'chats', anchor: 'show-tps', title: 'Show generation speed', keywords: 'tokens per second speed tps' },
  { tab: 'chats', anchor: 'enter-sends', title: 'Enter sends the message', keywords: 'enter sends newline button' },
  { tab: 'chats', anchor: 'prompt-recall', title: 'Prompt recall (↑ / ↓)', keywords: 'prompt recall arrows up down history composer edges anytime empty off sent messages' },
  { tab: 'chats', anchor: 'auto-title', title: 'Auto-generate chat names', keywords: 'auto title chat names concise' },
  { tab: 'chats', anchor: 'temporary-default', title: 'New chats are temporary by default', keywords: 'temporary default retention expires' },
  { tab: 'look', anchor: 'model-picker-labels', title: 'Model picker labels', keywords: 'model picker primary secondary name id provider' },
  { tab: 'look', anchor: 'model-picker-labels-secondary', title: 'Model picker secondary label', keywords: 'model picker secondary label provider name id none' },
  { tab: 'look', anchor: 'palette-height', title: 'Command palette height', keywords: 'palette height maximum result list scroll' },
  { tab: 'look', anchor: 'chat-width', title: 'Message width', keywords: 'narrow standard wide conversation column' },
  { tab: 'look', anchor: 'settings-size', title: 'Settings window size', keywords: 'settings width height window' },
  { tab: 'look', anchor: 'model-picker-height', title: 'Model picker height', keywords: 'model menu height picker' },
  { tab: 'look', anchor: 'model-favorites', title: 'Favorite models', keywords: 'favorites favorite starred star models picker section providers collapse' },
  { tab: 'eps', anchor: 'model-pricing-toggle', title: 'Show model pricing controls', keywords: 'pricing fields endpoint per model' },
  { tab: 'look', anchor: 'overlay', title: 'Overlay appearance', keywords: 'modal blur settings opacity backdrop dim' },
  { tab: 'chats', anchor: 'stream-fade', title: 'Reply fade-in', keywords: 'fade in streaming chunks duration ms' },
  { tab: 'chats', anchor: 'startup', title: 'Open on load', keywords: 'startup open load launch new temporary recent permanent conversation' },
  { tab: 'chats', anchor: 'temp-visible', title: 'Temporary chats shown', keywords: 'temporary chats sidebar shown expand collapse count' },
  { tab: 'chats', anchor: 'stream-md', title: 'Render markdown while streaming', keywords: 'markdown streaming live rich text format incremental' },
  { tab: 'chats', anchor: 'copy-markdown', title: 'Copy replies as Markdown', keywords: 'copy markdown formatting tables code links clipboard plain text' },
  { tab: 'chats', anchor: 'pinned-context', title: 'Pinned reply context', keywords: 'pin pinned reply context window share percent truncate model guidance' },
  { tab: 'chats', anchor: 'remote-images', title: 'Load remote images', keywords: 'images remote click to load privacy third party beacon' },
  { tab: 'chats', anchor: 'temp-retention', title: 'Temporary chat retention', keywords: 'temporary retention hours immediate expires' },
  { tab: 'chats', anchor: 'draft-survival', title: 'Drafts across reloads', keywords: 'draft unsent typed survive reload persistence new chat existing both never' },
  { tab: 'look', anchor: 'fonts', title: 'Fonts', keywords: 'body heading monospace font google' },
  { tab: 'look', anchor: 'text-size', title: 'Text size', keywords: 'text size scale root font larger smaller zoom percent accessibility' },
  { tab: 'look', anchor: 'code-wrap', title: 'Wrap long code lines', keywords: 'code blocks wrap soft wrap long lines scroll overflow' },
  { tab: 'look', anchor: 'code-line-numbers', title: 'Code line numbers', keywords: 'code blocks line numbers gutter numbered' },
  { tab: 'look', anchor: 'code-max-height', title: 'Code block height cap', keywords: 'code blocks maximum height scroll collapse long' },
  { tab: 'look', anchor: 'glass-composer', title: 'Glass composer', keywords: 'glass composer frosted translucent backdrop blur opacity solid transparency message box' },
  { tab: 'look', anchor: 'reduce-transparency', title: 'Reduce transparency', keywords: 'reduce transparency flat opaque glass blur shadow gpu performance' },
  { tab: 'look', anchor: 'title-model', title: 'Title generation model', keywords: 'title model chat names endpoint helper endpoints' },

  // Voice
  { tab: 'voice', anchor: 'voice-dictation', title: 'Dictation', keywords: 'dictation microphone speech to text language' },
  { tab: 'voice', anchor: 'voice-read-aloud', title: 'Read aloud', keywords: 'read aloud speech synthesis voice language rate auto' },

  // Shortcuts (per-shortcut rows are dynamic)
  { tab: 'keys', anchor: 'reset-all-keys', title: 'Reset all shortcuts', keywords: 'reset all shortcuts defaults bindings' },

  // Stats — dashboard views, detail sections and the lifetime counters.
  { tab: 'stats', anchor: 'view-overview', title: 'Usage: Overview', keywords: 'usage dashboard overview cost tokens average most used model token mix trend top models summary' },
  { tab: 'stats', anchor: 'view-models', title: 'Usage: Models', keywords: 'usage models ranking per model tokens share cost average last used search sort breakdown' },
  { tab: 'stats', anchor: 'view-trends', title: 'Usage: Over time', keywords: 'usage over time charts trend cost tokens buckets hourly daily weekly monthly category model legend data table' },
  { tab: 'stats', anchor: 'view-activity', title: 'Usage: Activity', keywords: 'usage activity recent attempts log day filters success failure chat jump' },
  { tab: 'stats', anchor: 'detail-cost', title: 'Usage: Cost detail', keywords: 'usage cost detail recorded estimated unpriced spend by model pricing' },
  { tab: 'stats', anchor: 'detail-tokens', title: 'Usage: Token detail', keywords: 'usage token detail uncached cache read write output share prompt' },
  { tab: 'stats', anchor: 'detail-average', title: 'Usage: Average cost detail', keywords: 'usage average cost per million formula priced tokens comparison' },
  { tab: 'stats', anchor: 'detail-model', title: 'Usage: Model detail', keywords: 'usage model detail endpoint removed recent attempts failed jump' },
  { tab: 'stats', anchor: 'usage-period', title: 'Usage period', keywords: 'usage period session last 24 hours 7 days 30 days all time custom from through date range' },
  { tab: 'stats', anchor: 'lifetime-counters', title: 'Lifetime counters', keywords: 'lifetime all time counters tokens messages chats since' },
  { tab: 'stats', anchor: 'tokens-sent', title: 'Lifetime tokens sent', keywords: 'tokens sent explicitly sent history tool calls input lifetime' },
  { tab: 'stats', anchor: 'tokens-generated', title: 'Lifetime tokens generated', keywords: 'tokens generated reply output lifetime' },
  { tab: 'stats', anchor: 'messages-sent', title: 'Lifetime messages sent', keywords: 'messages sent edited resent lifetime' },
  { tab: 'stats', anchor: 'chats-started', title: 'Lifetime chats started', keywords: 'chats started first message lifetime' },
  { tab: 'stats', anchor: 'reset-stats', title: 'Reset stats', keywords: 'reset zero totals lifetime counters' },

  // Data
  { tab: 'data', anchor: 'local-backups', title: 'Local backups', keywords: 'backup backups automatic daily local indexeddb restore snapshot' },
  { tab: 'data', anchor: 'export', title: 'Export data', keywords: 'export json data backup categories include keys encrypted password aes' },
  { tab: 'data', anchor: 'import', title: 'Import data', keywords: 'import json data file merge replace categories encrypted password' },
  { tab: 'data', anchor: 'chat-history', title: 'Chat history controls', keywords: 'delete all chats history stats kept' },
  { tab: 'data', anchor: 'browser-storage', title: 'Browser storage', keywords: 'storage refresh compact durable quota usage' },
  { tab: 'data', anchor: 'erase-everything', title: 'Erase everything', keywords: 'erase remove all endpoints keys chats reset' },

  // Advanced
  { tab: 'adv', anchor: 'verbose-errors', title: 'Verbose errors', keywords: 'verbose exact provider error redacted masked' },
  { tab: 'adv', anchor: 'show-hidden-tools', title: 'Show additional capabilities', keywords: 'additional capabilities read only' },
  { tab: 'adv', anchor: 'show-system-prompt', title: 'Show full system prompt', keywords: 'system prompt process log global skills memory' },
  { tab: 'adv', anchor: 'show-tool-payloads', title: 'Show tool arguments and results', keywords: 'payloads json arguments results summaries' },
  { tab: 'adv', anchor: 'show-token-counts', title: 'Show per-step token counts', keywords: 'token counts input output per step reported' },
  { tab: 'adv', anchor: 'show-model-params', title: 'Model parameters', keywords: 'model parameters temperature top p max tokens generation header advanced' },
]

export type SettingsSearchResult = { target: string; title: string; section: string }

/** Search both sections and their addressable settings; tab ids remain stable. */
export function searchSettings(query: string): SettingsSearchResult[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const matches = (text: string) => words.every(word => text.toLowerCase().includes(word))
  const tabs = new Map(SETTINGS_TABS.map(([id, label]) => [id, label]))
  const sections = SETTINGS_TABS.filter(([id, label]) => matches(`${label} ${TAB_KEYWORDS[id]}`))
    .map(([id, title]) => ({ target: id, title, section: 'Section' }))
  const settings = SETTING_LINKS.filter(link => matches(`${link.title} ${link.keywords} ${tabs.get(link.tab) ?? ''}`))
    .map(link => ({ target: `${link.tab}#${link.anchor}`, title: link.title, section: tabs.get(link.tab) ?? link.tab }))
  return [...sections, ...settings]
}

/** Split a `cfg()` target like `"tools#search-mode"` into tab + anchor. */
export const splitSettingTarget = (target: string): { tab: string; anchor: string } => {
  const i = target.indexOf('#')
  if (i < 0) return { tab: target, anchor: '' }
  return { tab: target.slice(0, i), anchor: target.slice(i + 1) }
}

/** DOM id used for every addressable section/card. */
export const settingDomId = (anchor: string): string => `setting-${anchor}`
