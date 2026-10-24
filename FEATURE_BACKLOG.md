# Feature backlog

Minor and nice-to-have ideas that were deliberately **not** implemented. Ordered
by area, roughly by value within each area. Nothing here is a defect; everything
in this list is an enhancement on top of the current feature set.

Already promoted from this list into the app: prompt history (`↑`/`↓` in the
composer, with a configurable recall mode), the text-size scale, code soft-wrap,
the reduce-transparency switch, the high-contrast switch, and a per-chat storage
breakdown in Settings → Data controls → Browser storage.

## Chat & conversation

- **Copy as Markdown** — a per-reply action that copies the reply with its
  formatting (tables, code fences) rather than the raw streamed text.
- **In-conversation find** — `Ctrl/Cmd+F` inside a transcript with a match count
  and next/previous jumps, reusing the existing `flashMsg` highlight.
- **Pin a reply** — keep a single answer visible (a small "pinned" strip under
  the header) without branching or copying it into another chat.
- **Collapse all process logs** — one control to close every open "Process to
  answer" panel after reviewing a long tool-heavy reply.
- **Quote selection in reply** — select text in a reply and get a composer
  action that pre-fills it as a quote.
- **Archive chats** — move a chat out of the sidebar without deleting it, with
  an "Archived" filter next to the existing temporary/pinned sections.
- **Reply bookmarks** — bookmark individual messages and list them in the
  sidebar (distinct from chat pinning).
- **Message dot rail** — a vertical strip of dots down the left edge of the
  conversation, one dot per message. Dots render in the faint text colour and
  brighten to normal text colour on hover; clicking a dot scrolls the
  conversation so the top of the screen aligns with the start of that message
  (a quick way to jump around a long transcript instead of scrolling).

## Composer

- **Attachment reordering** — drag to reorder pending attachments before send.
- **Image paste preview** — show a thumbnail and dimensions between paste and
  attach instead of attaching silently.
- **Command argument hints** — per-command argument placeholders in the `/`
  menu (today commands only show their name and description).

## Appearance & accessibility

- **Accent-only palettes** — generate a full theme from a single picked colour
  instead of adjusting a base theme.
- **Focus-ring style** — choose between the outline and a ring, and its width.
- **Code block options** — line numbers, and a max-height before the block
  scrolls (the soft-wrap toggle and the block/header padding sliders are
  already in Settings → Appearance).
- **Style preset sharing** — export/import a preset (radii, shadows, density and
  spacing overrides) as a small JSON blob.

## Settings & navigation

- **Favourite settings** — pin frequently used sections to the top of the
  settings sidebar and the command palette.
- **Recently changed** — a short list of the last edited settings per session.
- **Per-tab reset** — "Reset this section to defaults" beside each settings
  section heading.
- **Palette coverage for values** — let the palette jump to individual values
  (a specific theme, density or style preset), not just the section.

## Data & sync

- **Scheduled backups** — an opt-in daily encrypted backup file download.
- **Date-range export** — export only chats active within a chosen window.
- **Sync conflict viewer** — show both sides of a merge instead of resolving
  silently with last-write-wins.

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
- **Report source highlighting** — jump from a claim in the report to the exact
  excerpt used, with the sentence highlighted.
- **Citation export** — download a report's sources as BibTeX or plain links.

## Performance & polish (internal)

- **Virtualise very long transcripts** — window message rows past a few hundred
  messages; today every row stays mounted.
- **Incremental markdown diffing** — reuse parsed blocks when only the tail of a
  streaming reply changes.
- **Catalog prefetch** — warm the model catalog on idle so opening Endpoints is
  instant.
- **Settings tab code splitting** — load heavy tabs (Endpoints, Tools) lazily.
