
alter table public.return_deduction_refusal_witnesses
  alter column signature_data_url drop not null,
  alter column signed_at drop not null;

alter table public.return_deduction_refusal_witnesses
  drop constraint if exists return_deduction_refusal_witnesses_signature_data_url_check,
  add constraint return_deduction_refusal_witnesses_signature_data_url_check
    check (
      signature_data_url is null
      or (
        length(signature_data_url) <= 300000
        and signature_data_url ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
      )
    ),
  add constraint return_deduction_refusal_witnesses_signature_state_check
    check ((signature_data_url is null) = (signed_at is null)),
  add constraint return_deduction_refusal_witnesses_id_organization_key
    unique (id, organization_id);

alter table public.term_signature_links
  add column refusal_witness_id uuid;

alter table public.term_signature_links
  add constraint term_signature_links_refusal_witness_org_fkey
    foreign key (refusal_witness_id, organization_id)
    references public.return_deduction_refusal_witnesses(id, organization_id)
    on delete cascade;

alter table public.term_signature_links
  drop constraint if exists term_signature_links_one_record_check,
  add constraint term_signature_links_one_record_check
    check (num_nonnulls(delivery_id, return_id, pending_delivery_id, deduction_case_id, refusal_witness_id) = 1);

create index term_signature_links_refusal_witness_idx
  on public.term_signature_links (organization_id, refusal_witness_id, created_at desc)
  where refusal_witness_id is not null;

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
  v_seen_witness_ids uuid[] := array[]::uuid[];
begin
  if v_user is null or v_org is null then raise exception 'Sessao invalida'; end if;
  if not private.current_user_can_access_page('/discounts') then
    raise exception 'Seu perfil nao tem acesso a pagina de descontos';
  end if;
  if p_outcome is null or p_outcome not in ('employee_refused', 'employee_absent', 'unable_to_present') then
    raise exception 'Resultado da apresentacao invalido';
  end if;
  if p_presentation_channel is null or p_presentation_channel not in ('in_person', 'printed_term', 'digital_link') then
    raise exception 'Forma de apresentacao invalida';
  end if;
  if p_employee_statement is not null and length(trim(p_employee_statement)) > 1000 then
    raise exception 'O relato do colaborador deve ter ate 1.000 caracteres';
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
  if not found then raise exception 'Caso de desconto nao encontrado'; end if;
  if v_case.status <> 'approved' then
    raise exception 'O registro so esta disponivel para uma autorizacao aprovada e ainda nao assinada';
  end if;

  if p_presentation_channel = 'digital_link' then
    if p_signature_link_id is null then raise exception 'Selecione o link individual apresentado'; end if;
    select link.snapshot into v_term_snapshot
    from public.term_signature_links as link
    where link.id = p_signature_link_id
      and link.organization_id = v_org
      and link.deduction_case_id = v_case.id
      and link.used_at is null
    for update;
    if not found then raise exception 'O link individual nao pertence a esta autorizacao ou ja foi utilizado'; end if;
  elsif p_signature_link_id is not null then
    raise exception 'O link so deve ser informado quando a apresentacao foi pelo link individual';
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
    on employee.id = transaction.employee_id and employee.organization_id = transaction.organization_id
  join public.organizations as organization on organization.id = transaction.organization_id
  where transaction.id = v_case.return_id
    and transaction.organization_id = v_org
    and transaction.employee_id = v_case.employee_id;
  if v_case_snapshot is null then raise exception 'Devolucao vinculada ao caso nao encontrada'; end if;

  select nullif(trim(profile.full_name), '') into v_user_name
  from public.profiles as profile where profile.id = v_user;
  v_user_name := coalesce(v_user_name, 'Usuario autenticado');

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
      'document', 'Autorizacao especifica de desconto em folha'
    )),
    v_user, v_user_name, v_recorded_at
  ) returning id into v_event_id;

  for v_witness in select value from jsonb_array_elements(p_witnesses) as witnesses(value) loop
    begin
      v_witness_id := nullif(v_witness->>'employee_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Selecione uma testemunha valida';
    end;
    if v_witness_id is null then raise exception 'Selecione uma testemunha valida'; end if;
    if v_witness_id = any(v_seen_witness_ids) or v_witness_id = v_case.employee_id then
      raise exception 'Cada testemunha deve ser distinta do colaborador';
    end if;
    v_seen_witness_ids := array_append(v_seen_witness_ids, v_witness_id);

    select employee.full_name, employee.registration,
      coalesce(employee.job_title, employee.function_name)
    into v_witness_name, v_witness_registration, v_witness_job_title
    from public.employees as employee
    where employee.id = v_witness_id and employee.organization_id = v_org and employee.status = 'active';
    if not found then raise exception 'Testemunha nao encontrada entre os funcionarios ativos'; end if;

    insert into public.return_deduction_refusal_witnesses (
      organization_id, refusal_record_id, employee_id, employee_name_snapshot,
      employee_registration_snapshot, employee_job_title_snapshot, signature_data_url, signed_at
    ) values (
      v_org, v_event_id, v_witness_id, v_witness_name,
      coalesce(v_witness_registration, ''), v_witness_job_title, null, null
    );
  end loop;

  if p_outcome = 'employee_refused' then
    update public.term_signature_links
    set revoked_at = v_recorded_at
    where organization_id = v_org and deduction_case_id = v_case.id
      and used_at is null and revoked_at is null;
  end if;

  return v_event_id;
end;
$$;

revoke all on function public.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) to authenticated;

create or replace function public.complete_employee_witness_signature(
  p_link_id uuid,
  p_signature_file_path text,
  p_signature_data_url text,
  p_signer_name text,
  p_signer_cpf text
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link public.term_signature_links;
  v_witness public.return_deduction_refusal_witnesses;
  v_signed_at timestamptz := clock_timestamp();
begin
  select * into v_link from public.term_signature_links where id = p_link_id for update;
  if v_link.id is null or v_link.refusal_witness_id is null
    or v_link.expires_at <= v_signed_at or v_link.used_at is not null or v_link.revoked_at is not null
    or (v_link.locked_until is not null and v_link.locked_until > v_signed_at) then
    raise exception 'Link de testemunha invalido, expirado ou ja utilizado';
  end if;
  if nullif(trim(p_signer_name), '') is null or length(trim(p_signer_name)) > 160
    or p_signer_cpf is null or p_signer_cpf !~ '^[0-9]{11}$'
    or p_signature_file_path is null or p_signature_data_url is null
    or length(p_signature_data_url) > 300000
    or p_signature_data_url !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'Dados da assinatura da testemunha invalidos';
  end if;
  select * into v_witness from public.return_deduction_refusal_witnesses
  where id = v_link.refusal_witness_id and organization_id = v_link.organization_id
    and employee_id = v_link.employee_id for update;
  if not found or v_witness.signed_at is not null then
    raise exception 'Esta testemunha ja assinou ou nao esta mais pendente';
  end if;
  if p_signature_file_path not like v_link.organization_id::text || '/' ||
      v_witness.refusal_record_id::text || '/witness-signature-' || v_link.id::text || '-%' then
    raise exception 'Arquivo de assinatura fora do caminho permitido';
  end if;
  if not exists (
    select 1 from public.employees as employee
    where employee.id = v_link.employee_id and employee.organization_id = v_link.organization_id
      and regexp_replace(employee.cpf, '[^0-9]', '', 'g') = p_signer_cpf
      and lower(regexp_replace(trim(employee.full_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(p_signer_name), '\s+', ' ', 'g'))
  ) then raise exception 'Nome e CPF nao correspondem aos dados da testemunha'; end if;

  update public.return_deduction_refusal_witnesses
  set signature_data_url = p_signature_data_url, signed_at = v_signed_at
  where id = v_witness.id and organization_id = v_witness.organization_id and signed_at is null;
  if not found then raise exception 'A assinatura da testemunha nao foi registrada'; end if;

  update public.term_signature_links
  set used_at = v_signed_at, signer_name = trim(p_signer_name), signer_cpf = p_signer_cpf,
      signature_file_path = p_signature_file_path
  where id = v_link.id;
  update public.term_signature_links
  set revoked_at = v_signed_at
  where organization_id = v_link.organization_id and refusal_witness_id = v_link.refusal_witness_id
    and id <> v_link.id and used_at is null and revoked_at is null;
  return v_signed_at;
end;
$$;

revoke all on function public.complete_employee_witness_signature(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_employee_witness_signature(uuid, text, text, text, text) to service_role;
