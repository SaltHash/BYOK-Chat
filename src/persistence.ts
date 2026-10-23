import type { PersistStorage, StateStorage } from 'zustand/middleware'
import { extractCitedIds } from './citations'
import { attachFlushOnHide, createCoalescedPersistStorage, type CoalescedPersistStorage } from './storage/coalesce'

export const QUOTA_FLAG = 'byok.v1:quota-full'

/** Persist payload version — single source for the zustand persist wrapper,
 *  durable migration metadata, and sync payloads. */
export const STORE_VERSION = 21

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

/* ---- zustand storage ----
 * Writes are coalesced (see storage/coalesce.ts): the payload is held by
 * reference and serialized/written at most once per window, so streamed
 * chunks no longer stringify and store the whole app on every token.
 * pagehide/visibilitychange flush the last window so nothing is lost. */

const rawStorage: StateStorage = {
  getItem: (k: string) => { try { localStorage.removeItem(QUOTA_FLAG); return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => {
    try { localStorage.setItem(k, v); localStorage.removeItem(QUOTA_FLAG) }
    catch (x) {
      const pruned = prunePersisted(v)
      if (pruned && pruned.length < v.length) {
        try { localStorage.setItem(k, pruned); localStorage.removeItem(QUOTA_FLAG); return }
        catch { /* fall through to flag */ }
      }
      if (isQuotaError(x)) { try { localStorage.setItem(QUOTA_FLAG, String(Date.now())) } catch { /* ignore */ } }
      else throw x
    }
  },
  removeItem: (k: string) => { try { localStorage.removeItem(k); localStorage.removeItem(QUOTA_FLAG) } catch { /* ignore */ } },
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
  onError: (x) => { if (isQuotaError(x)) { try { localStorage.setItem(QUOTA_FLAG, String(Date.now())) } catch { /* ignore */ } } },
})
attachFlushOnHide(persistStorage.flush)
