-- ============================================================
-- Migration 013 — Public player nominations + invitation photos
-- Run once in Supabase → SQL Editor.
-- Public form: nominate.html → INSERT into nominations
-- Photos: Storage bucket nomination-photos
-- Admin: admin.html Roster → Nominations list (authenticated SELECT)
-- ============================================================

begin;

create table if not exists public.nominations (
  id uuid primary key default gen_random_uuid(),
  camp_code text not null,
  camp_name text,
  nominator_type text,
  nominator_role text,
  nominator_name text,
  nominator_email text,
  player_name text not null,
  grad_year text,
  home_state text,
  instagram_handle text,
  photo_url text,
  submitted_at timestamptz not null default now()
);

create index if not exists nominations_camp_code_idx
  on public.nominations (camp_code);

create index if not exists nominations_submitted_at_idx
  on public.nominations (submitted_at desc);

alter table public.nominations enable row level security;

grant insert on public.nominations to anon, authenticated;
grant select on public.nominations to authenticated;

drop policy if exists "Public insert nominations" on public.nominations;
drop policy if exists "Authenticated read nominations" on public.nominations;

create policy "Public insert nominations" on public.nominations
  for insert to anon, authenticated
  with check (true);

create policy "Authenticated read nominations" on public.nominations
  for select to authenticated
  using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nomination-photos',
  'nomination-photos',
  true,
  10485760, -- 10 MB
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public upload nomination photos" on storage.objects;
drop policy if exists "Public update nomination photos" on storage.objects;
drop policy if exists "Public read nomination photos" on storage.objects;

create policy "Public upload nomination photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'nomination-photos');

create policy "Public update nomination photos" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'nomination-photos')
  with check (bucket_id = 'nomination-photos');

create policy "Public read nomination photos" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'nomination-photos');

commit;
