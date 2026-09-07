alter table public.employee_courses add column if not exists certificate_file_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-course-documents', 'employee-course-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "portal users can upload course documents" on storage.objects;
create policy "portal users can upload course documents" on storage.objects for insert to anon
with check (bucket_id = 'employee-course-documents' and name like 'portal/%');
drop policy if exists "organization members can read course documents" on storage.objects;
create policy "organization members can read course documents" on storage.objects for select to authenticated
using (bucket_id = 'employee-course-documents' and exists (select 1 from public.employee_courses c where c.certificate_file_path = name and c.organization_id = private.current_organization_id()));

create or replace function public.get_employee_portal_data_v2(p_registration text, p_cpf text)
returns table(employee_id uuid, employee_name text, function_name text, organization_name text, shirt_size text, pants_size text, shoe_size text, helmet_size text, glove_size text, uniform_notes text, courses jsonb, materials jsonb, requests jsonb, requirements jsonb)
language sql security definer set search_path = public
as $$
  select e.id, e.full_name, coalesce(e.function_name, e.job_title, ''), o.name,
    p.shirt_size, p.pants_size, p.shoe_size, p.helmet_size, p.glove_size, p.uniform_notes,
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'provider', c.provider, 'completed_at', c.completed_at, 'expires_at', c.expires_at, 'certificate_number', c.certificate_number, 'has_attachment', c.certificate_file_path is not null) order by c.expires_at nulls last) from public.employee_courses c where c.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('material_name', x.material_name, 'quantity', x.quantity, 'unit', x.unit, 'last_delivery', x.last_delivery) order by x.material_name) from (select m.name material_name, m.unit, sum(di.quantity) - coalesce(sum((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id)), 0) quantity, max(d.delivered_at) last_delivery from public.delivery_items di join public.deliveries d on d.id = di.delivery_id join public.materials m on m.id = di.material_id where d.employee_id = e.id group by m.id, m.name, m.unit having sum(di.quantity) - coalesce(sum((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id)), 0) > 0) x), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'request_type', r.request_type, 'description', r.description, 'status', r.status, 'created_at', r.created_at) order by r.created_at desc) from public.employee_portal_requests r where r.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'function_group', t.function_group, 'course_name', t.course_name, 'source_annex', t.source_annex, 'mandatory', t.mandatory, 'validity_months', t.validity_months, 'notes', t.notes) order by t.function_group, t.course_name) from public.contract_training_requirements t where t.organization_id = e.organization_id), '[]'::jsonb)
  from public.employees e join public.organizations o on o.id = e.organization_id left join public.employee_profiles p on p.employee_id = e.id
  where e.registration = trim(p_registration) and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and e.status <> 'terminated' limit 1;
$$;

create or replace function public.submit_employee_portal_course(p_registration text, p_cpf text, p_name text, p_provider text, p_completed_at date, p_expires_at date, p_certificate_number text, p_certificate_file_path text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_employee public.employees; v_id uuid;
begin
  select * into v_employee from public.employees where registration = trim(p_registration) and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Informe o nome do curso'; end if;
  insert into public.employee_courses (employee_id, organization_id, name, provider, completed_at, expires_at, certificate_number, certificate_file_path) values (v_employee.id, v_employee.organization_id, trim(p_name), nullif(trim(p_provider), ''), p_completed_at, p_expires_at, nullif(trim(p_certificate_number), ''), nullif(trim(p_certificate_file_path), '')) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.get_employee_portal_data_v2(text, text), public.submit_employee_portal_course(text, text, text, text, date, date, text, text) from public, authenticated;
grant execute on function public.get_employee_portal_data_v2(text, text), public.submit_employee_portal_course(text, text, text, text, date, date, text, text) to anon;
