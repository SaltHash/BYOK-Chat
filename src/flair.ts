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
  workspace_upsert: ['Writing file…'],
  prompt_chip: ['Preparing follow-up…'],
  inline_poll: ['Preparing choices…'],
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

export type PromptQuality = 'concise' | 'warm' | 'direct' | 'curious' | 'practical' | 'playful'

export type GlobalPrompt = { on: boolean; text: string; qualities: PromptQuality[] }

/** Optional qualities appended to the global system prompt. Each one adds a
 *  short tone instruction without replacing the user's base prompt. */
export const PROMPT_QUALITIES: { id: PromptQuality; label: string; text: string }[] = [
  { id: 'concise', label: 'Concise', text: 'Lead with the answer, keep supporting detail brief, and stop when the request is satisfied.' },
  { id: 'warm', label: 'Warm', text: 'Use a friendly, encouraging tone, and acknowledge the user\u2019s effort or situation.' },
  { id: 'direct', label: 'Direct', text: 'State the answer and any caveats plainly, without hedging or padding.' },
  { id: 'curious', label: 'Curious', text: 'Consider alternative angles when they are useful, and ask a follow-up only when it would materially improve the answer.' },
  { id: 'practical', label: 'Practical', text: 'Favor concrete steps, examples, and tradeoffs, and explain abstract ideas only when they help.' },
  { id: 'playful', label: 'Playful', text: 'Use light humor and informal phrasing when the context allows, while keeping the answer accurate.' },
]

const QUALITY_IDS = new Set<string>(PROMPT_QUALITIES.map((q) => q.id))

/** Keep known quality ids, drop duplicates and anything stored by an older version. */
export function normQualities(value: unknown): PromptQuality[] {
  if (!Array.isArray(value)) return []
  const out: PromptQuality[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' || !QUALITY_IDS.has(raw) || out.includes(raw as PromptQuality)) continue
    out.push(raw as PromptQuality)
  }
  return out
}

export function normGlobalPrompt(value: unknown): GlobalPrompt {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { on: v.on === true, text: typeof v.text === 'string' ? v.text : '', qualities: normQualities(v.qualities) }
}

/** The block appended after the base global prompt. Empty when nothing is selected. */
export function qualityPrompt(value: unknown): string {
  const ids = normQualities(value)
  if (!ids.length) return ''
  const lines = ids.map((id) => {
    const q = PROMPT_QUALITIES.find((x) => x.id === id)!
    return `- ${q.label}: ${q.text}`
  })
  return `# Selected qualities\nApply these qualities to your reply. They shape tone and emphasis only, and do not override the other instructions in this prompt:\n${lines.join('\n')}`
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
