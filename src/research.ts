import { ARTIFACT_REPORT_NOTE } from './artifacts'

/* Deep research helpers. Pure + unit-testable; no DOM, no store imports.
 * The model drafts a plan first, then drives the whole run through the search
 * and fetch_page tools within the tier's budgets, then writes a long cited
 * report from the evidence gathered. */

export type ResearchTierId = 'quick' | 'standard' | 'thorough'

export type ResearchTier = {
  id: ResearchTierId
  label: string
  blurb: string
  /** Searches and page reads the orchestrator may run itself. */
  maxSearches: number
  maxReads: number
  maxRounds: number
  timeoutMs: number
  /** Delegation rounds the orchestrator may open (0 = no subagents). */
  agentRounds: number
  /** Subagents one delegation call may start (a wave). */
  agentsPerRound: number
  /** Per-subagent search and page-read budget. */
  agentSearches: number
  agentReads: number
}

/** Thorough-mode delegation: rounds of parallel subagents, then follow-ups. */
export const RESEARCH_AGENT_ROUNDS_DEFAULT = 3
export const RESEARCH_AGENT_ROUNDS_MIN = 1
export const RESEARCH_AGENT_ROUNDS_MAX = 6
export const RESEARCH_AGENTS_PER_ROUND = 3
/** Generous per-subagent budgets: an agent is expected to investigate deeply. */
export const RESEARCH_AGENT_SEARCHES = 16
export const RESEARCH_AGENT_READS = 8
/** Extra budget a subagent may spend answering one follow-up question. */
export const AGENT_FOLLOW_UP_SEARCHES = 6
export const AGENT_FOLLOW_UP_READS = 3
export const AGENT_FOLLOW_UPS_MAX = 3

export const normResearchAgentRounds = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(RESEARCH_AGENT_ROUNDS_MIN, Math.min(RESEARCH_AGENT_ROUNDS_MAX, Math.round(v)))
    : RESEARCH_AGENT_ROUNDS_DEFAULT

const thoroughBlurb = (rounds: number) =>
  `${rounds} subagent round${rounds === 1 ? '' : 's'} × ${RESEARCH_AGENTS_PER_ROUND} agents · ${RESEARCH_AGENT_SEARCHES} searches · ${RESEARCH_AGENT_READS} reads each`

export const RESEARCH_TIERS: ResearchTier[] = [
  { id: 'quick', label: 'Quick', blurb: '8 searches · 4 reads', maxSearches: 8, maxReads: 4, maxRounds: 14, timeoutMs: 180000, agentRounds: 0, agentsPerRound: 0, agentSearches: 0, agentReads: 0 },
  { id: 'standard', label: 'Standard', blurb: '24 searches · 10 reads', maxSearches: 24, maxReads: 10, maxRounds: 36, timeoutMs: 480000, agentRounds: 0, agentsPerRound: 0, agentSearches: 0, agentReads: 0 },
  { id: 'thorough', label: 'Thorough', blurb: thoroughBlurb(RESEARCH_AGENT_ROUNDS_DEFAULT), maxSearches: 12, maxReads: 5, maxRounds: 24, timeoutMs: 1800000, agentRounds: RESEARCH_AGENT_ROUNDS_DEFAULT, agentsPerRound: RESEARCH_AGENTS_PER_ROUND, agentSearches: RESEARCH_AGENT_SEARCHES, agentReads: RESEARCH_AGENT_READS },
]

export const RESEARCH_TIER_IDS = RESEARCH_TIERS.map((t) => t.id)

/** Resolve a depth id. Thorough's delegation-round budget is user-configurable
 * (Settings → Tools → Deep research); everything else is fixed by the tier. */
export const tierOf = (id: unknown, agentRounds?: unknown): ResearchTier => {
  const base = RESEARCH_TIERS.find((t) => t.id === String(id || '').trim().toLowerCase()) ?? RESEARCH_TIERS[1]
  if (base.id !== 'thorough' || agentRounds == null) return base
  const rounds = normResearchAgentRounds(agentRounds)
  return { ...base, agentRounds: rounds, blurb: thoroughBlurb(rounds) }
}

/* ---- Plan ---- */

export type ResearchPlanStepKind = 'search' | 'analyze' | 'report' | 'other'
/** `items` are the concrete research directions under a step, numbered the way
 * the plan card renders them ((1), (2), (a), …). */
export type ResearchPlanStep = { id: string; kind: ResearchPlanStepKind; label: string; items: string[] }
export type ResearchQuestion = { id: string; question: string; options: string[] }
export type ResearchAnswer = { question: string; answer: string }
export type ResearchPlan = { title: string; intro: string; steps: ResearchPlanStep[]; /** 1-3 clarifying questions drafted after the plan's context searches. The
 * plan card asks them before the run so the answer can be tailored. */ questions?: ResearchQuestion[]; /** Set by the model when the user explicitly asked it to begin the run; the
 * harness starts research on its own when this is true (the AI decides, not a
 * regex on the user's message). */ startNow?: boolean }

/** The sentence shown above the plan card before the plan itself, followed by
 * the plan. The intro invites the user to edit the plan (the plan is also
 * shown as a numbered ordered list and can be edited manually). */
export const PLAN_INTRO = 'Here’s my plan to tackle that topic. You can reply with changes, or click the list below to edit it manually.'

/** The plan JSON shape + rules for the planning prompt. */
const PLAN_SHAPE = '{"title":"<short topic title, 2-7 words>","intro":"<one short sentence naming the goal>","steps":[{"kind":"search","label":"<2-4 word label>","items":["(1) ...","(2) ..."]},{"kind":"analyze","label":"Analyze Results","items":["(4) ..."]},{"kind":"report","label":"Create Report","items":["(5) ..."]}],"questions":[{"question":"<something only the user can answer>","options":["<short choice>","<short choice>"]}]}'
const PLAN_RULES = [
  'Rules:',
  '- 3 to 5 steps. The first step has kind "search" and covers looking things up on the web; include one kind "analyze" step and finish with one kind "report" step.',
  '- Number the search items (1), (2), (3) … in order and use (a), (b), (c) for sub-details inside an item (for example a parenthetical list of specifics to gather).',
  '- Items must be concrete directions (what to look up, which data to gather, which criteria to compare), never platitudes.',
  '- 3 to 8 items on the main search step; 1 to 3 items on the other steps.',
  '- Keep labels to four words or fewer. Do not use markdown, citations, or the word "step".',
  '- Optionally add "questions": 1 to 3 questions for the user, each with 2 to 5 short options, when the answers would materially change the direction, scope, or format of the research. Ask only what the topic itself cannot settle (their goal, constraints, timeframe, audience, or which tradeoff they care about). Never ask something you could find on the web. If the request is already specific, omit the field or leave it empty.',
  '- If the user explicitly asked to start or begin the research now, set "startNow": true so the research begins right away. Otherwise omit this field.',
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

/** User turn for the planning call: the topic, the depth, today's date, and an
 * optional follow-up review (the user's feedback on an earlier plan to revise). */
export function planUserAsk(query: string, tier: ResearchTier, now: Date = new Date(), followUp?: string, answers?: ResearchAnswer[]): string {
  const depth = tier.agentRounds > 0
    ? `${tier.label} (up to ${tier.agentRounds} subagent rounds of ${tier.agentsPerRound} agents, each with ${tier.agentSearches} searches and ${tier.agentReads} page reads).`
    : `${tier.label} (up to ${tier.maxSearches} searches and ${tier.maxReads} page reads).`
  const parts = [
    `Topic: ${query}`,
    `Depth: ${depth}`,
    `Today is ${todayStamp(now)}. Bias recent, authoritative sources for time-sensitive topics.`,
    `Search the web ${PLAN_SCOPE_MIN}–${PLAN_SCOPE_MAX} times for basic context, then draft the plan now as strict JSON only.`,
  ]
  if (answers?.length) {
    parts.push('')
    parts.push('# The user already answered your clarifying questions')
    for (const a of answers) parts.push(`- ${a.question}\n  Answer: ${a.answer}`)
    parts.push('Tailor the plan, the search directions, and the report format to these answers. Do not ask the same questions again; only include new ones that these answers exposed.')
  }
  if (followUp) {
    parts.push('')
    parts.push(`# Earlier plan feedback\nThe user reviewed the plan above and asked for this change: "${followUp.trim().slice(0, 400)}". Revise the plan to address it, then return the new strict JSON only.`)
  }
  return parts.join('\n')
}

/** A tool-free retry used when the first planning reply is prose, is cut off,
 * or otherwise has no parseable plan. The previous reply is included only as
 * context; the model is told explicitly what shape is required. */
export function planRepairAsk(query: string, tier: ResearchTier, previous: string, now: Date = new Date(), followUp?: string, answers?: ResearchAnswer[]): string {
  const base = planUserAsk(query, tier, now, followUp, answers)
  const prior = String(previous ?? '').replace(/\s+/g, ' ').trim().slice(-3000)
  return `${base}\n\nYour previous reply did not contain a usable plan. Return the plan now as strict JSON only, with no prose or markdown fences. It must have "title", "intro", and 3 to 5 "steps"; every step needs a non-empty "label" and "items"; the first step's kind is "search", include an "analyze" step, and finish with a "report" step.${prior ? `\n\nPrevious reply (possibly incomplete):\n${prior}` : ''}`
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
  // Some models wrap the plan in {"plan":{...}}; accept that without making
  // the normal shape ambiguous. A top-level plan always wins.
  const plan = v.plan && typeof v.plan === 'object' && !Array.isArray(v.plan) ? v.plan : v
  const rawSteps = Array.isArray(plan.steps) ? plan.steps : []
  const steps: ResearchPlanStep[] = rawSteps.slice(0, 6).flatMap((s: any, i: number): ResearchPlanStep[] => {
    if (typeof s === 'string') {
      const label = s.trim().replace(/\s+/g, ' ').slice(0, 60)
      return label ? [{ id: `p${i + 1}`, kind: normKind('', label), label, items: [] }] : []
    }
    const label = String(s?.label ?? s?.title ?? '').trim().slice(0, 60)
    if (!label) return []
    const rawItems = Array.isArray(s?.items) ? s.items : Array.isArray(s?.details) ? s.details : typeof s?.items === 'string' ? [s.items] : []
    const items = rawItems
      .map((x: any) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 10)
    return [{ id: `p${i + 1}`, kind: normKind(s?.kind, label), label, items }]
  })
  if (!steps.length) return null
  const title = String(plan.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 90)
  const intro = String(plan.intro ?? '').trim().replace(/\s+/g, ' ').slice(0, 240)
  const startNow = typeof plan.startNow === 'boolean' ? plan.startNow : false
  const seen = new Set<string>()
  const questions: ResearchQuestion[] = (Array.isArray(plan.questions) ? plan.questions : []).flatMap((q: any, i: number): ResearchQuestion[] => {
    const question = String(q?.question ?? (typeof q === 'string' ? q : '')).replace(/\s+/g, ' ').trim().slice(0, 240)
    if (question.length < 8) return []
    const key = question.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    const options = (Array.isArray(q?.options) ? q.options : [])
      .map((o: any) => String(o ?? '').replace(/\s+/g, ' ').trim().slice(0, 80))
      .filter((o: string) => o.length > 0)
      .filter((o: string, j: number, all: string[]) => all.indexOf(o) === j)
      .slice(0, 5)
    return [{ id: `q${i + 1}`, question, options }]
  }).slice(0, 3)
  return { title, intro, steps, startNow, ...(questions.length ? { questions } : {}) }
}

/** Pull readable title/label fragments out of a partially streamed plan. The
 * planning call returns strict JSON, so there is no parseable object until the
 * end; this gives the card something honest to show while it streams. */
export function planPreview(raw: string): { title?: string; steps: string[] } {
  const clean = String(raw ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '')
  const read = (v: string) => v.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\s+/g, ' ').trim()
  const title = /"title"\s*:\s*"([^"]*)/.exec(clean)?.[1]
  const steps = [...clean.matchAll(/"label"\s*:\s*"([^"]*)/g)].map((m) => read(m[1])).filter(Boolean).slice(0, 6)
  return { title: title ? read(title).slice(0, 120) : undefined, steps: [...new Set(steps)] }
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
  const topic = String(query ?? '').trim().slice(0, 90) || 'this topic'
  return {
    title: topic,
    intro: 'A default plan, because the planning reply could not be read.',
    steps: [
      { id: 'p1', kind: 'search', label: 'Find sources', items: [
        `(1) Search for authoritative, recent sources on ${topic}.`,
        '(2) Prefer primary sources, official documentation, and expert commentary over aggregators.',
        '(3) Read the most relevant pages and extract the concrete facts each one supports.',
      ] },
      { id: 'p2', kind: 'analyze', label: 'Compare findings', items: [
        '(4) Cross-check each load-bearing claim against a second independent source and note any disagreements.',
      ] },
      { id: 'p3', kind: 'report', label: 'Write report', items: [
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

/** One subagent delegated by a Thorough run's orchestrator. The card shows its
 * brief, spending, and report; follow-ups reuse the same agent (its evidence is
 * kept in memory for the run and condensed into the follow-up prompt). */
export type ResearchAgentSource = { citeId: string; title: string; url: string }
export type ResearchDepth = 'scan' | 'standard' | 'deep'
export const RESEARCH_DEPTHS: ResearchDepth[] = ['scan', 'standard', 'deep']
/** Depth is a decision about evidence, not another name for the budget. */
export const normResearchDepth = (v: unknown): ResearchDepth => {
  const d = String(v ?? '').trim().toLowerCase()
  return d === 'scan' || d === 'deep' ? d : 'standard'
}
export const researchDepthNote = (depth: ResearchDepth, tier: ResearchTier): string => {
  if (depth === 'scan') return `Reconnaissance: 2–4 searches and 1–2 page reads. Map the landscape, define the key terms and players, and name the open questions. Do not try to prove every claim; say what needs a deeper pass.`
  if (depth === 'deep') return `Deep verification: up to ${tier.agentSearches} searches and ${tier.agentReads} page reads. Target primary sources, exact figures, dates, and contradictions. Confirm each load-bearing claim independently and say what remains contested.`
  return `Standard cited brief: 6–10 searches and 3–5 page reads. Establish the main facts and mechanisms, support each key claim with a source, and flag anything that needs a deeper pass.`
}
export type ResearchAgent = {
  id: string
  /** 1-based delegation wave this agent belongs to. */
  round: number
  label: string
  brief: string
  /** The depth the lead explicitly assigned, with a safe default for old runs. */
  depth?: ResearchDepth
  status: 'running' | 'done' | 'error' | 'stopped'
  searches: number
  reads: number
  /** Actual subagent spend, when the provider reports it or a price is set. */
  costUsd?: number
  /** The clean, cited report returned to the orchestrator. */
  answer?: string
  error?: string
  followUps?: { q: string; a: string }[]
  /** Follow-up calls that failed. Kept separately: the original report can
   * still be valid, but the card must not show a clean check for a failed
   * follow-up. */
  followUpErrors?: string[]
  sources?: ResearchAgentSource[]
}

/** Waves that actually ran (an agent that failed before doing anything does
 * not consume its round). */
export const agentRoundsUsed = (agents?: ResearchAgent[]): number =>
  new Set((agents ?? []).filter((a) => a.status !== 'error' || a.searches > 0 || a.reads > 0).map((a) => a.round)).size

/** Evidence searched by subagents, counted toward the run's minimum-evidence
 * floor so a delegated run is never nudged as if it had only one search. */
export const agentEvidenceSearches = (agents?: ResearchAgent[]): number =>
  (agents ?? []).reduce((n, a) => n + Math.max(0, a.searches), 0)

/** Dedupe subagent sources by absolute citation id, for the report's source
 * list and its citation validation. */
export const agentSources = (agents?: ResearchAgent[]): ResearchAgentSource[] => {
  const byId = new Map<string, ResearchAgentSource>()
  for (const a of agents ?? []) for (const s of a.sources ?? []) {
    if (!s || !s.citeId || !s.url || byId.has(s.citeId)) continue
    byId.set(s.citeId, s)
  }
  return [...byId.values()].sort((a, b) => Number(a.citeId.slice(1)) - Number(b.citeId.slice(1)))
}

/** A wire-only user turn carrying a mid-run instruction to the lead model.
 * It is not added to the visible chat; the research card shows the focus. */
export const researchSteerNote = (text: string): string =>
  `Mid-run update from the user (the research is already underway — incorporate this without restarting or discarding evidence already gathered):\n${String(text ?? '').trim().slice(0, 800)}`

/** Search or page-read attempts that actually returned something, i.e. the
 *  ones that count against a tier's budget. Failed attempts stay in `steps`
 *  (the progress card shows them) but never consume a slot. */
export const countedSteps = (steps: ResearchStep[], kind: 'search' | 'read'): number =>
  steps.filter((s) => s.kind === kind && s.state !== 'error').length
/** `planning` = drafting the plan; `plan` = waiting for the user to start it;
 * `writing` = the search phase is over and the model is writing the report. */
export type ResearchStatus = 'tier-pick' | 'planning' | 'questions' | 'plan' | 'running' | 'writing' | 'done' | 'stopped' | 'error'
export type ResearchState = {
  id: string
  query: string
  tier: ResearchTierId | null
  status: ResearchStatus
  steps: ResearchStep[]
  startedAt: number
  /** Readable fragments extracted from the planning stream before the strict
   *  JSON is complete. The plan card shows these as a live outline, then
   *  replaces them with the parsed plan. */
  planDraft?: { title?: string; steps: string[] }
  finishedAt?: number
  error?: string
  /** The approved research plan (see `ResearchPlan`). Generated before the run
   * and injected into the research system prompt; kept for the whole run. */
  plan?: ResearchPlan
  /** Answers the user gave to the plan's clarifying questions, injected into
   * planning revisions and the research prompt so the run is tailored. */
  answers?: ResearchAnswer[]
  /** Subagents delegated during a Thorough run. */
  agents?: ResearchAgent[]
  /** How many context searches the planning pass has run so far, shown while
   * the plan is scoping the topic (capped at `PLAN_SCOPE_MAX`). */
  scope?: number
  /** Moderate-use estimate for the run's usage/cost, shown before the user
   * starts it so a Thorough run is never a surprise. */
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
  /** A focus the user added while the run was underway. It is injected as a
   * user turn on the next research round (never into the visible chat), so the
   * lead can redirect without restarting or losing gathered evidence. */
  steer?: string
}

/* ---- Budgets, freshness ---- */

export const researchBudgetNote = (tier: ResearchTier) => tier.agentRounds > 0
  ? `${tier.label} research: at most ${tier.agentRounds} subagent round${tier.agentRounds === 1 ? '' : 's'}, with up to ${tier.agentsPerRound} agents per round and ${tier.agentSearches} searches plus ${tier.agentReads} page reads per agent, and at most ${tier.maxSearches} searches and ${tier.maxReads} page reads of your own. These are ceilings, never targets — stop early once settled.`
  : `${tier.label} research: hard cap of ${tier.maxSearches} searches and ${tier.maxReads} page reads. This is a ceiling, never a target — stop early once settled.`

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
/** Default per-search snippet text (8 results × 1,800 characters). */
export const SEARCH_EVIDENCE_CHARS = 14400
/** Server-side page-read cap (`EXTRACT_MAX_TEXT`). */
export const READ_EXCERPT_CHARS = 12000

export type ResearchUsageEstimate = {
  searches: number
  reads: number
  rounds: number
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  /** Expected cost of one subagent at its assigned depth. */
  agentCostUsd: number | null
  /** Expected cost of one full round (all agents in that round). */
  roundCostUsd: number | null
}

/** A moderate-use estimate for a run at the given tier, so the cost is visible
 * before the user starts. Most runs stop well below their caps, so this uses
 * roughly half of the available search/read budget rather than the full ceiling,
 * then adds a small token buffer. It includes the planning pass's context
 * searches and plan call, and it accounts for evidence accumulating across
 * rounds. The result is usually a little above the final cost, not a worst case. */
export function estimateResearchUsage(tier: ResearchTier, price?: { input: number; output: number } | null): ResearchUsageEstimate {
  const perSearch = Math.ceil(SEARCH_EVIDENCE_CHARS / CHARS_PER_TOKEN)
  const perRead = Math.ceil(READ_EXCERPT_CHARS / CHARS_PER_TOKEN)
  const agentCount = Math.max(0, tier.agentRounds) * Math.max(0, tier.agentsPerRound)
  // Lead searches are often front-loaded while subagents tend to stop once
  // their brief is covered. A 55%/45% share is intentionally conservative.
  const searches = Math.round(tier.maxSearches * 0.55 + PLAN_SCOPE_MAX + agentCount * tier.agentSearches * 0.45)
  const reads = Math.round(tier.maxReads * 0.55 + agentCount * tier.agentReads * 0.45)
  const evidence = searches * perSearch + reads * perRead
  // A subagent's own transcript is compacted each round; its ceiling is the
  // evidence it may gather plus a few reasoning rounds. Multi-agent runs really
  // do cost multiples of a single agent's tokens, so the visible estimate says so.
  const agentRoundsEach = Math.ceil(tier.agentSearches / 3) + tier.agentReads + 4
  const rounds = Math.round(tier.maxRounds * 0.55 + PLAN_SCOPE_MAX + 1 + agentCount * agentRoundsEach * 0.55)
  const base = 2500
  const agentInput = agentCount * agentRoundsEach * (2000 + (tier.agentSearches * perSearch + tier.agentReads * perRead) / 2) * 0.5
  const agentOutput = agentCount * (agentRoundsEach * 220 + 1400) * 0.5
  const headroom = 1.08
  const inputTokens = Math.round((rounds * (base + evidence / 2) + agentInput) * headroom)
  const outputTokens = Math.round((rounds * 250 + 5000 + agentOutput) * headroom)
  const priced = price && (price.input > 0 || price.output > 0) ? price : null
  const costUsd = priced ? (inputTokens * priced.input + outputTokens * priced.output) / 1e6 : null
  // Per-agent and per-round figures make the team estimate inspectable: the
  // plan card can show what one subagent costs and what a whole wave adds.
  const perAgentInput = agentCount > 0 ? agentInput / agentCount : 0
  const perAgentOutput = agentCount > 0 ? agentOutput / agentCount : 0
  const agentCostUsd = priced && agentCount > 0 ? ((perAgentInput * priced.input + perAgentOutput * priced.output) / 1e6) * headroom : null
  const roundCostUsd = agentCostUsd != null ? agentCostUsd * tier.agentsPerRound : null
  return { searches, reads, rounds, inputTokens, outputTokens, costUsd, agentCostUsd, roundCostUsd }
}

/* ---- Prompts ---- */

/** The fixed report sections, as [heading, description] pairs. Single source of
 * truth shared by the research system note and the report ask, so the two can
 * never drift. */
const REPORT_SECTIONS_SPEC: [string, string][] = [
  ['Headline answer', 'Open with the direct answer to the user’s question, in one or two plain sentences they can act on. When the answer ranks, compares, or recommends (2+ options, or a best pick), put it in a compact Markdown table instead of a sentence: options as rows, the criterion and the result as columns, citations in the cells, a legend for any score or symbol, and a one-line footnote under the table for the main caveat. Never bury the answer mid-sentence in Summary. If the prompt has no single answerable question, lead with the most important takeaway.'],
  ['Summary', '3–6 sentences: what the question is, how the headline answer was reached, and how confident it is.'],
  ['Key findings', 'Bulleted findings, one claim per bullet, each ending in its citation(s). Group related bullets under bold sub-heads when there are more than ~6.'],
  ['Evidence', 'One subsection per major claim. Quote or paraphrase the supporting snippet, then cite it. When comparing 2+ options, products, or approaches across multiple criteria — or weighing tradeoffs — add a Markdown table: options as rows, criteria as columns, citations in the cells, a legend for any scores or symbols, then 1–2 sentences of takeaway per table.'],
  ['Limitations', 'Bulleted list: what is uncertain, contested, or missing. Say when the evidence is simply absent rather than implying the opposite claim is true. Note where sources disagree, which side is better evidenced, and what would change the answer.'],
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

/** The delegation protocol, injected only for tiers with subagents. Built from
 * production guidance: every brief carries an objective, scope boundaries, and
 * an output contract; broad separable angles are parallelized; the lead keeps
 * synthesis and writing; follow-ups reuse an agent's retained evidence. */
export function researchTeamNote(tier: ResearchTier): string {
  if (tier.agentRounds <= 0) return ''
  return [
    `# Research team (${tier.label})`,
    `You are the lead researcher. You may delegate up to ${tier.agentRounds} round${tier.agentRounds === 1 ? '' : 's'} of subagents: each delegate_research call starts one round with up to ${tier.agentsPerRound} independent agents, each with its own context and a budget of ${tier.agentSearches} searches and ${tier.agentReads} page reads.`,
    `- Split broad, genuinely separable angles between agents (entity, time period, source class, sub-question). Before you delegate, decide the split so parallel agents never cover the same ground: give each a distinct scope and say what it must not cover. Write briefs as a short, self-contained assignment with the facts to find (names, dates, numbers, comparisons) and the boundary; a vague brief causes duplicated work and gaps.`,
    `- Define the depth you expect on every task, using its depth field: "scan" for a 2–4 search reconnaissance, "standard" for a 6–10 search cited brief, or "deep" for primary-source verification with 12+ searches. The brief must state the evidence bar, not just the topic. Match depth to what the report needs, not to the number of rounds available.`,
    `- Delegate the exploration, keep the judgment. Do not delegate something you could settle in one search, and do not use agents to double-check your own writing.`,
    `- Round 1 is broad reconnaissance: distinct areas, key terms, players, and the landscape. Round 2 is only for named gaps, contradictions, or verification, with narrower scopes and a clearer evidence bar. Any later round is only for unresolved load-bearing claims, aimed at primary sources or a specific disagreement. Before every round after the first, state what is still missing and why a new agent is needed; never repeat an earlier round's scope or add an agent just to fill the roster.`,
    `- One round can be the whole run. After each round, if the reports cover the question and the load-bearing claims are supported, close with your abstract immediately. Rounds are a ceiling, not a checklist; never open another round just because one remains, and never burn the budget to reach the configured number.`,
    `- After a round returns, read the reports before acting. Ask follow-up questions with ask_research_agent when an answer is thin, ambiguous, or contradicted by another agent: the agent keeps its earlier evidence, answers from it, and searches further only when needed.`,
    `- Use your own search and fetch_page for gaps no agent could settle, for a quick check of a load-bearing contradiction, and for anything that appears after a round.`,
    `- Agent reports are distilled evidence and carry real, run-wide [S<n>] ids. Trust their citations, cite those ids yourself, and never renumber them. If two agents disagree, prefer the one whose claims are better sourced and say so in the report.`,
    `- You write the final report. Never ask an agent to write it, and never let a subagent's summary replace your own reading of the evidence.`,
    ``,
  ].join('\n')
}

/** The nudge that opens a round when a Thorough run tries to do everything
 * itself first. */
export const researchDelegationAsk = (tier: ResearchTier) =>
  `No subagents have been delegated yet. This is ${tier.label} research: open a delegation round now with delegate_research, splitting the largest unanswered angles into 2-3 distinct briefs (state each brief's depth and what it must not cover). Make this first round a broad reconnaissance. Then use the reports to decide: if they already settle the question, close with your abstract immediately; otherwise ask a follow-up or open one narrower round for the named gap. Do not keep searching everything yourself, and do not open extra rounds just because they are available.`

export function researchSystemNote(query: string, tier: ResearchTier, now: Date = new Date(), plan?: ResearchPlan | null, answers?: ResearchAnswer[]): string {
  const y = now.getUTCFullYear()
  const planBlock = plan && plan.steps.length ? [planNote(plan), ``] : []
  const answerBlock = answers?.length ? [
    `# What the user told you`,
    `The user answered clarifying questions before the run. Treat these as requirements, not suggestions, and tailor the scope, comparisons, and report format to them:`,
    ...answers.map((a) => `- ${a.question}\n  ${a.answer}`),
    ``,
  ] : []
  const teamBlock = tier.agentRounds > 0 ? [researchTeamNote(tier)] : []
  const capLine = tier.agentRounds > 0
    ? `Treat ${tier.agentRounds} delegation round${tier.agentRounds === 1 ? '' : 's'} as a hard cap, not a quota: stop delegating once the picture is settled. A single well-covered round is a complete run; close with your abstract as soon as the evidence supports the answer. When the round cap is reached, ask follow-ups or close out with your abstract.`
    : `Treat ${tier.maxSearches} searches as a hard cap, not a quota: search until you have a sound understanding of the question, a bit more if it stays murky, and stop early once it is fully settled. Never pad with extra searches to reach the cap.`
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
    `8. Stop deliberately, not when you run out of budget: close once every load-bearing claim has support from two independent sources, or one primary source when no second exists. Distinguish absence of evidence ("I found no source for this") from evidence of absence ("sources show it is not the case") and never turn the first into the second.`,
    `9. Judge the source, not just the result: prefer primary sources (official announcements, filings, specifications, papers, first-party documentation) over SEO roundups, content farms, undated aggregators and marketing copy. When reputable sources disagree, report both positions and say which is better evidenced and why; never average them into a false middle.`,
    `10. Answer the user's actual question. When the prompt asks for a verdict, ranking, recommendation, or comparison, commit to one and make it the first thing the report says — never bury it mid-sentence in the Summary. When the prompt has no single answerable question, lead with the most important takeaway instead.`,
    ``,
    ...planBlock,
    ...answerBlock,
    ...teamBlock,
    `# Budgets: hard caps, not goals`,
    researchBudgetNote(tier),
    capLine,
    `When a cap message says no further searches, reads, or rounds are available, close out immediately with your abstract.`,
    ``,
    `# Empty or failed results`,
    `If a search returns no results, do not give up on the point: rewrite the query with different wording, add or remove qualifiers, or try a more specific domain, then search once more. If a page fails to read, move to another result. Never end the run because a single search or page failed.`,
    `Failed searches and unreadable pages do not count against your budget, so retrying with a different query or URL costs nothing; only searches and reads that return something are charged.`,
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

/* ---- Subagents ---- */

/** One delegated assignment. `avoid` is the boundary that keeps parallel
 * agents from covering the same ground. */
export type ResearchTask = { label: string; brief: string; avoid?: string; depth?: ResearchDepth | string }

/** The subagent's system prompt: role, a self-contained assignment, source
 * discipline, and a dense output contract. Deliberately verbose in the
 * investigation and compact in the report, which is what keeps the lead's
 * context clean without losing substance. */
export function agentSystemNote(query: string, tier: ResearchTier, task: ResearchTask, now: Date = new Date()): string {
  return [
    `# Role`,
    `You are a research subagent working for a lead researcher who is writing a report on: ${query}.`,
    ``,
    `# Your assignment`,
    `Label: ${task.label}`,
    task.brief,
    ...(task.avoid ? ['', `Do not cover (another agent owns this): ${task.avoid}`] : []),
    `Depth expected: ${normResearchDepth(task.depth)}. ${researchDepthNote(normResearchDepth(task.depth), tier)}`,
    ``,
    `# How to investigate`,
    `- Start wide, then narrow. Run 2-3 short queries per round, read the results, and note in one line what they established and what is still missing before choosing the next round. Refine queries from what you learn instead of repeating them.`,
    `- Read the pages whose snippets promise to settle a claim; one page read at a time (pass what you need in \`info\`), and reason about that page before reading another.`,
    `- Prefer primary sources (official documents, filings, papers, first-party documentation) over SEO roundups, content farms, and marketing copy. When reputable sources disagree, keep both positions and note which is better evidenced.`,
    `- Distinguish what a source says from what you infer. Absence of evidence is not evidence of absence: say that you found nothing instead of asserting the opposite.`,
    `- Today is ${todayStamp(now)}. For time-sensitive topics prefer recent sources, include the year in queries, and check publish dates before relying on a page.`,
    `- Budget: up to ${tier.agentSearches} searches and ${tier.agentReads} page reads. This is a hard ceiling, not a target; stop as soon as the assignment is answered. Failed searches and unreadable pages do not spend the budget.`,
    `- You cannot ask the user anything. Work only from the web and this assignment.`,
    ``,
    `# What to return`,
    `Be thorough in the investigation but compact in the report: in-depth enough that the lead can rely on it without opening your sources, and never padded. No process narration ("I searched…"), no restating the assignment, no filler.`,
    `- Aim for 500-900 words. Every sentence must carry information the lead cannot get elsewhere: names, dates, figures, mechanisms, tradeoffs, and disagreements.`,
    `- Use these sections in order: "## Findings" (one bullet per claim, the concrete fact first), "## Conflicts and caveats" (where sources disagree or the evidence is thin; say plainly when you found nothing), and "## Sources" (one line per source actually used: [S<n>] title — url).`,
    `- Cite every factual claim inline with the absolute [S<n>] ids returned by search and page reads, for example [S12]. Never invent an id and never renumber a source.`,
    `- Quote sparingly; paraphrase and cite. Return the report only, with no preamble.`,
  ].join('\n')
}

/** The subagent's opening user turn. The assignment itself lives in the system
 * prompt so it survives every round of the agent's tool loop. */
export const agentAsk = (task: ResearchTask) =>
  `Start the assignment now: ${task.label}. Return your findings report when it is complete.`

/** A follow-up's budget and the appended rules. The agent keeps its earlier
 * evidence (condensed into the prompt) and only searches for what is missing. */
export function agentFollowUpNote(budget: { searches: number; reads: number }, evidence?: string): string {
  return [
    `# Follow-up from the lead researcher`,
    `The lead read your report and is asking a follow-up question below. Answer it from the evidence already gathered in this conversation and your earlier findings. Search or read further only for the parts that evidence does not settle: you may use up to ${budget.searches} more searches and ${budget.reads} more page reads.`,
    `Do not repeat your earlier report. Answer the question directly and completely in 300-600 words, with the same citation rules. If the evidence still does not settle it, say so plainly instead of guessing.`,
    ...(evidence ? ['', `# Evidence you gathered earlier (condensed)`, evidence] : []),
  ].join('\n')
}

/** Condense a subagent's tool rounds into a follow-up context block: search
 * evidence with shortened snippets, page text opening, and the run-wide ids.
 * Keeps the tail (most recent evidence) when the block would be too large. */
export function agentEvidenceDigest(rounds: { calls: { name: string; result?: string; error?: boolean }[] }[], limit = 9000): string {
  const parts: string[] = []
  for (const round of rounds ?? []) {
    for (const call of round.calls ?? []) {
      if (call.error || !call.result) continue
      if (call.name !== 'search' && call.name !== 'fetch_page') continue
      const label = call.name === 'search' ? 'Search evidence' : 'Page read'
      parts.push(`[${label}]\n${compactResult(call.name, call.result, { snippetChars: 280, pageChars: 1200 })}`)
    }
  }
  const text = parts.join('\n\n')
  if (text.length <= limit) return text
  return `[earlier evidence, most recent kept]\n${text.slice(-limit)}`
}

/** How a delegation round is reported back to the orchestrator: a compact
 * header per agent plus its full report. */
export function agentResultNote(a: ResearchAgent): string {
  const head = `[Subagent ${a.label} · round ${a.round} · ${a.depth ?? 'standard'} depth · ${a.searches} searches, ${a.reads} page reads${a.followUps?.length ? `, ${a.followUps.length} follow-up${a.followUps.length === 1 ? '' : 's'}` : ''}${a.costUsd != null ? ` · ≈$${a.costUsd.toFixed(a.costUsd < 0.01 ? 3 : 2)}` : ''}]`
  if (a.status === 'error' || a.status === 'stopped') return `${head}\nThis agent did not complete: ${a.error || 'stopped'}. Cover its assignment yourself or delegate it again in a later round.`
  return `${head}\n${a.answer || 'The agent returned no report.'}`
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
  'Subagent reports above are distilled evidence written for you; reuse their inline [S<n>] citations. An id is valid only when it appears in the evidence or in a subagent report.',
  'The reader must get the answer from the first lines: lead with the direct answer the prompt asked for (a table when it ranks or compares options), not with background, a restatement of the question, or a caveat.',
  'Citations: every factual claim must carry an inline [S1], [S2], etc. citation from the evidence blocks (group as [S1, S2] when several support one claim). A report with unsupported claims is a failure; never invent a source or an id, and never cite an id that is not in the evidence above.',
  'Comparisons: when comparing 2+ options or tradeoffs across criteria, add a Markdown table (options as rows, criteria as columns, citations in cells, legend for scores/symbols) plus a 1–2 sentence takeaway per table.',
  '',
  ARTIFACT_REPORT_NOTE,
  '',
  'Output the report only — no preamble, no meta commentary, no restating this instruction. The optional artifact fence is the only exception.',
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

const REPORT_SECTIONS = /\n#{1,4}\s*(headline answer|summary|key findings|evidence|limitations|sources note)\b/gi

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
    const raw = String(cand ?? '').trim()
    if (!raw) continue
    if (/^\s*[[{]/.test(raw)) continue
    // Models often narrate first and only then label the abstract, so keep the
    // body under the label and drop the narration that came before it.
    const t = abstractBody(raw) || raw
    if (t.length > 2000) continue
    return t
  }
  return ''
}

/** A model-written abstract usually carries its own label — `**Abstract:**`,
 * `Abstract:`, or a heading such as `## Abstract`. The label is chrome, and
 * anything written before it is narration, not summary, so both are dropped. */
const ABSTRACT_LABEL = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+(?:\*\*|__)?[ \t]*abstract[ \t]*:?[ \t]*(?:\*\*|__)?|(?:\*\*|__)[ \t]*abstract[ \t]*:?[ \t]*(?:\*\*|__)[ \t]*:?|abstract[ \t]*:)[ \t]*/gi

/** The text after the last abstract label, or '' when the reply has none. */
export function abstractBody(text: string): string {
  const t = String(text ?? '')
  let cut = -1
  for (const m of t.matchAll(ABSTRACT_LABEL)) {
    if (m.index == null) continue
    cut = m.index + m[0].length
  }
  return cut < 0 ? '' : t.slice(cut).replace(/^\s+/, '').trim()
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
    // Failed searches never gathered anything, so they do not advance the
    // "Searches 1-5" ranges; they keep their own "Search failed" label.
    if (s.kind === 'search' && s.state !== 'error') searches++
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
    const ids = (inner.match(/S\d+/gi) ?? []).map((id) => id.toUpperCase())
    if (!ids.length) return full
    if (stripped !== '') {
      // Prose that happens to contain S-ids ("see [S9 above]"): strip only the
      // unknown ids from the prose and log them, instead of leaving a
      // citation-looking token untouched.
      const bad = [...new Set(ids.filter((id) => !valid.has(id)))]
      if (!bad.length) return full
      for (const id of bad) removed.add(id)
      let cleaned = ` ${String(inner)} `
      for (const id of bad) cleaned = cleaned.replace(new RegExp(`(\\s*[,;]\\s*|\\s+)${id}\\b`, 'gi'), '')
      cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
      return cleaned ? `${sp ? ' ' : ''}[${cleaned}]` : ''
    }
    const known = ids.filter((id) => valid.has(id))
    for (const id of ids) if (!valid.has(id)) removed.add(id)
    if (!known.length) return ''
    if (known.length === ids.length) return full
    return `${sp ? ' ' : ''}[${[...new Set(known)].join(', ')}]`
  })
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
