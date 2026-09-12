drop policy if exists "employee request attachments organization update" on storage.objects;

create policy "employee request attachments organization update"
on storage.objects
for update to authenticated
using (
  bucket_id = 'employee-request-attachments'
  and private.is_current_organization_admin()
  and exists (
    select 1
    from public.employee_portal_requests r
    where r.attachment_path = objects.name
      and r.organization_id = private.current_organization_id()
  )
)
with check (
  bucket_id = 'employee-request-attachments'
  and private.is_current_organization_admin()
  and (storage.foldername(name))[1] = private.current_organization_id()::text
);


