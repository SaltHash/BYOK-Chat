/* A run lives in the tab that started it, but the transcript and tool rounds
 * are already persisted. The journal is the small extra fact a fresh tab needs:
 * which reply was in flight, how many times it has been retried, and whether
 * it was waiting on the user. One entry per chat. */

export type RunStatus = 'running' | 'question' | 'approval'

export type RunQuestion = {
  id: string
  question: string
  options: string[]
  allowText: boolean
  at: number
}

export type RunEntry = {
  mid: string
  at: number
  attempts: number
  status: RunStatus
  question?: RunQuestion
  approval?: { name: string; args: string }
}

export type RunJournal = Record<string, RunEntry>

const MAX_ENTRIES = 20
const MAX_ATTEMPTS = 9

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

function normQuestion(value: unknown, mid: string, now: number): RunQuestion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const question = text(v.question, 600)
  if (question.length < 2) return undefined
  const options: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(v.options) ? v.options : []) {
    const option = text(item, 120)
    const key = option.toLowerCase()
    if (!option || seen.has(key)) continue
    seen.add(key)
    options.push(option)
    if (options.length >= 6) break
  }
  return {
    id: text(v.id, 120) || `q-${mid}`,
    question,
    options,
    allowText: v.allowText !== false,
    at: Number.isFinite(Number(v.at)) ? Number(v.at) : now,
  }
}

export function normRunEntry(value: unknown, now = Date.now()): RunEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const mid = text(v.mid, 160)
  if (!mid) return null
  const question = normQuestion(v.question, mid, now)
  const approval = v.approval && typeof v.approval === 'object' && !Array.isArray(v.approval)
    ? (() => {
      const a = v.approval as Record<string, unknown>
      const name = text(a.name, 120)
      return name ? { name, args: typeof a.args === 'string' ? a.args.slice(0, 1600) : '' } : undefined
    })()
    : undefined
  const requested: RunStatus = v.status === 'question' || v.status === 'approval' ? v.status : 'running'
  const status: RunStatus = requested === 'question' && !question ? 'running' : requested === 'approval' && !approval ? 'running' : requested
  return {
    mid,
    at: Number.isFinite(Number(v.at)) ? Number(v.at) : now,
    attempts: Number.isFinite(Number(v.attempts)) ? Math.max(0, Math.min(MAX_ATTEMPTS, Math.round(Number(v.attempts)))) : 0,
    status,
    ...(question ? { question } : {}),
    ...(approval ? { approval } : {}),
  }
}

/** Keep only structurally valid entries, newest first. A journal is a recovery
 *  aid: junk must never make the app think a run is pending. */
export function normRunJournal(value: unknown, now = Date.now()): RunJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: [string, RunEntry][] = []
  for (const [chatId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!chatId) continue
    const entry = normRunEntry(raw, now)
    if (entry) out.push([chatId, entry])
  }
  out.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(out.slice(0, MAX_ENTRIES))
}

/** The user-facing turn injected before the resumed assistant state. The wire
 *  puts this note ahead of the partial reply, so the model sees a direct
 *  instruction and then its own in-progress work. */
export function continueNote(opts: { question?: { question: string; answer: string }; approval?: string } = {}): string {
  const base = 'The app was closed while this reply was being written. Continue the same reply from exactly where it stopped. Do not repeat text you already wrote or tool calls whose results are already in the conversation.'
  if (opts.question) {
    const question = opts.question.question.replace(/\s+/g, ' ').trim().slice(0, 600)
    const answer = opts.question.answer.replace(/\s+/g, ' ').trim().slice(0, 4000)
    return `${base}\n\nBefore the interruption you asked: "${question}"\nThe user answered: "${answer}"\nUse that answer now and do not ask the same question again.`
  }
  if (opts.approval) {
    return `${base}\n\nThe call to "${opts.approval.replace(/\s+/g, ' ').trim().slice(0, 120)}" was waiting for the user's permission and did not run. Continue without assuming it succeeded; ask again only if you still need it.`
  }
  return base
}
