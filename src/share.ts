/* Conversation sharing: create a public read-only snapshot and read one back.
 *
 * The snapshot is built on the device from the visible transcript only. Keys,
 * settings, system prompts, workspace files, tool payloads and attachment
 * bytes stay behind. The server stores the snapshot (Neon when DATABASE_URL is
 * set, otherwise memory) and hands it back at a plain link. */
import type { Chat } from './store'

export type SharedMessage = { r: 'user' | 'assistant'; t: string; by?: string; at?: number }
export type SharedChat = { v: 1; title: string; msgs: SharedMessage[]; sharedAt: string; createdAt?: number; id?: string }

const MAX_MSGS = 400
const MAX_CHARS = 20_000

/** Trim a chat to the shareable fields. Returns null when nothing would be
 *  shared (an empty chat). Pure, so the client and its tests agree on exactly
 *  what a link can contain. */
export function shareableChat(c: Pick<Chat, 'title' | 'msgs'>): Omit<SharedChat, 'sharedAt'> | null {
  const title = String(c?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Shared conversation'
  const msgs: SharedMessage[] = []
  for (const m of c?.msgs ?? []) {
    if (m.r !== 'user' && m.r !== 'assistant') continue
    const t = String(m.t ?? '').slice(0, MAX_CHARS)
    if (!t.trim()) continue
    msgs.push({
      r: m.r,
      t,
      ...(m.r === 'assistant' && m.by ? { by: String(m.by).replace(/\s+/g, ' ').trim().slice(0, 160) } : {}),
      ...(Number.isFinite(Number(m.at)) ? { at: Number(m.at) } : {}),
    })
    if (msgs.length >= MAX_MSGS) break
  }
  return msgs.length ? { v: 1, title, msgs } : null
}

export const shareLink = (id: string): string => {
  const base = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`
  return `${base}#share/${id}`
}

export async function createShare(chat: Pick<Chat, 'title' | 'msgs'>): Promise<{ id: string; url: string; messages: number }> {
  const snapshot = shareableChat(chat)
  if (!snapshot) throw Error('There is nothing to share in this chat yet.')
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat: snapshot }),
  })
  let data: any
  try { data = await res.json() } catch { throw Error(`The share service returned HTTP ${res.status}.`) }
  if (!res.ok) throw Error(data?.error || `The share service returned HTTP ${res.status}.`)
  return { id: data.id, url: shareLink(data.id), messages: Number(data.messages) || snapshot.msgs.length }
}

export async function fetchShare(id: string): Promise<SharedChat> {
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(id)) throw Error('That is not a valid share link.')
  const res = await fetch(`/api/share/${id}`)
  let data: any
  try { data = await res.json() } catch { throw Error(`The share service returned HTTP ${res.status}.`) }
  if (!res.ok) throw Error(data?.error || `The share service returned HTTP ${res.status}.`)
  if (!data || typeof data !== 'object' || !Array.isArray(data.msgs)) throw Error('The share link returned an unexpected payload.')
  return data as SharedChat
}

/** Parse `#share/<id>` out of the current hash. */
export const shareIdFromHash = (hash: string): string => {
  const m = /^#\/?share\/([A-Za-z0-9_-]{12,64})$/.exec(String(hash ?? ''))
  return m ? m[1] : ''
}
