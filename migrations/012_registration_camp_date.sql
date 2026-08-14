-- ============================================================
-- Migration 012 — camp_date on registrations (deposit auto-charge)
-- Run once in Supabase → SQL Editor after 010/011.
--
-- Used by charge-remaining-balance to find deposit_paid rows whose
-- remaining balance should be charged 7 days before camp.
-- ============================================================

begin;

alter table public.registrations
  add column if not exists camp_date date;

-- Ensure deposit/balance columns exist (safe if 010 already ran)
alter table public.registrations
  add column if not exists amount_total integer,
  add column if not exists amount_paid integer default 0,
  add column if not exists pay_status text default 'unpaid',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists balance_charge_attempted_at timestamptz,
  add column if not exists balance_charge_error text;

create index if not exists registrations_camp_date_idx
  on public.registrations (camp_date);

create index if not exists registrations_deposit_due_idx
  on public.registrations (camp_date)
  where pay_status = 'deposit_paid';

comment on column public.registrations.camp_date is
  'Camp start date (YYYY-MM-DD); balance auto-charge runs ~7 days before';

commit;
