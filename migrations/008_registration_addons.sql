-- ============================================================
-- Migration 008 — Add-ons column on registrations
-- Run if you already ran 007 before add-ons were added.
-- Safe to re-run (IF NOT EXISTS).
-- ============================================================

alter table public.registrations
  add column if not exists addons text;
