-- ============================================================
-- Migration 004 — Scout notes on players (station Teams write-ups)
-- Run once in Supabase → SQL Editor.
-- ============================================================

begin;

alter table public.players
  add column if not exists scout_notes text default '';

commit;
