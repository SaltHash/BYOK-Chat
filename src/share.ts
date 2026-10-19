/* Conversation sharing: create a public read-only snapshot and read one back.
 *
 * The snapshot is built on the device from the visible transcript only. Keys,
 * settings, system prompts, workspace files, tool payloads and attachment
 * bytes stay behind. The server stores the snapshot (Neon when DATABASE_URL is
 * set, otherwise memory) and hands it back at a plain link.
 *
 * Every share carries an owner token. It is minted server-side, stored only in
 * this browser (never in the URL), and is required to update a snapshot or to
 * read a private one. `private: true` therefore makes the link unusable to
 * anyone but the person who created it. */
import type { Chat } from './store'

export type SharedMessage = { r: 'user' | 'assistant'; t: string; by?: string; at?: number }
export type SharedChat = { v: 1; title: string; msgs: SharedMessage[]; sharedAt: string; createdAt?: number; id?: string; private?: boolean }

/* One created link, remembered locally so the share dialog can find the most
 * recent one, offer the previous ones, and auto-update it later. */
export type ShareRecord = {
  id: string
  chatId: string
  url: string
  token: string
  /** Fingerprint of the snapshot last pushed; '' when the chat is unshareable. */
  hash: string
  at: number
  auto: boolean
  private: boolean
}

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

/** Stable fingerprint of exactly what a link would contain. Two chats with the
 *  same visible transcript produce the same hash, so re-sharing an unchanged
 *  conversation can reuse the existing link. */
export function shareHash(c: Pick<Chat, 'title' | 'msgs'>): string {
  const snap = shareableChat(c)
  if (!snap) return ''
  const text = JSON.stringify(snap)
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`
}

export const shareLink = (id: string): string => {
  const base = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`
  return `${base}#share/${id}`
}

/** The most recently created link for a chat, if any. */
export const latestShare = (shares: ShareRecord[] | undefined, chatId: string): ShareRecord | undefined =>
  (shares ?? [])
    .filter((s) => s && s.chatId === chatId)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]

async function shareRequest(url: string, body: unknown, token: string): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-share-token'] = token
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  let data: any
  try { data = await res.json() } catch { throw Error(`The share service returned HTTP ${res.status}.`) }
  if (!res.ok) throw Error(data?.error || `The share service returned HTTP ${res.status}.`)
  return data
}

export async function createShare(chat: Pick<Chat, 'title' | 'msgs'>, opts?: { private?: boolean }): Promise<{ id: string; url: string; token: string; messages: number; private: boolean }> {
  const snapshot = shareableChat(chat)
  if (!snapshot) throw Error('There is nothing to share in this chat yet.')
  const data = await shareRequest('/api/share', { chat: snapshot, private: opts?.private === true }, '')
  return { id: data.id, url: shareLink(data.id), token: String(data.token ?? ''), messages: Number(data.messages) || snapshot.msgs.length, private: data.private === true }
}

export async function updateShare(id: string, token: string, chat: Pick<Chat, 'title' | 'msgs'>, opts?: { private?: boolean }): Promise<{ id: string; url: string; messages: number; private: boolean }> {
  const snapshot = shareableChat(chat)
  if (!snapshot) throw Error('There is nothing to share in this chat yet.')
  const data = await shareRequest(`/api/share/${id}`, { chat: snapshot, private: opts?.private === true }, token)
  return { id: data.id, url: shareLink(data.id), messages: Number(data.messages) || snapshot.msgs.length, private: data.private === true }
}

export async function fetchShare(id: string, token = ''): Promise<SharedChat> {
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(id)) throw Error('That is not a valid share link.')
  const headers: Record<string, string> = {}
  if (token) headers['x-share-token'] = token
  const res = await fetch(`/api/share/${id}`, { headers })
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
