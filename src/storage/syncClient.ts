/* Sync HTTP client (same-origin /api/sync). Token sent as Bearer + body. */
import type { SyncPayload } from './sync'

export async function syncPush(token: string, payload: SyncPayload): Promise<{ updatedAt: number; backend: string }> {
  const r = await fetch('/api/sync/push', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ token, payload, storeVersion: payload.storeVersion, exportVersion: payload.v }) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Error(data?.error || `Sync push failed (HTTP ${r.status})`)
  return data
}

export async function syncPull(token: string): Promise<{ payload: SyncPayload; storeVersion: number; exportVersion: number; updatedAt: number; backend: string }> {
  const r = await fetch('/api/sync/pull', { headers: { authorization: `Bearer ${token}` } })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Error(data?.error || `Sync pull failed (HTTP ${r.status})`)
  if (!data?.payload) throw Error('Sync slot is empty. Push from the other device first.')
  return data
}

export async function syncStatus(): Promise<{ backend: string; configured: boolean }> {
  const r = await fetch('/api/sync/status')
  return r.json().catch(() => ({ backend: 'memory', configured: false }))
}
