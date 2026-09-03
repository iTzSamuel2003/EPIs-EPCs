create table public.returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  returned_at date not null default current_date,
  reason text not null check (reason in ('replacement','termination','role_change','damaged','other')),
  responsible_id uuid not null references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_id uuid not null references public.returns(id) on delete restrict,
  delivery_item_id uuid not null references public.delivery_items(id),
  material_id uuid not null references public.materials(id),
  lot_id uuid not null references public.material_lots(id),
  quantity int not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index returns_org_date_idx on public.returns(organization_id, returned_at desc);
create index return_items_return_idx on public.return_items(return_id);
create index return_items_delivery_item_idx on public.return_items(delivery_item_id);

alter table public.returns enable row level security;
alter table public.return_items enable row level security;
create policy "organization members can access returns" on public.returns for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
create policy "organization members can access return items" on public.return_items for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());

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
  v_material uuid;
  v_lot uuid;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org) then raise exception 'Funcionário não encontrado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um equipamento'; end if;
  insert into public.returns (organization_id, employee_id, returned_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_returned_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), '')) returning id into v_return;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_delivery_item := (v_item->>'delivery_item_id')::uuid;
    v_requested := (v_item->>'quantity')::int;
    select di.material_id, di.lot_id, di.quantity into v_material, v_lot, v_delivered from public.delivery_items di join public.deliveries d on d.id = di.delivery_id where di.id = v_delivery_item and di.organization_id = v_org and d.employee_id = p_employee_id;
    if v_material is null then raise exception 'Equipamento entregue não encontrado'; end if;
    select coalesce(sum(quantity), 0) into v_returned from public.return_items where delivery_item_id = v_delivery_item;
    if v_requested is null or v_requested <= 0 or v_requested > v_delivered - v_returned then raise exception 'Quantidade devolvida inválida'; end if;
    update public.material_lots set available_quantity = available_quantity + v_requested where id = v_lot and organization_id = v_org;
    insert into public.return_items (organization_id, return_id, delivery_item_id, material_id, lot_id, quantity) values (v_org, v_return, v_delivery_item, v_material, v_lot, v_requested);
    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values (v_org, v_material, v_lot, 'return', v_requested, auth.uid(), 'Devolução ' || v_return::text);
  end loop;
  return v_return;
end;
$$;

revoke all on function public.register_return(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;

