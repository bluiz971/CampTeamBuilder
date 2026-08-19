-- ============================================================
-- Migration 014 — Email invitation 3 hours after nomination
-- Run once in Supabase → SQL Editor (after 013).
-- nominate.html collects player_email; Netlify scheduled function
-- send-nomination-invites.js generates the graphic and emails it.
-- ============================================================

begin;

alter table public.nominations
  add column if not exists player_email text;

alter table public.nominations
  add column if not exists invite_sent_at timestamptz;

alter table public.nominations
  add column if not exists invite_error text;

alter table public.nominations
  add column if not exists invite_attempts integer not null default 0;

comment on column public.nominations.player_email is
  'Email of the nominated player — invitation PNG is sent here 3 hours after submit';

create index if not exists nominations_invite_due_idx
  on public.nominations (submitted_at)
  where invite_sent_at is null;

commit;
