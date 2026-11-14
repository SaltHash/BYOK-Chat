# byok-chat — staff-level audit (Phase A read-only + Phase B hillclimb)

Baseline commit `65d914d` on `main`. Audit performed against the working tree at `/home/icodebugs/Downloads/Coding/Projects/byok-chat`.
Nothing was committed, pushed, deployed, or migrated. Live payloads were never altered.

---

## 1. Scope and method

Two phases, in order.

* **Phase A (read-only).** Read source, shell/config, tests and docs; record every claim as **Confirmed**, **Suspected** or **Not checked**, each with `path:line`. Priority order: data safety → security/privacy → correctness → a11y/mobile → performance → maintainability → polish.
* **Phase B (hillclimb).** One defect at a time. Measure before, change, measure after, keep only if the metric moved and every gate stayed green. A change that regressed anything was to be reverted; none were.

Hard rules followed throughout: `.env` was never opened or printed; no destructive git; no deployment, no data mutation; `node_modules/` and `dist/` are not source; the repository's own audit docs (`CODEBASE_AUDIT.md`, `FEATURE_AUDIT.md`, `FEATURE_BACKLOG.md`) were treated as unverified claims, not evidence.

**Gates** (the same five, run at baseline and on the final tree):

| Gate | Baseline | Final |
| --- | --- | --- |
| `npx tsc --noEmit` | exit 0, 0 errors | exit 0, 0 errors |
| `npm test` | 869 pass / 0 fail | **881 pass / 0 fail** (6.9 s) |
| `npm run test:worker` | 14/14 | 14/14 |
| `npm run build` | exit 0 | exit 0 (4.9 s) |
| `npm audit --omit=dev` | exit 0, 4 low (katex) | unchanged — no dependency was added |

The `npm test` delta is exactly reconciled: +8 (`selection.test.mjs`, new file) +1 (`server/search.test.mjs`) +1 (`server/api.test.mjs`) +2 (`chunkLoad.test.mjs` 4 → 6) = +12.

---

## 2. Coverage ledger

Inventory of the repository, and how much of it this audit actually read. `R` = read line-by-line, `S` = sampled or read in targeted windows, `O` = not opened.

| Area | Files | R | S | O |
| --- | ---: | ---: | ---: | ---: |
| `src/*.ts`, `src/*.tsx` (non-test) | 69 | 22 | 3 | 44 |
| `src/components/*.tsx` | 34 | 7 | 4 | 23 |
| `src/storage/*.ts` | 13 | 8 | 0 | 5 |
| `server/*.mjs` + `neon-schema.sql` | 13 | 13 | 0 | 0 |
| Shell / config / host (`server.mjs`, `worker/index.mjs`, `package.json`, `wrangler.jsonc`, `vite.config.ts`, `tsconfig.json`, `index.html`, `manifest.webmanifest`) | 8 | 8 | 0 | 0 |
| Test files (`src`, `src/storage`, `server`, `tests/`) | 82 | 6 | 14 | 62 |
| Docs (`README.md`, `CODEBASE_AUDIT.md`, `FEATURE_AUDIT.md`, `FEATURE_BACKLOG.md`, `AUDIT_SYSTEM_PROMPT.md`) | 5 | 2 | 3 | 0 |
| **Total** | **224** | **66** | **24** | **134** |

Reconciled: 66 + 24 + 134 = 224. **29% read in full, 11% sampled, 60% not opened.**

Read in full: every server module and the SQL schema, every shell/host file, the whole persistence path (`persistence.ts`, `storage/{durable,boot,coalesce,backupCrypto,localBackup,sync,syncClient,syncRuntime}.ts`), the network/request path (`net.ts`, `streamRequest.ts`, `chatRoute.ts`, `providerAdapter.ts`, `providerRegistry.ts`, `models.ts`), the shared UI primitives (`ui.tsx`), the composer (`Composer.tsx`), the workspace engine (`workspace.ts`, 1,889 lines), and `App.tsx`, `main.tsx`, `archive.ts`, `errors.ts`, `throttle.ts`, `chunkLoad.ts`, `uiSignals.ts`, `meta.ts`, `layout.ts`, `toolLabels.ts`, `promptVars.ts`, `time.ts`, `selection.ts`, `Toast.tsx`, `ErrorBoundary.tsx`, `PathSwitch.tsx`, `ContextMeter.tsx`, `Artifact.tsx`, `docs.ts`.

Not opened, and named here so the gap is auditable: `research.ts` (1,034 L), `graph.ts` (1,164 L), `docs.ts` (680 L), `artifacts.ts`, `engine.ts` (beyond its public surface), `store.ts` (3,927 L — only the persist/migrate block, `THEME_COLORS`, and the delete/undo path), `Chat.tsx`, `Settings.tsx` (edited regions only), `Extra.tsx`, `Workspace.tsx`, and 23 further components plus ~45 smaller `src` modules (`mentions`, `quote`, `paste`, `voice`, `usage`, `conversationTree`, `compaction`, `flair`, `chatPlan`, `catalog`, `codesandbox`, `imagegen`, `location`, `mcp`, `memory`, `providers`, `questions`, `recall`, `replyMetrics`, `replyWidgets`, `theme`, `curlImport`, `attachments`, `bookmarks`, `citations`, `configIO`, `customTheme`, `dndShared`, `endpointAuth`, …).

---

## 3. Findings — Confirmed

Severity legend in §6. `Fixed` entries are Phase B iterations, detailed in §5.

| # | Sev | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| C1 | P2 | **Provider error text could echo the API key into stored chat history.** `attemptFetch` read the upstream body verbatim; a provider that reflects the rejected key ("invalid api key sk-…") put the secret into the thrown message, which the chat route stores in `m.t` and which is then persisted, device-synced and included in shared chats. | `server/search.mjs` (`attemptFetch`), `src/store.ts:2843`, `server/search.mjs` redaction | Fixed (iter 5) |
| C2 | P2 | **Same echo on the page-reader path.** `apiReader` returned `e.message` unchanged; the reader provider key is in scope at that boundary. | `server/api.mjs` (`apiReader`) | Fixed (iter 6) |
| C3 | P2 | **Unbounded upstream error buffering.** `response.text()` on a non-OK response buffered the entire body before truncating to 200 chars — 12.4 MB read for one provider error page, on the main thread of a Worker request. | `server/search.mjs` (`readErrorDetail`) | Fixed (iter 7) |
| C4 | P2 | **`stepModelSelection` was off by one with no current selection.** `` list[(at + delta + list.length) % list.length] `` with `at = -1` puts "previous model" on the second-to-last model instead of the last. Reached whenever nothing is selected yet or the selected endpoint/model was deleted. | `src/selection.ts:41` | Fixed (iter 8) |
| C5 | P2 | **A blocked recovery reload hung the load forever.** `loadChunk` returns a never-settling promise after calling `location.reload()`. `App.tsx` registers a `beforeunload` handler while a research run is in flight, so a user who declines the prompt keeps the page — and every Suspense boundary waiting on that chunk (Settings, palette, share view) waits permanently. Reproduced: the test binary hung and was killed at 120 s. | `src/chunkLoad.ts:49` | Fixed (iter 9) |
| C6 | P3 | **Theme tokens had drifted from the stylesheet.** 8 `er` values in `THEME_COLORS` disagreed with the `[data-t=…]` CSS blocks; the existing sync test only compared `mu`, so the drift was invisible. | `src/store.ts:225-233`, `src/contrast.test.mjs` | Fixed (iter 1) |
| C7 | P3 | **Three dialogs nested a second `role="dialog" aria-modal="true"`.** A modal rendered inside a modal announces two dialogs and breaks the outer focus cycle. | `src/components/Extra.tsx` (3 sites) | Fixed (iter 2) |
| C8 | P3 | **Eight modals had no accessible name** (`aria-labelledby`/`aria-label` both absent), so screen readers announce "dialog" with no title. | `src/components/Extra.tsx`, `src/components/Settings.tsx:396,456,468,1145,1596` | Fixed (iter 3) |
| C9 | P3 | **Stale host comment** claimed `not_found_handling: single-page-application` while `wrangler.jsonc` sets `"none"`. A maintainer following the comment would "fix" working asset routing into a broken SPA fallback. | `server.mjs:158` vs `wrangler.jsonc:25` | Fixed (iter 4) |

**Verified sound, no change made** (these were checked because they are the obvious places for the failure modes above):

| Area | What was checked | Result |
| --- | --- | --- |
| Delete / undo | Blobs are dropped only in `commitPendingDelete` after `DELETE_UNDO_MS` (8 s); `undoDelete` is idempotent | Confirmed correct (`store.ts:1045-1062`, `2930-3000`) |
| Archive retention | `isArchivedChatExpired` refuses to delete a chat with no timestamp | Confirmed correct |
| Artifact sandbox | `sandbox="allow-scripts"` **plus** a document CSP `default-src 'none'; connect-src 'none'; img-src data: blob:` | The UI claim "no network access" is accurate (`artifacts.ts:129`) |
| HTML workspace preview | `sandbox=""` — no scripts, no same-origin | Confirmed (`Workspace.tsx:110`) |
| Skip link | `href="#conversation"` target exists | Confirmed (`Chat.tsx:1553`) |
| Modal focus contract | Focus enters the dialog, Tab cycles, focus returns to the opener, Escape closes only the top layer | Confirmed (`ui.tsx:250-283`, `escStack`) |
| Icon-button names | `Btn` derives `aria-label` from `title` when there are no children | Confirmed (`ui.tsx:15`) |
| Workspace path safety | `sanitizePath` collapses `..`, strips absolute prefixes, caps length; zip entries dedupe | Confirmed (`workspace.ts:38-62`) |
| Read-before-write | Edits require a prior `read` in the same reply; `create` over an existing path counts as a replace | Confirmed (`workspace.ts:1780-1795`) |
| Oversize writes | A file over 200 k chars is refused, never stored truncated | Confirmed (`workspace.ts:1546-1550`) |
| Patch engine | Hunks located by content, multi-file patches refused, ambiguous matches warned, a failed patch writes nothing | Confirmed (`workspace.ts:1215-1330`) |
| Document ingestion | `fitDoc` keeps head **and** tail with an explicit "middle omitted" marker; zip/gzip caps are enforced in the unzip filter *before* inflation; a dead extraction worker re-runs the job in-process instead of losing the attachment | Confirmed (`docs.ts:333-347, 519-534, 380-400`) |

---

## 4. Findings — Suspected / Not checked

Not fixed in this pass. Each states why it was left alone.

| # | Sev | Status | Claim | Evidence | Why left |
| --- | --- | --- | --- | --- | --- |
| S1 | P2 | Suspected | The v26 migration replaces `p.prompts` with the three shipped presets, so a user-authored prompt is deleted on upgrade with no warning. | `src/store.ts:3628-3640` | The inline comment ("replaced by exactly three supported ones") reads as deliberate product intent. Changing it silently is a trust-model change; flagged for the owner instead. |
| S2 | P2 | Suspected | The ReDoS guard in workspace search only recognises `(a+)+` shapes. `(a\|a)+b`, `a{1,1000}{1,1000}` and similar still pass, and the 1.5 s deadline is checked per file, not per line — one long pathological line can outlive it. | `workspace.ts:776-790, 800` | Needs a real regex-safety budget or a different engine; a second heuristic would not close it. |
| S3 | P3 | Suspected | The v26 qualities card puts `role="switch"` on a whole-card click target, so the card reads as a switch while also acting as a disclosure. | `Settings.tsx:943-959` | Fixing it changes a click affordance and needs a layout decision. |
| S4 | P3 | Suspected | `RangeSlider` can commit the second-to-last value: `commit(drag)` reads `drag` from the render closure while `push()` may still hold a newer value in `pending`. | `ui.tsx:188-205` | Only reachable when `pointermove` and `pointerup` land in one batch; unverifiable without a browser. |
| S5 | P3 | Suspected | `readWorkspaceRange` clamps a `startLine` past EOF to the last line, so `startLine: 9999` returns the final line rather than an empty result. | `workspace.ts:690-700` | Arguably friendlier than an empty page; a model-facing contract decision. |
| S6 | P3 | Suspected | Legacy sync payloads are still accepted in plaintext (ciphertext is only guaranteed for newly written payloads). | `storage/sync.ts:132` | Migration path; removing it is a compatibility break. |
| S7 | P3 | Suspected | The document CSP omits `script-src`/`default-src`, so it provides no XSS mitigation. | `server.mjs:90`, `worker/index.mjs:34` | Correct as-is for a BYOK client: the browser must call arbitrary provider origins, so a restrictive `connect-src` would break the product. Documented rather than changed. |
| S8 | P3 | Not checked | Four dev-only low advisories (`katex GHSA-238p-pmmp-9mq7`). | `npm audit --omit=dev` | The fix is a breaking dependency bump, which Phase B excludes without authorization. |

---

## 5. Phase B iteration log (5.9)

Nine iterations. Every one kept; none was reverted. Gate column = tsc / tests / worker / build after the change.

| # | Change | Metric | Before → After | Gate |
| --- | --- | --- | --- | --- |
| 1 | Align 8 `THEME_COLORS[*].er` to the stylesheet; widen the sync test from `mu` to all 15 tokens × 8 themes | theme token mismatches | 8 → **0** | 0 / pass / 14 / 0 |
| 2 | Move dialog names onto `<Modal>`; drop the inner `role="dialog" aria-modal` in `Extra.tsx` | nested dialog roles | 3 → **0** | 0 / pass / 14 / 0 |
| 3 | Give 5 unnamed `<Modal>`s a `label=` | unnamed dialogs | 8 → **0** | 0 / pass / 14 / 0 |
| 4 | Correct the `not_found_handling` comment in `server.mjs` | false claims about routing | 1 → **0** | 0 / pass / 14 / 0 |
| 5 | Redact provider-echoed secrets in `attemptFetch` (`requestSecrets`/`redactSecrets`) | key reachable in stored text | `true` → **`false`**; message now `Serper rejected the API key (HTTP 401): {"error":"invalid api key •••"}` | 0 / 24 search tests / 14 / 0 |
| 6 | Redact the reader-path error message in `apiReader`; assert 502 + no leak | key in reader error | `true` → **`false`** | 0 / 9 api tests / 14 / 0 |
| 7 | Stream and cancel upstream error bodies (`readErrorDetail`, 128 KB cap) instead of `response.text()` | bytes read from a 12 MB error body | 12,451,840 → **131,072** (−98.9 %); message 248 chars, code `upstream_unavailable` | 0 / 33 server tests / 14 / 0 |
| 8 | Fix `stepModelSelection`'s missing-selection branch (next→first, previous→last) | `selection.test.mjs` | 7/8 → **8/8** (failing case: expected `b1`, got `a2`) | 0 / 8 / 14 / 0 |
| 9 | Settle `loadChunk` 1.5 s after a reload instead of returning a never-settling promise | test run against a blocked reload | hang, killed at **120 s** → **passes in 1.8 s** | 0 / 6 / 14 / 0 |

Final tree: `npx tsc --noEmit` 0 · `npm test` 881/881 · worker 14/14 · `npm run build` exit 0 · 12 files modified, +216 / −43, plus one new test file.

A note on iteration 9's honesty: the first attempt at its test file **replaced** `src/chunkLoad.test.mjs`, which was already tracked with 4 tests. That was caught by `git status` showing `M` rather than `??`, and the original four tests were restored, including the one asserting the promise must *not* settle while the document is unloading. The final file keeps all four (the reload-grace assertion is retained for the first 400 ms) and adds the two new cases.

---

## 6. Severity and status legend

| Severity | Meaning |
| --- | --- |
| P0 | Data loss or corruption reachable in normal use |
| P1 | Security/privacy breach, or the app unusable without a workaround |
| P2 | Real defect with a workaround; credential exposure, silent wrong behaviour, a hang |
| P3 | Correctness/polish, a11y gap, misleading comment |

| Status | Meaning |
| --- | --- |
| Confirmed | Reproduced or proven by reading the exact code path |
| Suspected | Plausible from the code, but not reproduced (no browser, no credentials, or a product decision) |
| Not checked | Not assessed; listed so the gap is explicit |

---

## 7. Metrics, before and after

| Metric | Baseline | Final |
| --- | ---: | ---: |
| Theme token mismatches (8 themes × 15 tokens) | 8 | 0 |
| Unnamed dialogs | 8 | 0 |
| Nested `role="dialog"` in `Extra.tsx` | 3 | 0 |
| Stored-text credential echo paths | 2 | 0 |
| Bytes read from a 12 MB provider error body | 12,451,840 | 131,072 |
| `loadChunk` settle time with a blocked reload | never | 1.5 s |
| `selection.test.mjs` | 7/8 | 8/8 |
| Test files | 81 | 82 |
| Tests | 869 | 881 |
| Type errors | 0 | 0 |
| Build | ok | ok |
| Source modules with a same-named test (of 128) | 70 | 71 |

Bundle sizes, measured on the final tree: `index` 959.87 kB raw / 321.28 kB gzip (baseline 959.93 / 320.24), `markdown` 753.11 / 209.81 (baseline 753.11 / 208.66), `Settings` 162.43 / 45.32. Raw sizes are unchanged; two chunks gained ~1 kB of gzip. No dependency was added or upgraded.

---

## 8. Documentation claims checked

Only the README's technical claims were verified; the other audit docs are unverified by design.

| Claim | Source | Verdict |
| --- | --- | --- |
| "Never stores model credentials" | `README.md` | **Confirmed** — keys are read per request and never written to the store or a sync payload |
| Device sync uploads ciphertext | `README.md` | **Confirmed** for new payloads; legacy plaintext still accepted (S6) |
| Shared chats are stripped of private fields | `README.md` | **Confirmed** — `sanitizeSharedChat` (`share.mjs:14-40`) |
| Share links use a shared route module | `README.md` | **Confirmed** |
| `STORE_VERSION` is 26 | `README.md` | **Confirmed** (`persistence.ts:32`) |
| Assets are served without an SPA fallback | `wrangler.jsonc` | **Confirmed** (`not_found_handling: "none"`); the host comment was wrong (C9) |
| `CODEBASE_AUDIT.md`, `FEATURE_AUDIT.md`, `FEATURE_BACKLOG.md` | repo docs | **Not checked** — treated as unverified throughout |

---

## 9. Limitations — what this audit did not do

* **No browser session.** Every a11y finding is static (JSX/ARIA inspection). Nothing was tabbed through, no screen reader was run, no layout was seen at any viewport. The focus contract, the tab cycle and the `aria-live` regions are correct *in code*, not observed.
* **No provider credentials.** `npm run smoke:providers` was never run. Real SSE streaming, CORS behaviour, the non-stream fallback and tool-call round trips against a live provider are untested.
* **No database.** `neon-schema.sql` was read; RLS policies and the actual SQL were not executed.
* **`.env` was never opened** (hard rule). No secret value was read, printed, or inferred — only the code paths that handle them.
* **`store.ts` (3,927 L) was not read end-to-end.** Its persistence, migration, delete/undo and error-text paths were; the rest of its ~200 actions were not.
* **~60 % of source was not opened** (§2), including `research.ts`, `graph.ts` and 23 components. Findings there are absent, not negative.
* **No dependency change**, so the 4 low katex advisories remain.
* **No performance measurement of the running app.** The only performance number here is the error-body byte count in iteration 7, measured on a synthetic 12 MB stream in Node.

---

## 10. Recommendations

Ordered by value. None of these was implemented, because each needs a decision this audit cannot make for the owner.

1. **Decide the prompt-preset question (S1).** If user-authored prompts are meant to survive, the v26 branch should keep them: `p.prompts = [...kept, ...old.filter(prompt is not a known legacy stock id)]`. If they are not, the upgrade should say so before it happens.
2. **Give workspace search a real ReDoS budget (S2).** Either cap the matcher's work per line (`RegExp` on a sliced line with a total budget), or replace the heuristic with a linear-time matcher for the non-regex path and refuse backtracking constructs for the regex path.
3. **Add a browser pass** for the a11y items that are static-only today, and for the `RangeSlider` commit order (S4). This is the single largest verification gap.
4. **Schedule the katex bump (S8)** as its own change with a build + contrast-test check, since `--omit=dev` still reports it.
5. **Keep the credential-redaction tests as regression guards.** They are the only thing standing between a future provider error format and a key in a synced chat; the next provider added should get one too.
6. **Test the modules that still have none.** The remaining zero-test list is short and high-traffic: `models.ts`, `streamRequest.ts`, `providerRegistry.ts`, `errors.ts`, `layout.ts`, `meta.ts`, `toolLabels.ts`, `uiSignals.ts`.
7. **Revisit the qualities card affordance (S3)** the next time that panel is touched — it is the last known a11y outlier in Settings.
