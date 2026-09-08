-- Exige a numeração da bota de borracha e mantém o estoque separado por variação.
alter table public.delivery_items
  add column if not exists variant_id uuid references public.material_variants(id);

create index if not exists delivery_items_variant_idx
  on public.delivery_items(organization_id, variant_id);

create or replace function public.register_delivery(
  p_employee_id uuid,
  p_reason text,
  p_delivered_at date,
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
  v_delivery uuid;
  v_item jsonb;
  v_material uuid;
  v_variant uuid;
  v_requested int;
  v_remaining int;
  v_take int;
  v_lot record;
  v_material_row record;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org and status <> 'terminated') then raise exception 'Funcionário não encontrado ou desligado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_requested := (v_item->>'quantity')::int;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if not found then raise exception 'Material não encontrado ou inativo'; end if;
    if v_requested is null or v_requested <= 0 then raise exception 'Quantidade inválida para o material'; end if;
    if lower(v_material_row.name) like '%bota de borracha%' and v_variant is null then
      raise exception 'Informe a numeração da bota de borracha';
    end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then
      raise exception 'A numeração selecionada não pertence ao material ou está inativa';
    end if;
    if v_material_row.contract_item_code is not null then
      if v_material_row.ca_required and (v_material_row.ca_number is null or upper(trim(v_material_row.ca_number)) in ('PENDENTE', 'N/A')) then raise exception 'Material bloqueado: CA não cadastrado (%)', v_material_row.name; end if;
      if v_material_row.ca_required and v_material_row.ca_expires_at is not null and v_material_row.ca_expires_at < coalesce(p_delivered_at, current_date) then raise exception 'Material bloqueado: CA vencido (%)', v_material_row.name; end if;
      if v_material_row.test_required and not exists (select 1 from public.material_tests mt where mt.organization_id = v_org and mt.material_id = v_material and mt.result in ('approved', 'approved_with_restrictions') and mt.next_due_at >= coalesce(p_delivered_at, current_date)) then raise exception 'Material bloqueado: ensaio vencido ou ausente (%)', v_material_row.name; end if;
    end if;
  end loop;

  insert into public.deliveries (organization_id, employee_id, delivered_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_delivered_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), '')) returning id into v_delivery;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_requested := (v_item->>'quantity')::int;
    v_remaining := v_requested;
    for v_lot in select id, available_quantity from public.material_lots where organization_id = v_org and material_id = v_material and (variant_id = v_variant or (variant_id is null and v_variant is null)) and available_quantity > 0 and (expires_at is null or expires_at >= current_date) order by expires_at asc nulls last, entry_date asc, created_at asc for update loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_lot.available_quantity);
      update public.material_lots set available_quantity = available_quantity - v_take where id = v_lot.id;
      insert into public.delivery_items (organization_id, delivery_id, material_id, variant_id, lot_id, quantity, expected_replacement_at) values (v_org, v_delivery, v_material, v_variant, v_lot.id, v_take, nullif(v_item->>'expected_replacement_at', '')::date);
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
