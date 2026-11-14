/* Token sync HTTP logic (pure helpers + handlers). Token format is shared
 * with src/storage/sync.ts: `byok1-<id>-<secret>`. Route dispatch lives in
 * server/api.mjs so both the Node server and the Cloudflare Worker reuse it.
 *
 * Storage contract (see syncStore.mjs):
 *   - a small metadata row carries the sequence and the credential hash;
 *   - one encrypted settings snapshot sits at `baseSeq`;
 *   - one encrypted row per settings delta after it;
 *   - when the user opts in, one row per chat and one row per message.
 *
 * An idle poll reads the metadata row only. An incremental pull reads only the
 * delta and message rows after the caller's sequence. A full pull (a newly
 * linked device) is the only path that reads the snapshot.
 *
 * Chat storage is opt-in. Unless a push says `chatStore: true`, chat data is
 * refused and any rows stored earlier are removed: the default is that the
 * server holds settings, never conversations.
 *
 * This module also re-applies the "no heavy payloads" rule server-side, so a
 * client that forgets to shape its data still never stores file bytes, tool
 * arguments or tool results. */
import { sha256Hex, safeEqual } from './syncStore.mjs'
import { bearerToken, readBodyText } from './http.mjs'

const TOKEN_RE = /^byok1-([A-Za-z0-9_-]{16})-([A-Za-z0-9_-]{40,50})$/
export const SYNC_MAX_BYTES = 8_000_000
/** A token that has not been used (push or pull) for this long is pruned on
 *  read: Neon is serverless, so there is no background job to do it. */
export const SYNC_ROW_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Keep the encrypted settings delta log bounded. Once the cap is reached the
 *  pushing client is asked to compact it with one full snapshot, so a new
 *  device never has to replay an unbounded chain. Chat rows never need this:
 *  they are keyed by id and hold the latest revision of each message. */
export const SYNC_DELTA_MAX = 120
/** Upper bound on one push. Exceeding it is an error, never a silent cut: a
 *  truncated push would leave the client believing its save is stored. */
export const SYNC_MAX_CHAT_OPS = 5000
export const SYNC_MAX_MESSAGES_PER_PUSH = 20_000
const MAX_TEXT = 400_000
const MAX_TOOL_TEXT = 4000

export function parseToken(raw) {
  const m = TOKEN_RE.exec(String(raw || '').trim())
  if (!m) { const e = Error('Invalid sync token.'); e.code = 'bad_token'; e.status = 400; throw e }
  return { id: m[1], secret: m[2] }
}

export { bearerToken }

async function readJson(req, max = SYNC_MAX_BYTES) {
  const raw = await readBodyText(req, max)
  if (raw === null) { const e = Error('Sync payload is too large (8 MB limit).'); e.code = 'too_large'; e.status = 413; throw e }
  try { return raw ? JSON.parse(raw) : {} } catch { const e = Error('Expected JSON.'); e.code = 'bad_json'; e.status = 400; throw e }
}

const asSeq = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const clip = (v, n) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}…` : v)

const conflict = (seq) => {
  const e = Error('Another device changed this sync slot. Pull the missing changes and retry.')
  e.code = 'sync_conflict'
  e.status = 409
  e.seq = seq
  return e
}

async function authRow(backend, token) {
  const { id, secret } = parseToken(token)
  const row = await backend.meta(id)
  // A generated token that has never been pushed is an empty slot, not a bad
  // credential: the link flow seeds it from this device instead of failing.
  if (!row) {
    const e = Error('Sync slot is empty. Push from the other device first.')
    e.code = 'empty'
    e.status = 404
    throw e
  }
  if (!safeEqual(sha256Hex(secret), String(row.secretHash))) {
    const e = Error('Unknown or incorrect sync token.')
    e.code = 'bad_token'
    e.status = 401
    throw e
  }
  return { row, id, secret }
}

/* Serialize read-check-write for one slot inside this process. Without it,
 * two pushes can read the same sequence and both write seq+1, silently losing
 * one device's change. The memory backend is per process and the Node host is
 * a single process, which is the deployment this protects. */
const syncQueues = new Map()
const syncQueueDepth = new Map()
async function withSyncLock(id, fn) {
  const previous = syncQueues.get(id) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  syncQueues.set(id, run.catch(() => {}))
  syncQueueDepth.set(id, (syncQueueDepth.get(id) ?? 0) + 1)
  try {
    return await run
  } finally {
    const left = (syncQueueDepth.get(id) ?? 1) - 1
    if (left <= 0) { syncQueueDepth.delete(id); syncQueues.delete(id) }
    else syncQueueDepth.set(id, left)
  }
}

/* ---- what is allowed to be stored ---- */

const cleanAttachment = (value) => {
  if (!isObj(value)) return null
  // File bytes and extracted text are the single largest thing a message can
  // carry. They stay on the device that attached them, always.
  const { data, text, ...rest } = value
  return rest
}

const cleanCall = (value) => {
  if (!isObj(value)) return null
  // Keep the indicator (which tool ran, whether it failed, how long it took),
  // never its input or output.
  const { arguments: _args, result: _result, ...rest } = value
  return rest
}

const cleanResearch = (value) => {
  if (!isObj(value)) return value
  const out = {
    id: value.id, query: clip(value.query, 2000), tier: value.tier, status: value.status,
    startedAt: value.startedAt, finishedAt: value.finishedAt,
    summary: clip(value.summary, 8000),
    note: clip(value.note, 4000),
    reasoning: clip(value.reasoning, 4000),
    steer: clip(value.steer, 800),
    plan: isObj(value.plan) ? {
      title: clip(value.plan.title, 400), intro: clip(value.plan.intro, 1200),
      steps: Array.isArray(value.plan.steps) ? value.plan.steps.slice(0, 12).map((step) => isObj(step) ? { id: step.id, label: clip(step.label, 400), state: step.state, items: Array.isArray(step.items) ? step.items.slice(0, 12).map((item) => clip(item, 400)) : undefined } : null) : undefined,
    } : undefined,
    steps: Array.isArray(value.steps) ? value.steps.slice(-120).map((step) => isObj(step) ? {
      id: step.id, kind: step.kind, label: clip(step.label, 400), state: step.state,
      lead: clip(step.lead, 2000), queries: Array.isArray(step.queries) ? step.queries.slice(0, 12).map((q) => clip(q, 400)) : undefined,
    } : null) : undefined,
  }
  return out
}

/** Keep only the reader-facing conversation: text, identity, timings, tool
 *  indicators and research narration. Pure and idempotent. */
export function cleanMessage(value) {
  if (!isObj(value)) return null
  const out = { ...value }
  for (const key of ['full', 'sys', 'log', 'fx', 'ctx', 'alts', 'historyTokens', 'explicitTokens']) delete out[key]
  if (typeof out.t === 'string') out.t = clip(out.t, MAX_TEXT)
  if (typeof out.toolFinal === 'string') out.toolFinal = clip(out.toolFinal, MAX_TEXT)
  if (out.toolFinal === out.t) delete out.toolFinal
  if (typeof out.reasoning === 'string') out.reasoning = clip(out.reasoning, MAX_TOOL_TEXT)
  if (Array.isArray(out.att)) out.att = out.att.map(cleanAttachment).filter(Boolean)
  if (Array.isArray(out.toolRounds)) {
    out.toolRounds = out.toolRounds.slice(0, 64).map((round) => isObj(round)
      ? { ...round, text: clip(round.text, MAX_TOOL_TEXT), calls: Array.isArray(round.calls) ? round.calls.map(cleanCall).filter(Boolean) : [] }
      : null).filter(Boolean)
  }
  if (isObj(out.research)) out.research = cleanResearch(out.research)
  if (isObj(out.fork)) {
    out.fork = {
      ai: typeof out.fork.ai === 'number' ? out.fork.ai : 0,
      paths: Array.isArray(out.fork.paths) ? out.fork.paths.slice(0, 32).map((path) => (Array.isArray(path) ? path.slice(0, 500).map(cleanMessage).filter(Boolean) : [])) : [],
    }
  }
  return out
}

export function cleanChatMeta(value) {
  if (!isObj(value)) return {}
  const out = { ...value }
  delete out.msgs
  for (const key of ['title', 'name']) if (typeof out[key] === 'string') out[key] = clip(out[key], 400)
  return out
}

/** Strip chat data from a plaintext snapshot unless the slot opted in. */
export function sanitizePayload(payload, chatStore) {
  if (!isObj(payload) || typeof payload.encrypted === 'string') return payload
  const out = { ...payload }
  if (!chatStore) { out.chats = []; out.workspaces = {}; out.selectedRevision = {}; return out }
  if (Array.isArray(out.chats)) out.chats = out.chats.map((chat) => isObj(chat) ? { ...chat, msgs: Array.isArray(chat.msgs) ? chat.msgs.map(cleanMessage).filter(Boolean) : [] } : null).filter(Boolean)
  return out
}

const tooLarge = (message) => {
  const e = Error(message)
  e.code = 'too_large'
  e.status = 413
  return e
}

const cleanChatOps = (chats, chatStore) => {
  if (!chatStore || !isObj(chats)) return null
  const del = Array.isArray(chats.del) ? chats.del.filter((id) => typeof id === 'string') : []
  const rawOps = Array.isArray(chats.ops) ? chats.ops.filter((op) => isObj(op) && typeof op.id === 'string') : []
  if (rawOps.length > SYNC_MAX_CHAT_OPS) throw tooLarge('This sync change touches too many chats for one request. Try again after the chat store finishes its first sync.')
  const ops = []
  let messageCount = 0
  for (const raw of rawOps) {
    // `order` is null when the client only edited an existing message: the
    // server keeps the stored order and the message's position instead of
    // overwriting them with an empty list.
    const order = Array.isArray(raw.order) ? raw.order.filter((id) => typeof id === 'string') : null
    const ordOf = new Map((order ?? []).map((id, index) => [id, index]))
    const messages = []
    for (const entry of [...(Array.isArray(raw.update) ? raw.update : []), ...(Array.isArray(raw.add) ? raw.add : [])]) {
      if (!isObj(entry)) continue
      // New clients send `{ id, body }`; the body is a sealed envelope the
      // server must store verbatim. Older clients send the message object
      // itself, which is cleaned before storage.
      const sealed = isObj(entry.body) && typeof entry.body.encrypted === 'string'
      const body = sealed ? entry.body : cleanMessage(isObj(entry.body) ? entry.body : entry)
      const id = typeof entry.id === 'string' ? entry.id : (isObj(body) && typeof body.id === 'string' ? body.id : '')
      if (!body || !id) continue
      messageCount++
      if (messageCount > SYNC_MAX_MESSAGES_PER_PUSH) throw tooLarge('This sync change carries too many messages for one request.')
      messages.push({ id, body, ...(order ? { ord: ordOf.get(id) ?? 0 } : {}) })
    }
    const removed = Array.isArray(raw.del) ? raw.del.filter((id) => typeof id === 'string') : []
    ops.push({ id: raw.id, meta: raw.meta !== undefined ? cleanChatMeta(raw.meta) : null, order, messages, removed })
  }
  return { ops, del }
}

async function applyChatOps(backend, id, chats, seq, at) {
  const deletes = [...(chats.del ?? [])]
  const putChats = []
  const putMessages = []
  for (const op of chats.ops ?? []) {
    // A row is written only when something about the chat itself changed; an
    // edit to one existing message must not create chat-row egress.
    if (op.meta != null || op.order != null) putChats.push({ id: op.id, meta: op.meta ?? undefined, order: op.order ?? undefined, at })
    for (const message of op.messages) putMessages.push({ chatId: op.id, id: message.id, body: message.body, ord: message.ord, at })
    for (const msgId of op.removed) putMessages.push({ chatId: op.id, id: msgId, deleted: true, at })
  }
  if (deletes.length) await backend.delChats(id, deletes, seq)
  if (putChats.length) await backend.putChats(id, putChats.filter((chat) => !deletes.includes(chat.id)), seq)
  if (putMessages.length) await backend.putMessages(id, putMessages.filter((message) => !deletes.includes(message.chatId)), seq)
}

export async function handleSyncPush(req, backend) {
  const body = await readJson(req)
  const token = body.token || bearerToken(req)
  const { id, secret } = parseToken(token)
  return withSyncLock(id, () => pushLocked(body, id, secret, backend))
}

async function pushLocked(body, id, secret, backend) {
  const secretHash = sha256Hex(secret)
  const existing = await backend.meta(id)
  if (existing && !safeEqual(secretHash, String(existing.secretHash))) {
    const e = Error('Unknown or incorrect sync token.')
    e.code = 'bad_token'
    e.status = 401
    throw e
  }

  const currentSeq = asSeq(existing?.seq, 0)
  const requestedBase = Number.isInteger(body.baseSeq) && body.baseSeq >= 0 ? body.baseSeq : null
  const storeVersion = Number(body.storeVersion ?? body.payload?.storeVersion ?? 18) || 18
  const exportVersion = Number(body.exportVersion ?? body.payload?.v ?? 4) || 4
  const chatStore = body.chatStore === true
  // Only an explicit `false` is an instruction to erase stored conversations.
  // An older client that does not know the flag must not wipe a slot another
  // (newer) device filled.
  const chatsDisabled = body.chatStore === false
  const at = Number.isFinite(body.at) ? Number(body.at) : Date.now()
  const delta = body.delta
  const chatOps = cleanChatOps(body.chats, chatStore)

  if (body.payload != null) {
    const payload = body.payload
    if (!payload || typeof payload !== 'object') {
      const e = Error('Missing payload object.')
      e.code = 'bad_payload'
      e.status = 400
      throw e
    }
    // A full push is how a new device seeds a slot and how a client compacts a
    // long delta log. When it carries `baseSeq` it must be current, so a stale
    // full snapshot cannot overwrite newer work. Legacy clients that omit it
    // keep the old overwrite behavior.
    if (existing && requestedBase != null && requestedBase !== currentSeq) throw conflict(currentSeq)

    const nextSeq = currentSeq + 1
    await backend.putFull({
      id,
      secretHash,
      payload: sanitizePayload(payload, chatStore),
      storeVersion,
      exportVersion,
      seq: nextSeq,
      baseSeq: nextSeq,
      keepChats: !chatsDisabled,
    })
    if (chatStore && chatOps) await applyChatOps(backend, id, chatOps, nextSeq, at)
    return {
      ok: true,
      id,
      updatedAt: Date.now(),
      storeVersion,
      exportVersion,
      backend: backend.kind,
      seq: nextSeq,
      compact: false,
      chatStore,
    }
  }

  if (!existing) throw conflict(0)
  if (delta == null && body.chats == null) {
    const e = Error('Missing delta object.')
    e.code = 'bad_payload'
    e.status = 400
    throw e
  }
  if (requestedBase == null) {
    const e = Error('A delta push must include baseSeq.')
    e.code = 'bad_payload'
    e.status = 400
    throw e
  }
  if (delta != null && typeof delta !== 'object') {
    const e = Error('Missing delta object.')
    e.code = 'bad_payload'
    e.status = 400
    throw e
  }
  if (requestedBase !== currentSeq) throw conflict(currentSeq)

  const nextSeq = currentSeq + 1
  // A delta that carries chats from an older client is stored whole so that
  // client still reads its own changes back. New clients send chat rows
  // separately, which keeps the delta log small.
  const deltaToStore = chatStore && isObj(delta) && 'chats' in delta
    ? (() => { const { chats: _chats, ...rest } = delta; return rest })()
    : (delta ?? {})
  // A client that still packs chats inside its delta (rather than in `chats`)
  // has them extracted into per-message rows too, so both shapes converge on
  // the same store instead of one of them being dropped.
  const embeddedChats = chatStore && isObj(delta) && isObj(delta.chats) ? cleanChatOps(delta.chats, true) : null
  const storesSettingsDelta = Object.keys(deltaToStore).some((key) => key !== 'v' && key !== 'at')
  // `at` is the client's change timestamp (used for delete tombstones). The
  // row's updatedAt is server time, so a client with a skewed clock can never
  // make its own slot look expired.
  const deltaCount = storesSettingsDelta
    ? await backend.putDelta(id, nextSeq, deltaToStore, { storeVersion, exportVersion })
    : await backend.bump(id, nextSeq, { storeVersion, exportVersion })
  const chatChanges = chatOps ?? embeddedChats
  if (chatChanges) await applyChatOps(backend, id, chatChanges, nextSeq, at)
  // Turning the chat store off removes every stored conversation immediately.
  if (chatsDisabled && existing) await backend.delChatRows(id)
  return {
    ok: true,
    id,
    updatedAt: at,
    storeVersion,
    exportVersion,
    backend: backend.kind,
    seq: nextSeq,
    // A slot written before the storage split has no row in sync_snapshots;
    // ask the client to send one full snapshot now so the legacy payload and
    // its (possibly chat-bearing) log leave the database immediately.
    compact: deltaCount >= SYNC_DELTA_MAX || !(await backend.hasSnapshot?.(id) ?? true),
    chatStore,
  }
}

export async function handleSyncPull(req, backend) {
  const url = new URL(req.url || '/', 'http://localhost')
  let token = bearerToken(req)
  let sinceRaw = url.searchParams.get('since')
  // Token travels only in the Authorization header (or POST body): URLs end up
  // in logs and history. `since` is not a secret, so it may be a query param.
  if ((!token || sinceRaw == null) && req.method === 'POST') {
    const body = await readJson(req).catch(() => ({}))
    token = token || body.token || ''
    if (sinceRaw == null && body.since != null) sinceRaw = body.since
  }
  if (!token) { const e = Error('Missing sync token.'); e.code = 'bad_token'; e.status = 401; throw e }
  const { row, id } = await authRow(backend, token)

  const since = sinceRaw == null || sinceRaw === '' ? null : Number(sinceRaw)
  if (since != null && (!Number.isFinite(since) || since < 0)) {
    const e = Error('since must be a non-negative sequence number.')
    e.code = 'bad_request'
    e.status = 400
    throw e
  }

  const age = Number.isFinite(row.updatedAt) ? Date.now() - row.updatedAt : 0
  // Lazy expiry: prune a row that has been idle past its TTL instead of
  // keeping an abandoned payload (and its plaintext settings) forever.
  if (age > SYNC_ROW_TTL_MS) {
    try { await backend.del(id) } catch { /* best-effort prune */ }
    const e = Error('This sync token expired after 30 days of inactivity. Push from one of your devices to start fresh.')
    e.code = 'expired'
    e.status = 410
    throw e
  }
  // Touch rows that are halfway to expiry, so a device that only ever pulls
  // keeps the token alive while a genuinely abandoned one still expires.
  if (age > SYNC_ROW_TTL_MS / 2) {
    // Keep-alive only: never rewrite the row from this read, or a delta pushed
    // while we were reading it would be erased.
    try { await backend.touch?.(id, Date.now()) } catch { /* the next push will refresh */ }
  }

  const seq = asSeq(row.seq, 0)
  const baseSeq = asSeq(row.baseSeq, seq)
  const common = {
    ok: true,
    seq,
    baseSeq,
    storeVersion: row.storeVersion,
    exportVersion: row.exportVersion,
    updatedAt: row.updatedAt,
    backend: backend.kind,
  }

  // The common idle poll: nothing but this small metadata body.
  if (since != null && since === seq) return { ...common, upToDate: true }

  // No `since` means a newly linked device (or an explicit full refresh). A
  // client ahead of the slot cannot be served incrementally either.
  const full = since == null || since === 0 || since > seq || since < baseSeq
  if (full) {
    const snapshot = await backend.snapshot(id)
    // Deltas start at the snapshot's base; chat rows are never compacted, so a
    // device that is only behind the settings base still gets just the chats
    // it is missing.
    const entitySince = since != null && since > 0 && since < baseSeq ? since : 0
    const changes = await backend.changes(id, baseSeq, entitySince)
    return {
      ...common,
      full: true,
      payload: snapshot?.payload ?? {},
      ...(changes.deltas.length ? { deltas: changes.deltas } : {}),
      ...(changes.chats.length ? { chats: changes.chats } : {}),
      ...(changes.messages.length ? { messages: changes.messages } : {}),
    }
  }

  const changes = await backend.changes(id, since)
  return {
    ...common,
    ...(changes.deltas.length ? { deltas: changes.deltas } : {}),
    ...(changes.chats.length ? { chats: changes.chats } : {}),
    ...(changes.messages.length ? { messages: changes.messages } : {}),
  }
}
