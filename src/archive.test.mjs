import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARCHIVE_RETENTION_DEFAULT,
  ARCHIVE_RETENTION_NEVER,
  archiveRetentionLabel,
  isArchivedChatExpired,
  normArchiveDays,
} from './archive.ts'

test('archive retention defaults to 60 days and clamps to the slider range', () => {
  assert.equal(ARCHIVE_RETENTION_DEFAULT, 60)
  assert.equal(normArchiveDays(undefined), 60)
  assert.equal(normArchiveDays(null), 60)
  assert.equal(normArchiveDays(0), 1)
  assert.equal(normArchiveDays(61.4), 61)
  assert.equal(normArchiveDays(ARCHIVE_RETENTION_NEVER), 181)
  assert.equal(normArchiveDays(999), 181)
})

test('the top tick is labelled Never', () => {
  assert.equal(archiveRetentionLabel(1), '1 day')
  assert.equal(archiveRetentionLabel(60), '60 days')
  assert.equal(archiveRetentionLabel(180), '180 days')
  assert.equal(archiveRetentionLabel(ARCHIVE_RETENTION_NEVER), 'Never')
  assert.equal(archiveRetentionLabel(undefined), '60 days')
})

test('archived chats expire only after their retention window', () => {
  const now = 2_000_000_000_000
  const sixtyDays = 60 * 86_400_000
  assert.equal(isArchivedChatExpired(now - sixtyDays, 60, now), true)
  assert.equal(isArchivedChatExpired(now - sixtyDays + 1, 60, now), false)
  assert.equal(isArchivedChatExpired(now - 60 * 86_400_000, 1, now), true)
  assert.equal(isArchivedChatExpired(undefined, 60, now), false)
})

test('Never disables archived-chat deletion', () => {
  const now = 2_000_000_000_000
  assert.equal(isArchivedChatExpired(now - 10_000 * 86_400_000, ARCHIVE_RETENTION_NEVER, now), false)
  assert.equal(isArchivedChatExpired(now - 10_000 * 86_400_000, undefined, now), true)
})
