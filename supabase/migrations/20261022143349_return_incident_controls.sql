alter table public.return_items
  drop constraint if exists return_items_destination_check;

alter table public.return_items
  add constraint return_items_destination_check
  check (destination in ('stock', 'disposal', 'maintenance', 'not_returned'));

alter table public.return_accountability
  add column if not exists responsible_name text;

alter table public.material_units
  add column if not exists pending_return_item_id uuid references public.return_items(id) on delete set null;

create index if not exists material_units_pending_return_idx
  on public.material_units (organization_id, pending_return_item_id)
  where pending_return_item_id is not null;

update public.return_accountability
set responsible_name = employee_signature_name
where responsible_name is null and employee_signature_name is not null;

create or replace function public.record_return_accountability(
  p_return_id uuid,
  p_incident_type text,
  p_incident_description text,
  p_employee_signature_name text,
  p_deduction_requested boolean,
  p_deduction_amount numeric
) returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_org uuid := private.current_organization_id();
  v_employee uuid;
  v_id uuid;
begin
  select employee_id into v_employee
  from public.returns
  where id = p_return_id and organization_id = v_org;
  if v_employee is null then raise exception 'Devolução não encontrada'; end if;

  insert into public.return_accountability (
    organization_id, return_id, employee_id, incident_type, incident_description,
    responsible_name, employee_signature_name, signed_at, deduction_requested,
    deduction_amount, deduction_approval_status, created_by
  ) values (
    v_org, p_return_id, v_employee, coalesce(nullif(p_incident_type, ''), 'normal'),
    nullif(trim(p_incident_description), ''), nullif(trim(p_employee_signature_name), ''),
    null, coalesce(p_deduction_requested, false),
    case when p_deduction_requested then p_deduction_amount else null end,
    case when coalesce(p_deduction_requested, false) then 'pending' else 'rejected' end,
    auth.uid()
  )
  on conflict (return_id) do update set
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

revoke all on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) from public;
grant execute on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) to authenticated;

create or replace function public.register_return(
  p_employee_id uuid,
  p_reason text,
  p_returned_at date,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
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
  v_amount numeric;
  v_movement public.movement_type;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org) then raise exception 'Funcionário não encontrado'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um equipamento'; end if;

  insert into public.returns (organization_id, employee_id, returned_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_returned_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_return;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_delivery_item := nullif(v_item->>'delivery_item_id', '')::uuid;
    v_requested := nullif(v_item->>'quantity', '')::int;
    v_condition := coalesce(nullif(v_item->>'equipment_condition', ''), 'good');
    v_destination := coalesce(nullif(v_item->>'destination', ''), 'stock');
    v_incident := coalesce(nullif(v_item->>'incident_type', ''), 'normal');
    v_description := nullif(trim(v_item->>'incident_description'), '');
    v_deduction := coalesce((v_item->>'deduction_requested')::boolean, false);
    v_amount := case when v_deduction then nullif(v_item->>'deduction_amount', '')::numeric else null end;

    if v_condition not in ('good', 'used', 'damaged', 'unusable') then raise exception 'Estado do equipamento inválido'; end if;
    if v_destination not in ('stock', 'disposal', 'maintenance', 'not_returned') then raise exception 'Destino do equipamento inválido'; end if;
    if v_incident not in ('normal', 'misuse', 'loss', 'theft', 'damage', 'other') then raise exception 'Ocorrência do equipamento inválida'; end if;
    if v_destination = 'stock' and (v_incident <> 'normal' or v_condition in ('damaged', 'unusable')) then raise exception 'Material com ocorrência ou danificado não pode retornar ao estoque disponível'; end if;
    if v_destination = 'not_returned' and v_incident not in ('loss', 'theft') then raise exception 'Somente material extraviado ou furtado pode ficar marcado como não devolvido'; end if;
    if v_deduction and coalesce(v_amount, 0) <= 0 then raise exception 'Informe um valor estimado válido para análise da ocorrência'; end if;

    select di.material_id, di.lot_id, di.quantity into v_material, v_lot, v_delivered
    from public.delivery_items di
    join public.deliveries d on d.id = di.delivery_id
    where di.id = v_delivery_item and di.organization_id = v_org and d.employee_id = p_employee_id
    for update of di;
    if v_material is null then raise exception 'Equipamento entregue não encontrado'; end if;

    select coalesce(sum(quantity), 0) into v_returned
    from public.return_items where delivery_item_id = v_delivery_item;
    if v_requested is null or v_requested <= 0 or v_requested > v_delivered - v_returned then raise exception 'Quantidade devolvida inválida'; end if;

    if v_destination = 'stock' then
      update public.material_lots set available_quantity = available_quantity + v_requested where id = v_lot and organization_id = v_org;
      v_movement := 'return';
    elsif v_destination = 'disposal' then
      v_movement := 'discard';
    else
      v_movement := 'adjustment';
    end if;

    insert into public.return_items (
      organization_id, return_id, delivery_item_id, material_id, lot_id, quantity,
      equipment_condition, destination, incident_type, incident_description,
      deduction_requested, deduction_amount
    ) values (
      v_org, v_return, v_delivery_item, v_material, v_lot, v_requested,
      v_condition, v_destination, v_incident, v_description, v_deduction, v_amount
    ) returning id into v_return_item_id;

    if v_destination = 'not_returned' then
      update public.material_units
      set pending_return_item_id = v_return_item_id
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item and employee_id = p_employee_id
          and status = 'assigned' and pending_return_item_id is null
        order by created_at limit v_requested
      );
    elsif v_destination = 'disposal' and v_deduction then
      update public.material_units
      set status = 'quarantine', employee_id = null, delivered_at = null,
          location = 'Aguardando assinatura para baixa',
          pending_return_item_id = v_return_item_id,
          notes = concat_ws(' · ', nullif(notes, ''), 'Baixa de descarte aguardando assinatura do termo')
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item and employee_id = p_employee_id and status = 'assigned'
          and pending_return_item_id is null order by created_at limit v_requested
      );
    else
      update public.material_units
      set status = case when v_destination = 'stock' then 'available' when v_destination = 'maintenance' then 'maintenance' else 'discarded' end,
          employee_id = null,
          delivered_at = null,
          location = case when v_destination = 'stock' then 'Estoque' else initcap(v_destination) end,
          pending_return_item_id = null,
          notes = concat_ws(' · ', nullif(notes, ''), case when v_incident <> 'normal' then 'Ocorrência: ' || v_incident else null end)
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item and employee_id = p_employee_id and status = 'assigned'
        order by created_at limit v_requested
      );
      if not (v_destination = 'disposal' and v_deduction) then
        insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
        values (v_org, v_material, v_lot, v_movement, v_requested, auth.uid(), 'Devolução ' || v_return::text || ' · destino: ' || v_destination);
      end if;
    end if;
  end loop;
  return v_return;
end;
$$;

revoke all on function public.register_return(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;

create or replace function private.finalize_signed_return_incidents()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if old.term_signed_at is null and new.term_signed_at is not null then
    update public.material_units mu
    set status = 'discarded',
        employee_id = null,
        delivered_at = null,
        location = 'Baixa por ocorrência assinada',
        notes = concat_ws(' · ', nullif(mu.notes, ''), 'Baixa após assinatura do termo de devolução ' || new.id::text)
    where mu.organization_id = new.organization_id
      and mu.pending_return_item_id in (
        select ri.id from public.return_items ri
        where ri.organization_id = new.organization_id and ri.return_id = new.id
          and (ri.destination = 'not_returned' or (ri.destination = 'disposal' and ri.deduction_requested))
      )
      and (
        (mu.status = 'assigned' and mu.employee_id = new.employee_id)
        or (mu.status = 'quarantine' and mu.location = 'Aguardando assinatura para baixa')
      );

    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    select ri.organization_id, ri.material_id, ri.lot_id, 'discard'::public.movement_type, ri.quantity, new.term_uploaded_by,
      'Baixa por ocorrência após assinatura do termo ' || new.id::text
    from public.return_items ri
    where ri.organization_id = new.organization_id and ri.return_id = new.id
      and (ri.destination = 'not_returned' or (ri.destination = 'disposal' and ri.deduction_requested));

    update public.return_accountability
    set employee_signature_name = coalesce(nullif(new.term_signer_name, ''), employee_signature_name),
        signed_at = new.term_signed_at
    where organization_id = new.organization_id and return_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists returns_finalize_signed_incidents on public.returns;
create trigger returns_finalize_signed_incidents
after update of term_signed_at on public.returns
for each row execute function private.finalize_signed_return_incidents();

create or replace function public.get_employee_portal_data_v3(
  p_registration text,
  p_cpf text
)
returns table(
  employee_id uuid,
  employee_name text,
  function_name text,
  organization_name text,
  shirt_size text,
  pants_size text,
  shoe_size text,
  helmet_size text,
  glove_size text,
  uniform_notes text,
  courses jsonb,
  materials jsonb,
  requests jsonb,
  requirements jsonb
)
language plpgsql
security definer
set search_path = public, private
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
      'certificate_number', c.certificate_number, 'has_attachment', c.certificate_file_path is not null
    ) order by c.expires_at nulls last) from public.employee_courses c where c.employee_id = e.id), '[]'::jsonb),
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
