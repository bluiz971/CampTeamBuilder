# Database setup order

Run these in Supabase → **SQL Editor**, in order:

1. **`SUPABASE_SETUP.sql`** (repo root) — creates `camp_live` + `players` and base RLS (skip if you already have those tables).
2. **`001_multi_camp.sql`** — adds `camps`, `camp_id` FKs, camp-scoped RLS.
3. **`002_fix_write_rls.sql`** — run if Publish sync fails with “not authorized” / RLS right after sign-in.
4. **`003_move_roster_to_mid_atlantic.sql`** — optional one-time roster move (only if needed).
5. **`004_player_scout_notes.sql`** — adds `scout_notes` for station Teams notes / camp write-ups.
6. **`005_public_walkup_register.sql`** — allows public walk-up self-registration (`walkup.html`) into active camps.
7. **`006_camp_files_storage.sql`** — Storage bucket for daily schedule PDF uploads.
8. **`007_registrations.sql`** — advance camp registration (`register.html`) → `registrations` table (public insert, authenticated read).
9. **`008_registration_addons.sql`** — adds `addons` column if you already ran 007 before add-ons.
10. **`009_registration_payments.sql`** — Stripe payment fields (`payment_status`, `amount_cents`, session ids) for `register.html` checkout.
11. **`010_registration_deposit_balance.sql`** — deposit / balance fields (`pay_status`, `amount_total`, `amount_paid`, `balance_charge_error`). Auto-charge is one attempt only (`deposit_paid` → `balance_charged` or `charge_failed`).
12. **`011_registration_instagram_stories.sql`** — Instagram Story approval fields (`instagram_handle`, `photo_url`, `ig_story_status`, …) + public `registration-photos` Storage bucket for `register.html` uploads.

After that:

- Sign in on **admin.html → Publish**, then open **Camps** to manage camps.
- Public links: `/?camp=your-slug`, `/station.html?camp=your-slug`, `/register.html?camp=your-slug` (advance signup), `/walkup.html?camp=your-slug` (day-of).
