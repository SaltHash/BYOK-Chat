/* Deep research orchestration helpers. Pure + unit-testable; no DOM, no store imports.
 * Hybrid flow: code-driven breadth (decompose + parallel search) then
 * model-driven depth (tool loop with remaining budget) and a long cited report. */

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
  { id: 'quick', label: 'Quick', blurb: '5 searches · ~1-2 min', maxSearches: 5, maxReads: 3, maxRounds: 10, timeoutMs: 120000 },
  { id: 'standard', label: 'Standard', blurb: '12 searches · ~3-5 min', maxSearches: 12, maxReads: 8, maxRounds: 18, timeoutMs: 300000 },
  { id: 'thorough', label: 'Thorough', blurb: '22 searches · deeper reads', maxSearches: 22, maxReads: 12, maxRounds: 28, timeoutMs: 600000 },
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

export type ResearchStepState = 'queued' | 'running' | 'done' | 'error' | 'skipped'
export type ResearchStep = { id: string; kind: 'search' | 'read' | 'synthesize'; label: string; query?: string; state: ResearchStepState; sources?: number; error?: string }
export type ResearchStatus = 'tier-pick' | 'running' | 'done' | 'stopped' | 'error'
export type ResearchState = {
  id: string
  query: string
  tier: ResearchTierId
  status: ResearchStatus
  steps: ResearchStep[]
  startedAt: number
  finishedAt?: number
  error?: string
}

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

/* Code-driven breadth: turn one question into 3-6 diverse sub-queries.
 * Heuristic only (no model call) so budgets stay predictable; the model
 * adds follow-ups in the depth phase. */
export function decomposeResearch(query: string, maxSearches: number): string[] {
  const q = String(query ?? '').trim().replace(/\s+/g, ' ').slice(0, 300)
  if (!q) return []
  const out: string[] = [q]
  const variants = [
    `${q} overview`,
    `${q} latest developments`,
    `${q} evidence and data`,
    `${q} expert analysis`,
    `${q} criticisms and limitations`,
  ]
  for (const v of variants) {
    if (out.length >= Math.max(3, Math.min(6, maxSearches))) break
    if (!out.includes(v)) out.push(v)
  }
  return out.slice(0, Math.max(1, Math.min(6, maxSearches)))
}

export function researchStepsFor(query: string, tier: ResearchTier): ResearchStep[] {
  const subs = decomposeResearch(query, tier.maxSearches)
  const steps: ResearchStep[] = subs.map((q, i) => ({ id: `s${i + 1}`, kind: 'search', label: `Search ${i + 1}`, query: q, state: 'queued' }))
  steps.push({ id: 'synth', kind: 'synthesize', label: 'Synthesize report', state: 'queued' })
  return steps
}

export const researchBudgetNote = (tier: ResearchTier) =>
  `${tier.label} research: up to ${tier.maxSearches} searches and ${tier.maxReads} page reads.`

export function researchSystemNote(query: string, tier: ResearchTier): string {
  return [
    `You are doing deep research on: ${query}.`,
    researchBudgetNote(tier),
    'Use the search tool for breadth and fetch_page for depth. Prefer primary sources and diverse domains.',
    'Distinguish sourced facts from inference. Cite every factual claim taken from evidence inline as [S1], [S2], etc. using the source IDs from the evidence blocks.',
    'Finish with a structured long-form report: ## Summary, ## Key findings, ## Evidence, ## Limitations, ## Sources note. Keep citations inline; do not invent sources or ids.',
  ].join('\n')
}

export function setStep(steps: ResearchStep[], id: string, patch: Partial<ResearchStep>): ResearchStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
}
