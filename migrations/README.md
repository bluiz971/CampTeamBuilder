# Database setup order

Run these in Supabase → **SQL Editor**, in order:

1. **`SUPABASE_SETUP.sql`** (repo root) — creates `camp_live` + `players` and base RLS (skip if you already have those tables).
2. **`001_multi_camp.sql`** (this folder) — adds `camps`, `camp_id` FKs, camp-scoped RLS.

After that:

- Sign in on **admin.html → Publish**, then open **Camps** to manage camps.
- Parent / station links: `/?camp=your-slug` and `/station.html?camp=your-slug`.
