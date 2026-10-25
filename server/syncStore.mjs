/* Sync persistence: Neon Postgres when DATABASE_URL is set, otherwise an
 * in-memory Map (dev/test). The API layer never touches SQL directly.
 * Secrets are never stored raw: only sha256(secret) is persisted. */
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
// database. Keep it bounded — by rows and by stored payload bytes — so
// anonymous pushes cannot grow it without limit (and cannot exhaust a Worker
// isolate with a few maximum-size payloads).
const MEM_MAX_ROWS = 200
const MEM_MAX_BYTES = 64_000_000
let memBytes = 0

function payloadBytes(payload) {
  try { return JSON.stringify(payload ?? {}).length } catch { return 0 }
}

function forget(id) {
  const entry = mem.get(id)
  if (entry === undefined) return
  mem.delete(id)
  memBytes -= entry.bytes
}

function memStore() {
  return {
    kind: 'memory',
    async get(id) {
      const entry = mem.get(id)
      if (entry !== undefined) { mem.delete(id); mem.set(id, entry) } // refresh LRU order
      return entry?.row ?? null
    },
    async put(row) {
      forget(row.id)
      // Deltas are part of the stored save; count them too so a client cannot
      // grow a row past the memory budget by pushing many small deltas.
      const bytes = payloadBytes(row.payload) + payloadBytes(row.deltas)
      mem.set(row.id, { row, bytes })
      memBytes += bytes
      while (mem.size > MEM_MAX_ROWS || (memBytes > MEM_MAX_BYTES && mem.size > 1)) forget(mem.keys().next().value)
      return row
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
  neonClient = {
    kind: 'neon',
    async get(id) {
      const rows = await sql`select id, secret_hash, payload, store_version, export_version, seq, base_seq, deltas, updated_at from sync_states where id = ${id} limit 1`
      const r = rows[0]
      if (!r) return null
      let deltas = r.deltas
      if (typeof deltas === 'string') { try { deltas = JSON.parse(deltas) } catch { deltas = [] } }
      return { id: r.id, secretHash: r.secret_hash, payload: r.payload, storeVersion: r.store_version, exportVersion: r.export_version, seq: Number(r.seq) || 0, baseSeq: Number(r.base_seq) || 0, deltas: Array.isArray(deltas) ? deltas : [], updatedAt: new Date(r.updated_at).getTime() }
    },
    async put(row) {
      await sql`insert into sync_states (id, secret_hash, payload, store_version, export_version, seq, base_seq, deltas, updated_at)
        values (${row.id}, ${row.secretHash}, ${JSON.stringify(row.payload ?? {})}, ${row.storeVersion ?? 18}, ${row.exportVersion ?? 4}, ${row.seq ?? 0}, ${row.baseSeq ?? 0}, ${JSON.stringify(row.deltas ?? [])}, to_timestamp(${Math.floor((row.updatedAt ?? Date.now()) / 1000)}))
        on conflict (id) do update set secret_hash = excluded.secret_hash, payload = excluded.payload,
          store_version = excluded.store_version, export_version = excluded.export_version,
          seq = excluded.seq, base_seq = excluded.base_seq, deltas = excluded.deltas, updated_at = excluded.updated_at`
      return row
    },
    async del(id) {
      await sql`delete from sync_states where id = ${id}`
    },
    async touch(id, at = Date.now()) {
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

export { safeEqual, memStore }
