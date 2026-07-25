-- ============================================================
-- Migration 002 — Fix camp_live / players write RLS after multi-camp
-- Run once in Supabase → SQL Editor if Publish sync says
-- "Session expired or not authorized" right after a fresh sign-in.
--
-- Cause: upsert was blocked by RLS (Postgres error 42501), which
-- PostgREST often returns as HTTP 401 — the admin UI misread that
-- as an expired login.
-- ============================================================

begin;

-- Allow signed-in coaches to see every camp_live row (needed for upsert
-- conflict detection). Parents/stations still only see active camps.
drop policy if exists "Authenticated read all camp_live" on public.camp_live;
create policy "Authenticated read all camp_live" on public.camp_live
  for select to authenticated
  using (true);

-- Keep public/anon read limited to active camps
drop policy if exists "Public read active camp_live" on public.camp_live;
create policy "Public read active camp_live" on public.camp_live
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.camps c
      where c.id = camp_live.camp_id and c.status = 'active'
    )
  );

-- Simplify coach writes (FK on camp_id still enforces a real camp)
drop policy if exists "Authenticated insert camp_live" on public.camp_live;
drop policy if exists "Authenticated update camp_live" on public.camp_live;
drop policy if exists "Authenticated delete camp_live" on public.camp_live;
drop policy if exists "Authenticated write" on public.camp_live;
drop policy if exists "Authenticated update" on public.camp_live;
drop policy if exists "Authenticated delete" on public.camp_live;

create policy "Authenticated insert camp_live" on public.camp_live
  for insert to authenticated
  with check (true);

create policy "Authenticated update camp_live" on public.camp_live
  for update to authenticated
  using (true)
  with check (true);

create policy "Authenticated delete camp_live" on public.camp_live
  for delete to authenticated
  using (true);

-- Same pattern for players (station walk-ups + admin roster push)
drop policy if exists "Authenticated read all players" on public.players;
create policy "Authenticated read all players" on public.players
  for select to authenticated
  using (true);

drop policy if exists "Authenticated insert camp players" on public.players;
drop policy if exists "Authenticated update camp players" on public.players;
drop policy if exists "Authenticated delete camp players" on public.players;
drop policy if exists "Authenticated insert players" on public.players;
drop policy if exists "Authenticated update players" on public.players;
drop policy if exists "Authenticated delete players" on public.players;

create policy "Authenticated insert camp players" on public.players
  for insert to authenticated
  with check (true);

create policy "Authenticated update camp players" on public.players
  for update to authenticated
  using (true)
  with check (true);

create policy "Authenticated delete camp players" on public.players
  for delete to authenticated
  using (true);

grant select on public.camps to anon, authenticated;
grant insert, update, delete on public.camps to authenticated;
grant select on public.players to anon, authenticated;
grant insert, update, delete on public.players to authenticated;
grant select on public.camp_live to anon, authenticated;
grant insert, update, delete on public.camp_live to authenticated;

commit;
