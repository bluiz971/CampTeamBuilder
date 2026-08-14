-- ============================================================
-- Migration 005 — Public walk-up self-registration
-- Run once in Supabase → SQL Editor.
-- Allows anonymously registered players (walkup.html) to INSERT
-- into players for camps with status = 'active' only.
-- ============================================================

begin;

-- Public can add themselves to an active camp (self check-in queue).
drop policy if exists "Anon insert walk-up players" on public.players;
create policy "Anon insert walk-up players" on public.players
  for insert to anon
  with check (
    exists (
      select 1 from public.camps c
      where c.id = camp_id and c.status = 'active'
    )
  );

grant insert on public.players to anon;

commit;
