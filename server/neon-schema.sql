/* Neon schema for token-based sync. Unencrypted payloads by design (v1);
 * row access is gated by the API (service role only) + RLS deny-by-default
 * so anon/postgrest roles can never read or write sync rows directly.
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
