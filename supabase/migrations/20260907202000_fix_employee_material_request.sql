create or replace function private.create_employee_material_request(
  p_registration text,
  p_cpf text,
  p_delivery_item_id uuid,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_employee public.employees;
  v_delivery_item public.delivery_items;
  v_material public.materials;
  v_lot public.material_lots;
  v_returned integer;
  v_remaining integer;
  v_request_id uuid;
begin
  select * into v_employee
  from public.employees
  where registration = trim(p_registration)
    and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and status <> 'terminated'
  limit 1;

  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if p_delivery_item_id is null then raise exception 'Selecione o material'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Descreva a solicitação'; end if;

  select di.*
  into v_delivery_item
  from public.delivery_items di
  join public.deliveries d on d.id = di.delivery_id
  where di.id = p_delivery_item_id
    and di.organization_id = v_employee.organization_id
    and d.organization_id = v_employee.organization_id
    and d.employee_id = v_employee.id
  for update of di;

  if v_delivery_item.id is null then raise exception 'Material entregue não encontrado'; end if;

  select * into v_material from public.materials where id = v_delivery_item.material_id;
  select * into v_lot from public.material_lots where id = v_delivery_item.lot_id;
  select coalesce(sum(quantity), 0) into v_returned
  from public.return_items
  where delivery_item_id = p_delivery_item_id;
  v_remaining := v_delivery_item.quantity - v_returned;
  if v_remaining <= 0 then raise exception 'Material já foi totalmente devolvido'; end if;

  insert into public.employee_portal_requests (
    organization_id, employee_id, request_type, description,
    delivery_item_id, requested_quantity, material_name_snapshot, lot_number_snapshot
  ) values (
    v_employee.organization_id, v_employee.id, 'replacement', trim(p_description),
    p_delivery_item_id, v_remaining, v_material.name, v_lot.lot_number
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'Já existe uma solicitação aberta para este material';
end;
$$;
