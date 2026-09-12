drop policy if exists "portal users can upload course documents" on storage.objects;

create policy "portal users can upload course documents"
on storage.objects for insert to anon
with check (
  bucket_id = 'employee-course-documents'
  and name ~ '^portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$'
);
