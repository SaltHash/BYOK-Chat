/* Memory policy and helpers.
 *
 * Memory is user-controlled local data. This module keeps the rules that
 * decide whether memory applies to a chat (including temporary chats), the
 * system-prompt policy that gets the model to actually save and use durable
 * facts, and the retrieval helpers used by the memory tool. Pure and testable.
 */
import { rankDocs } from './recall'

export type MemoryIntent = 'intentional' | 'balanced' | 'aggressive'
export type MemoryRecallMode = 'holistic' | 'contextual' | 'specific'
export type MemoryMethod = 'local' | 'classifier'

export type MemoryPrefs = {
  enabled: boolean
  intent: MemoryIntent
  recall: MemoryRecallMode
  method: MemoryMethod
  classifierEp: string
  classifierModel: string
  /** Recall and save in temporary chats too. On by default: a temporary chat
   *  expires, but the user's memories are global and should still work. */
  tempChats?: boolean
}

export type MemoryLike = { id: string; text: string; category: string }

export const DEFAULT_MEMORY_PREFS: MemoryPrefs = {
  enabled: false,
  intent: 'balanced',
  recall: 'contextual',
  method: 'local',
  classifierEp: '',
  classifierModel: '',
  tempChats: true,
}

const INTENTS: readonly MemoryIntent[] = ['intentional', 'balanced', 'aggressive']
const RECALLS: readonly MemoryRecallMode[] = ['holistic', 'contextual', 'specific']

/** Normalize persisted or imported memory settings, keeping only valid ids. */
export function normMemoryPrefs(raw: unknown): MemoryPrefs {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    enabled: o.enabled === true,
    intent: INTENTS.includes(o.intent as MemoryIntent) ? o.intent as MemoryIntent : 'balanced',
    recall: RECALLS.includes(o.recall as MemoryRecallMode) ? o.recall as MemoryRecallMode : 'contextual',
    method: o.method === 'classifier' ? 'classifier' : 'local',
    classifierEp: typeof o.classifierEp === 'string' ? o.classifierEp : '',
    classifierModel: typeof o.classifierModel === 'string' ? o.classifierModel : '',
    tempChats: o.tempChats !== false,
  }
}

/** Whether memory recall and the memory tool apply to this chat. */
export function memoryEnabledFor(prefs: MemoryPrefs, featureOn: boolean, temporary = false): boolean {
  return featureOn && prefs.enabled === true && (!temporary || prefs.tempChats !== false)
}

/** The policy appended to the system prompt whenever memory is active. It is
 *  intentionally explicit about *when* to save, because models otherwise wait
 *  for a literal "remember this" even in aggressive mode. */
export function memoryPolicyText(prefs: MemoryPrefs, opts: { count: number; temporary?: boolean } = { count: 0 }): string {
  const count = Math.max(0, Math.floor(opts.count))
  const stored = count === 0
    ? 'No memories are saved yet.'
    : `${count} saved memor${count === 1 ? 'y is' : 'ies are'} available in this prompt's Stored memories block.`
  const intent = prefs.intent === 'intentional'
    ? 'Only save when the user explicitly asks you to remember something (for example "remember", "save this", or "keep that in mind"). Do not infer memories otherwise.'
    : prefs.intent === 'balanced'
      ? 'Save explicit remember requests plus important durable disclosures such as name, time zone, location, diet or allergies, lasting preferences, tools and stack, ongoing projects, goals and constraints. Skip passing moods, one-off task details, and guesses.'
      : 'Save explicit remember requests, important disclosures, and smaller useful details: preferences, tools and stack, recurring projects, tastes, goals, constraints, and context that would make a later conversation better. Be proactive, but skip secrets, sensitive personal data, and details that will not matter later.'
  const first = count === 0 && prefs.intent !== 'intentional'
    ? 'Because nothing is stored yet, there is likely a useful first memory in this conversation. If the user shares one, save it before you finish the reply.'
    : ''
  return [
    `Memory is enabled for this chat${opts.temporary ? ' (a temporary chat)' : ''}. ${stored}`,
    'Use the memory tool to save durable facts, not only to look them up:',
    `- ${intent}`,
    '- Save durable facts during the turn they come up, not at some later time. One memory tool call per memory.',
    '- Write a short standalone sentence and give it a specific category such as "Dietary restrictions", "Programming interests", or "Travel preferences". Do not use vague labels like "About the user".',
    '- Before updating or deleting, use action search or list with a query to find the exact id. Never guess an id.',
    '- Never store secrets, credentials, payment details, or sensitive personal information, and never store something the user asked you to forget.',
    '- Use recalled memories naturally. Do not recite the memory list or announce that you saved something unless it matters to the reply.',
    ...(first ? [first] : []),
    ...(opts.temporary ? ['The user enabled memory for temporary chats, so recall and saving work as in any other chat. Only the transcript itself expires.'] : []),
  ].join('\n')
}

/** Rank memories for the memory tool's search action. Falls back to the
 *  newest entries only when the query is empty (the list action's job). */
export function searchMemories<T extends MemoryLike>(memories: T[], query: string, limit = 20): T[] {
  const q = String(query ?? '').trim()
  const max = Math.max(1, Math.min(50, Math.floor(limit) || 20))
  if (!q) return memories.slice(0, max)
  const docs = memories.map((m) => ({ id: m.id, text: `${m.text} ${m.category}` }))
  const ranked = rankDocs(q, docs, max)
  const byId = new Map(memories.map((m) => [m.id, m]))
  return ranked.map((r) => byId.get(r.id)).filter((m): m is T => !!m)
}

export const memoryLine = (m: MemoryLike): string => `${m.id} | ${m.category} | ${m.text}`

/** Text the memory tool returns for a list/search request. Caps the result so
 *  a large memory store cannot flood the model's context. */
export function formatMemoryResults<T extends MemoryLike>(memories: T[], total = memories.length, query = ''): string {
  if (!memories.length) return query ? `No memories matched “${query}”.` : 'No memories are stored.'
  const lines = memories.map(memoryLine).join('\n')
  const hidden = Math.max(0, total - memories.length)
  return hidden > 0
    ? `${lines}\n(${hidden} more not shown; narrow the search with action search and a query.)`
    : lines
}
