-- Saved Dynamics 365 / Dataverse connections (v0.12.0). Safe to run more than once; does not touch existing data.
--
-- Everything about a connection (name, environment URL, tenant id, client id and the client SECRET) is one sealed
-- value (AES-256-GCM, per-user key, see src/lib/server/crypto.ts). The CHECK makes plaintext impossible to store.
-- The secret is only ever decrypted inside server routes that call Dataverse; it is never sent to the browser.

create table if not exists public.d365_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  config text not null check (config like 'enc:v1:%'),
  created_at timestamptz not null default now()
);
create index if not exists d365_connections_owner on public.d365_connections (owner_id, created_at desc);

alter table public.d365_connections enable row level security;
alter table public.d365_connections force row level security;
drop policy if exists "d365_connections_owner_select" on public.d365_connections;
drop policy if exists "d365_connections_owner_insert" on public.d365_connections;
drop policy if exists "d365_connections_owner_delete" on public.d365_connections;
create policy "d365_connections_owner_select" on public.d365_connections for select to authenticated using (owner_id = (select auth.uid()));
create policy "d365_connections_owner_insert" on public.d365_connections for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "d365_connections_owner_delete" on public.d365_connections for delete to authenticated using (owner_id = (select auth.uid()));
revoke all on public.d365_connections from anon, public;
revoke all on public.d365_connections from authenticated;
grant select, insert, delete on public.d365_connections to authenticated;

-- the audit log gains two actions
alter table public.change_log drop constraint if exists change_log_action_check;
alter table public.change_log add constraint change_log_action_check
  check (action in ('upload','analyze','compare','delete','purge','connect','verify'));
