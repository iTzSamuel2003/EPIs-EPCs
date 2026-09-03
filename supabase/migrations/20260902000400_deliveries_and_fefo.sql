create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  delivered_at date not null default current_date,
  reason text not null check (reason in ('admission','periodic_change','damaged','lost','role_change','replacement','other')),
  responsible_id uuid not null references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

create table public.delivery_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  material_id uuid not null references public.materials(id),
  lot_id uuid not null references public.material_lots(id),
  quantity int not null check (quantity > 0),
  expected_replacement_at date,
  created_at timestamptz not null default now()
);

create index deliveries_org_date_idx on public.deliveries(organization_id, delivered_at desc);
create index delivery_items_delivery_idx on public.delivery_items(delivery_id);
create index delivery_items_employee_idx on public.deliveries(employee_id, delivered_at desc);

alter table public.deliveries enable row level security;
alter table public.delivery_items enable row level security;
create policy "organization members can access deliveries" on public.deliveries for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
create policy "organization members can access delivery items" on public.delivery_items for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());

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
  v_requested int;
  v_remaining int;
  v_take int;
  v_lot record;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org and status <> 'terminated') then raise exception 'Funcionário não encontrado ou desligado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;
  insert into public.deliveries (organization_id, employee_id, delivered_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_delivered_at, current_date), p_reason, (select auth.uid()), nullif(trim(p_notes), '')) returning id into v_delivery;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid;
    v_requested := (v_item->>'quantity')::int;
    if v_requested is null or v_requested <= 0 then raise exception 'Quantidade inválida para o material'; end if;
    v_remaining := v_requested;
    for v_lot in select id, available_quantity from public.material_lots where organization_id = v_org and material_id = v_material and available_quantity > 0 and (expires_at is null or expires_at >= current_date) order by expires_at asc nulls last, entry_date asc, created_at asc for update loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_lot.available_quantity);
      update public.material_lots set available_quantity = available_quantity - v_take where id = v_lot.id;
      insert into public.delivery_items (organization_id, delivery_id, material_id, lot_id, quantity, expected_replacement_at) values (v_org, v_delivery, v_material, v_lot.id, v_take, nullif(v_item->>'expected_replacement_at', '')::date);
      insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values (v_org, v_material, v_lot.id, 'delivery', v_take, (select auth.uid()), 'Entrega ' || v_delivery::text);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then raise exception 'Estoque insuficiente para o material %', v_material; end if;
  end loop;
  return v_delivery;
end;
$$;

revoke all on function public.register_delivery(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_delivery(uuid, text, date, jsonb, text) to authenticated;
