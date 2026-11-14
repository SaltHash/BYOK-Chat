/* Sync HTTP client (same-origin /api/sync). Token sent as Bearer + body. */
import type { SyncEnvelope, SyncPayload } from './sync'
import type { SyncChatPush, SyncChatRow, SyncMessageRow } from './chatSync'

export type SyncPushBody =
  | { payload: SyncPayload | SyncEnvelope; chats?: SyncChatPush; baseSeq?: number; storeVersion?: number; exportVersion?: number; chatStore?: boolean; at?: number }
  | { delta?: SyncEnvelope; chats?: SyncChatPush; baseSeq: number; storeVersion?: number; exportVersion?: number; chatStore?: boolean; at?: number }

export type SyncPushResult = {
  updatedAt: number
  backend: string
  seq: number
  /** The delta log is full; this client should compact it with a full push. */
  compact?: boolean
  /** Whether the slot stores conversations (the client's opt-in). */
  chatStore?: boolean
}

export type SyncPullResult = {
  /** Present for a first pull, or when the server compacted past `since`. */
  payload?: SyncPayload | SyncEnvelope
  /** Encrypted settings deltas newer than `since`, oldest first. */
  deltas?: unknown[]
  /** Chat metadata rows changed after `since` (opt-in chat store only). */
  chats?: SyncChatRow[]
  /** Individual message rows changed after `since`. */
  messages?: SyncMessageRow[]
  seq: number
  /** Sequence of the full snapshot that `deltas` sit on top of. */
  baseSeq?: number
  full?: boolean
  /** Sent when the device is already at `seq`; the response is tiny. */
  upToDate?: boolean
  storeVersion: number
  exportVersion: number
  updatedAt: number
  backend: string
}

type SyncError = Error & { status?: number; code?: string; seq?: number; data?: unknown }

const fail = (status: number, data: Record<string, unknown>, fallback: string): SyncError => {
  const error = Error(String(data?.error || fallback)) as SyncError
  error.status = status
  if (typeof data?.code === 'string') error.code = data.code
  if (typeof data?.seq === 'number') error.seq = data.seq
  error.data = data
  return error
}

export async function syncPush(token: string, body: SyncPushBody): Promise<SyncPushResult> {
  const r = await fetch('/api/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ token, ...body }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw fail(r.status, data, `Sync push failed (HTTP ${r.status})`)
  return data as SyncPushResult
}

/** Pull the slot. With `since`, only deltas and rows after that sequence are
 *  returned (or a full snapshot when the server compacted past it). Without
 *  `since`, the complete save is returned for a newly linked device. */
export async function syncPull(token: string, since?: number): Promise<SyncPullResult> {
  const query = Number.isFinite(since) && (since as number) > 0 ? `?since=${encodeURIComponent(String(since))}` : ''
  const r = await fetch(`/api/sync/pull${query}`, { headers: { authorization: `Bearer ${token}` } })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw fail(r.status, data, `Sync pull failed (HTTP ${r.status})`)
  if (!data?.payload && !Array.isArray(data?.deltas) && !Array.isArray(data?.messages) && !Array.isArray(data?.chats) && data?.upToDate !== true) {
    throw Error('Sync slot is empty. Push from the other device first.')
  }
  return data as SyncPullResult
}

export async function syncStatus(): Promise<{ backend: string; configured: boolean; shared?: boolean }> {
  const r = await fetch('/api/sync/status')
  return r.json().catch(() => ({ backend: 'memory', configured: false, shared: false }))
}
