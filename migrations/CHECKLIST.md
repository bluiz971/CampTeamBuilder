# Multi-camp go-live checklist

## Database (Supabase → SQL Editor)
1. `SUPABASE_SETUP.sql` — only if `players` / `camp_live` missing
2. `001_multi_camp.sql` — creates `camps` + `camp_id`
3. `002_fix_write_rls.sql` — **required** if sync/roster push is blocked by RLS

Verify:
```sql
select slug, status from camps order by slug;
select code, camp_id from camp_live;
select camp_code, count(*) from players group by 1;
```

## Admin
- Header **Active camp** must match the camp you mean (today’s roster is on **georgia-2026**)
- Sign in on Publish, then **Save & Sync Now**
- Roster tab → **Push Roster to Stations**
- Parent link must be `?camp=georgia-2026` (same slug)

## Station / parent
- Use `station.html?camp=georgia-2026` (and parent `/?camp=georgia-2026`)
- Hard-refresh after Netlify deploy
- If Camp field still shows an old slug, change it or clear site localStorage for that origin

## Known footguns (fixed in latest HTML)
- Sync without a resolved `camp_id` → NOT NULL error (now blocked client-side)
- RLS 401 mislabeled as “session expired” (now clearer)
- Roster push reporting success when inserts failed (now verifies)
- Station on `mid-atlantic-2026` while players live on `georgia-2026`
