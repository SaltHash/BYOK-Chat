# Feature audit and improvement review

**Audit date:** 7 November 2026  
**Scope:** the complete local-first chat app in this repository: UI, store, tools, persistence, sync, backend, and the new tool-approval layer.  
**Method:** source walk-through of every top-level feature and settings area, plus the existing automated checks. Status is about maturity, not whether a feature exists.

Legend: **A** mature and well covered · **B** works, with a meaningful gap · **C** thin or fragile · **D** absent or only a stub.

## Executive summary

The app is unusually complete for a single-user, bring-your-own-key chat client. Its strongest areas are local-first data ownership, the breadth of model-provider support, grounded search and research, workspace file generation, streaming UX, and the depth of settings. The weakest areas are not missing screens; they are **cross-feature seams**: conversations branch by copying rather than by sharing a tree, model and sampling settings are global rather than per-chat, approval is session-only, MCP lacks per-server policy and lifecycle controls, and large settings/data surfaces are only partly decomposed.

The single highest-value product change is a **native conversation tree**. The existing Branch action is a safe copy, but it loses lineage, workspace revisions, and the ability to compare or return to the original path. The second is **making tool permission a durable, inspectable policy**, not just a transient prompt. This round lays the policy foundation for that work.

---

## 1. Chat and conversation

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 1.1 | **Streaming replies** | SSE-style streamed text with live markdown, stop/abort, token and speed display. | Add a stream-resume/replay path for dropped connections; expose first-token latency in the process row. |
| 1.2 | **Concurrent chats** | Each chat can stream independently (`busyChats`); switching chats does not stop the other reply. | Add a global “replies running” tray and per-chat queue visibility; consider a concurrency cap by endpoint. |
| 1.3 | **New chat** | Creates a blank draft, preserves the previous chat; supports “new chat” and “temporary chat” startup modes. | Make the default startup mode explicit in the welcome flow and show why a blank chat was opened. |
| 1.4 | **Temporary chats** | Expire by hours or when leaving; removable, promotable to permanent, sorted by remaining time. | Add a countdown and one-click “keep forever”; warn before leaving with an unsent draft. |
| 1.5 | **Pinned chats** | Pins sort above ordinary chats and survive reloads. | Add pin limits or a separate “pinned” section that can collapse, so the list does not crowd recent work. |
| 1.6 | **Projects/folders** | Create, rename, delete, open, move chats, drag-and-drop rows, project context files, optional shared workspace context. | Add nested projects (or tags) and bulk move/archive; project deletion currently only unassigns chats. |
| 1.7 | **Archive** | The row's default action is a one-click archive icon; hold Shift to turn it into permanent delete. Archived chats leave every normal section and have a dedicated view and restore action. Retention defaults to 60 days, adjustable from 1–180 days or Never. | Add archive search and “archive all older than…” bulk action. |
| 1.8 | **Chat search** | Sidebar substring filtering plus BM25 message recall, snippets, jump-to-message, and highlight/flash. | Add filters (role, tool, source, date), saved searches, and result pagination; currently caps at 30 hits. |
| 1.9 | **Rename** | Inline rename with Enter/Escape and double-click. | Preserve auto-title provenance so a manual rename is not overwritten by title generation. |
| 1.10 | **Automatic titles** | First reply can generate a short title through a helper model. | Add a title-style setting, debounce, and “regenerate title” action; show token cost of title calls. |
| 1.11 | **Branch** | `branch(mid)` copies messages up to the selected message into a new chat with fresh IDs, title `(branch)`, and the same project. | Replace with a native tree: parent chat/message pointers, branch labels, lineage navigation, workspace snapshots, and compare/merge. See §17. |
| 1.12 | **Edit and resend** | Editing a user message resends it and replaces later replies; UI warns to branch first. | Make “keep the current thread” a first-class choice in the edit dialog: overwrite, branch, or create a variant. |
| 1.13 | **Reply variants** | Regenerate stores alternatives and lets the user step between them. | Add side-by-side compare and per-variant model/cost metadata; make variant choice persist into branch actions. |
| 1.14 | **Regenerate** | Re-runs the last assistant reply. | Add “regenerate with model X” and “retry failed step” without rerunning successful tools. |
| 1.15 | **Delete message** | Inline two-step confirmation; deleting a message can invalidate compaction state. | Add undo for message/chat deletion, or a short-lived trash bin. Shift-delete on a chat bypasses confirmation. |
| 1.16 | **Reply pinning** | A pinned reply stays in model context and appears under the header. | Show pinned context in the context meter; add unpin-all and conflict warnings when several pins are large. |
| 1.17 | **Reply bookmarks** | Toggle a bookmark; the sidebar lists bookmarked replies. | Add bookmark notes/tags and export just bookmarks; currently the list is flat. |
| 1.18 | **Copy** | Rich copy, Shift for Markdown, Ctrl/Cmd for plain text, with citation cleanup. | Add copy-as-JSON/HTML and a “copy without tool calls” option. |
| 1.19 | **Export** | Per-chat `.md` + `.json`, full chat export from Header, config export separately. | Add date-range/selective message export, PDF, and import of an exported chat back into the app. |
| 1.20 | **Share link** | Read-only snapshot; private/auto-update flags; history; current link reuse; keys/attachments/tool payloads stripped. | Add expiry, revoke, password/one-time links, view counts, and a “shared version” indicator. |
| 1.21 | **Quoted selection** | Select text in a reply and reply with a quote prepended; quote survives copy/branch/sync. | Support multi-quote selection and quote-to-new-chat. |
| 1.22 | **Prompt history** | ArrowUp/ArrowDown walks sent prompts this session; preserves the unsent draft. | Persist history across reloads (opt-in) and search it; show “session only” in the UI. |
| 1.23 | **Queued messages** | While a reply streams, sends can queue; queue count is shown; queue mode is configurable. | Add queue editing/reordering/cancel and a “send now (interrupt)” choice. |
| 1.24 | **Drafts** | Draft text is stored per chat and restored on switch. | Add draft timestamps and a “discard draft” affordance; currently silent. |
| 1.25 | **Reply actions visibility** | Hover/focus on desktop, always-on option, mobile visible. | Honor keyboard focus consistently on touch-capable laptops; test with screen readers. |
| 1.26 | **Read aloud** | Browser speech synthesis, optional auto-read, language/rate. | Add per-message voice selection, sentence highlighting, and pause/resume across replies. |
| 1.27 | **Process log** | Per-reply tool rounds, calls, results, timing, truncation, denials, live deltas, collapse-all. | Add retry-one-step, copy call payload, filter to failures, and a compact summary row. See §17/18. |
| 1.28 | **Context meter and compaction** | Token ring, manual context limit, chars/token estimate, compaction through a marker. | Show context composition by source; add “compact now”, pin-aware budgeting, and a warning before truncation. |
| 1.29 | **Scroll/jump** | Jump to a recalled message, flash highlight, preserve position, virtualized rows initially. | True two-sided windowing remains a backlog item; collapsed history can still grow unbounded. |
| 1.30 | **Startup behavior** | Recent chat, new chat, temporary chat, or first permanent chat. | Add “restore all windows” and make temporary expiry visible before the tab is closed. |
| 1.31 | **Empty/onboarding** | Welcome flow, recommended tools, theme and appearance choices, sample endpoint guidance. | Make the “skip setup” path remember its choice and offer a one-click demo endpoint (local Ollama detection). |

## 2. Composer and input

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 2.1 | **Rich input** | Content-editable composer with IME handling, autosize, drag/drop, paste, attachments, and quote banner. | Add a plain-text fallback and a visible character/token estimate for the current draft. |
| 2.2 | **Slash commands** | `/` opens enabled commands filtered by name; command applies a system prompt and template and runs on a chosen endpoint/playlist. | Add command arguments validation, preview of the final prompt, and per-command history. |
| 2.3 | **Tool mentions** | `@tool` menu; direct tool invocation with typed arguments; enabled tools sorted first. | Add fuzzy search, inline schema/help, and a “run without sending to the model” confirmation. |
| 2.4 | **Research mention** | `@research(` opens the research flow and tier picker. | Add saved research briefs and a direct “continue last research” entry. |
| 2.5 | **Search banner** | Typed/armed search is shown as a pill/banner; can enable search from the warning. | Preserve banner state when toggling tools off/on; warn when search is enabled but no provider key exists. |
| 2.6 | **Attachments** | File picker, drag/drop, paste; images, docs, audio/video, archives; previews and extraction. | Add folder upload, per-file progress/cancel, and an explicit “keep original name” override. |
| 2.7 | **Attachment ordering** | Pointer and keyboard reorder controls with a live region. | Restore focus to the moved attachment after reorder (already noted in the backlog) and add remove/undo. |
| 2.8 | **Dictation** | Web Speech recognition inserts text; language/rate and permission handling. | Add push-to-talk, interim transcript display, and graceful fallback when the browser has no speech API. |
| 2.9 | **Read aloud** | Browser speech synthesis from the reply action. | Add per-message voice, speed, and stop controls; share the same voice settings with dictation. |
| 2.10 | **Send / stop / queue** | Send while idle; Stop aborts the current reply; queue mode sends after it finishes. | Add interrupt-and-send and a keyboard-visible queue state. |
| 2.11 | **Model picker** | Provider-grouped model menu, favorites, search, model migration when selection disappears. | Add per-chat model pinning (see §3.14), recent models, and cost/context badges. |
| 2.12 | **Prompt picker** | System prompt override per chat plus global prompt. | Add prompt preview, variables validation, and per-chat prompt history. |
| 2.13 | **Tool access lock** | Four-level lock: Full, Standard, Restricted, Disabled; opens the same policy used by Settings. **New in this round.** | Add an “always allow for this chat” action, a pending-approval badge in the sidebar, and auto-settle the queue when the mode changes. |
| 2.14 | **Per-tool approval** | Approval toggles in each tool card, the device-tool enable dialog, and Memory/Image generation/Code execution. **New in this round.** | Add a “reset to recommended” action and a policy summary count (“3 tools ask”). |
| 2.15 | **Mentions and pills** | Mentions are tokenized into pills; typed text is stripped when a typed mention is sent. | Add keyboard navigation hints and a way to remove a pill without editing raw text. |
| 2.16 | **Prompt variables** | `{date}`, `{weekday}` and related values are expanded at send time. | Add a variable picker and validation for unknown variables. |
| 2.17 | **Composer layout** | Chat width, padding, glass opacity/blur, text scale, style preset. | Add a compact mode for small screens and a per-device layout override. |
| 2.18 | **Error recovery** | Failed endpoint calls can be reported, retried, and fall back through playlists. | Surface a single “best next action” (retry, switch model, open settings) instead of raw provider errors. |

## 3. Models, endpoints, and routing

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 3.1 | **OpenAI-compatible endpoints** | Base URL, key, model list, capabilities, context, price. | Validate capabilities automatically; add a model-catalog refresh with diff and rollback. |
| 3.2 | **Anthropic Messages endpoints** | Native Anthropic request shape and streaming. | Add Anthropic prompt-caching controls and beta-header visibility. |
| 3.3 | **Provider presets** | Built-in presets and custom endpoints; model discovery and remembered catalog URLs. | Add “test without saving”, and show which preset fields are required. |
| 3.4 | **cURL import** | Paste a request to derive URL, key, model, and headers. | Add redaction preview before import and support more shell quoting variants. |
| 3.5 | **API key storage** | Keys stay in browser storage and are sent to the chosen provider or relay. | Add optional passphrase-wrapped key storage and a per-key “last used” audit. |
| 3.6 | **Endpoint health** | `/api/health` reports search keys; test rows and test-all endpoints. | Add a live latency/error trend per endpoint and a scheduled health probe with user consent. |
| 3.7 | **Enable/disable endpoints** | Disabled endpoints are skipped by routing and shown as unavailable. | Add a “temporarily disable until” state and warn before disabling the selected model. |
| 3.8 | **Model favorites** | Favorites are stored as `endpoint::model` and shown in the picker. | Add folders/tags and “favorite this model for this project”. |
| 3.9 | **Playlists** | Ordered model fallback, optional classifier routing, routing rules, per-entry reorder. | Add named fallback chains reusable across endpoints (backlog), latency/cost-aware ordering, and per-chat playlist pinning. |
| 3.10 | **Classifier routing** | A helper model picks a playlist entry from a JSON response; invalid picks fall back. | Show the classifier’s reasoning/choice in the process log and add a dry-run “route this prompt” button. |
| 3.11 | **Helper models** | Title, classification/recall, OCR, page summary, auto-title, and effort models. | Show a single “helper routing” diagram and detect missing capabilities before a reply needs them. |
| 3.12 | **Sampling parameters** | Temperature, top-p, max tokens, model defaults; advanced header popover. | Make parameters per-chat (backlog) and add a request preview with estimated cost. |
| 3.13 | **OpenRouter/provider pinning** | Provider preference/pinning is passed through request options. | Explain when a pinned provider is unavailable and offer automatic fallback with a visible warning. |
| 3.14 | **Per-chat model and params** | Currently global; switching chats changes the model for the next send. | **High priority:** snapshot endpoint/model/params into each chat and show a “inherits global” option. |
| 3.15 | **Browser CORS relay** | Providers that block browser requests can be relayed by the Node/Worker backend with host allowlists. | Add per-endpoint relay choice and a clear privacy banner when a request is relayed. |
| 3.16 | **Request retries/fallback** | Playlist order and error handling try the next model; request logs show attempts. | Add user-visible retry policy (attempt count/backoff) and a manual “try next model” button. |
| 3.17 | **Usage and cost estimates** | Token totals, cache read/write, model prices, per-endpoint costs. | Add price freshness dates and a warning when a price is unknown (backlog). |

## 4. Grounding, search, and research

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 4.1 | **Web search** | 20+ search providers, browser keys or backend fallback, provider selection, result count, timeout, snippets, cache. | Add saved searches and multi-query search (backlog); surface provider/quota status before a run. |
| 4.2 | **Explicit search** | `@search(query)`, search banner, or the search tool. | Allow search-only turns that return before model generation, with a result preview. |
| 4.3 | **Automatic grounding** | Tool availability lets the model choose search; the system prompt encourages grounded answers. | Add a per-chat “always search / never search / auto” switch with a visible indicator. |
| 4.4 | **Sources and citations** | Numbered sources, inline `[S1]` citations, strict-mode repair, source drawer, claim focus. | Add claim-level support checking (backlog) and highlight unsupported sentences before send. |
| 4.5 | **Page reader** | Direct fetch plus Jina, Firecrawl, Exa, TinyFish, Tavily, Parallel, Valyu, Linkup, Octen, custom readers. | Add reader fallback ordering and a “show raw text” toggle. |
| 4.6 | **Page summaries** | Optional second model summarizes a page; exact model or playlist flow; query-aware summary. | Show summary cost separately and let the model request specific excerpts after the summary. |
| 4.7 | **Page settings** | Timeout, chars kept, retries, retry delay, summary length, endpoint/model. | Add per-domain overrides and a “test this URL” panel. |
| 4.8 | **Search caching** | Query/provider cache avoids repeated calls. | Show cache hits in the process log and add a clear-cache action. |
| 4.9 | **Deep research** | Tier picker (Quick/Standard/Thorough), scoping questions, editable plan, budgeted searches/page reads, progress card, report panel, resume. | Add a dollar ceiling (backlog) and a “pause and export partial report” action. |
| 4.10 | **Research progress** | Progress tiles for searches, reads, rounds, agents; failed calls do not consume budget. | Add a live timeline with per-source status and cancel-one-step. |
| 4.11 | **Research agents** | Thorough runs delegate separable angles to independent subagents with run-wide citations. | Add agent comparison and duplicate-angle detection before spending budget. |
| 4.12 | **Research plan editing** | User can edit the plan/questions before starting. | Add plan templates and “run only selected steps”. |
| 4.13 | **Research report** | Long cited report in a document-style side panel. | Add PDF/DOCX export and a “copy with sources” action. |
| 4.14 | **Saved searches** | Not implemented. | **Quick win:** store query/provider/options and re-run from the palette or search panel. |
| 4.15 | **Multi-query search** | One query per call; research pays one round trip per query. | Accept 2–3 partitioned queries, dedupe by URL, keep run-wide source IDs. |
| 4.16 | **Citation coverage** | Citation repair fixes invented/missing IDs; source ids remain run-scoped. | Add claim-level “does this snippet support this sentence?” checks and a manual citation editor. |

## 5. Files, documents, and attachments

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 5.1 | **PDF text extraction** | Text layer extracted locally; scanned pages need OCR or a vision model. | Add page-range selection and a per-page confidence indicator. |
| 5.2 | **Office documents** | DOCX, ODT, RTF, PPTX, and every XLSX sheet parsed locally. | Add table-aware extraction and sheet selection; legacy `.doc/.xls/.ppt` remain unsupported. |
| 5.3 | **Archives** | ZIP/GZ expanded up to 25 entries; ZIP bombs/path traversal should be guarded by extraction code. | Add archive preview and per-entry selection before extraction. |
| 5.4 | **OCR** | Off/auto/always; vision endpoint and model; auto only when the answering model cannot see images. | Show OCR confidence and let the user edit the transcript before sending. |
| 5.5 | **Image attachments** | Native vision where supported; previews, zoom, generated-image handling. | Add image annotation/crop and compression controls. |
| 5.6 | **Audio/video** | Attachments can be paired with `.vtt/.srt` transcripts; playback/preview support. | Add built-in transcription with a chosen endpoint and speaker labels. |
| 5.7 | **Private file names** | Model sees neutral names such as `file-1.pdf`; duplicate names stay distinct. | Add a per-file “show real name” override and a warning when the prompt refers to a filename. |
| 5.8 | **Context budgets** | Per-document and total character budgets; opening and conclusion kept when cut. | Show a live budget bar and allow per-file budgets; add a “summarize instead” option. |
| 5.9 | **Extraction errors** | Error state per attachment, re-drop/replace, partial text. | Add “retry extraction” and a link to the relevant setting (OCR/Office/archives). |
| 5.10 | **Attachment reordering** | Pointer drag and keyboard earlier/later controls. | Focus retention after reorder remains a backlog item. |
| 5.11 | **Legacy formats** | `.doc`, `.xls`, `.ppt`, `.7z`, `.rar` are explicitly unsupported. | Offer conversion guidance or an optional conversion service, without uploading by default. |

## 6. Workspace, artifacts, and generated output

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 6.1 | **Workspace file tool** | `workspace_upsert` supports list/read/search/diff/create/update/patch/continue/move/delete/template, one file per call, dry-run patches, read-before-write, serialized writes. | Track covered line ranges for partial reads (backlog); add a batch transaction with rollback. |
| 6.2 | **Workspace panel** | File tree, code/preview/diff tabs, revisions, resizable split, restore, download, copy. | Add multi-file search/replace and an editor save path that does not require a model round trip. |
| 6.3 | **Live writing** | Tool deltas update the panel while the model writes; auto-follow can be disabled. | Add a “writing” indicator in the tree and a cancel-current-file action. |
| 6.4 | **Revisions** | Each write creates a revision; pinned/latest view; revision picker. | Add named checkpoints, diff between any two revisions, and branch/workspace snapshots. |
| 6.5 | **Diff view** | Line diff with limits and per-file truncation warnings. | Add word-level diff, copy patch, and apply/revert controls. |
| 6.6 | **Downloads** | Download one file or all files as a zip; clipboard copy. | Add project export as a Git patch and a “download only changed files” option. |
| 6.7 | **GitHub Gist sharing** | Optional personal token; public/private Gist creation. | Add per-file redaction preview and a token-scope reminder before publishing. |
| 6.8 | **Templates** | Static site, Python script, and Markdown notes scaffold via the workspace tool. | Add user-defined templates and a template preview. |
| 6.9 | **Artifacts** | Sandboxed HTML/JS artifact rendered inside the reply with no network or same-origin access. | Add a full-screen viewer, export as HTML, and a CSP/permission audit. |
| 6.10 | **Graphs** | Equations, implicit equations, inequalities, series, points, shapes; themed export/zoom. | Add data import (CSV/JSON) and interactive tooltips; test accessibility of canvas/SVG output. |
| 6.11 | **Image generation** | OpenAI-compatible `/images/generations`; size/count settings; images stored locally and referenced by id. | Add per-image prompt metadata, regeneration, and a local gallery; current images are per-message. |
| 6.12 | **Code execution** | Disposable Web Worker; JavaScript no network/DOM/storage; optional Python via Pyodide; time/output caps. | Add a “run this snippet again” action, dependency allowlist visibility, and a stronger isolation warning. |
| 6.13 | **Workspace sharing** | Optional shared workspace context for projects; Gist export. | Add a read-only workspace share link with revision pinning. |

## 7. Tools, permission, and MCP

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 7.1 | **Built-in tool catalog** | Search, reader, calculator, date/time, workspace, memory, clipboard, prompt chips, polls, graphs, artifacts, location, navigation, counts, JSON, Base64, UUID, random, hash. | Add per-tool usage stats and a “recommended for this model” hint. |
| 7.2 | **Enable/disable tools** | Per-tool switches, enabled-first ordering, device-tool consent dialog, setup wizard. | Add presets (“research”, “coding”, “private”) and a bulk reset. |
| 7.3 | **Tool access modes** | Full = no prompts; Standard = per-tool approval; Restricted = every call; Disabled = no schemas and calls refused. **New.** | Auto-settle pending prompts when switching to Full/Disabled; persist a per-chat override. |
| 7.4 | **Per-tool approval** | Checkbox/Toggle on each tool card; device-tool dialog; Memory, Image generation, and Code execution cards. **New.** | Add a policy summary and “reset recommended”; expose approval for hidden/MCP tools in one list. |
| 7.5 | **Approval prompt** | Above the composer; shows tool name and clipped JSON; Allow once / Deny; reply pauses. **New.** | Add “Allow for this chat”, “Always allow”, and a link to the exact policy. |
| 7.6 | **Denial result** | A denied call returns a real tool error with `denied: true`; process log shows “Denied by you”. **New.** | Add “retry this call” and let the model explain a denial without re-calling the same tool. |
| 7.7 | **Stop and approvals** | Stop aborts the reply signal, which rejects and clears pending approvals; deleting a chat refuses its pending calls. **New.** | Add a global pending-approval indicator so a background chat cannot silently stall. |
| 7.8 | **Execution limit** | Configurable model→tool rounds; locked high limits; unlimited mode behind warning. | Add a per-chat budget and an estimated token/cost preview before unlocking. |
| 7.9 | **Result truncation** | Results capped at 100k characters; truncation flag and badge. | Let the model request a range/cursor from the same tool, and mark partial MCP results explicitly. |
| 7.10 | **Process log** | Parsed action labels, timing, args/results, live deltas, expand/collapse, denied/error states. | Add retry-one-step, copy result, and a failure-only filter. |
| 7.11 | **MCP servers** | Add Streamable HTTP server, headers/bearer token, enable, test, load tools; tools join the normal loop. | Add OAuth, health checks, server-level read/write hints, per-server approval, and tool paging. |
| 7.12 | **MCP tool calls** | Namespaced `mcp_*` tools; parallel unless workspace writes are serialized. | Serialize side-effecting MCP calls, stream progress notifications, and show server latency. |
| 7.13 | **Skills tool** | `use_skill` exposes enabled skills' instructions; built-in and custom skills. | Add per-skill approval and a visible “loaded skill” marker in the reply. |
| 7.14 | **Memory tool** | Stores/updates/deletes memories under user settings. | Add approval default and a “remember this” manual path; currently tool writes can be automatic under Standard before this round. |
| 7.15 | **Image generation tool** | `generate_image` is offered only when enabled and an OpenAI-compatible endpoint exists. | Add approval (done), prompt history, and safety guidance for likenesses. |
| 7.16 | **Code execution tool** | `run_code` is offered only when enabled; Python is separately gated. | Add approval (done), per-language allowlists, and a resource-usage readout. |
| 7.17 | **Follow-up UI tools** | `prompt_chip` and `inline_poll` render actionable cards below a reply. | Add keyboard-first chip navigation and per-card analytics. |
| 7.18 | **Tool schemas** | Shared JSON schemas; no provider strict mode; all properties not necessarily required. | Emit strict schemas per provider; add tool-choice (`auto/required/none`) and parallel-call control. |
| 7.19 | **Deferred tool definitions** | Every enabled tool schema is re-sent each round. | Past ~20 tools, send names/descriptions and a `tool_search` loader (backlog). |
| 7.20 | **Per-server policy** | Not implemented; Restricted is global. | Add remembered per-server policy and destructive-tool annotations; this is the largest remaining approval gap. |

### Approval matrix

| Access | Enabled tools offered | Per-tool “Require approval” | MCP/hidden tools | Disabled |
|---|---|---|---|---|
| **Full** | Yes | Ignored | No prompt | No |
| **Standard** | Yes | Prompts only when the tool's switch is on | Prompt only if marked (restricted default set includes the main side-effecting tools) | No |
| **Restricted** | Yes | Ignored; every call prompts | Every call prompts | No |
| **Disabled** | No schemas | Irrelevant | No call executes | Yes |

Standard defaults requiring approval: Location, Clipboard, Workspace files, Code execution, Image generation, and Memory. Date/time and the purely local utility tools do not prompt by default. Existing stores migrate to **Full** so behavior does not change until the user opts in.

## 8. Memory and skills

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 8.1 | **Memory store** | Browser-local memories with category, timestamps, edit/delete/delete-all. | Add pinning, expiry, import/export just memories, and a storage count. |
| 8.2 | **Memory modes** | Intentional/Balanced/Aggressive; local rank or classifier recall; holistic/contextual/specific. | Add an explainable “why this memory was recalled” line and per-mode examples. |
| 8.3 | **Memory in temporary chats** | Configurable; transcript expires but memories persist. | Add a temporary-chat banner when memory writes are enabled. |
| 8.4 | **Memory deduplication** | Near-duplicate merge on add; manual duplicate scan with merge. | Add bulk merge and a diff preview before keeping the longer memory. |
| 8.5 | **Memory tool** | Model can store/update/delete; approval is now configurable. | Add a “propose memory” confirmation path instead of silent writes under Full. |
| 8.6 | **Built-in skills** | Curated instruction sets with enable switches. | Add versioning and “updated since” notices. |
| 8.7 | **Custom skills** | User-authored skill instructions; skill tool loads them into context. | Add validation, test-with-sample-prompt, and per-skill token estimates. |
| 8.8 | **Skill discovery** | Skills are enabled in Settings and offered via the tool. | Add automatic skill suggestions based on the prompt, with user confirmation. |

## 9. Widgets and side panels

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 9.1 | **Widget rail** | Optional right panel, toggle, resize, mobile overlay, persisted width. | Add per-device layouts and a compact icon rail. |
| 9.2 | **Endpoint status** | Enabled state and usage summary per endpoint. | Add live latency and last error. |
| 9.3 | **Usage widget** | Success/failure counts per endpoint. | Click-through filters into Stats. |
| 9.4 | **Scratchpad** | Persistent free-form notes. | Add markdown preview and “send to composer”. |
| 9.5 | **Snippets** | Saved text insertable into the composer. | Add folders, variables, and snippet search. |
| 9.6 | **Cost estimate** | Spend from token totals and user-entered prices. | Show confidence and last price update; link to pricing settings. |
| 9.7 | **Last reply** | Process/latency summary of the newest reply. | Click to jump to the reply and expand its process log. |
| 9.8 | **Prompt picker** | One-click prompt override in the side panel. | Show the active prompt and a diff preview. |
| 9.9 | **Shortcut cheat sheet** | Current key bindings. | Filter by scope and print/export. |
| 9.10 | **Draft counter** | Characters, words, estimated tokens. | Add cost estimate and a warning when the attachment budget is near. |
| 9.11 | **Checklist** | Persistent todo list. | Add due dates and convert an item into a prompt. |
| 9.12 | **Widget ordering** | Drag-and-drop order plus shortcut order settings. | Add reset-to-default and per-widget visibility search. |

## 10. Appearance and accessibility

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 10.1 | **Themes** | Four dark and four light presets plus custom. | Add theme scheduling and import/export of a theme. |
| 10.2 | **Custom palette** | Base theme plus accent, contrast, and per-token overrides via a color picker. | Add live contrast warnings and a “restore accessible defaults” action. |
| 10.3 | **Style presets** | Radius/shadow/density/spacing presets and individual overrides. | Add preset sharing (backlog). |
| 10.4 | **Fonts** | Separate body/header/mono fonts with safe font-name handling. | Add font fallback preview and a bundled-font option for offline use. |
| 10.5 | **Text and layout** | Text scale, chat width, composer width, panel widths, header spacing. | Add per-device overrides and a full-width reading mode. |
| 10.6 | **Motion/transparency** | Reduced motion, reduced transparency, modal blur, glass composer. | Detect `prefers-reduced-motion` by default and explain the effect in Settings. |
| 10.7 | **Contrast** | High-contrast option; automated contrast test exists. | Add a contrast checker in the custom palette and test all generated token combinations. |
| 10.8 | **Landmarks and skip link** | Main landmark, skip-to-conversation link, keyboard-accessible DnD. | Audit live regions and focus order in the process tree and widgets. |
| 10.9 | **Touch/mobile** | Responsive sidebar, overlay, swipe-free controls, visible actions. | Add long-press menus and larger drag targets; test at 320px width. |
| 10.10 | **Timestamps** | Optional message date/time, relative formatting. | Add timezone display and “copy timestamp”. |
| 10.11 | **Message actions** | Always-show toggle and hover/focus reveal. | Add a compact action menu for small screens. |

## 11. Settings, palette, and navigation

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 11.1 | **Settings tabs** | 18 grouped tabs, each deeply linkable; feature-gated tabs hide with their feature. | Add favourites and recently changed sections (backlog); per-tab reset. |
| 11.2 | **Settings search** | Catalog search over tab keywords and anchors; deep links open the tab and scroll to the setting. | Add value search (“temperature 0.7”) and result highlighting. |
| 11.3 | **Command palette** | Navigation, theme, chat and tool actions; keyboard-first. | Add settings values, saved searches, and recent commands. |
| 11.4 | **Feature toggles** | 14 feature switches with cascading widget/tab hiding; stats/memory deletion confirmations. | Add dependency explanations before disabling and an “export before delete” prompt. |
| 11.5 | **Library shortcuts** | Sidebar shortcuts to endpoints, playlists, prompts, commands, tools, memory, widgets. | Add custom order and per-project visibility. |
| 11.6 | **Shortcuts** | Configurable bindings under Settings → Shortcuts; global key handler. | Add conflict detection and per-scope shortcuts. |
| 11.7 | **Hash routes** | `#chat`, `#settings/<tab>#<anchor>`, and share links. | Add browser back/forward between chats and settings; currently replaceState only. |
| 11.8 | **Lazy loading** | Settings, Palette, Widgets, ShareView are lazy; ErrorBoundary wraps the app. | Split heavy Settings tabs (Endpoints, Tools, Stats) and add loading/error states per tab. |
| 11.9 | **Welcome flow** | Add endpoint, customize theme/tools, skip; setup completion persists. | Add “re-run onboarding” and import an existing config as a first step. |
| 11.10 | **Docs/tutorial** | Tutorial component, contextual notices, helper links. | Add searchable in-app docs and a “copy diagnostics” button. |

## 12. Data, backup, sync, and security

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 12.1 | **Local persistence** | Browser storage plus durable shards/OPFS/IndexedDB; quota warnings; hydration before mount. | Add explicit commit generations and interrupted-write recovery (backlog). |
| 12.2 | **Automatic local backups** | Optional daily snapshot kept in the browser; list/read/delete. | Add a visible “last backup” age and one-click restore. |
| 12.3 | **Encrypted backups** | Encrypt/decrypt backup files with a passphrase; formats detected. | Add key derivation settings and a recovery-key export. |
| 12.4 | **Export** | Category selection; API keys optional; chats by date; config JSON; per-chat Markdown/JSON. | Add export templates, background export progress, and import validation preview. |
| 12.5 | **Import** | Category-level merge or replace; chat/project de-duplication; sanitizes fields. | Add a dry-run diff and “import as copy” to avoid overwriting. |
| 12.6 | **Device sync** | Optional encrypted payload sync through Neon/Cloudflare; token hash stored server-side; merge/keep-local/keep-remote; conflict retention. | Add side-by-side conflict compare and an explicit “this device wins” per collection. |
| 12.7 | **Share backend** | Node/Worker stores share snapshots; private/auto-update. | Add revocation/expiry and a server-side view of active links. |
| 12.8 | **Storage accounting** | Usage display and quota flag; storage warning banner. | Add per-collection storage breakdown and cleanup suggestions. |
| 12.9 | **Secret handling** | Model/search keys stay in browser; backend does not store model credentials; shares strip keys, prompts, files, tool payloads. | Add a secret-scanner test over exports and redact keys in debug logs. |
| 12.10 | **Backend API** | Search, reader, proxy, share, sync, health, rate limits, SSRF/private-host guards, allowlists. | Add structured request IDs in UI errors and per-route usage dashboards. |
| 12.11 | **Static vs server** | Static deployment loses search, reader, share, sync, relay; direct model calls still work when CORS allows. | Detect static mode at boot and hide unavailable actions with an explanation. |
| 12.12 | **Same-origin checks** | Mutating endpoints refuse cross-origin requests; sync writes protected. | Add CSRF tests for every new route and a security header check in CI. |

## 13. Usage and stats

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 13.1 | **Periods and ranges** | Session/24h/7d/30d/custom; retained records include deleted/archived chats. | Add “since last reset” and per-project filters. |
| 13.2 | **KPI cards** | Cost, tokens, messages, success rate, average latency. | Add trend deltas versus the previous period. |
| 13.3 | **Charts** | Stacked bars, pinned series, table view, exact values. | Add CSV export and accessible data tables for every chart. |
| 13.4 | **Models view** | Per-model usage, cost, tokens, cache, unpriced flags. | Add “switch to cheaper model” suggestions and context-limit warnings. |
| 13.5 | **Tools view** | Tool call counts/outcomes. | Add denial counts now that approvals exist, plus latency and truncation rates. |
| 13.6 | **Breakdown/trends/activity** | Multiple detail views with open-chat links. | Add saved views and annotation of deploy/config changes. |
| 13.7 | **Lifetime totals** | All-time counters survive chat deletion; separate reset. | Add import/merge policy for totals and a signed export. |
| 13.8 | **Pricing** | Per-model prices and cost decimals. | Mark price age and allow a manual override per model. |

## 14. Quality, performance, and operations

| # | Feature | How it works today | Improvement |
|---|---|---|---|
| 14.1 | **Test suite** | 813 unit/integration tests plus 14 worker smoke checks. | Add browser-level tests for the composer, approvals, and settings deep links. |
| 14.2 | **Type safety** | `tsc --noEmit` clean at baseline; shared store/types. | Add `noUncheckedIndexedAccess` incrementally and lint for floating promises. |
| 14.3 | **Build** | Vite build passes; main bundle ~885 kB / ~297 kB gzip. | Split heavy tool schemas and settings tabs; set and test a bundle budget. |
| 14.4 | **Error containment** | Top-level ErrorBoundary; lazy-load fallbacks; storage warning. | Add per-panel boundaries and a “copy diagnostics” action. |
| 14.5 | **Observability** | Process logs, usage ledger, health endpoint; no remote telemetry by default. | Add opt-in local diagnostics export with secret redaction. |
| 14.6 | **Accessibility regression** | Contrast test, landmarks, skip link, keyboard DnD. | Add axe/Playwright checks for the main flows and approval dialog. |

---

## 15. Priority recommendations

### P0 — architecture and trust

1. **Native conversation tree and workspace branching.** Replace copy-only Branch with parent pointers, branch points, branch labels, workspace snapshots, lineage navigation, compare/merge, and per-branch model settings. See §17.
2. **Durable, inspectable tool policy.** Persist approvals per chat/server, add “Allow once / this chat / always”, a global pending-approval indicator, and auto-resolve prompts when the mode changes. Add per-server MCP policy and destructive-tool annotations.
3. **Per-chat model and sampling parameters.** A chat should keep the model it started with; show an “inherits global” state and a one-click “use for new chats”.
4. **Strict tool schemas and tool choice.** Emit provider-strict schemas, add `auto/required/none` and parallel-call control, and reject invalid arguments before execution.
5. **Data safety under failure.** Explicit commit generations, interrupted-write recovery, and import/backup restore previews.

### P1 — high-value capability

6. **Saved searches and multi-query research** with run-wide source IDs.
7. **Research spend ceiling and partial-report export.**
8. **Retry one failed step** from the process panel, plus MCP result paging and progress notifications.
9. **Share revocation/expiry and view indicators.**
10. **Side-by-side sync conflict comparison.**
11. **Per-chat cost/token budget preview** before sending.
12. **True transcript windowing** with preserved scroll and accessibility.

### P2 — polish and leverage

13. **Settings favourites, recent sections, per-tab reset, and heavy-tab code splitting.**
14. **Accessibility automation** for contrast, focus order, live regions, and the approval dialog.
15. **Model price freshness and named fallback chains.**
16. **Attachment reorder focus retention and per-file budget controls.**
17. **Scheduled encrypted backup downloads** (separate from local snapshots).
18. **In-app searchable documentation and copyable diagnostics.**

---

## 16. What changed in the approval round

- Added `src/toolApprovals.ts`: the shared four-mode policy, normalization, approval queue, abort handling, and per-tool defaults.
- Added per-tool `Require approval` switches to Settings → Tools, the device-tool enable dialog, Memory, Image generation, and Code execution.
- Added the composer lock (`ToolAccessButton`) and the pending approval card (`ToolApprovalPrompt`).
- Gated the main chat tool loop through `executeToolCalls` with an `approve` callback; denial returns a real error result and is shown in the process log.
- Disabled mode now removes every tool schema from the main chat and from the model's tool plan; in-flight calls are refused.
- Added config export/import for `toolMode` and `toolApproval`, plus settings catalog links and README/backlog notes.
- Added focused tests for policy, queue, abort, cancellation, denial, and normal execution.

**Deliberate limits:** approvals are session-only and not persisted; the queue is not shown in the sidebar for background chats; deep research keeps its own plan/budget and does not use the per-call prompt; MCP has no per-server policy yet. These are documented rather than hidden.

## 17. Branch deep dive

### Current behavior

`branch(mid)` finds the chat, slices messages through the selected message, assigns fresh message IDs, copies the project, sets the title to `<title> (branch)`, marks the chat started, and switches to it. It is effectively **duplicate-through-message**. It is safe because it does not mutate the original, and the edit dialog explicitly tells users to branch first.

### Why it falls short

- No parent/child relationship, so the app cannot show “branches of this conversation”.
- The original and branch cannot share context or be compared; they are independent copies.
- Workspace files, artifacts, revisions, attachments, pinned replies, shares, and temporary-chat state are not branched with a defined policy.
- Branching an assistant reply and branching a user message feel identical; there is no “branch before this turn” vs “branch after this answer”.
- A branch cannot be merged back or cherry-picked.
- Model/parameters are global, so the branch immediately shares whatever the user changes later.
- The title and lineage are not stable enough for a branch picker.

### Recommended design

- Add `parentId`, `branchPointMessageId`, `branchLabel`, `createdFrom`, and `modelSnapshot` to `Chat`; add `branches`/`parent` indexes rather than scanning.
- Store a workspace snapshot/revision boundary per branch, with a policy: copy files, share a read-only revision, or start clean.
- Add a branch picker in the header: a tree/switcher showing siblings and the current path.
- Add “Branch from here” with explicit before/after and “include workspace” options.
- Add compare view for two branches (message diff and workspace diff) and “use this answer in parent” (cherry-pick).
- Preserve pinned messages, bookmarks, shares, and temporary status with documented rules; default to copying pins/bookmarks, not shares.
- Add branch-aware usage and title generation, and show branch depth in the sidebar.
- Migration: keep existing branch chats as roots with a `legacyBranchOf` breadcrumb; do not invent parent links retroactively.

## 18. Approval deep dive

### Semantics

`needsToolApproval(mode, approvals, name)` is the single policy function used by the UI and engine. Full ignores the map; Standard reads the per-tool boolean; Restricted always asks; Disabled is handled before schema construction and again at execution time so a mode change mid-reply cannot slip a queued call through.

`requestToolApproval` creates a session-only queue entry and returns a promise. The reply's `AbortSignal` is the cancellation path: Stop rejects with `AbortError`, removes the card, and unwinds the tool loop. A denial resolves `false`, and the engine returns a normal tool result with `denied: true`, `error: true`, and an instruction for the model to continue without that tool. This is better than throwing because the model can adapt, and better than silently skipping because the user sees what happened.

### Testing

The focused test file covers: default Full, Standard per-tool, Restricted every-call, Disabled schema removal, explicit-boolean normalization, allow, deny, cross-chat cancellation, abort cleanup, denial before handler execution, and approved execution. The full suite and worker smoke checks remain the regression gate.

### Remaining gaps

- **Background chats:** a pending approval in a non-current chat is invisible. Add a sidebar/row badge and a global “1 approval waiting” tray.
- **Session-only:** a reload loses the prompt with the reply, which is correct for safety, but users may want a persisted “always allow this tool for this chat” policy.
- **Per-server MCP:** Restricted is all-or-nothing. Add server/tool annotations and remembered policy.
- **Mode changes:** switching to Full/Disabled should settle existing prompts immediately; currently the user must still Allow/Deny the visible card.
- **Audit trail:** show approval/denial history in the process log and Stats → Tools, including who approved and when.
- **Argument privacy:** the card shows clipped JSON, which can contain secrets; add per-tool redaction rules for headers/tokens.
- **Deep research:** its plan is the approval boundary; a separate per-search confirmation would make Thorough runs unusable, but a spend ceiling is still needed.

---

## 19. Verification for this round

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean after the final wiring pass |
| `npm test` | 813/813 passed |
| `npm run test:worker` | 14/14 passed |
| `npm run build` | passed; main bundle 901.95 kB / 302.65 kB gzip; Settings 201.41 kB plus a lazy 65.41 kB stats chunk |
| Approval policy tests | 9/9 passed |
| Browser checks | composer lock menu, Settings access card, archive/restore row flow, Shift icon swap, and the archived-retention control verified in the running app; approval policy and queue behavior covered by tests; a full visual pass of every tool card and the device-tool dialog is still worth doing before release |

The final release checklist is deliberately explicit: a clean typecheck and unit suite do not prove every polished surface looks right, and the build must be rerun after every UI edit.
