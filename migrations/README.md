# Database setup order

Run these in Supabase → **SQL Editor**, in order:

1. **`SUPABASE_SETUP.sql`** (repo root) — creates `camp_live` + `players` and base RLS (skip if you already have those tables).
2. **`001_multi_camp.sql`** — adds `camps`, `camp_id` FKs, camp-scoped RLS.
3. **`002_fix_write_rls.sql`** — run if Publish sync fails with “not authorized” / RLS right after sign-in.
4. **`003_move_roster_to_mid_atlantic.sql`** — optional one-time roster move (only if needed).
5. **`004_player_scout_notes.sql`** — adds `scout_notes` for station Teams notes / camp write-ups.

After that:

- Sign in on **admin.html → Publish**, then open **Camps** to manage camps.
- Parent / station links: `/?camp=your-slug` and `/station.html?camp=your-slug`.
