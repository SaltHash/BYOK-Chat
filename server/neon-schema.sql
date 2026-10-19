/* Neon schema for token-based sync. Payloads are end-to-end encrypted by the
 * client (see src/storage/backupCrypto.ts); row access is gated by the API
 * (service role only) + RLS deny-by-default, so anon/postgrest roles can never
 * read or write sync rows directly. Rows idle past the TTL in server/sync.mjs
 * are pruned lazily on read (Neon has no scheduler).
 *
 * Apply with: psql "$DATABASE_URL" -f server/neon-schema.sql
 */

create table if not exists public.sync_states (
  id text primary key,
  secret_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  store_version integer not null default 18,
  export_version integer not null default 4,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.sync_states enable row level security;

-- Deny everything to anon/authenticated; only the service role (used by the
-- Node API via DATABASE_URL) bypasses RLS. No permissive policies = closed.
drop policy if exists "deny all anon" on public.sync_states;
drop policy if exists "deny all authenticated" on public.sync_states;

-- Optional explicit deny policies (defense in depth; RLS default-deny already
-- blocks without a USING clause, but these document intent).
create policy "deny all anon"
  on public.sync_states for all
  to anon
  using (false)
  with check (false);

create policy "deny all authenticated"
  on public.sync_states for all
  to authenticated
  using (false)
  with check (false);

create index if not exists sync_states_updated_at_idx on public.sync_states (updated_at desc);

/* Public read-only chat shares (the Share button). The API creates this table
 * on first use too (including the private columns), so applying this file is
 * optional; keeping it here documents the shape and the same deny-by-default
 * posture. */
create table if not exists public.shared_chats (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  is_private boolean not null default false,
  token_hash text
);

-- Upgrade a table created before private shares existed.
alter table public.shared_chats add column if not exists is_private boolean not null default false;
alter table public.shared_chats add column if not exists token_hash text;

alter table public.shared_chats enable row level security;

drop policy if exists "deny all anon" on public.shared_chats;
drop policy if exists "deny all authenticated" on public.shared_chats;

create policy "deny all anon"
  on public.shared_chats for all
  to anon
  using (false)
  with check (false);

create policy "deny all authenticated"
  on public.shared_chats for all
  to authenticated
  using (false)
  with check (false);

create index if not exists shared_chats_created_at_idx on public.shared_chats (created_at desc);
