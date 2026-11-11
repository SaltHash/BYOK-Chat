# BYOK Chat

A local-first AI chat client for the model endpoints you already use. Bring an
OpenAI-compatible or Anthropic Messages endpoint (a hosted provider, a local
Ollama server, a gateway, or your own), keep the keys in the browser, and chat
with one model or route across several.

An optional Node or Cloudflare backend adds web search, page reading, sharing,
encrypted device sync, and a CORS relay for providers that block browser
requests. Without it the app still runs as a static site and calls providers
directly.

For the feature inventory and maturity review see [FEATURE_AUDIT.md](FEATURE_AUDIT.md);
for the roadmap see [FEATURE_BACKLOG.md](FEATURE_BACKLOG.md); for the rules that
bite when changing code see [agents.md](agents.md).

## Why this app

- Model keys live in the browser. The backend never stores model credentials.
- Chats, workspaces, attachments and settings live on the device.
- Device sync encrypts the payload before upload; the server stores ciphertext.
- Grounding, files, code, images, MCP tools and skills share one chat surface.
- Runs as a web app, an installable PWA, or a self-hosted Node/Worker deployment.

## Architecture at a glance

```
Browser: React 18 + Vite + TypeScript + Tailwind v4
  App.tsx shell ─ sidebar · chat · composer · widgets · lazy settings/palette/share
        │
  src/store.ts  one Zustand store: state + actions (source of truth)
        ├── src/engine.ts   provider streaming, tool loop, search/reader calls
        ├── src/storage/    localStorage, IndexedDB/OPFS, sync, crypto
        └── src/components/ UI

Optional backend (pick one, same route modules)
  server.mjs ── Node host ──┐
  worker/index.mjs ─────────┴── server/*.mjs
     /api/search · /api/extract · /api/reader · /api/share · /api/sync/* · /api/proxy
```

The browser is the app; the backend is a stateless helper that only sees what a
given request needs. Model traffic goes straight to the provider, or through
`/api/proxy` when the provider's CORS policy blocks browser calls.

## The store

`src/store.ts` is the heart of the project and the file most changes touch. It
is a single Zustand store, `useS`, holding everything the app knows: endpoints
and model selection, chats and their transcripts, prompts, playlists, commands,
profiles, projects, workspaces, memory, MCP servers, skills, usage history,
sharing records, settings and appearance. There is no second state container;
components read slices through selectors (`useS(useShallow(...))`) and call
store actions to change anything.

**State is grouped by feature.** The type `S` near the top of `store.ts` is the
authoritative list. The groups worth knowing:

- Model layer: `eps`, `sel`, `favs`, `pls`, `prompts`, `cmds`, `profiles`,
  `params`, `effort`, `routeStats`.
- Conversations: `chats`, `chat`, `drafts`, `draft`, `queued`, `busyChats`,
  `runJournal`, `doneChats`, `undo`, plus per-message pin/bookmark/version data.
- Capabilities: `tools`, `toolMode`, `toolApproval`, `toolConsent`, `mcps`,
  `skills`, `imageGen`, `codeRun`, `voicePrefs`, `search`, `memories`,
  `memoryPrefs`, `docPrefs`.
- Research: `researchRounds`, per-message research state and `researchPanel`.
- Workspaces and projects: `workspaces`, `selectedRevision`, `projects`,
  `activeProject`.
- Configuration and appearance: `prefs`, `advanced`, `features`,
  `featureOrder`, `widgetPrefs`, `widgets`, `rail`, `themeMode`, `themeDark`,
  `themeLight`, custom palettes, fonts and layout widths.
- Accounting and sync: `usage`, `usageTitles`, `stats`, `shares`, `keys`,
  `gistToken`.

**Actions are the API.** Everything from creating a chat (`newChat`, `chatOp`,
`moveChat`) to editing a transcript (`editMsg`, `delMsg`, `regen`, `retryMsg`,
`regenAt`) to branching (`branch`, `variant`, `gotoPath`) is a store action.
Replies go through `send(value, attachments)`, which returns whether a run
started; `stop` and `stopAll` abort per-chat `AbortController`s; `resumeRun` and
`resumeOrphanedRuns` continue a reply whose tab closed. Research, profiles,
project context, memory, tool policy (`alwaysAllowTool`), storage maintenance
(`compactStorage`, `compactChat`) and usage history all live here too.

**Reply lifecycle.** `send` plans the request (`planRequest` in `chatPlan.ts`),
resolves candidate endpoints (playlist routing and fallbacks), builds the wire
history (`wire` in `engine.ts`), streams tokens, runs the tool loop, then
finalizes the message with stats, citations and workspace changes. Runs are kept
in a module-level map keyed by chat id, so chats stream independently and Stop
only affects the chat it was pressed in. A durable run journal records replies
that were in flight when the tab closed so they can be resumed.

**Writes funnel through one `set`.** The store wraps Zustand's setter so that
per-chat drafts stay coherent: `draft` always mirrors the active chat and
switching chats stages/restores the right draft. Persistence is layered on the
same write: the persist middleware keeps the settings-and-index copy in
`localStorage` under `byok.v1`, while `storage/boot.ts` mirrors chats,
workspaces and attachment blobs to IndexedDB/OPFS (OPFS where available) and
restores anything localStorage had to prune. Usage history has its own key, and
sync keeps a separate content-hash baseline.

**When adding state**, update `S` and defaults, normalize persisted values in
the same module that owns them, bump `STORE_VERSION` in `persistence.ts` when
the persisted shape changes, and keep pure logic in a sibling module with a
`.test.mjs` rather than growing the store further.

## Request path

1. The composer calls `send`, which plans the request: model, system prompt,
   tools, memory recall, attachments, pinned reply and context budget.
2. Playlist routing and profiles narrow the endpoint candidates; failures fall
   through to the next endpoint, with one retry for transient errors.
3. `engine.wire` turns the transcript into provider wire messages, and
   `engine.stream` opens the SSE stream through the provider adapter.
4. Tokens are appended to the message as they arrive; `runToolLoop` executes
   tool calls (parallel where safe) under the current access policy, asking for
   approval when a tool is marked as such.
5. Grounding calls `searchWeb`/`fetchPage`, either directly from the browser or
   through the backend, and citations are numbered and merged into sources.
6. The finalized reply records usage, stats, citations, workspace revisions and
   any pending completion cue, then the mirror writes it to durable storage.

## Engine and providers

`src/engine.ts` owns transport, not UI: provider wire formats (OpenAI Chat
Completions and Anthropic Messages), SSE parsing, a small TTL/LRU session cache
for search results and page reads, error classification (network, CORS,
timeout, rate limit, empty response, stalled stream), and the tool loop. The
`O` options bag carries sampling, effort, caps and abort signals. Provider
casing, model catalogs and auth headers live in `providerAdapter.ts` and
`providerRegistry.ts`; playlist classification, effort detection and memory
recall share configurable helper models rather than hard-coded defaults.

Context is budgeted deliberately: `contextBudget` respects the smallest context
window among candidate models, the meter shows the share in use, older turns can
be replaced by a model-written handoff (`compactAuto`), and one pinned reply may
occupy a capped slice of the window without crowding the conversation.

## Grounding, tools and depth

- **Search and reading:** `@search` and automatic grounding with numbered
  sources and inline citations; page summaries when enabled. Browser keys are
  used by default, with server fallbacks configured by environment.
- **Deep research:** tiered runs with a reviewable plan, clarifying questions,
  steered rounds, cited reports and re-runs against fresh sources.
- **Tools:** `ask` for mid-turn questions, workspace file actions, memory,
  graphs, artifacts, prompts/polls, clipboard, location, navigation and local
  utilities. The composer lock chooses Full, Standard, Restricted or Disabled
  access; individual tools can require approval in Standard.
- **Files and workspaces:** PDF, DOCX, ODT, RTF, PPTX, XLSX, ZIP, GZ, text,
  images, audio and transcript pairing, with optional OCR. Workspaces hold
  model-created files with preview, diff, revisions, templates, downloads and
  optional Gist sharing.
- **Code and images:** a disposable Web Worker for JavaScript, Pyodide for
  Python, and image generation through an OpenAI-compatible images endpoint.

## Local data, sync and sharing

`localStorage` holds settings and the chat index; IndexedDB/OPFS holds the full
chats, workspaces and blobs, so quota pruning cannot destroy history. Device
sync pushes only entities and messages that changed since the last server
sequence, encrypts the payload in the browser, and merges remote changes on
boot, on tab focus and on a slow interval. Sharing publishes conversation text,
title, byline and timestamps only, after stripping keys, prompts, files and
tool payloads.

## Backend API

The Node host and the Worker run the same modules from `server/`, so behaviour
cannot drift between deployments. Routes: `/api/health`, `/api/search`,
`/api/extract`, `/api/reader`, `/api/share` (+ `/:id`), `/api/sync/status`,
`/api/sync/push`, `/api/sync/pull`, and `/api/proxy` (host allowlist required).
Per-route sliding-window rate limits, bounded bodies, private-target blocking
and same-origin checks for writes are shared too; the Worker's limits are per
isolate and therefore approximate.

```sh
PORT=3000
DATABASE_URL=postgresql://...   # sync and shares; memory fallback without it
SYNC_BACKEND=neon               # or memory
SEARCH_API_KEY=...              # shared search fallback
READER_API_KEY=...              # optional reader fallback
SEARCH_API_ZONE=...             # Bright Data only
PROXY_ALLOWED_HOSTS=api.example.com,*.example.org
PROXY_ALLOW_PRIVATE=1           # local gateways only
TRUST_PROXY=1                   # behind a trusted reverse proxy
```

Provider-specific keys such as `TINYFISH_API_KEY`, `EXA_API_KEY`,
`TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `BRAVE_SEARCH_API_KEY` and
`BING_SEARCH_API_KEY` work alongside the shared fallback. Secrets belong in
platform secrets or the gitignored `.env`, never in the repository.

## Appearance and theming

Colours come from theme tokens (`--bg`, `--side`, `--surf`, `--hov`, `--tx`,
`--mu`, `--ac`, …) defined as `[data-t=...]` blocks in `src/index.css`, with the
same palettes exported as `THEME_COLORS` in `src/store.ts` for pickers and
swatches. Custom themes are generated from an accent, text and background
colour by `customPalette()` in `src/theme.ts`. Style presets change radii and
shadows only, never colour. `src/contrast.test.mjs` enforces muted-text contrast
and keeps the CSS and store palettes in sync.

## Getting started

Requires Node 20 or newer.

```sh
npm install
npm run dev          # Vite plus the Node API, both reading .env
```

Open the local URL, add an endpoint and key, and start chatting. Production,
self-hosted:

```sh
npm run build
npm start            # Node serves dist plus /api
npm run deploy       # build and deploy the Worker through Wrangler
```

## Scripts

- `npm run dev`: Vite dev server plus the Node API, both loading `.env`.
- `npm run build`: production frontend into `dist/`.
- `npm start`: built frontend plus the API on the Node host.
- `npm run deploy`: `npm run build` then `wrangler deploy`.
- `npm test`: unit, server, Worker and flow tests via `node --test` and the
  TypeScript loader in `tests/register-loader.mjs`.
- `npm run test:worker`: Worker routing smoke test.
- `npm run smoke:providers`: provider smoke script.
- `npx tsc --noEmit`: type check (there is no npm script for it).

## Project layout

```
src/               app logic, one module per concern with colocated tests
  components/      UI: chat, composer, sidebar, settings, palette, widgets
  storage/         durable storage, sync, crypto, coalescing, usage ledger
  engine.ts        provider transport and tool loop
  store.ts         the single Zustand store and actions
  theme.ts         colour maths and custom palette generation
server/            shared API route modules used by both hosts
worker/            Cloudflare Workers entry (API then ASSETS)
tests/             integration, Worker and flow tests
scripts/           build and smoke helpers
index.html         document shell and the pre-paint theme script
```

## Known limits

- A static-only deployment loses search, page reading, sharing, sync and relay;
  direct model calls still work when the provider allows browser requests.
- The Worker's rate limits and caches are per isolate and approximate.
- Browser storage can be cleared; export a backup and keep sync enabled.
- Image generation needs an OpenAI-compatible images endpoint.
- Code execution is an opt-in local sandbox, not a security boundary.
- Gemini is used through its OpenAI-compatible endpoint, not the native format.
- Legacy `.doc`, `.xls`, `.ppt`, `.7z` and `.rar` files are not parsed.
