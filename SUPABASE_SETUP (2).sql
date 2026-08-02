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

-- ============================================================
-- Advance camp registrations (register.html)
-- Full copy also lives in migrations/007_registrations.sql
-- ============================================================
create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  camp_code text not null,
  first text, last text,
  birth_date text, grad_year text,
  street1 text, street2 text, city text, state text, postal text,
  email text, phone text,
  school text, school_city text, school_state text,
  height text, weight text, position text,
  school_coach_name text, school_coach_email text,
  aau_team text, aau_coach_name text, aau_coach_email text,
  parent_name text, parent_phone text, parent_email text,
  addons text,
  submitted_at timestamptz not null default now()
);
create index if not exists registrations_camp_code_idx on public.registrations (camp_code);
alter table public.registrations enable row level security;
grant insert on public.registrations to anon, authenticated;
grant select on public.registrations to authenticated;
drop policy if exists "Public insert registrations" on public.registrations;
drop policy if exists "Authenticated read registrations" on public.registrations;
create policy "Public insert registrations" on public.registrations
  for insert to anon, authenticated with check (true);
create policy "Authenticated read registrations" on public.registrations
  for select to authenticated using (true);

-- Stripe payment fields (also migrations/009_registration_payments.sql)
alter table public.registrations
  add column if not exists payment_status text not null default 'pending',
  add column if not exists amount_cents integer,
  add column if not exists currency text not null default 'usd',
  add column if not exists stripe_session_id text,
  add column if not exists stripe_payment_intent text,
  add column if not exists paid_at timestamptz;
