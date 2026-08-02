-- ============================================================
-- Migration 009 — Stripe payment fields on registrations
-- Run once in Supabase → SQL Editor after 007/008.
-- ============================================================

begin;

alter table public.registrations
  add column if not exists payment_status text not null default 'pending',
  add column if not exists amount_cents integer,
  add column if not exists currency text not null default 'usd',
  add column if not exists stripe_session_id text,
  add column if not exists stripe_payment_intent text,
  add column if not exists paid_at timestamptz;

comment on column public.registrations.payment_status is
  'pending | paid | failed | refunded — updated by Stripe webhook';

create index if not exists registrations_payment_status_idx
  on public.registrations (camp_code, payment_status);

create index if not exists registrations_stripe_session_idx
  on public.registrations (stripe_session_id);

-- Service role (Netlify webhook) updates payment fields; no public UPDATE policy.
-- Keep insert/select policies from 007 as-is.

commit;
