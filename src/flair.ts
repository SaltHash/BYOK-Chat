// Personality microcopy, prompt qualities, and small completion flourishes.
// Kept free of store imports so both the store and the components can use it.

const pick = <T,>(list: readonly T[], seed: number): T => list[((seed % list.length) + list.length) % list.length]

/* Holiday lines: short, evocative, and never a flat greeting. */
const HALLOWEEN = [
  'Something is stirring tonight. What now?',
  'The candles are lit. Where to?',
  'A cold wind tonight. Where do we start?',
  'The pumpkins are glowing. What first?',
]

const CHRISTMAS = [
  'The tree is up. What are we making?',
  'Lights everywhere. Where do we start?',
  'Something warm is in the oven.',
  'Frost on the sill. What now?',
]

const NEW_YEAR = [
  'The clock is turning. Where to?',
  'A blank page. What now?',
  'One year closing. What next?',
]

const VALENTINE = [
  'Something sweet in the air. What first?',
  'A little more warmth today.',
]

/* Each holiday opens a window around its own day. Halloween and Christmas run
   three weeks early and two days late; the list order breaks any overlap, so
   Christmas ends before the New Year window opens. */
type Season = { month: number; day: number; daysBefore: number; daysAfter: number; lines: readonly string[] }

const HOLIDAYS: readonly Season[] = [
  { month: 10, day: 31, daysBefore: 21, daysAfter: 2, lines: HALLOWEEN },
  { month: 12, day: 25, daysBefore: 21, daysAfter: 2, lines: CHRISTMAS },
  { month: 1, day: 1, daysBefore: 4, daysAfter: 1, lines: NEW_YEAR },
  { month: 2, day: 14, daysBefore: 0, daysAfter: 0, lines: VALENTINE },
]

const DAY_MS = 86_400_000

/** A local calendar day as a UTC-midnight stamp, so window math never drifts on DST. */
const stamp = (year: number, month: number, day: number) => Date.UTC(year, month, day)

/** The holiday covering `now`, with a key identifying that year's window. */
function windowFor(now: Date): { key: string; lines: readonly string[] } | null {
  const today = stamp(now.getFullYear(), now.getMonth(), now.getDate())
  for (const h of HOLIDAYS) {
    /* Check the neighbouring years too, so windows that wrap the year end
       (New Year, and Christmas in late December) match at either end. */
    for (const year of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
      const day = stamp(year, h.month - 1, h.day)
      if (today < day - h.daysBefore * DAY_MS || today > day + h.daysAfter * DAY_MS) continue
      return { key: `${h.month}-${h.day}-${year}`, lines: h.lines }
    }
  }
  return null
}

/** Every line the date's holiday can show, or null when no holiday is near. */
export function seasonalLines(now: Date): readonly string[] | null {
  return windowFor(now)?.lines ?? null
}

/* One draw per window, so the greeting is random on each load but does not
   change under the reader on every render. */
const drawn = new Map<string, string>()

/** Seasonal greeting for the current date, or null when no holiday is near. */
export function seasonalLine(now: Date): string | null {
  const hit = windowFor(now)
  if (!hit) return null
  let line = drawn.get(hit.key)
  if (!line) {
    line = pick(hit.lines, Math.floor(Math.random() * 1e6))
    drawn.set(hit.key, line)
  }
  return line
}

const GREETINGS = {
  morning: ['Good morning. What are we working on?', 'Morning. What should we tackle first?', 'Fresh start. What shall we build?'],
  afternoon: ['Good afternoon. What do you want to work on?', 'Afternoon. What is on the list?', 'What should we tackle this afternoon?'],
  evening: ['Good evening. What are we making?', 'Evening. What do you want to work on?', 'What shall we build tonight?'],
  night: ['Still up? Let’s make something good.', 'Late-night session. What are we building?', 'Quiet hours. What do you want to work on?'],
} as const

/** Time-of-day greeting; `seed` (e.g. chat count) rotates the line as you use the app. */
export function greetingFor(now: Date, seed: number): string {
  const h = now.getHours()
  const slot = h >= 5 && h < 12 ? GREETINGS.morning : h >= 12 && h < 17 ? GREETINGS.afternoon : h >= 17 && h < 22 ? GREETINGS.evening : GREETINGS.night
  return pick(slot, seed)
}

/* A temporary chat gets its own line: one fixed phrase, whatever the date, so
   the reader always knows this chat is on its way out. */
export const TEMPORARY_FLAIR = 'Temporary chat. Disappears on its own.'

/* One short line under that headline: what a temporary chat does, and the two
   limits worth knowing before typing (it is gone on its own; a provider may
   still keep logs of the request). */
export const TEMPORARY_NOTE = 'Nothing here is saved, and it deletes itself when you leave or its timer ends. Providers may still log it.'

export type FlairOptions = {
  /** The chat is temporary, so it gets the temporary line instead. */
  temporary?: boolean
  /** Whether holiday lines are allowed (the "seasonal touches" preference). */
  seasonal?: boolean
  /** Rotates the time-of-day greeting. */
  seed?: number
}

/** The line shown for an empty chat. A temporary chat wins over the seasonal
 *  line and over the plain greeting; the seasonal preference only gates the
 *  holiday lines. */
export function flairLine(now: Date, opts: FlairOptions = {}): string {
  if (opts.temporary) return TEMPORARY_FLAIR
  return (opts.seasonal !== false && seasonalLine(now)) || greetingFor(now, opts.seed ?? 0)
}

const THINKING = ['Thinking…']

/** A plain status line, stable for a given message so it does not flicker. */
export function thinkingLine(_seed: string): string {
  return THINKING[0]
}

const GENERIC_ACTIVITY = ['Working…']

/** Plain, matter-of-fact status lines per tool. */
const ACTIVITY: Record<string, readonly string[]> = {
  search: ['Searching the web…'],
  fetch_page: ['Reading the page…'],
  use_skill: ['Loading skill…'],
  workspace_upsert: ['Working with files…'],
  prompt_chip: ['Preparing follow-up…'],
  inline_poll: ['Preparing choices…'],
  graph: ['Plotting the graph…'],
  time: ['Checking the time…'],
  date: ['Checking the date…'],
  calc: ['Calculating…'],
  count: ['Counting…'],
  json: ['Formatting JSON…'],
  base64: ['Encoding…'],
  location: ['Checking location…'],
  clipboard: ['Reading clipboard…'],
  uuid: ['Generating UUID…'],
  random: ['Generating random number…'],
  hash: ['Hashing…'],
  memory: ['Checking memory…'],
}

function hashSeed(seed: string): number {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** Status line for the most recent tool call (or a thinking line when none). Stable per message. */
export function activityLine(toolNames: readonly string[], seed: string): string {
  const last = [...toolNames].filter(Boolean).pop()
  if (!last) return thinkingLine(seed)
  return pick(ACTIVITY[last] ?? GENERIC_ACTIVITY, hashSeed(seed + last))
}

/* A quality is a small, named behaviour the user can switch on for every
 * reply. Most add a sentence to the system prompt; some also change how the
 * request runs (reasoning effort, skills, tool approval). The base system
 * prompt always stays authoritative. Qualities are editable records, not a
 * fixed enum, so users can add and change their own. */
export type PromptQuality = string

export type QualityEffect = {
  effort?: 'lowest' | 'highest'
  skillsOff?: boolean
  /** Every tool call pauses for permission, regardless of the global access mode. */
  safety?: 'ask'
}

export type Quality = {
  id: string
  label: string
  desc: string
  text: string
  effect?: QualityEffect
}

export type GlobalPrompt = { on: boolean; text: string; qualities: PromptQuality[] }

/** Built-in qualities. Users can edit these records; the ids are only stable
 *  defaults and are not treated as a closed set when stored state is read. */
export const DEFAULT_QUALITIES: Quality[] = [
  { id: 'instant', label: 'Instant', desc: 'Shortest useful answer, lowest reasoning.', text: 'Answer as quickly and briefly as possible. Give the direct answer first, skip preamble, restatement and closing offers, and add detail only when the answer would otherwise be wrong or unusable.', effect: { effort: 'lowest' } },
  { id: 'concise', label: 'Concise', desc: 'Lead with the answer; keep detail tight.', text: 'Lead with the answer, keep supporting detail brief, and stop when the request is satisfied.' },
  { id: 'playful', label: 'Playful', desc: 'Light humour without losing accuracy.', text: 'Use light humor and informal phrasing when the context allows, while keeping the answer accurate.' },
  { id: 'sophisticated', label: 'Sophisticated', desc: 'Nuanced, well-structured, polished prose.', text: 'Write with precision and nuance. Use a clear structure, name important tradeoffs and assumptions, and prefer the exact word over the approximate one. Do not pad the answer to sound impressive.' },
  { id: 'thorough', label: 'Thorough', desc: 'Cover edge cases and use the highest reasoning.', text: 'Be thorough: cover the important edge cases, state the assumptions the answer depends on, and support claims with evidence or concrete reasoning. Prefer completeness over brevity when the two conflict.', effect: { effort: 'highest' } },
  { id: 'warm', label: 'Warm', desc: 'Friendly and encouraging.', text: 'Use a friendly, encouraging tone, and acknowledge the user\u2019s effort or situation.' },
  { id: 'curious', label: 'Curious', desc: 'Explore useful alternative angles.', text: 'Consider alternative angles when they are useful, and ask a follow-up only when it would materially improve the answer.' },
  { id: 'practical', label: 'Practical', desc: 'Concrete steps, examples and tradeoffs.', text: 'Favor concrete steps, examples, and tradeoffs, and explain abstract ideas only when they help.' },
  { id: 'creative', label: 'Creative', desc: 'Flowery, imaginative writing and rhetorical analysis.', text: 'Bring imagination and expressive craft to the writing. Use vivid imagery, deliberate rhythm and rhetorical devices when they serve the piece, and for rhetorical analysis examine how a text persuades through structure, diction, imagery and appeals rather than only summarizing what it says. Keep factual claims honest and never present invented material as fact.' },
  { id: 'no-skills', label: 'No skills', desc: 'Skip installed skill instructions.', text: '', effect: { skillsOff: true } },
  { id: 'cautious', label: 'Cautious', desc: 'Flag risk and always ask before using a tool.', text: 'Be conservative. Call out risky, destructive or irreversible actions before describing them, prefer reversible options, and state the limits of what you can verify. Do not guess when the cost of being wrong is high.', effect: { safety: 'ask' } },
]

/** Alias kept for callers that only need the built-in set. */
export const PROMPT_QUALITIES = DEFAULT_QUALITIES

export const DEFAULT_QUALITY_FAVS: string[] = ['global', 'instant', 'concise', 'playful', 'sophisticated']

const copyQuality = (q: Quality): Quality => ({ ...q, ...(q.effect ? { effect: { ...q.effect } } : {}) })

const shortText = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)

const cleanEffect = (value: unknown): QualityEffect | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const effect: QualityEffect = {}
  if (v.effort === 'lowest' || v.effort === 'highest') effect.effort = v.effort
  if (v.skillsOff === true) effect.skillsOff = true
  if (v.safety === 'ask') effect.safety = 'ask'
  return Object.keys(effect).length ? effect : undefined
}

/** Sanitize a stored or imported quality list. Malformed rows are dropped,
 *  ids are deduplicated, and a missing list falls back to the built-ins. */
export function normQualityList(value: unknown): Quality[] {
  if (!Array.isArray(value)) return DEFAULT_QUALITIES.map(copyQuality)
  const out: Quality[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const q = raw as Record<string, unknown>
    const label = shortText(q.label, 60)
    if (!label) continue
    let id = shortText(q.id, 80).replace(/\s+/g, '-').toLowerCase() || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id) id = `quality-${out.length + 1}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label,
      desc: shortText(q.desc, 200),
      text: typeof q.text === 'string' ? q.text.slice(0, 12000) : '',
      ...(cleanEffect(q.effect) ? { effect: cleanEffect(q.effect)! } : {}),
    })
  }
  return out.length ? out : DEFAULT_QUALITIES.map(copyQuality)
}

/** Keep known quality ids, drop duplicates and ids no longer offered. */
export function normQualities(value: unknown, known: readonly string[] = DEFAULT_QUALITIES.map((q) => q.id)): PromptQuality[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set(known)
  const out: PromptQuality[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' || !allowed.has(raw) || out.includes(raw)) continue
    out.push(raw)
  }
  return out
}

/** The favourites list shown in the composer. `global` is the pseudo-id for
 *  the global system prompt toggle; unknown ids are dropped. */
export function normQualityFavs(value: unknown, known: readonly string[] = DEFAULT_QUALITIES.map((q) => q.id)): string[] {
  if (value === undefined) return [...DEFAULT_QUALITY_FAVS]
  if (!Array.isArray(value)) return []
  const allowed = new Set(['global', ...known])
  return value.filter((id, i): id is string => typeof id === 'string' && allowed.has(id) && value.indexOf(id) === i)
}

/** What the selected qualities change beyond their prompt text. */
export function qualityEffects(value: unknown, qualities: Quality[] = DEFAULT_QUALITIES): QualityEffect {
  const ids = normQualities(value, qualities.map((q) => q.id))
  const effects: QualityEffect = {}
  for (const id of ids) {
    const effect = qualities.find((q) => q.id === id)?.effect
    if (!effect) continue
    if (effect.effort) effects.effort = effect.effort
    if (effect.skillsOff) effects.skillsOff = true
    if (effect.safety === 'ask') effects.safety = 'ask'
  }
  return effects
}

export function normGlobalPrompt(value: unknown): GlobalPrompt {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { on: v.on === true, text: typeof v.text === 'string' ? v.text : '', qualities: normQualities(v.qualities) }
}

/** The block appended after the base global prompt. Empty when nothing is
 *  selected. Qualities are framed as standing requirements, not suggestions. */
export function qualityPrompt(value: unknown, qualities: Quality[] = DEFAULT_QUALITIES): string {
  const ids = normQualities(value, qualities.map((q) => q.id))
  if (!ids.length) return ''
  const lines = ids
    .map((id) => qualities.find((x) => x.id === id))
    .filter((q): q is Quality => !!q?.text.trim())
    .map((q) => `- ${q.label}: ${q.text.trim()}`)
  if (!lines.length) return ''
  return `# Qualities (standing requirements)\nThese qualities are standing requirements. ALWAYS follow them in every reply, even when the request or your default style points elsewhere. Apply them as a guiding principle throughout the answer, not as an optional suggestion. They refine the other instructions; they never override safety or honesty rules.\n${lines.join('\n')}`
}

const FORTUNES = [
  'Read the error message twice. It usually says more than you think.',
  'The bug you are hunting is probably in the last thing you changed.',
  'Small commits are kind to your future self.',
  'A rubber duck will solve it. Explain the problem out loud first.',
  'Tomorrow you will understand this code better than you do now. Leave a comment.',
]

/** A fortune-cookie tip. `seed` makes it repeatable in tests; defaults to random. */
export function pickFortune(seed: number = Math.floor(Math.random() * 1e6)): string {
  return pick(FORTUNES, seed)
}

/** Subtle completion flourish: a soft two-note chime plus a brief confetti burst. Respects reduced motion. */
export function celebrate(enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    if (Ctx) {
      const ctx: AudioContext = new Ctx()
      const gain = ctx.createGain()
      gain.gain.value = 0.03
      gain.connect(ctx.destination)
      ;[660, 880].forEach((f, i) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = f
        osc.connect(gain)
        osc.start(ctx.currentTime + i * 0.12)
        osc.stop(ctx.currentTime + i * 0.12 + 0.18)
      })
      setTimeout(() => void ctx.close(), 600)
    }
  } catch { /* audio is optional */ }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:9999'
  const colors = ['#e8b04b', '#6fbf8e', '#6aa6e0', '#e07a9b', '#b59be0']
  document.body.appendChild(layer)
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('span')
    p.style.cssText = `position:absolute;top:-10px;left:${Math.random() * 100}%;width:7px;height:10px;border-radius:2px;background:${colors[i % colors.length]}`
    layer.appendChild(p)
    p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${(Math.random() - 0.5) * 160}px, ${window.innerHeight * (0.5 + Math.random() * 0.4)}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 500, delay: Math.random() * 150, easing: 'ease-in', fill: 'forwards' },
    )
  }
  setTimeout(() => layer.remove(), 2200)
}
