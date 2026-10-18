// Personality microcopy and small completion flourishes. Kept free of store
// imports so both the store and the components can use it.

const pick = <T,>(list: readonly T[], seed: number): T => list[((seed % list.length) + list.length) % list.length]

/** Seasonal greeting for the current date, or null when no holiday is near. */
export function seasonalLine(now: Date): string | null {
  const m = now.getMonth() + 1
  const d = now.getDate()
  if (m === 10 && d >= 25) return 'Spooky season. What are we building?'
  if (m === 12 && d >= 1 && d <= 26) return 'Festive coding season. What should we build?'
  if (m === 12 && d >= 27 || m === 1 && d <= 2) return 'Fresh year, fresh commits. Where do we start?'
  if (m === 2 && d === 14) return 'Love is in the air, and in the logs.'
  return null
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

const THINKING = ['Thinking it over…', 'Turning it over in my head…', 'Weighing the options…', 'Connecting the dots…', 'Chewing on this…', 'Sketching an answer…']

/** A playful status line, stable for a given message so it does not flicker. */
export function thinkingLine(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0
  return pick(THINKING, Math.abs(h))
}

const GENERIC_ACTIVITY = ['Working on it…', 'Getting it done…', 'On the case…']

/** Playful status lines per tool, so each kind of action reads differently. */
const ACTIVITY: Record<string, readonly string[]> = {
  search: ['Rummaging through the web…', 'Asking the internet nicely…', 'Digging for sources…'],
  fetch_page: ['Skimming the page…', 'Reading every word so you don’t have to…', 'Opening the link…'],
  use_skill: ['Flipping through my skill book…', 'Checking what I can do here…'],
  workspace_upsert: ['Filing it in the workspace…', 'Tidying up the workspace…', 'Writing it down properly…'],
  prompt_chip: ['Dreaming up a follow-up…'],
  inline_poll: ['Preparing a little choice for you…'],
  time: ['Checking the clock…'],
  date: ['Flipping to the right page of the calendar…'],
  calc: ['Crunching numbers…', 'Doing the math carefully…'],
  count: ['Counting every character…'],
  json: ['Tidying up the braces…'],
  base64: ['Encoding with care…'],
  location: ['Looking around, approximately…'],
  clipboard: ['Peeking at the clipboard…'],
  uuid: ['Rolling a fresh UUID…'],
  random: ['Rolling the dice…', 'Shaking the number jar…'],
  hash: ['Mixing it into a hash…'],
  memory: ['Rifling through my notes…', 'Jotting that down…'],
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

export type Tone = 'terse' | 'neutral' | 'playful'

/** Global system prompt presets for the Settings tone picker. */
export const TONE_PRESETS: Record<Tone, { label: string; text: string }> = {
  terse: { label: 'Terse', text: 'Be brief. Lead with the answer, skip filler, and use the fewest words that stay correct.' },
  neutral: { label: 'Neutral', text: 'Be clear and direct. Explain reasoning when it helps, and keep a measured, professional tone.' },
  playful: { label: 'Playful', text: 'Be warm and a little playful. Keep the answer accurate and useful, and add light humor only where it fits.' },
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
