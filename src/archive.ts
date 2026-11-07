/* Archived-chat retention. Archived chats stay restorable until this many days
 * have passed; the top slider tick is a deliberate sentinel for "keep them
 * forever" rather than a real 181-day limit. */
export const ARCHIVE_RETENTION_DEFAULT = 60
export const ARCHIVE_RETENTION_NEVER = 181
export const ARCHIVE_DAY_MS = 86_400_000

export function normArchiveDays(value: unknown): number {
  if (value == null) return ARCHIVE_RETENTION_DEFAULT
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ARCHIVE_RETENTION_DEFAULT
  return Math.max(1, Math.min(ARCHIVE_RETENTION_NEVER, Math.round(n)))
}

export function archiveRetentionLabel(value?: number | null): string {
  const days = normArchiveDays(value ?? ARCHIVE_RETENTION_DEFAULT)
  return days >= ARCHIVE_RETENTION_NEVER ? 'Never' : `${days} day${days === 1 ? '' : 's'}`
}

/** True when a chat archived at `archivedAt` is old enough to remove. Chats
 *  without a timestamp are left alone rather than risking a surprise delete. */
export function isArchivedChatExpired(archivedAt: number | undefined, days?: number | null, now = Date.now()): boolean {
  const retention = normArchiveDays(days ?? ARCHIVE_RETENTION_DEFAULT)
  return retention < ARCHIVE_RETENTION_NEVER
    && typeof archivedAt === 'number'
    && Number.isFinite(archivedAt)
    && archivedAt + retention * ARCHIVE_DAY_MS <= now
}
