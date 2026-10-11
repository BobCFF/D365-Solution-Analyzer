-- D365 Solution Analyzer: initial schema. All tables are owner-scoped with RLS.

create table public.solutions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unique_name text not null,
  friendly_name text not null,
  version text not null,
  managed boolean not null,
  parent_solution_name text,
  publisher_unique_name text,
  publisher_prefix text,
  file_name text not null,
  file_sha256 text not null,
  parsed jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, unique_name, version, managed)
);

create table public.solution_components (
  id bigint generated always as identity primary key,
  solution_id uuid not null references public.solutions(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  component_type int not null,
  type_name text not null,
  component_key text not null,
  display_name text,
  behavior int,
  details jsonb
);
create index on public.solution_components (solution_id);
create index on public.solution_components (owner_id, component_type, lower(component_key));

create table public.analysis_findings (
  id bigint generated always as identity primary key,
  solution_id uuid not null references public.solutions(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rule_id text not null,
  severity text not null check (severity in ('error','warning','info')),
  title text not null,
  detail text not null,
  remediation text,
  component_key text,
  analyzed_at timestamptz not null default now()
);
create index on public.analysis_findings (solution_id);

create table public.comparisons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  left_solution_id uuid not null references public.solutions(id) on delete cascade,
  right_solution_id uuid not null references public.solutions(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- Audit trail of actions taken in the app (uploads, analyses, comparisons, deletes).
create table public.change_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null,
  entity text not null,
  entity_id text,
  summary text not null,
  app_version text,
  created_at timestamptz not null default now()
);
create index on public.change_log (owner_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['solutions','solution_components','analysis_findings','comparisons','change_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s_owner_select" on public.%I for select using (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_owner_insert" on public.%I for insert with check (owner_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_owner_delete" on public.%I for delete using (owner_id = (select auth.uid()))', t, t);
  end loop;
end $$;
