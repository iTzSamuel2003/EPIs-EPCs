-- Scope attendance benefit proposals by business unit/center and function.
-- Imported workbook amounts remain inactive proposals until HR confirms them.

create or replace function private.attendance_scope_key(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(
      translate(
        lower(trim(coalesce(p_value, ''))),
        'áàâãäåéèêëíìîïóòôõöúùûüçñ',
        'aaaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+', ' ', 'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ));
$$;
revoke all on function private.attendance_scope_key(text) from public, anon;
grant execute on function private.attendance_scope_key(text) to authenticated, service_role;

alter table public.attendance_function_rules
  add column scope_name text not null default 'Geral',
  add column scope_key text generated always as (
    private.attendance_scope_key(scope_name)
  ) stored,
  add column source_note text;

alter table public.attendance_function_rules
  add constraint attendance_function_rules_scope_name_check
    check (length(trim(scope_name)) between 1 and 150);

alter table public.attendance_function_rules
  drop constraint attendance_function_rules_org_key;

alter table public.attendance_function_rules
  add constraint attendance_function_rules_org_scope_key
    unique (organization_id, scope_key, function_key);

alter table public.attendance_period_records
  add column scope_name_snapshot text not null default 'Geral';

alter table public.attendance_period_records
  add constraint attendance_period_records_scope_snapshot_check
    check (length(trim(scope_name_snapshot)) between 1 and 150);

alter table public.attendance_reduction_rules
  add column active boolean not null default false;

-- Never activate old reduction values implicitly.
update public.attendance_reduction_rules set active = false where active;

-- Proposed monthly amounts from the September/2026 workbook. The 10 source
-- rows whose discount exceeded the predicted benefit are intentionally not
-- interpreted as rules; HR must configure each reduction explicitly.
insert into public.attendance_function_rules (
  organization_id, scope_name, function_name, monthly_amount,
  receives_attendance, active, source_note
)
select organization.id, proposal.scope_name, proposal.function_name,
  proposal.monthly_amount, false, false, proposal.source_note
from public.organizations organization
cross join (values
  ('C&M - Dourados', 'ELETRICISTA', 210.00::numeric,
    'Proposta da planilha de setembro/2026. 23 registros indicam R$ 210,00 e 1 registro divergente indica R$ 472,50; aguarda confirmação do RH.'),
  ('C&M - Dourados', 'ENCARREGADO', 472.50::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('C&M - Dourados', 'MOTORISTA', 210.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('C&M - Campo Grande', 'ELETRICISTA', 210.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('C&M - Campo Grande', 'ENCARREGADO', 472.50::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('C&M - Campo Grande', 'MOTORISTA', 210.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('C&M - Naviraí', 'ELETRICISTA', 210.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('C&M - Naviraí', 'ENCARREGADO', 472.50::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - EMS', 'AJUDANTE', 52.50::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - EMS', 'ELETRICISTA', 210.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - EMS', 'ENCARREGADA', 472.50::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - EMS', 'MOTORISTA', 210.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - ESS', 'AJUDANTE', 50.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - ESS', 'ELETRICISTA PODADOR', 200.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - ESS', 'ENCARREGADA', 450.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.'),
  ('Poda - ESS', 'MOTORISTA', 200.00::numeric,
    'Proposta consolidada da planilha de setembro/2026; aguarda confirmação do RH.')
) as proposal(scope_name, function_name, monthly_amount, source_note)
where lower(organization.name) = 'dsx'
on conflict (organization_id, scope_key, function_key) do nothing;

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
      and rule.active
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
      and rule.active
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
  if char_length(v_scope_name) > 150 then
    raise exception 'Centro/unidade inválido';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array'
    or jsonb_array_length(p_events) > 100 then
    raise exception 'Lista de ocorrências inválida';
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
    reduction_amount_snapshot, estimated_amount_snapshot
  ) values (
    v_organization, p_employee_id, p_period_start, p_period_end,
    v_function_rule_id, v_function_name, v_scope_name,
    v_receives_attendance, v_monthly_amount, 0, v_monthly_amount
  )
  on conflict (organization_id, employee_id, period_start, period_end) do update set
    function_rule_id_snapshot = excluded.function_rule_id_snapshot,
    function_name_snapshot = excluded.function_name_snapshot,
    scope_name_snapshot = excluded.scope_name_snapshot,
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
revoke all on function public.save_attendance_period_record_scoped(uuid, date, date, text, jsonb)
  from public, anon, service_role;
grant execute on function public.save_attendance_period_record_scoped(uuid, date, date, text, jsonb)
  to authenticated;

create or replace function public.save_attendance_period_record(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_events jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.save_attendance_period_record_scoped(
    p_employee_id, p_period_start, p_period_end, 'Geral', p_events
  );
$$;
revoke all on function public.save_attendance_period_record(uuid, date, date, jsonb)
  from public, anon, service_role;
grant execute on function public.save_attendance_period_record(uuid, date, date, jsonb)
  to authenticated;

create or replace function private.refresh_attendance_rule_estimates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_function_rule_id uuid;
begin
  if tg_op = 'DELETE' then
    v_organization_id := old.organization_id;
    v_function_rule_id := old.function_rule_id;
  else
    v_organization_id := new.organization_id;
    v_function_rule_id := new.function_rule_id;
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
    and record.function_rule_id_snapshot = v_function_rule_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.refresh_attendance_rule_estimates() from public, anon, authenticated;
drop trigger if exists attendance_reduction_refresh_estimates on public.attendance_reduction_rules;
create trigger attendance_reduction_refresh_estimates
  after insert or update or delete on public.attendance_reduction_rules
  for each row execute function private.refresh_attendance_rule_estimates();
