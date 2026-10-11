-- Encrypted storage (v0.4.0).
--
-- Every content-bearing value is now sealed by the application (AES-256-GCM, per-user key; see
-- src/lib/server/crypto.ts) BEFORE it reaches Postgres, so database access, backups and logs only ever contain
-- ciphertext. CHECK constraints below make it impossible to store plaintext in those columns by mistake.
--
-- NOTE: this replaces the plaintext tables from 20261011000000_init.sql. Rows written by v0.1-v0.3 cannot satisfy
-- the new constraints and are dropped; re-upload the solution packages after applying. (Nothing had been deployed.)

drop table if exists public.comparisons cascade;
drop table if exists public.analysis_findings cascade;
drop table if exists public.solution_components cascade;
drop table if exists public.change_log cascade;
drop table if exists public.solutions cascade;

create table public.solutions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- HMAC(user key, name|version|managed): lets us reject duplicates without storing names in the clear
  unique_key text not null check (unique_key ~ '^[0-9a-f]{64}$'),
  -- sealed JSON: unique name, display name, version, managed flag, patch parent, publisher, file name
  meta text not null check (meta like 'enc:v1:%'),
  -- sealed JSON: the full parsed solution model
  parsed text not null check (parsed like 'enc:v1:%'),
  -- keyed hash of the uploaded file (not a plain SHA-256, so it cannot be matched against known files)
  file_hmac text not null check (file_hmac ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (owner_id, unique_key)
);

create table public.analysis_findings (
  id bigint generated always as identity primary key,
  solution_id uuid not null references public.solutions(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rule_id text not null check (rule_id ~ '^[A-Z]{2,6}[0-9]{3}$'),
  severity text not null check (severity in ('error','warning','info')),
  -- sealed JSON: title, detail, remediation, component key (these name customer components)
  payload text not null check (payload like 'enc:v1:%'),
  analyzed_at timestamptz not null default now()
);
create index on public.analysis_findings (solution_id);

create table public.comparisons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  left_solution_id uuid not null references public.solutions(id) on delete cascade,
  right_solution_id uuid not null references public.solutions(id) on delete cascade,
  result text not null check (result like 'enc:v1:%'),
  created_at timestamptz not null default now()
);

create table public.change_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null check (action in ('upload','analyze','compare','delete','purge')),
  entity text not null,
  entity_id text,
  summary text not null check (summary like 'enc:v1:%'),
  app_version text,
  created_at timestamptz not null default now()
);
create index on public.change_log (owner_id, created_at desc);

-- Row-level security: owner only, enforced even for the table owner; no UPDATE path exists (rows are immutable).
do $$
declare t text;
begin
  foreach t in array array['solutions','analysis_findings','comparisons','change_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy "%s_owner_select" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_owner_insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_owner_delete" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t, t);
    -- least privilege: anonymous and public roles get nothing; signed-in users get only what the policies allow
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema public from anon, public;
