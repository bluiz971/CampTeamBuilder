-- ============================================================
-- Migration 010 — Deposit / balance payment fields on registrations
-- Run once in Supabase → SQL Editor after 009.
--
-- pay_status values:
--   unpaid          — no payment yet
--   deposit_paid    — deposit collected; balance still owed (eligible for
--                     the one-time week-before-camp auto-charge)
--   charge_failed   — auto balance charge attempted once and failed;
--                     remaining balance is collected in person at check-in
--                     (NOT queried again by the scheduled charger)
--   balance_charged — deposit + auto balance charge succeeded
--   paid_in_full    — paid in full at registration (no remaining balance)
--
-- Legacy payment_status ('pending'|'paid'|…) may still exist; Pull
-- Registrations maps both. Prefer pay_status going forward.
-- ============================================================

begin;

alter table public.registrations
  add column if not exists pay_status text,
  add column if not exists amount_total integer,
  add column if not exists amount_paid integer not null default 0,
  add column if not exists balance_charge_error text,
  add column if not exists balance_charge_attempted_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text;

-- Backfill pay_status from legacy payment_status where empty
update public.registrations
set pay_status = case
  when payment_status in ('paid') then 'paid_in_full'
  when payment_status in ('failed') then 'charge_failed'
  when payment_status in ('pending', 'refunded') or payment_status is null then 'unpaid'
  else coalesce(pay_status, 'unpaid')
end
where pay_status is null;

alter table public.registrations
  alter column pay_status set default 'unpaid';

update public.registrations set pay_status = 'unpaid' where pay_status is null;

-- Copy amount_cents → amount_total when total not set
update public.registrations
set amount_total = amount_cents
where amount_total is null and amount_cents is not null;

comment on column public.registrations.pay_status is
  'unpaid | deposit_paid | charge_failed | balance_charged | paid_in_full';
comment on column public.registrations.amount_total is
  'Total due in cents (camp + selected add-ons)';
comment on column public.registrations.amount_paid is
  'Amount collected in cents so far';
comment on column public.registrations.balance_charge_error is
  'Last auto balance-charge error (one attempt only); shown in admin Player Data';

create index if not exists registrations_pay_status_idx
  on public.registrations (camp_code, pay_status);

-- Scheduled charger only looks at deposit_paid; charge_failed is excluded by design.
create index if not exists registrations_deposit_paid_idx
  on public.registrations (camp_code)
  where pay_status = 'deposit_paid';

commit;
