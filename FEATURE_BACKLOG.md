# Feature backlog

Open improvements and follow-up work, ordered roughly by area and value. Shipped
items are removed rather than treated as missing; where a shipped feature only
partly addresses an idea, the remaining gap is described explicitly.

## Chat & conversation

- **Collapse all process logs** — one control to close every open "Process to
  answer" panel after reviewing a long tool-heavy reply.
- **Reply bookmarks** — bookmark individual messages and list them in the
  sidebar (distinct from chat pinning).

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
