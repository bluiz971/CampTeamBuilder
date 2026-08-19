-- ============================================================
-- Migration 015 — Let the invite function update nomination rows
-- Run once in Supabase → SQL Editor (after 014).
-- The Netlify function uses the service role to mark invites sent.
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

grant select, update on public.nominations to service_role;

commit;
