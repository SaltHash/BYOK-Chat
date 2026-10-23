import { Type, Image, ImagePlus, FileText, Files, Clock, Clipboard, Calculator, Activity, Layers, StickyNote, Bookmark, Fingerprint, Dices, Hash, MapPin, Coins, Timer, ScrollText, Keyboard, ListChecks, Search, Link, CornerDownLeft } from 'lucide-react'

export const CI = { text: Type, image: Image, 'image+text': ImagePlus, doc: FileText }

// [id, name, icon, usage, description, permission]
// Ordered by relevance: how often a tool is used and how much it changes a
// reply. Web research first, then everyday utilities, then workspaces and
// memory, then reply widgets, then niche developer utilities last.
export const TOOLS: [string, string, typeof Clock, string, string, string][] = [
  ['search', 'Web search and grounding', Search, '@search(query)', 'Searches the web and adds linked sources to your message context.', 'Sends your query to the configured server search provider. Search results are sent to the selected model.'],
  ['fetch_page', 'Page reader', FileText, '@fetch_page(url)', 'Reads the full text of a search result page for deeper quotes.', 'Fetches the page through the configured reader API and sends an excerpt to the selected model. With page summaries on, a second model summarizes the page first.'],
  ['calc', 'Calculator', Calculator, '@calc(2*(3+4))', 'Evaluates arithmetic locally and inserts the result.', 'Runs a restricted arithmetic evaluator inside the page.'],
  ['date', 'Date', Clock, '@date', 'Inserts the current local date.', 'Reads the device clock.'],
  ['time', 'Date and time', Clock, '@time', 'Inserts the device date, time and time zone.', 'Reads the device clock.'],
  ['workspace_upsert', 'Workspace files', Files, 'workspace_upsert({ workspaceId?, createNew?, workspaceName?, revisionName, action, path, language?, content?, template? })', 'Creates downloadable file artifacts shown beside the reply, with preview, diffs, versioning and zip download. One file per call. Actions: create/update/delete/continue/patch (unified diff); template scaffolds static-site, python-script or markdown-notes.', 'Creates local file previews and downloads in this browser.'],
  ['memory', 'Memory', Bookmark, 'memory(text, category)', 'Stores a concise memory about the user when appropriate.', 'Stores a user-approved or useful detail in this browser. Memory can be disabled and entries can be edited or deleted in Settings → Memory.'],
  ['clipboard', 'Clipboard', Clipboard, '@clipboard', 'Inserts the text currently on your clipboard.', 'Reads your clipboard. The browser may ask again on first use.'],
  ['prompt_chip', 'Quick prompt', CornerDownLeft, 'prompt_chip', 'Adds one or more clickable follow-up buttons below the reply. Offer at least one whenever the answer opens a next step or invites exploration; show several side by side for different directions. Omit for simple acknowledgements. Never mention the buttons in the reply text.', 'Creates one-click follow-up buttons.'],
  ['inline_poll', 'Inline poll', ListChecks, 'inline_poll', 'Asks a short survey-style question card below the reply to learn the user\'s environment or intent. Supports choice, slider, text and number questions. Any choice option can set fillBlank:true to attach a typeable answer field (usually for "Other"); the model chooses which options get one. Prefer choices and sliders over typed text. Never mention the card in the reply text.', 'Creates an interactive multi-question card.'],
  ['location', 'Location', MapPin, '@location', 'Inserts your approximate coordinates.', 'Reads your position from the browser, which asks you first. The coordinates are sent to the selected model.'],
  ['navigate', 'App links', Link, '@navigate(destination)', 'Provides a direct link to a page or setting in this app.', 'Returns links to built-in pages and settings.'],
  ['count', 'Text counts', Type, '@count(text)', 'Counts characters, words and lines in the supplied text.', 'Processes the supplied text locally.'],
  ['json', 'Format JSON', ScrollText, '@json({"ok":true})', 'Validates and pretty-prints JSON locally.', 'Processes the supplied text locally.'],
  ['base64', 'Base64 encode', Fingerprint, '@base64(text)', 'Encodes text as Base64 locally.', 'Processes the supplied text locally.'],
  ['uuid', 'UUID', Fingerprint, '@uuid', 'Inserts a fresh random UUID.', 'Uses the browser random generator. Needs a secure context (https or localhost).'],
  ['random', 'Random number', Dices, '@random(1,100)', 'Inserts a random whole number in a range.', 'Uses the browser random generator.'],
  ['hash', 'SHA-256 hash', Hash, '@hash(text)', 'Inserts the SHA-256 hash of the text you give it.', 'Hashes locally. Needs a secure context (https or localhost).'],
]

/** Tools in display order: enabled tools first, each group still sorted by
 *  relevance. `memory` is left out because it lives in Settings → Memory. */
export const orderTools = (enabled: Record<string, boolean> = {}, skip: string[] = ['memory']) =>
  TOOLS
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !skip.includes(t[0]))
    .sort((a, b) => (enabled[a.t[0]] ? 0 : 1) - (enabled[b.t[0]] ? 0 : 1) || a.i - b.i)
    .map(({ t }) => t)

export const WIDGETS: [string, string, typeof Clock, string][] = [
  ['eps', 'Endpoint status', Activity, 'Enabled state of every endpoint at a glance.'],
  ['usage', 'Usage', Layers, 'Successes and failures per endpoint from saved chats.'],
  ['pad', 'Scratchpad', StickyNote, 'A persistent note area next to the chat.'],
  ['snips', 'Snippets', Bookmark, 'Saved text you can insert into the composer.'],
  ['cost', 'Cost estimate', Coins, 'Estimated spend from your all-time token totals and the prices you enter.'],
  ['last', 'Last reply', Timer, 'Process and latency of the latest reply.'],
  ['prompts', 'Prompt picker', ScrollText, 'One-click system prompt override from the side panel.'],
  ['keys', 'Shortcut cheat sheet', Keyboard, 'Your current key bindings.'],
  ['draft', 'Draft counter', Type, 'Characters, words and estimated tokens in the message you are typing.'],
  ['todo', 'Checklist', ListChecks, 'A small persistent task list.'],
]

export const DEFAULT_TOOLS: Record<string, boolean> = { search: false, fetch_page: true, calc: true, count: true, date: true, time: true, random: true, navigate: true, prompt_chip: true, inline_poll: true, workspace_upsert: true }
export const fmtDuration = (ms: number, unit: 'ms' | 's' | 'auto' = 'auto') => {
  if (unit === 'ms' || (unit === 'auto' && ms < 1000)) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(unit === 's' ? 2 : 1)} s`
}

// [id, label, default combo]. Mod = Ctrl, or Cmd on macOS.
export const KEYS: [string, string, string][] = [
  ['palette', 'Command palette', 'Mod+K'],
  ['newChat', 'New chat', 'Mod+Shift+O'],
  ['sidebar', 'Toggle sidebar', 'Mod+B'],
  ['settings', 'Open or close settings', 'Mod+,'],
  ['focus', 'Focus the message box', 'Mod+/'],
  ['stop', 'Stop generating', 'Mod+.'],
  ['regen', 'Regenerate last reply', 'Alt+R'],
  ['widgets', 'Toggle widgets panel', 'Mod+J'],
  ['theme', 'Next theme', 'Alt+T'],
  ['export', 'Export chat as Markdown', 'Mod+Shift+E'],
  ['nextModel', 'Next model', 'Mod+Alt+ArrowDown'],
  ['prevModel', 'Previous model', 'Mod+Alt+ArrowUp'],
  ['nextPrompt', 'Next prompt', 'Mod+Alt+P'],
  ['tempChat', 'New temporary chat', 'Mod+Shift+T'],
]
