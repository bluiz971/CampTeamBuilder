-- ============================================================
-- Move roster: georgia-2026 → mid-atlantic-2026
-- Run once in Supabase → SQL Editor, then hard-refresh station.
--
-- Why: station is on mid-atlantic-2026 (correct for Rowan),
-- but player rows were still attached to georgia-2026.
-- ============================================================

begin;

update public.players
set
  camp_id = (select id from public.camps where slug = 'mid-atlantic-2026'),
  camp_code = 'mid-atlantic-2026'
where camp_id = (select id from public.camps where slug = 'georgia-2026');

-- Keep live blob slug mirrors aligned (optional safety)
update public.camp_live cl
set code = c.slug
from public.camps c
where cl.camp_id = c.id
  and cl.code is distinct from c.slug;

commit;

-- Verify (should show mid-atlantic with the player count):
-- select camp_code, count(*) from players group by 1 order by 1;
