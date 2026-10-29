-- Unified employee history: attendance events are read from their existing
-- records; complementary HR events are stored separately and kept immutable.

alter table public.attendance_occurrences
  add column created_by uuid references public.profiles(id) on delete set null,
  add column created_by_name_snapshot text,
  add column employee_name_snapshot text,
  add column registration_snapshot text,
  add column function_name_snapshot text;

update public.attendance_occurrences occurrence
set employee_name_snapshot = employee.full_name,
    registration_snapshot = employee.registration,
    function_name_snapshot = coalesce(
      nullif(trim(employee.function_name), ''),
      nullif(trim(employee.job_title), ''),
      'Não informado'
    )
from public.attendance_period_records record
join public.employees employee
  on employee.id = record.employee_id
 and employee.organization_id = record.organization_id
where record.id = occurrence.attendance_record_id
  and record.organization_id = occurrence.organization_id;

create or replace function private.capture_attendance_history_context()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_employee record;
  v_actor_name text;
begin
  select employee.full_name, employee.registration,
    coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''), 'Não informado') as function_name
  into v_employee
  from public.attendance_period_records attendance_record
  join public.employees employee
    on employee.id = attendance_record.employee_id
   and employee.organization_id = attendance_record.organization_id
  where attendance_record.id = new.attendance_record_id
    and attendance_record.organization_id = new.organization_id;

  if not found then
    raise exception 'Não foi possível identificar o colaborador da ocorrência';
  end if;

  new.created_by := coalesce((select auth.uid()), new.created_by);
  select profile.full_name into v_actor_name
  from public.profiles profile
  where profile.id = auth.uid();
  new.created_by_name_snapshot := v_actor_name;
  new.employee_name_snapshot := v_employee.full_name;
  new.registration_snapshot := v_employee.registration;
  new.function_name_snapshot := v_employee.function_name;
  return new;
end;
$$;
revoke all on function private.capture_attendance_history_context() from public, anon, authenticated;
create trigger attendance_occurrences_capture_history
  before insert on public.attendance_occurrences
  for each row execute function private.capture_attendance_history_context();

create table public.employee_hr_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  event_type text not null check (event_type in ('suspension', 'leave', 'recognition', 'other')),
  occurred_on date not null,
  end_date date,
  title text not null,
  details text not null default '',
  employee_name_snapshot text not null default '',
  registration_snapshot text,
  function_name_snapshot text,
  document_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name_snapshot text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_by_name_snapshot text,
  void_reason text,
  constraint employee_hr_records_date_range_check
    check (end_date is null or end_date >= occurred_on),
  constraint employee_hr_records_title_check
    check (length(trim(title)) between 2 and 160),
  constraint employee_hr_records_details_check
    check (length(details) <= 4000),
  constraint employee_hr_records_void_check
    check ((voided_at is null and voided_by is null and void_reason is null)
      or (voided_at is not null and voided_by is not null and length(trim(void_reason)) between 3 and 500)),
  constraint employee_hr_records_document_path_check
    check (document_path is null or length(document_path) <= 500)
);

create index employee_hr_records_employee_date_idx
  on public.employee_hr_records (organization_id, employee_id, occurred_on desc, created_at desc);
create index employee_hr_records_org_date_idx
  on public.employee_hr_records (organization_id, occurred_on desc, created_at desc);

alter table public.employee_hr_records enable row level security;
revoke all privileges on table public.employee_hr_records from public, anon, authenticated;
grant select, insert, update on table public.employee_hr_records to authenticated;

create policy "hr can read employee history records"
  on public.employee_hr_records for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
  );
create policy "hr can create employee history records"
  on public.employee_hr_records for insert to authenticated
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
  );
create policy "hr can update employee history records"
  on public.employee_hr_records for update to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
  );

create or replace function private.prepare_employee_hr_record()
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
    or not private.current_user_can_access_page('/employee-history') then
    raise exception 'Acesso restrito ao RH';
  end if;

  if tg_op = 'INSERT' then
    select employee.full_name, employee.registration,
      coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''), 'Não informado') as function_name
    into v_employee
    from public.employees employee
    where employee.id = new.employee_id
      and employee.organization_id = new.organization_id;
    if not found then raise exception 'Colaborador não encontrado nesta organização'; end if;

    new.employee_name_snapshot := v_employee.full_name;
    new.registration_snapshot := v_employee.registration;
    new.function_name_snapshot := v_employee.function_name;
    new.created_by := auth.uid();
    select profile.full_name into v_actor_name
    from public.profiles profile where profile.id = auth.uid();
    new.created_by_name_snapshot := v_actor_name;
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.document_path := null;
    new.voided_at := null;
    new.voided_by := null;
    new.voided_by_name_snapshot := null;
    new.void_reason := null;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.employee_id is distinct from old.employee_id
    or new.event_type is distinct from old.event_type
    or new.occurred_on is distinct from old.occurred_on
    or new.end_date is distinct from old.end_date
    or new.title is distinct from old.title
    or new.details is distinct from old.details
    or new.employee_name_snapshot is distinct from old.employee_name_snapshot
    or new.registration_snapshot is distinct from old.registration_snapshot
    or new.function_name_snapshot is distinct from old.function_name_snapshot
    or new.created_by is distinct from old.created_by
    or new.created_by_name_snapshot is distinct from old.created_by_name_snapshot
    or new.created_at is distinct from old.created_at then
    raise exception 'Registros históricos não podem ser editados; cancele e registre novamente';
  end if;

  if old.voided_at is not null then
    raise exception 'Este registro já foi cancelado e não pode ser alterado';
  end if;

  if new.document_path is distinct from old.document_path then
    if old.document_path is not null or new.document_path is null then
      raise exception 'O comprovante só pode ser anexado uma vez';
    end if;
    v_folder := storage.foldername(new.document_path);
    if v_folder[1] is distinct from new.organization_id::text
      or v_folder[2] is distinct from new.employee_id::text
      or v_folder[3] is distinct from new.id::text then
      raise exception 'Caminho do comprovante inválido';
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
    raise exception 'Use o motivo para cancelar o registro';
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.prepare_employee_hr_record() from public, anon, authenticated;
create trigger employee_hr_records_prepare
  before insert or update on public.employee_hr_records
  for each row execute function private.prepare_employee_hr_record();

-- Attendance events need to remain readable even if an HR user's custom menu
-- does not include the data-entry page itself.
create policy "hr history can read attendance period records"
  on public.attendance_period_records for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
  );
create policy "hr history can read attendance occurrences"
  on public.attendance_occurrences for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
  );
create policy "hr history can read employee directory"
  on public.employees for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
  );

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

  if p_page in ('/discounts', '/attendance', '/employee-history')
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
      '/employees', '/deliveries', '/returns', '/discounts', '/attendance', '/employee-history',
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
set page_paths = array(select distinct unnest(page_paths || array['/employee-history']))
where role::text = 'rh' and not ('/employee-history' = any(page_paths));

update public.organization_role_access
set page_paths = array_remove(page_paths, '/employee-history')
where role::text <> 'rh' and '/employee-history' = any(page_paths);

update public.profile_access_overrides access
set page_paths = array_remove(access.page_paths, '/employee-history')
from public.profiles profile
where profile.id = access.profile_id
  and profile.organization_id = access.organization_id
  and profile.role::text not in ('admin', 'rh')
  and '/employee-history' = any(access.page_paths);

create or replace view public.employee_hr_history_feed
with (security_invoker = true)
as
select occurrence.id as event_id,
  occurrence.organization_id,
  record.employee_id,
  occurrence.employee_name_snapshot as employee_name,
  occurrence.registration_snapshot as registration,
  occurrence.function_name_snapshot as function_name,
  'attendance'::text as source,
  occurrence.occurrence_type as event_type,
  occurrence.occurred_on,
  null::date as end_date,
  occurrence.occurred_at,
  occurrence.days_count,
  case occurrence.occurrence_type
    when 'late' then 'Atraso na jornada'
    when 'absence_justified' then 'Falta justificada'
    when 'absence_unjustified' then 'Falta injustificada'
    when 'convocation_absence' then 'Falta de convocação'
    when 'medical_certificate' then 'Atestado médico'
    when 'warning' then 'Advertência'
    else 'Ocorrência de assiduidade'
  end::text as title,
  null::text as details,
  record.period_start,
  record.period_end,
  occurrence.created_by,
  occurrence.created_by_name_snapshot as created_by_name,
  occurrence.created_at,
  null::text as document_path,
  null::timestamptz as voided_at,
  null::text as voided_by_name,
  null::text as void_reason
from public.attendance_occurrences occurrence
join public.attendance_period_records record
  on record.id = occurrence.attendance_record_id
 and record.organization_id = occurrence.organization_id
union all
select record.id as event_id,
  record.organization_id,
  record.employee_id,
  record.employee_name_snapshot as employee_name,
  record.registration_snapshot as registration,
  record.function_name_snapshot as function_name,
  'hr'::text as source,
  record.event_type,
  record.occurred_on,
  record.end_date,
  null::time without time zone as occurred_at,
  1::integer as days_count,
  record.title,
  record.details,
  null::date as period_start,
  null::date as period_end,
  record.created_by,
  record.created_by_name_snapshot as created_by_name,
  record.created_at,
  record.document_path,
  record.voided_at,
  record.voided_by_name_snapshot as voided_by_name,
  record.void_reason
from public.employee_hr_records record
;

revoke all on public.employee_hr_history_feed from public, anon;
grant select on public.employee_hr_history_feed to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-hr-history-documents',
  'employee-hr-history-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "hr can read employee history documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-hr-history-documents'
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and exists (
      select 1 from public.employee_hr_records record
      where record.organization_id = private.current_organization_id()
        and record.organization_id::text = (storage.foldername(name))[1]
        and record.employee_id::text = (storage.foldername(name))[2]
        and record.id::text = (storage.foldername(name))[3]
    )
  );
create policy "hr can upload employee history documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employee-hr-history-documents'
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/employee-history'))
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and exists (
      select 1 from public.employee_hr_records record
      where record.organization_id = private.current_organization_id()
        and record.organization_id::text = (storage.foldername(name))[1]
        and record.employee_id::text = (storage.foldername(name))[2]
        and record.id::text = (storage.foldername(name))[3]
        and record.document_path is null
        and record.voided_at is null
    )
  );
