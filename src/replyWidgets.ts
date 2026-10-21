/* Reply widget data (follow-up chips and inline polls).
 *
 * The tool schema in `engine.ts` is the source of truth. These pure helpers
 * normalize what a model sent before React renders it, so a valid tool call
 * cannot silently fall back to an empty card when a field is shaped slightly
 * differently (a string option, a legacy single-question poll, a numeric
 * string for a slider, and so on). */

export type PollOption = {
  label: string
  /** Optional follow-up text a model wants sent for this option. */
  prompt?: string
  /** The UI shows a text field attached to this option when it is selected. */
  fillBlank?: boolean
  placeholder?: string
}

export type PollQuestionType = 'choice' | 'slider' | 'text' | 'number'

export type PollQuestion = {
  label: string
  type: PollQuestionType
  options: PollOption[]
  multiple?: boolean
  min?: number
  max?: number
  step?: number
  placeholder?: string
  defaultValue?: string
  multiline?: boolean
}

export type PollAnswer = {
  /** Selected option indexes (one unless the question allows multiple). */
  choice: number[]
  /** Free text, and the typed value attached to a fill-in-the-blank option. */
  text: string
  /** Slider and number values are kept as strings so an empty field can be detected. */
  number: string
}

export type PollAnswers = Record<number, PollAnswer>

const finite = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const bool = (value: unknown): boolean => value === true || value === 'true'

function normalizeOption(raw: unknown): PollOption | null {
  if (typeof raw === 'string') return { label: raw }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const label = text(o.label ?? o.text ?? o.name).trim()
  if (!label) return null
  return {
    label,
    ...(text(o.prompt).trim() ? { prompt: text(o.prompt).trim() } : {}),
    // Models mostly use `fillBlank`, but accept a few obvious synonyms so a
    // nearly-correct call still gets its text field.
    ...(bool(o.fillBlank) || bool(o.fillIn) || bool(o.freeform) || bool(o.other) || o.type === 'other' || o.type === 'text' ? { fillBlank: true } : {}),
    ...(text(o.placeholder).trim() ? { placeholder: text(o.placeholder).trim() } : {}),
  }
}

function normalizeOptions(raw: unknown): PollOption[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeOption).filter((o): o is PollOption => o !== null).slice(0, 6)
}

function normalizeQuestion(raw: unknown): PollQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  const label = text(q.label ?? q.question ?? q.title).trim()
  if (!label) return null
  const options = normalizeOptions(q.options)
  const requested = text(q.type)
  const type: PollQuestionType = requested === 'choice' || requested === 'slider' || requested === 'text' || requested === 'number'
    ? requested
    : options.length
      ? 'choice'
      : 'text'
  if (type === 'choice' && !options.length) return null
  const min = finite(q.min)
  const max = finite(q.max)
  const step = finite(q.step)
  const rawDefault = q.defaultValue ?? q.value ?? q.default
  const defaultValue = rawDefault == null ? '' : typeof rawDefault === 'number' ? String(rawDefault) : text(rawDefault)
  return {
    label,
    type,
    options,
    ...(bool(q.multiple) || q.mode === 'multiple' ? { multiple: true } : {}),
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
    ...(step != null && step > 0 ? { step } : {}),
    ...(text(q.placeholder).trim() ? { placeholder: text(q.placeholder).trim() } : {}),
    ...(defaultValue.trim() ? { defaultValue } : {}),
    ...(bool(q.multiline) ? { multiline: true } : {}),
  }
}

/** Turn a tool call's arguments into a renderable list of questions.
 *  Accepts both the current `{ questions: [...] }` schema and the older
 *  `{ question, options, mode }` shape. Returns an empty list for garbage. */
export function normalizePoll(raw: unknown): PollQuestion[] {
  if (!raw || typeof raw !== 'object') return []
  const args = raw as Record<string, unknown>
  const list = Array.isArray(args.questions)
    ? args.questions
    : Array.isArray(args.items)
      ? args.items
      : typeof args.question === 'string'
        ? [{ label: args.question, type: Array.isArray(args.options) ? 'choice' : 'text', options: args.options, mode: args.mode }]
        : []
  return list
    .map((q) => normalizeQuestion(q))
    .filter((q): q is PollQuestion => q !== null)
    .slice(0, 4)
}

function sliderMin(q: PollQuestion): number {
  return q.min ?? 0
}

function sliderMax(q: PollQuestion): number {
  const min = sliderMin(q)
  const max = q.max ?? Math.max(min + 100, 100)
  return max > min ? max : min + 100
}

function sliderStep(q: PollQuestion): number {
  return q.step && q.step > 0 ? q.step : 1
}

/** Starting answers, including slider defaults so a card is usable without
 *  touching every control. */
export function initialPollAnswers(questions: readonly PollQuestion[]): PollAnswers {
  const out: PollAnswers = {}
  questions.forEach((q, i) => {
    let number = ''
    if (q.type === 'slider') {
      const min = sliderMin(q), max = sliderMax(q)
      const start = finite(q.defaultValue) ?? min
      number = String(Math.max(min, Math.min(max, start)))
    } else if (q.type === 'number' && q.defaultValue) {
      number = q.defaultValue
    }
    out[i] = {
      choice: [],
      text: q.type === 'text' ? (q.defaultValue ?? '') : '',
      number,
    }
  })
  return out
}

/** Build the message sent back to the model when Continue is pressed. Each
 *  answered question stays on its own line so the answer keeps its context. */
export function pollAnswerText(questions: readonly PollQuestion[], answers: PollAnswers): string {
  const out: string[] = []
  questions.forEach((q, i) => {
    const a = answers[i]
    if (!a) return
    if (q.type === 'choice') {
      const picked = a.choice
        .map((index) => q.options[index])
        .filter((o): o is PollOption => !!o)
      if (!picked.length) return
      const value = picked
        .map((o) => (o.fillBlank && a.text.trim() ? `${o.label}: ${a.text.trim()}` : o.label))
        .join(', ')
      out.push(`${q.label}\n${value}`)
    } else if (q.type === 'slider' || q.type === 'number') {
      if (!a.number.trim()) return
      out.push(`${q.label}\n${a.number.trim()}`)
    } else {
      if (!a.text.trim()) return
      out.push(`${q.label}\n${a.text.trim()}`)
    }
  })
  return out.join('\n\n')
}

export function pollLimits(q: PollQuestion): { min: number; max: number; step: number } {
  return { min: sliderMin(q), max: sliderMax(q), step: sliderStep(q) }
}
