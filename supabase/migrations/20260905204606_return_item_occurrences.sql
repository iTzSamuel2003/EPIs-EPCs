alter table public.return_items
  add column if not exists incident_type text not null default 'normal' check (incident_type in ('normal','misuse','loss','theft','damage','other')),
  add column if not exists incident_description text,
  add column if not exists deduction_requested boolean not null default false,
  add column if not exists deduction_amount numeric(12,2) check (deduction_amount is null or deduction_amount >= 0);

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
  v_org uuid := private.current_organization_id(); v_return uuid; v_item jsonb; v_delivery_item uuid; v_requested int; v_delivered int; v_returned int; v_material uuid; v_lot uuid; v_condition text; v_destination text; v_incident text; v_description text; v_deduction boolean; v_amount numeric; v_movement public.movement_type;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org) then raise exception 'Funcionário não encontrado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um equipamento'; end if;
  insert into public.returns (organization_id, employee_id, returned_at, reason, responsible_id, notes) values (v_org, p_employee_id, coalesce(p_returned_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), '')) returning id into v_return;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_delivery_item := (v_item->>'delivery_item_id')::uuid; v_requested := (v_item->>'quantity')::int; v_condition := coalesce(nullif(v_item->>'equipment_condition', ''), 'good'); v_destination := coalesce(nullif(v_item->>'destination', ''), 'stock'); v_incident := coalesce(nullif(v_item->>'incident_type', ''), 'normal'); v_description := nullif(trim(v_item->>'incident_description'), ''); v_deduction := coalesce((v_item->>'deduction_requested')::boolean, false); v_amount := case when v_deduction then nullif(v_item->>'deduction_amount', '')::numeric else null end;
    if v_condition not in ('good','used','damaged','unusable') then raise exception 'Estado do equipamento inválido'; end if;
    if v_destination not in ('stock','disposal','maintenance') then raise exception 'Destino do equipamento inválido'; end if;
    if v_incident not in ('normal','misuse','loss','theft','damage','other') then raise exception 'Ocorrência do equipamento inválida'; end if;
    select di.material_id, di.lot_id, di.quantity into v_material, v_lot, v_delivered from public.delivery_items di join public.deliveries d on d.id = di.delivery_id where di.id = v_delivery_item and di.organization_id = v_org and d.employee_id = p_employee_id;
    if v_material is null then raise exception 'Equipamento entregue não encontrado'; end if;
    select coalesce(sum(quantity), 0) into v_returned from public.return_items where delivery_item_id = v_delivery_item;
    if v_requested is null or v_requested <= 0 or v_requested > v_delivered - v_returned then raise exception 'Quantidade devolvida inválida'; end if;
    if v_destination = 'stock' then update public.material_lots set available_quantity = available_quantity + v_requested where id = v_lot and organization_id = v_org; v_movement := 'return'; elsif v_destination = 'disposal' then v_movement := 'discard'; else v_movement := 'adjustment'; end if;
    insert into public.return_items (organization_id, return_id, delivery_item_id, material_id, lot_id, quantity, equipment_condition, destination, incident_type, incident_description, deduction_requested, deduction_amount) values (v_org, v_return, v_delivery_item, v_material, v_lot, v_requested, v_condition, v_destination, v_incident, v_description, v_deduction, v_amount);
    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values (v_org, v_material, v_lot, v_movement, v_requested, auth.uid(), 'Devolução ' || v_return::text || ' · destino: ' || v_destination);
  end loop;
  return v_return;
end;
$$;

revoke all on function public.register_return(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;
