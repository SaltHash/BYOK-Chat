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

function memStore() {
  return {
    kind: 'memory',
    async get(id) { return mem.get(id) ?? null },
    async put(row) { mem.set(row.id, row); return row },
  }
}

let neonClient = null
async function neonStore() {
  if (!process.env.DATABASE_URL) return null
  if (neonClient) return neonClient
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL)
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

export async function syncBackend() {
  return (await neonStore().catch(() => null)) ?? memStore()
}

export { safeEqual, memStore }
