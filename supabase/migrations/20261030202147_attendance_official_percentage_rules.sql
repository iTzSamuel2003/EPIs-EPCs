-- Implements the official attendance allowance clause without treating
-- warnings or legally justified absences as automatic full-loss events.

alter table public.attendance_occurrences
  add column if not exists is_unjustified boolean not null default false,
  add column if not exists missing_time_record boolean not null default false,
  add column if not exists convocation_notice_hours integer;

alter table public.attendance_occurrences
  drop constraint if exists attendance_occurrences_details_check,
  add constraint attendance_occurrences_details_check check (
    (occurrence_type = 'late'
      and days_count = 1
      and convocation_notice_hours is null
      and ((occurred_at is not null and not missing_time_record)
        or (occurred_at is null and missing_time_record)))
    or (occurrence_type = 'convocation_absence'
      and occurred_at is null
      and not missing_time_record
      and (convocation_notice_hours is null or convocation_notice_hours between 0 and 720))
    or (occurrence_type in ('absence_justified', 'absence_unjustified', 'medical_certificate')
      and occurred_at is null
      and not missing_time_record
      and convocation_notice_hours is null)
    or (occurrence_type = 'warning'
      and occurred_at is null
      and days_count = 1
      and not missing_time_record
      and convocation_notice_hours is null)
  ),
  add constraint attendance_occurrences_unjustified_type_check check (
    not is_unjustified or occurrence_type in ('late', 'convocation_absence')
  );

alter table public.attendance_period_records
  add column if not exists quality_occurrence_count integer not null default 0,
  add column if not exists service_cancellation_occurrence_count integer not null default 0,
  add column if not exists safety_status text not null default 'not_evaluated';

alter table public.attendance_period_records
  drop constraint if exists attendance_record_quality_count_check,
  add constraint attendance_record_quality_count_check
    check (quality_occurrence_count between 0 and 100000),
  drop constraint if exists attendance_record_service_count_check,
  add constraint attendance_record_service_count_check
    check (service_cancellation_occurrence_count between 0 and 100000),
  drop constraint if exists attendance_record_safety_status_check,
  add constraint attendance_record_safety_status_check
    check (safety_status in ('not_evaluated', 'meets', 'does_not_meet'));

comment on column public.attendance_occurrences.is_unjustified is
  'Indica se atraso ou ausência a convocação foi apurada como injustificada.';
comment on column public.attendance_occurrences.missing_time_record is
  'Indica ausência de registro de ponto para uma ocorrência de jornada.';
comment on column public.attendance_occurrences.convocation_notice_hours is
  'Antecedência em horas da convocação, usada para validar a regra oficial de 24 horas.';
comment on column public.attendance_period_records.quality_occurrence_count is
  'Quantidade de ocorrências de qualidade atribuídas individualmente ao colaborador no período.';
comment on column public.attendance_period_records.service_cancellation_occurrence_count is
  'Quantidade de cancelamentos/atrasos sem aviso atribuídos individualmente ao colaborador no período.';
comment on column public.attendance_period_records.safety_status is
  'Resultado de segurança atribuído individualmente após apuração de responsabilidade direta.';

-- Collective criteria are now recorded on each employee period, not organization-wide.
drop trigger if exists attendance_collective_refresh_estimates
  on public.attendance_collective_assessments;

create or replace function private.calculate_attendance_reduction_amount(
  p_organization_id uuid,
  p_attendance_record_id uuid
)
returns numeric
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_monthly_amount numeric(12, 2);
  v_individual_percent numeric := 0;
  v_collective_percent numeric := 0;
  v_qualifying_days integer := 0;
  v_has_full_individual_reduction boolean := false;
  v_quality_count integer := 0;
  v_service_count integer := 0;
  v_safety_status text := 'not_evaluated';
begin
  if auth.uid() is null
    or p_organization_id <> private.current_organization_id()
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/attendance') then
    raise exception 'Acesso restrito ao RH';
  end if;

  select record.monthly_amount_snapshot,
         record.quality_occurrence_count,
         record.service_cancellation_occurrence_count,
         record.safety_status
    into v_monthly_amount, v_quality_count, v_service_count, v_safety_status
  from public.attendance_period_records record
  where record.id = p_attendance_record_id
    and record.organization_id = p_organization_id;
  if not found then
    raise exception 'Registro de assiduidade não encontrado';
  end if;

  select exists (
    select 1
    from public.attendance_occurrences occurrence
    where occurrence.organization_id = p_organization_id
      and occurrence.attendance_record_id = p_attendance_record_id
      and (
        occurrence.occurrence_type = 'absence_unjustified'
        or (occurrence.occurrence_type = 'late'
          and (occurrence.is_unjustified or occurrence.missing_time_record))
        or (occurrence.occurrence_type = 'convocation_absence'
          and occurrence.is_unjustified
          and occurrence.convocation_notice_hours >= 24)
      )
  ) into v_has_full_individual_reduction;

  if v_has_full_individual_reduction then
    v_individual_percent := 100;
  else
    select coalesce(sum(occurrence.days_count), 0)::integer
      into v_qualifying_days
    from public.attendance_occurrences occurrence
    where occurrence.organization_id = p_organization_id
      and occurrence.attendance_record_id = p_attendance_record_id
      and occurrence.occurrence_type in ('absence_justified', 'medical_certificate');
    if v_qualifying_days > 1 then
      v_individual_percent := 50;
    end if;
  end if;

  v_collective_percent := least(100,
    case when v_quality_count > 3 then 100 else v_quality_count * 10 end
    + case when v_service_count > 2 then 100 else v_service_count * 20 end
    + case when v_safety_status = 'does_not_meet' then 100 else 0 end
  );

  return least(v_monthly_amount,
    round(v_monthly_amount * least(100, v_individual_percent + v_collective_percent) / 100, 2)
  )::numeric(12, 2);
end;
$$;

revoke all on function private.calculate_attendance_reduction_amount(uuid, uuid)
  from public, anon;
grant execute on function private.calculate_attendance_reduction_amount(uuid, uuid)
  to authenticated;

create or replace function public.save_attendance_period_record_scoped(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_scope_name text,
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
  v_function_key text;
  v_scope_name text := coalesce(nullif(trim(p_scope_name), ''), 'Geral');
  v_scope_key text;
  v_function_rule_id uuid;
  v_rule_active boolean := false;
  v_receives_attendance boolean := false;
  v_monthly_amount numeric(12, 2) := 0;
  v_record_id uuid;
  v_event jsonb;
  v_type text;
  v_date date;
  v_time time without time zone;
  v_days integer;
  v_is_unjustified boolean;
  v_missing_time_record boolean;
  v_notice_hours integer;
  v_reduction numeric(12, 2);
  v_event_list jsonb;
  v_collective jsonb := '{}'::jsonb;
  v_quality_count integer := 0;
  v_service_count integer := 0;
  v_safety_status text := 'not_evaluated';
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
  if char_length(v_scope_name) > 150 then
    raise exception 'Centro/unidade inválido';
  end if;
  if p_events is null then
    raise exception 'Lista de ocorrências inválida';
  end if;
  if jsonb_typeof(p_events) = 'array' then
    -- Backward-compatible payload from clients that have not refreshed yet.
    v_event_list := p_events;
  elsif jsonb_typeof(p_events) = 'object'
    and jsonb_typeof(p_events->'events') = 'array'
    and (p_events->'collective' is null or jsonb_typeof(p_events->'collective') = 'object') then
    v_event_list := p_events->'events';
    v_collective := coalesce(p_events->'collective', '{}'::jsonb);
  else
    raise exception 'Lista de ocorrências inválida';
  end if;
  if jsonb_array_length(v_event_list) > 100 then
    raise exception 'Lista de ocorrências inválida';
  end if;
  if coalesce(v_collective->>'quality_occurrence_count', '0') !~ '^[0-9]{1,6}$'
    or coalesce(v_collective->>'service_cancellation_occurrence_count', '0') !~ '^[0-9]{1,6}$' then
    raise exception 'Quantidades de critérios coletivos inválidas';
  end if;
  v_quality_count := coalesce((v_collective->>'quality_occurrence_count')::integer, 0);
  v_service_count := coalesce((v_collective->>'service_cancellation_occurrence_count')::integer, 0);
  v_safety_status := coalesce(v_collective->>'safety_status', 'not_evaluated');
  if v_quality_count not between 0 and 100000
    or v_service_count not between 0 and 100000
    or v_safety_status not in ('not_evaluated', 'meets', 'does_not_meet') then
    raise exception 'Critérios coletivos inválidos';
  end if;
  v_scope_key := private.attendance_scope_key(v_scope_name);

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
  v_function_key := private.attendance_scope_key(v_function_name);

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

  select rule.id, rule.active, rule.receives_attendance, rule.monthly_amount
    into v_function_rule_id, v_rule_active, v_receives_attendance, v_monthly_amount
  from public.attendance_function_rules rule
  where rule.organization_id = v_organization
    and rule.scope_key in (v_scope_key, private.attendance_scope_key('Geral'))
    and (
      private.attendance_scope_key(rule.function_name) = private.attendance_scope_key(v_function_name)
      or (private.attendance_scope_key(rule.function_name) = 'eletricista'
        and v_function_key like 'eletricista %'
        and v_function_key not like 'eletricista podador%')
      or (private.attendance_scope_key(rule.function_name) = 'eletricista podador'
        and v_function_key like 'eletricista podador%')
      or (private.attendance_scope_key(rule.function_name) = 'ajudante' and v_function_key like 'ajudante%')
      or (private.attendance_scope_key(rule.function_name) = 'motorista' and v_function_key like 'motorista%')
      or (private.attendance_scope_key(rule.function_name) in ('encarregado', 'encarregada')
        and v_function_key like 'encarregad%')
    )
  order by
    case when rule.scope_key = v_scope_key then 0 else 1 end,
    case when private.attendance_scope_key(rule.function_name) = private.attendance_scope_key(v_function_name) then 0 else 1 end,
    length(private.attendance_scope_key(rule.function_name)) desc,
    private.attendance_scope_key(rule.function_name) asc
  limit 1;
  if not found then
    v_function_rule_id := null;
    v_rule_active := false;
    v_receives_attendance := false;
    v_monthly_amount := 0;
  end if;
  v_receives_attendance := v_rule_active and v_receives_attendance;
  if not v_receives_attendance then v_monthly_amount := 0; end if;

  insert into public.attendance_period_records (
    organization_id, employee_id, period_start, period_end,
    function_rule_id_snapshot, function_name_snapshot, scope_name_snapshot,
    receives_attendance_snapshot, monthly_amount_snapshot,
    reduction_amount_snapshot, estimated_amount_snapshot,
    quality_occurrence_count, service_cancellation_occurrence_count, safety_status
  ) values (
    v_organization, p_employee_id, p_period_start, p_period_end,
    v_function_rule_id, v_function_name, v_scope_name,
    v_receives_attendance, v_monthly_amount, 0, v_monthly_amount,
    v_quality_count, v_service_count, v_safety_status
  )
  on conflict (organization_id, employee_id, period_start, period_end) do update set
    function_rule_id_snapshot = excluded.function_rule_id_snapshot,
    function_name_snapshot = excluded.function_name_snapshot,
    scope_name_snapshot = excluded.scope_name_snapshot,
    receives_attendance_snapshot = excluded.receives_attendance_snapshot,
    monthly_amount_snapshot = excluded.monthly_amount_snapshot,
    estimated_amount_snapshot = excluded.estimated_amount_snapshot,
    quality_occurrence_count = excluded.quality_occurrence_count,
    service_cancellation_occurrence_count = excluded.service_cancellation_occurrence_count,
    safety_status = excluded.safety_status,
    reduction_amount_snapshot = 0,
    updated_at = now()
  returning id into v_record_id;

  delete from public.attendance_occurrences occurrence
  where occurrence.organization_id = v_organization
    and occurrence.attendance_record_id = v_record_id;

  for v_event in select value from jsonb_array_elements(v_event_list) as entry(value)
  loop
    v_type := v_event->>'type';
    v_date := nullif(v_event->>'date', '')::date;
    v_time := nullif(v_event->>'time', '')::time;
    v_days := coalesce(nullif(v_event->>'days', '')::integer, 1);
    v_is_unjustified := coalesce(nullif(v_event->>'unjustified', '')::boolean, false);
    v_missing_time_record := coalesce(nullif(v_event->>'missing_time_record', '')::boolean, false);
    v_notice_hours := nullif(v_event->>'notice_hours', '')::integer;

    if v_type is null or v_type not in (
      'late', 'absence_justified', 'absence_unjustified',
      'convocation_absence', 'medical_certificate', 'warning'
    ) or v_date is null
      or v_date < p_period_start
      or v_date > p_period_end
      or v_days < 1 or v_days > 31
      or (v_type = 'late' and (v_days <> 1 or v_notice_hours is not null
        or (v_time is null and not v_missing_time_record)
        or (v_time is not null and v_missing_time_record)))
      or (v_type = 'convocation_absence' and (v_time is not null or v_missing_time_record
        or (v_notice_hours is not null and v_notice_hours not between 0 and 720)))
      or (v_type in ('absence_justified', 'absence_unjustified', 'medical_certificate')
        and (v_time is not null or v_missing_time_record or v_notice_hours is not null))
      or (v_type = 'warning' and (v_days <> 1 or v_time is not null
        or v_missing_time_record or v_notice_hours is not null))
      or (v_is_unjustified and v_type not in ('late', 'convocation_absence')) then
      raise exception 'Ocorrência inválida para o período selecionado';
    end if;

    insert into public.attendance_occurrences (
      organization_id, attendance_record_id, occurrence_type,
      occurred_on, occurred_at, days_count, is_unjustified,
      missing_time_record, convocation_notice_hours
    ) values (
      v_organization, v_record_id, v_type, v_date, v_time, v_days,
      v_is_unjustified, v_missing_time_record, v_notice_hours
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

revoke all on function public.save_attendance_period_record_scoped(uuid, date, date, text, jsonb)
  from public, anon, service_role;
grant execute on function public.save_attendance_period_record_scoped(uuid, date, date, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
