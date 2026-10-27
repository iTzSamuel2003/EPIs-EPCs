-- HR-only attendance tracking. Attendance values are recorded for review; this
-- migration intentionally does not calculate payroll or authorize deductions.

create table public.attendance_function_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  function_name text not null,
  function_key text generated always as (
    lower(regexp_replace(trim(function_name), '[[:space:]]+', ' ', 'g'))
  ) stored,
  receives_attendance boolean not null default false,
  monthly_amount numeric(12, 2) not null default 0 check (monthly_amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_function_rules_name_check
    check (length(trim(function_name)) between 1 and 150),
  constraint attendance_function_rules_org_key unique (organization_id, function_key),
  constraint attendance_function_rules_org_id_unique unique (organization_id, id)
);

create table public.attendance_period_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  function_rule_id_snapshot uuid,
  period_start date not null,
  period_end date not null,
  function_name_snapshot text not null,
  receives_attendance_snapshot boolean not null default false,
  monthly_amount_snapshot numeric(12, 2) not null default 0
    check (monthly_amount_snapshot >= 0),
  reduction_amount_snapshot numeric(12, 2) not null default 0
    check (reduction_amount_snapshot >= 0),
  estimated_amount_snapshot numeric(12, 2) not null default 0
    check (estimated_amount_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_period_records_range_check
    check (period_end >= period_start and period_end < period_start + 31),
  constraint attendance_period_records_employee_period_unique
    unique (organization_id, employee_id, period_start, period_end),
  constraint attendance_period_records_function_rule_fk
    foreign key (organization_id, function_rule_id_snapshot)
    references public.attendance_function_rules (organization_id, id)
    on delete no action
);

create table public.attendance_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  attendance_record_id uuid not null
    references public.attendance_period_records(id) on delete cascade,
  occurrence_type text not null check (occurrence_type in (
    'late',
    'absence_justified',
    'absence_unjustified',
    'convocation_absence',
    'medical_certificate',
    'warning'
  )),
  occurred_on date not null,
  occurred_at time without time zone,
  days_count integer not null default 1 check (days_count between 1 and 31),
  created_at timestamptz not null default now(),
  constraint attendance_occurrences_details_check check (
    (occurrence_type = 'late' and occurred_at is not null and days_count = 1)
    or (occurrence_type in (
      'absence_justified', 'absence_unjustified', 'convocation_absence', 'medical_certificate'
    ) and occurred_at is null)
    or (occurrence_type = 'warning' and occurred_at is null and days_count = 1)
  )
);

create table public.attendance_collective_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  quality_status text not null default 'not_evaluated'
    check (quality_status in ('not_evaluated', 'meets', 'does_not_meet')),
  service_cancellation_status text not null default 'not_evaluated'
    check (service_cancellation_status in ('not_evaluated', 'meets', 'does_not_meet')),
  safety_status text not null default 'not_evaluated'
    check (safety_status in ('not_evaluated', 'meets', 'does_not_meet')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_collective_assessments_range_check
    check (period_end >= period_start and period_end < period_start + 31),
  constraint attendance_collective_assessments_org_period_unique
    unique (organization_id, period_start, period_end)
);

create table public.attendance_reduction_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  function_rule_id uuid not null,
  criterion_key text not null check (criterion_key in (
    'late', 'absence_justified', 'absence_unjustified',
    'convocation_absence', 'medical_certificate', 'warning',
    'quality', 'service_cancellation', 'safety'
  )),
  reduction_amount numeric(12, 2) not null default 0
    check (reduction_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_reduction_rules_function_fk
    foreign key (organization_id, function_rule_id)
    references public.attendance_function_rules (organization_id, id)
    on delete cascade,
  constraint attendance_reduction_rules_function_criterion_unique
    unique (organization_id, function_rule_id, criterion_key)
);

create index attendance_period_records_employee_period_idx
  on public.attendance_period_records (employee_id, period_start desc, period_end desc);
create index attendance_period_records_org_period_idx
  on public.attendance_period_records (organization_id, period_start desc);
create index attendance_occurrences_record_date_idx
  on public.attendance_occurrences (attendance_record_id, occurred_on);
create index attendance_period_records_function_rule_idx
  on public.attendance_period_records (organization_id, function_rule_id_snapshot)
  where function_rule_id_snapshot is not null;

alter table public.attendance_function_rules enable row level security;
alter table public.attendance_period_records enable row level security;
alter table public.attendance_occurrences enable row level security;
alter table public.attendance_collective_assessments enable row level security;
alter table public.attendance_reduction_rules enable row level security;

revoke all privileges on table public.attendance_function_rules,
  public.attendance_period_records, public.attendance_occurrences,
  public.attendance_collective_assessments, public.attendance_reduction_rules
  from public, anon, authenticated;
grant select, insert, update, delete on table public.attendance_function_rules,
  public.attendance_period_records, public.attendance_occurrences,
  public.attendance_collective_assessments, public.attendance_reduction_rules
  to authenticated;

create policy "hr manages attendance function rules"
  on public.attendance_function_rules for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  );

create policy "hr manages attendance period records"
  on public.attendance_period_records for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
    and exists (
      select 1 from public.employees employee
      where employee.id = employee_id
        and employee.organization_id = attendance_period_records.organization_id
    )
  );

create policy "hr manages attendance occurrences"
  on public.attendance_occurrences for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
    and exists (
      select 1 from public.attendance_period_records record
      where record.id = attendance_record_id
        and record.organization_id = attendance_occurrences.organization_id
    )
  );

create policy "hr manages collective attendance assessments"
  on public.attendance_collective_assessments for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  );

create policy "hr manages attendance reduction rules"
  on public.attendance_reduction_rules for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and (select private.current_user_can_access_page('/attendance'))
  );

-- Attendance is a restricted RH route even if a page override is accidentally
-- assigned to another role.
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

  if p_page in ('/discounts', '/attendance')
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
      '/employees', '/deliveries', '/returns', '/discounts', '/attendance',
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
set page_paths = array(select distinct unnest(page_paths || array['/attendance']))
where role::text = 'rh' and not ('/attendance' = any(page_paths));

update public.organization_role_access
set page_paths = array_remove(page_paths, '/attendance')
where role::text <> 'rh' and '/attendance' = any(page_paths);

update public.profile_access_overrides access
set page_paths = array_remove(access.page_paths, '/attendance')
from public.profiles profile
where profile.id = access.profile_id
  and profile.role::text not in ('admin', 'rh')
  and '/attendance' = any(access.page_paths);

drop policy if exists "authorized pages read operational employee directory" on public.employees;
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
      or private.current_user_can_access_page('/attendance')
    )
  );

-- Existing function names become selectable rules with no benefit enabled by
-- default; HR explicitly decides eligibility and the monthly reference amount.
insert into public.attendance_function_rules (organization_id, function_name)
select distinct employee.organization_id,
  case
    when nullif(trim(employee.function_classification), '') is not null
      and coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''))
        ~* ('[[:space:]]+' || trim(employee.function_classification) || '$')
      then coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''))
    else trim(concat_ws(' ',
      coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), '')),
      nullif(trim(employee.function_classification), '')
    ))
  end
from public.employees employee
where coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), '')) is not null
on conflict do nothing;

insert into public.attendance_reduction_rules (organization_id, function_rule_id, criterion_key)
select function_rule.organization_id, function_rule.id, criteria.criterion_key
from public.attendance_function_rules function_rule
cross join (values
  ('late'), ('absence_justified'), ('absence_unjustified'),
  ('convocation_absence'), ('medical_certificate'), ('warning'),
  ('quality'), ('service_cancellation'), ('safety')
) as criteria(criterion_key)
on conflict (organization_id, function_rule_id, criterion_key) do nothing;

create or replace function private.seed_attendance_function_reduction_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.attendance_reduction_rules (organization_id, function_rule_id, criterion_key)
  select new.organization_id, new.id, criteria.criterion_key
  from (values
    ('late'), ('absence_justified'), ('absence_unjustified'),
    ('convocation_absence'), ('medical_certificate'), ('warning'),
    ('quality'), ('service_cancellation'), ('safety')
  ) as criteria(criterion_key)
  on conflict (organization_id, function_rule_id, criterion_key) do nothing;
  return new;
end;
$$;
revoke all on function private.seed_attendance_function_reduction_rules() from public, anon, authenticated;
drop trigger if exists attendance_function_seed_reduction_rules on public.attendance_function_rules;
create trigger attendance_function_seed_reduction_rules
  after insert on public.attendance_function_rules
  for each row execute function private.seed_attendance_function_reduction_rules();

create or replace function private.calculate_attendance_reduction_amount(
  p_organization_id uuid,
  p_attendance_record_id uuid
)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_reduction numeric(12, 2);
begin
  if auth.uid() is null
    or p_organization_id <> private.current_organization_id()
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/attendance') then
    raise exception 'Acesso restrito ao RH';
  end if;

  select least(record.monthly_amount_snapshot,
    coalesce(event_reductions.total, 0) + coalesce(collective_reductions.total, 0)
  ) into v_reduction
  from public.attendance_period_records record
  left join lateral (
    select sum(rule.reduction_amount * case
      when occurrence.occurrence_type in (
        'absence_justified', 'absence_unjustified',
        'convocation_absence', 'medical_certificate'
      ) then occurrence.days_count
      else 1
    end) as total
    from public.attendance_occurrences occurrence
    join public.attendance_reduction_rules rule
      on rule.organization_id = occurrence.organization_id
      and rule.function_rule_id = record.function_rule_id_snapshot
      and rule.criterion_key = occurrence.occurrence_type
    where occurrence.organization_id = record.organization_id
      and occurrence.attendance_record_id = record.id
  ) event_reductions on true
  left join lateral (
    select sum(rule.reduction_amount) as total
    from public.attendance_collective_assessments assessment
    cross join lateral (values
      ('quality', assessment.quality_status),
      ('service_cancellation', assessment.service_cancellation_status),
      ('safety', assessment.safety_status)
    ) as criterion(criterion_key, status)
    join public.attendance_reduction_rules rule
      on rule.organization_id = assessment.organization_id
      and rule.function_rule_id = record.function_rule_id_snapshot
      and rule.criterion_key = criterion.criterion_key
    where assessment.organization_id = record.organization_id
      and assessment.period_start = record.period_start
      and assessment.period_end = record.period_end
      and criterion.status = 'does_not_meet'
  ) collective_reductions on true
  where record.id = p_attendance_record_id
    and record.organization_id = p_organization_id;

  if v_reduction is null then
    raise exception 'Registro de assiduidade não encontrado';
  end if;
  return v_reduction;
end;
$$;
revoke all on function private.calculate_attendance_reduction_amount(uuid, uuid)
  from public, anon;
grant execute on function private.calculate_attendance_reduction_amount(uuid, uuid)
  to authenticated;

create or replace function public.save_attendance_period_record(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_events jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organization uuid := private.current_organization_id();
  v_user uuid := auth.uid();
  v_function_name text;
  v_function_rule_id uuid;
  v_receives_attendance boolean := false;
  v_monthly_amount numeric(12, 2) := 0;
  v_record_id uuid;
  v_event jsonb;
  v_type text;
  v_date date;
  v_time time without time zone;
  v_days integer;
  v_reduction numeric(12, 2);
begin
  if v_user is null or v_organization is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/attendance') then
    raise exception 'Acesso restrito ao RH';
  end if;
  if p_period_start is null or p_period_end is null
    or p_period_end < p_period_start or p_period_end - p_period_start > 30 then
    raise exception 'Período inválido: use até 31 dias';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array'
    or jsonb_array_length(p_events) > 100 then
    raise exception 'Lista de ocorrências inválida';
  end if;

  select case
      when nullif(trim(employee.function_classification), '') is not null
        and coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''))
          ~* ('[[:space:]]+' || trim(employee.function_classification) || '$')
        then coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''))
      else trim(concat_ws(' ',
        coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), '')),
        nullif(trim(employee.function_classification), '')
      ))
    end
    into v_function_name
  from public.employees employee
  where employee.id = p_employee_id
    and employee.organization_id = v_organization;
  if not found then raise exception 'Colaborador não encontrado nesta organização'; end if;
  v_function_name := coalesce(nullif(v_function_name, ''), 'Não informado');

  if exists (
    select 1 from public.attendance_period_records existing_record
    where existing_record.organization_id = v_organization
      and existing_record.employee_id = p_employee_id
      and existing_record.period_start <= p_period_end
      and existing_record.period_end >= p_period_start
      and (existing_record.period_start, existing_record.period_end)
        <> (p_period_start, p_period_end)
  ) then
    raise exception 'O período informado se sobrepõe a outro registro deste colaborador';
  end if;

  select rule.id, rule.receives_attendance, rule.monthly_amount
    into v_function_rule_id, v_receives_attendance, v_monthly_amount
  from public.attendance_function_rules rule
  where rule.organization_id = v_organization
    and rule.active
    and rule.function_key = lower(regexp_replace(trim(v_function_name), '[[:space:]]+', ' ', 'g'));
  if not found then
    v_function_rule_id := null;
    v_receives_attendance := false;
    v_monthly_amount := 0;
  end if;
  if not v_receives_attendance then v_monthly_amount := 0; end if;

  insert into public.attendance_period_records (
    organization_id, employee_id, period_start, period_end,
    function_rule_id_snapshot,
    function_name_snapshot, receives_attendance_snapshot, monthly_amount_snapshot,
    reduction_amount_snapshot, estimated_amount_snapshot
  ) values (
    v_organization, p_employee_id, p_period_start, p_period_end, v_function_rule_id,
    v_function_name, v_receives_attendance, v_monthly_amount, 0, v_monthly_amount
  )
  on conflict (organization_id, employee_id, period_start, period_end) do update set
    function_rule_id_snapshot = excluded.function_rule_id_snapshot,
    function_name_snapshot = excluded.function_name_snapshot,
    receives_attendance_snapshot = excluded.receives_attendance_snapshot,
    monthly_amount_snapshot = excluded.monthly_amount_snapshot,
    estimated_amount_snapshot = excluded.estimated_amount_snapshot,
    reduction_amount_snapshot = 0,
    updated_at = now()
  returning id into v_record_id;

  delete from public.attendance_occurrences occurrence
  where occurrence.organization_id = v_organization
    and occurrence.attendance_record_id = v_record_id;

  for v_event in select value from jsonb_array_elements(p_events) as entry(value)
  loop
    v_type := v_event->>'type';
    v_date := nullif(v_event->>'date', '')::date;
    v_time := nullif(v_event->>'time', '')::time;
    v_days := coalesce(nullif(v_event->>'days', '')::integer, 1);

    if v_type not in (
      'late', 'absence_justified', 'absence_unjustified',
      'convocation_absence', 'medical_certificate', 'warning'
    ) or v_date is null
      or v_date < p_period_start
      or v_date > p_period_end
      or v_days < 1 or v_days > 31
      or (v_type = 'late' and (v_time is null or v_days <> 1))
      or (v_type <> 'late' and v_time is not null)
      or (v_type = 'warning' and v_days <> 1) then
      raise exception 'Ocorrência inválida para o período selecionado';
    end if;

    insert into public.attendance_occurrences (
      organization_id, attendance_record_id, occurrence_type,
      occurred_on, occurred_at, days_count
    ) values (
      v_organization, v_record_id, v_type, v_date, v_time, v_days
    );
  end loop;

  v_reduction := private.calculate_attendance_reduction_amount(v_organization, v_record_id);
  update public.attendance_period_records
  set reduction_amount_snapshot = v_reduction,
      estimated_amount_snapshot = greatest(monthly_amount_snapshot - v_reduction, 0),
      updated_at = now()
  where id = v_record_id and organization_id = v_organization;

  return v_record_id;
end;
$$;
revoke all on function public.save_attendance_period_record(uuid, date, date, jsonb)
  from public, anon, service_role;
grant execute on function public.save_attendance_period_record(uuid, date, date, jsonb)
  to authenticated;

create or replace function private.refresh_attendance_period_estimates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_period_start date;
  v_period_end date;
begin
  if tg_op = 'DELETE' then
    v_organization_id := old.organization_id;
    v_period_start := old.period_start;
    v_period_end := old.period_end;
  else
    v_organization_id := new.organization_id;
    v_period_start := new.period_start;
    v_period_end := new.period_end;
  end if;

  if auth.uid() is null
    or v_organization_id <> private.current_organization_id()
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/attendance') then
    raise exception 'Acesso restrito ao RH';
  end if;

  update public.attendance_period_records record
  set reduction_amount_snapshot = private.calculate_attendance_reduction_amount(
        record.organization_id, record.id
      ),
      estimated_amount_snapshot = greatest(
        record.monthly_amount_snapshot - private.calculate_attendance_reduction_amount(record.organization_id, record.id),
        0
      ),
      updated_at = now()
  where record.organization_id = v_organization_id
    and record.period_start = v_period_start
    and record.period_end = v_period_end;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.refresh_attendance_period_estimates() from public, anon, authenticated;
drop trigger if exists attendance_collective_refresh_estimates on public.attendance_collective_assessments;
create trigger attendance_collective_refresh_estimates
  after insert or update or delete on public.attendance_collective_assessments
  for each row execute function private.refresh_attendance_period_estimates();

drop trigger if exists attendance_function_rules_audit on public.attendance_function_rules;
create trigger attendance_function_rules_audit
  after insert or update or delete on public.attendance_function_rules
  for each row execute function public.audit_row_change();
drop trigger if exists attendance_period_records_audit on public.attendance_period_records;
create trigger attendance_period_records_audit
  after insert or update or delete on public.attendance_period_records
  for each row execute function public.audit_row_change();
drop trigger if exists attendance_occurrences_audit on public.attendance_occurrences;
create trigger attendance_occurrences_audit
  after insert or update or delete on public.attendance_occurrences
  for each row execute function public.audit_row_change();
drop trigger if exists attendance_collective_assessments_audit on public.attendance_collective_assessments;
create trigger attendance_collective_assessments_audit
  after insert or update or delete on public.attendance_collective_assessments
  for each row execute function public.audit_row_change();
drop trigger if exists attendance_reduction_rules_audit on public.attendance_reduction_rules;
create trigger attendance_reduction_rules_audit
  after insert or update or delete on public.attendance_reduction_rules
  for each row execute function public.audit_row_change();
