import { create } from 'zustand'

/** A question the model asked mid-reply. The reply is paused on the tool call
 *  until the user answers, so the card belongs above the composer, not in the
 *  transcript. */
export type UserQuestion = {
  id: string
  chatId: string
  question: string
  options: string[]
  allowText: boolean
  at: number
  /** Restored from the run journal after a reload. There is no waiting promise
   *  any more, so answering resumes the interrupted run instead of resolving a
   *  tool call. */
  orphan?: boolean
}

export type QuestionInput = { question: string; options: string[]; allowText: boolean }

const MAX_QUESTION = 600
const MAX_OPTIONS = 6
const MAX_OPTION = 120

/** Normalize a model-authored question. Only the fields the card can render
 *  survive, and a question without real text is refused so the model gets a
 *  tool error instead of pausing the run on an empty card. */
export function normalizeQuestionInput(raw: unknown): QuestionInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const question = typeof v.question === 'string' ? v.question.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION) : ''
  if (question.length < 2) return null
  const options: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(v.options) ? v.options : []) {
    if (typeof item !== 'string') continue
    const option = item.replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION)
    const key = option.toLowerCase()
    if (!option || seen.has(key)) continue
    seen.add(key)
    options.push(option)
    if (options.length >= MAX_OPTIONS) break
  }
  return { question, options, allowText: v.allowText !== false }
}

type Waiter = { resolve: (answer: string) => void; reject: (error: Error) => void }
const waiters = new Map<string, Waiter>()

/** Session-only question cards. Journaled questions are restored into the same
 *  queue on boot, so the sidebar and composer read one list. */
export const useQuestions = create<{ queue: UserQuestion[] }>()(() => ({ queue: [] }))

const questionId = () => globalThis.crypto?.randomUUID?.() ?? `question-${Date.now()}-${Math.random().toString(36).slice(2)}`

const abortError = (): Error => {
  try { return new DOMException('The reply was stopped.', 'AbortError') } catch { return Object.assign(new Error('The reply was stopped.'), { name: 'AbortError' }) }
}

const cleanAnswer = (answer: string) => String(answer ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000)

/** Ask the user and wait for an answer. The abort signal is the reply's own
 *  controller, so Stop clears the card and rejects the await. */
export function requestUserQuestion(
  req: { chatId: string; question: string; options: string[]; allowText: boolean },
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return Promise.reject(abortError())
  const id = questionId()
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      waiters.delete(id)
      useQuestions.setState((s) => ({ queue: s.queue.filter((x) => x.id !== id) }))
      fn()
    }
    const onAbort = () => finish(() => reject(abortError()))
    waiters.set(id, {
      resolve: (answer) => finish(() => resolve(answer)),
      reject: (error) => finish(() => reject(error)),
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    useQuestions.setState((s) => ({
      queue: [...s.queue, {
        id,
        chatId: req.chatId,
        question: req.question,
        options: req.options,
        allowText: req.allowText,
        at: Date.now(),
      }],
    }))
  })
}

/** Resolve a live question. Returns false when it came from a journal (no
 *  waiter), which tells the store to resume the interrupted run instead. */
export function answerUserQuestion(id: string, answer: string): boolean {
  const waiter = waiters.get(id)
  if (!waiter) return false
  waiter.resolve(cleanAnswer(answer) || 'The user did not type an answer.')
  return true
}

/** Restore a journaled question after a reload. It has no waiter, so the store
 *  owns what happens when it is answered. */
export function queueOrphanQuestion(question: UserQuestion): void {
  useQuestions.setState((s) => (s.queue.some((x) => x.id === question.id) ? s : { queue: [...s.queue, { ...question, orphan: true }] }))
}

/** Drop only restored questions for a chat. A new message abandons the
 *  interrupted reply they belonged to, but a live question still has a waiter
 *  and must be rejected through cancelUserQuestions instead. */
export function clearOrphanQuestions(chatId: string): void {
  useQuestions.setState((s) => {
    const queue = s.queue.filter((q) => q.chatId !== chatId || !q.orphan)
    return queue.length === s.queue.length ? s : { queue }
  })
}

export function cancelUserQuestions(chatId: string): void {
  for (const question of [...useQuestions.getState().queue]) {
    if (question.chatId !== chatId) continue
    const waiter = waiters.get(question.id)
    if (waiter) waiter.reject(abortError())
    else useQuestions.setState((s) => ({ queue: s.queue.filter((x) => x.id !== question.id) }))
  }
}

/** Test/teardown helper. */
export function resetUserQuestions(): void {
  for (const id of [...waiters.keys()]) waiters.get(id)?.reject(abortError())
  waiters.clear()
  useQuestions.setState({ queue: [] })
}
