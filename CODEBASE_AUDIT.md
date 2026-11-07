# Codebase audit — UI/UX and engineering review

**Audit date:** 7 November 2026  
**Repository:** `byok-chat`  
**Baseline:** `3117d12` (`Add tool access modes and the full feature audit`) plus the uncommitted archive-first changes in the working tree.  
**Scope:** the full application surface: shell and navigation, sidebar, chat and composer, settings, dialogs, persistence, local storage, sharing, sync, backend routes, Worker entry point, build, tests, and mobile behavior.

This audit is code- and interaction-focused. It complements `FEATURE_AUDIT.md` (which inventories product capability and maturity) rather than repeating that feature-by-feature review. No application source was changed for this audit.

> **Method limitation:** the available agent runtime exposed only the web researcher. Code-analysis subagents (`code-searcher`, `gpt-5-agent`, etc.) were rejected as unavailable, so the audit was completed directly with source reads, repository searches, terminal checks, and the local browser. This did not reduce the scope, but it reduced parallelism.

---

## 1. Executive summary

The application is in good shape for a local-first, single-user, bring-your-own-key chat client. The strongest parts are the persistence design, the breadth of the provider/tool model, the backend security posture, and the amount of considered keyboard and accessibility work that already exists.

The highest-value fixes are not new features. They are a small set of **repeated interaction-contract failures**:

1. The mobile drawer does not close when a normal chat, new chat, or project is selected.
2. Most feature switches have no accessible name.
3. Segmented controls expose the selected option only visually, not programmatically.
4. Several dialogs, including the command palette and project modal, have no accessible name; some also nest two dialog roles.
5. Permanent chat deletion has no confirmation or undo path, even though a safer archive action exists.

Those five are small, localized changes with outsized usability and accessibility impact. The next tier is navigation history, menu keyboard behavior, touch-target size, bundle weight, and browser-level regression coverage.

The backend is notably stronger than the frontend interaction layer: same-origin checks, per-IP limits, hashed share/sync tokens, SSRF guards, and sanitized public snapshots are all present and covered by focused tests.

---

## 2. Verification performed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **Pass** — exit 0 |
| `npm test` | **Pass** — 798 tests, 798 pass, 0 fail (73 test files) |
| `npm run build` | **Pass** — built in 5.70 s |
| `npm audit --omit=dev` | **4 low** vulnerabilities in the KaTeX/math chain; no moderate/high/critical |
| Desktop browser | 1440 × 900; shell, conversation, settings dialog, and accessibility tree inspected |
| Narrow browser | 355 × 767 CSS px; no horizontal overflow (`scrollWidth === clientWidth`) |
| Console | No React runtime exception observed; one repeated startup CORS failure from the third-party model catalog |
| Working tree | Archive-first changes remain uncommitted; no source edits were made for this audit |

### Build output

- `index-*.js`: **894.49 kB / 300.33 kB gzip**
- `markdown-*.js`: **753.11 kB / 209.81 kB gzip**
- `Settings-*.js`: **262.33 kB / 71.55 kB gzip**
- `katex-*.js`: **261.18 kB / 77.55 kB gzip**
- `index-*.css`: **82.76 kB / 15.25 kB gzip**
- Vite emits the standard warning for chunks over 500 kB.

The `markdown` and `Settings` chunks are lazy, but the main `index` chunk is still large. The first Markdown reply and the first Settings visit pay the deferred costs.

---

## 3. Scorecard

| Area | Assessment | Main reason |
|---|---|---|
| Product completeness | **Strong** | Very broad feature set; archive-first flow is a good safety improvement |
| UI shell and navigation | **Needs work** | Mobile drawer does not dismiss; browser history is not integrated |
| Accessibility semantics | **Weak** | Unnamed switches, unnamed dialogs, segmented controls without state |
| Keyboard support | **Mixed** | Excellent DnD, focus trap, Escape stack; menus are inconsistent |
| Mobile UX | **Mixed** | No overflow and visible row actions, but drawer flow is broken |
| Visual consistency | **Good** | Shared surfaces, menus, themes, spacing tokens, style presets |
| Persistence and recovery | **Strong** | Hydrate-before-mount, sharded writes, coalescing, quota fallback, backups |
| Security | **Strong backend / fair client** | Backend hardening is good; keys remain plaintext in browser storage and the app shell has no CSP |
| Performance | **Fair** | Good lazy boundaries and chunking, but a 894 kB main chunk and 753 kB Markdown chunk |
| Maintainability | **Fair** | Several very large modules with many responsibilities |
| Test coverage | **Good logic / weak UI** | 798 logic, integration, and server tests; no React/DOM or browser regression suite |
| CI and release hygiene | **Weak** | No checked-in CI workflow; dependency `latest` range; no lint script |

---

## 4. What is already strong

These should be preserved while fixing the issues below.

### Persistence and data safety

- Hydration completes before the React root mounts, preventing a slow IndexedDB read from overwriting edits made after the UI became interactive (`src/main.tsx:28-53`).
- Persist writes are coalesced to a 400 ms window and flushed on `pagehide`/`visibilitychange` (`src/persistence.ts:394-402`, `src/storage/coalesce.ts`).
- Chats are sharded by chat id so a streamed reply rewrites one chat rather than the entire history (`src/persistence.ts`).
- Quota compaction, durable mirroring, automatic backups, encrypted export, and sync conflict handling all have dedicated modules and tests.
- Archive-first behavior reduces accidental permanent deletion and the new retention model is pure and tested (`src/archive.ts`, `src/archive.test.mjs`).

### Accessibility work that is already present

- Skip link and a real `main` landmark (`src/App.tsx:189-205`).
- Dialog focus trap, focus restoration, and a layered Escape stack (`src/components/ui.tsx:55-78`, `:209-245`).
- Keyboard drag-and-drop with live announcements and reduced-motion handling (`src/components/Sidebar.tsx`, `src/components/dnd.tsx`, `src/index.css`).
- Reduced motion, reduced transparency, high-contrast mode, and contrast tests.
- Search/find has a polite live region and keyboard shortcuts (`src/components/Chat.tsx:1255-1266`).

### Backend security

- Mutating routes reject cross-origin requests (`server/http.mjs:120-126`, `server/api.mjs`).
- Search, reader, extract, share, sync, and proxy paths have per-IP limits.
- Share owner tokens are random and stored only as hashes; private reads require the token (`server/share.mjs:42-108`).
- Sync secrets are hashed and compared with `timingSafeEqual` (`server/syncStore.mjs`, `server/sync.mjs`).
- Public share payloads are sanitized to title, role, text, byline, and timestamp; attachments, prompts, keys, tools, and reasoning are removed (`server/share.mjs:14-39`).
- The proxy has an allowlist/private-host guard and a DNS-rebinding-aware fetch path (`server/proxy.mjs`, `server/pinnedFetch.mjs`).
- Server logs avoid query text and credentials (`server/api.mjs:80-85`).

### Product/UI strengths

- Archive is the default row action; Shift swaps to permanent delete. This is a good recognition-over-recall choice.
- Mobile row actions are visible rather than hover-only (`max-md:flex`).
- Empty, loading, error, and storage-warning states generally exist.
- No horizontal overflow at the narrow viewport tested.
- Chat transcript windows earlier messages and provides a “jump to latest” control rather than rendering an unbounded history.
- Settings is deeply linkable and searchable; the command palette is keyboard-first.

---

## 5. Findings

### P1 — fix next

#### P1.1 Mobile drawer stays open after ordinary navigation

**Evidence**

- Chat row selection only patches the active chat: `src/components/Sidebar.tsx:73`.
- New chat buttons only call `newChat()` and focus the composer: `src/components/Sidebar.tsx:520-521`.
- Opening a project only calls `openProject()`: `src/components/Sidebar.tsx:620`.
- The overlay is cleared only by clicking it or the explicit “Hide sidebar” button: `src/App.tsx:201`, `src/components/Sidebar.tsx:522`.
- The search-result path *does* close the drawer on narrow screens through `jump()` (`src/components/Sidebar.tsx`), so behavior is inconsistent.

**Browser confirmation**

At 355 × 767, opening the drawer and selecting “Deep research: battery recycling” changed the page heading to that chat, while the 288 px-wide sidebar and the dimming overlay remained visible. The user must manually dismiss the drawer after every ordinary row selection.

**Impact**

This is the most common mobile navigation path. It makes the app feel stuck behind a modal layer and adds an extra tap to every chat switch.

**Recommendation**

Add one helper, for example `selectAndCloseOnMobile()`, and use it from row selection, new chat, project open, and library navigation. Keep the current behavior on desktop. Add a browser test that asserts the drawer is gone after each path.

**Acceptance criteria**

- At widths below 768 px, tapping a chat, “New chat”, or a project closes the drawer and leaves the conversation focused.
- At desktop widths, the sidebar remains open.
- Search-result navigation and ordinary row navigation behave the same.

---

#### P1.2 Most switches have no accessible name

**Evidence**

`Toggle` renders `role="switch"` and `aria-checked`, but `label` is optional and becomes `aria-label` only when supplied (`src/components/ui.tsx:28-31`). Many call sites omit it:

- Feature toggles: `src/components/Settings.tsx:453`
- Prompt toggle: `src/components/Settings.tsx:859`
- Command toggle: `src/components/Settings.tsx:997`
- Document toggles: `src/components/Settings.tsx:1074-1076`
- Header “Use model defaults”: `src/components/Header.tsx:24`
- Welcome “Show response information”: `src/components/Welcome.tsx`

**Browser confirmation**

In the Features accessibility tree, only “Show disabled features” was named. The other **14 of 15** switches were exposed as unnamed switches with only a checked state. A screen reader announces “switch, on” or “switch, off” with no indication of what is being controlled.

**Impact**

WCAG 4.1.2 (Name, Role, Value). This affects a core settings surface and several document controls.

**Recommendation**

Make `label` required in the `Toggle` type, or introduce a `ToggleRow` component that always connects the visible row heading through `aria-labelledby`. Audit every `Toggle` call site, including the ones currently wrapped in a `<label>`; do not rely on the wrapping label for a button’s accessible name.

**Acceptance criteria**

- Every `role="switch"` in the accessibility tree has a non-empty name.
- The visible row title and the switch name match.
- An axe or browser assertion fails if a new unnamed switch is added.

---

#### P1.3 Segmented controls do not expose the selected value

**Evidence**

`Seg` renders plain buttons with only a visual `bg-hov text-tx` state (`src/components/ui.tsx:110-116`). There is no `role="group"`, `aria-pressed`, `role="radio"`, or `aria-checked`.

**Affected surfaces**

- Appearance mode and density/style choices.
- Chat width in onboarding.
- Model/playlist switching in the composer.
- Usage period, metric, and grouping controls.
- Send-while-busy and prompt-recall behavior.
- Tool access mode.
- Many Settings tabs.

**Impact**

A screen-reader user hears a row of buttons but cannot tell which option is selected. Keyboard users can focus and activate the controls, but the current state is not announced.

**Recommendation**

Use `role="radiogroup"` plus `role="radio"` and `aria-checked`, or keep buttons and add `aria-pressed` plus an accessible group label. Prefer the radio pattern because these are mutually exclusive settings. Ensure arrow-key navigation is either implemented or explicitly not promised.

**Acceptance criteria**

- The current option is announced as selected.
- Each group has a visible or `aria-label` name.
- Changing the selection updates the announced state without moving focus unexpectedly.

---

#### P1.4 Several dialogs have no accessible name; some nest dialogs

**Evidence**

`Modal` always creates `role="dialog"`, but `labelledBy` is optional (`src/components/ui.tsx:212-245`). These callers omit it:

- Project create/edit: `src/components/ProjectModal.tsx:56`
- Command palette: `src/components/Palette.tsx:110`
- Share conversation: `src/components/ShareDialog.tsx:118`
- Full-screen graph: `src/components/Graph.tsx:832`
- Device-merge dialog: `src/components/SyncBox.tsx:125`
- Image lightbox: `src/components/ui.tsx:248`

`ShareDialog` then adds a second `role="dialog"` inside the modal (`src/components/ShareDialog.tsx:119`). `Extra` does the same for export, decrypt, and import dialogs (`src/components/Extra.tsx:589`, `:610`, `:616`). The palette’s search input relies only on a placeholder and has no `aria-label` (`src/components/Palette.tsx:114-122`).

**Impact**

Screen readers announce an unnamed “dialog” and lose the context of what opened it. Nested dialog roles can duplicate announcements and confuse focus management. The palette is also a primary keyboard surface, so its unnamed search box is especially costly.

**Recommendation**

- Pass `labelledBy` for every modal and render a stable heading id.
- Remove the inner `role="dialog"` when the outer `Modal` already provides it.
- Give the palette input an explicit `aria-label="Search commands and settings"`.
- Keep `ImageLightbox` labelled by its image alt text or a heading.

**Acceptance criteria**

- No unnamed `[role="dialog"]` exists in the main flows.
- Only one dialog role is active for a single modal.
- The palette is announced as “Command palette” and its search input is named.

---

#### P1.5 Permanent chat deletion has no recovery path

**Evidence**

- Header action immediately calls `chatOp(..., 'del')` (`src/components/Header.tsx:104`).
- The sidebar row’s Shift action and its context-menu “Delete permanently” also execute immediately.
- Archive remains the default and is safer, which is good, but a user who intentionally uses Shift or the menu has no undo.

**Impact**

A single deliberate click permanently removes the chat and its messages. This is a data-loss hazard, not merely an interaction preference. The earlier product decision to remove a delete confirmation is compatible with an undo snackbar; it does not require restoring a blocking modal.

**Recommendation**

Keep archive-first and no blocking confirmation, but introduce a short-lived undo action after permanent deletion (for example, “Chat deleted — Undo” for 5 seconds). The store should hold the deleted chat until the undo window expires. A trash bin is the stronger long-term alternative.

**Acceptance criteria**

- Deleting from the header, row, and context menu offers Undo.
- Undo restores the chat with messages and sidebar position.
- The undo state is announced through a polite live region.

---

### P2 — high-value follow-up

#### P2.1 Browser history does not track chats or settings

**Evidence**

`App` writes routes with `history.replaceState` only (`src/App.tsx:56`). Chat selection never writes a URL, and opening/closing Settings replaces the current entry rather than pushing a new one.

**Impact**

Back/forward do not move between chats or close Settings; they leave the app. Individual chats are not deep-linkable. This is already noted in `FEATURE_AUDIT.md` §11.7, but it remains a real navigation gap.

**Recommendation**

Use `pushState` for meaningful navigation (chat selection, settings open/close) and handle `popstate`. Preserve a stable `#chat/<id>` route or a query-based equivalent. Do not put secrets in the URL.

---

#### P2.2 Custom menus do not follow a consistent keyboard contract

**Evidence**

- The row action menu has `role="menu"` (`src/components/Sidebar.tsx:89`) but no Escape handler, no initial focus move, and no ArrowUp/ArrowDown handling. It closes only on an outside `mousedown`.
- `Header`’s `Pop` menu renders `Item` buttons without `role="menuitem"`; focus stays on the trigger when the menu opens (`src/components/Header.tsx:96-108`, `src/components/ui.tsx:180-193`).
- `Settings`’ add-endpoint menu has partial arrow handling, but its items are also ordinary buttons.
- `ToolAccess` is the best-behaved menu: it uses `menuitemradio` and `aria-checked` (`src/components/ToolAccess.tsx:57-85`).

**Impact**

Keyboard and screen-reader behavior varies by menu. Escape does not always close; focus can remain behind an open menu; assistive technology may not announce the menu structure.

**Recommendation**

Extract one menu primitive or at least one hook: open → focus first item, Arrow keys move, Home/End, Escape closes and restores focus, Tab exits and closes. Use `role="menuitem"` for actions and `menuitemradio` for choices. Keep the existing outside-click behavior.

---

#### P2.3 Touch targets are below the 24 × 24 CSS px minimum in places

**Evidence**

`Toggle` is `h-5 w-9` (`src/components/ui.tsx:29`): a 20 px-high target. The browser accessibility scan reported 36 × 20 for every switch. The composer dictation control measured 18 × 36 at the narrow viewport.

**Impact**

WCAG 2.5.8 (Target Size, Minimum, AA) requires at least 24 × 24 CSS px, subject to spacing exceptions. The switches are especially important because they are used repeatedly in Settings.

**Recommendation**

Keep the visual track at 20 px if desired, but give the button a 24 px minimum hit area through padding or a pseudo-element. Do the same for icon-only composer controls.

---

#### P2.4 Bundle weight remains high

**Evidence**

- Main chunk: 902.82 kB / 302.88 kB gzip.
- Markdown chunk: 753.11 kB / 209.81 kB gzip.
- Settings chunk: 201.41 kB / 56.74 kB gzip, plus a separate 65.41 kB stats chunk loaded on demand.
- `Settings.tsx` statically imports `UsageStats` (`src/components/Settings.tsx:34`), so the 1,454-line stats surface travels with the already-large settings chunk.

**Impact**

Slow first load on mobile and slow first Markdown render. The Vite warning is a symptom, not the whole cost: parsing and executing 894 kB of JavaScript competes with hydration and the composer.

**Recommendation**

- Split `UsageStats` behind a lazy boundary inside the Settings Stats tab.
- Split heavy Settings tabs (Endpoints, Tools, Usage) rather than only the Settings shell.
- Revisit the Markdown pipeline: render plain text until a reply settles, or defer lowlight/KaTeX only when the content requires it.
- Add a bundle budget check to CI so regressions are visible.

---

#### P2.5 Several modules are too large to review or change safely

**Evidence**

| File | Lines |
|---|---:|
| `src/store.ts` | 3,506 |
| `src/components/Settings.tsx` | 2,562 |
| `src/workspace.ts` | 1,888 |
| `src/components/UsageStats.tsx` | 1,454 |
| `src/engine.ts` | 1,411 |
| `src/components/Chat.tsx` | 1,366 |

`Settings.tsx` contains the shell, all tab editors, model discovery, cURL import, memory, features, and appearance logic. `store.ts` mixes domain state, persistence shaping, chat operations, model routing, and UI-facing actions.

**Impact**

High merge-conflict risk, expensive code review, unclear ownership, and a larger surface for stale closures and state coupling. The size also encourages adding another branch to an already dense component instead of extracting a focused unit.

**Recommendation**

Carve `Settings` tabs into folder-level modules and move store slices into domain modules with narrow selectors. Do this incrementally around the next features; avoid a big-bang rewrite. Start with `UsageStats` because it is already a distinct surface and is statically imported.

---

#### P2.6 No browser-level regression suite or CI gate

**Evidence**

- 73 test files and 814 tests pass, but there is no React DOM test dependency, no Playwright/Cypress setup, and no checked-in `.github/workflows` directory.
- `package.json` has no `lint` script (`package.json:5-15`).
- The mobile drawer, unnamed switches, unnamed dialogs, and Seg state all passed the logic suite.

**Impact**

The most user-visible defects are outside the current test strategy. Every future settings or sidebar change can regress them silently.

**Recommendation**

Add a small Playwright suite for:
1. mobile drawer selection and new chat;
2. Settings → Features switch names;
3. command palette name and search input;
4. dialog focus trap and Escape restoration;
5. archive/restore and delete-undo;
6. a contrast/axe smoke pass.

Run `tsc`, `test`, `build`, and the browser smoke suite in CI. Add a lint/format check if the project wants one; do not add a second competing toolchain without a decision.

---

#### P2.7 Client key storage and app-shell hardening

**Evidence**

- Model and search keys are persisted through the browser store, as documented in `README.md` (“Model and search keys are stored in browser storage”).
- `index.html` has no Content-Security-Policy. The only CSP found is inside the sandboxed artifact document (`src/artifacts.ts:129`).
- The app relies on React escaping and `rehype-sanitize` for rendered Markdown; no `dangerouslySetInnerHTML` use was found.

**Impact**

This is a deliberate local-first tradeoff, not a confirmed vulnerability. However, any successful XSS, malicious extension, or shared-origin compromise can read long-lived provider keys. A missing app-shell CSP removes a useful defense-in-depth layer.

**Recommendation**

- Add a conservative CSP and standard security headers at the Node/Worker static-serving layer.
- Consider optional passphrase-wrapped key storage or a WebCrypto-encrypted vault for users who want it.
- Keep sharing and export sanitizers covered by tests; do not put keys in URLs or logs.

---

#### P2.8 Error containment is only top-level

**Evidence**

`main.tsx:53` mounts `<ErrorBoundary><App /></ErrorBoundary>`. A render failure in Settings, a widget, the workspace panel, or a single message therefore replaces the whole application shell with the fallback.

**Impact**

The user loses the composer and navigation while the fallback tells them to reload. Saved data is safe, but the blast radius is larger than necessary.

**Recommendation**

Add boundaries around independent panels: Settings content, widget rail, workspace/research panel, and the message list. Keep the top-level boundary as the final catch. Include a “copy diagnostics” action and avoid rendering raw stack traces to ordinary users by default.

---

### P3 — polish and maintainability

#### P3.1 Settings repeats the page title and description

`Panel` renders an `<h2>` with the tab title and an `INFO[id]` paragraph (`src/components/settingsPrimitives.tsx:52-63`). `Section` renders another heading and description (`:40-49`). `FeaturesTab` then passes the same “Features” title and a near-identical description (`src/components/Settings.tsx:439-440`).

The live accessibility tree showed:
- heading “Features” + description “Turn whole features on or off… never used by the AI…”
- heading “Features” + description “Turn whole features on or off…”

This is visually redundant and adds noise for screen-reader heading navigation. Use the Panel intro as the page description and let the first Section be a distinct group title (for example, “Feature switches”), or remove the duplicate heading.

#### P3.2 Native `window.confirm` is inconsistent with the design system

Only one destructive action uses the browser-native confirm: “Delete all stored memories” (`src/components/Settings.tsx:1787`). Every other destructive flow uses the custom `Confirm` component. Replace it with `Confirm` so the wording, focus order, theming, and Escape behavior match the rest of the app.

#### P3.3 `lucide-react` is pinned to `latest`

`package.json:20` uses `"lucide-react": "latest"`. The lockfile currently pins a version, but a fresh install or dependency refresh can move the icon package without a code review. Pin a compatible range and update deliberately.

#### P3.4 Dependency audit is clean except for low-risk math packages

`npm audit --omit=dev` reports four low-severity advisories in the KaTeX/micromark/rehype-math chain (prototype-pollution bypass of trust restrictions). The suggested fix installs `katex@0.19.1`, which is a breaking upgrade. Treat this as a planned dependency upgrade, not an emergency, and add a regression test for rendered math.

#### P3.5 Startup makes a failing third-party catalog request

In the local browser, startup logged:

`Access to fetch at 'https://models.litellm.ai/model_catalog' ... blocked by CORS policy`

The app continues, so this is not a functional failure, but it adds a failed request and console noise on boot. If this is an expected fallback, catch and suppress the browser-level error where possible; otherwise move the catalog probe behind an explicit user action or a server route.

---

## 6. UI/UX flow review

### First run and onboarding

The welcome flow is clear and gives a fast path plus “Customize first.” The non-dismissible modal is defensible for first-run setup, and “Skip setup” is present. The theme preview cards and recommended tools are good recognition aids.

Gaps:
- The “Customize first” step uses the same unlabeled switches and segmented controls described above.
- “Skip setup” appears both in the step footer area and as a text button in the tools step; the visual hierarchy is slightly repetitive.
- There is no visible indication of what “Skip setup” will leave configured (fast defaults vs. current selections).

### Desktop shell and sidebar

The desktop shell is well composed: sidebar, resizable divider, conversation, and optional widget rail. Archive-first rows are a strong safety improvement. Pinned, bookmarks, projects, and temporary chats are separated rather than mixed into one flat list.

Gaps:
- The row actions appear on hover/focus on desktop and are always visible on narrow screens; this is a reasonable compromise.
- The row context menu lacks Escape/focus handling.
- The title text is truncated without a `title` attribute on the title button, so the full name is only available through the accessibility tree or rename mode.
- The sidebar is not closed on mobile after ordinary selection.

### Chat and composer

The conversation surface is thoughtfully built: windowed history, jump-to-latest, pinned reply banner, find-in-conversation, selection-to-quote, process tree, and a bottom composer that becomes centered on an empty chat.

Gaps:
- The composer’s dictation control measured 18 × 36 at narrow width; icon-only controls need a minimum hit area.
- `Seg` is used for model/playlist and settings choices without selected-state semantics.
- The “Delete” action on messages is immediate in the message action row; this may be by design, but it should be covered by the same undo strategy as chat deletion.
- The message action buttons are icon-only and rely on `title`; this is workable, but a visible label on focus would help discovery.

### Settings

Settings is broad and searchable, with deep links and a mobile section selector. The lazy shell and tab search are good. The Features tab is visually dense because every feature is a reorderable card with a toggle, help icon, and expand control.

Gaps:
- Unnamed switches (P1.2).
- Selected Seg values are not announced (P1.3).
- Duplicate page/section headings (P3.1).
- Native confirm for one destructive action (P3.2).
- Heavy tabs are not independently lazy, which keeps the Settings chunk at 262 kB.

### Dialogs

`Modal` has a good focus trap and focus restoration. `Confirm` is well structured. The problems are naming and nesting, not the core focus mechanics.

Gaps:
- Project, palette, share, graph, sync, and lightbox dialogs are unnamed.
- Share/export/import dialogs nest a second dialog role inside the outer modal.
- The palette search field is placeholder-only.
- Several confirmation flows use a generic modal panel without a heading id; they should use `Confirm` or add one.

### Mobile

At 355 × 767 there is no horizontal overflow, and the composer remains reachable. The sidebar is a 288 px drawer with a dimming overlay, and actions are visible. The core failure is that selecting a row does not close the drawer. The Settings dialog uses the full mobile width and has a named dialog; the mobile section picker is present.

---

## 7. Architecture and reliability notes

### Persistence

The persistence layer is one of the strongest parts of the codebase:

- Boot hydration precedes render.
- Chat shards avoid whole-history writes.
- Writes are coalesced and flushed on hide.
- Durable mirroring and local backups use separate paths.
- Expired temporary and archived chats are pruned.
- Quota failures produce a visible warning and an export path.

Remaining risk: the store and persistence shaping are tightly coupled in `store.ts`. A future schema change needs a migration test for both localStorage shards and the durable mirror. The current `STORE_VERSION` is 25; keep migration coverage explicit for every bump.

### State and rendering

The code uses narrow Zustand slices and `useShallow` in several places, and `useSConfig` deliberately excludes live chat fields. That is a mature approach. The risk is that `Sidebar` still subscribes to the full `chats` array and recomputes filters on every chat change; with a very large history this is a potential streaming cost. The existing memoized rows reduce render cost, but the array-level work remains.

### Backend and trust boundaries

The backend design is coherent: one route dispatcher shared by Node and Workers, pure share/sync handlers, token hashing, same-origin checks, and rate limits. The public share path is capability-based by design. The main missing product controls are share revocation and expiry, which `FEATURE_AUDIT.md` already tracks as a feature gap.

### Maintainability

The primary maintainability cost is file size and mixed responsibility, not a lack of structure. There are clear modules for search, sync, persistence, citations, tools, and workspace. The largest components should be decomposed around existing seams rather than rewritten.

---

## 8. Prioritized roadmap

### Now — one focused pass

1. Close the mobile drawer on chat/new-chat/project selection.
2. Make `Toggle.label` required and name every switch.
3. Give `Seg` a radiogroup/radio or pressed-button semantics.
4. Label every dialog; remove nested dialog roles; label the palette search input.
5. Add undo for permanent chat deletion without restoring a blocking confirmation.

These are mostly local edits and should be paired with one small Playwright/axe regression file.

### Next — hardening and navigation

6. Add `pushState`/`popstate` for chats and settings.
7. Unify menu keyboard behavior and focus management.
8. Raise hit areas to 24 px minimum.
9. Lazy-load `UsageStats` and the heaviest Settings tabs; set a bundle budget.
10. Add CI for `tsc`, tests, build, and browser smoke checks.
11. Add CSP/security headers and evaluate optional protected key storage.
12. Add per-panel error boundaries.

### Later — structural work

13. Split `Settings.tsx`, `store.ts`, and `Chat.tsx` along existing feature seams.
14. Add a browser history/deep-link model with shareable chat URLs.
15. Add a real trash/undo model shared by chat and message deletion.
16. Add visual regression coverage for themes, dense transcripts, and the workspace/research panels.

---

## 9. Suggested acceptance tests

The following would have caught the confirmed issues:

```text
mobile drawer
  - open drawer at 390px
  - select a normal chat
  - expect drawer not visible and conversation visible
  - repeat for New chat and project open

accessibility names
  - open Settings → Features
  - for every [role=switch], expect an accessible name
  - open command palette, expect dialog name and named search input
  - open project modal, expect dialog name

segmented state
  - open Settings → Appearance
  - expect the selected appearance option to have aria-checked=true
  - change selection, expect the state to move

deletion recovery
  - delete a chat from the header
  - expect an Undo action
  - activate Undo, expect the chat restored

navigation
  - open chat A, then chat B
  - press Back, expect chat A
  - open Settings, press Back, expect Settings closed
```

---

## 10. Limitations

- No screen-reader application (NVDA/VoiceOver) session was run; findings use the browser accessibility tree and source semantics. A manual screen-reader pass is still recommended for the palette, menus, and process log.
- The browser checks covered the shell, Features settings tab, mobile drawer, and representative dialogs. They did not exhaustively traverse every one of the 18 settings tabs or every feature panel.
- The audit did not deploy to a production host or test a real provider key; server verification used the existing unit/integration/Worker tests.
- The `npm audit` result is a point-in-time registry result. The four low-severity math advisories need a planned upgrade, not an emergency patch.
- The uncommitted archive-first changes were treated as the current baseline and were not modified or committed.

---

## 11. Bottom line

This is a capable, thoughtfully engineered app with unusually good local-first persistence and backend hygiene. Its biggest weakness is not missing functionality; it is that the same interaction contract is reimplemented inconsistently across the UI. Naming controls, exposing selected state, closing the mobile drawer, and naming dialogs are small fixes that would materially improve the product for keyboard, screen-reader, and mobile users.

The highest-leverage next step is a single accessibility-and-mobile hardening pass, followed by browser-level regression tests and CI. Structural decomposition and bundle reduction should follow, not precede, those user-facing fixes.

---

## 12. Remediation log

This audit was carried through into implementation. The confirmed, user-visible defects below are fixed and covered by checks; the remaining items are listed honestly rather than implied complete.

### Closed in this pass

| Finding | Change | Commit |
|---|---|---|
| P1.1 mobile drawer | Row, new-chat, and project navigation now dismiss the drawer at narrow widths. | `d73745c` |
| P1.2 switch names | `Toggle.label` is required; every feature, prompt, command, document, welcome, and header switch is named. | `d73745c` |
| P1.3 segmented state | `Seg` is a labelled radiogroup with roving focus and `aria-checked`. | `d73745c` |
| P1.4 unnamed dialogs | Share, project, palette, graph, sync, and lightbox dialogs are labelled; duplicate nested dialog roles are removed; palette search is named. | `d73745c` |
| P1.5 delete recovery | Permanent deletion keeps an eight-second undo, including messages and sidebar position; attachment cleanup is deferred until expiry. | `d73745c` |
| P2.1 browser history | Chat switches and opening/closing Settings now push history entries; tab changes replace the current entry. Back/Forward restores the route and selected chat. | this pass |
| P2.1 chat deep links | `#chat/<id>` opens a stored chat on load or hash change, `Copy chat link` copies the local URL, and the address bar follows chat selection. Settings share and chat routes remain separate. | this pass |
| P2.2 menu keyboard contract | A shared menu hook moves focus to the selected/first item on open, handles arrows/Home/End, closes on Escape or Tab, and restores focus. Row actions, theme picker, endpoint type and the header actions use it. | this pass |
| P2.6 CI gate | A GitHub Actions workflow runs `tsc`, the full unit suite, Worker smoke checks, and the production build on every push and pull request. | this pass |
| P2.4 Settings weight | `UsageStats` is lazy-loaded: Settings fell from 262 kB to 201.41 kB, with a separate 65.41 kB stats chunk that loads only on demand. | `8b28a46` |
| P2.7 app-shell headers | Conservative CSP, `nosniff`, referrer policy, and frame/form restrictions are served by the static host and Worker. | `d73745c` |
| P2.8 error containment | Settings content and the widget rail have compact boundaries; the top-level boundary remains the final catch. | `91bfea3` |
| P3.2 native confirm | “Delete all stored memories” now uses the themed, focus-managed `Confirm` dialog. | `8b28a46` |
| P3.3 floating icon version | `lucide-react` is pinned to `^1.55.0` instead of `latest`. | `8b28a46` |
| Settings navigation | Groups now lead with Everyday (chats, appearance, tools), then models, writing, capabilities, and usage/app controls; search ranks an exact section above its child settings. | `8b28a46` |
| Private shares | A content-only update no longer silently makes a private share public; a regression test covers it. | `acd08b4` |

### Additional confirmed defects found while tracing model flows

These were not in the initial static review; they surfaced while exercising the transport path:

- SSE `error` events were parsed as malformed JSON, hiding the provider's message.
- The non-stream fallback did not share the header timeout or Stop handling.
- Invalid fallback JSON surfaced as a parse crash instead of a transport error.
- Custom gateways could not use the non-stream fallback.
- Retry budgeting was keyed only by endpoint, so two models shared one budget.
- A `200` reply with no body reached the stream reader and crashed instead of falling back.

All six are fixed in `f0821ef` and `9b2f7c5`, with focused regressions in `src/engine.test.mjs`.

### Verification at the end of this pass

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 814/814 passed |
| `npm run test:worker` | 14/14 passed |
| `npm run build` | passed; main 902.82 kB / 302.88 kB gzip, Settings 201.41 kB, lazy stats 65.41 kB |
| Browser checks | Settings opens on the requested deep link, grouped navigation and Recent render, search ranks results, keyboard ArrowDown reaches the first result, and the mobile/archive flows were exercised. |

### Still open / deliberately deferred

- **P2.1 local-only links:** chat links open only where the chat is stored; there is no cross-device chat URL or server-side chat sync.
- **P2.2 remaining menus:** row actions, theme, endpoint type, move-to-project, and header actions now share initial focus, arrows, Home/End, Escape and Tab dismissal. A few inline popovers still use older local behavior.
- **P2.3 remaining touch targets:** switches now have a larger pseudo-element hit area; some icon-only composer controls still need the same treatment.
- **P2.5 module size:** `Settings.tsx`, `store.ts`, and `Chat.tsx` remain large. This pass extracted the stats surface but did not attempt a risky big-bang split.
- **P2.6 browser gate:** `.github/workflows/ci.yml` now gates typecheck, unit tests, worker smoke checks, and the production build. There is still no Playwright/axe suite, so browser-only regressions remain manually checked.
- **P2.7 key protection:** CSP is defense in depth, not encryption at rest; provider keys remain in browser storage by design.
- **P3.4 math advisories:** the low-severity KaTeX/micromark advisories need a planned breaking upgrade and a rendered-math regression test.
- **P3.5 catalog probe:** the LiteLLM catalog can still log a browser CORS failure during discovery; the endpoint remains usable.
- **Markdown weight:** the separate Markdown/highlight/KaTeX chunk is still about 753 kB and loads on first rendered reply.
