import type { PersistStorage, StateStorage } from 'zustand/middleware'
import { extractCitedIds } from './citations'
import { attachFlushOnHide, createCoalescedPersistStorage, type CoalescedPersistStorage } from './storage/coalesce'

export const QUOTA_FLAG = 'byok.v1:quota-full'

// A session-wide warning: a successful write to one storage tier does not prove
// that an earlier failure in another tier was repaired.
let storageWarning = ''
export const getStorageWarning = () => storageWarning
export function reportStorageFailure(): void {
  if (storageWarning) return
  storageWarning = 'Browser storage could not save all data. Export a backup now, free space or check browser storage permissions, then reload.'
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('byok:storage-failure'))
}
export function subscribeStorageWarning(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('byok:storage-failure', callback)
  return () => window.removeEventListener('byok:storage-failure', callback)
}

/** Persist payload version — single source for the zustand persist wrapper,
 *  durable migration metadata, and sync payloads. */
export const STORE_VERSION = 22

export const isQuotaError = (x: unknown) =>
  !!x && ((x as { name?: unknown }).name === 'QuotaExceededError' || (x as { code?: unknown }).code === 22 || /quota/i.test(String((x as { message?: unknown })?.message ?? '')))

/* Compact one search-evidence result by keeping only the sources the report
 * actually cites (plus the header line), so citations survive a reload.
 * Falls back to a plain character cap when nothing is cited or the result
 * does not parse. Pure. */
export const compactSearchEvidence = (result: string, cited: Set<string>, n = 16000): string => {
  const text = String(result ?? '')
  if (text.length <= 5000) return text
  const firstNl = text.indexOf('\n')
  const header = firstNl < 0 ? text : text.slice(0, firstNl)
  const body = firstNl < 0 ? '' : text.slice(firstNl)
  const blocks = body.split(/(?=\n\n\[Source S\d+\])/g)
  const kept = blocks.filter((b) => {
    const id = /\[Source (S\d+)\]/.exec(b)?.[1]?.toUpperCase()
    return !!id && cited.has(id)
  })
  if (!kept.length) {
    return text.length > n ? text.slice(0, n) + `\n[compacted: kept ${n.toLocaleString()} of ${text.length.toLocaleString()} characters]` : text.slice(0, 5000) + `\n[compacted: kept 5,000 of ${text.length.toLocaleString()} characters]`
  }
  const out = `${header}${kept.join('')}`
  if (out.length >= text.length) return text
  const capped = out.length > n ? out.slice(0, n) + `\n[compacted: kept ${n.toLocaleString()} of ${out.length.toLocaleString()} characters]` : `${out}\n[compacted: kept ${kept.length} cited source(s)]`
  return capped
}

/* Shrink a serialized persist payload so it fits localStorage: keep settings,
   keep chats, but drop the bulkiest regenerable/derived fields (old tool
   results, reasoning traces, workspace history beyond the latest revisions). */
export const prunePersisted = (raw: string): string | null => {
  try {
    const v = JSON.parse(raw)
    const s = v?.state ?? v
    if (!s || typeof s !== 'object') return null
    const cap = (t: unknown, n: number) => typeof t === 'string' && t.length > n ? t.slice(0, n) + `\n[compacted: kept ${n.toLocaleString()} of ${t.length.toLocaleString()} characters]` : t
    if (Array.isArray(s.chats)) s.chats = s.chats.map((c: { msgs?: unknown[] } & Record<string, unknown>) => ({
      ...c,
      msgs: ((c.msgs ?? []) as Record<string, unknown>[]).map((m) => ({
        ...m,
        reasoning: typeof m.reasoning === 'string' && (m.reasoning as string).length > 5000 ? (m.reasoning as string).slice(0, 5000) + '\n[compacted]' : m.reasoning,
        // Research narration is regenerable context: cap the free-text
        // fields but keep steps, status, and tier so runs stay readable.
        research: m.research && typeof m.research === 'object' ? (() => {
          const rs = m.research as Record<string, unknown>
          const steps = Array.isArray(rs.steps) ? (rs.steps as Record<string, unknown>[]).slice(-120).map((st) => ({
            ...st,
            lead: typeof st.lead === 'string' && st.lead.length > 1500 ? st.lead.slice(0, 1500) + '\n[compacted]' : st.lead,
          })) : rs.steps
          const plan = rs.plan && typeof rs.plan === 'object' ? (() => {
            const pl = rs.plan as Record<string, unknown>
            const pSteps = Array.isArray(pl.steps) ? (pl.steps as Record<string, unknown>[]).slice(0, 6).map((st) => ({
              ...st,
              label: cap(st.label, 120),
              items: Array.isArray(st.items) ? (st.items as unknown[]).slice(0, 12).map((it) => cap(it, 400)) : st.items,
            })) : pl.steps
            return { ...pl, title: cap(pl.title, 120), intro: cap(pl.intro, 300), steps: pSteps }
          })() : rs.plan
          return {
            ...rs,
            plan,
            steps,
            note: typeof rs.note === 'string' && rs.note.length > 5000 ? rs.note.slice(0, 5000) + '\n[compacted]' : rs.note,
            reasoning: typeof rs.reasoning === 'string' && rs.reasoning.length > 5000 ? (rs.reasoning as string).slice(0, 5000) + '\n[compacted]' : rs.reasoning,
            summary: typeof rs.summary === 'string' && (rs.summary as string).length > 2000 ? (rs.summary as string).slice(0, 2000) + '…[compacted]' : rs.summary,
          }
        })() : m.research,
        toolRounds: ((m.toolRounds ?? []) as Record<string, unknown>[]).map((r) => ({
          ...r,
          calls: ((r.calls ?? []) as Record<string, unknown>[]).map((call) => {
            // Search evidence compacts by cited source, not by blind
            // character slice: a blind slice cuts later [Source S<n>]
            // blocks and orphans the report's citations after a reload.
            if (call.name === 'search' && typeof call.result === 'string' && call.result.length > 5000) {
              const cited = new Set(extractCitedIds(`${String((m as { toolFinal?: unknown }).toolFinal ?? '')}\n${String(m.t ?? '')}`))
              return { ...call, result: compactSearchEvidence(call.result, cited) }
            }
            return { ...call, result: cap(call.result, 5000) }
          }),
        })),
      })),
    }))
    if (s.workspaces && typeof s.workspaces === 'object') {
      for (const ws of Object.values(s.workspaces) as { revisions?: { files?: { content: unknown }[] }[] }[]) {
        if (Array.isArray(ws.revisions) && ws.revisions.length > 2) ws.revisions = ws.revisions.slice(-2)
        for (const rev of ws.revisions ?? []) for (const f of rev.files ?? []) f.content = cap(f.content, 20000) as unknown as string
      }
    }
    return JSON.stringify(v?.state ? { ...v, state: s } : s)
  } catch { return null }
}

export const storageUsage = async (): Promise<{ localBytes: number; quota?: number; usage?: number }> => {
  let localBytes = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || (!k.startsWith('byok.v1') && k !== QUOTA_FLAG)) continue
      localBytes += (k.length + (localStorage.getItem(k) ?? '').length) * 2
    }
  } catch { /* blocked storage */ }
  try {
    const e: unknown = await (navigator as unknown as { storage?: { estimate?: () => Promise<unknown> } })?.storage?.estimate?.()
    if (e && typeof e === 'object') {
      const { quota, usage } = e as { quota?: number; usage?: number }
      return { localBytes, quota, usage }
    }
  } catch { /* unavailable */ }
  return { localBytes }
}

/* ---- persisted-copy shaping ----
 * The persisted copy drops attachment bytes (they are restored from durable
 * blob storage on boot) and empty assistant placeholders. The mapping depends
 * only on the chat object, and immutable updates replace only the chat that
 * changed, so a per-chat WeakMap keeps this O(changed chat) per store write
 * instead of O(entire history). */

type PersistMsg = {
  r?: string
  t?: string
  err?: boolean
  research?: unknown
  att?: { name: string; kind: string; size: string; mime?: string; source?: string; pages?: number }[]
}
type PersistChat = { msgs: PersistMsg[] }

export const pruneChatForPersist = <C extends PersistChat>(chat: C): C => ({
  ...chat,
  msgs: chat.msgs
    .filter((m) => !(m.r === 'assistant' && !m.t && !m.err && !m.research))
    .map((m) => (m.att?.length
      ? { ...m, att: m.att.map(({ name, kind, size, mime, source, pages }) => ({ name, kind, size, ...(mime ? { mime } : {}), ...(source ? { source } : {}), ...(pages ? { pages } : {}) })) }
      : m)),
}) as C

/** Build the chat mapper used by `partialize`. One instance per store. */
export const createPersistMapper = () => {
  const cache = new WeakMap<object, unknown>()
  return <C extends PersistChat>(chats: C[]): C[] => chats.map((chat) => {
    const hit = cache.get(chat)
    if (hit !== undefined) return hit as C
    const mapped = pruneChatForPersist(chat)
    cache.set(chat, mapped)
    return mapped
  })
}

/* Temporary chats past their expiry are session-scoped by design. Drop them
 * from persisted copies (localStorage and the durable mirror) so a reload or
 * a boot on another device never resurrects an expired chat. Pure. */
export const withoutExpiredTemps = <C extends { temporary?: boolean; expiresAt?: number }>(chats: C[], now = Date.now()): C[] =>
  chats.some((c) => c.temporary && c.expiresAt != null && c.expiresAt <= now)
    ? chats.filter((c) => !(c.temporary && c.expiresAt != null && c.expiresAt <= now))
    : chats

/* ---- sharded localStorage ----
 * The persisted payload used to be one giant `byok.v1` value, so every streamed
 * chunk rewrote (and quota-pruned) the entire chat history. Chats now live in
 * one shard per chat (`byok.v1:chat:<id>`); only the chat that changed is
 * serialized/written, while `byok.v1` keeps settings and an id index. Writes
 * are still coalesced (see storage/coalesce.ts), and reads reassemble the same
 * shape zustand expects. This is the local delta format: unchanged chats are
 * never written again. */

export const CHAT_SHARD_PREFIX = 'byok.v1:chat:'
const SHARD_MARKER = '__byokSharded'
const SHARD_IDS = '__byokChatIds'

/** Shards we last wrote, keyed by storage key. Kept in memory (not storage) so * a reload simply rewrites each chat once, then returns to delta writes. */
const writtenShards = new Map<string, string>()

// Zustand may enqueue a migration write before durable recovery finishes. Do
// not allow that partial state to replace the saved index while boot is still
// checking it, especially when recovery has to stop.
let bootWritesBlocked = typeof window !== 'undefined'
export function allowPersistWritesAfterBoot(): void { bootWritesBlocked = false }

export type ShardPlan = {
  main: string
  writes: { key: string; value: string; chat: unknown }[]
  deletes: string[]
  index: string[]
  extraChats: unknown[]
}

/** Split a serialized persist payload into a small main value plus only the
 *  chat shards that differ from `previous`. Pure; returns null when the input
 *  is not a persist payload. */
export function planPersistShards(raw: string, previous: Map<string, string> = writtenShards): ShardPlan | null {
  let parsed: any
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const envelope = parsed.state && typeof parsed.state === 'object'
  const state: Record<string, any> = envelope ? parsed.state : parsed
  const chats: unknown[] = Array.isArray(state.chats) ? state.chats : []
  const index: string[] = []
  const extraChats: unknown[] = []
  const writes: ShardPlan['writes'] = []
  for (const chat of chats) {
    const id = chat && typeof chat === 'object' ? (chat as { id?: unknown }).id : undefined
    if (typeof id !== 'string' || !id) { extraChats.push(chat); continue }
    index.push(id)
    const value = JSON.stringify(chat)
    const key = CHAT_SHARD_PREFIX + id
    if (previous.get(key) !== value) writes.push({ key, value, chat })
  }
  const deletes: string[] = []
  for (const key of previous.keys()) {
    if (!key.startsWith(CHAT_SHARD_PREFIX)) continue
    if (!index.includes(key.slice(CHAT_SHARD_PREFIX.length))) deletes.push(key)
  }
  const mainState: Record<string, unknown> = { ...state, chats: extraChats, [SHARD_MARKER]: true, [SHARD_IDS]: index }
  const main = JSON.stringify(envelope ? { ...parsed, state: mainState } : mainState)
  return { main, writes, deletes, index, extraChats }
}

/** Rebuild a persist payload from the main value and its chat shards. Returns
 *  null when `mainRaw` is not a sharded payload, so callers can fall back to
 *  the legacy single-value format. */
export function missingPersistShards(mainRaw: string, read: (key: string) => string | null): string[] {
  let parsed: any
  try { parsed = JSON.parse(mainRaw) } catch { return [] }
  const state = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed
  if (state?.[SHARD_MARKER] !== true || !Array.isArray(state[SHARD_IDS])) return []
  return state[SHARD_IDS].filter((id: unknown): id is string => {
    if (typeof id !== 'string') return false
    const raw = read(CHAT_SHARD_PREFIX + id)
    try {
      const chat = raw ? JSON.parse(raw) : null
      return !chat || typeof chat !== 'object' || chat.id !== id || !Array.isArray(chat.msgs)
    } catch { return true }
  })
}

export function joinPersistShards(mainRaw: string, read: (key: string) => string | null): string | null {
  let parsed: any
  try { parsed = JSON.parse(mainRaw) } catch { return null }
  const envelope = parsed?.state && typeof parsed.state === 'object'
  const state: Record<string, any> = envelope ? parsed.state : parsed
  if (!state || state[SHARD_MARKER] !== true) return null
  const ids: string[] = Array.isArray(state[SHARD_IDS]) ? state[SHARD_IDS].filter((x: unknown): x is string => typeof x === 'string') : []
  const chats: unknown[] = []
  for (const id of ids) {
    const raw = read(CHAT_SHARD_PREFIX + id)
    if (!raw) continue
    try {
      const chat = JSON.parse(raw)
      if (chat && typeof chat === 'object' && chat.id === id && Array.isArray(chat.msgs)) chats.push(chat)
    } catch { /* boot checks missing shards against the durable copy */ }
  }
  chats.push(...(Array.isArray(state.chats) ? state.chats : []))
  const outState: Record<string, unknown> = { ...state, chats }
  delete outState[SHARD_MARKER]
  delete outState[SHARD_IDS]
  return JSON.stringify(envelope ? { ...parsed, state: outState } : outState)
}

/** A last-resort compact copy for a single chat when localStorage is full: the
 *  newest messages and their visible fields survive; regenerable tool results
 *  and reasoning do not. The durable mirror still holds the full copy. */
export function compactChatForQuota(chat: unknown, keep = 80): unknown {
  if (!chat || typeof chat !== 'object') return chat
  const c = chat as { msgs?: unknown[] }
  if (!Array.isArray(c.msgs)) return chat
  return {
    ...c,
    msgs: c.msgs.slice(-keep).map((m) => {
      if (!m || typeof m !== 'object') return m
      const x = m as Record<string, unknown>
      const { toolRounds, reasoning, log, full, sys, ...keepMsg } = x
      return keepMsg
    }),
  }
}

const rawStorage: StateStorage = {
  getItem: (k: string) => {
    try {
      const raw = localStorage.getItem(k)
      if (raw == null) return null
      const joined = joinPersistShards(raw, (key) => { try { return localStorage.getItem(key) } catch { return null } })
      return joined ?? raw
    } catch { return null }
  },
  setItem: (k: string, v: string) => {
    if (k === 'byok.v1' && bootWritesBlocked) return
    // Other keys (not the persisted store) keep the simple path.
    if (k !== 'byok.v1') { try { localStorage.setItem(k, v) } catch (x) { if (!isQuotaError(x)) throw x } return }
    const plan = planPersistShards(v)
    if (!plan) { try { localStorage.setItem(k, v); localStorage.removeItem(QUOTA_FLAG) } catch { /* leave the old copy */ } return }
    let quota = false
    // Reserve the recovery marker before touching any shard. If the browser
    // cannot write even this, keep the previous snapshot untouched.
    try { localStorage.setItem(QUOTA_FLAG, String(Date.now())) }
    catch { reportStorageFailure(); return }
    const previousMain = localStorage.getItem(k)
    const previousIds: string[] = (() => { try { const parsed = JSON.parse(previousMain ?? '{}'); const state = parsed.state ?? parsed; return Array.isArray(state.__byokChatIds) ? state.__byokChatIds.filter((id: unknown): id is string => typeof id === 'string') : [] } catch { return [] } })()
    for (const write of plan.writes) {
      try { localStorage.setItem(write.key, write.value); writtenShards.set(write.key, write.value) }
      catch (x) {
        if (!isQuotaError(x)) throw x
        quota = true
        const smaller = JSON.stringify(compactChatForQuota(write.chat))
        try { localStorage.setItem(write.key, smaller); writtenShards.set(write.key, smaller) }
        catch { /* keep the previous shard; durable has the full copy */ }
      }
    }
    try { localStorage.setItem(k, plan.main) }
    catch (x) {
      if (!isQuotaError(x)) throw x
      quota = true
    }
    if (!quota) {
      localStorage.removeItem(QUOTA_FLAG)
      const retained = new Set(plan.index)
      const deleted = new Set([...plan.deletes, ...previousIds.filter(id => !retained.has(id)).map(id => CHAT_SHARD_PREFIX + id)])
      for (const key of deleted) { try { localStorage.removeItem(key) } catch { /* ignore */ } writtenShards.delete(key) }
    }
    if (quota) reportStorageFailure()
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k)
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (!key) continue
        if (key.startsWith(CHAT_SHARD_PREFIX)) { localStorage.removeItem(key); writtenShards.delete(key) }
      }
      localStorage.removeItem(QUOTA_FLAG)
    } catch { /* ignore */ }
  },
}

/** How long a persist write may be deferred. Bounds how often the whole app
 *  is serialized and how much state a crash can lose; pagehide flushes. */
export const PERSIST_WRITE_WINDOW_MS = 400

/** zustand storage with quota-compaction fallback (single source for store
 *  persist). A write failure inside the window is reported through onError
 *  rather than thrown from a timer: storage being unavailable must never
 *  break the app. */
export const persistStorage: CoalescedPersistStorage<any> = createCoalescedPersistStorage<any>(rawStorage, {
  wait: PERSIST_WRITE_WINDOW_MS,
  onError: (x) => { reportStorageFailure(); if (isQuotaError(x)) { try { localStorage.setItem(QUOTA_FLAG, String(Date.now())) } catch { /* ignore */ } } },
})
attachFlushOnHide(persistStorage.flush)
