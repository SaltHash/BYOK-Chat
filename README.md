# BYOK Chat

A highly customizable, browser-based chat client supporting custom endpoints. Model provider keys are saved in the browser and sent directly to the configured provider. The included Node service handles web search and does not store model credentials.

## Run locally

Run SearXNG through Podman Compose with its HTTP port bound to `127.0.0.1:8080` and JSON search enabled. Then install dependencies and start the app:

```sh
npm install
npm run dev
```

The backend defaults to `SEARXNG_BASE_URL=http://127.0.0.1:8080`. Set that variable in the server environment to use another reachable SearXNG URL. No search API key is needed for SearXNG mode. Keep SearXNG bound to loopback; when the app backend itself runs in a container, configure a private host/container route to SearXNG rather than exposing its port publicly.

Optional server limits can be configured with `SEARCH_TIMEOUT_MS` (default 8000), `SEARCH_MAX_RESULTS` (default 8), `SEARCH_MAX_SNIPPET_CHARS` (default 1800), and `SEARCH_EVIDENCE_BUDGET` (default 12000). Result and evidence limits are capped at 8 results, 3000 characters per snippet, and 16000 total evidence characters.

## AI search providers

Search is bring-your-own-key: paste a provider key in Settings → Tools → Web search and grounding. It is stored only in the browser (like model keys) and sent with each search request; the server never stores browser keys. Server-side keys remain supported as a shared fallback when the browser sends none. Providers: TinyFish, You.com, Exa, Firecrawl, or Bright Data (plus SearXNG). Choose the mode in Settings → Tools:

- `API`: use the selected API provider with your own key.
- `SearXNG`: use your self-hosted instance.

Enable `Fall back onto the other` to retry with the other search when the primary is missing its key or fails.

Server configuration:

```sh
SEARCH_MODE=api
SEARCH_FALLBACK=true
SEARCH_API_PROVIDER=tinyfish
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

`/api/search` accepts `{ query, mode, provider, fallback, apiKey, zone }` and returns `{ query, results, searchedAt, provider, mode }`. `/api/health` reports the configured mode, fallback default, default provider, and which providers have server keys.

Failures return structured JSON `{ error, code, provider, retryable }` with a matching HTTP status instead of a blanket 503:

- `400 missing_key` / `missing_zone`: no browser or server key (or Bright Data zone) is configured. Not retried.
- `429 rate_limited`: the provider is throttling; includes a `retry-after` hint. Retried with backoff, then reported.
- `502 upstream_auth`: the provider rejected the key (HTTP 401/403). Check the key; not retried.
- `502 billing`: the provider reported a billing problem (HTTP 402, e.g. depleted You.com credits). Not retried.
- `502 bad_request` / `bad_response`: the provider rejected the request or returned something unusable. Not retried.
- `503 upstream_unavailable`, `timeout`, or `network`: the provider or SearXNG could not be reached after bounded retries (`SEARCH_MAX_RETRIES`, default 2, plus `SEARCH_RETRY_BASE_MS`). Only these are genuine outages.

Transient failures (HTTP 429/502/503/504, timeouts, connection errors) are retried with exponential backoff; permanent errors (other 4xx, missing keys) are never retried. The server logs provider, mode, error code, and upstream status for diagnostics, and never logs API keys, zones, or authorization headers.

Provider request details (verified against each provider's official documentation):

- TinyFish: `GET https://api.search.tinyfish.ai?query=…` with an `X-API-Key` header ([docs](https://docs.tinyfish.ai/search-api/reference)).
- You.com: `POST https://ydc-index.io/v1/search` with an `X-API-Key` header and `{ query, count }` ([docs](https://you.com/docs/api-reference/search)).
- Exa: `POST https://api.exa.ai/search` with an `X-API-Key` header and `{ query, type: "auto", numResults, contents: { highlights: true } }` ([docs](https://exa.ai/docs/reference/search)).
- Firecrawl: `POST https://api.firecrawl.dev/v2/search` with an optional `Authorization: Bearer` header and `{ query, limit }`. The key is optional: search works keyless at lower limits ([docs](https://docs.firecrawl.dev/api-reference/endpoint/search)).
- Bright Data: `POST https://api.brightdata.com/request` with an `Authorization: Bearer` header and `{ zone, url, format: "raw", data_format: "parsed_light" }`; a SERP zone is required ([docs](https://docs.brightdata.com/products/serp-api/introduction)).

Without any keys, You.com and Exa answer with HTTP 402 (billing/payment required) and Bright Data/TinyFish with HTTP 401, which the backend surfaces as `billing` / `upstream_auth` rather than an outage.

## Skills

Skills are reusable instruction packs the model loads itself. Each skill has an id, name, when-to-use description, and instructions. Open Settings → Skills to enable, disable, reset, edit, add, or remove skills.

- The system prompt lists each enabled skill's id and description; the model calls the hidden `use_skill` tool with an id to load the full instructions before answering. There is no keyword matching, and `use_skill` never appears under Tools.
- Built-ins: `frontend-design` (Anthropic's official skill, included verbatim), `software-engineering`, `debugging`, `testing`, `code-review`, and `writing`. Coding expertise lives in these skills, not in the default system prompts.
- Custom skills validate their id and instructions before they are stored; malformed stored skills are skipped with a warning instead of breaking requests.

Default system prompts are `General` (general assistant behavior: follow instructions, be clear and accurate, reason when needed), `Creativity` (original, expressive, experimental ideas without fabricating facts), and `Concise`. Pick one from the prompt menu under the chat box.

## Third-party notices

The `frontend-design` skill is Anthropic's work from https://github.com/anthropics/skills/tree/main/skills/frontend-design, included verbatim and licensed under the Apache License 2.0 © Anthropic.

## Production

```sh
npm run build
npm start
```

Set `PORT` if the host assigns a port. The Node server serves `dist/` and exposes same-origin `/api/search` and `/api/health` routes. Configure the host to run `npm run build` during deployment and `npm start` as its web process. Ensure the backend can reach SearXNG through a private route and keep the SearXNG port bound to loopback or a private container network.

## Durable storage and device sync

Settings stay in `localStorage` (`byok.v1`). Chats, workspaces, and attachment bytes mirror to IndexedDB, with large blobs in OPFS where available (`src/storage/durable.ts`). Migration is automatic in place: the first boot copies existing history to durable storage, restores attachment bytes after reload, and keeps working when `localStorage` was quota-pruned. The storage meter in Settings → Data controls shows settings vs durable usage with Compact actions, plus background compaction every 5 minutes and per-chat `.md` + `.json` export from the sidebar.

Token sync links two devices with one super-long token (`byok1-<id>-<secret>`, `src/storage/sync.ts`). Generate it on device A, paste it on device B, then Push/Pull from Settings → Data controls. Payloads carry `{ v, storeVersion }` and older apps migrate automatically; newer payloads show a warning instead of breaking. The server stores only `sha256(secret)` plus the payload:

- `POST /api/sync/push` `{ token, payload }` → `{ ok, updatedAt, backend }`
- `GET /api/sync/pull?token=…` (or POST) → `{ payload, storeVersion, exportVersion, updatedAt }`
- `GET /api/sync/status` → `{ backend: 'neon' | 'memory', configured }`

Set `DATABASE_URL` to a Neon Postgres URL for persistence (apply `server/neon-schema.sql` first; RLS is deny-by-default so only the API service role touches `sync_states`). Without it the server uses in-memory storage for dev. Payloads are unencrypted on the server; use the optional password box for AES-GCM-256 + PBKDF2 encrypted file backups (`src/storage/backupCrypto.ts`). Auto-push after each reply is optional and best-effort.

The search toggle in Settings → Tools allows automatic grounding for questions that request browsing, research, verification, or current information; it does not search ordinary messages. `@search(query)` runs an explicit search. Results are deduplicated, selected across domains, capped, and sent as snippets with stable source IDs and URLs. Retrieved text is marked as untrusted evidence in the prompt. The model is asked to cite every factual claim inline as `[S1]`, `[S2]`, etc.

## Grounded replies: citations, Sources, page reader

Each assistant reply collects its successful `search` calls into one deduped source list (`src/citations.ts`), renumbered `S1…Sn` in first-seen order. Bare `[S1]` / `[Source S1]` tokens in the reply are linkified before rendering; in Pills mode (Settings → Tools → Sources & transparency) they render as numbered pills that jump to the matching entry in the Sources list below the reply. Links mode renders plain markdown links instead.

Every grounded reply shows a **Sources** button below the workspaces and above the message options. Expanding it lists each source with its truncated snippet, host, engine, and query, plus per-source actions: **Open** (new tab), **Read page** (full excerpt via the reader), **Copy link**, **Copy cite**. Unknown ids and uncited grounded replies are flagged, with optional strict warnings.

`GET /api/extract?url=…` reads one public `http(s)` page through the backend (SSRF-blocked private hosts, 8s timeout via `EXTRACT_TIMEOUT_MS`, 1.5MB HTML cap, 12k-character excerpt, 10-minute cache) and backs both the `fetch_page` model tool and the per-source Read page button. The process log shows each search as `Web search · query (N sources · provider)` and each read as `Page reader · title · host`; the live status reads Searching… / Reading page…. Related settings (citation style, expand-by-default, page reader on/off, strict warnings) live in Settings → Tools → Web search → Sources & transparency.

## Documents: PDFs, Office, archives, transcripts, OCR

Attachments are read locally (`src/docs.ts`, no new dependencies): PDF text layers, `.docx` / `.odt` / `.rtf` / `.pptx` / first-sheet `.xlsx`, `.zip` / `.gz` expansion (up to 25 entries), and audio/video with transcript pairing. Extracted text travels inline as `[file: name]` blocks so every endpoint can read it — PDFs no longer show `[omitted]` on OpenAI endpoints, and only scanned PDFs without a text layer still need Anthropic native reading or OCR. Pair a `.vtt` / `.srt` transcript with a matching audio/video name, or paste a page URL with Attach page from URL.

Image text extraction is opt-in (Settings → Tools → Documents): Auto transcribes images only when no usable endpoint takes images natively; Always transcribes every image; a per-image button transcribes on demand. Transcription uses your own vision endpoint (configurable OCR endpoint/model, cached per image). Per-document budgets (15k–200k chars, default 60k) sit under the message-wide text budget. Legacy `.doc` / `.xls` / `.ppt`, `.7z` / `.tar` / `.rar`, and oversized files still report guidance instead of silent failure.

## Workspaces: previews, diffs, patches, templates

The model writes file artifacts with `workspace_upsert`, now with cheaper operations: `patch` applies a small unified diff (fuzzy context matching, precise rejection errors), `files[]` batches several changes into one revision, and `template` (`static-site`, `python-script`, `markdown-notes`) scaffolds a starter project with `createNew` — all validated locally before anything is stored (`src/workspace.ts`, no external compute). Up to 16 files per workspace.

The side panel adds Code / Preview / Diff tabs per file: sandboxed HTML previews (scripts, frames, and event handlers stripped, iframe fully sandboxed), rendered Markdown, SVG images, and CSV tables. The Diff tab compares against the previous version or any older revision, with a changed-files summary to jump between. Tiles show `+added −removed` line stats, workspaces rename inline, and you can edit or delete files yourself (saved as Local edit revisions the model keeps building on), ask about a file in chat, or share a revision as a GitHub Gist with your own optional token (Settings → Workspace, stored only in this browser). Project templates are catalogued in Settings → Workspace with one-click scaffold prompts.

## Recall, search, and smart routing

Memory recall runs on-device by default (`src/recall.ts`, BM25 ranking, no model calls, works offline): Holistic sends everything, Contextual keeps the top 8 relevant entries, Specific the top 4 above a relevance floor. The legacy classifier-call method remains selectable in Settings → Memory. New memories merge into near-duplicates automatically (token overlap), and Check duplicates lists the rest with one-click merges. The process log records which entries were picked and why.

The sidebar search ranks every chat with the same engine — title hits first, then the best matching message with a snippet — and jumping to a result opens the chat, scrolls to the message, and highlights it briefly.

Routing learns from experience: every attempt records latency and failures per endpoint + model (Settings → Playlists shows the table, resettable, backed up with stats). The routing mode orders candidates by list order (default), observed speed (untried models go first), or input price (unpriced last); a playlist classifier, when set, still picks first and its decisions are cached per request for an hour. The process log notes reorderings and cache hits.

## Checks

Run the SearXNG search helper tests with `node --test` and create a production build with `npm run build`. Search provider tests live in `server/search.test.mjs`, citation tests in `src/citations.test.mjs`, reader tests in `server/extract.test.mjs`, document parser tests in `src/docs.test.mjs`, recall and routing tests in `src/recall.test.mjs`.
