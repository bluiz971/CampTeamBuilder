-- ============================================================
-- Camp Team Builder — Live Sync setup
-- Run this once in your Supabase project's SQL Editor
-- (Same project as FieldCam is fine — this just adds one new table.)
-- ============================================================

create table if not exists camp_live (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table camp_live enable row level security;

-- Anyone can read (this is what lets the parent page load live data
-- without a login). Only public-facing info goes in this table —
-- team rosters, jersey numbers, schedule, app/shop links. Never
-- balances, check-in status, or contact info.
create policy "Public read" on camp_live
  for select using (true);

-- Only a signed-in user can write. This closes the gap where anyone
-- who found the anon key in the published page's source could tamper
-- with the data — writes now require a real Supabase Auth login.
create policy "Authenticated write" on camp_live
  for insert to authenticated with check (true);

create policy "Authenticated update" on camp_live
  for update to authenticated using (true) with check (true);

-- ============================================================
-- Create your coach login (one-time):
-- 1. In Supabase, go to Authentication → Users → Add User
-- 2. Enter an email and password for yourself (this becomes your
--    Camp Team Builder sign-in — it has nothing to do with Anthropic
--    or Claude, it's purely your own Supabase project's login)
-- 3. Repeat for any co-coach who should also be able to push updates
-- ============================================================

-- ============================================================
-- After running this:
-- 1. In Supabase, go to Project Settings → API
-- 2. Copy the "Project URL" and the "anon public" key
-- 3. Create your login under Authentication → Users → Add User
--    (see note above)
-- 4. Paste the URL + anon key into Camp Team Builder's Publish tab
--    → Live Sync, pick a Camp Code (e.g. "fall-2026"), then sign in
--    with the email/password you just created
-- 5. Click "Save & Sync Now"
-- ============================================================
