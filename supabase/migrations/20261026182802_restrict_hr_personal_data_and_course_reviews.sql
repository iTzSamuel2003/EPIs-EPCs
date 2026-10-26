-- Restrict employee PII at the column boundary while preserving the operational
-- directory fields needed by TST/Almoxarife for delivery and return workflows.
revoke all privileges on table public.employees from public, anon, authenticated;
grant select (
  id, organization_id, registration, full_name, job_title, function_name,
  function_classification, department, unit, admission_date, termination_date, status
) on table public.employees to authenticated;

drop policy if exists "organization members read organization data" on public.employees;
drop policy if exists "rh manages operational data" on public.employees;
drop policy if exists "organization admins insert organization data" on public.employees;
drop policy if exists "organization admins update organization data" on public.employees;
drop policy if exists "organization admins delete organization data" on public.employees;
create policy "authorized pages read operational employee directory"
  on public.employees for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and (
      private.current_user_can_access_page('/')
      or private.current_user_can_access_page('/employees')
      or private.current_user_can_access_page('/deliveries')
      or private.current_user_can_access_page('/returns')
      or private.current_user_can_access_page('/discounts')
      or private.current_user_can_access_page('/requests')
      or private.current_user_can_access_page('/validities')
      or private.current_user_can_access_page('/reports')
      or private.current_user_can_access_page('/movements')
      or private.current_user_can_access_page('/teams')
    )
  );
revoke insert, update, delete, truncate, references, trigger
  on table public.employees from authenticated;

-- Full employee records are returned only to RH/Admin on the employee page.
create or replace function public.get_hr_employee_records(p_employee_id uuid default null)
returns table (
  id uuid,
  registration text,
  full_name text,
  cpf text,
  job_title text,
  function_name text,
  function_classification text,
  department text,
  unit text,
  admission_date date,
  termination_date date,
  phone text,
  email text,
  status text,
  notes text,
  organization_name text,
  organization_cnpj text,
  organization_logo_url text,
  organization_address text,
  organization_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;

  return query
  select e.id, e.registration, e.full_name, e.cpf, e.job_title,
    e.function_name, e.function_classification, e.department, e.unit,
    e.admission_date, e.termination_date, e.phone, e.email, e.status::text,
    e.notes, o.name, o.cnpj, o.logo_url, o.address, o.phone
  from public.employees e
  join public.organizations o on o.id = e.organization_id
  where e.organization_id = private.current_organization_id()
    and (p_employee_id is null or e.id = p_employee_id)
  order by e.full_name;
end;
$$;
revoke all on function public.get_hr_employee_records(uuid) from public, anon, service_role;
grant execute on function public.get_hr_employee_records(uuid) to authenticated;

create or replace function public.create_hr_employee(
  p_registration text,
  p_full_name text,
  p_cpf text,
  p_function_name text,
  p_function_classification text,
  p_department text,
  p_unit text,
  p_admission_date date,
  p_phone text,
  p_email text,
  p_status text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_organization_id uuid := private.current_organization_id();
begin
  if auth.uid() is null
    or v_organization_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;
  if nullif(trim(p_full_name), '') is null
    or nullif(trim(p_cpf), '') is null
    or length(trim(p_full_name)) > 200
    or length(trim(p_cpf)) > 32
    or length(regexp_replace(p_cpf, '\D', '', 'g')) <> 11
    or length(coalesce(p_registration, '')) > 100
    or length(coalesce(p_function_name, '')) > 200
    or length(coalesce(p_function_classification, '')) > 20
    or length(coalesce(p_department, '')) > 200
    or length(coalesce(p_unit, '')) > 120
    or length(coalesce(p_phone, '')) > 60
    or length(coalesce(p_email, '')) > 320
    or length(coalesce(p_notes, '')) > 4000 then
    raise exception 'Dados do funcionário inválidos ou acima do limite permitido';
  end if;
  if p_status is null or p_status not in ('active', 'away', 'terminated') then
    raise exception 'Status de funcionário inválido';
  end if;
  if p_admission_date > current_date then
    raise exception 'A data de admissão não pode ser futura';
  end if;

  insert into public.employees (
    organization_id, registration, full_name, cpf, job_title, function_name,
    function_classification, department, unit, admission_date, phone, email,
    status, notes
  ) values (
    v_organization_id, nullif(trim(p_registration), ''), trim(p_full_name),
    trim(p_cpf), null, nullif(trim(p_function_name), ''),
    nullif(trim(p_function_classification), ''), nullif(trim(p_department), ''),
    nullif(trim(p_unit), ''), p_admission_date, nullif(trim(p_phone), ''),
    nullif(trim(p_email), ''), p_status::public.employee_status,
    nullif(trim(p_notes), '')
  )
  returning id into v_employee_id;

  return v_employee_id;
end;
$$;
revoke all on function public.create_hr_employee(text, text, text, text, text, text, text, date, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_hr_employee(text, text, text, text, text, text, text, date, text, text, text, text)
  to authenticated;

create or replace function public.update_hr_employee(
  p_employee_id uuid,
  p_registration text,
  p_full_name text,
  p_cpf text,
  p_function_name text,
  p_function_classification text,
  p_department text,
  p_unit text,
  p_admission_date date,
  p_termination_date date,
  p_phone text,
  p_email text,
  p_status text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.current_organization_id();
begin
  if auth.uid() is null
    or v_organization_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;
  if p_employee_id is null
    or nullif(trim(p_full_name), '') is null
    or nullif(trim(p_cpf), '') is null
    or length(trim(p_full_name)) > 200
    or length(trim(p_cpf)) > 32
    or length(regexp_replace(p_cpf, '\D', '', 'g')) <> 11
    or length(coalesce(p_registration, '')) > 100
    or length(coalesce(p_function_name, '')) > 200
    or length(coalesce(p_function_classification, '')) > 20
    or length(coalesce(p_department, '')) > 200
    or length(coalesce(p_unit, '')) > 120
    or length(coalesce(p_phone, '')) > 60
    or length(coalesce(p_email, '')) > 320
    or length(coalesce(p_notes, '')) > 4000 then
    raise exception 'Dados do funcionário inválidos ou acima do limite permitido';
  end if;
  if p_status is null or p_status not in ('active', 'away', 'terminated') then
    raise exception 'Status de funcionário inválido';
  end if;
  if p_admission_date > current_date
    or p_termination_date > current_date
    or (p_admission_date is not null and p_termination_date is not null and p_termination_date < p_admission_date)
    then
    raise exception 'Datas de admissão ou desligamento inválidas';
  end if;

  update public.employees e
  set registration = nullif(trim(p_registration), ''),
      full_name = trim(p_full_name),
      cpf = trim(p_cpf),
      job_title = null,
      function_name = nullif(trim(p_function_name), ''),
      function_classification = nullif(trim(p_function_classification), ''),
      department = nullif(trim(p_department), ''),
      unit = nullif(trim(p_unit), ''),
      admission_date = p_admission_date,
      termination_date = p_termination_date,
      phone = nullif(trim(p_phone), ''),
      email = nullif(trim(p_email), ''),
      status = p_status::public.employee_status,
      notes = nullif(trim(p_notes), '')
  where e.id = p_employee_id
    and e.organization_id = v_organization_id;

  if not found then
    raise exception 'Funcionário não encontrado nesta organização';
  end if;
  return p_employee_id;
end;
$$;
revoke all on function public.update_hr_employee(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.update_hr_employee(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text)
  to authenticated;

-- Measurements, courses and employee portal requests are RH-only records.
revoke all privileges on table public.employee_profiles from public, anon, authenticated;
grant select, insert, update on table public.employee_profiles to authenticated;
drop policy if exists "organization members can access employee profiles" on public.employee_profiles;
drop policy if exists "organization members read organization data" on public.employee_profiles;
drop policy if exists "rh manages operational data" on public.employee_profiles;
drop policy if exists "organization admins delete organization data" on public.employee_profiles;
drop policy if exists "organization admins insert organization data" on public.employee_profiles;
drop policy if exists "organization admins update organization data" on public.employee_profiles;
create policy "hr manages employee profile data"
  on public.employee_profiles for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
  );

alter table public.employee_courses
  add column review_status text not null default 'pending',
  add column reviewed_by uuid references auth.users(id),
  add column reviewed_at timestamptz,
  add column review_notes text,
  add constraint employee_courses_review_status_check
    check (review_status in ('pending', 'approved', 'rejected'));

revoke all privileges on table public.employee_courses from public, anon, authenticated;
grant select, insert, delete on table public.employee_courses to authenticated;
drop policy if exists "organization members can access employee courses" on public.employee_courses;
drop policy if exists "organization members read organization data" on public.employee_courses;
drop policy if exists "organization admins delete organization data" on public.employee_courses;
drop policy if exists "organization admins insert organization data" on public.employee_courses;
drop policy if exists "organization admins update organization data" on public.employee_courses;
drop policy if exists "rh manages operational data" on public.employee_courses;
create policy "hr manages employee course reviews"
  on public.employee_courses for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
  );
create or replace function public.get_employee_course_records(p_employee_id uuid)
returns setof public.employee_courses
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;
  return query
  select c.*
  from public.employee_courses c
  where c.employee_id = p_employee_id
    and c.organization_id = private.current_organization_id()
  order by c.expires_at asc nulls last, c.created_at desc;
end;
$$;
revoke all on function public.get_employee_course_records(uuid) from public, anon, service_role;
grant execute on function public.get_employee_course_records(uuid) to authenticated;

create or replace function public.review_employee_course(
  p_course_id uuid,
  p_decision text,
  p_review_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decisão de revisão inválida';
  end if;
  if length(coalesce(p_review_notes, '')) > 2000 then
    raise exception 'A observação excede o limite permitido';
  end if;
  if p_decision = 'rejected' and nullif(trim(p_review_notes), '') is null then
    raise exception 'Informe o motivo da reprovação';
  end if;

  update public.employee_courses c
  set review_status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = nullif(trim(p_review_notes), '')
  where c.id = p_course_id
    and c.organization_id = private.current_organization_id()
    and c.review_status = 'pending';

  if not found then
    raise exception 'Curso pendente não encontrado nesta organização';
  end if;
end;
$$;
revoke all on function public.review_employee_course(uuid, text, text) from public, anon, service_role;
grant execute on function public.review_employee_course(uuid, text, text) to authenticated;

create or replace function public.get_training_compliance_counts()
returns table (requirement_id uuid, applicable_count bigint, approved_count bigint, active_employee_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not private.current_user_can_access_page('/training-compliance') then
    raise exception 'Acesso não autorizado à matriz de treinamentos';
  end if;

  return query
  select t.id,
    count(distinct e.id)::bigint,
    count(distinct e.id) filter (
      where e.id is not null and exists (
        select 1
        from public.employee_courses c
        where c.employee_id = e.id
          and c.organization_id = e.organization_id
          and c.review_status = 'approved'
          and lower(c.name) like '%' || lower(split_part(t.course_name, ' - ', 1)) || '%'
          and (c.expires_at is null or c.expires_at >= current_date)
      )
    )::bigint,
    (select count(*)::bigint from public.employees active_employee
      where active_employee.organization_id = private.current_organization_id()
        and active_employee.status = 'active')
  from public.contract_training_requirements t
  left join public.employees e
    on e.organization_id = t.organization_id
    and e.status = 'active'
    and (
      t.function_group = 'Todos os grupos'
      or lower(concat_ws(' ', e.job_title, e.function_name)) like '%' || lower(t.function_group) || '%'
      or (t.function_group = 'Poda' and lower(concat_ws(' ', e.job_title, e.function_name)) like '%pod%')
      or (t.function_group = 'Operador de Guindauto'
        and (lower(concat_ws(' ', e.job_title, e.function_name)) like '%munck%'
          or lower(concat_ws(' ', e.job_title, e.function_name)) like '%guindauto%'))
    )
  where t.organization_id = private.current_organization_id()
  group by t.id;
end;
$$;
revoke all on function public.get_training_compliance_counts() from public, anon, service_role;
grant execute on function public.get_training_compliance_counts() to authenticated;

-- Portal submissions are claims, not approved training records.
create or replace function public.submit_employee_portal_course(
  p_registration text,
  p_cpf text,
  p_name text,
  p_provider text,
  p_completed_at date,
  p_expires_at date,
  p_certificate_number text,
  p_certificate_file_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_id uuid;
  v_path text := nullif(trim(p_certificate_file_path), '');
  v_function_name text;
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  if length(coalesce(p_name, '')) > 200
    or length(coalesce(p_provider, '')) > 200
    or length(coalesce(p_certificate_number, '')) > 100 then
    raise exception 'Dados do curso excedem o tamanho permitido';
  end if;

  select * into v_employee
  from public.employees e
  where e.registration = trim(p_registration)
    and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and e.status <> 'terminated';
  if v_employee.id is null then
    raise exception 'Matricula ou CPF nao conferem';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Informe o nome do curso';
  end if;

  v_function_name := coalesce(v_employee.function_name, v_employee.job_title, '');
  if not exists (
    select 1
    from public.contract_training_requirements t
    where t.organization_id = v_employee.organization_id
      and t.course_name = trim(p_name)
      and (
        t.function_group = 'Todos os grupos'
        or lower(v_function_name) like '%' || lower(t.function_group) || '%'
        or (t.function_group = 'Poda' and lower(v_function_name) like '%pod%')
        or (t.function_group = 'Operador de Guindauto'
          and (lower(v_function_name) like '%munck%' or lower(v_function_name) like '%guindauto%'))
      )
  ) then
    raise exception 'Curso nao previsto para a funcao do colaborador';
  end if;

  if exists (
    select 1 from public.employee_courses c
    where c.employee_id = v_employee.id
      and c.organization_id = v_employee.organization_id
      and c.name = trim(p_name)
      and c.review_status = 'pending'
  ) then
    raise exception 'Este curso ja foi enviado e aguarda analise do RH';
  end if;

  if v_path is not null then
    if v_path !~ ('^' || v_employee.organization_id::text || '/portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$') then
      raise exception 'Anexo de certificado invalido';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'employee-course-documents' and name = v_path
    ) then
      raise exception 'Anexo de certificado nao encontrado';
    end if;
  end if;

  insert into public.employee_courses (
    employee_id, organization_id, name, provider, completed_at, expires_at,
    certificate_number, certificate_file_path, review_status
  ) values (
    v_employee.id, v_employee.organization_id, trim(p_name),
    nullif(trim(p_provider), ''), p_completed_at, p_expires_at,
    nullif(trim(p_certificate_number), ''), v_path, 'pending'
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text)
  to anon, service_role;

create or replace function public.get_employee_portal_data_v3(p_registration text, p_cpf text)
returns table (
  employee_id uuid, employee_name text, function_name text, organization_name text,
  shirt_size text, pants_size text, shoe_size text, helmet_size text, glove_size text,
  uniform_notes text, courses jsonb, materials jsonb, requests jsonb, requirements jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_function_name text;
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  if length(trim(p_registration)) > 100 or length(trim(p_cpf)) > 64 then
    raise exception 'Dados de acesso inválidos';
  end if;

  select coalesce(e.function_name, e.job_title, '') into v_function_name
  from public.employees e
  where e.registration = trim(p_registration)
    and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and e.status <> 'terminated';

  return query
  select e.id,
    e.full_name,
    coalesce(e.function_name, e.job_title, ''),
    o.name,
    p.shirt_size,
    p.pants_size,
    p.shoe_size,
    p.helmet_size,
    p.glove_size,
    p.uniform_notes,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'provider', c.provider,
      'completed_at', c.completed_at, 'expires_at', c.expires_at,
      'certificate_number', c.certificate_number,
      'has_attachment', c.certificate_file_path is not null,
      'review_status', c.review_status
    ) order by c.expires_at nulls last) from public.employee_courses c where c.employee_id = e.id and c.review_status = 'approved'), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'delivery_item_id', x.delivery_item_id, 'material_name', x.material_name,
      'lot_number', x.lot_number, 'quantity', x.quantity, 'unit', x.unit, 'last_delivery', x.last_delivery
    ) order by x.last_delivery desc, x.material_name)
      from (
        select di.id delivery_item_id, m.name material_name, ml.lot_number, m.unit,
          di.quantity - coalesce((select sum(ri.quantity)
            from public.return_items ri join public.returns ret on ret.id = ri.return_id
            where ri.delivery_item_id = di.id
              and (ri.destination is distinct from 'not_returned' or ret.term_signed_at is not null)), 0) quantity,
          d.delivered_at last_delivery
        from public.delivery_items di
        join public.deliveries d on d.id = di.delivery_id
        join public.materials m on m.id = di.material_id
        join public.material_lots ml on ml.id = di.lot_id
        where d.employee_id = e.id
          and di.quantity - coalesce((select sum(ri.quantity)
            from public.return_items ri join public.returns ret on ret.id = ri.return_id
            where ri.delivery_item_id = di.id
              and (ri.destination is distinct from 'not_returned' or ret.term_signed_at is not null)), 0) > 0
      ) x), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_type', r.request_type, 'material_name', r.material_name_snapshot,
      'description', r.description, 'status', r.status, 'has_attachment', r.attachment_path is not null,
      'created_at', r.created_at, 'updated_at', r.updated_at
    ) order by r.created_at desc) from public.employee_portal_requests r where r.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'function_group', t.function_group, 'course_name', t.course_name,
      'source_annex', t.source_annex, 'mandatory', t.mandatory,
      'validity_months', t.validity_months, 'notes', t.notes
    ) order by t.function_group, t.course_name)
      from public.contract_training_requirements t
      where t.organization_id = e.organization_id
        and (t.function_group = 'Todos os grupos'
          or lower(v_function_name) like '%' || lower(t.function_group) || '%'
          or (t.function_group = 'Poda' and lower(v_function_name) like '%pod%')
          or (t.function_group = 'Operador de Guindauto'
            and (lower(v_function_name) like '%munck%' or lower(v_function_name) like '%guindauto%')))), '[]'::jsonb)
  from public.employees e
  join public.organizations o on o.id = e.organization_id
  left join public.employee_profiles p on p.employee_id = e.id
  where e.registration = trim(p_registration)
    and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and e.status <> 'terminated'
  limit 1;
end;
$$;

drop policy if exists "organization members read employee portal requests" on public.employee_portal_requests;
drop policy if exists "organization members can access employee portal requests" on public.employee_portal_requests;
drop policy if exists "organization members manage employee portal requests" on public.employee_portal_requests;
drop policy if exists "organization admins update employee portal requests" on public.employee_portal_requests;
drop policy if exists "rh manages operational data" on public.employee_portal_requests;
revoke all privileges on table public.employee_portal_requests from public, anon, authenticated;
grant select on table public.employee_portal_requests to authenticated;
grant update (status, review_notes, delivered_at)
  on table public.employee_portal_requests to authenticated;
create policy "hr manages employee portal requests"
  on public.employee_portal_requests for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/requests')
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/requests')
  );

drop policy if exists "organization members can read course documents" on storage.objects;
drop policy if exists "rh can read employee course documents" on storage.objects;
create policy "rh can read employee course documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-course-documents'
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
    and exists (
      select 1 from public.employee_courses c
      where c.certificate_file_path = name
        and c.organization_id = private.current_organization_id()
    )
  );

drop policy if exists "portal_auth_upload_course_documents" on storage.objects;
create policy "rh can upload employee course documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employee-course-documents'
    and name ~ ('^' || private.current_organization_id()::text || '/portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$')
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
  );

drop policy if exists "employee request attachments organization read" on storage.objects;
create policy "rh can read employee request attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-request-attachments'
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/requests')
    and exists (
      select 1 from public.employee_portal_requests r
      where r.attachment_path = name
        and r.organization_id = private.current_organization_id()
    )
  );

-- CPF collected for signatures remains usable by the signing service and RH,
-- but is not selectable or directly writable by operational roles.
revoke all privileges on table public.deliveries from public, anon, authenticated;
grant select (
  id, organization_id, employee_id, delivered_at, reason, responsible_id, notes,
  created_at, term_file_path, term_uploaded_at, term_uploaded_by,
  term_signature_method, term_signed_at, term_signer_name
) on table public.deliveries to authenticated;

revoke all privileges on table public.returns from public, anon, authenticated;
grant select (
  id, organization_id, employee_id, returned_at, reason, responsible_id, notes,
  created_at, term_file_path, term_uploaded_at, term_uploaded_by,
  term_signature_method, term_signed_at, term_signer_name
) on table public.returns to authenticated;
grant update (
  term_file_path, term_uploaded_at, term_uploaded_by,
  term_signature_method, term_signed_at, term_signer_name
) on table public.returns to authenticated;

drop policy if exists "authorized pages can view term signature links" on public.term_signature_links;
create policy "hr can view term signature links"
  on public.term_signature_links for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/discounts')
  );

drop policy if exists "RH can view organization deduction cases" on public.return_deduction_cases;
create policy "RH can view organization deduction cases"
  on public.return_deduction_cases for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/discounts')
  );
drop policy if exists "RH can view organization refusal records" on public.return_deduction_refusal_records;
create policy "RH can view organization refusal records"
  on public.return_deduction_refusal_records for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/discounts')
  );
drop policy if exists "RH can view witnesses for organization refusal records" on public.return_deduction_refusal_witnesses;
create policy "RH can view witnesses for organization refusal records"
  on public.return_deduction_refusal_witnesses for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/discounts')
  );

create or replace function public.get_hr_employee_signature_cpfs(p_employee_id uuid)
returns table (record_type text, record_id uuid, signer_cpf text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Access restricted to HR';
  end if;

  return query
  select 'delivery'::text, d.id, d.term_signer_cpf
  from public.deliveries d
  where d.employee_id = p_employee_id
    and d.organization_id = private.current_organization_id()
    and d.term_signer_cpf is not null
  union all
  select 'return'::text, r.id, r.term_signer_cpf
  from public.returns r
  where r.employee_id = p_employee_id
    and r.organization_id = private.current_organization_id()
    and r.term_signer_cpf is not null;
end;
$$;
revoke all on function public.get_hr_employee_signature_cpfs(uuid) from public, anon, service_role;
grant execute on function public.get_hr_employee_signature_cpfs(uuid) to authenticated;

create or replace function public.record_hr_delivery_term_signature(
  p_delivery_id uuid,
  p_term_file_path text,
  p_signed_at timestamptz,
  p_signature_method text,
  p_signer_name text,
  p_signer_cpf text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.current_organization_id();
  v_cpf text := regexp_replace(coalesce(p_signer_cpf, ''), '\D', '', 'g');
begin
  if auth.uid() is null or v_organization_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Access restricted to HR';
  end if;
  if p_delivery_id is null or p_signature_method not in ('assisted', 'physical_upload')
    or p_signature_method is null or nullif(trim(p_signer_name), '') is null
    or length(trim(p_signer_name)) > 200 or length(v_cpf) <> 11
    or p_term_file_path is null
    or left(p_term_file_path, length(v_organization_id::text || '/' || p_delivery_id::text || '/'))
      <> (v_organization_id::text || '/' || p_delivery_id::text || '/') then
    raise exception 'Invalid delivery signature data';
  end if;
  update public.deliveries d
  set term_file_path = p_term_file_path,
      term_uploaded_at = coalesce(p_signed_at, now()),
      term_uploaded_by = auth.uid(),
      term_signature_method = p_signature_method,
      term_signed_at = coalesce(p_signed_at, now()),
      term_signer_name = trim(p_signer_name),
      term_signer_cpf = v_cpf
  where d.id = p_delivery_id and d.organization_id = v_organization_id
    and d.term_signed_at is null;
  if not found then raise exception 'Delivery not found or already signed'; end if;
end;
$$;
revoke all on function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text)
  from public, anon, service_role;
grant execute on function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text)
  to authenticated;

create or replace function public.record_hr_return_term_signature(
  p_return_id uuid,
  p_term_file_path text,
  p_signed_at timestamptz,
  p_signature_method text,
  p_signer_name text,
  p_signer_cpf text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.current_organization_id();
  v_cpf text := regexp_replace(coalesce(p_signer_cpf, ''), '\D', '', 'g');
begin
  if auth.uid() is null or v_organization_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Access restricted to HR';
  end if;
  if p_return_id is null or p_signature_method not in ('assisted', 'physical_upload')
    or p_signature_method is null or nullif(trim(p_signer_name), '') is null
    or length(trim(p_signer_name)) > 200 or length(v_cpf) <> 11
    or p_term_file_path is null
    or left(p_term_file_path, length(v_organization_id::text || '/' || p_return_id::text || '/'))
      <> (v_organization_id::text || '/' || p_return_id::text || '/') then
    raise exception 'Invalid return signature data';
  end if;
  update public.returns r
  set term_file_path = p_term_file_path,
      term_uploaded_at = coalesce(p_signed_at, now()),
      term_uploaded_by = auth.uid(),
      term_signature_method = p_signature_method,
      term_signed_at = coalesce(p_signed_at, now()),
      term_signer_name = trim(p_signer_name),
      term_signer_cpf = v_cpf
  where r.id = p_return_id and r.organization_id = v_organization_id
    and r.term_signed_at is null;
  if not found then raise exception 'Return not found or already signed'; end if;
end;
$$;
revoke all on function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text)
  from public, anon, service_role;
grant execute on function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text)
  to authenticated;

create policy "hr can delete employee course documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'employee-course-documents'
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
    and exists (
      select 1 from public.employee_courses c
      where c.certificate_file_path = name
        and c.organization_id = private.current_organization_id()
    )
  );

drop policy if exists "employee request attachments organization delete" on storage.objects;
drop policy if exists "employee request attachments organization update" on storage.objects;
create policy "hr can delete employee request attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'employee-request-attachments'
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/requests')
    and exists (
      select 1 from public.employee_portal_requests r
      where r.attachment_path = name
        and r.organization_id = private.current_organization_id()
    )
  );
