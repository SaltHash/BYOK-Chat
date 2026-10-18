/* Public read-only chat snapshots behind the Share button.
 *
 * Unlike sync, share rows are readable by anyone holding the link, so they
 * store exactly what sanitizeSharedChat allowed through (title, message text,
 * byline) and nothing else: no keys, no system prompts, no tool payloads, no
 * attachments. Neon is used when DATABASE_URL is set (the table is created on
 * first use), otherwise a bounded in-memory map backs local development. */
import { redact } from './syncStore.mjs'

const MEM_MAX_ROWS = 300
const mem = new Map()

export function memStore() {
  return {
    kind: 'memory',
    async get(id) {
      const entry = mem.get(id)
      if (entry === undefined) return null
      mem.delete(id); mem.set(id, entry) // refresh LRU order
      return entry
    },
    async put(id, payload) {
      mem.delete(id)
      mem.set(id, { payload, createdAt: Date.now() })
      while (mem.size > MEM_MAX_ROWS) mem.delete(mem.keys().next().value)
      return true
    },
  }
}

let neonClient = null
async function neonStore(env = process.env) {
  if (!env.DATABASE_URL) return null
  if (neonClient) return neonClient
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(env.DATABASE_URL)
  let ready = null
  const ensure = () => {
    // Create-on-first-use keeps a fresh deployment working without a manual
    // migration step. RLS is left enabled with no permissive policies, so only
    // the service role (this API) can read the table. A failure clears the
    // cached promise so the next request retries instead of replaying the
    // same rejection forever.
    if (!ready) ready = (async () => {
      await sql`create table if not exists shared_chats (id text primary key, payload jsonb not null, created_at timestamptz not null default now())`
      await sql`alter table shared_chats enable row level security`
    })().catch((e) => { ready = null; throw e })
    return ready
  }
  neonClient = {
    kind: 'neon',
    async get(id) {
      await ensure()
      const rows = await sql`select payload, extract(epoch from created_at) * 1000 as created_ms from shared_chats where id = ${id} limit 1`
      const r = rows[0]
      if (!r) return null
      return { payload: r.payload, createdAt: Number(r.created_ms) || 0 }
    },
    async put(id, payload) {
      await ensure()
      await sql`insert into shared_chats (id, payload, created_at) values (${id}, ${JSON.stringify(payload)}::jsonb, now())
        on conflict (id) do update set payload = excluded.payload, created_at = now()`
      return true
    },
  }
  return neonClient
}

export async function shareBackend(env = process.env) {
  if (!String(env?.DATABASE_URL || '').trim()) return memStore()
  try {
    return await neonStore(env)
  } catch (error) {
    const e = Error(`Share storage is unavailable: ${redact(error?.message)}`)
    e.code = 'share_unavailable'
    e.status = 503
    console.error(`[share] database unavailable: ${redact(error?.message)}`)
    throw e
  }
}
