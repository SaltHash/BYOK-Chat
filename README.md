# BYOK Chat

A highly customizable, browser-based chat client supporting custom endpoints. Model provider keys are saved in the browser and sent directly to the configured provider. The included Node service (or the Cloudflare Worker) handles web search and does not store model credentials.

## Run locally

Install dependencies and start the app:

```sh
npm install
npm run dev
```

`npm run dev` runs Vite with an `/api` proxy to the Node server (`server.mjs`). The dev entry also loads a gitignored `.env` file (Node's built-in `process.loadEnvFile()`, so real environment variables win); production hosts keep using environment variables only. To run the Cloudflare deployment model locally instead (workerd serving the built `dist/` and the Worker API on one origin), build first and use `npm run cf:dev`; optional local secrets go in a gitignored `.dev.vars` file.

There are no committed environment files. Search tuning lives in the app under Settings → Tools → Web search and grounding (results per search, request timeout, text per result, total text per search, retries, retry delay) and is sent with each search request; the server only enforces hard caps (10 results, 3000 characters per result, 24000 total characters per search, 1–30s timeout, 0–4 retries). The page reader has its own API, key, timeout, text limit, retries and retry delay under the Page reader tool, next to the reader settings they belong to.

Every settings page is grouped into labelled sections (for example Chats → Replies, Temporary chats, Behavior, Documents), so related settings sit together. In Settings → Tools the tool list is ordered by relevance, and enabled tools are pinned to the top of the list while keeping that order. Turning a tool on asks for permission first; tick **Do not ask again** in that popup to allow the tool for good (the card then shows *Always allowed*, and the choice can be undone there).

## Inference providers per model

For OpenRouter endpoints each model row under Settings → Endpoints has a low-key **Provider** button. It opens a modal listing the providers currently serving that model, fetched live from OpenRouter's `/api/v1/models/{id}/endpoints` API (Amazon Bedrock, Anthropic, Google Vertex, region/variant endpoints, …). Picking one pins every request for that model to it — the body carries `provider: { order: [tag], allow_fallbacks: false }` — while **Automatic** keeps OpenRouter's default price-load-balanced routing. A provider slug can also be typed by hand when a model is not listed. Non-OpenRouter endpoints never show the button, and the choice is stored per model and travels with config exports.

## AIHubMix

[AIHubMix](https://aihubmix.com) is a unified model gateway: one key, 500+ models from OpenAI, Anthropic, Google, and leading open-source providers, behind four wire protocols. Pick the **AIHubMix** preset in Settings → Endpoints and paste your key; the model list is then fetched live from the gateway.

- OpenAI Chat Completions (the preset default): base URL `https://aihubmix.com/v1`, chat at `/v1/chat/completions`, `Authorization: Bearer <key>`.
- Anthropic Messages: set the endpoint's *API format* to **Anthropic Messages** and keep the base URL at `https://aihubmix.com/v1`. Requests then go to `/v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`.
- Google Gemini (`/gemini/v1beta/models/{model}:generateContent` with `x-goog-api-key`) is not wired into the app; add it as a custom endpoint if you need it.

Discovery uses `GET https://aihubmix.com/v1/models`, whose rows carry an `owned_by` field; the picker shows it as the upstream owner. The gateway also accepts `model: "auto"` for smart routing.

Keys are created in the [AIHubMix console](https://console.aihubmix.com/) and can be restricted to a model list, an IP allowlist, a spend cap, and an expiry date. Error responses carry a `tid` trace id — quote it when reporting an issue. For the live smoke test, export `AIHUBMIX_API_KEY` (and optionally `AIHUBMIX_MODEL`) and run `npm run smoke:providers -- --provider=aihubmix`.

## AI search providers

Search is bring-your-own-key: paste a provider key in Settings → Tools → Web search and grounding. It is stored only in the browser (like model keys) and sent with each search request; the server never stores browser keys. Server-side keys remain supported as a shared fallback when the browser sends none. Providers: TinyFish, You.com, Exa, Firecrawl, Bright Data, or Jina AI.

Server configuration (hosting environment only; no `.env` files):

```sh
# optional shared server keys (used only when the browser sends none):
SEARCH_API_KEY=...
# or provider-specific keys:
TINYFISH_API_KEY=...
YOU_API_KEY=...
EXA_API_KEY=...
FIRECRAWL_API_KEY=...
BRIGHTDATA_API_KEY=...
SEARCH_API_ZONE=your-serp-zone  # Bright Data only
# optional endpoint override:
SEARCH_API_URL=
```

`/api/search` accepts `{ query, provider, apiKey, zone, count, timeoutMs, maxSnippetChars, evidenceBudget, maxRetries, retryBaseMs }` and returns `{ query, results, searchedAt, provider, mode }`. `/api/health` reports which providers have server keys.

`POST /api/reader` reads one page through the page-reader API chosen in Settings → Tools → Page reader: the built-in reader, Jina Reader, Firecrawl, Exa, or a custom service. The body is `{ url, provider, apiKey, baseUrl, fallback, timeoutMs, maxChars, maxRetries, retryBaseMs }`; the key travels in the body, never in a URL. A custom service receives the page address in a `{url}` placeholder (or a `?url=` parameter) and may answer with JSON containing a `text` field or with plain text. `READER_API_KEY` and `READER_API_URL` (plus `READER_API_KEY_<PROVIDER>` / `READER_API_URL_<PROVIDER>`) work as server-side defaults.

Failures return structured JSON `{ error, code, provider, retryable }` with a matching HTTP status instead of a blanket 503:

- `400 missing_key` / `missing_zone`: no browser or server key (or Bright Data zone) is configured. Not retried.
- `429 rate_limited`: the provider is throttling; includes a `retry-after` hint. Retried with backoff, then reported.
- `502 upstream_auth`: the provider rejected the key (HTTP 401/403). Check the key; not retried.
- `502 billing`: the provider reported a billing problem (HTTP 402, e.g. depleted You.com credits). Not retried.
- `502 bad_request` / `bad_response`: the provider rejected the request or returned something unusable. Not retried.
- `503 upstream_unavailable`, `timeout`, or `network`: the provider could not be reached after bounded retries. Only these are genuine outages.

Transient failures (HTTP 429/502/503/504, timeouts, connection errors) are retried with exponential backoff; permanent errors (other 4xx, missing keys) are never retried. The server logs provider, mode, error code, and upstream status for diagnostics, and never logs API keys, zones, or authorization headers.

Provider request details (verified against each provider's official documentation):

- TinyFish: `GET https://api.search.tinyfish.ai?query=…` with an `X-API-Key` header ([docs](https://docs.tinyfish.ai/search-api/reference)).
- You.com: `POST https://ydc-index.io/v1/search` with an `X-API-Key` header and `{ query, count }` ([docs](https://you.com/docs/api-reference/search)).
- Exa: `POST https://api.exa.ai/search` with an `X-API-Key` header and `{ query, type: "auto", numResults, contents: { highlights: true } }` ([docs](https://exa.ai/docs/reference/search)).
- Firecrawl: `POST https://api.firecrawl.dev/v2/search` with an optional `Authorization: Bearer` header and `{ query, limit }`. The key is optional: search works keyless at lower limits ([docs](https://docs.firecrawl.dev/api-reference/endpoint/search)).
- Bright Data: `POST https://api.brightdata.com/request` with an `Authorization: Bearer` header and `{ zone, url, format: "raw", data_format: "parsed_light" }`; a SERP zone is required ([docs](https://docs.brightdata.com/products/serp-api/introduction)).
- Jina AI: `GET https://s.jina.ai/?q=…` with an optional `Authorization: Bearer` header. The key is optional: Jina Search works keyless at lower rate limits, and it is the same service as Jina Reader, so one key covers both search and page reads ([docs](https://docs.jina.ai/api-reference/search)).

Without any keys, You.com and Exa answer with HTTP 402 (billing/payment required) and Bright Data/TinyFish with HTTP 401, which the backend surfaces as `billing` / `upstream_auth` rather than an outage. Jina AI and Firecrawl answer without a key.

## Skills

Skills are reusable instruction packs the model loads itself. Each skill has an id, name, when-to-use description, and instructions. Open Settings → Skills to enable, disable, reset, edit, add, or remove skills.

- The system prompt lists each enabled skill's id and description; the model calls the hidden `use_skill` tool with an id to load the full instructions before answering. There is no keyword matching, and `use_skill` never appears under Tools.
- Built-ins: `frontend-design` (Anthropic's official skill, included verbatim), `software-engineering`, `debugging`, `testing`, `code-review`, and `writing`. Coding expertise lives in these skills, not in the default system prompts.
- Custom skills validate their id and instructions before they are stored; malformed stored skills are skipped with a warning instead of breaking requests.

Default system prompts are `General` (general assistant behavior: follow instructions, be clear and accurate, reason when needed), `Creativity` (original, expressive, experimental ideas without fabricating facts), and `Concise`. Pick one from the prompt menu under the chat box.

## MCP servers (external tools)

The app can connect to any Model Context Protocol server over Streamable HTTP (Settings → MCP servers). Add a server, paste an optional `Authorization: Bearer ...` header block, press **Test connection & load tools**, and every tool the server lists joins the normal tool loop on the next message. Requests go straight from the browser to the server, so the server must allow this origin (CORS); headers are stored in this browser only and are never sent to this app's backend. Tool names are namespaced as `mcp_<server>_<tool>` (slugged, 64 characters max) and share the ordinary tool-round budget. Each server has its own switch, and the whole feature has a kill switch under Features; a disabled server or feature contributes no tools and cannot be called. Turning the Tools feature off disables MCP entirely. Tools are listed and called through `src/mcp.ts`; the connection is re-established per operation and nothing is cached server-side.

## Image generation

Settings → Tools → Image generation lets the model generate pictures through an OpenAI-compatible `/images/generations` endpoint (for example `gpt-image-1`, `dall-e-3`, or a Flux model behind a compatible API). Pick the endpoint and model, choose a size and images per call, and the `generate_image` tool appears in the tool loop. Anthropic endpoints cannot generate images. Results are written to durable local storage (IndexedDB/OPFS) and referenced by id in the tool result, so the chat, the context window, and localStorage never carry base64; the reply shows the images with Download and Open actions, and they survive a reload until the browser storage is cleared. The feature is off by default and has its own switch.

## Code execution

Settings → Tools → Code execution adds the model's `run_code` tool and is **off by default**. A snippet runs in a disposable Web Worker in this browser: it has no page DOM or app storage, each run starts a fresh worker, and the worker is terminated when the time limit (1–30 s) expires, so an infinite loop cannot freeze the app. Output is capped (5k–100k characters); code is capped at 20k characters. JavaScript also has its network APIs (`fetch`, XHR, WebSocket, `importScripts`) shadowed out, so a snippet cannot call out. Python uses [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly), downloaded from the configured URL on first use (about 10 MB) and cached by the browser afterwards; Python is a separate switch because of that download. **Load Python packages** (off by default) lets a snippet import Pyodide's prebuilt wheels — numpy, pandas, scipy, matplotlib and others: the imports are detected before the code runs, each wheel downloads once from the same URL and is browser-cached, then the sandbox closes its network paths before executing. Only packages in the Pyodide index work; there is no `pip install`. Python runs locally too, and the harness blocks its JS network APIs, but a runtime-internal path could still reach out, so keep Python off unless you trust the code. Unit tests for normalization, URL handling, formatting, and configuration errors live in `src/codesandbox.test.mjs`; the worker paths are verified in the browser because Node has no Web Worker.

## Voice input and output

With the Voice feature on (Settings → Voice), the composer shows a microphone button that dictates into the message box using the browser's SpeechRecognition (Chrome, Edge, and Safari; hidden in Firefox), and every reply can be read aloud with speechSynthesis. Language and speaking rate are configurable, one reply can be stopped, and **Read every new reply automatically** reads completed replies until it is turned off. Recognition may use the browser vendor's own cloud service; audio and speech never touch this app's backend. Turning the Voice feature off hides both controls.

## Sharing conversations

The Share button in the chat header posts a read-only snapshot to `/api/share` and copies a `#share/<id>` link. The snapshot contains the title, message text, byline, and timestamps and nothing else: no keys, settings, system prompts, attachments, workspace files, tool payloads, or reasoning traces ever leave the device, and the server sanitizes again on receipt. Readers get a read-only page that renders the transcript with the normal markdown pipeline. Shares are stored by the server that created them: Neon when `DATABASE_URL` is set (the `shared_chats` table is created on first use and RLS is enabled with no permissive policies), otherwise a bounded in-memory map intended for development. `POST /api/share` is same-origin only and both create and read share the per-IP rate limit.

## Installable app (PWA)

`public/manifest.webmanifest`, the generated `icon-192.png` / `icon-512.png` (and `icon.svg`), and `public/sw.js` make the app installable and keep the shell openable offline. The service worker is registered only in production builds, caches same-origin static requests stale-while-revalidate, serves navigations network-first with the cached shell as a fallback, and never caches `/api/*` (model and search responses are personal and always fetched live).

## Third-party notices

The `frontend-design` skill is Anthropic's work from https://github.com/anthropics/skills/tree/main/skills/frontend-design, included verbatim and licensed under the Apache License 2.0 © Anthropic.

## Production

Any Node host:

```sh
npm run build
npm start
```

Set `PORT` if the host assigns a port. The Node server serves `dist/` and exposes same-origin `/api/search`, `/api/extract`, `/api/health` and `/api/sync/*` routes. Configure the host to run `npm run build` during deployment and `npm start` as its web process.

### Cloudflare Workers (static assets + API)

`wrangler.jsonc` deploys one Worker that serves the built frontend from `dist/` and executes `/api/*` (the shared core in `server/api.mjs`, also used by `server.mjs`). `assets.run_worker_first` is limited to `/api/*`, so static asset requests never invoke the Worker and do not count against the Workers request quota; unknown `/api/*` paths always answer with JSON, never `index.html`. The asset layer uses `not_found_handling: "none"`, so missing files (including stale hashed chunks such as `/assets/foo.js`) 404 exactly like the Node server instead of answering with the HTML shell; the app routes entirely on the URL hash, so no unknown server path needs the shell.

```sh
npm run deploy        # npm run build && wrangler deploy
# or manually:
npm run build && npx wrangler deploy
```

Secrets are stored encrypted by Cloudflare and are never committed (reuse the same names as the Node environment):

```sh
npx wrangler secret put TINYFISH_API_KEY     # or any of: YOU_API_KEY, EXA_API_KEY
npx wrangler secret put FIRECRAWL_API_KEY    # Firecrawl also works keyless at lower limits
npx wrangler secret put BRIGHTDATA_API_KEY   # requires SEARCH_API_ZONE too
npx wrangler secret put SEARCH_API_KEY       # optional shared fallback for any provider
npx wrangler secret put SEARCH_API_ZONE      # Bright Data SERP zone
npx wrangler secret put DATABASE_URL         # optional Neon Postgres URL for cross-device sync
```

Optional plain-text vars (for example a `SEARCH_API_URL` endpoint override) can be set in `wrangler.jsonc` under `vars` or with `npx wrangler secret put`. For local `wrangler dev`, put the same names in `.dev.vars` (gitignored).

Verify a deployment (both must return JSON, never the app HTML):

```sh
curl -i https://<worker-host>/api/health
curl -i -X POST https://<worker-host>/api/search -H 'content-type: application/json' -d '{"query":"hello"}'
```

`POST /api/search` answers `missing_key` until a browser key (Settings → Tools → Web search) or a server secret is configured. `npx wrangler tail` streams Worker logs for routing and failure diagnostics.

Workers Free plan notes: 100,000 Worker requests/day, 10 ms CPU per invocation, 50 subrequests per request; static asset requests are unmetered. Rate limits and search responses are kept in memory per isolate, so on Cloudflare they are approximate — each isolate counts and caches on its own and a burst can exceed the nominal limit until isolates recycle — while the single-process Node host enforces both exactly. Provider retries are bounded. Token sync payloads of several MB can exceed the free 10 ms CPU budget while hashing/parsing — keep sync payloads small or use Workers Paid for very large exports. Third-party search providers bill per their own plans (this app sends searches with your key); Firecrawl search works keyless at lower limits.

## Durable storage and device sync

Settings stay in `localStorage` (`byok.v1`). Chats, workspaces, and attachment bytes mirror to IndexedDB, with large blobs in OPFS where available (`src/storage/durable.ts`). Migration is automatic in place: the first boot copies existing history to durable storage, restores attachment bytes after reload, and keeps working when `localStorage` was quota-pruned. The storage meter in Settings → Data controls shows settings vs durable usage with Compact actions, plus background compaction every 5 minutes and per-chat `.md` + `.json` export from the sidebar.

Token sync links two devices with one super-long token (`byok1-<id>-<secret>`, `src/storage/sync.ts`). Generate it on device A, link it on device B (only the masked `byok1-abc…xyz` form is shown; Copy takes the full token). On first link you choose how to combine the two stores — merge both, take the other device's data, or use this device's data — and the merge rules (`src/storage/syncMerge.ts`) never duplicate data: chats union by id (the richer copy wins and identical conversations under different ids collapse), folders with the same name become one folder with their chats repointed at it, workspaces union by id with their revisions unioned in time order, id-keyed collections (endpoints, playlists, prompts, commands, skills, memories, todos) union by id, and record maps and string lists merge key by key. After that, sync is automatic: the app pulls and smart-merges when it opens, when the tab regains focus, and every few minutes, and pushes local changes after a short quiet period; Settings → Data controls keeps an Automatic sync toggle plus Unlink, with manual Push now / Pull & merge now shown when automatic sync is off. Payloads carry `{ v, storeVersion }` and older apps migrate automatically; newer payloads show a warning instead of breaking. Every store setting (endpoints and keys, prompts, tools, skills, features, appearance, workspace/document/voice/image/code preferences, the Gist token, folders, memories and so on) rides the snapshot; only live runtime state (the open draft, busy flags, notices and the research panel) plus the device-local sync token, automatic-sync toggle and last-sync time stay on the device. Before upload the snapshot is encrypted with the sync token itself — AES-GCM-256, key derived with PBKDF2-SHA256 (`src/storage/backupCrypto.ts`) — so the server only stores an opaque `{ encrypted }` envelope it cannot read; plaintext payloads pushed by older builds are still accepted on pull. The server stores only `sha256(secret)` plus that envelope:

- `POST /api/sync/push` `{ token, payload }` → `{ ok, updatedAt, backend }`
- `GET /api/sync/pull` with `Authorization: Bearer <token>` (or `POST` with `{ token }`) → `{ payload, storeVersion, exportVersion, updatedAt }`
- `GET /api/sync/status` → `{ backend: 'neon' | 'memory' | 'unavailable', configured }`

Tokens are read from the `Authorization` header or the POST body only; a token in the query string is refused so it can never reach access logs. State-changing sync calls are same-origin only, and `/api/search`, `/api/extract`, `/api/reader` and `/api/sync/*` are each limited to 30 requests per minute per client address (Cloudflare's `cf-connecting-ip`, or the socket address on Node — set `TRUST_PROXY=1` on a Node host behind a trusted reverse proxy to use `cf-connecting-ip`/`x-forwarded-for`).

Set `DATABASE_URL` to a Neon Postgres URL for persistence (applying `server/neon-schema.sql` is recommended; RLS is deny-by-default so only the API service role touches `sync_states`, and share snapshots use `shared_chats`, which the API also creates on first use). Without it the server uses in-memory storage for dev (bounded to the 200 most recent slots). If `DATABASE_URL` is set but the database cannot be reached, sync fails with a 503 `sync_unavailable` instead of silently writing to memory, so devices can never diverge unnoticed. Sync payloads are encrypted on the device before upload (see above), so the server never sees plaintext; the optional password field in the Export data modal encrypts the whole file with AES-GCM-256 + PBKDF2 (`src/storage/backupCrypto.ts`), and importing an encrypted file asks for that password before it can be read. Background push/pull is best-effort and never blocks the UI. The sync payload is capped at 8 MB (the client refuses to encrypt more than ~5.7 MB of JSON, since base64 inflates it by about a third).

The search toggle in Settings → Tools allows automatic grounding for questions that request browsing, research, verification, or current information; it does not search ordinary messages. `@search(query)` runs an explicit search. Results are deduplicated, selected across domains, capped, and sent as snippets with stable source IDs and URLs. Retrieved text is marked as untrusted evidence in the prompt. The model is asked to cite every factual claim inline as `[S1]`, `[S2]`, etc.

## Grounded replies: citations, Sources, page reader

Each assistant reply collects its successful `search` and `fetch_page` calls into one deduped source list (`src/citations.ts`). Bare `[S1]` / `[Source S1]` tokens in the reply are linkified before rendering; in Pills mode (Settings → Tools → Sources & transparency) they render as numbered pills that jump to the matching entry in the Sources list below the reply. Links mode renders plain markdown links instead.

### Making the model remember to cite

The citation instruction is a **standing rule in the system prompt** (`citationRule` in `src/citations.ts`), not a line buried in one tool result. It is re-sent with every round of the tool loop, so the model still has it in view in the round that writes the final reply — the round where it used to drop it. The rule says what to cite, how to format it (`[S1]`, grouped as `[S1, S2]`), that ids must never be invented or renumbered, that it applies again after every further tool call, and that a claim with no source should be called unsourced rather than cited. With inline citations off, the rule instead tells the model not to add markers at all.

Citation ids are numbered **for the whole reply**, not per search: the first source of the reply is `S1`, the next is `S2`, and a second search continues at `S3` instead of restarting at `S1` (the search backend numbers every response from `S1`, so the app renumbers them). A page read is a source like any other — it carries its own `[Source S<n>]` id and the reader result tells the model to cite it as `[S<n>]` — so a claim taken from a page read can be attributed. Every `[S<n>]` the model writes therefore resolves to exactly one page in the Sources list, and a stale id from an earlier message is never reused (the rule asks for the source to be named in words instead).

Every grounded reply shows a **Sources** button below the workspaces and above the message options. Expanding it lists each source with its truncated snippet, host, engine, and query, plus per-source actions: **Open** (new tab), **Read page** (full excerpt via the reader), **Copy link**, **Copy cite**. Unknown ids and uncited grounded replies are flagged, with optional strict warnings.

`GET /api/extract?url=…` reads one public `http(s)` page through the backend (SSRF-blocked private hosts, 8s default timeout, 1.5MB HTML cap, 12k-character default excerpt, 10-minute cache) and backs both the `fetch_page` model tool and the per-source Read page button. It accepts optional `timeoutMs`, `maxChars` (up to 50k), `maxRetries` and `retryBaseMs` parameters from the reader settings. `POST /api/reader` does the same through a different reader API when one is configured (Jina, Firecrawl, Exa, or your own service), with a fallback to the built-in reader when the reader API fails. The process log shows each search as `Web search · query (N sources · provider)` and each read as `Page reader · title · host`; the live status reads Searching… / Reading page…. Related settings (citation style, expand-by-default, strict warnings) live in Settings → Tools → Web search → Sources & transparency; the reader settings (page reader on/off, reader API and key, page timeout, text kept per page, page retries, page summary model) live under the Page reader tool in Settings → Tools → Page reader.

### Page summaries (reader subagent)

Settings → Tools → Page reader can send every fetched page to a **second model** before the main model sees it. Pick the exact summary model (endpoint **and** model id) and a summary length; the subagent returns a clean, self-contained summary of the page, and only that summary is added to the main context, so a 40,000-character article no longer crowds out the conversation. The summary model is told to keep concrete facts, numbers, dates and short quotes, to ignore any instructions found inside the page, and to invent nothing. A failed or unconfigured summary falls back to the raw excerpt, and the process log records the summary call, its token use and its cost.

## Documents: PDFs, Office, archives, transcripts, OCR

Attachments are read locally (`src/docs.ts`, no new dependencies): PDF text layers, `.docx` / `.odt` / `.rtf` / `.pptx` / first-sheet `.xlsx`, `.zip` / `.gz` expansion (up to 25 entries), and audio/video with transcript pairing. Extracted text travels inline as `[file: name]` blocks so every endpoint can read it — PDFs no longer show `[omitted]` on OpenAI endpoints, and only scanned PDFs without a text layer still need Anthropic native reading or OCR. Pair a `.vtt` / `.srt` transcript with a matching audio/video name, or paste a page URL with Attach page from URL.

Image text extraction is opt-in (Settings → Chats → Documents): Auto transcribes images only when no usable endpoint takes images natively; Always transcribes every image; a per-image button transcribes on demand. Transcription uses your own vision endpoint (configurable OCR endpoint/model, cached per image). Per-document budgets (15k–200k chars, default 60k) sit under the message-wide text budget. Legacy `.doc` / `.xls` / `.ppt`, `.7z` / `.tar` / `.rar`, and oversized files still report guidance instead of silent failure.

## Workspaces: previews, diffs, patches, templates

The model writes file artifacts with `workspace_upsert`, now with cheaper operations: `patch` applies a small unified diff (fuzzy context matching, precise rejection errors), `files[]` batches several changes into one revision, and `template` (`static-site`, `python-script`, `markdown-notes`) scaffolds a starter project with `createNew` — all validated locally before anything is stored (`src/workspace.ts`, no external compute). Up to 16 files per workspace.

The side panel adds Code / Preview / Diff tabs per file: sandboxed HTML previews (scripts, frames, and event handlers stripped, iframe fully sandboxed), rendered Markdown, SVG images, and CSV tables. The Diff tab compares against the previous version or any older revision, with a changed-files summary to jump between. Tiles show `+added −removed` line stats, workspaces rename inline, and you can edit or delete files yourself (saved as Local edit revisions the model keeps building on), ask about a file in chat, or share a revision as a GitHub Gist with your own optional token (Settings → Workspace; saved with your settings and included in the encrypted sync payload when device sync is on). Project templates are catalogued in Settings → Workspace with one-click scaffold prompts.

## Recall, search, and smart routing

Memory recall runs on-device by default (`src/recall.ts`, BM25 ranking, no model calls, works offline): Holistic sends everything, Contextual keeps the top 8 relevant entries, Specific the top 4 above a relevance floor. The legacy classifier-call method remains selectable in Settings → Memory. New memories merge into near-duplicates automatically (token overlap), and Check duplicates lists the rest with one-click merges. The process log records which entries were picked and why.

The sidebar search ranks every chat with the same engine — title hits first, then the best matching message with a snippet — and jumping to a result opens the chat, scrolls to the message, and highlights it briefly.

Routing learns from experience: every attempt records latency and failures per endpoint + model (Settings → Playlists shows the table, resettable, backed up with stats). The routing mode orders candidates by list order (default), observed speed (untried models go first), or input price (unpriced last); a playlist classifier, when set, still picks first and its decisions are cached per request for an hour. The process log notes reorderings and cache hits.

## Checks

Run the search helper tests with `node --test` and create a production build with `npm run build`. Search provider tests live in `server/search.test.mjs`, citation tests in `src/citations.test.mjs`, reader tests in `server/extract.test.mjs`, document parser tests in `src/docs.test.mjs`, recall and routing tests in `src/recall.test.mjs`, model provider-routing tests in `src/providers.test.mjs`, MCP tests in `src/mcp.test.mjs`, image-generation tests in `src/imagegen.test.mjs`, code-sandbox tests in `src/codesandbox.test.mjs`, voice tests in `src/voice.test.mjs`, client share tests in `src/share.test.mjs`, and share server tests in `server/share.test.mjs`. `npm test` also runs the Node integration suite (`tests/integration/server.test.mjs`), the citation-flow suite (`tests/citationFlow.test.mjs`), the deep-research flow suite (`tests/researchFlow.test.mjs`), and the Worker suite (`tests/worker/worker.test.mjs`); `npm run test:worker` boots `wrangler dev` and checks the deployed routing contract (static assets, unknown-path 404s, `/api/*`) end to end after `npm run build`.
