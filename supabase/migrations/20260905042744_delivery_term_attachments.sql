alter table public.deliveries add column if not exists term_file_path text;
alter table public.deliveries add column if not exists term_uploaded_at timestamptz;
alter table public.deliveries add column if not exists term_uploaded_by uuid references auth.users(id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-terms', 'delivery-terms', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "organization members can read delivery terms" on storage.objects;
create policy "organization members can read delivery terms" on storage.objects for select to authenticated
using (bucket_id = 'delivery-terms' and (storage.foldername(name))[1] = private.current_organization_id()::text);

drop policy if exists "organization members can upload delivery terms" on storage.objects;
create policy "organization members can upload delivery terms" on storage.objects for insert to authenticated
with check (bucket_id = 'delivery-terms' and (storage.foldername(name))[1] = private.current_organization_id()::text);

drop policy if exists "organization members can update delivery terms" on storage.objects;
create policy "organization members can update delivery terms" on storage.objects for update to authenticated
using (bucket_id = 'delivery-terms' and (storage.foldername(name))[1] = private.current_organization_id()::text)
with check (bucket_id = 'delivery-terms' and (storage.foldername(name))[1] = private.current_organization_id()::text);

drop policy if exists "organization members can delete delivery terms" on storage.objects;
create policy "organization members can delete delivery terms" on storage.objects for delete to authenticated
using (bucket_id = 'delivery-terms' and (storage.foldername(name))[1] = private.current_organization_id()::text);
