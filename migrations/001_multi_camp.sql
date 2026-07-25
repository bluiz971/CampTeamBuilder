-- ============================================================
-- Migration 001 — Multi-camp (URL slug) support
-- Run once in Supabase → SQL Editor.
--
-- WHAT EXISTS TODAY (important):
--   • camps are identified by text: players.camp_code, camp_live.code
--   • teams / schedule / scores / stations are NOT separate tables —
--     they live inside camp_live.data (jsonb) or admin localStorage.
-- So this migration only adds camp_id to: camps (new), players, camp_live.
--
-- DESIGN NOTES (please approve):
--   1. Seed: one camps row per DISTINCT existing slug (from players.camp_code
--      ∪ camp_live.code), not a single catch-all seed — so georgia-2026 and
--      mid-atlantic-2026 both keep their data. If no rows exist, seeds
--      "georgia-2026" as a placeholder.
--   2. Keeps players.camp_code and camp_live.code as denormalized slug
--      mirrors of camps.slug for a smooth HTML cutover (queries can use
--      either during the transition). New source of truth = camps.id.
--   3. RLS: anon can read only rows whose camp status = 'active'.
--      Authenticated coaches can read/write all camps.
--   4. Deleting a camp cascades to its players + camp_live row.
-- ============================================================

begin;

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. camps
-- ------------------------------------------------------------
create table if not exists public.camps (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,
  name       text not null,
  location   text,
  camp_date  date,
  status     text not null default 'draft'
               check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  constraint camps_slug_unique unique (slug),
  constraint camps_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists camps_slug_idx on public.camps (slug);
create index if not exists camps_status_idx on public.camps (status);

-- ------------------------------------------------------------
-- 2. Seed camps from every distinct slug already in use
-- ------------------------------------------------------------
insert into public.camps (slug, name, location, camp_date, status)
select
  s.slug,
  initcap(replace(s.slug, '-', ' ')) as name,
  null::text as location,
  null::date as camp_date,
  'active'::text as status
from (
  select distinct lower(trim(camp_code)) as slug
  from public.players
  where camp_code is not null and trim(camp_code) <> ''
  union
  select distinct lower(trim(code)) as slug
  from public.camp_live
  where code is not null and trim(code) <> ''
) s
where s.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
on conflict (slug) do nothing;

-- Placeholder if the project is empty
insert into public.camps (slug, name, status)
select 'georgia-2026', 'Georgia 2026', 'active'
where not exists (select 1 from public.camps)
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- 3. players.camp_id
-- ------------------------------------------------------------
alter table public.players
  add column if not exists camp_id uuid;

update public.players p
set camp_id = c.id
from public.camps c
where p.camp_id is null
  and lower(trim(p.camp_code)) = c.slug;

-- Orphans (bad/missing camp_code) → first active camp
update public.players
set camp_id = (select id from public.camps order by created_at asc limit 1)
where camp_id is null;

alter table public.players
  alter column camp_id set not null;

do $$ begin
  alter table public.players
    add constraint players_camp_id_fkey
    foreign key (camp_id) references public.camps(id) on delete cascade;
exception when duplicate_object then null;
end $$;

create index if not exists players_camp_id_idx on public.players (camp_id);

-- Keep camp_code in sync with slug (denormalized helper for old clients)
update public.players p
set camp_code = c.slug
from public.camps c
where p.camp_id = c.id
  and p.camp_code is distinct from c.slug;

-- ------------------------------------------------------------
-- 4. camp_live.camp_id
-- ------------------------------------------------------------
alter table public.camp_live
  add column if not exists camp_id uuid;

update public.camp_live cl
set camp_id = c.id
from public.camps c
where cl.camp_id is null
  and lower(trim(cl.code)) = c.slug;

update public.camp_live
set camp_id = (select id from public.camps order by created_at asc limit 1)
where camp_id is null;

-- One live blob per camp
do $$ begin
  alter table public.camp_live
    add constraint camp_live_camp_id_unique unique (camp_id);
exception when duplicate_object then null;
end $$;

alter table public.camp_live
  alter column camp_id set not null;

do $$ begin
  alter table public.camp_live
    add constraint camp_live_camp_id_fkey
    foreign key (camp_id) references public.camps(id) on delete cascade;
exception when duplicate_object then null;
end $$;

create index if not exists camp_live_camp_id_idx on public.camp_live (camp_id);

update public.camp_live cl
set code = c.slug
from public.camps c
where cl.camp_id = c.id
  and cl.code is distinct from c.slug;

-- ------------------------------------------------------------
-- 5. RLS — camps
-- ------------------------------------------------------------
alter table public.camps enable row level security;

drop policy if exists "Public read active camps" on public.camps;
drop policy if exists "Authenticated read camps" on public.camps;
drop policy if exists "Authenticated insert camps" on public.camps;
drop policy if exists "Authenticated update camps" on public.camps;
drop policy if exists "Authenticated delete camps" on public.camps;

-- Parents / stations: only active camps (lookup by slug)
create policy "Public read active camps" on public.camps
  for select to anon, authenticated
  using (status = 'active');

-- Coaches signed in: full CRUD (draft + archived visible in admin)
create policy "Authenticated read all camps" on public.camps
  for select to authenticated
  using (true);

create policy "Authenticated insert camps" on public.camps
  for insert to authenticated
  with check (true);

create policy "Authenticated update camps" on public.camps
  for update to authenticated
  using (true)
  with check (true);

create policy "Authenticated delete camps" on public.camps
  for delete to authenticated
  using (true);

-- ------------------------------------------------------------
-- 6. RLS — players (replace open policies with camp-scoped ones)
-- ------------------------------------------------------------
drop policy if exists "Public read players" on public.players;
drop policy if exists "Authenticated insert players" on public.players;
drop policy if exists "Authenticated update players" on public.players;
drop policy if exists "Authenticated delete players" on public.players;
drop policy if exists "Public read active camp players" on public.players;
drop policy if exists "Authenticated insert camp players" on public.players;
drop policy if exists "Authenticated update camp players" on public.players;
drop policy if exists "Authenticated delete camp players" on public.players;

create policy "Public read active camp players" on public.players
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.camps c
      where c.id = players.camp_id and c.status = 'active'
    )
  );

create policy "Authenticated insert camp players" on public.players
  for insert to authenticated
  with check (
    exists (select 1 from public.camps c where c.id = camp_id)
  );

create policy "Authenticated update camp players" on public.players
  for update to authenticated
  using (true)
  with check (
    exists (select 1 from public.camps c where c.id = camp_id)
  );

create policy "Authenticated delete camp players" on public.players
  for delete to authenticated
  using (true);

-- ------------------------------------------------------------
-- 7. RLS — camp_live
-- ------------------------------------------------------------
drop policy if exists "Public read" on public.camp_live;
drop policy if exists "Authenticated write" on public.camp_live;
drop policy if exists "Authenticated update" on public.camp_live;
drop policy if exists "Authenticated delete" on public.camp_live;
drop policy if exists "Public read active camp_live" on public.camp_live;
drop policy if exists "Authenticated insert camp_live" on public.camp_live;
drop policy if exists "Authenticated update camp_live" on public.camp_live;
drop policy if exists "Authenticated delete camp_live" on public.camp_live;

create policy "Public read active camp_live" on public.camp_live
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.camps c
      where c.id = camp_live.camp_id and c.status = 'active'
    )
  );

create policy "Authenticated insert camp_live" on public.camp_live
  for insert to authenticated
  with check (
    exists (select 1 from public.camps c where c.id = camp_id)
  );

create policy "Authenticated update camp_live" on public.camp_live
  for update to authenticated
  using (true)
  with check (
    exists (select 1 from public.camps c where c.id = camp_id)
  );

create policy "Authenticated delete camp_live" on public.camp_live
  for delete to authenticated
  using (true);

-- ------------------------------------------------------------
-- 8. Grants (Data API)
-- ------------------------------------------------------------
grant select on public.camps to anon, authenticated;
grant insert, update, delete on public.camps to authenticated;

grant select on public.players to anon, authenticated;
grant insert, update, delete on public.players to authenticated;

grant select on public.camp_live to anon, authenticated;
grant insert, update, delete on public.camp_live to authenticated;

commit;

-- ============================================================
-- VERIFY (optional — run after migration)
-- ============================================================
-- select slug, name, status, id from camps order by created_at;
-- select camp_id, count(*) from players group by camp_id;
-- select camp_id, code from camp_live;
-- ============================================================
