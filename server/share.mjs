/* Share HTTP logic (pure sanitizer + handlers). The snapshot deliberately
 * keeps only what a reader needs: a title, the message text, and which model
 * answered. Attachments, workspaces, tool payloads, reasoning traces, system
 * prompts and settings never leave the device.
 *
 * Every share has an owner token: it is returned once (at creation) and stored
 * locally by the creator. The server keeps only its SHA-256 hash, so it can
 * authorize updates and private reads without ever being able to reconstruct
 * the token. A private share refuses reads that do not carry the owner token,
 * which is what makes the link "unusable to anyone other than the user". */
import { headerValue, readBodyText } from './http.mjs'

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

/** High-entropy owner token. URL-safe so it can ride a header or a query. */
export function shareToken() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const HEX = '0123456789abcdef'
export async function hashShareToken(token) {
  const data = new TextEncoder().encode(String(token ?? ''))
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15]
  return out
}

const badRequest = (message, code, status) => {
  const e = Error(message); e.code = code; e.status = status; return e
}

function parseBody(raw) {
  if (raw === null) throw badRequest('That conversation is too large to share (1 MB limit). Export it as Markdown instead.', 'too_large', 413)
  try { return raw ? JSON.parse(raw) : {} } catch { throw badRequest('Expected JSON.', 'bad_json', 400) }
}

export async function handleShareCreate(req, backend, makeId) {
  const body = parseBody(await readBodyText(req, SHARE_MAX_BYTES))
  const payload = sanitizeSharedChat(body?.chat)
  if (!payload) throw badRequest('There is nothing to share in this chat yet.', 'empty', 400)
  const id = String(makeId())
  const token = shareToken()
  const isPrivate = body?.private === true
  await backend.put(id, payload, { private: isPrivate, tokenHash: await hashShareToken(token) })
  return { ok: true, id, url: `/api/share/${id}`, createdAt: Date.now(), messages: payload.msgs.length, token, private: isPrivate }
}

/** Update an existing share's snapshot and/or privacy. Only the owner (holder
 *  of the token) may change a share. */
export async function handleShareUpdate(id, req, backend) {
  const clean = shareIdOf(id)
  if (!clean) throw badRequest('That is not a valid share link.', 'bad_id', 400)
  const body = parseBody(await readBodyText(req, SHARE_MAX_BYTES))
  const token = typeof body?.token === 'string' && body.token ? body.token : headerValue(req, 'x-share-token')
  const row = await backend.get(clean)
  if (!row) throw badRequest('This shared conversation was not found. The link may be wrong, or the share may have been replaced.', 'not_found', 404)
  if (!token || !row.tokenHash || (await hashShareToken(token)) !== row.tokenHash) {
    throw badRequest('Only the person who created this link can change it.', 'forbidden', 403)
  }
  const payload = body?.chat === undefined ? row.payload : sanitizeSharedChat(body.chat)
  if (!payload) throw badRequest('There is nothing to share in this chat yet.', 'empty', 400)
  const isPrivate = body?.private === true
  await backend.put(clean, payload, { private: isPrivate, tokenHash: row.tokenHash })
  return { ok: true, id: clean, url: `/api/share/${clean}`, createdAt: Date.now(), messages: payload.msgs.length, private: isPrivate }
}

/** Read a share. Public shares answer anyone holding the id; private shares
 *  require the owner token (sent as a header by the app, never in the URL). */
export async function handleShareGet(id, backend, token = '') {
  const clean = shareIdOf(id)
  if (!clean) throw badRequest('That is not a valid share link.', 'bad_id', 400)
  const row = await backend.get(clean)
  if (!row) throw badRequest('This shared conversation was not found. The link may be wrong, or the share may have been replaced.', 'not_found', 404)
  const isPrivate = row.private === true
  if (isPrivate) {
    const ok = token && row.tokenHash && (await hashShareToken(token)) === row.tokenHash
    if (!ok) throw badRequest('This shared conversation is private.', 'private', 403)
  }
  return { ok: true, id: clean, createdAt: row.createdAt, private: isPrivate, ...row.payload }
}
