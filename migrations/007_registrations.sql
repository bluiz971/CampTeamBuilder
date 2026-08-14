-- ============================================================
-- Migration 007 — Public camp registrations (advance sign-up)
-- Run once in Supabase → SQL Editor.
-- Public form: register.html  → INSERT into registrations
-- Admin pull:  admin.html Roster → "Pull Registrations"
-- Day-of walk-ups still use walkup.html → players (migration 005).
-- ============================================================

begin;

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

-- Data API exposure (required on projects that don't auto-grant new tables)
grant insert on public.registrations to anon, authenticated;
grant select on public.registrations to authenticated;

drop policy if exists "Public insert registrations" on public.registrations;
drop policy if exists "Authenticated read registrations" on public.registrations;

create policy "Public insert registrations" on public.registrations
  for insert to anon, authenticated
  with check (true);

create policy "Authenticated read registrations" on public.registrations
  for select to authenticated
  using (true);

commit;
