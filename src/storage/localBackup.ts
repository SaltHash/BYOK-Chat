/* Local scheduled backups.
 *
 * This is the safety net for "my browser storage was cleared": one rolling
 * snapshot of everything that is hard to recreate (settings, endpoints without
 * their keys, prompts, projects and chats) is written to IndexedDB on this
 * device once a day. It never contacts the sync server, never contains API or
 * search keys, and never includes attachment bytes (those already live in the
 * durable blob store and are not part of a config snapshot).
 *
 * The scheduler is intentionally lazy: `maybeRunDailyBackup` is called on boot
 * and on becoming visible, and does nothing until a full day has passed.
 */

import { buildExportPayload } from '../configIO'
import { normSearch } from '../store'
import { normSkills } from '../skills'
import { useS } from '../store'
import { pruneChatForPersist } from '../persistence'
import { durableDeleteBackup, durableGetBackup, durableListBackups, durablePutBackup, type StoredBackup } from './durable'

export const BACKUP_AUTO_KEY = 'byok.backup.auto'
export const BACKUP_LAST_KEY = 'byok.backup.last'
/** One rolling backup per day; five days of history is enough to recover. */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
export const BACKUP_KEEP = 5

export const getAutoBackup = (): boolean => {
  try { return localStorage.getItem(BACKUP_AUTO_KEY) === '1' } catch { return false }
}
export const setAutoBackup = (on: boolean): void => {
  try { localStorage.setItem(BACKUP_AUTO_KEY, on ? '1' : '0') } catch { /* blocked storage */ }
}
export const getLastBackup = (): number => {
  try { return Number(localStorage.getItem(BACKUP_LAST_KEY) ?? 0) || 0 } catch { return 0 }
}
const setLastBackup = (at: number): void => {
  try { localStorage.setItem(BACKUP_LAST_KEY, String(at)) } catch { /* blocked storage */ }
}

export const backupIsDue = (now = Date.now(), last = getLastBackup(), enabled = getAutoBackup()): boolean =>
  enabled && now - last >= BACKUP_INTERVAL_MS

const ALL = {
  eps: true, prompts: true, pls: true, cmds: true, skills: true, memory: true,
  keys: true, appearance: true, features: true, tools: true, tuning: true,
  widgets: true, stats: true, chats: true,
} as const

/** Build the snapshot body. Pure enough to test: reads the store's current
 *  state, strips attachment bytes, and never includes credentials. */
export function buildLocalBackupPayload(): { json: string; bytes: number } {
  const state = useS.getState()
  const data = buildExportPayload(
    {
      ...(state as unknown as Parameters<typeof buildExportPayload>[0]),
      // Persisted backups keep message text but not uploaded file bytes:
      // those are large and already mirrored into durable blob storage.
      chats: (state.chats ?? []).map((c) => pruneChatForPersist(c)),
    },
    ALL as unknown as Record<import('../configIO').ExportCategory, boolean>,
    false,
    normSkills,
    normSearch,
  )
  const json = JSON.stringify({ ...data, v: 4, backupAt: Date.now() })
  return { json, bytes: json.length }
}

export type BackupMeta = Omit<StoredBackup, 'json'>

/** Write a snapshot now. Returns its metadata, or an error message when
 *  IndexedDB is unavailable. */
export async function runLocalBackup(force = false): Promise<{ ok: boolean; meta?: BackupMeta; error?: string }> {
  const now = Date.now()
  if (!force && !backupIsDue(now)) return { ok: false, error: 'A backup is not due yet.' }
  let body: { json: string; bytes: number }
  try { body = buildLocalBackupPayload() } catch (e) { return { ok: false, error: (e as Error).message } }
  const meta: BackupMeta = { id: `backup-${now}`, at: now, bytes: body.bytes }
  try {
    await durablePutBackup({ ...meta, json: body.json }, BACKUP_KEEP)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  setLastBackup(now)
  return { ok: true, meta }
}

/** Called on boot and visibility changes; exactly one attempt per interval. */
export async function maybeRunDailyBackup(): Promise<void> {
  if (!backupIsDue()) return
  // Mark the attempt first so a failed/blocked write does not retry on every
  // focus event and stack dialogs or writes.
  setLastBackup(Date.now())
  await runLocalBackup(true).catch(() => {})
}

export const listLocalBackups = (): Promise<BackupMeta[]> => durableListBackups()
export const readLocalBackup = (id: string): Promise<string | null> => durableGetBackup(id)
export const deleteLocalBackup = (id: string): Promise<void> => durableDeleteBackup(id)
