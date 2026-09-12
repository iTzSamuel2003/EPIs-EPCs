-- Only organization administrators may alter or delete operational documents.
drop policy if exists "organization members can delete delivery terms" on storage.objects;
create policy "organization admins can delete delivery terms"
on storage.objects for delete to authenticated
using (
  bucket_id = 'delivery-terms'
  and (storage.foldername(name))[1] = private.current_organization_id()::text
  and private.is_current_organization_admin()
);

drop policy if exists "organization members can delete invoice attachments" on storage.objects;
create policy "organization admins can delete invoice attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'invoice-attachments'
  and (storage.foldername(name))[1] = private.current_organization_id()::text
  and private.is_current_organization_admin()
);

drop policy if exists "organization members can delete transaction photos" on storage.objects;
create policy "organization admins can delete transaction photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'transaction-photos'
  and (storage.foldername(name))[1] = private.current_organization_id()::text
  and private.is_current_organization_admin()
);

drop policy if exists "portal_auth_upload_course_documents" on storage.objects;
create policy "portal_auth_upload_course_documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-course-documents'
  and name ~ '^portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$'
  and private.is_current_organization_admin()
);
