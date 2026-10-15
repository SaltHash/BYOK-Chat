import { createJSONStorage } from 'zustand/middleware'

export const QUOTA_FLAG = 'byok.v1:quota-full'

export const isQuotaError = (x: unknown) =>
  !!x && ((x as { name?: unknown }).name === 'QuotaExceededError' || (x as { code?: unknown }).code === 22 || /quota/i.test(String((x as { message?: unknown })?.message ?? '')))

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
        fadeEvents: undefined,
        reasoning: typeof m.reasoning === 'string' && (m.reasoning as string).length > 5000 ? (m.reasoning as string).slice(0, 5000) + '\n[compacted]' : m.reasoning,
        toolRounds: ((m.toolRounds ?? []) as Record<string, unknown>[]).map((r) => ({
          ...r,
          calls: ((r.calls ?? []) as Record<string, unknown>[]).map((call) => ({ ...call, result: cap(call.result, 5000) })),
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

/** zustand storage with quota-compaction fallback (single source for store persist). */
export const persistStorage = createJSONStorage(() => ({
  getItem: (k: string) => { try { localStorage.removeItem(QUOTA_FLAG); return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => {
    try { localStorage.setItem(k, v); localStorage.removeItem(QUOTA_FLAG) }
    catch (x) {
      const pruned = prunePersisted(v)
      if (pruned && pruned.length < v.length) {
        try { localStorage.setItem(k, pruned); localStorage.removeItem(QUOTA_FLAG); return }
        catch { /* fall through to flag */ }
      }
      try { localStorage.setItem(QUOTA_FLAG, String(Date.now())) } catch { /* ignore */ }
      if (!isQuotaError(x)) throw x
    }
  },
  removeItem: (k: string) => { try { localStorage.removeItem(k); localStorage.removeItem(QUOTA_FLAG) } catch { /* ignore */ } },
}))
