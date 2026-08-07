-- ============================================================
-- Migration 011 — Instagram Story approval queue for registrations
-- Run once in Supabase → SQL Editor.
-- register.html uploads optional photo → ig_story_status = pending
-- admin.html Roster → Approve / Reject → Netlify posts Story
-- ============================================================

begin;

alter table public.registrations
  add column if not exists instagram_handle text;

alter table public.registrations
  add column if not exists photo_url text;

alter table public.registrations
  add column if not exists ig_story_status text default 'none';
  -- none | pending | approved | posted | rejected | failed

alter table public.registrations
  add column if not exists ig_story_posted_at timestamptz;

alter table public.registrations
  add column if not exists ig_story_error text;

comment on column public.registrations.ig_story_status is
  'none=no photo; pending=awaiting approval; approved=queued; posted; rejected; failed';

create index if not exists registrations_ig_story_status_idx
  on public.registrations (ig_story_status);

-- Public photo uploads from register.html (no login). Stories still require
-- human approval in admin before anything posts to Instagram.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'registration-photos',
  'registration-photos',
  true,
  10485760, -- 10 MB
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public upload registration photos" on storage.objects;
drop policy if exists "Public read registration photos" on storage.objects;

create policy "Public upload registration photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'registration-photos');

create policy "Public read registration photos" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'registration-photos');

-- Allow service role / authenticated coaches to update IG status via API
-- (Netlify function uses service role; this also lets authenticated admin PATCH if needed)
grant update on public.registrations to authenticated;

drop policy if exists "Authenticated update registration ig story" on public.registrations;
create policy "Authenticated update registration ig story" on public.registrations
  for update to authenticated
  using (true)
  with check (true);

commit;
