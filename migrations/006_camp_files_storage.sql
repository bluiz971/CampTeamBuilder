-- ============================================================
-- Migration 006 — Public camp files (daily schedule PDFs)
-- Run once in Supabase → SQL Editor.
-- ============================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'camp-files',
  'camp-files',
  true,
  20971520, -- 20 MB
  array['application/pdf','image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read camp-files" on storage.objects;
create policy "Public read camp-files" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'camp-files');

drop policy if exists "Auth upload camp-files" on storage.objects;
create policy "Auth upload camp-files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'camp-files');

drop policy if exists "Auth update camp-files" on storage.objects;
create policy "Auth update camp-files" on storage.objects
  for update to authenticated
  using (bucket_id = 'camp-files')
  with check (bucket_id = 'camp-files');

drop policy if exists "Auth delete camp-files" on storage.objects;
create policy "Auth delete camp-files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'camp-files');

commit;
