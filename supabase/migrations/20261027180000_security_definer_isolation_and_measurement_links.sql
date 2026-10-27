-- Keep privileged implementations out of the exposed Data API schema.
-- Public RPC signatures remain compatible, but now run as invokers and delegate
-- only to private functions that retain explicit authorization checks.

-- The platform-admin lookup is performed only by trusted server-side routines.
-- This clears the no-policy advisory without granting table privileges.
drop policy if exists platform_admins_service_role_only on private.platform_admins;
create policy platform_admins_service_role_only
  on private.platform_admins for all to service_role
  using (true) with check (true);

-- One-time measurement links are consumed only by the employee-portal Edge
-- Function, which validates the bearer token and applies the trusted-IP limit.
revoke all on function public.get_measurement_request(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_measurement_request(uuid) to service_role;
revoke all on function public.submit_measurement_request(uuid, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_measurement_request(uuid, text, text, text, text, text, text)
  to service_role;

-- Move each authenticated SECURITY DEFINER body to the non-exposed schema.
alter function public.create_hr_employee(text, text, text, text, text, text, text, date, text, text, text, text) set schema private;
alter function private.create_hr_employee(text, text, text, text, text, text, text, date, text, text, text, text) rename to create_hr_employee_internal;
revoke all on function private.create_hr_employee_internal(text, text, text, text, text, text, text, date, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function private.create_hr_employee_internal(text, text, text, text, text, text, text, date, text, text, text, text) to authenticated;
create function public.create_hr_employee(
  p_registration text, p_full_name text, p_cpf text, p_function_name text,
  p_function_classification text, p_department text, p_unit text,
  p_admission_date date, p_phone text, p_email text, p_status text, p_notes text
)
returns uuid language sql security invoker set search_path = ''
as $$
  select private.create_hr_employee_internal(
    p_registration, p_full_name, p_cpf, p_function_name,
    p_function_classification, p_department, p_unit, p_admission_date,
    p_phone, p_email, p_status, p_notes
  );
$$;
revoke all on function public.create_hr_employee(text, text, text, text, text, text, text, date, text, text, text, text) from public, anon, service_role;
grant execute on function public.create_hr_employee(text, text, text, text, text, text, text, date, text, text, text, text) to authenticated;

alter function public.get_employee_course_records(uuid) set schema private;
alter function private.get_employee_course_records(uuid) rename to get_employee_course_records_internal;
revoke all on function private.get_employee_course_records_internal(uuid) from public, anon, authenticated, service_role;
grant execute on function private.get_employee_course_records_internal(uuid) to authenticated;
create function public.get_employee_course_records(p_employee_id uuid)
returns setof public.employee_courses language sql stable security invoker set search_path = ''
as $$ select * from private.get_employee_course_records_internal(p_employee_id); $$;
revoke all on function public.get_employee_course_records(uuid) from public, anon, service_role;
grant execute on function public.get_employee_course_records(uuid) to authenticated;

alter function public.get_hr_employee_records(uuid) set schema private;
alter function private.get_hr_employee_records(uuid) rename to get_hr_employee_records_internal;
revoke all on function private.get_hr_employee_records_internal(uuid) from public, anon, authenticated, service_role;
grant execute on function private.get_hr_employee_records_internal(uuid) to authenticated;
create function public.get_hr_employee_records(p_employee_id uuid default null)
returns table (
  id uuid, registration text, full_name text, cpf text, job_title text,
  function_name text, function_classification text, department text, unit text,
  admission_date date, termination_date date, phone text, email text,
  status text, notes text, organization_name text, organization_cnpj text,
  organization_logo_url text, organization_address text, organization_phone text
)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_hr_employee_records_internal(p_employee_id); $$;
revoke all on function public.get_hr_employee_records(uuid) from public, anon, service_role;
grant execute on function public.get_hr_employee_records(uuid) to authenticated;

alter function public.get_hr_employee_signature_cpfs(uuid) set schema private;
alter function private.get_hr_employee_signature_cpfs(uuid) rename to get_hr_employee_signature_cpfs_internal;
revoke all on function private.get_hr_employee_signature_cpfs_internal(uuid) from public, anon, authenticated, service_role;
grant execute on function private.get_hr_employee_signature_cpfs_internal(uuid) to authenticated;
create function public.get_hr_employee_signature_cpfs(p_employee_id uuid)
returns table (record_type text, record_id uuid, signer_cpf text)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_hr_employee_signature_cpfs_internal(p_employee_id); $$;
revoke all on function public.get_hr_employee_signature_cpfs(uuid) from public, anon, service_role;
grant execute on function public.get_hr_employee_signature_cpfs(uuid) to authenticated;

alter function public.get_training_compliance_counts() set schema private;
alter function private.get_training_compliance_counts() rename to get_training_compliance_counts_internal;
revoke all on function private.get_training_compliance_counts_internal() from public, anon, authenticated, service_role;
grant execute on function private.get_training_compliance_counts_internal() to authenticated;
create function public.get_training_compliance_counts()
returns table (requirement_id uuid, applicable_count bigint, approved_count bigint, active_employee_count bigint)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_training_compliance_counts_internal(); $$;
revoke all on function public.get_training_compliance_counts() from public, anon, service_role;
grant execute on function public.get_training_compliance_counts() to authenticated;

alter function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text) set schema private;
alter function private.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text) rename to record_hr_delivery_term_signature_internal;
revoke all on function private.record_hr_delivery_term_signature_internal(uuid, text, timestamptz, text, text, text) from public, anon, authenticated, service_role;
grant execute on function private.record_hr_delivery_term_signature_internal(uuid, text, timestamptz, text, text, text) to authenticated;
create function public.record_hr_delivery_term_signature(
  p_delivery_id uuid, p_term_file_path text, p_signed_at timestamptz,
  p_signature_method text, p_signer_name text, p_signer_cpf text
)
returns void language plpgsql security invoker set search_path = ''
as $$ begin
  perform private.record_hr_delivery_term_signature_internal(
    p_delivery_id, p_term_file_path, p_signed_at, p_signature_method,
    p_signer_name, p_signer_cpf
  );
end; $$;
revoke all on function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text) from public, anon, service_role;
grant execute on function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text) to authenticated;

alter function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text) set schema private;
alter function private.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text) rename to record_hr_return_term_signature_internal;
revoke all on function private.record_hr_return_term_signature_internal(uuid, text, timestamptz, text, text, text) from public, anon, authenticated, service_role;
grant execute on function private.record_hr_return_term_signature_internal(uuid, text, timestamptz, text, text, text) to authenticated;
create function public.record_hr_return_term_signature(
  p_return_id uuid, p_term_file_path text, p_signed_at timestamptz,
  p_signature_method text, p_signer_name text, p_signer_cpf text
)
returns void language plpgsql security invoker set search_path = ''
as $$ begin
  perform private.record_hr_return_term_signature_internal(
    p_return_id, p_term_file_path, p_signed_at, p_signature_method,
    p_signer_name, p_signer_cpf
  );
end; $$;
revoke all on function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text) from public, anon, service_role;
grant execute on function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text) to authenticated;

alter function public.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) set schema private;
alter function private.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) rename to record_return_deduction_refusal_internal;
revoke all on function private.record_return_deduction_refusal_internal(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.record_return_deduction_refusal_internal(uuid, text, text, text, uuid, jsonb) to authenticated;
create function public.record_return_deduction_refusal(
  p_case_id uuid, p_outcome text, p_presentation_channel text,
  p_employee_statement text, p_signature_link_id uuid, p_witnesses jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select private.record_return_deduction_refusal_internal(
    p_case_id, p_outcome, p_presentation_channel, p_employee_statement,
    p_signature_link_id, p_witnesses
  );
$$;
revoke all on function public.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_return_deduction_refusal(uuid, text, text, text, uuid, jsonb) to authenticated;

alter function public.review_employee_course(uuid, text, text) set schema private;
alter function private.review_employee_course(uuid, text, text) rename to review_employee_course_internal;
revoke all on function private.review_employee_course_internal(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function private.review_employee_course_internal(uuid, text, text) to authenticated;
create function public.review_employee_course(
  p_course_id uuid, p_decision text, p_review_notes text default null
)
returns void language plpgsql security invoker set search_path = ''
as $$ begin perform private.review_employee_course_internal(p_course_id, p_decision, p_review_notes); end; $$;
revoke all on function public.review_employee_course(uuid, text, text) from public, anon, service_role;
grant execute on function public.review_employee_course(uuid, text, text) to authenticated;

alter function public.review_return_deduction_case(uuid, text, numeric, text) set schema private;
alter function private.review_return_deduction_case(uuid, text, numeric, text) rename to review_return_deduction_case_internal;
revoke all on function private.review_return_deduction_case_internal(uuid, text, numeric, text) from public, anon, authenticated, service_role;
grant execute on function private.review_return_deduction_case_internal(uuid, text, numeric, text) to authenticated;
create function public.review_return_deduction_case(
  p_case_id uuid, p_decision text, p_approved_amount numeric default null,
  p_review_notes text default null
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.review_return_deduction_case_internal(p_case_id, p_decision, p_approved_amount, p_review_notes); $$;
revoke all on function public.review_return_deduction_case(uuid, text, numeric, text) from public, anon, service_role;
grant execute on function public.review_return_deduction_case(uuid, text, numeric, text) to authenticated;

alter function public.update_hr_employee(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text) set schema private;
alter function private.update_hr_employee(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text) rename to update_hr_employee_internal;
revoke all on function private.update_hr_employee_internal(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function private.update_hr_employee_internal(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text) to authenticated;
create function public.update_hr_employee(
  p_employee_id uuid, p_registration text, p_full_name text, p_cpf text,
  p_function_name text, p_function_classification text, p_department text,
  p_unit text, p_admission_date date, p_termination_date date, p_phone text,
  p_email text, p_status text, p_notes text
)
returns uuid language sql security invoker set search_path = ''
as $$
  select private.update_hr_employee_internal(
    p_employee_id, p_registration, p_full_name, p_cpf, p_function_name,
    p_function_classification, p_department, p_unit, p_admission_date,
    p_termination_date, p_phone, p_email, p_status, p_notes
  );
$$;
revoke all on function public.update_hr_employee(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text) from public, anon, service_role;
grant execute on function public.update_hr_employee(uuid, text, text, text, text, text, text, text, date, date, text, text, text, text) to authenticated;

-- These two privileged operations are exposed through the existing public RPC
-- signatures, but their private implementations re-check the caller's page.
create or replace function private.register_return_internal(
  p_employee_id uuid, p_reason text, p_returned_at date, p_items jsonb,
  p_notes text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_return uuid;
  v_item jsonb;
  v_delivery_item uuid;
  v_requested int;
  v_delivered int;
  v_returned int;
  v_return_item_id uuid;
  v_material uuid;
  v_lot uuid;
  v_condition text;
  v_destination text;
  v_incident text;
  v_description text;
  v_deduction boolean;
  v_movement public.movement_type;
begin
  if auth.uid() is null or v_org is null
    or not private.current_user_can_access_page('/returns') then
    raise exception 'Acesso não autorizado à página de devoluções';
  end if;
  if not exists (
    select 1 from public.employees
    where id = p_employee_id and organization_id = v_org
  ) then raise exception 'Funcionário não encontrado'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione ao menos um equipamento';
  end if;

  insert into public.returns
    (organization_id, employee_id, returned_at, reason, responsible_id, notes)
  values
    (v_org, p_employee_id, coalesce(p_returned_at, current_date), p_reason,
     auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_return;

  for v_item in select value from jsonb_array_elements(p_items) as items(value) loop
    v_delivery_item := nullif(v_item->>'delivery_item_id', '')::uuid;
    v_requested := nullif(v_item->>'quantity', '')::int;
    v_condition := coalesce(nullif(v_item->>'equipment_condition', ''), 'good');
    v_destination := coalesce(nullif(v_item->>'destination', ''), 'stock');
    v_incident := coalesce(nullif(v_item->>'incident_type', ''), 'normal');
    v_description := nullif(trim(v_item->>'incident_description'), '');
    v_deduction := coalesce((v_item->>'deduction_requested')::boolean, false);

    if v_condition not in ('good', 'used', 'damaged', 'unusable') then
      raise exception 'Condição do equipamento inválida';
    end if;
    if v_destination not in ('stock', 'disposal', 'maintenance', 'not_returned') then
      raise exception 'Destino do equipamento inválido';
    end if;
    if v_incident not in ('normal', 'misuse', 'loss', 'theft', 'damage', 'other') then
      raise exception 'Ocorrência do equipamento inválida';
    end if;
    if v_destination = 'stock'
      and (v_incident <> 'normal' or v_condition in ('damaged', 'unusable')) then
      raise exception 'Material com ocorrência ou danificado não pode retornar ao estoque disponível';
    end if;
    if v_destination = 'not_returned' and v_incident not in ('loss', 'theft') then
      raise exception 'Somente material extraviado ou furtado pode ficar marcado como não devolvido';
    end if;

    select di.material_id, di.lot_id, di.quantity
    into v_material, v_lot, v_delivered
    from public.delivery_items di
    join public.deliveries d on d.id = di.delivery_id
    where di.id = v_delivery_item and di.organization_id = v_org
      and d.employee_id = p_employee_id
    for update of di;
    if v_material is null then raise exception 'Equipamento entregue não encontrado'; end if;

    select coalesce(sum(quantity), 0) into v_returned
    from public.return_items where delivery_item_id = v_delivery_item;
    if v_requested is null or v_requested <= 0
      or v_requested > v_delivered - v_returned then
      raise exception 'Quantidade devolvida inválida';
    end if;

    if v_destination = 'stock' then
      update public.material_lots
      set available_quantity = available_quantity + v_requested
      where id = v_lot and organization_id = v_org;
      v_movement := 'return';
    elsif v_destination = 'disposal' then
      v_movement := 'discard';
    else
      v_movement := 'adjustment';
    end if;

    insert into public.return_items (
      organization_id, return_id, delivery_item_id, material_id, lot_id,
      quantity, equipment_condition, destination, incident_type,
      incident_description, deduction_requested, deduction_amount
    ) values (
      v_org, v_return, v_delivery_item, v_material, v_lot, v_requested,
      v_condition, v_destination, v_incident, v_description, v_deduction, null
    ) returning id into v_return_item_id;

    if v_destination = 'not_returned' then
      update public.material_units
      set pending_return_item_id = v_return_item_id
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item
          and employee_id = p_employee_id and status = 'assigned'
          and pending_return_item_id is null
        order by created_at limit v_requested
      );
    elsif v_destination = 'disposal' and v_deduction then
      update public.material_units
      set status = 'quarantine', employee_id = null, delivered_at = null,
          location = 'Aguardando assinatura para baixa',
          pending_return_item_id = v_return_item_id,
          notes = concat_ws(' · ', nullif(notes, ''),
            'Baixa de descarte aguardando assinatura do termo')
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item
          and employee_id = p_employee_id and status = 'assigned'
          and pending_return_item_id is null
        order by created_at limit v_requested
      );
    else
      update public.material_units
      set status = case
            when v_destination = 'stock' then 'available'
            when v_destination = 'maintenance' then 'maintenance'
            else 'discarded'
          end,
          employee_id = null,
          delivered_at = null,
          location = case when v_destination = 'stock' then 'Estoque'
            else initcap(v_destination) end,
          pending_return_item_id = null,
          notes = concat_ws(' · ', nullif(notes, ''),
            case when v_incident <> 'normal' then 'Ocorrência: ' || v_incident else null end)
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item
          and employee_id = p_employee_id and status = 'assigned'
        order by created_at limit v_requested
      );
      if not (v_destination = 'disposal' and v_deduction) then
        insert into public.stock_movements (
          organization_id, material_id, lot_id, movement_type, quantity,
          created_by, notes
        ) values (
          v_org, v_material, v_lot, v_movement, v_requested, auth.uid(),
          'Return ' || v_return::text || ' · destination: ' || v_destination
        );
      end if;
    end if;
  end loop;
  return v_return;
end;
$$;
revoke all on function private.register_return_internal(uuid, text, date, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function private.register_return_internal(uuid, text, date, jsonb, text)
  to authenticated;
alter function public.register_return(uuid, text, date, jsonb, text) security invoker;
revoke all on function public.register_return(uuid, text, date, jsonb, text)
  from public, anon, service_role;
grant execute on function public.register_return(uuid, text, date, jsonb, text)
  to authenticated;

create or replace function private.record_return_accountability_internal(
  p_return_id uuid, p_incident_type text, p_incident_description text,
  p_employee_signature_name text, p_deduction_requested boolean,
  p_deduction_amount numeric
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_employee uuid;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null
    or not private.current_user_can_access_page('/returns') then
    raise exception 'Acesso não autorizado à página de devoluções';
  end if;
  select employee_id into v_employee from public.returns
  where id = p_return_id and organization_id = v_org;
  if v_employee is null then raise exception 'Devolução não encontrada'; end if;

  insert into public.return_accountability (
    organization_id, return_id, employee_id, incident_type,
    incident_description, responsible_name, employee_signature_name,
    signed_at, deduction_requested, deduction_amount,
    deduction_approval_status, created_by
  ) values (
    v_org, p_return_id, v_employee,
    coalesce(nullif(p_incident_type, ''), 'normal'),
    nullif(trim(p_incident_description), ''),
    nullif(trim(p_employee_signature_name), ''), null, null,
    coalesce(p_deduction_requested, false),
    case when p_deduction_requested then p_deduction_amount else null end,
    case when coalesce(p_deduction_requested, false) then 'pending' else 'rejected' end,
    auth.uid()
  ) on conflict (return_id) do update set
    incident_type = excluded.incident_type,
    incident_description = excluded.incident_description,
    responsible_name = excluded.responsible_name,
    deduction_requested = excluded.deduction_requested,
    deduction_amount = excluded.deduction_amount,
    deduction_approval_status = excluded.deduction_approval_status,
    deduction_reviewed_at = null,
    deduction_reviewed_by = null
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.record_return_accountability_internal(uuid, text, text, text, boolean, numeric)
  from public, anon, authenticated, service_role;
grant execute on function private.record_return_accountability_internal(uuid, text, text, text, boolean, numeric)
  to authenticated;
alter function public.record_return_accountability(uuid, text, text, text, boolean, numeric)
  security invoker;
revoke all on function public.record_return_accountability(uuid, text, text, text, boolean, numeric)
  from public, anon, service_role;
grant execute on function public.record_return_accountability(uuid, text, text, text, boolean, numeric)
  to authenticated;
