-- HR-only personal data stays separate from the operational employee directory.
create table public.employee_hr_private_data (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  address text,
  pis text,
  bank_name text,
  bank_account text,
  bank_branch text,
  marital_status text,
  dependents text,
  emergency_contact_name text,
  emergency_contact_phone text,
  updated_at timestamptz not null default now(),
  constraint employee_hr_private_data_marital_status_check check (
    marital_status is null or marital_status in ('single', 'married', 'stable_union', 'divorced', 'widowed', 'separated', 'other')
  ),
  constraint employee_hr_private_data_field_lengths_check check (
    (address is null or length(address) <= 600)
    and (pis is null or length(pis) <= 40)
    and (bank_name is null or length(bank_name) <= 120)
    and (bank_account is null or length(bank_account) <= 80)
    and (bank_branch is null or length(bank_branch) <= 40)
    and (dependents is null or length(dependents) <= 4000)
    and (emergency_contact_name is null or length(emergency_contact_name) <= 200)
    and (emergency_contact_phone is null or length(emergency_contact_phone) <= 60)
  )
);

create index employee_hr_private_data_org_employee_idx
  on public.employee_hr_private_data (organization_id, employee_id);

alter table public.employee_hr_private_data enable row level security;
revoke all privileges on table public.employee_hr_private_data from public, anon, authenticated, service_role;
create policy "hr manages private employee data"
  on public.employee_hr_private_data for all to authenticated
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

create or replace function public.get_hr_employee_private_data(p_employee_id uuid)
returns table (
  employee_id uuid,
  birth_date date,
  address text,
  pis text,
  bank_name text,
  bank_account text,
  bank_branch text,
  marital_status text,
  dependents text,
  emergency_contact_name text,
  emergency_contact_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or p_employee_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;

  return query
  select e.id, e.birth_date, d.address, d.pis, d.bank_name, d.bank_account,
    d.bank_branch, d.marital_status, d.dependents, d.emergency_contact_name,
    d.emergency_contact_phone
  from public.employees e
  left join public.employee_hr_private_data d
    on d.employee_id = e.id and d.organization_id = e.organization_id
  where e.id = p_employee_id
    and e.organization_id = private.current_organization_id();
end;
$$;
revoke all on function public.get_hr_employee_private_data(uuid) from public, anon, service_role;
grant execute on function public.get_hr_employee_private_data(uuid) to authenticated;

create or replace function public.save_hr_employee_private_data(
  p_employee_id uuid,
  p_birth_date date,
  p_address text,
  p_pis text,
  p_bank_name text,
  p_bank_account text,
  p_bank_branch text,
  p_marital_status text,
  p_dependents text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.current_organization_id();
begin
  if auth.uid() is null
    or v_organization_id is null
    or p_employee_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;
  if p_birth_date > current_date
    or length(coalesce(p_address, '')) > 600
    or length(coalesce(p_pis, '')) > 40
    or length(coalesce(p_bank_name, '')) > 120
    or length(coalesce(p_bank_account, '')) > 80
    or length(coalesce(p_bank_branch, '')) > 40
    or length(coalesce(p_dependents, '')) > 4000
    or length(coalesce(p_emergency_contact_name, '')) > 200
    or length(coalesce(p_emergency_contact_phone, '')) > 60
    or (p_marital_status is not null and p_marital_status not in ('single', 'married', 'stable_union', 'divorced', 'widowed', 'separated', 'other')) then
    raise exception 'Dados pessoais inválidos ou acima do limite permitido';
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = v_organization_id
  ) then
    raise exception 'Funcionário não encontrado nesta organização';
  end if;

  update public.employees
  set birth_date = p_birth_date
  where id = p_employee_id and organization_id = v_organization_id;

  insert into public.employee_hr_private_data (
    employee_id, organization_id, address, pis, bank_name, bank_account,
    bank_branch, marital_status, dependents, emergency_contact_name,
    emergency_contact_phone, updated_at
  ) values (
    p_employee_id, v_organization_id, nullif(trim(p_address), ''),
    nullif(trim(p_pis), ''), nullif(trim(p_bank_name), ''),
    nullif(trim(p_bank_account), ''), nullif(trim(p_bank_branch), ''),
    nullif(trim(p_marital_status), ''), nullif(trim(p_dependents), ''),
    nullif(trim(p_emergency_contact_name), ''),
    nullif(trim(p_emergency_contact_phone), ''), now()
  )
  on conflict (employee_id) do update set
    organization_id = excluded.organization_id,
    address = excluded.address,
    pis = excluded.pis,
    bank_name = excluded.bank_name,
    bank_account = excluded.bank_account,
    bank_branch = excluded.bank_branch,
    marital_status = excluded.marital_status,
    dependents = excluded.dependents,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    updated_at = now();
end;
$$;
revoke all on function public.save_hr_employee_private_data(uuid, date, text, text, text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.save_hr_employee_private_data(uuid, date, text, text, text, text, text, text, text, text, text)
  to authenticated;

-- These wrappers keep the operational employee update and RH-only fields atomic.
create or replace function public.create_hr_employee_with_private_data(
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
  p_notes text,
  p_birth_date date,
  p_address text,
  p_pis text,
  p_bank_name text,
  p_bank_account text,
  p_bank_branch text,
  p_marital_status text,
  p_dependents text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
begin
  if auth.uid() is null
    or private.current_organization_id() is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;

  v_employee_id := public.create_hr_employee(
    p_registration, p_full_name, p_cpf, p_function_name,
    p_function_classification, p_department, p_unit, p_admission_date,
    p_phone, p_email, p_status, p_notes
  );
  perform public.save_hr_employee_private_data(
    v_employee_id, p_birth_date, p_address, p_pis, p_bank_name,
    p_bank_account, p_bank_branch, p_marital_status, p_dependents,
    p_emergency_contact_name, p_emergency_contact_phone
  );
  return v_employee_id;
end;
$$;
revoke all on function public.create_hr_employee_with_private_data(text, text, text, text, text, text, text, date, text, text, text, text, date, text, text, text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_hr_employee_with_private_data(text, text, text, text, text, text, text, date, text, text, text, text, date, text, text, text, text, text, text, text, text, text)
  to authenticated;

create or replace function public.update_hr_employee_with_private_data(
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
  p_notes text,
  p_birth_date date,
  p_address text,
  p_pis text,
  p_bank_name text,
  p_bank_account text,
  p_bank_branch text,
  p_marital_status text,
  p_dependents text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or private.current_organization_id() is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Acesso restrito ao RH';
  end if;

  perform public.update_hr_employee(
    p_employee_id, p_registration, p_full_name, p_cpf, p_function_name,
    p_function_classification, p_department, p_unit, p_admission_date,
    p_termination_date, p_phone, p_email, p_status, p_notes
  );
  perform public.save_hr_employee_private_data(
    p_employee_id, p_birth_date, p_address, p_pis, p_bank_name,
    p_bank_account, p_bank_branch, p_marital_status, p_dependents,
    p_emergency_contact_name, p_emergency_contact_phone
  );
  return p_employee_id;
end;
$$;
revoke all on function public.update_hr_employee_with_private_data(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text, date, text, text, text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.update_hr_employee_with_private_data(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text, date, text, text, text, text, text, text, text, text, text)
  to authenticated;

-- Anniversary alerts contain only the employee name and the milestone, and are
-- available to RH/Admin through a narrowly scoped function.
create or replace function public.get_hr_employee_milestone_alerts(p_days_ahead integer default 30)
returns table (
  employee_id uuid,
  employee_name text,
  milestone_type text,
  milestone_date date,
  years_of_service integer,
  days_until integer
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
  if p_days_ahead is null or p_days_ahead < 0 or p_days_ahead > 90 then
    raise exception 'O período dos alertas deve estar entre 0 e 90 dias';
  end if;

  return query
  with employees_in_scope as (
    select e.id, e.full_name, e.birth_date, e.admission_date
    from public.employees e
    where e.organization_id = private.current_organization_id()
      and e.status in ('active', 'away')
  ), target_years as (
    select extract(year from current_date)::integer + offset_year as year_number
    from generate_series(0, 1) as years(offset_year)
  ), milestones as (
    select e.id, e.full_name, 'birthday'::text as kind,
      make_date(y.year_number, extract(month from e.birth_date)::integer,
        least(extract(day from e.birth_date)::integer,
          extract(day from (date_trunc('month', make_date(y.year_number, extract(month from e.birth_date)::integer, 1)) + interval '1 month - 1 day'))::integer
        )
      ) as occurs_on,
      null::integer as service_years
    from employees_in_scope e
    cross join target_years y
    where e.birth_date is not null

    union all

    select e.id, e.full_name, 'service_anniversary'::text as kind,
      make_date(y.year_number, extract(month from e.admission_date)::integer,
        least(extract(day from e.admission_date)::integer,
          extract(day from (date_trunc('month', make_date(y.year_number, extract(month from e.admission_date)::integer, 1)) + interval '1 month - 1 day'))::integer
        )
      ) as occurs_on,
      y.year_number - extract(year from e.admission_date)::integer as service_years
    from employees_in_scope e
    cross join target_years y
    where e.admission_date is not null
      and y.year_number > extract(year from e.admission_date)::integer
  )
  select m.id, m.full_name, m.kind, m.occurs_on, m.service_years,
    (m.occurs_on - current_date)::integer
  from milestones m
  where m.occurs_on between current_date and current_date + p_days_ahead
  order by m.occurs_on, m.full_name, m.kind;
end;
$$;
revoke all on function public.get_hr_employee_milestone_alerts(integer) from public, anon, service_role;
grant execute on function public.get_hr_employee_milestone_alerts(integer) to authenticated;

-- The existing interval column is the source of truth: 6 months = flexible,
-- 12 months = rigid. This avoids rewriting materials across inactive orgs.
create or replace function private.refresh_latest_material_test_interval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.test_required
    and old.test_interval_months is distinct from new.test_interval_months
    and new.test_interval_months in (6, 12) then
    update public.material_tests t
    set interval_months = new.test_interval_months,
        next_due_at = (t.performed_at + make_interval(months => new.test_interval_months))::date
    where t.id = (
      select latest.id
      from public.material_tests latest
      where latest.organization_id = new.organization_id
        and latest.material_id = new.id
      order by latest.performed_at desc, latest.created_at desc
      limit 1
    );
  end if;
  return new;
end;
$$;
revoke all on function private.refresh_latest_material_test_interval() from public, anon, authenticated, service_role;
create trigger materials_refresh_latest_test_interval
  after update of test_interval_months on public.materials
  for each row
  when (old.test_interval_months is distinct from new.test_interval_months)
  execute function private.refresh_latest_material_test_interval();

create or replace function public.register_material_test(
  p_material_id uuid,
  p_performed_at date,
  p_interval_months integer,
  p_result text,
  p_examiner text default null,
  p_certificate_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organization_id uuid := private.current_organization_id();
  v_interval_months integer;
  v_test_id uuid;
  v_performed_at date := coalesce(p_performed_at, current_date);
begin
  if v_organization_id is null then
    raise exception 'Usuário sem organização vinculada';
  end if;

  select m.test_interval_months
  into v_interval_months
  from public.materials m
  where m.id = p_material_id
    and m.organization_id = v_organization_id
    and m.status = 'active'
    and m.test_required;

  if not found then
    raise exception 'Material não encontrado, inativo ou sem ensaio obrigatório';
  end if;
  if v_interval_months is null
    or v_interval_months not in (6, 12)
    or p_interval_months is distinct from v_interval_months then
    raise exception 'A periodicidade informada não corresponde ao grupo de ensaio do material';
  end if;

  insert into public.material_tests (
    organization_id, material_id, performed_at, interval_months, next_due_at,
    result, examiner, certificate_number, notes, created_by
  ) values (
    v_organization_id, p_material_id, v_performed_at, v_interval_months,
    (v_performed_at + make_interval(months => v_interval_months))::date,
    p_result, nullif(trim(p_examiner), ''),
    nullif(trim(p_certificate_number), ''), nullif(trim(p_notes), ''), auth.uid()
  ) returning id into v_test_id;

  return v_test_id;
end;
$$;
revoke all on function public.register_material_test(uuid, date, integer, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.register_material_test(uuid, date, integer, text, text, text, text)
  to authenticated;
