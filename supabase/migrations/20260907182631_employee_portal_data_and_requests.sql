create table if not exists public.employee_portal_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  request_type text not null check (request_type in ('replacement', 'return', 'new_material', 'course', 'other')),
  description text not null,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'approved', 'rejected', 'completed')),
  created_at timestamptz not null default now()
);
alter table public.employee_portal_requests enable row level security;
create policy "organization members manage employee portal requests" on public.employee_portal_requests for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
create index if not exists employee_portal_requests_employee_idx on public.employee_portal_requests(organization_id, employee_id, created_at desc);
grant select, insert, update on public.employee_portal_requests to authenticated;

create or replace function public.get_employee_portal_data(p_registration text, p_cpf text)
returns table(employee_id uuid, employee_name text, function_name text, organization_name text, shirt_size text, pants_size text, shoe_size text, helmet_size text, glove_size text, uniform_notes text, courses jsonb, materials jsonb, requests jsonb)
language sql security definer set search_path = public
as $$
  select e.id, e.full_name, coalesce(e.function_name, e.job_title, ''), o.name,
    p.shirt_size, p.pants_size, p.shoe_size, p.helmet_size, p.glove_size, p.uniform_notes,
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'provider', c.provider, 'completed_at', c.completed_at, 'expires_at', c.expires_at, 'certificate_number', c.certificate_number) order by c.expires_at nulls last) from public.employee_courses c where c.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('material_name', x.material_name, 'quantity', x.quantity, 'unit', x.unit, 'last_delivery', x.last_delivery) order by x.material_name) from (select m.name material_name, m.unit, sum(di.quantity) - coalesce(sum((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id)), 0) quantity, max(d.delivered_at) last_delivery from public.delivery_items di join public.deliveries d on d.id = di.delivery_id join public.materials m on m.id = di.material_id where d.employee_id = e.id group by m.id, m.name, m.unit having sum(di.quantity) - coalesce(sum((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id)), 0) > 0) x), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'request_type', r.request_type, 'description', r.description, 'status', r.status, 'created_at', r.created_at) order by r.created_at desc) from public.employee_portal_requests r where r.employee_id = e.id), '[]'::jsonb)
  from public.employees e join public.organizations o on o.id = e.organization_id left join public.employee_profiles p on p.employee_id = e.id
  where e.registration = trim(p_registration) and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and e.status <> 'terminated' limit 1;
$$;

create or replace function public.submit_employee_portal_course(p_registration text, p_cpf text, p_name text, p_provider text, p_completed_at date, p_expires_at date, p_certificate_number text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_employee public.employees; v_id uuid;
begin
  select * into v_employee from public.employees where registration = trim(p_registration) and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Informe o nome do curso'; end if;
  insert into public.employee_courses (employee_id, organization_id, name, provider, completed_at, expires_at, certificate_number) values (v_employee.id, v_employee.organization_id, trim(p_name), nullif(trim(p_provider), ''), p_completed_at, p_expires_at, nullif(trim(p_certificate_number), '')) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_employee_portal_request(p_registration text, p_cpf text, p_request_type text, p_description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_employee public.employees; v_id uuid;
begin
  select * into v_employee from public.employees where registration = trim(p_registration) and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if p_request_type not in ('replacement', 'return', 'new_material', 'course', 'other') then raise exception 'Tipo de solicitação inválido'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Descreva a solicitação'; end if;
  insert into public.employee_portal_requests (organization_id, employee_id, request_type, description) values (v_employee.organization_id, v_employee.id, p_request_type, trim(p_description)) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.get_employee_portal_data(text, text), public.submit_employee_portal_course(text, text, text, text, date, date, text), public.submit_employee_portal_request(text, text, text, text) from public, authenticated;
grant execute on function public.get_employee_portal_data(text, text), public.submit_employee_portal_course(text, text, text, text, date, date, text), public.submit_employee_portal_request(text, text, text, text) to anon;
