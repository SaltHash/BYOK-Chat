/* Share HTTP logic (pure sanitizer + handlers). The snapshot deliberately
 * keeps only what a reader needs: a title, the message text, and which model
 * answered. Attachments, workspaces, tool payloads, reasoning traces, system
 * prompts and settings never leave the device. */
import { readBodyText } from './http.mjs'

export const SHARE_MAX_BYTES = 1_200_000
export const SHARE_MAX_MSGS = 400
const SHARE_MAX_CHARS = 20_000
const ID_RE = /^[A-Za-z0-9_-]{12,64}$/

export function sanitizeSharedChat(input) {
  const chat = input && typeof input === 'object' ? input : {}
  const title = String(chat.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Shared conversation'
  const msgs = []
  for (const m of Array.isArray(chat.msgs) ? chat.msgs : []) {
    if (!m || typeof m !== 'object') continue
    const r = m.r === 'user' ? 'user' : m.r === 'assistant' ? 'assistant' : null
    if (!r) continue
    const t = typeof m.t === 'string' ? m.t.replace(/\u0000/g, '').slice(0, SHARE_MAX_CHARS) : ''
    if (!t.trim()) continue
    msgs.push({
      r,
      t,
      ...(r === 'assistant' && typeof m.by === 'string' && m.by.trim() ? { by: m.by.replace(/\s+/g, ' ').trim().slice(0, 160) } : {}),
      ...(Number.isFinite(Number(m.at)) ? { at: Number(m.at) } : {}),
    })
    if (msgs.length >= SHARE_MAX_MSGS) break
  }
  if (!msgs.length) return null
  return { v: 1, title, msgs, sharedAt: new Date().toISOString() }
}

export const shareIdOf = (raw) => (ID_RE.test(String(raw ?? '')) ? String(raw) : '')

export async function handleShareCreate(req, backend, makeId) {
  const raw = await readBodyText(req, SHARE_MAX_BYTES)
  if (raw === null) {
    const e = Error('That conversation is too large to share (1 MB limit). Export it as Markdown instead.')
    e.code = 'too_large'; e.status = 413; throw e
  }
  let body
  try { body = raw ? JSON.parse(raw) : {} } catch {
    const e = Error('Expected JSON.'); e.code = 'bad_json'; e.status = 400; throw e
  }
  const payload = sanitizeSharedChat(body?.chat)
  if (!payload) {
    const e = Error('There is nothing to share in this chat yet.'); e.code = 'empty'; e.status = 400; throw e
  }
  const id = String(makeId())
  await backend.put(id, payload)
  return { ok: true, id, url: `/api/share/${id}`, createdAt: Date.now(), messages: payload.msgs.length }
}

export async function handleShareGet(id, backend) {
  const clean = shareIdOf(id)
  if (!clean) {
    const e = Error('That is not a valid share link.'); e.code = 'bad_id'; e.status = 400; throw e
  }
  const row = await backend.get(clean)
  if (!row) {
    const e = Error('This shared conversation was not found. The link may be wrong, or the share may have been replaced.')
    e.code = 'not_found'; e.status = 404; throw e
  }
  return { ok: true, id: clean, createdAt: row.createdAt, ...row.payload }
}
