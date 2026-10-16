/* Durable client storage: IndexedDB + OPFS with IndexedDB fallback.
 * Settings stay in localStorage (zustand persist `byok.v1`). Large payloads
 * (chats, workspaces, attachment blobs) live here so localStorage quota can
 * never wipe history. All functions are safe to call in Node tests: they
 * no-op without DOM/IndexedDB/OPFS. */

export const DURABLE_DB = 'byok.durable.v1'
export const DURABLE_CHATS_KEY = 'chats'
export const DURABLE_WORKSPACES_KEY = 'workspaces'
export const DURABLE_BLOBS_PREFIX = 'blob:'
export const DURABLE_META_KEY = 'meta'

export type DurableMeta = { migratedAt?: number; storeVersion?: number; backend?: 'opfs' | 'idb' | 'memory' }

type IDB = typeof indexedDB extends never ? never : IDBFactory

const mem = new Map<string, unknown>()

function hasIDB(): boolean {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB } catch { return false }
}

function openDB(): Promise<IDBDatabase | null> {
  if (!hasIDB()) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DURABLE_DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  if (mem.has(key)) return (mem.get(key) as T) ?? null
  const db = await openDB()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('kv', 'readonly')
      const rq = tx.objectStore('kv').get(key)
      rq.onsuccess = () => { db.close(); resolve((rq.result as T) ?? null) }
      rq.onerror = () => { db.close(); resolve(null) }
    } catch { try { db.close() } catch {} resolve(null) }
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  mem.set(key, value)
  const db = await openDB()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(value, key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    } catch { try { db.close() } catch {} resolve() }
  })
}

async function idbDel(key: string): Promise<void> {
  mem.delete(key)
  const db = await openDB()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').delete(key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    } catch { try { db.close() } catch {} resolve() }
  })
}

/* ---- OPFS (large blobs only) ---- */

export function opfsSupported(): boolean {
  try { return typeof navigator !== 'undefined' && !!(navigator as unknown as { storage?: { getDirectory?: unknown } })?.storage?.getDirectory } catch { return false }
}

async function opfsFile(name: string): Promise<FileSystemFileHandle | null> {
  try {
    if (!opfsSupported()) return null
    const root = await (navigator.storage as unknown as { getDirectory: () => Promise<FileSystemDirectoryHandle> }).getDirectory()
    const dir = await root.getDirectoryHandle('byok-blobs', { create: true })
    return await dir.getFileHandle(name, { create: true })
  } catch { return null }
}

export async function opfsWrite(name: string, data: string): Promise<boolean> {
  try {
    const h = await opfsFile(name)
    if (!h) return false
    const w = await (h as unknown as { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }).createWritable()
    await w.write(data)
    await w.close()
    return true
  } catch { return false }
}

export async function opfsRead(name: string): Promise<string | null> {
  try {
    const h = await opfsFile(name)
    if (!h) return null
    const f = await (h as unknown as { getFile: () => Promise<File> }).getFile()
    return await f.text()
  } catch { return null }
}

export async function opfsDelete(name: string): Promise<void> {
  try {
    if (!opfsSupported()) return
    const root = await (navigator.storage as unknown as { getDirectory: () => Promise<FileSystemDirectoryHandle> }).getDirectory()
    const dir = await root.getDirectoryHandle('byok-blobs', { create: true })
    await dir.removeEntry(name).catch(() => {})
  } catch { /* ignore */ }
}

/* ---- Blobs (attachment base64) ----
 * Small blobs stay in IndexedDB kv; large ones (>100k chars) prefer OPFS.
 * API is content-addressed by caller-supplied id (msgId + index). */

const OPFS_THRESHOLD = 100_000

export async function blobPut(id: string, data: string): Promise<'opfs' | 'idb' | 'memory'> {
  const key = DURABLE_BLOBS_PREFIX + id
  if (data.length >= OPFS_THRESHOLD && opfsSupported()) {
    if (await opfsWrite(id, data)) { mem.set(key, { backend: 'opfs' } as unknown); await idbSet(key, { backend: 'opfs' }); return 'opfs' }
  }
  await idbSet(key, data)
  return hasIDB() ? 'idb' : 'memory'
}

export async function blobGet(id: string): Promise<string | null> {
  const key = DURABLE_BLOBS_PREFIX + id
  const ref = await idbGet<unknown>(key)
  if (ref && typeof ref === 'object' && (ref as { backend?: string }).backend === 'opfs') {
    const v = await opfsRead(id)
    if (v != null) return v
  }
  if (typeof ref === 'string') return ref
  const m = mem.get(key)
  return typeof m === 'string' ? m : null
}

export async function blobDel(id: string): Promise<void> {
  await idbDel(DURABLE_BLOBS_PREFIX + id)
  await opfsDelete(id)
}

/* ---- Chats / workspaces (JSON, always IndexedDB kv + memory mirror) ---- */

export async function durablePutChats(chats: unknown): Promise<void> {
  await idbSet(DURABLE_CHATS_KEY, chats)
}

export async function durableGetChats<T>(): Promise<T | null> {
  return idbGet<T>(DURABLE_CHATS_KEY)
}

export async function durablePutWorkspaces(ws: unknown): Promise<void> {
  await idbSet(DURABLE_WORKSPACES_KEY, ws)
}

export async function durableGetWorkspaces<T>(): Promise<T | null> {
  return idbGet<T>(DURABLE_WORKSPACES_KEY)
}

export async function durableGetMeta(): Promise<DurableMeta | null> {
  return idbGet<DurableMeta>(DURABLE_META_KEY)
}

export async function durableSetMeta(m: DurableMeta): Promise<void> {
  await idbSet(DURABLE_META_KEY, m)
}

/* Split a persisted `byok.v1` JSON blob into settings (keep in localStorage)
 * vs durable (chats, workspaces, selectedRevision). Pure + unit-testable. */
export function splitPersistedForDurable(parsed: Record<string, unknown>): { settings: Record<string, unknown>; chats: unknown; workspaces: unknown; selectedRevision: unknown } {
  const { chats = [], workspaces = {}, selectedRevision = {}, ...settings } = parsed ?? {}
  return { settings, chats, workspaces, selectedRevision }
}

/* Recombine for sync payloads / exports. */
export function joinPersistedForSync(settings: Record<string, unknown>, chats: unknown, workspaces: unknown, selectedRevision: unknown): Record<string, unknown> {
  return { ...settings, chats, workspaces, selectedRevision }
}

/* Background compaction (pure part): drop fadeEvents, old reasoning, expired
 * temp chats. Returns pruned copies; caller persists + measures freed bytes. */
export function compactChatsForDurable(chats: Array<{ temporary?: boolean; expiresAt?: number; msgs: Array<{ id: string; r: string; reasoning?: string }> }>, now = Date.now()): { chats: typeof chats; droppedChats: number } {
  const alive = chats.filter((c) => !(c.temporary && c.expiresAt != null && c.expiresAt <= now))
  const droppedChats = chats.length - alive.length
  const lastReasoning = new Map<string, string>()
  for (const c of alive) {
    const last = [...c.msgs].reverse().find((m) => m.r === 'assistant' && m.reasoning)
    if (last) lastReasoning.set(c as unknown as string, last.id)
  }
  const pruned = alive.map((c) => ({
    ...c,
    msgs: c.msgs.map((m) => ({ ...m, fadeEvents: undefined, reasoning: (m as { id: string }).id === lastReasoning.get(c as unknown as string) ? m.reasoning : undefined })),
  })) as typeof chats
  return { chats: pruned, droppedChats }
}

/* Fade-in events carry page-relative performance.now() timestamps and are only
 * meaningful inside the session that produced them. Persisting them (durable
 * mirror, sync payloads) makes reloaded messages animate against stale
 * timestamps and can leave text stuck invisible, so drop them at the storage
 * boundary. Pure + unit-testable; returns the input unchanged when not an array. */
export function stripEphemeralFromChats<T extends { msgs?: Array<Record<string, unknown>> }>(chats: T[] | null | undefined): T[] | null | undefined {
  if (!Array.isArray(chats)) return chats
  return chats.map((c) => {
    const msgs = c?.msgs
    if (!Array.isArray(msgs)) return c
    let changed = false
    const next = msgs.map((m) => {
      if (m && typeof m === 'object' && (m as { fadeEvents?: unknown }).fadeEvents !== undefined) {
        changed = true
        return { ...m, fadeEvents: undefined }
      }
      return m
    })
    return changed ? { ...c, msgs: next } : c
  })
}

export type StorageBreakdown = { localBytes: number; durableBytes: number; opfs: boolean; backend: 'opfs' | 'idb' | 'memory' }

export async function durableUsage(): Promise<StorageBreakdown> {
  let localBytes = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || (!k.startsWith('byok.v1') && k !== 'byok.v1:quota-full')) continue
      localBytes += (k.length + (localStorage.getItem(k) ?? '').length) * 2
    }
  } catch { /* blocked */ }
  let durableBytes = 0
  try {
    const e = await (navigator as unknown as { storage?: { estimate?: () => Promise<{ usage?: number }> } })?.storage?.estimate?.()
    durableBytes = Math.max(0, (e?.usage ?? 0) - localBytes)
  } catch { /* ignore */ }
  const backend = opfsSupported() ? 'opfs' : hasIDB() ? 'idb' : 'memory'
  return { localBytes, durableBytes, opfs: opfsSupported(), backend }
}
