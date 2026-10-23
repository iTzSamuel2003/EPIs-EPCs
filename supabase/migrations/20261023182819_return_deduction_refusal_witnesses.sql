create table public.return_deduction_refusal_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deduction_case_id uuid not null references public.return_deduction_cases(id) on delete restrict,
  return_id uuid not null references public.returns(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  outcome text not null check (outcome in ('employee_refused', 'employee_absent', 'unable_to_present')),
  presentation_channel text not null check (presentation_channel in ('in_person', 'printed_term', 'digital_link')),
  employee_statement text check (employee_statement is null or length(employee_statement) <= 1000),
  signature_link_id uuid references public.term_signature_links(id) on delete set null,
  case_snapshot jsonb not null,
  presented_term_snapshot jsonb not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_by_name text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id)
);

create index return_deduction_refusal_records_case_idx
  on public.return_deduction_refusal_records (deduction_case_id, organization_id, recorded_at desc);
create index return_deduction_refusal_records_return_idx
  on public.return_deduction_refusal_records (return_id);
create index return_deduction_refusal_records_employee_idx
  on public.return_deduction_refusal_records (employee_id);
create index return_deduction_refusal_records_link_idx
  on public.return_deduction_refusal_records (signature_link_id)
  where signature_link_id is not null;

create table public.return_deduction_refusal_witnesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  refusal_record_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  employee_name_snapshot text not null,
  employee_registration_snapshot text not null,
  employee_job_title_snapshot text,
  signature_data_url text not null check (
    length(signature_data_url) <= 300000
    and signature_data_url ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
  ),
  signed_at timestamptz not null default clock_timestamp(),
  foreign key (refusal_record_id, organization_id)
    references public.return_deduction_refusal_records(id, organization_id) on delete cascade,
  unique (refusal_record_id, employee_id)
);

create index return_deduction_refusal_witnesses_record_idx
  on public.return_deduction_refusal_witnesses (organization_id, refusal_record_id);
create index return_deduction_refusal_witnesses_employee_idx
  on public.return_deduction_refusal_witnesses (employee_id);

alter table public.return_deduction_refusal_records enable row level security;
alter table public.return_deduction_refusal_witnesses enable row level security;

create policy "RH can view organization refusal records"
  on public.return_deduction_refusal_records for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.current_user_can_access_page('/discounts')
  );

create policy "RH can view witnesses for organization refusal records"
  on public.return_deduction_refusal_witnesses for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.current_user_can_access_page('/discounts')
  );

revoke all on public.return_deduction_refusal_records from public, anon, authenticated;
revoke all on public.return_deduction_refusal_witnesses from public, anon, authenticated;
grant select on public.return_deduction_refusal_records to authenticated;
grant select on public.return_deduction_refusal_witnesses to authenticated;

create or replace function public.record_return_deduction_refusal(
  p_case_id uuid,
  p_outcome text,
  p_presentation_channel text,
  p_employee_statement text,
  p_signature_link_id uuid,
  p_witnesses jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid := private.current_organization_id();
  v_case public.return_deduction_cases;
  v_event_id uuid;
  v_case_snapshot jsonb;
  v_term_snapshot jsonb;
  v_user_name text;
  v_recorded_at timestamptz := clock_timestamp();
  v_witness jsonb;
  v_witness_id uuid;
  v_witness_name text;
  v_witness_registration text;
  v_witness_job_title text;
  v_signature text;
  v_seen_witness_ids uuid[] := array[]::uuid[];
begin
  if v_user is null or v_org is null then
    raise exception 'Sessão inválida';
  end if;
  if not private.current_user_can_access_page('/discounts') then
    raise exception 'Seu perfil não tem acesso à página de descontos';
  end if;
  if p_outcome is null or p_outcome not in ('employee_refused', 'employee_absent', 'unable_to_present') then
    raise exception 'Resultado da apresentação inválido';
  end if;
  if p_presentation_channel is null or p_presentation_channel not in ('in_person', 'printed_term', 'digital_link') then
    raise exception 'Forma de apresentação inválida';
  end if;
  if p_employee_statement is not null and length(trim(p_employee_statement)) > 1000 then
    raise exception 'O relato do colaborador deve ter até 1.000 caracteres';
  end if;
  if p_witnesses is null or jsonb_typeof(p_witnesses) <> 'array' then
    raise exception 'Informe uma ou duas testemunhas';
  end if;
  if jsonb_array_length(p_witnesses) < 1 or jsonb_array_length(p_witnesses) > 2 then
    raise exception 'Informe uma ou duas testemunhas';
  end if;

  select c.* into v_case
  from public.return_deduction_cases as c
  where c.id = p_case_id and c.organization_id = v_org
  for update;
  if not found then raise exception 'Caso de desconto não encontrado'; end if;
  if v_case.status <> 'approved' then
    raise exception 'O registro de apresentação só está disponível para uma autorização aprovada e ainda não assinada';
  end if;

  if p_presentation_channel = 'digital_link' then
    if p_signature_link_id is null then raise exception 'Selecione o link de assinatura apresentado'; end if;
    select link.snapshot into v_term_snapshot
    from public.term_signature_links as link
    where link.id = p_signature_link_id
      and link.organization_id = v_org
      and link.deduction_case_id = v_case.id
      and link.used_at is null
      and link.revoked_at is null
      and link.expires_at > v_recorded_at
    for update;
    if not found then raise exception 'O link selecionado não está mais ativo'; end if;
  elsif p_signature_link_id is not null then
    raise exception 'O link só deve ser informado quando a apresentação foi pelo link digital';
  end if;

  select jsonb_build_object(
    'case_id', v_case.id,
    'return_id', v_case.return_id,
    'employee_id', v_case.employee_id,
    'organization_id', organization.id,
    'organization_name', organization.name,
    'organization_cnpj', organization.cnpj,
    'organization_address', organization.address,
    'organization_phone', organization.phone,
    'organization_logo_url', organization.logo_url,
    'employee_name', employee.full_name,
    'employee_registration', employee.registration,
    'employee_job_title', coalesce(employee.job_title, employee.function_name),
    'employee_department', employee.department,
    'return_date', transaction.returned_at,
    'return_reason', transaction.reason,
    'return_notes', transaction.notes,
    'approved_amount', v_case.approved_amount,
    'review_notes', v_case.review_notes,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'material_name', material.name,
        'quantity', return_item.quantity,
        'unit', material.unit,
        'incident_type', return_item.incident_type,
        'incident_description', return_item.incident_description,
        'condition', return_item.equipment_condition,
        'destination', return_item.destination
      ) order by return_item.created_at, material.name)
      from public.return_items as return_item
      join public.materials as material
        on material.id = return_item.material_id
        and material.organization_id = return_item.organization_id
      where return_item.organization_id = v_org
        and return_item.return_id = v_case.return_id
        and return_item.deduction_requested
    ), '[]'::jsonb)
  ) into v_case_snapshot
  from public.returns as transaction
  join public.employees as employee
    on employee.id = transaction.employee_id
    and employee.organization_id = transaction.organization_id
  join public.organizations as organization
    on organization.id = transaction.organization_id
  where transaction.id = v_case.return_id
    and transaction.organization_id = v_org
    and transaction.employee_id = v_case.employee_id;
  if v_case_snapshot is null then raise exception 'A devolução vinculada ao caso não foi encontrada'; end if;

  select nullif(trim(profile.full_name), '') into v_user_name
  from public.profiles as profile
  where profile.id = v_user;
  v_user_name := coalesce(v_user_name, 'Usuário autenticado');

  insert into public.return_deduction_refusal_records (
    organization_id, deduction_case_id, return_id, employee_id,
    outcome, presentation_channel, employee_statement, signature_link_id,
    case_snapshot, presented_term_snapshot, recorded_by, recorded_by_name, recorded_at
  ) values (
    v_org, v_case.id, v_case.return_id, v_case.employee_id,
    p_outcome, p_presentation_channel, nullif(trim(p_employee_statement), ''), p_signature_link_id,
    v_case_snapshot,
    coalesce(v_term_snapshot, jsonb_build_object(
      'approved_amount', v_case.approved_amount,
      'review_notes', v_case.review_notes,
      'document', 'Autorização específica de desconto em folha'
    )),
    v_user, v_user_name, v_recorded_at
  ) returning id into v_event_id;

  for v_witness in select value from jsonb_array_elements(p_witnesses) as witnesses(value) loop
    begin
      v_witness_id := nullif(v_witness->>'employee_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Selecione uma testemunha válida';
    end;
    v_signature := v_witness->>'signature_data_url';
    if v_witness_id is null or v_signature is null
      or length(v_signature) > 300000
      or v_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]*={0,2}$' then
      raise exception 'A assinatura de cada testemunha é obrigatória';
    end if;
    if v_witness_id = any(v_seen_witness_ids) or v_witness_id = v_case.employee_id then
      raise exception 'Cada testemunha deve ser uma pessoa distinta do colaborador';
    end if;
    v_seen_witness_ids := array_append(v_seen_witness_ids, v_witness_id);

    select employee.full_name, employee.registration,
      coalesce(employee.job_title, employee.function_name)
    into v_witness_name, v_witness_registration, v_witness_job_title
    from public.employees as employee
    where employee.id = v_witness_id
      and employee.organization_id = v_org
      and employee.status = 'active';
    if not found then raise exception 'Testemunha não encontrada entre os funcionários ativos da organização'; end if;

    insert into public.return_deduction_refusal_witnesses (
      organization_id, refusal_record_id, employee_id, employee_name_snapshot,
      employee_registration_snapshot, employee_job_title_snapshot, signature_data_url, signed_at
    ) values (
      v_org, v_event_id, v_witness_id, v_witness_name,
      v_witness_registration, v_witness_job_title, v_signature, v_recorded_at
    );
  end loop;

  if p_outcome = 'employee_refused' then
    update public.term_signature_links
    set revoked_at = v_recorded_at
    where organization_id = v_org
      and deduction_case_id = v_case.id
      and used_at is null
      and revoked_at is null;
  end if;

  return v_event_id;
end;
$$;

revoke all on function public.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) to authenticated;
