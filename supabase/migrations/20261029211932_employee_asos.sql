-- RH-only ASO registry with private files and a current-status view.
-- No diagnosis, CID, laboratory result, or clinical note is collected here.

create or replace function private.current_user_can_access_page(p_page text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_organization uuid := private.current_organization_id();
  v_role text;
  v_page_paths text[];
begin
  if v_user is null or v_organization is null or nullif(trim(p_page), '') is null then
    return false;
  end if;

  select profile.role::text into v_role
  from public.profiles profile
  where profile.id = v_user and profile.organization_id = v_organization;
  if not found then return false; end if;

  if p_page in ('/discounts', '/attendance', '/employee-history', '/asos')
    and coalesce(v_role, '') not in ('admin', 'rh') then
    return false;
  end if;
  if v_role = 'admin' then return true; end if;

  select access.page_paths into v_page_paths
  from public.profile_access_overrides access
  where access.profile_id = v_user and access.organization_id = v_organization;
  if v_page_paths is null then
    select access.page_paths into v_page_paths
    from public.organization_role_access access
    where access.organization_id = v_organization and access.role::text = v_role;
  end if;
  if v_page_paths is not null then return p_page = any(v_page_paths); end if;

  return case v_role
    when 'rh' then p_page = any(array[
      '/employees', '/deliveries', '/returns', '/discounts', '/attendance', '/employee-history', '/asos',
      '/requests', '/stock', '/validities', '/reports'
    ])
    when 'tst' then p_page = any(array[
      '/entries', '/deliveries', '/returns', '/stock', '/validities', '/tests', '/ca', '/reports'
    ])
    else false
  end;
end;
$$;
revoke all on function private.current_user_can_access_page(text) from public, anon;
grant execute on function private.current_user_can_access_page(text) to authenticated, service_role;

update public.organization_role_access
set page_paths = array(select distinct unnest(page_paths || array['/asos']))
where role::text = 'rh' and not ('/asos' = any(page_paths));

update public.organization_role_access
set page_paths = array_remove(page_paths, '/asos')
where role::text <> 'rh' and '/asos' = any(page_paths);

update public.profile_access_overrides access
set page_paths = array_remove(access.page_paths, '/asos')
from public.profiles profile
where profile.id = access.profile_id
  and profile.organization_id = access.organization_id
  and profile.role::text not in ('admin', 'rh')
  and '/asos' = any(access.page_paths);

create table public.employee_asos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  exam_type text not null check (exam_type in ('admission', 'periodic', 'return_to_work', 'risk_change', 'dismissal', 'other')),
  exam_date date not null,
  next_exam_due_date date,
  fitness_result text not null default 'not_recorded' check (fitness_result in ('fit', 'unfit', 'not_recorded')),
  clinic_name text,
  physician_name text,
  physician_registry text,
  employee_name_snapshot text not null default '',
  registration_snapshot text,
  function_name_snapshot text,
  document_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name_snapshot text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_by_name_snapshot text,
  void_reason text,
  constraint employee_asos_due_date_check check (next_exam_due_date is null or next_exam_due_date >= exam_date),
  constraint employee_asos_clinic_check check (clinic_name is null or length(clinic_name) <= 180),
  constraint employee_asos_physician_check check (physician_name is null or length(physician_name) <= 180),
  constraint employee_asos_registry_check check (physician_registry is null or length(physician_registry) <= 80),
  constraint employee_asos_document_path_check check (document_path is null or length(document_path) <= 500),
  constraint employee_asos_void_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null and length(trim(void_reason)) between 3 and 500)
  )
);

create index employee_asos_org_employee_date_idx
  on public.employee_asos (organization_id, employee_id, exam_date desc, created_at desc);
create index employee_asos_org_due_date_idx
  on public.employee_asos (organization_id, next_exam_due_date)
  where voided_at is null and next_exam_due_date is not null;

alter table public.employee_asos enable row level security;
revoke all privileges on table public.employee_asos from public, anon, authenticated;
grant select, insert, update on table public.employee_asos to authenticated;

create policy "hr can read employee asos"
  on public.employee_asos for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/asos'))
  );
create policy "hr can create employee asos"
  on public.employee_asos for insert to authenticated
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/asos'))
  );
create policy "hr can update employee asos"
  on public.employee_asos for update to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/asos'))
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/asos'))
  );

create or replace function private.prepare_employee_aso()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_employee record;
  v_actor_name text;
  v_folder text[];
begin
  if auth.uid() is null
    or new.organization_id is distinct from private.current_organization_id()
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/asos') then
    raise exception 'Acesso restrito ao RH';
  end if;

  if tg_op = 'INSERT' then
    select employee.full_name, employee.registration,
      coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''), 'Não informado') as function_name
    into v_employee
    from public.employees employee
    where employee.id = new.employee_id and employee.organization_id = new.organization_id;
    if not found then raise exception 'Colaborador não encontrado nesta organização'; end if;

    new.employee_name_snapshot := v_employee.full_name;
    new.registration_snapshot := v_employee.registration;
    new.function_name_snapshot := v_employee.function_name;
    new.created_by := auth.uid();
    select profile.full_name into v_actor_name
    from public.profiles profile where profile.id = auth.uid();
    new.created_by_name_snapshot := v_actor_name;
    new.created_at := now();
    new.document_path := null;
    new.voided_at := null;
    new.voided_by := null;
    new.voided_by_name_snapshot := null;
    new.void_reason := null;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.employee_id is distinct from old.employee_id
    or new.exam_type is distinct from old.exam_type
    or new.exam_date is distinct from old.exam_date
    or new.next_exam_due_date is distinct from old.next_exam_due_date
    or new.fitness_result is distinct from old.fitness_result
    or new.clinic_name is distinct from old.clinic_name
    or new.physician_name is distinct from old.physician_name
    or new.physician_registry is distinct from old.physician_registry
    or new.employee_name_snapshot is distinct from old.employee_name_snapshot
    or new.registration_snapshot is distinct from old.registration_snapshot
    or new.function_name_snapshot is distinct from old.function_name_snapshot
    or new.created_by is distinct from old.created_by
    or new.created_by_name_snapshot is distinct from old.created_by_name_snapshot
    or new.created_at is distinct from old.created_at then
    raise exception 'Registros de ASO não podem ser editados; cancele e registre novamente';
  end if;

  if old.voided_at is not null then
    raise exception 'Este ASO já foi cancelado e não pode ser alterado';
  end if;

  if new.document_path is distinct from old.document_path then
    if old.document_path is not null or new.document_path is null then
      raise exception 'O documento do ASO só pode ser anexado uma vez';
    end if;
    v_folder := storage.foldername(new.document_path);
    if v_folder[1] is distinct from new.organization_id::text
      or v_folder[2] is distinct from new.employee_id::text
      or v_folder[3] is distinct from new.id::text then
      raise exception 'Caminho do documento do ASO inválido';
    end if;
  end if;

  if new.void_reason is distinct from old.void_reason then
    if old.void_reason is not null or length(trim(coalesce(new.void_reason, ''))) not between 3 and 500 then
      raise exception 'Informe o motivo do cancelamento (3 a 500 caracteres)';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
    select profile.full_name into v_actor_name
    from public.profiles profile where profile.id = auth.uid();
    new.voided_by_name_snapshot := v_actor_name;
  elsif new.voided_at is distinct from old.voided_at
    or new.voided_by is distinct from old.voided_by
    or new.voided_by_name_snapshot is distinct from old.voided_by_name_snapshot then
    raise exception 'Use o motivo para cancelar o ASO';
  end if;

  return new;
end;
$$;
revoke all on function private.prepare_employee_aso() from public, anon, authenticated;
create trigger employee_asos_prepare
  before insert or update on public.employee_asos
  for each row execute function private.prepare_employee_aso();

create or replace view public.employee_aso_current_status
with (security_invoker = true)
as
select employee.organization_id,
  employee.id as employee_id,
  employee.registration,
  employee.full_name,
  employee.job_title,
  employee.function_name,
  employee.department,
  employee.unit,
  employee.status::text as employee_status,
  aso.id as aso_id,
  aso.exam_type,
  aso.exam_date,
  aso.next_exam_due_date,
  aso.fitness_result,
  aso.clinic_name,
  aso.physician_name,
  aso.physician_registry,
  aso.document_path,
  aso.created_by_name_snapshot,
  aso.created_at as aso_created_at
from public.employees employee
left join lateral (
  select record.id, record.exam_type, record.exam_date, record.next_exam_due_date,
    record.fitness_result, record.clinic_name, record.physician_name,
    record.physician_registry, record.document_path, record.created_by_name_snapshot,
    record.created_at
  from public.employee_asos record
  where record.organization_id = employee.organization_id
    and record.employee_id = employee.id
    and record.voided_at is null
  order by record.exam_date desc, record.created_at desc
  limit 1
) aso on true;
revoke all on public.employee_aso_current_status from public, anon, authenticated;
grant select on public.employee_aso_current_status to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-aso-documents', 'employee-aso-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "hr can read employee aso documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-aso-documents'
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/asos'))
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and exists (
      select 1 from public.employee_asos aso
      where aso.organization_id = private.current_organization_id()
        and aso.organization_id::text = (storage.foldername(name))[1]
        and aso.employee_id::text = (storage.foldername(name))[2]
        and aso.id::text = (storage.foldername(name))[3]
        and aso.document_path = name
    )
  );
create policy "hr can upload employee aso documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employee-aso-documents'
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/asos'))
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and exists (
      select 1 from public.employee_asos aso
      where aso.organization_id = private.current_organization_id()
        and aso.organization_id::text = (storage.foldername(name))[1]
        and aso.employee_id::text = (storage.foldername(name))[2]
        and aso.id::text = (storage.foldername(name))[3]
        and aso.document_path is null
        and aso.voided_at is null
    )
  );
create policy "hr can remove unlinked employee aso uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'employee-aso-documents'
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/asos'))
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and exists (
      select 1 from public.employee_asos aso
      where aso.organization_id = private.current_organization_id()
        and aso.organization_id::text = (storage.foldername(name))[1]
        and aso.employee_id::text = (storage.foldername(name))[2]
        and aso.id::text = (storage.foldername(name))[3]
        and aso.document_path is null
    )
  );
