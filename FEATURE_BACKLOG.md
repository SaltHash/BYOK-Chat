# Feature backlog

Open improvements and follow-up work, ordered roughly by area and value. Shipped
items are removed rather than treated as missing; where a shipped feature only
partly addresses an idea, the remaining gap is described explicitly.

## Chat & conversation

- **Reply bookmarks** — bookmark individual messages and list them in the
  sidebar (distinct from chat pinning).

## Multitasking

Several chats can stream at once now; these are the gaps that remain around
watching, steering and switching between them.

- **Background finish markers** — a chat that finished while another was open
  keeps a quiet marker until it is read, so the streaming dot is not the only
  cue and nothing has to be counted.
- **Queued sends** — sending into a chat that is already replying currently
  asks for a stop first; queue the message instead and dispatch it when the run
  ends.
- **Per-chat model and parameters** — endpoint, model and sampling settings are
  global, so switching chats changes what the next send uses. Let a chat keep
  the model it started with.
- **Jump to running chats** — a command-palette section listing the chats that
  are streaming right now, so a background chat can be reached without
  scanning the sidebar.
- **Stop every running reply** — one command that aborts all streaming chats,
  alongside the existing per-chat stop.
- **Step hint on the row dot** — the row indicator could name the current step
  (searching, writing) on hover, so progress is readable without opening the
  chat.

## Composer

- **Attachment reorder focus** — keep focus on the moved attachment after using
  the earlier/later buttons, even when its position changes.

## Appearance & accessibility

- **Focus-ring style** — choose between the outline and a ring, and its width.
- **Style preset sharing** — export/import a preset (radii, shadows, density and
  spacing overrides) as a small JSON blob.

## Settings & navigation

- **Favourite settings** — pin frequently used sections to the top of the
  settings sidebar and the command palette.
- **Recently changed** — a short list of the last edited settings per session.
- **Per-tab reset** — "Reset this section to defaults" beside each settings
  section heading.
- **Palette coverage for values** — extend the existing theme actions to density
  and style preset values, not just their settings sections.
- **Settings consistency** — apply a shared row, menu and named-dialog pattern
  across the remaining sections; audit keyboard and touch access without hiding
  disabled features or changing existing links.
- **Recent settings** — remember the last opened section locally, without
  changing synced settings or making a deep link open somewhere else.

## Data & sync

- **Scheduled encrypted downloads** — automatic daily backups already stay in
  this browser; offer an opt-in encrypted backup file download separately.
- **Sync conflict comparison** — the conflict viewer lists retained conflicts;
  add a side-by-side comparison before the user resolves them.
- **Durable writes under quota and failure** — persist an explicit commit
  generation for each chat and workspace so recovery can distinguish a stale
  mirror from a newer edit or deletion even after interrupted writes. Local
  shard and IndexedDB failures are surfaced, but OPFS read failures and writes
  interrupted during tab closure still need stronger guarantees.

## Providers & models

- **Per-model system prompt** — attach a short instruction set to a model entry
  so switching models also switches its guidance.
- **Named fallback chains** — a reusable fallback list that several endpoints
  can share, instead of repeating the same models.
- **Price freshness** — mark catalog prices with the date they were observed.
- **Request budget preview** — estimate prompt tokens (and cost) in the composer
  before sending, beyond the existing draft character counter.

## Search, research & tools

- **Saved searches** — re-run a previous web search with the same query and
  provider.
- **Re-run a research plan** — rerun an existing report's plan against fresh
  sources without rebuilding the plan by hand.
- **Report source highlighting** — source panels already highlight a matching
  excerpt for reply citations; link research report claims to those excerpts too.

## Performance & polish (internal)

- **Bounded transcript windowing** — the current window initially limits rows,
  but revealing older messages widens it; investigate true two-sided windowing
  without losing scroll position or accessibility.
- **Settings tab code splitting** — load heavy tabs (Endpoints, Tools) lazily.

## Tool pipeline audit (2026-11)

The audit shipped read-before-write for workspace edits, ordered workspace
writes, a 100k-character tool-result cap, and a tool-free wrap-up turn at the
round limit. What is still missing, roughly by value:

- **Strict tool schemas** — OpenAI accepts `strict: true` and Anthropic
  compiles `input_schema` with `strict`; both require every property in
  `required`, which the shared schemas do not satisfy yet. Emit strict schemas
  per provider so invalid arguments fail in the sampler instead of at runtime.
- **Tool choice control** — let the user (or a chat setting) pick Auto,
  Required or None for a turn, including `disable_parallel_tool_use`, instead
  of always offering every enabled tool.
- **Deferred tool definitions** — MCP servers can add dozens of tools whose
  schemas are re-sent on every round. Past ~20 tools, list names and
  descriptions only and expose a `tool_search` loader.
- **MCP result paging** — results are capped now, but the model cannot ask an
  MCP tool for a range or cursor; add a limit/cursor argument where the server
  schema allows and label a cut result as partial, not complete.
- **Portable tool errors** — OpenAI has no `is_error` flag. Prefix error
  results with `ERROR:` plus a retry hint so non-Anthropic models treat them as
  failures rather than reference data.
- **Citation support check** — the repair passes fix invented and missing ids;
  add a claim-level pass that checks the cited snippet actually supports the
  sentence (the citation-agent pattern) and rewrites only the failures.
- **Multi-query search** — one query per call is right for chat, but research
  pays a round trip per query. Accept 2–3 partitioned queries in one call,
  dedupe by URL, and keep run-wide source ids.
- **Partial-read precision** — any line-range read currently satisfies
  read-before-write; track the covered ranges so a patch outside them asks for
  another read.
- **Serialize MCP side effects** — MCP calls run in parallel today. Use the
  server's `readOnlyHint` annotations to parallelize reads and run the rest in
  order, so two writes cannot race.
- **Approval policy for side effects** — MCP tools and workspace deletes run
  without asking. Add per-server approval for destructive tools, remembered per
  server, matching the sandbox-vs-approval split coding agents use.
- **Retry one failed step** — a tool error is explained to the model, but the
  user cannot retry just that call from the process panel.
- **Truncation badge** — a result cut at the size cap looks complete in the
  payload viewer; mark it explicitly and offer the narrower follow-up.
- **Live MCP progress** — an MCP call shows one spinner; stream progress
  notifications when the server sends them.
- **Research spend ceiling** — tiers cap searches and time, not money. Add an
  optional dollar ceiling that stops the run and reports what it gathered.
- **Process-tree keyboard order** — the tree is reachable but reading order and
  focus order differ when a payload expands; verify with a screen reader.
