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
      const bytes = payloadBytes(row.payload)
      mem.set(row.id, { row, bytes })
      memBytes += bytes
      while (mem.size > MEM_MAX_ROWS || (memBytes > MEM_MAX_BYTES && mem.size > 1)) forget(mem.keys().next().value)
      return row
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
      const rows = await sql`select id, secret_hash, payload, store_version, export_version, updated_at from sync_states where id = ${id} limit 1`
      const r = rows[0]
      if (!r) return null
      return { id: r.id, secretHash: r.secret_hash, payload: r.payload, storeVersion: r.store_version, exportVersion: r.export_version, updatedAt: new Date(r.updated_at).getTime() }
    },
    async put(row) {
      await sql`insert into sync_states (id, secret_hash, payload, store_version, export_version, updated_at)
        values (${row.id}, ${row.secretHash}, ${JSON.stringify(row.payload ?? {})}, ${row.storeVersion ?? 18}, ${row.exportVersion ?? 4}, to_timestamp(${Math.floor((row.updatedAt ?? Date.now()) / 1000)}))
        on conflict (id) do update set secret_hash = excluded.secret_hash, payload = excluded.payload,
          store_version = excluded.store_version, export_version = excluded.export_version, updated_at = excluded.updated_at`
      return row
    },
  }
  return neonClient
}

export async function syncBackend(env = process.env) {
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
