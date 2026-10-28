/* Durable client storage: IndexedDB + OPFS with IndexedDB fallback.
 * Settings stay in localStorage (zustand persist `byok.v1`). Large payloads
 * (chats, workspaces, attachment blobs) live here so localStorage quota can
 * never wipe history. All functions are safe to call in Node tests: they
 * use an in-memory fallback in Node tests without browser storage. */

import { reportStorageFailure } from '../persistence'

export const DURABLE_DB = 'byok.durable.v1'
export const DURABLE_CHATS_KEY = 'chats'
export const DURABLE_WORKSPACES_KEY = 'workspaces'
export const DURABLE_BLOBS_PREFIX = 'blob:'
export const DURABLE_META_KEY = 'meta'
export const DURABLE_BACKUPS_KEY = 'backups'
/** Content hashes + server sequence for incremental sync. Never a second full
 *  copy of the store, so it stays small. */
export const DURABLE_SYNC_BASE_KEY = 'sync:base:v2'

export type DurableMeta = { migratedAt?: number; storeVersion?: number; backend?: 'opfs' | 'idb' | 'memory' }

type IDB = typeof indexedDB extends never ? never : IDBFactory

const mem = new Map<string, unknown>()

function hasIDB(): boolean {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB } catch { return false }
}

function openDB(): Promise<IDBDatabase | null> {
  if (!hasIDB()) {
    if (typeof window !== 'undefined') { reportStorageFailure(); return Promise.reject(Error('IndexedDB is unavailable.')) }
    return Promise.resolve(null)
  }
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DURABLE_DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => { reportStorageFailure(); reject(req.error ?? Error('Could not open IndexedDB.')) }
      req.onblocked = () => { reportStorageFailure(); reject(Error('IndexedDB is blocked by another tab.')) }
    } catch (error) { reportStorageFailure(); reject(error) }
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  if (mem.has(key)) return (mem.get(key) as T) ?? null
  const db = await openDB()
  if (!db) return null
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('kv', 'readonly')
      const rq = tx.objectStore('kv').get(key)
      rq.onsuccess = () => { db.close(); resolve((rq.result as T) ?? null) }
      rq.onerror = () => { db.close(); reportStorageFailure(); reject(rq.error ?? Error('Could not read IndexedDB.')) }
      tx.onabort = () => { db.close(); reportStorageFailure(); reject(tx.error ?? Error('IndexedDB read was interrupted.')) }
    } catch (error) { try { db.close() } catch {} reject(error) }
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB()
  if (!db) { mem.set(key, value); return }
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(value, key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); reportStorageFailure(); reject(tx.error ?? Error('IndexedDB write was interrupted.')) }
      tx.onerror = () => { /* abort reports the transaction failure */ }
    } catch (error) { try { db.close() } catch {} reportStorageFailure(); reject(error) }
  })
  mem.set(key, value)
}

async function idbDel(key: string): Promise<void> {
  const db = await openDB()
  if (!db) { mem.delete(key); return }
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').delete(key)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); reject(tx.error ?? Error('IndexedDB delete was interrupted.')) }
      tx.onerror = () => { /* abort reports the transaction failure */ }
    } catch (error) { try { db.close() } catch {} reject(error) }
  })
  mem.delete(key)
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
    if (await opfsWrite(id, data)) { await idbSet(key, { backend: 'opfs' }); return 'opfs' }
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

export async function durablePutSyncBase(value: unknown): Promise<void> {
  await idbSet(DURABLE_SYNC_BASE_KEY, value)
}

export async function durableGetSyncBase<T>(): Promise<T | null> {
  return idbGet<T>(DURABLE_SYNC_BASE_KEY)
}

export async function durableDelSyncBase(): Promise<void> {
  await idbDel(DURABLE_SYNC_BASE_KEY)
}

/* ---- local scheduled backups ----
 * A small rolling set of complete config snapshots, kept in IndexedDB on this
 * device only. They are deliberately separate from Neon sync and from the
 * live chat mirror: clearing one backup never touches the live store. */
export type StoredBackup = { id: string; at: number; bytes: number; json: string }

export async function durablePutBackup(entry: StoredBackup, keep = 5): Promise<void> {
  if (!hasIDB()) throw Error('IndexedDB is unavailable; the backup was not saved.')
  const list = (await idbGet<StoredBackup[]>(DURABLE_BACKUPS_KEY)) ?? []
  const next = [entry, ...list.filter((x) => x.id !== entry.id)].slice(0, Math.max(1, keep))
  await idbSet(DURABLE_BACKUPS_KEY, next)
}

/** Backup metadata without the JSON bodies (cheap for list UIs). */
export async function durableListBackups(): Promise<Array<Omit<StoredBackup, 'json'>>> {
  const list = (await idbGet<StoredBackup[]>(DURABLE_BACKUPS_KEY)) ?? []
  return list.map(({ json, ...meta }) => ({ ...meta, bytes: meta.bytes || json?.length || 0 }))
}

export async function durableGetBackup(id: string): Promise<string | null> {
  const list = (await idbGet<StoredBackup[]>(DURABLE_BACKUPS_KEY)) ?? []
  return list.find((x) => x.id === id)?.json ?? null
}

export async function durableDeleteBackup(id: string): Promise<void> {
  const list = (await idbGet<StoredBackup[]>(DURABLE_BACKUPS_KEY)) ?? []
  await idbSet(DURABLE_BACKUPS_KEY, list.filter((x) => x.id !== id))
}

/* Erase every durable copy (chats, workspaces, blobs, meta). Without this a
 * reload after "Erase everything" restores the chats from IndexedDB/OPFS. */
export async function durableEraseAll(): Promise<void> {
  mem.clear()
  if (hasIDB()) {
    await new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(DURABLE_DB)
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      } catch { resolve() }
    })
  }
  if (opfsSupported()) {
    try {
      const root = await (navigator.storage as unknown as { getDirectory: () => Promise<FileSystemDirectoryHandle> }).getDirectory()
      await root.removeEntry('byok-blobs', { recursive: true })
    } catch { /* folder may not exist */ }
  }
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

/* Background compaction (pure part): drop old reasoning, expired
 * temp chats. Returns pruned copies; caller persists + measures freed bytes. */
export function compactChatsForDurable(chats: Array<{ temporary?: boolean; expiresAt?: number; msgs: Array<{ id: string; r: string; reasoning?: string }> }>, now = Date.now()): { chats: typeof chats; droppedChats: number } {
  const alive = chats.filter((c) => !(c.temporary && c.expiresAt != null && c.expiresAt <= now))
  const droppedChats = chats.length - alive.length
  /* Key by the chat object itself: coercing a chat to a string would collapse
   * every chat onto "[object Object]" and keep only one reasoning trace. */
  const lastReasoning = new Map<object, string>()
  for (const c of alive) {
    const last = [...c.msgs].reverse().find((m) => m.r === 'assistant' && m.reasoning)
    if (last) lastReasoning.set(c, last.id)
  }
  const pruned = alive.map((c) => ({
    ...c,
    msgs: c.msgs.map((m) => ({ ...m, reasoning: m.id === lastReasoning.get(c) ? m.reasoning : undefined })),
  })) as typeof chats
  return { chats: pruned, droppedChats }
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
  let backend: StorageBreakdown['backend'] = 'memory'
  try {
    const db = await openDB()
    if (db) { db.close(); backend = 'idb' }
  } catch { /* the storage warning explains that this browser cannot save */ }
  return { localBytes, durableBytes, opfs: opfsSupported(), backend }
}
