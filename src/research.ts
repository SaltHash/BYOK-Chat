/* Deep research helpers. Pure + unit-testable; no DOM, no store imports.
 * The model drafts a plan first, then drives the whole run through the search
 * and fetch_page tools within the tier's budgets, then writes a long cited
 * report from the evidence gathered. */

export type ResearchTierId = 'quick' | 'standard' | 'thorough'

export type ResearchTier = {
  id: ResearchTierId
  label: string
  blurb: string
  maxSearches: number
  maxReads: number
  maxRounds: number
  timeoutMs: number
}

export const RESEARCH_TIERS: ResearchTier[] = [
  { id: 'quick', label: 'Quick', blurb: '8 searches · 4 reads', maxSearches: 8, maxReads: 4, maxRounds: 14, timeoutMs: 180000 },
  { id: 'standard', label: 'Standard', blurb: '24 searches · 10 reads', maxSearches: 24, maxReads: 10, maxRounds: 36, timeoutMs: 480000 },
  { id: 'thorough', label: 'Thorough', blurb: '60 searches · 20 reads', maxSearches: 60, maxReads: 20, maxRounds: 85, timeoutMs: 900000 },
]

export const RESEARCH_TIER_IDS = RESEARCH_TIERS.map((t) => t.id)

export const tierOf = (id: unknown): ResearchTier =>
  RESEARCH_TIERS.find((t) => t.id === String(id || '').trim().toLowerCase()) ?? RESEARCH_TIERS[1]

export type ResearchPrefs = { defaultTier: ResearchTierId }
export const BLANK_RESEARCH: ResearchPrefs = { defaultTier: 'standard' }
export const normResearch = (v: any): ResearchPrefs => {
  const id = String(v?.defaultTier || '').trim().toLowerCase()
  return { defaultTier: (['quick', 'standard', 'thorough'] as string[]).includes(id) ? (id as ResearchTierId) : 'standard' }
}

/* ---- Plan ---- */

export type ResearchPlanStepKind = 'search' | 'analyze' | 'report' | 'other'
/** `items` are the concrete research directions under a step, numbered the way
 * the plan card renders them ((1), (2), (a), …). */
export type ResearchPlanStep = { id: string; kind: ResearchPlanStepKind; label: string; items: string[] }
export type ResearchPlan = { title: string; intro: string; steps: ResearchPlanStep[] }

/** The sentence shown above the plan card before the plan itself. */
export const PLAN_INTRO = 'Here’s my plan to tackle that topic. Let me know if you need to make changes.'

/** The plan JSON shape + rules for the planning prompt. */
const PLAN_SHAPE = '{"title":"<short topic title, 2-7 words>","intro":"<one short sentence naming the goal>","steps":[{"kind":"search","label":"<2-4 word label>","items":["(1) ...","(2) ..."]},{"kind":"analyze","label":"Analyze Results","items":["(4) ..."]},{"kind":"report","label":"Create Report","items":["(5) ..."]}]}'
const PLAN_RULES = [
  'Rules:',
  '- 3 to 5 steps. The first step has kind "search" and covers looking things up on the web; include one kind "analyze" step and finish with one kind "report" step.',
  '- Number the search items (1), (2), (3) … in order and use (a), (b), (c) for sub-details inside an item (for example a parenthetical list of specifics to gather).',
  '- Items must be concrete directions (what to look up, which data to gather, which criteria to compare), never platitudes.',
  '- 3 to 8 items on the main search step; 1 to 3 items on the other steps.',
  '- Keep labels to four words or fewer. Do not use markdown, citations, or the word "step".',
].join('\n')

/** How many context searches the planning pass may run before drafting the plan. */
export const PLAN_SCOPE_MIN = 2
export const PLAN_SCOPE_MAX = 4

/** System prompt for the planning pass: scope the topic with a few context
 * searches first, then return the strict plan JSON. */
export const PLAN_SCOPE_SYSTEM = [
  'You draft a deep-research plan for a topic, the way a careful analyst would outline the work before starting.',
  `Before drafting it, search the web ${PLAN_SCOPE_MIN} to ${PLAN_SCOPE_MAX} times to get basic context on the topic: the key terms, the main players, and what is current or contested. Write each query yourself and refine it from the results. Read only search snippets here — full pages come later.`,
  'Then reply with strict JSON only — no prose, no markdown fence, no commentary — matching exactly this shape:',
  PLAN_SHAPE,
  '',
  PLAN_RULES,
].join('\n')

/** User turn for the planning call: the topic, the depth, and today's date. */
export function planUserAsk(query: string, tier: ResearchTier, now: Date = new Date()): string {
  return [
    `Topic: ${query}`,
    `Depth: ${tier.label} (up to ${tier.maxSearches} searches and ${tier.maxReads} page reads).`,
    `Today is ${todayStamp(now)}. Bias recent, authoritative sources for time-sensitive topics.`,
    `Search the web ${PLAN_SCOPE_MIN}–${PLAN_SCOPE_MAX} times for basic context, then draft the plan now as strict JSON only.`,
  ].join('\n')
}

const KIND_BY_LABEL = (label: string): ResearchPlanStepKind => {
  const l = label.toLowerCase()
  if (/\breport|write|summar|draft\b/.test(l)) return 'report'
  if (/analy|synthes|compare|review|evaluat|verify|assess|cross-?check/.test(l)) return 'analyze'
  if (/research|search|look|gather|investigat|collect|explore|find|read|site|source/.test(l)) return 'search'
  return 'other'
}

const normKind = (v: unknown, label: string): ResearchPlanStepKind => {
  const k = String(v ?? '').trim().toLowerCase()
  return k === 'search' || k === 'analyze' || k === 'report' ? (k as ResearchPlanStepKind) : KIND_BY_LABEL(label)
}

/** Coerce a parsed JSON object into a usable plan. Returns null when there is
 * nothing worth showing (no steps). Never throws. */
export function normalizePlan(v: any): ResearchPlan | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const rawSteps = Array.isArray(v.steps) ? v.steps : []
  const steps: ResearchPlanStep[] = rawSteps.slice(0, 6).flatMap((s: any, i: number): ResearchPlanStep[] => {
    const label = String(s?.label ?? s?.title ?? '').trim().slice(0, 60)
    if (!label) return []
    const items = (Array.isArray(s?.items) ? s.items : Array.isArray(s?.details) ? s.details : [])
      .map((x: any) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 10)
    return [{ id: `p${i + 1}`, kind: normKind(s?.kind, label), label, items }]
  })
  if (!steps.length) return null
  const title = String(v.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 90)
  const intro = String(v.intro ?? '').trim().replace(/\s+/g, ' ').slice(0, 240)
  return { title, intro, steps }
}

/** Pull the first JSON object out of a model reply (it may be fenced or have
 * stray prose around it) and normalize it. Null when nothing parses. Tries the
 * whole `{…}` span first, then scans balanced objects, so a second JSON object
 * in the reply can never swallow the first one. */
export function parseResearchPlan(raw: string): ResearchPlan | null {
  const text = String(raw ?? '')
  const start = text.indexOf('{')
  if (start < 0) return null
  const end = text.lastIndexOf('}')
  if (end > start) {
    try { const p = normalizePlan(JSON.parse(text.slice(start, end + 1))); if (p) return p } catch { /* scan below */ }
  }
  let depth = 0
  let open = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') { if (depth === 0) open = i; depth++ }
    else if (ch === '}' && depth > 0) {
      depth--
      if (depth === 0 && open >= 0) {
        try { const p = normalizePlan(JSON.parse(text.slice(open, i + 1))); if (p) return p } catch { /* try the next object */ }
        open = -1
      }
    }
  }
  return null
}

/** A deterministic plan used when the planning call fails or returns junk, so
 * the research flow can always proceed. */
export function fallbackPlan(query: string): ResearchPlan {
  const topic = String(query ?? '').trim().slice(0, 90)
  return {
    title: topic,
    intro: 'A default plan, since the planning pass did not return one.',
    steps: [
      { id: 'p1', kind: 'search', label: 'Research Websites', items: [
        `(1) Search for authoritative, recent sources on ${topic}.`,
        '(2) Prefer primary sources, official documentation, and expert commentary over aggregators.',
        '(3) Read the most relevant pages and extract the concrete facts each one supports.',
      ] },
      { id: 'p2', kind: 'analyze', label: 'Analyze Results', items: [
        '(4) Cross-check each load-bearing claim against a second independent source and note any disagreements.',
      ] },
      { id: 'p3', kind: 'report', label: 'Create Report', items: [
        '(5) Write a cited report with a summary, key findings, evidence, limitations, and a sources note.',
      ] },
    ],
  }
}

/** Render the plan as an instruction block for the research system prompt. */
export function planNote(plan: ResearchPlan): string {
  const lines: string[] = ['# Plan (already approved by the user)', 'Work through this plan. Adapt it if the evidence demands, but cover every item:']
  plan.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.label}`)
    for (const item of s.items) lines.push(`   ${item}`)
  })
  return lines.join('\n')
}

/* ---- Parsing @research requests ---- */

/* Parse @research(...) / @research tier: query / Deep research on X prompts.
 * Returns null when the text is not a research request. */
export function parseResearchRequest(raw: string): { query: string; tier: ResearchTierId | null } | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  // Explicit @research(query), @research[tier](query), @research tier: query
  const mParen = /@research(?:\[(quick|standard|thorough)\])?\s*\(\s*([\s\S]*?)\s*\)\s*$/i.exec(text)
  if (mParen) {
    const query = (mParen[2] ?? '').trim()
    if (!query) return null
    return { query: query.slice(0, 500), tier: (mParen[1]?.toLowerCase() as ResearchTierId) ?? null }
  }
  const mTier = /^@research\s+(quick|standard|thorough)\s*:\s*([\s\S]+)$/i.exec(text)
  if (mTier) {
    const query = (mTier[2] ?? '').trim()
    if (!query) return null
    return { query: query.slice(0, 500), tier: mTier[1].toLowerCase() as ResearchTierId }
  }
  const mBare = /^@research\s+([\s\S]+)$/i.exec(text)
  if (mBare) {
    const query = (mBare[1] ?? '').trim()
    if (!query) return null
    return { query: query.slice(0, 500), tier: null }
  }
  // prompt_chip follow-ups send "Deep research on X" / "Perform deep research on X".
  const mDeep = /^(?:perform\s+)?deep\s+research\s+(?:on|about|into)\s+([\s\S]+)$/i.exec(text)
  if (mDeep) {
    const query = (mDeep[1] ?? '').trim()
    if (!query) return null
    return { query: query.slice(0, 500), tier: null }
  }
  return null
}

/* ---- State ---- */

export type ResearchStepState = 'running' | 'done' | 'error'
/** `lead` is the narration the model wrote immediately before this step, so the
 * card always reads: thinking → the searches it led to. */
export type ResearchStep = { id: string; kind: 'search' | 'read'; label: string; query?: string; state: ResearchStepState; sources?: number; error?: string; lead?: string }
/** `planning` = drafting the plan; `plan` = waiting for the user to start it;
 * `writing` = the search phase is over and the model is writing the report. */
export type ResearchStatus = 'tier-pick' | 'planning' | 'plan' | 'running' | 'writing' | 'done' | 'stopped' | 'error'
export type ResearchState = {
  id: string
  query: string
  tier: ResearchTierId | null
  status: ResearchStatus
  steps: ResearchStep[]
  startedAt: number
  finishedAt?: number
  error?: string
  /** The approved research plan (see `ResearchPlan`). Generated before the run
   * and injected into the research system prompt; kept for the whole run. */
  plan?: ResearchPlan
  /** How many context searches the planning pass has run so far, shown while
   * the plan is scoping the topic (capped at `PLAN_SCOPE_MAX`). */
  scope?: number
  /** Rough, clearly-labelled ceiling for the run's usage/cost, shown before
   * the user starts it so a Thorough run is never a surprise. */
  estimate?: ResearchUsageEstimate
  /** Absolute wall-clock deadline for the run (epoch ms), fixed when the run
   * first starts and reused by retries and resumes, so the tier's time budget
   * bounds the whole run rather than restarting on every attempt. */
  deadlineAt?: number
  /** Narration of the round streaming right now. It moves onto the first step
   * that round produces (see `withStepLead`), so it never drifts. */
  note?: string
  /** Provider reasoning summaries accumulated during the run (see the
   * `onSummary` hook in the research loop). Shown in the progress card and
   * the report panel so the reasoning behind the report stays visible. */
  reasoning?: string
  /** Short abstract the model writes just before the report — the report
   * card's sample text. */
  summary?: string
}

/* ---- Budgets, freshness ---- */

export const researchBudgetNote = (tier: ResearchTier) =>
  `${tier.label} research: hard cap of ${tier.maxSearches} searches and ${tier.maxReads} page reads. This is a ceiling, never a target — stop early once settled.`

/** Today's date as YYYY-MM-DD, in UTC so the model researches the same
 * calendar day regardless of the user's local clock or time zone. */
export const todayStamp = (now: Date = new Date()): string =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`

/** The date one calendar year before `now`, as YYYY-MM-DD. Used as the
 * historical cutoff so the boundary does not jump a whole year on Jan 1. */
export const oneYearAgoStamp = (now: Date = new Date()): string =>
  todayStamp(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())))

/* ---- Usage / cost estimate ---- */

export const CHARS_PER_TOKEN = 4
/** Default per-search evidence budget (`BLANK_SEARCH.evidenceBudget`). */
export const SEARCH_EVIDENCE_CHARS = 12000
/** Server-side page-read cap (`EXTRACT_MAX_TEXT`). */
export const READ_EXCERPT_CHARS = 12000

export type ResearchUsageEstimate = { searches: number; reads: number; rounds: number; inputTokens: number; outputTokens: number; costUsd: number | null }

/** A rough ceiling for a run at the given tier, so the cost is visible before
 * the user starts. It includes the planning pass's context searches and plan
 * call (which happen before the run and are billed outside the tier's search
 * budget), and it accounts for evidence accumulating across rounds; it is
 * deliberately pessimistic (the caps are ceilings, runs stop earlier). */
export function estimateResearchUsage(tier: ResearchTier, price?: { input: number; output: number } | null): ResearchUsageEstimate {
  const perSearch = Math.ceil(SEARCH_EVIDENCE_CHARS / CHARS_PER_TOKEN)
  const perRead = Math.ceil(READ_EXCERPT_CHARS / CHARS_PER_TOKEN)
  const searches = tier.maxSearches + PLAN_SCOPE_MAX
  const evidence = searches * perSearch + tier.maxReads * perRead
  const rounds = tier.maxRounds + PLAN_SCOPE_MAX + 1
  const base = 2500
  const inputTokens = Math.round(rounds * (base + evidence / 2))
  const outputTokens = Math.round(rounds * 250 + 5000)
  const costUsd = price && (price.input > 0 || price.output > 0) ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null
  return { searches, reads: tier.maxReads, rounds, inputTokens, outputTokens, costUsd }
}

/* ---- Prompts ---- */

/** The fixed report sections, as [heading, description] pairs. Single source of
 * truth shared by the research system note and the report ask, so the two can
 * never drift. */
const REPORT_SECTIONS_SPEC: [string, string][] = [
  ['Summary', '3–6 sentences: what the question is, what the headline answer is, how confident it is.'],
  ['Key findings', 'Bulleted findings, one claim per bullet, each ending in its citation(s). Group related bullets under bold sub-heads when there are more than ~6.'],
  ['Evidence', 'One subsection per major claim. Quote or paraphrase the supporting snippet, then cite it. When comparing 2+ options, products, or approaches across multiple criteria — or weighing tradeoffs — add a Markdown table: options as rows, criteria as columns, citations in the cells, a legend for any scores or symbols, then 1–2 sentences of takeaway per table.'],
  ['Limitations', 'Bulleted list: what is uncertain, contested, or missing; what would change the answer.'],
  ['Sources note', '2–4 sentences on source quality (primary vs secondary, recency, agreement/disagreement). No new factual claims here.'],
]

/** A run must gather at least this many searches before it may close with an
 * abstract. Below it the loop nudges the model to keep researching, so a single
 * search can never become a "deep research" report. */
export const RESEARCH_MIN_SEARCHES = 2

/** The instruction appended when a run tries to close with too little evidence. */
export function researchMinAsk(have: number, want: number): string {
  const more = Math.max(1, want - have)
  return `You have only run ${have} ${have === 1 ? 'search' : 'searches'} so far. A sound deep-research answer needs more coverage than that. Run at least ${more} more ${more === 1 ? 'search' : 'searches'} across distinct angles and sources (and read the most relevant pages) before you close, then reply with the short abstract. Do not pad — search only what is still missing.`
}

export function researchSystemNote(query: string, tier: ResearchTier, now: Date = new Date(), plan?: ResearchPlan | null): string {
  const y = now.getUTCFullYear()
  const planBlock = plan && plan.steps.length ? [planNote(plan), ``] : []
  return [
    `# Task`,
    `You are doing deep research on: ${query}.`,
    ``,
    `# Method: holistic first, then specific`,
    `1. Build a holistic picture first. Name the core concept, its scope, and the 3–6 sub-questions a complete answer needs. Explore the concept being discussed as a whole before chasing details.`,
    `2. Search in small batches, then think. Aim for two or three queries per round — never fire five or more searches in parallel — and after each batch stop and write a short progress note on what the results actually show, what they contradict, and what is still missing. Let that reasoning set the next batch.`,
    `3. Then dive into specifics, one angle at a time: write each search query yourself, refine it from what you learn, and pick which result pages are worth reading in full with fetch_page.`,
    `4. Read one page at a time — never fire several fetch_page calls in parallel. Immediately after each read, write a short note on what that page actually established, what it contradicts, and which claim it now supports, then choose the next single page or search from that. Never fetch another page until you have reasoned about the one you just read; a read you have not reasoned about yet is wasted.`,
    `5. Work across diverse angles, sources, and domains. Prefer primary sources, and read only pages whose snippets suggest they will settle a claim.`,
    `6. Distinguish sourced facts from inference in every note and in the final report, and keep a tight search → reflect → refine loop instead of a wide parallel burst. Do not stop after one or two searches.`,
    `7. Verify before you close: confirm each load-bearing claim against a second, independent source. If a claim stays contested or one-sided, say so in the report rather than asserting it.`,
    ``,
    ...planBlock,
    `# Budgets: hard caps, not goals`,
    researchBudgetNote(tier),
    `Treat ${tier.maxSearches} searches as a hard cap, not a quota: search until you have a sound understanding of the question, a bit more if it stays murky, and stop early once it is fully settled. Never pad with extra searches to reach the cap. When a cap message says no further searches or reads are available, close out immediately with your abstract.`,
    ``,
    `# Empty or failed results`,
    `If a search returns no results, do not give up on the point: rewrite the query with different wording, add or remove qualifiers, or try a more specific domain, then search once more. If a page fails to read, move to another result. Never end the run because a single search or page failed.`,
    ``,
    `# Freshness`,
    `Today's date is ${todayStamp(now)}. Treat information published before ${oneYearAgoStamp(now)} as historical context unless the question is specifically about the past.`,
    `For dynamic, recent, or time-sensitive topics, bias every search toward freshness: include the current year (${y}) or an explicit date range in the query, favor primary sources, docs, and news published within the past 6–12 months, and verify the publish/updated timestamps on a page before extracting factual claims from it.`,
    `When newer and older sources conflict, favor the latest source and explicitly note the timeline shift.`,
    ``,
    `# Citations (absolute source IDs)`,
    `Every search returns evidence with absolute, run-wide source IDs ([Source S1], [Source S2], … [Source S60+]) that keep counting up across searches — they never restart at S1. Every page read is labelled with its own [Source S<n>] ID the same way.`,
    `Cite every factual claim taken from evidence inline as [S1], [S2], etc. using the source IDs from the evidence blocks (you may group several as [S1, S2], and you may also link them as [S1](url)). Never invent a source or an id, and never cite an id that is not shown in an evidence block. Never renumber or reuse an ID for a different page.`,
    ``,
    `# Report format (concrete)`,
    `The report itself comes in the next step, when you are asked for it. It must use exactly these sections, in this order:`,
    ...REPORT_SECTIONS_SPEC.flatMap(([h, b]) => [`## ${h}`, `  ${b}`]),
    ``,
    `# Handoff`,
    `When the picture is settled, stop searching and reply with only a short 2–3 sentence abstract of the report you are about to write: what it will cover and its headline findings. Do not write the report in that reply, and do not call search or fetch_page in it — you will be asked for the report next.`,
  ].join('\n')
}

/** The instruction that closes the research phase and produces the abstract. */
export const RESEARCH_ABSTRACT_ASK =
  'Research for this request is over. Reply with only a short 2–3 sentence abstract of the report you are about to write: what it will cover and its headline findings. No report yet, no headings, no citations, and no tool calls.'

/** The instruction that produces the report itself, streamed into the panel. */
export const RESEARCH_REPORT_ASK = [
  'Now write the final report from the evidence above, at length and in full.',
  '',
  'Use exactly these sections in order:',
  ...REPORT_SECTIONS_SPEC.map(([h, b]) => `## ${h} — ${b}`),
  '',
  'Cover every item of the agreed plan. Where a plan item stayed unresolved, say so in Limitations instead of inventing an answer.',
  'Citations: every factual claim must carry an inline [S1], [S2], etc. citation from the evidence blocks (group as [S1, S2] when several support one claim). A report with unsupported claims is a failure; never invent a source or an id, and never cite an id that is not in the evidence above.',
  'Comparisons: when comparing 2+ options or tradeoffs across criteria, add a Markdown table (options as rows, criteria as columns, citations in cells, legend for scores/symbols) plus a 1–2 sentence takeaway per table.',
  '',
  'Output the report only — no preamble, no meta commentary, no restating this instruction.',
].join('\n')

/** Repair ask used when the report cites ids that were never in the evidence. */
export function citationRepairAsk(unknown: string[], valid: string[]): string {
  return [
    `The report above cites source IDs that do not exist in the evidence: ${unknown.join(', ')}.`,
    valid.length ? `Valid IDs are only: ${valid.join(', ')}.` : 'No valid source IDs exist for this run.',
    'Rewrite the report in full, keeping its structure and content, but fix the citations: drop every invalid ID, keep only IDs that appear in the evidence, and reword any claim whose only support was an invalid ID so it is not cited.',
    'Output the corrected report only — no preamble and no explanation of the change.',
  ].join('\n')
}

/** Repair ask used when the report makes claims but cites no sources at all. */
export function citationUncitedAsk(valid: string[]): string {
  return [
    `The report above makes factual claims but cites no sources, even though this run gathered evidence: ${valid.join(', ')}.`,
    'Rewrite the report in full, keeping its structure and content, but add an inline [S1], [S2], etc. citation to every factual claim using only those source IDs. Reword or drop any claim you cannot support with one of them.',
    'Output the corrected report only — no preamble and no explanation of the change.',
  ].join('\n')
}

/* ---- Report detection / samples ---- */

const REPORT_SECTIONS = /\n#{1,4}\s*(summary|key findings|evidence|limitations|sources note)\b/gi

/** How many of the fixed report section headings appear in `text`. */
export function countReportSections(text: string): number {
  const t = `\n${String(text ?? '')}\n`
  const seen = new Set<string>()
  for (const m of t.matchAll(REPORT_SECTIONS)) seen.add((m[1] ?? '').toLowerCase())
  return seen.size
}

/** True when the model's closing text is already the report rather than the
 * abstract we asked for. Requires an actual report section, or a long reply
 * that carries its own markdown headings (a runaway abstract has neither, so
 * it is asked for the report rather than kept). */
export function looksLikeReport(text: string): boolean {
  const t = String(text ?? '').trim()
  if (countReportSections(t) >= 1) return true
  return t.length > 3600 && /(?:^|\n)#{1,4}[ \t]+\S/.test(t)
}

export function setStep(steps: ResearchStep[], id: string, patch: Partial<ResearchStep>): ResearchStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
}

/** Attach the in-flight round's narration to the step it produced, so the card
 * reads: thinking → the searches it led to → the next round's thinking. The
 * note rides along with the round's *first* step only: it is cleared here, so
 * later steps in the same round find nothing to attach and the block never
 * jumps above a search that was streamed after it. */
export function withStepLead(rs: ResearchState, step: ResearchStep): ResearchState {
  const lead = String(rs.note ?? '').trim()
  return { ...rs, note: '', steps: [...rs.steps, lead ? { ...step, lead } : step] }
}

/** The abstract for the report card: the model's own closing text from the
 * research phase. Falls back to the last round's narration, then the run text,
 * but skips anything that reads like a tool-call payload or is far too long to
 * be an abstract, so raw narration never lands in the card as its summary. */
export function researchAbstract(x: { text?: string; finalText?: string; rounds?: { text: string }[] }): string {
  for (const cand of [x.finalText, x.rounds?.[x.rounds.length - 1]?.text, x.text]) {
    const t = String(cand ?? '').trim()
    if (!t) continue
    if (/^\s*[[{]/.test(t) || t.length > 2000) continue
    return t
  }
  return ''
}

/** Filter round texts already shown as step leads, so the reasoning views
 * don't repeat the same narration twice. A round text is dropped when it
 * and some lead contain each other after normalizing whitespace and case
 * (leads are the streamed note attached to the step they produced). */
export function dedupTrace(trace: string[], leads: string[]): string[] {
  const norm = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const norms = leads.map(norm).filter((s) => s.length > 20)
  return trace.filter((t) => {
    const n = norm(t)
    if (!n) return false
    return !norms.some((l) => l.includes(n) || n.includes(l))
  })
}

/** One reasoning block for the report's Reasoning tab: the narration the model
 * wrote during a round, tagged with the range of searches it was analyzing. */
export type ResearchReasoningBlock = { id: string; label: string; query?: string; lead: string }

/** Build the Reasoning tab's blocks, each labelled by the searches the model
 * had gathered when it reasoned. When the model only reasons after a few
 * sources, the block spans them: a first block at `Search 5` reads
 * `Searches 1-5`, and a later block at `Search 11` reads `Searches 6-11`.
 * A block attached to a single fresh search keeps the plain `Search N` label,
 * and one attached to a page read keeps its own `Read N` label. */
export function reasoningBlocks(steps: ResearchStep[]): ResearchReasoningBlock[] {
  const out: ResearchReasoningBlock[] = []
  let searches = 0
  let prev = 0
  for (const s of steps) {
    if (s.kind === 'search') searches++
    const lead = String(s.lead ?? '').trim()
    if (!lead) continue
    const label = searches > prev + 1 ? `Searches ${prev + 1}-${searches}` : searches === prev + 1 ? `Search ${searches}` : s.label
    out.push({ id: s.id, label, query: s.query, lead })
    prev = searches
  }
  return out
}

/** Sample text for the report card when there is no abstract: the opening
 * section of the report, trimmed to its first sentence or two. */
export function reportSample(text: string, limit = 400): string {
  const paras = String(text ?? '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b && !/^#{1,4}\s/.test(b))
  const para = paras[0] ?? ''
  const first = /^[^.!?]*[.!?]/.exec(para)?.[0]?.trim() ?? ''
  const s = first.length >= 40 ? first : para
  return s.length > limit ? `${s.slice(0, limit).trimEnd()}…` : s
}

/* ---- Citation integrity ---- */

/** Remove citations to ids that are not in `validIds` (keeping any valid ids
 * inside a grouped token). Returns the rewritten text plus the ids dropped, so
 * a run can surface that it had to repair the model's citations. Pure. */
export function sanitizeCitations(text: string, validIds: Iterable<string>): { text: string; removed: string[] } {
  const valid = new Set([...validIds].map((v) => String(v).toUpperCase()))
  const removed = new Set<string>()
  const out = String(text ?? '').replace(/( |&nbsp;|\u00a0)?\[(?:Sources? )?([^\]\n]{1,80})\](?:\([^)\n]*\))?/gi, (full, sp: string, inner: string) => {
    if (!/S\d+/i.test(inner)) return full
    const stripped = String(inner)
      .replace(/sources?/gi, '')
      .replace(/\band\b/gi, '')
      .replace(/S\d+/gi, '')
      .replace(/[,;+\s&]/g, '')
    if (stripped !== '') return full
    const ids = (inner.match(/S\d+/gi) ?? []).map((id) => id.toUpperCase())
    if (!ids.length) return full
    const known = ids.filter((id) => valid.has(id))
    for (const id of ids) if (!valid.has(id)) removed.add(id)
    if (!known.length) return ''
    if (known.length === ids.length) return full
    return `${sp ? ' ' : ''}[${[...new Set(known)].join(', ')}]`
  }).replace(/ {2,}/g, ' ').replace(/ \n/g, '\n')
  return { text: out, removed: [...removed].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) }
}

/* ---- Context compaction ---- */

/** Keep this many most-recent tool rounds verbatim; older rounds are compacted
 * before they are re-sent, so a long run's transcript cannot grow without
 * bound. Citation IDs survive compaction, so the report's [S<n>] still resolve. */
export const RESEARCH_KEEP_FULL_ROUNDS = 8
/** Cap on the accumulated provider reasoning kept on a run's card. The most
 * recent reasoning is the most useful, so the tail is kept. */
export const RESEARCH_REASONING_CHARS = 8000
const COMPACT_MARK = '\n[compacted: an older result trimmed to save context]'

/** Trim one tool result for re-sending: search evidence keeps ids/titles/URLs
 * with shortened snippets, page reads keep their opening; both stay citable. */
export function compactResult(name: string, result: string, opts: { snippetChars?: number; pageChars?: number } = {}): string {
  const text = String(result ?? '')
  if (!text) return text
  if (name === 'search') {
    const snippetChars = opts.snippetChars ?? 320
    let changed = false
    const out = text.replace(/(Snippet: )([^\n]*)/g, (full, pre: string, body: string) => {
      const b = String(body)
      if (b.length <= snippetChars) return full
      changed = true
      return `${pre}${b.slice(0, snippetChars).trimEnd()}…`
    })
    return changed ? out + COMPACT_MARK : out
  }
  if (name === 'fetch_page') {
    const pageChars = opts.pageChars ?? 1500
    let changed = false
    const out = text.replace(/(<page_excerpt>\n?)([\s\S]*?)(\n?<\/page_excerpt>)/, (full, open: string, body: string, close: string) => {
      const b = String(body).trim()
      if (b.length <= pageChars) return full
      changed = true
      return `${open}${b.slice(0, pageChars).trimEnd()}\n[compacted: remainder of the excerpt trimmed]${close}`
    })
    return changed ? out : text
  }
  return text.length > 1500 ? `${text.slice(0, 1500).trimEnd()}${COMPACT_MARK}` : text
}

/** Copy `rounds` with every round except the last `keepRecent` compacted. */
export function compactResearchRounds<T extends { calls: { name: string; result?: string; error?: boolean }[] }>(rounds: T[], keepRecent = RESEARCH_KEEP_FULL_ROUNDS): T[] {
  if (!rounds.length) return rounds
  const cut = Math.max(0, rounds.length - Math.max(0, keepRecent))
  if (cut === 0) return rounds
  return rounds.map((round, i) => i >= cut ? round : ({ ...round, calls: round.calls.map((call) => ({ ...call, result: call.result != null && !call.error ? compactResult(call.name, call.result) : call.result })) }))
}
