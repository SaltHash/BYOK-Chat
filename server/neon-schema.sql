/* Neon schema for token-based sync. Payloads are end-to-end encrypted by the
 * client (see src/storage/backupCrypto.ts); row access is gated by the API
 * (service role only) + RLS deny-by-default, so anon/postgrest roles can never
 * read or write sync rows directly. Rows idle past the TTL in server/sync.mjs
 * are pruned lazily on read (Neon has no scheduler).
 *
 * The save is split by access pattern so an idle poll reads only the small
 * metadata row: `sync_states` (sequence + credential hash), `sync_snapshots`
 * (one encrypted settings snapshot), `sync_deltas` (one row per change),
 * `sync_chats` (one row per chat) and `sync_messages` (one row per message).
 * The API creates these on first use, so applying this file is optional.
 *
 * Apply with: psql "$DATABASE_URL" -f server/neon-schema.sql
 */

create table if not exists public.sync_states (
  id text primary key,
  secret_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  store_version integer not null default 18,
  export_version integer not null default 4,
  -- The full snapshot is at base_seq; seq is the newest change sequence and
  -- deltas holds the encrypted changes between the two.
  seq bigint not null default 0,
  base_seq bigint not null default 0,
  deltas jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.sync_states add column if not exists seq bigint not null default 0;
alter table public.sync_states add column if not exists base_seq bigint not null default 0;
alter table public.sync_states add column if not exists deltas jsonb not null default '[]'::jsonb;

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

/* Incremental storage. `sync_states.payload` and `sync_states.deltas` above
 * are the pre-split layout: they are kept for older builds and migrated to
 * sync_snapshots/sync_deltas on the first full pull, but new writes leave them
 * empty so a poll never transfers the save. */
create table if not exists public.sync_snapshots (
  id text primary key,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.sync_deltas (
  id text not null,
  seq bigint not null,
  delta jsonb not null,
  primary key (id, seq)
);

/* Opt-in chat storage: one row per chat (metadata, message-id order, delete
 * tombstone) and one row per message. Messages carry no attachments, tool
 * arguments or tool results; the API strips them again on write. */
create table if not exists public.sync_chats (
  id text not null,
  chat_id text not null,
  meta jsonb not null default '{}'::jsonb,
  ord jsonb not null default '[]'::jsonb,
  seq bigint not null default 0,
  at bigint not null default 0,
  deleted boolean not null default false,
  primary key (id, chat_id)
);

create table if not exists public.sync_messages (
  id text not null,
  chat_id text not null,
  msg_id text not null,
  body jsonb not null default '{}'::jsonb,
  ord integer not null default 0,
  seq bigint not null default 0,
  at bigint not null default 0,
  deleted boolean not null default false,
  primary key (id, chat_id, msg_id)
);

create index if not exists sync_deltas_id_seq_idx on public.sync_deltas (id, seq);
create index if not exists sync_chats_id_seq_idx on public.sync_chats (id, seq);
create index if not exists sync_messages_id_seq_idx on public.sync_messages (id, seq);

alter table public.sync_snapshots enable row level security;
alter table public.sync_deltas enable row level security;
alter table public.sync_chats enable row level security;
alter table public.sync_messages enable row level security;

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
