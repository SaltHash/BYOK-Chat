/* Sync persistence: Neon Postgres when DATABASE_URL is set, otherwise an
 * in-memory Map (dev/test). The API layer never touches SQL directly.
 * Secrets are never stored raw: only sha256(secret) is persisted.
 *
 * Storage is deliberately split by access pattern:
 *
 *   sync_states    one small metadata row per slot (no save data at all);
 *   sync_snapshots the latest encrypted settings snapshot;
 *   sync_deltas    one encrypted row per incremental change;
 *   sync_chats     one row per chat (metadata, order, tombstone);
 *   sync_messages  one row per message (body, position, tombstone).
 *
 * Reading the whole save on every poll is what made an idle device pull
 * megabytes from the database each time it checked in. Pulls and pushes now
 * touch the metadata row on the common path, the missed delta rows for an
 * incremental pull, and a single message row for a single message change. */

import { createHash, timingSafeEqual } from 'node:crypto'

export function sha256Hex(s) {
  return createHash('sha256').update(String(s)).digest('hex')
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b))
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const mem = new Map()
// The in-memory backend exists for local dev and for hosts without a
// database. Keep it bounded — by rows and by stored bytes — so anonymous
// pushes cannot grow it without limit.
const MEM_MAX_ROWS = 200
const MEM_MAX_BYTES = 64_000_000
let memBytes = 0

function jsonBytes(value) {
  try { return JSON.stringify(value ?? {}).length } catch { return 0 }
}

function recordBytes(row) {
  return jsonBytes(row.payload) + jsonBytes(row.deltas) +
    jsonBytes([...(row.chats?.values?.() ?? [])]) +
    jsonBytes([...(row.messages?.values?.() ?? [])])
}

function forget(id) {
  const entry = mem.get(id)
  if (entry === undefined) return
  mem.delete(id)
  memBytes -= entry.bytes
}

function newRecord(fields) {
  return {
    payload: {},
    deltas: [],
    storeVersion: 18,
    exportVersion: 4,
    seq: 0,
    baseSeq: 0,
    updatedAt: Date.now(),
    chats: new Map(),
    messages: new Map(),
    ...fields,
  }
}

const msgKey = (chatId, id) => `${chatId}\u0000${id}`

export function memStore() {
  return {
    kind: 'memory',
    /** Full read, kept for tests and migration tooling. Handlers use meta(). */
    async get(id) {
      const entry = mem.get(id)
      if (entry !== undefined) { mem.delete(id); mem.set(id, entry) } // refresh LRU order
      return entry?.row ?? null
    },
    async meta(id) {
      const row = mem.get(id)?.row
      if (!row) return null
      return {
        id: row.id,
        secretHash: row.secretHash,
        storeVersion: row.storeVersion,
        exportVersion: row.exportVersion,
        seq: row.seq,
        baseSeq: row.baseSeq,
        updatedAt: row.updatedAt,
        deltaCount: row.deltas.length,
      }
    },
    async snapshot(id) {
      const row = mem.get(id)?.row
      if (!row) return null
      return { payload: row.payload, baseSeq: row.baseSeq }
    },
    // The in-memory backend never has a pre-split row to migrate.
    async hasSnapshot() { return true },
    async changes(id, since = 0, entitySince = since) {
      const row = mem.get(id)?.row
      if (!row) return { deltas: [], chats: [], messages: [] }
      const deltaAfter = since == null ? 0 : Number(since)
      const entityAfter = entitySince == null ? 0 : Number(entitySince)
      return {
        deltas: row.deltas.filter((entry) => Number(entry.seq) > deltaAfter).map((entry) => ({ seq: entry.seq, delta: entry.delta })),
        chats: [...row.chats.values()].filter((chat) => Number(chat.seq) > entityAfter).map((chat) => ({ ...chat })),
        messages: [...row.messages.values()].filter((message) => Number(message.seq) > entityAfter).map((message) => ({ ...message })),
      }
    },
    async put(row) {
      forget(row.id)
      const next = newRecord({
        ...row,
        deltas: Array.isArray(row.deltas) ? row.deltas : [],
        chats: row.chats instanceof Map ? row.chats : new Map(),
        messages: row.messages instanceof Map ? row.messages : new Map(),
      })
      mem.set(row.id, { row: next, bytes: recordBytes(next) })
      memBytes += recordBytes(next)
      while (mem.size > MEM_MAX_ROWS || (memBytes > MEM_MAX_BYTES && mem.size > 1)) forget(mem.keys().next().value)
      return next
    },
    async putFull({ id, secretHash, payload, storeVersion, exportVersion, seq, baseSeq, keepChats }) {
      const previous = mem.get(id)?.row
      const next = newRecord({
        id,
        secretHash,
        payload,
        storeVersion,
        exportVersion,
        seq,
        baseSeq,
        updatedAt: Date.now(),
        deltas: [],
        chats: keepChats ? (previous?.chats ?? new Map()) : new Map(),
        messages: keepChats ? (previous?.messages ?? new Map()) : new Map(),
      })
      forget(id)
      mem.set(id, { row: next, bytes: recordBytes(next) })
      memBytes += recordBytes(next)
      while (mem.size > MEM_MAX_ROWS || (memBytes > MEM_MAX_BYTES && mem.size > 1)) forget(mem.keys().next().value)
      return next
    },
    async putDelta(id, seq, delta, meta = {}) {
      const entry = mem.get(id)
      if (!entry) return 0
      entry.row.deltas.push({ seq, delta })
      entry.row.seq = seq
      if (meta.storeVersion != null) entry.row.storeVersion = meta.storeVersion
      if (meta.exportVersion != null) entry.row.exportVersion = meta.exportVersion
      entry.row.updatedAt = meta.updatedAt ?? Date.now()
      memBytes -= entry.bytes
      entry.bytes = recordBytes(entry.row)
      memBytes += entry.bytes
      return entry.row.deltas.length
    },
    /** Chat-only push: advance the slot sequence without a settings delta. */
    async bump(id, seq, meta = {}) {
      const entry = mem.get(id)
      if (!entry) return 0
      entry.row.seq = seq
      if (meta.storeVersion != null) entry.row.storeVersion = meta.storeVersion
      if (meta.exportVersion != null) entry.row.exportVersion = meta.exportVersion
      entry.row.updatedAt = meta.updatedAt ?? Date.now()
      return entry.row.deltas.length
    },
    async putChats(id, rows, seq) {
      const entry = mem.get(id)
      if (!entry) return
      for (const row of rows) {
        const previous = entry.row.chats.get(row.id)
        entry.row.chats.set(row.id, {
          chatId: row.id,
          // A message-only change carries no metadata; keep the stored title
          // instead of replacing it with an empty object.
          meta: row.meta && typeof row.meta === 'object' ? row.meta : (previous?.meta ?? {}),
          order: Array.isArray(row.order) ? row.order : (previous?.order ?? []),
          seq,
          at: row.at ?? Date.now(),
          deleted: false,
          ...(row.deleted ? { deleted: true, meta: {}, order: [] } : {}),
        })
      }
      memBytes -= entry.bytes
      entry.bytes = recordBytes(entry.row)
      memBytes += entry.bytes
    },
    async putMessages(id, rows, seq) {
      const entry = mem.get(id)
      if (!entry) return
      for (const row of rows) {
        const key = msgKey(row.chatId, row.id)
        const previous = entry.row.messages.get(key)
        entry.row.messages.set(key, {
          chatId: row.chatId,
          id: row.id,
          body: row.deleted ? {} : (row.body ?? {}),
          // An edit that did not carry the chat's order keeps the stored
          // position; only an explicit ord moves the message.
          ord: Number.isInteger(row.ord) ? row.ord : (previous?.ord ?? 0),
          seq,
          at: row.at ?? Date.now(),
          deleted: row.deleted === true,
        })
      }
      memBytes -= entry.bytes
      entry.bytes = recordBytes(entry.row)
      memBytes += entry.bytes
    },
    async delChats(id, chatIds, seq) {
      const entry = mem.get(id)
      if (!entry) return
      for (const chatId of chatIds) {
        entry.row.chats.set(chatId, { chatId, meta: {}, order: [], seq, at: Date.now(), deleted: true })
        for (const key of [...entry.row.messages.keys()]) {
          if (entry.row.messages.get(key)?.chatId === chatId) entry.row.messages.delete(key)
        }
      }
      memBytes -= entry.bytes
      entry.bytes = recordBytes(entry.row)
      memBytes += entry.bytes
    },
    async delChatRows(id) {
      const entry = mem.get(id)
      if (!entry) return
      entry.row.chats.clear()
      entry.row.messages.clear()
      memBytes -= entry.bytes
      entry.bytes = recordBytes(entry.row)
      memBytes += entry.bytes
    },
    async del(id) {
      forget(id)
    },
    // TTL keep-alive only. Never rewrite the whole row from a stale read: a
    // pull must not be able to erase a delta that landed while it was reading.
    async touch(id, at = Date.now()) {
      const entry = mem.get(id)
      if (entry) entry.row.updatedAt = at
    },
  }
}

/* Connection strings must never reach logs: Neon echoes the offending string
 * when it cannot parse DATABASE_URL, which can include the password. Every
 * URL-shaped token is collapsed to `scheme://***`. */
export function redact(text, limit = 300) {
  return String(text ?? '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, (m) => `${m.slice(0, m.indexOf('://') + 3)}***`)
    .slice(0, limit)
}

let neonClient = null
async function neonStore(env = process.env) {
  if (!env.DATABASE_URL) return null
  if (neonClient) return neonClient
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.DATABASE_URL)
  let ready = null
  /* Create-on-first-use keeps a fresh deployment working without a manual
   * migration step. The original single-row table is upgraded in place: its
   * payload/deltas columns are kept for old builds (and lazily migrated on the
   * first full pull) but are no longer read on the poll path. A failure clears
   * the cached promise so the next request retries. */
  const ensure = () => {
    if (!ready) ready = (async () => {
      await sql`create table if not exists sync_states (id text primary key, secret_hash text not null, payload jsonb not null default '{}'::jsonb, store_version integer not null default 18, export_version integer not null default 4, updated_at timestamptz not null default now(), created_at timestamptz not null default now())`
      await sql`alter table sync_states add column if not exists seq bigint not null default 0`
      await sql`alter table sync_states add column if not exists base_seq bigint not null default 0`
      await sql`alter table sync_states add column if not exists deltas jsonb not null default '[]'::jsonb`
      await sql`create table if not exists sync_snapshots (id text primary key, payload jsonb not null default '{}'::jsonb)`
      await sql`create table if not exists sync_deltas (id text not null, seq bigint not null, delta jsonb not null, primary key (id, seq))`
      await sql`create table if not exists sync_chats (id text not null, chat_id text not null, meta jsonb not null default '{}'::jsonb, ord jsonb not null default '[]'::jsonb, seq bigint not null default 0, at bigint not null default 0, deleted boolean not null default false, primary key (id, chat_id))`
      await sql`create table if not exists sync_messages (id text not null, chat_id text not null, msg_id text not null, body jsonb not null default '{}'::jsonb, ord integer not null default 0, seq bigint not null default 0, at bigint not null default 0, deleted boolean not null default false, primary key (id, chat_id, msg_id))`
      await sql`create index if not exists sync_deltas_id_seq_idx on sync_deltas (id, seq)`
      await sql`create index if not exists sync_messages_id_seq_idx on sync_messages (id, seq)`
      await sql`create index if not exists sync_chats_id_seq_idx on sync_chats (id, seq)`
      await sql`alter table sync_states enable row level security`
      await sql`alter table sync_snapshots enable row level security`
      await sql`alter table sync_deltas enable row level security`
      await sql`alter table sync_chats enable row level security`
      await sql`alter table sync_messages enable row level security`
    })().catch((e) => { ready = null; throw e })
    return ready
  }

  const metaOf = (r) => r ? {
    id: r.id,
    secretHash: r.secret_hash,
    storeVersion: Number(r.store_version) || 18,
    exportVersion: Number(r.export_version) || 4,
    seq: Number(r.seq) || 0,
    baseSeq: Number(r.base_seq) || 0,
    updatedAt: Number(r.updated_ms) || 0,
    deltaCount: Number(r.delta_count) || 0,
  } : null

  neonClient = {
    kind: 'neon',
    async get(id) {
      await ensure()
      const rows = await sql`select id, secret_hash, store_version, export_version, seq, base_seq, deltas, payload, extract(epoch from updated_at) * 1000 as updated_ms from sync_states where id = ${id} limit 1`
      const r = rows[0]
      if (!r) return null
      let deltas = r.deltas
      if (typeof deltas === 'string') { try { deltas = JSON.parse(deltas) } catch { deltas = [] } }
      const snap = await sql`select payload from sync_snapshots where id = ${id} limit 1`
      return {
        ...metaOf(r),
        payload: snap[0]?.payload ?? r.payload ?? {},
        deltas: Array.isArray(deltas) ? deltas : [],
      }
    },
    async meta(id) {
      await ensure()
      const rows = await sql`select id, secret_hash, store_version, export_version, seq, base_seq, extract(epoch from updated_at) * 1000 as updated_ms, coalesce((select count(*) from sync_deltas d where d.id = sync_states.id), 0) as delta_count from sync_states where id = ${id} limit 1`
      return metaOf(rows[0])
    },
    async snapshot(id) {
      await ensure()
      const rows = await sql`select payload from sync_snapshots where id = ${id} limit 1`
      if (rows[0]) return { payload: rows[0].payload }
      // Rows written before the split kept their snapshot in sync_states.
      const legacy = await sql`select payload from sync_states where id = ${id} limit 1`
      return legacy[0] ? { payload: legacy[0].payload } : null
    },
    /** Whether the slot has a snapshot in the split table. A legacy slot has
     *  none until its next full push, which is how the migration completes. */
    async hasSnapshot(id) {
      await ensure()
      const rows = await sql`select 1 from sync_snapshots where id = ${id} limit 1`
      return rows.length > 0
    },
    async changes(id, since = 0, entitySince = since) {
      await ensure()
      // `since` cuts the settings log, `entitySince` cuts chat/message rows:
      // after a settings compaction the snapshot covers older deltas, but chat
      // rows are never compacted and can still be read from a lower sequence.
      const deltaFrom = since == null ? 0 : Number(since)
      const entityFrom = entitySince == null ? 0 : Number(entitySince)
      const [deltas, legacyRow, chats, messages] = await Promise.all([
        sql`select seq, delta from sync_deltas where id = ${id} and seq > ${deltaFrom} order by seq asc limit 500`,
        // A slot written before the split keeps its log in the metadata row.
        sql`select deltas from sync_states where id = ${id} limit 1`,
        sql`select chat_id, meta, ord, seq, at, deleted from sync_chats where id = ${id} and seq > ${entityFrom} order by seq asc limit 2000`,
        sql`select chat_id, msg_id, body, ord, seq, at, deleted from sync_messages where id = ${id} and seq > ${entityFrom} order by seq asc limit 5000`,
      ])
      let legacy = legacyRow[0]?.deltas
      if (typeof legacy === 'string') { try { legacy = JSON.parse(legacy) } catch { legacy = [] } }
      const rowsOut = deltas.map((r) => ({ seq: Number(r.seq) || 0, delta: r.delta }))
      const seen = new Set(rowsOut.map((row) => row.seq))
      const merged = [
        ...(Array.isArray(legacy) ? legacy : []).filter((row) => row && Number(row.seq) > deltaFrom && !seen.has(Number(row.seq))),
        ...rowsOut,
      ].sort((a, b) => Number(a.seq) - Number(b.seq))
      return {
        deltas: merged,
        chats: chats.map((r) => ({ chatId: r.chat_id, meta: r.meta ?? {}, order: Array.isArray(r.ord) ? r.ord : [], seq: Number(r.seq) || 0, at: Number(r.at) || 0, deleted: r.deleted === true })),
        messages: messages.map((r) => ({ chatId: r.chat_id, id: r.msg_id, body: r.body ?? {}, ord: Number(r.ord) || 0, seq: Number(r.seq) || 0, at: Number(r.at) || 0, deleted: r.deleted === true })),
      }
    },
    async putFull({ id, secretHash, payload, storeVersion, exportVersion, seq, baseSeq, keepChats }) {
      await ensure()
      await sql`insert into sync_states (id, secret_hash, payload, store_version, export_version, seq, base_seq, deltas, updated_at)
        values (${id}, ${secretHash}, '{}'::jsonb, ${storeVersion ?? 18}, ${exportVersion ?? 4}, ${seq ?? 0}, ${baseSeq ?? seq ?? 0}, '[]'::jsonb, now())
        on conflict (id) do update set secret_hash = excluded.secret_hash, payload = '{}'::jsonb,
          store_version = excluded.store_version, export_version = excluded.export_version,
          seq = excluded.seq, base_seq = excluded.base_seq, deltas = '[]'::jsonb, updated_at = now()`
      await sql`insert into sync_snapshots (id, payload) values (${id}, ${JSON.stringify(payload ?? {})}::jsonb)
        on conflict (id) do update set payload = excluded.payload`
      await sql`delete from sync_deltas where id = ${id}`
      if (!keepChats) {
        await sql`delete from sync_chats where id = ${id}`
        await sql`delete from sync_messages where id = ${id}`
      }
      return { id, seq, baseSeq: baseSeq ?? seq ?? 0 }
    },
    async putDelta(id, seq, delta, meta = {}) {
      await ensure()
      await sql`insert into sync_deltas (id, seq, delta) values (${id}, ${seq}, ${JSON.stringify(delta)}::jsonb)
        on conflict (id, seq) do update set delta = excluded.delta`
      const rows = await sql`update sync_states set seq = ${seq}, updated_at = now(),
        store_version = ${meta.storeVersion ?? 18}, export_version = ${meta.exportVersion ?? 4}
        where id = ${id} returning (select count(*) from sync_deltas d where d.id = ${id}) as delta_count`
      return Number(rows[0]?.delta_count) || 0
    },
    async bump(id, seq, meta = {}) {
      await ensure()
      const rows = await sql`update sync_states set seq = ${seq}, updated_at = now(),
        store_version = ${meta.storeVersion ?? 18}, export_version = ${meta.exportVersion ?? 4}
        where id = ${id} returning (select count(*) from sync_deltas d where d.id = ${id}) as delta_count`
      return Number(rows[0]?.delta_count) || 0
    },
    async putChats(id, rows, seq) {
      if (!rows.length) return
      await ensure()
      // Independent rows, one round trip's worth of latency rather than one
      // per chat (a first sync can carry hundreds).
      await Promise.all(rows.map((row) => {
        const deleted = row.deleted === true
        const at = row.at ?? Date.now()
        const hasOrder = Array.isArray(row.order)
        const hasMeta = row.meta && typeof row.meta === 'object'
        if (deleted) {
          return sql`insert into sync_chats (id, chat_id, meta, ord, seq, at, deleted)
            values (${id}, ${row.id}, '{}'::jsonb, '[]'::jsonb, ${seq}, ${at}, true)
            on conflict (id, chat_id) do update set meta = '{}'::jsonb, ord = '[]'::jsonb, seq = excluded.seq, at = excluded.at, deleted = true`
        }
        const orderJson = JSON.stringify(hasOrder ? row.order : [])
        if (hasOrder && hasMeta) {
          const metaJson = JSON.stringify(row.meta)
          return sql`insert into sync_chats (id, chat_id, meta, ord, seq, at, deleted)
            values (${id}, ${row.id}, ${metaJson}::jsonb, ${orderJson}::jsonb, ${seq}, ${at}, false)
            on conflict (id, chat_id) do update set meta = excluded.meta, ord = excluded.ord, seq = excluded.seq, at = excluded.at, deleted = false`
        }
        if (hasOrder) {
          return sql`insert into sync_chats (id, chat_id, meta, ord, seq, at, deleted)
            values (${id}, ${row.id}, '{}'::jsonb, ${orderJson}::jsonb, ${seq}, ${at}, false)
            on conflict (id, chat_id) do update set ord = excluded.ord, seq = excluded.seq, at = excluded.at, deleted = false`
        }
        // Metadata only: keep the stored order.
        const metaJson = JSON.stringify(row.meta)
        return sql`insert into sync_chats (id, chat_id, meta, ord, seq, at, deleted)
          values (${id}, ${row.id}, ${metaJson}::jsonb, '[]'::jsonb, ${seq}, ${at}, false)
          on conflict (id, chat_id) do update set meta = excluded.meta, seq = excluded.seq, at = excluded.at, deleted = false`
      }))
    },
    async putMessages(id, rows, seq) {
      if (!rows.length) return
      await ensure()
      await Promise.all(rows.map((row) => {
        const deleted = row.deleted === true
        const bodyJson = JSON.stringify(deleted ? {} : (row.body ?? {}))
        const at = row.at ?? Date.now()
        if (Number.isInteger(row.ord)) {
          return sql`insert into sync_messages (id, chat_id, msg_id, body, ord, seq, at, deleted)
            values (${id}, ${row.chatId}, ${row.id}, ${bodyJson}::jsonb, ${row.ord}, ${seq}, ${at}, ${deleted})
            on conflict (id, chat_id, msg_id) do update set body = excluded.body, ord = excluded.ord, seq = excluded.seq, at = excluded.at, deleted = excluded.deleted`
        }
        // No position in this change: keep the stored one.
        return sql`insert into sync_messages (id, chat_id, msg_id, body, ord, seq, at, deleted)
          values (${id}, ${row.chatId}, ${row.id}, ${bodyJson}::jsonb, 0, ${seq}, ${at}, ${deleted})
          on conflict (id, chat_id, msg_id) do update set body = excluded.body, seq = excluded.seq, at = excluded.at, deleted = excluded.deleted`
      }))
    },
    async delChats(id, chatIds, seq) {
      if (!chatIds.length) return
      await ensure()
      const at = Date.now()
      await Promise.all([
        ...chatIds.map((chatId) => sql`insert into sync_chats (id, chat_id, meta, ord, seq, at, deleted)
          values (${id}, ${chatId}, '{}'::jsonb, '[]'::jsonb, ${seq}, ${at}, true)
          on conflict (id, chat_id) do update set meta = '{}'::jsonb, ord = '[]'::jsonb, seq = excluded.seq, at = excluded.at, deleted = true`),
        // A chat tombstone carries the deletion; its message bodies are no
        // longer needed by any device that pulls the tombstone.
        ...chatIds.map((chatId) => sql`delete from sync_messages where id = ${id} and chat_id = ${chatId}`),
      ])
    },
    async delChatRows(id) {
      await ensure()
      await sql`delete from sync_chats where id = ${id}`
      await sql`delete from sync_messages where id = ${id}`
    },
    async del(id) {
      await ensure()
      await sql`delete from sync_deltas where id = ${id}`
      await sql`delete from sync_snapshots where id = ${id}`
      await sql`delete from sync_chats where id = ${id}`
      await sql`delete from sync_messages where id = ${id}`
      await sql`delete from sync_states where id = ${id}`
    },
    async touch(id, at = Date.now()) {
      await ensure()
      await sql`update sync_states set updated_at = to_timestamp(${Math.floor(at / 1000)}) where id = ${id}`
    },
  }
  return neonClient
}

/* Whether the Neon backend is on. `SYNC_BACKEND` wins when it is set: "memory"
 * forces the in-memory store, "neon" forces the database. When it is unset,
 * the presence of DATABASE_URL decides, so local `npm run dev` (which loads
 * `.env`) and any self-hosted Node host use Neon with only a connection string,
 * while a deployment without the secret stays in memory. */
export function neonSyncEnabled(env = process.env) {
  const mode = String(env?.SYNC_BACKEND ?? '').trim().toLowerCase()
  if (mode === 'memory') return false
  if (mode === 'neon') return true
  return Boolean(String(env?.DATABASE_URL ?? '').trim())
}

export async function syncBackend(env = process.env) {
  if (!neonSyncEnabled(env)) return memStore()
  if (!String(env?.DATABASE_URL || '').trim()) return memStore()
  try {
    return await neonStore(env)
  } catch (error) {
    // DATABASE_URL is set: silently falling back to the in-memory store here
    // would split sync data across devices, so surface the failure instead.
    const e = Error(`Sync database is unavailable: ${redact(error?.message)}`)
    e.code = 'sync_unavailable'
    e.status = 503
    console.error(`[sync] database unavailable: ${redact(error?.message)}`)
    throw e
  }
}

export { safeEqual }
