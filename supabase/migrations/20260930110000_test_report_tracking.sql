-- Propaga o número do laudo/ensaio do lote até cada material ensaiável entregue.
alter table public.material_lots
  add column if not exists test_report_number text;

alter table public.material_units
  add column if not exists test_performed_at date,
  add column if not exists test_report_number text;

create or replace function public.register_stock_entry_batch(
  p_invoice_number text, p_entry_date date, p_items jsonb,
  p_invoice_file_path text default null, p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_invoice uuid;
  v_item jsonb;
  v_lot uuid;
  v_material uuid;
  v_variant uuid;
  v_quantity int;
  v_unit_cost numeric(12,2);
  v_test_performed_at date;
  v_test_expires_at date;
  v_test_report_number text;
  v_lot_number text;
  v_material_row public.materials;
  v_invoice_number text := nullif(trim(p_invoice_number), '');
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um item'; end if;

  insert into public.stock_invoices (organization_id, invoice_number, without_invoice, issued_at, file_path, notes, created_by)
  values (v_org, v_invoice_number, v_invoice_number is null, coalesce(p_entry_date, current_date), nullif(trim(p_invoice_file_path), ''), nullif(trim(p_notes), ''), auth.uid())
  returning id into v_invoice;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_quantity := (v_item->>'quantity')::int;
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    v_test_performed_at := nullif(v_item->>'test_performed_at', '')::date;
    v_test_expires_at := nullif(v_item->>'test_expires_at', '')::date;
    v_test_report_number := nullif(trim(v_item->>'test_report_number'), '');
    v_lot_number := 'LOTE-' || to_char(coalesce(p_entry_date, current_date), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if v_material_row.id is null then raise exception 'Material não encontrado na organização'; end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then raise exception 'A variação selecionada não pertence ao material ou está inativa'; end if;
    if v_material_row.test_required and (v_test_performed_at is null or v_test_expires_at is null) then raise exception 'Informe a data do ensaio e a validade do ensaio para o material (%)', v_material_row.name; end if;
    if v_material_row.test_required and v_material_row.report_required and v_test_report_number is null then raise exception 'Informe o número do laudo/ensaio para o material (%)', v_material_row.name; end if;
    if v_test_expires_at is not null and v_test_performed_at is not null and v_test_expires_at < v_test_performed_at then raise exception 'A validade do ensaio não pode ser anterior à data do ensaio'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantidade inválida para um dos itens'; end if;
    if v_unit_cost < 0 then raise exception 'Custo unitário inválido para um dos itens'; end if;

    insert into public.material_lots (organization_id, material_id, variant_id, lot_number, received_quantity, available_quantity, entry_date, manufactured_at, expires_at, test_performed_at, test_expires_at, test_report_number, invoice_number, invoice_file_path, invoice_id, unit_cost, notes)
    values (v_org, v_material, v_variant, v_lot_number, v_quantity, v_quantity, coalesce(p_entry_date, current_date), nullif(v_item->>'manufactured_at', '')::date, nullif(v_item->>'expires_at', '')::date, v_test_performed_at, v_test_expires_at, v_test_report_number, v_invoice_number, nullif(trim(p_invoice_file_path), ''), v_invoice, v_unit_cost, nullif(trim(coalesce(v_item->>'notes', p_notes)), ''))
    returning id into v_lot;

    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_org, v_material, v_lot, 'entry', v_quantity, auth.uid(), nullif(trim(p_notes), ''));
  end loop;
  return v_invoice;
end;
$$;

revoke all on function public.register_stock_entry_batch(text, date, jsonb, text, text) from public;
grant execute on function public.register_stock_entry_batch(text, date, jsonb, text, text) to authenticated;

create or replace function public.register_delivery(
  p_employee_id uuid, p_reason text, p_delivered_at date, p_items jsonb, p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_delivery uuid; v_delivery_item uuid; v_item jsonb; v_material uuid;
  v_variant uuid; v_requested int; v_remaining int; v_take int;
  v_test_performed_at date; v_test_expires_at date;
  v_lot record; v_material_row record; v_variant_size text; unit_number int;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org and status <> 'terminated') then raise exception 'Funcionário não encontrado ou desligado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid; v_variant := nullif(v_item->>'variant_id', '')::uuid; v_requested := (v_item->>'quantity')::int;
    v_test_performed_at := nullif(v_item->>'test_performed_at', '')::date; v_test_expires_at := nullif(v_item->>'test_expires_at', '')::date;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if not found then raise exception 'Material não encontrado ou inativo'; end if;
    if v_requested is null or v_requested <= 0 then raise exception 'Quantidade inválida para o material'; end if;
    if lower(v_material_row.name) like '%bota de borracha%' and v_variant is null then raise exception 'Informe a numeração da bota de borracha'; end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then raise exception 'A numeração selecionada não pertence ao material ou está inativa'; end if;
    if v_material_row.test_required and (v_test_performed_at is null or v_test_expires_at is null) then raise exception 'Informe a data do ensaio e a validade do ensaio (%)', v_material_row.name; end if;
    if v_test_expires_at is not null and v_test_performed_at is not null and v_test_expires_at < v_test_performed_at then raise exception 'A validade do ensaio não pode ser anterior à data do ensaio'; end if;
    if v_material_row.test_required and v_test_expires_at < coalesce(p_delivered_at, current_date) then raise exception 'Material bloqueado: validade do ensaio expirada (%)', v_material_row.name; end if;
    if v_material_row.contract_item_code is not null then
      if v_material_row.ca_required and (v_material_row.ca_number is null or upper(trim(v_material_row.ca_number)) in ('PENDENTE', 'N/A')) then raise exception 'Material bloqueado: CA não cadastrado (%)', v_material_row.name; end if;
      if v_material_row.ca_required and v_material_row.ca_expires_at is not null and v_material_row.ca_expires_at < coalesce(p_delivered_at, current_date) then raise exception 'Material bloqueado: CA vencido (%)', v_material_row.name; end if;
    end if;
  end loop;

  insert into public.deliveries (organization_id, employee_id, delivered_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_delivered_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), '')) returning id into v_delivery;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid; v_variant := nullif(v_item->>'variant_id', '')::uuid; v_requested := (v_item->>'quantity')::int; v_remaining := v_requested;
    v_test_performed_at := nullif(v_item->>'test_performed_at', '')::date; v_test_expires_at := nullif(v_item->>'test_expires_at', '')::date;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org;
    select coalesce(size, name) into v_variant_size from public.material_variants where id = v_variant and organization_id = v_org;
    for v_lot in select id, lot_number, available_quantity, variant_id, test_performed_at, test_expires_at, test_report_number from public.material_lots where organization_id = v_org and material_id = v_material and (variant_id = v_variant or (variant_id is null and v_variant is null)) and available_quantity > 0 and (expires_at is null or expires_at >= current_date) order by expires_at asc nulls last, entry_date asc, created_at asc for update loop
      exit when v_remaining = 0; v_take := least(v_remaining, v_lot.available_quantity);
      update public.material_lots set available_quantity = available_quantity - v_take where id = v_lot.id;
      insert into public.delivery_items (organization_id, delivery_id, material_id, variant_id, lot_id, quantity, expected_replacement_at, test_performed_at, test_expires_at)
      values (v_org, v_delivery, v_material, v_variant, v_lot.id, v_take, nullif(v_item->>'expected_replacement_at', '')::date, v_test_performed_at, v_test_expires_at) returning id into v_delivery_item;
      if v_material_row.test_required then
        for unit_number in 1..v_take loop
          insert into public.material_units (organization_id, material_id, unit_identifier, lot_number, size, manufactured_at, ca_number, ca_expires_at, test_performed_at, test_report_number, status, location, notes, delivery_item_id, employee_id, delivered_at, valid_until)
          values (v_org, v_material, 'MU-' || lpad(nextval('public.material_unit_identifier_seq')::text, 8, '0'), v_lot.lot_number, v_variant_size, v_lot.test_performed_at, v_material_row.ca_number, v_material_row.ca_expires_at, coalesce(v_test_performed_at, v_lot.test_performed_at), v_lot.test_report_number, 'assigned', null, 'Gerado automaticamente na entrega ' || v_delivery::text, v_delivery_item, p_employee_id, coalesce(p_delivered_at, current_date), coalesce(v_test_expires_at, v_lot.test_expires_at));
        end loop;
      end if;
      insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values (v_org, v_material, v_lot.id, 'delivery', v_take, auth.uid(), 'Entrega ' || v_delivery::text);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then raise exception 'Estoque insuficiente para a variação selecionada'; end if;
  end loop;
  return v_delivery;
end;
$$;

revoke all on function public.register_delivery(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_delivery(uuid, text, date, jsonb, text) to authenticated;

create or replace function public.register_return(
  p_employee_id uuid, p_reason text, p_returned_at date, p_items jsonb, p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_return uuid; v_item jsonb; v_delivery_item uuid; v_requested int; v_delivered int; v_returned int;
  v_material uuid; v_lot uuid; v_condition text; v_destination text; v_incident text;
  v_description text; v_deduction boolean; v_amount numeric; v_movement public.movement_type;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org) then raise exception 'Funcionário não encontrado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um equipamento'; end if;

  insert into public.returns (organization_id, employee_id, returned_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_returned_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_return;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_delivery_item := (v_item->>'delivery_item_id')::uuid;
    v_requested := (v_item->>'quantity')::int;
    v_condition := coalesce(nullif(v_item->>'equipment_condition', ''), 'good');
    v_destination := coalesce(nullif(v_item->>'destination', ''), 'stock');
    v_incident := coalesce(nullif(v_item->>'incident_type', ''), 'normal');
    v_description := nullif(trim(v_item->>'incident_description'), '');
    v_deduction := coalesce((v_item->>'deduction_requested')::boolean, false);
    v_amount := case when v_deduction then nullif(v_item->>'deduction_amount', '')::numeric else null end;
    if v_condition not in ('good','used','damaged','unusable') then raise exception 'Estado do equipamento inválido'; end if;
    if v_destination not in ('stock','disposal','maintenance') then raise exception 'Destino do equipamento inválido'; end if;
    if v_incident not in ('normal','misuse','loss','theft','damage','other') then raise exception 'Ocorrência do equipamento inválida'; end if;
    if v_deduction and coalesce(v_amount, 0) <= 0 then raise exception 'Informe um valor de desconto válido para a ocorrência'; end if;
    select di.material_id, di.lot_id, di.quantity into v_material, v_lot, v_delivered
      from public.delivery_items di join public.deliveries d on d.id = di.delivery_id
      where di.id = v_delivery_item and di.organization_id = v_org and d.employee_id = p_employee_id
      for update of di;
    if v_material is null then raise exception 'Equipamento entregue não encontrado'; end if;
    select coalesce(sum(quantity), 0) into v_returned from public.return_items where delivery_item_id = v_delivery_item;
    if v_requested is null or v_requested <= 0 or v_requested > v_delivered - v_returned then raise exception 'Quantidade devolvida inválida'; end if;
    if v_destination = 'stock' then
      update public.material_lots set available_quantity = available_quantity + v_requested where id = v_lot and organization_id = v_org;
      v_movement := 'return';
    elsif v_destination = 'disposal' then
      v_movement := 'discard';
    else
      v_movement := 'adjustment';
    end if;
    insert into public.return_items (organization_id, return_id, delivery_item_id, material_id, lot_id, quantity, equipment_condition, destination, incident_type, incident_description, deduction_requested, deduction_amount)
    values (v_org, v_return, v_delivery_item, v_material, v_lot, v_requested, v_condition, v_destination, v_incident, v_description, v_deduction, v_amount);
    update public.material_units
    set status = case when v_destination = 'stock' then 'available' when v_destination = 'maintenance' then 'maintenance' else 'discarded' end,
        employee_id = null, delivered_at = null, location = case when v_destination = 'stock' then 'Estoque' else initcap(v_destination) end,
        notes = coalesce(notes, '') || case when v_incident <> 'normal' then ' · Ocorrência: ' || v_incident else '' end
    where id in (select id from public.material_units where organization_id = v_org and delivery_item_id = v_delivery_item and employee_id = p_employee_id and status = 'assigned' order by created_at limit v_requested);
    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_org, v_material, v_lot, v_movement, v_requested, auth.uid(), 'Devolução ' || v_return::text || ' · destino: ' || v_destination);
  end loop;
  return v_return;
end;
$$;

revoke all on function public.register_return(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;
