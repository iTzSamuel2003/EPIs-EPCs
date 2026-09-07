drop policy if exists "organization members can read course documents" on storage.objects;

create policy "organization members can read course documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'employee-course-documents'
  and exists (
    select 1
    from public.employee_courses course
    where course.certificate_file_path = storage.objects.name
      and course.organization_id = private.current_organization_id()
  )
);
