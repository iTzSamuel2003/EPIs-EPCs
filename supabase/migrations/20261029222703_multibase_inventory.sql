-- Versão registrada no histórico remoto pelo Supabase em 2026-10-29.
create table public.organization_bases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  address text check (address is null or length(address) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

alter table public.profiles
  add constraint profiles_organization_id_id_key unique (organization_id, id);
alter table public.material_lots
  add constraint material_lots_organization_id_id_key unique (organization_id, id);

create table public.profile_base_access (
  organization_id uuid not null,
  profile_id uuid not null,
  base_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, profile_id, base_id),
  foreign key (organization_id, profile_id)
    references public.profiles (organization_id, id) on delete cascade,
  foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id) on delete cascade
);

create index profile_base_access_profile_idx
  on public.profile_base_access (profile_id, base_id);
create unique index organization_bases_org_normalized_name_key
  on public.organization_bases (organization_id, lower(btrim(name)));

insert into public.organization_bases (organization_id, name)
select organization.id, base_name.name
from public.organizations organization
cross join (values ('Dourados'), ('Campo Grande'), ('Naviraí')) as base_name(name)
where upper(trim(organization.name)) = 'DSX'
on conflict (organization_id, name) do nothing;

insert into public.organization_bases (organization_id, name)
select organization.id, 'Base principal'
from public.organizations organization
where not exists (
  select 1 from public.organization_bases base
  where base.organization_id = organization.id
);

alter table public.employees add column base_id uuid;
alter table public.material_lots add column base_id uuid;
alter table public.material_lots add column origin_lot_id uuid references public.material_lots(id) on delete restrict;
alter table public.stock_movements add column base_id uuid;
alter table public.stock_invoices add column base_id uuid;
alter table public.material_units add column base_id uuid;
alter table public.deliveries add column base_id uuid;
alter table public.pending_deliveries add column base_id uuid;
alter table public.returns add column base_id uuid;

update public.employees employee
set base_id = base.id
from public.organization_bases base
where employee.organization_id = base.organization_id
  and lower(trim(coalesce(employee.unit, ''))) = lower(base.name);

update public.material_lots lot
set base_id = coalesce(
  (select base.id from public.organization_bases base
   where base.organization_id = lot.organization_id
     and lower(base.name) = case when upper(trim((select organization.name from public.organizations organization where organization.id = lot.organization_id))) = 'DSX' then 'dourados' else 'base principal' end
   limit 1),
  (select base.id from public.organization_bases base where base.organization_id = lot.organization_id order by base.created_at, base.id limit 1)
);

update public.stock_invoices invoice
set base_id = coalesce(
  (select lot.base_id from public.material_lots lot where lot.invoice_id = invoice.id order by lot.created_at limit 1),
  (select base.id from public.organization_bases base
   where base.organization_id = invoice.organization_id
     and lower(base.name) = case when upper(trim((select organization.name from public.organizations organization where organization.id = invoice.organization_id))) = 'DSX' then 'dourados' else 'base principal' end
   limit 1)
);

update public.stock_movements movement
set base_id = coalesce(
  (select lot.base_id from public.material_lots lot where lot.id = movement.lot_id),
  (select base.id from public.organization_bases base
   where base.organization_id = movement.organization_id
     and lower(base.name) = case when upper(trim((select organization.name from public.organizations organization where organization.id = movement.organization_id))) = 'DSX' then 'dourados' else 'base principal' end
   limit 1)
);

update public.deliveries delivery
set base_id = coalesce(
  (select employee.base_id from public.employees employee where employee.id = delivery.employee_id),
  (select lot.base_id from public.delivery_items item join public.material_lots lot on lot.id = item.lot_id where item.delivery_id = delivery.id order by item.created_at limit 1),
  (select base.id from public.organization_bases base
   where base.organization_id = delivery.organization_id
     and lower(base.name) = case when upper(trim((select organization.name from public.organizations organization where organization.id = delivery.organization_id))) = 'DSX' then 'dourados' else 'base principal' end
   limit 1)
);

update public.pending_deliveries pending
set base_id = coalesce(
  (select employee.base_id from public.employees employee where employee.id = pending.employee_id),
  (select lot.base_id
   from jsonb_array_elements(pending.lot_plan) plan(value)
   join public.material_lots lot on lot.id = nullif(plan.value->>'lot_id', '')::uuid
   order by lot.created_at limit 1),
  (select base.id from public.organization_bases base
   where base.organization_id = pending.organization_id
     and lower(base.name) = case when upper(trim((select organization.name from public.organizations organization where organization.id = pending.organization_id))) = 'DSX' then 'dourados' else 'base principal' end
   limit 1)
);

update public.returns return_record
set base_id = coalesce(
  (select employee.base_id from public.employees employee where employee.id = return_record.employee_id),
  (select lot.base_id from public.return_items item join public.material_lots lot on lot.id = item.lot_id where item.return_id = return_record.id order by item.created_at limit 1),
  (select base.id from public.organization_bases base
   where base.organization_id = return_record.organization_id
     and lower(base.name) = case when upper(trim((select organization.name from public.organizations organization where organization.id = return_record.organization_id))) = 'DSX' then 'dourados' else 'base principal' end
   limit 1)
);

update public.material_units unit
set base_id = coalesce(
  (select employee.base_id from public.employees employee where employee.id = unit.employee_id),
  (select delivery.base_id from public.delivery_items item join public.deliveries delivery on delivery.id = item.delivery_id where item.id = unit.delivery_item_id),
  (select return_record.base_id from public.return_items item join public.returns return_record on return_record.id = item.return_id where item.id = unit.pending_return_item_id),
  (select base.id from public.organization_bases base
   where base.organization_id = unit.organization_id
     and lower(base.name) = case when upper(trim((select organization.name from public.organizations organization where organization.id = unit.organization_id))) = 'DSX' then 'dourados' else 'base principal' end
   limit 1)
);

alter table public.material_lots alter column base_id set not null;
alter table public.stock_movements alter column base_id set not null;
alter table public.stock_invoices alter column base_id set not null;
alter table public.material_units alter column base_id set not null;
alter table public.deliveries alter column base_id set not null;
alter table public.pending_deliveries alter column base_id set not null;
alter table public.returns alter column base_id set not null;

alter table public.employees
  add constraint employees_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id);
alter table public.material_lots
  add constraint material_lots_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id),
  add constraint material_lots_organization_origin_lot_fkey foreign key (organization_id, origin_lot_id)
    references public.material_lots (organization_id, id);
alter table public.stock_movements
  add constraint stock_movements_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id);
alter table public.stock_invoices
  add constraint stock_invoices_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id);
alter table public.material_units
  add constraint material_units_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id);
alter table public.deliveries
  add constraint deliveries_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id);
alter table public.pending_deliveries
  add constraint pending_deliveries_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id);
alter table public.returns
  add constraint returns_organization_base_fkey foreign key (organization_id, base_id)
    references public.organization_bases (organization_id, id);

alter table public.material_lots drop constraint if exists material_lots_check;
alter table public.material_lots drop constraint if exists material_lots_received_quantity_check;
alter table public.material_lots
  add constraint material_lots_received_quantity_nonnegative check (received_quantity >= 0),
  add constraint material_lots_available_not_over_received check (available_quantity <= received_quantity);
alter table public.material_lots drop constraint if exists material_lots_organization_id_material_id_lot_number_key;
create unique index material_lots_base_original_lot_key
  on public.material_lots (organization_id, material_id, base_id, lot_number)
  where origin_lot_id is null;
create unique index material_lots_base_moved_lot_key
  on public.material_lots (organization_id, material_id, base_id, lot_number, origin_lot_id)
  where origin_lot_id is not null;
create index material_lots_org_base_stock_idx
  on public.material_lots (organization_id, base_id, material_id, available_quantity);
create index employees_org_base_status_idx
  on public.employees (organization_id, base_id, status, full_name);
create index stock_movements_org_base_created_idx
  on public.stock_movements (organization_id, base_id, created_at desc);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_base_id uuid not null,
  destination_base_id uuid not null,
  status text not null default 'in_transit' check (status in ('in_transit', 'received', 'cancelled')),
  notes text,
  created_by uuid not null references auth.users(id),
  shipped_at timestamptz not null default now(),
  received_at timestamptz,
  received_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, source_base_id) references public.organization_bases (organization_id, id),
  foreign key (organization_id, destination_base_id) references public.organization_bases (organization_id, id),
  unique (organization_id, id),
  check (source_base_id <> destination_base_id)
);

create table public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  source_lot_id uuid not null references public.material_lots(id),
  destination_lot_id uuid references public.material_lots(id),
  material_id uuid not null references public.materials(id),
  variant_id uuid references public.material_variants(id),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, transfer_id) references public.stock_transfers (organization_id, id)
);

create index stock_transfers_org_status_created_idx
  on public.stock_transfers (organization_id, status, created_at desc);
create index stock_transfers_org_source_idx
  on public.stock_transfers (organization_id, source_base_id, created_at desc);
create index stock_transfers_org_destination_idx
  on public.stock_transfers (organization_id, destination_base_id, created_at desc);
create index stock_transfer_items_transfer_idx
  on public.stock_transfer_items (organization_id, transfer_id);

alter table public.organization_bases enable row level security;
alter table public.profile_base_access enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;

create or replace function private.can_access_base(p_base_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_current_organization_role(array['admin', 'rh'])
    or (private.has_current_organization_role(array['tst'])
      and p_base_id is not null and exists (
      select 1 from public.profile_base_access access
      join public.organization_bases base
        on base.id = access.base_id and base.organization_id = access.organization_id and base.is_active
      where access.organization_id = private.current_organization_id()
        and access.profile_id = auth.uid()
        and access.base_id = p_base_id
    ));
$$;
revoke all on function private.can_access_base(uuid) from public, anon;
grant execute on function private.can_access_base(uuid) to authenticated, service_role;

create or replace function private.base_context_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$ select nullif(current_setting('app.current_base_id', true), '')::uuid; $$;
revoke all on function private.base_context_id() from public, anon;
grant execute on function private.base_context_id() to authenticated, service_role;

create or replace function private.map_employee_base_from_unit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base_name text;
begin
  if tg_op = 'UPDATE' and new.base_id is distinct from old.base_id
    and current_setting('app.allow_employee_base_assignment', true) is distinct from 'true' then
    raise exception 'Altere a base do colaborador pela tela Bases';
  end if;
  if new.base_id is not null then
    select base.name into v_base_name
    from public.organization_bases base
    where base.organization_id = new.organization_id and base.id = new.base_id;
    if v_base_name is null then raise exception 'Base não encontrada nesta organização'; end if;
    new.unit := v_base_name;
  elsif nullif(trim(new.unit), '') is not null then
    select base.id, base.name into new.base_id, v_base_name
    from public.organization_bases base
    where base.organization_id = new.organization_id
      and lower(trim(base.name)) = lower(trim(new.unit))
      and base.is_active
    order by base.created_at limit 1;
    if new.base_id is not null then new.unit := v_base_name; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.map_employee_base_from_unit() from public, anon, authenticated, service_role;
create trigger employees_map_unit_to_base
before insert or update of unit, base_id on public.employees
for each row execute function private.map_employee_base_from_unit();

create or replace function private.fill_and_check_base_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base_id uuid := private.base_context_id();
  v_employee_base uuid;
  v_source_lot_id uuid;
  v_source_base_id uuid;
begin
  if tg_op = 'UPDATE' and new.base_id is distinct from old.base_id
    and not (tg_table_name = 'material_units' and v_base_id is not null) then
    raise exception 'A base operacional deste registro não pode ser alterada diretamente';
  end if;
  if tg_table_name = 'material_lots' then
    new.base_id := coalesce(new.base_id, v_base_id);
  elsif tg_table_name = 'stock_invoices' then
    new.base_id := coalesce(new.base_id, v_base_id);
  elsif tg_table_name = 'stock_movements' then
    if new.movement_type = 'return' and v_base_id is not null then
      v_source_lot_id := new.lot_id;
      new.base_id := v_base_id;
      if v_source_lot_id is not null then
        select source.base_id into v_source_base_id from public.material_lots source
        where source.id = v_source_lot_id and source.organization_id = new.organization_id;
        if v_source_base_id is distinct from v_base_id then
          select lot.id into new.lot_id
          from public.material_lots lot
          where lot.organization_id = new.organization_id
            and lot.base_id = v_base_id
            and lot.material_id = new.material_id
            and lot.lot_number = (select source.lot_number from public.material_lots source where source.id = v_source_lot_id)
            and lot.origin_lot_id = coalesce((select source.origin_lot_id from public.material_lots source where source.id = v_source_lot_id), v_source_lot_id)
          order by lot.created_at limit 1;
        else
          new.lot_id := v_source_lot_id;
        end if;
      end if;
    else
      new.base_id := coalesce(new.base_id, (select lot.base_id from public.material_lots lot where lot.id = new.lot_id));
    end if;
  elsif tg_table_name = 'deliveries' then
    select employee.base_id into v_employee_base from public.employees employee
    where employee.id = new.employee_id and employee.organization_id = new.organization_id;
    new.base_id := coalesce(new.base_id, v_employee_base);
    if new.base_id is null or new.base_id is distinct from v_employee_base then
      raise exception 'A base do colaborador deve estar definida e corresponder à base da entrega';
    end if;
  elsif tg_table_name = 'pending_deliveries' then
    select employee.base_id into v_employee_base from public.employees employee
    where employee.id = new.employee_id and employee.organization_id = new.organization_id;
    new.base_id := coalesce(new.base_id, v_employee_base);
    if new.base_id is null or new.base_id is distinct from v_employee_base then
      raise exception 'Associe o colaborador a uma base antes de gerar a entrega';
    end if;
    if not private.can_access_base(new.base_id) then raise exception 'Você não tem acesso à base deste colaborador'; end if;
    if exists (
      select 1
      from jsonb_array_elements(new.lot_plan) plan(value)
      left join public.material_lots lot on lot.id = nullif(plan.value->>'lot_id', '')::uuid
      where lot.id is null or lot.organization_id <> new.organization_id or lot.base_id <> new.base_id
    ) then raise exception 'A ficha contém lotes de outra base'; end if;
  elsif tg_table_name = 'returns' then
    select employee.base_id into v_employee_base from public.employees employee
    where employee.id = new.employee_id and employee.organization_id = new.organization_id;
    new.base_id := coalesce(new.base_id, v_employee_base);
    if new.base_id is null or new.base_id is distinct from v_employee_base then
      raise exception 'Associe o colaborador a uma base antes de registrar a devolução';
    end if;
    if not private.can_access_base(new.base_id) then raise exception 'Você não tem acesso à base deste colaborador'; end if;
  elsif tg_table_name = 'material_units' then
    if new.employee_id is not null then
      select employee.base_id into v_employee_base from public.employees employee
      where employee.id = new.employee_id and employee.organization_id = new.organization_id;
    end if;
    new.base_id := coalesce(v_base_id, v_employee_base, new.base_id,
      (select delivery.base_id from public.delivery_items item join public.deliveries delivery on delivery.id = item.delivery_id where item.id = new.delivery_item_id),
      (select return_record.base_id from public.return_items item join public.returns return_record on return_record.id = item.return_id where item.id = new.pending_return_item_id));
  end if;

  if new.base_id is null or not exists (
    select 1 from public.organization_bases base
    where base.id = new.base_id and base.organization_id = new.organization_id
  ) then
    raise exception 'Informe uma base válida da organização';
  end if;
  if auth.uid() is not null and not private.can_access_base(new.base_id) then
    raise exception 'Você não tem acesso à base selecionada';
  end if;
  return new;
end;
$$;
revoke all on function private.fill_and_check_base_fields() from public, anon, authenticated, service_role;

create trigger material_lots_fill_base before insert or update of base_id
on public.material_lots for each row execute function private.fill_and_check_base_fields();
create trigger stock_invoices_fill_base before insert or update of base_id
on public.stock_invoices for each row execute function private.fill_and_check_base_fields();
create trigger stock_movements_fill_base before insert or update of base_id, lot_id, movement_type
on public.stock_movements for each row execute function private.fill_and_check_base_fields();
create trigger deliveries_fill_base before insert or update of base_id, employee_id
on public.deliveries for each row execute function private.fill_and_check_base_fields();
create trigger pending_deliveries_fill_base before insert or update of base_id, employee_id, lot_plan
on public.pending_deliveries for each row execute function private.fill_and_check_base_fields();
create trigger returns_fill_base before insert or update of base_id, employee_id
on public.returns for each row execute function private.fill_and_check_base_fields();
create trigger material_units_fill_base before insert or update of base_id, employee_id, status, delivery_item_id, pending_return_item_id
on public.material_units for each row execute function private.fill_and_check_base_fields();

create or replace function private.ensure_delivery_item_same_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery_base uuid;
  v_lot_base uuid;
begin
  select delivery.base_id into v_delivery_base
  from public.deliveries delivery
  where delivery.id = new.delivery_id and delivery.organization_id = new.organization_id;
  select lot.base_id into v_lot_base
  from public.material_lots lot
  where lot.id = new.lot_id and lot.organization_id = new.organization_id;
  if v_delivery_base is null or v_lot_base is null or v_delivery_base <> v_lot_base then
    raise exception 'O lote da entrega precisa pertencer à base do colaborador';
  end if;
  return new;
end;
$$;
revoke all on function private.ensure_delivery_item_same_base() from public, anon, authenticated, service_role;
create trigger delivery_items_validate_base
before insert or update of delivery_id, lot_id on public.delivery_items
for each row execute function private.ensure_delivery_item_same_base();

create or replace function public.prepare_delivery_for_signature(
  p_employee_id uuid,
  p_reason text,
  p_delivered_at date,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_user uuid := auth.uid();
  v_pending uuid;
  v_employee_base uuid;
  v_employee_status text;
  v_item jsonb;
  v_item_index integer := 0;
  v_material uuid;
  v_variant uuid;
  v_requested integer;
  v_remaining integer;
  v_take integer;
  v_eligible_quantity bigint;
  v_date date := coalesce(p_delivered_at, current_date);
  v_material_row record;
  v_lot record;
  v_plan jsonb := '[]'::jsonb;
begin
  if v_user is null or v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not private.current_user_can_access_page('/deliveries') then raise exception 'Seu perfil não tem acesso à página de entregas'; end if;
  select employee.base_id, employee.status::text into v_employee_base, v_employee_status
  from public.employees employee
  where employee.id = p_employee_id and employee.organization_id = v_org;
  if not found or v_employee_status = 'terminated' then raise exception 'Funcionário não encontrado ou desligado'; end if;
  if v_employee_base is null then raise exception 'Associe o colaborador a uma base antes de gerar a entrega'; end if;
  if not private.can_access_base(v_employee_base) then raise exception 'Você não tem acesso à base deste colaborador'; end if;
  if p_reason not in ('admission','periodic_change','damaged','lost','role_change','replacement','other') then raise exception 'Motivo de entrega inválido'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'Observação acima do limite permitido'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) requests(value)
    group by requests.value->>'material_id', nullif(requests.value->>'variant_id', '')
    having count(*) > 1
  ) then raise exception 'Cada material e variação deve aparecer uma única vez na ficha'; end if;

  for v_item in select requests.value from jsonb_array_elements(p_items) requests(value) loop
    v_item_index := v_item_index + 1;
    v_material := nullif(v_item->>'material_id', '')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_requested := nullif(v_item->>'quantity', '')::integer;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if not found then raise exception 'Material não encontrado ou inativo'; end if;
    if v_requested is null or v_requested <= 0 then raise exception 'Quantidade inválida para o material'; end if;
    if lower(v_material_row.name) like '%bota de borracha%' and v_variant is null then raise exception 'Informe a numeração da bota de borracha'; end if;
    if exists (select 1 from public.material_variants where material_id = v_material and organization_id = v_org and active)
      and (v_variant is null or not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active)) then
      raise exception 'Selecione a variação do material';
    end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then
      raise exception 'A variação selecionada não pertence ao material ou está inativa';
    end if;

    select coalesce(sum(lot.available_quantity), 0) into v_eligible_quantity
    from public.material_lots lot
    where lot.organization_id = v_org and lot.base_id = v_employee_base and lot.material_id = v_material
      and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null))
      and lot.available_quantity > 0 and (lot.expires_at is null or lot.expires_at >= v_date)
      and (not v_material_row.ca_required or (
        nullif(trim(lot.ca_number), '') is not null and upper(trim(lot.ca_number)) not in ('PENDENTE','N/A')
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) is not null
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) >= v_date
        and not exists (select 1 from public.ca_certificates certificate where certificate.ca_number = lot.ca_number and (certificate.status ilike '%cancel%' or certificate.status ilike '%suspens%' or certificate.status ilike '%revog%' or certificate.status ilike '%inativ%' or certificate.status ilike '%inval%' or certificate.status ilike '%vencid%' or certificate.status ilike '%expir%'))
      ))
      and (not v_material_row.test_required or (
        lot.test_performed_at is not null and lot.test_performed_at <= v_date and lot.test_expires_at is not null and lot.test_expires_at >= v_date
        and (not v_material_row.report_required or nullif(trim(lot.test_report_number), '') is not null)
      ));
    if v_eligible_quantity < v_requested then raise exception 'Estoque insuficiente em lotes elegíveis da base do colaborador para o material (%)', v_material_row.name; end if;

    v_remaining := v_requested;
    for v_lot in
      select lot.id, lot.available_quantity
      from public.material_lots lot
      where lot.organization_id = v_org and lot.base_id = v_employee_base and lot.material_id = v_material
        and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null))
        and lot.available_quantity > 0 and (lot.expires_at is null or lot.expires_at >= v_date)
        and (not v_material_row.ca_required or (
          nullif(trim(lot.ca_number), '') is not null and upper(trim(lot.ca_number)) not in ('PENDENTE','N/A')
          and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) is not null
          and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) >= v_date
          and not exists (select 1 from public.ca_certificates certificate where certificate.ca_number = lot.ca_number and (certificate.status ilike '%cancel%' or certificate.status ilike '%suspens%' or certificate.status ilike '%revog%' or certificate.status ilike '%inativ%' or certificate.status ilike '%inval%' or certificate.status ilike '%vencid%' or certificate.status ilike '%expir%'))
        ))
        and (not v_material_row.test_required or (
          lot.test_performed_at is not null and lot.test_performed_at <= v_date and lot.test_expires_at is not null and lot.test_expires_at >= v_date
          and (not v_material_row.report_required or nullif(trim(lot.test_report_number), '') is not null)
        ))
      order by lot.expires_at asc nulls last, lot.entry_date asc, lot.created_at asc
      for update
    loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_lot.available_quantity);
      v_plan := v_plan || jsonb_build_array(jsonb_build_object('item_index', v_item_index, 'material_id', v_material,
        'variant_id', v_variant, 'lot_id', v_lot.id, 'quantity', v_take));
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then raise exception 'O estoque mudou enquanto a ficha era preparada. Atualize a página e tente novamente.'; end if;
  end loop;

  insert into public.pending_deliveries (organization_id, employee_id, requested_by, delivered_at, reason, notes, request_items, lot_plan)
  values (v_org, p_employee_id, v_user, v_date, p_reason, nullif(trim(p_notes), ''), p_items, v_plan)
  returning id into v_pending;
  return v_pending;
end;
$$;
revoke all on function public.prepare_delivery_for_signature(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.prepare_delivery_for_signature(uuid, text, date, jsonb, text) to authenticated;
revoke all on function public.register_delivery(uuid, text, date, jsonb, text, jsonb) from public, anon, authenticated;

create or replace function private.prevent_unsafe_base_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active and (
    exists (select 1 from public.employees employee where employee.organization_id = old.organization_id and employee.base_id = old.id and employee.status <> 'terminated')
    or exists (select 1 from public.material_lots lot where lot.organization_id = old.organization_id and lot.base_id = old.id and lot.available_quantity > 0)
    or exists (select 1 from public.profile_base_access access where access.organization_id = old.organization_id and access.base_id = old.id)
    or exists (select 1 from public.stock_transfers transfer where transfer.organization_id = old.organization_id and transfer.status = 'in_transit' and (transfer.source_base_id = old.id or transfer.destination_base_id = old.id))
  ) then
    raise exception 'Antes de desativar, mova o estoque, realoque funcionários e conclua transferências pendentes';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_unsafe_base_deactivation() from public, anon, authenticated, service_role;
create trigger organization_bases_prevent_unsafe_deactivation
before update of is_active on public.organization_bases
for each row execute function private.prevent_unsafe_base_deactivation();

create or replace function private.move_returned_lot_to_current_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_base uuid := private.base_context_id();
  v_quantity integer;
  v_origin uuid;
  v_destination_id uuid;
  v_lot public.material_lots;
begin
  if v_target_base is null or v_target_base = old.base_id or new.available_quantity <= old.available_quantity then
    return new;
  end if;
  v_quantity := new.available_quantity - old.available_quantity;
  v_origin := coalesce(old.origin_lot_id, old.id);
  select * into v_lot from public.material_lots where id = old.id;

  new.received_quantity := old.received_quantity - v_quantity;
  if new.received_quantity < old.available_quantity then
    raise exception 'A quantidade retornada ultrapassa o saldo rastreável do lote';
  end if;
  new.available_quantity := old.available_quantity;

  insert into public.material_lots as existing_lot (
    organization_id, material_id, variant_id, lot_number, received_quantity,
    available_quantity, entry_date, manufactured_at, expires_at, supplier_id,
    invoice_number, notes, invoice_file_path, invoice_id, unit_cost,
    test_performed_at, test_expires_at, test_report_number, test_number,
    ca_number, ca_expires_at, base_id, origin_lot_id
  ) values (
    v_lot.organization_id, v_lot.material_id, v_lot.variant_id, v_lot.lot_number,
    v_quantity, v_quantity, v_lot.entry_date, v_lot.manufactured_at, v_lot.expires_at,
    v_lot.supplier_id, v_lot.invoice_number,
    concat_ws(' · ', nullif(v_lot.notes, ''), 'Retornado para outra base'),
    v_lot.invoice_file_path, v_lot.invoice_id, v_lot.unit_cost,
    v_lot.test_performed_at, v_lot.test_expires_at, v_lot.test_report_number,
    v_lot.test_number, v_lot.ca_number, v_lot.ca_expires_at, v_target_base, v_origin
  )
  on conflict (organization_id, material_id, base_id, lot_number, origin_lot_id)
    where origin_lot_id is not null
  do update set
    received_quantity = existing_lot.received_quantity + excluded.received_quantity,
    available_quantity = existing_lot.available_quantity + excluded.available_quantity
  returning id into v_destination_id;
  return new;
end;
$$;
revoke all on function private.move_returned_lot_to_current_base() from public, anon, authenticated, service_role;
create trigger material_lots_return_to_employee_base
before update of available_quantity on public.material_lots
for each row execute function private.move_returned_lot_to_current_base();

create or replace function public.register_stock_entry_batch_at_base(
  p_base_id uuid,
  p_invoice_number text,
  p_entry_date date,
  p_items jsonb,
  p_invoice_file_path text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.current_organization_id() is null then raise exception 'Sessão inválida'; end if;
  if not private.current_user_can_access_page('/entries') then raise exception 'Seu perfil não tem acesso à página de entradas'; end if;
  if not private.can_access_base(p_base_id) then raise exception 'Você não tem acesso à base selecionada'; end if;
  perform set_config('app.current_base_id', p_base_id::text, true);
  return public.register_stock_entry_batch(p_invoice_number, p_entry_date, p_items, p_invoice_file_path, p_notes);
end;
$$;
revoke all on function public.register_stock_entry_batch_at_base(uuid, text, date, jsonb, text, text) from public, anon, service_role;
grant execute on function public.register_stock_entry_batch_at_base(uuid, text, date, jsonb, text, text) to authenticated;
revoke all on function public.register_stock_entry_batch(text, date, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.register_stock_entry(uuid, text, integer, date, date, date, text, text) from public, anon, authenticated, service_role;

create or replace function public.register_return(
  p_employee_id uuid,
  p_reason text,
  p_returned_at date,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_id uuid;
begin
  if not private.current_user_can_access_page('/returns') then raise exception 'Seu perfil não tem acesso à página de devoluções'; end if;
  select employee.base_id into v_base_id
  from public.employees employee
  where employee.id = p_employee_id and employee.organization_id = private.current_organization_id();
  if v_base_id is null then raise exception 'Associe o colaborador a uma base antes de registrar a devolução'; end if;
  if not private.can_access_base(v_base_id) then raise exception 'Você não tem acesso à base deste colaborador'; end if;
  perform set_config('app.current_base_id', v_base_id::text, true);
  return private.register_return_internal(p_employee_id, p_reason, p_returned_at, p_items, p_notes);
end;
$$;
revoke all on function public.register_return(uuid, text, date, jsonb, text) from public, anon, service_role;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;

create or replace function public.assign_employee_base(p_employee_id uuid, p_base_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_base_name text;
begin
  if auth.uid() is null or v_org is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/bases') then
    raise exception 'Atribuição de base restrita ao RH';
  end if;
  if p_base_id is not null then
    select base.name into v_base_name from public.organization_bases base
    where base.id = p_base_id and base.organization_id = v_org and base.is_active;
    if v_base_name is null then raise exception 'Base não encontrada ou inativa'; end if;
  end if;
  perform set_config('app.allow_employee_base_assignment', 'true', true);
  if exists (
    select 1 from public.pending_deliveries pending
    where pending.employee_id = p_employee_id and pending.organization_id = v_org and pending.status = 'pending_signature'
  ) then raise exception 'Cancele ou conclua as fichas pendentes antes de alterar a base do colaborador'; end if;
  update public.employees employee
  set base_id = p_base_id,
      unit = v_base_name
  where employee.id = p_employee_id and employee.organization_id = v_org;
  if not found then raise exception 'Funcionário não encontrado na organização'; end if;
  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
  values (v_org, auth.uid(), 'employee_base_assigned', 'employees', p_employee_id,
    jsonb_build_object('base_id', p_base_id, 'base_name', v_base_name));
end;
$$;
revoke all on function public.assign_employee_base(uuid, uuid) from public, anon, service_role;
grant execute on function public.assign_employee_base(uuid, uuid) to authenticated;

create or replace function public.assign_employees_base(p_employee_ids uuid[], p_base_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_base_name text;
  v_updated integer;
begin
  if auth.uid() is null or v_org is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/bases') then
    raise exception 'Atribuição de base restrita ao RH';
  end if;
  if p_employee_ids is null or cardinality(p_employee_ids) = 0 or cardinality(p_employee_ids) > 500 then
    raise exception 'Selecione até 500 funcionários para atribuição';
  end if;
  if p_base_id is not null then
    select base.name into v_base_name from public.organization_bases base
    where base.id = p_base_id and base.organization_id = v_org and base.is_active;
    if v_base_name is null then raise exception 'Base não encontrada ou inativa'; end if;
  end if;
  perform set_config('app.allow_employee_base_assignment', 'true', true);
  if exists (
    select 1 from public.pending_deliveries pending
    where pending.employee_id = any(p_employee_ids) and pending.organization_id = v_org and pending.status = 'pending_signature'
  ) then raise exception 'Cancele ou conclua as fichas pendentes antes de alterar a base dos colaboradores selecionados'; end if;
  update public.employees employee
  set base_id = p_base_id, unit = v_base_name
  where employee.id = any(p_employee_ids) and employee.organization_id = v_org;
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(p_employee_ids) then raise exception 'Um ou mais funcionários não foram encontrados na organização'; end if;
  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
  select v_org, auth.uid(), 'employee_base_assigned', 'employees', employee.id,
    jsonb_build_object('base_id', p_base_id, 'base_name', v_base_name)
  from public.employees employee where employee.id = any(p_employee_ids) and employee.organization_id = v_org;
  return v_updated;
end;
$$;
revoke all on function public.assign_employees_base(uuid[], uuid) from public, anon, service_role;
grant execute on function public.assign_employees_base(uuid[], uuid) to authenticated;

create or replace function public.set_profile_base_access(p_profile_id uuid, p_base_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_role text;
  v_inserted integer := 0;
begin
  if auth.uid() is null or v_org is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/bases') then
    raise exception 'A atribuição de bases aos usuários é restrita ao RH';
  end if;
  select profile.role::text into v_role from public.profiles profile
  where profile.id = p_profile_id and profile.organization_id = v_org;
  if not found then raise exception 'Usuário não encontrado na organização'; end if;
  if v_role in ('admin', 'rh') then raise exception 'RH e Administração já têm acesso a todas as bases'; end if;
  if v_role <> 'tst' then raise exception 'Apenas perfis TST podem receber acesso operacional a bases'; end if;
  if coalesce(cardinality(p_base_ids), 0) > 0 and exists (
    select selected.id from unnest(p_base_ids) selected(id)
    left join public.organization_bases base on base.id = selected.id and base.organization_id = v_org and base.is_active
    where base.id is null
  ) then raise exception 'Uma ou mais bases selecionadas não existem ou estão inativas'; end if;
  delete from public.profile_base_access access
  where access.organization_id = v_org and access.profile_id = p_profile_id;
  insert into public.profile_base_access (organization_id, profile_id, base_id)
  select v_org, p_profile_id, selected.id from unnest(coalesce(p_base_ids, array[]::uuid[])) selected(id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
revoke all on function public.set_profile_base_access(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.set_profile_base_access(uuid, uuid[]) to authenticated;

create or replace function public.create_stock_transfer(
  p_source_base_id uuid,
  p_destination_base_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_transfer uuid;
  v_item jsonb;
  v_lot_id uuid;
  v_quantity integer;
  v_lot public.material_lots;
begin
  if auth.uid() is null or v_org is null then raise exception 'Sessão inválida'; end if;
  if not private.current_user_can_access_page('/transfers') then raise exception 'Seu perfil não tem acesso à página de transferências'; end if;
  if not private.can_access_base(p_source_base_id) then raise exception 'Você não tem acesso à base de origem'; end if;
  if p_destination_base_id = p_source_base_id or not exists (
    select 1 from public.organization_bases base
    where base.id = p_destination_base_id and base.organization_id = v_org and base.is_active
  ) then raise exception 'Selecione outra base ativa da organização'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'Observação acima do limite permitido'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item(value)
    group by item.value->>'lot_id' having count(*) > 1
  ) then raise exception 'Cada lote deve aparecer uma única vez na transferência'; end if;

  insert into public.stock_transfers (organization_id, source_base_id, destination_base_id, notes, created_by)
  values (v_org, p_source_base_id, p_destination_base_id, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_transfer;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantidade de transferência inválida'; end if;
    select * into v_lot from public.material_lots lot
    where lot.id = v_lot_id and lot.organization_id = v_org and lot.base_id = p_source_base_id
    for update;
    if not found then raise exception 'Lote não encontrado na base de origem'; end if;
    if v_lot.available_quantity < v_quantity then raise exception 'Saldo insuficiente para transferir o lote %', v_lot.lot_number; end if;
    update public.material_lots set available_quantity = available_quantity - v_quantity where id = v_lot.id;
    insert into public.stock_transfer_items (organization_id, transfer_id, source_lot_id, material_id, variant_id, quantity)
    values (v_org, v_transfer, v_lot.id, v_lot.material_id, v_lot.variant_id, v_quantity);
    insert into public.stock_movements (organization_id, base_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_org, p_source_base_id, v_lot.material_id, v_lot.id, 'transfer', v_quantity, auth.uid(), 'Envio em transferência ' || v_transfer::text);
  end loop;
  return v_transfer;
end;
$$;
revoke all on function public.create_stock_transfer(uuid, uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.create_stock_transfer(uuid, uuid, jsonb, text) to authenticated;

create or replace function public.receive_stock_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_item record;
  v_source public.material_lots;
  v_origin uuid;
  v_destination_id uuid;
begin
  if auth.uid() is null or not private.current_user_can_access_page('/transfers') then raise exception 'Acesso à página de transferências necessário'; end if;
  select * into v_transfer from public.stock_transfers transfer
  where transfer.id = p_transfer_id and transfer.organization_id = private.current_organization_id()
  for update;
  if not found or v_transfer.status <> 'in_transit' then raise exception 'Transferência não está aguardando recebimento'; end if;
  if not private.can_access_base(v_transfer.destination_base_id) then raise exception 'Você não tem acesso à base de destino'; end if;

  for v_item in
    select item.* from public.stock_transfer_items item
    where item.transfer_id = v_transfer.id and item.organization_id = v_transfer.organization_id
    order by item.created_at
    for update
  loop
    select * into v_source from public.material_lots lot where lot.id = v_item.source_lot_id for update;
    if not found or v_source.organization_id <> v_transfer.organization_id or v_source.base_id <> v_transfer.source_base_id then
      raise exception 'O lote de origem da transferência não corresponde';
    end if;
    if v_source.received_quantity < v_item.quantity then raise exception 'Saldo de origem inconsistente para o lote %', v_source.lot_number; end if;
    update public.material_lots set received_quantity = received_quantity - v_item.quantity where id = v_source.id;
    v_origin := coalesce(v_source.origin_lot_id, v_source.id);
    select lot.id into v_destination_id from public.material_lots lot
    where lot.organization_id = v_transfer.organization_id
      and lot.material_id = v_source.material_id
      and lot.base_id = v_transfer.destination_base_id
      and lot.lot_number = v_source.lot_number
      and lot.origin_lot_id = v_origin
    for update;
    if v_destination_id is not null then
      update public.material_lots
      set received_quantity = received_quantity + v_item.quantity,
          available_quantity = available_quantity + v_item.quantity
      where id = v_destination_id;
    else
      insert into public.material_lots (
        organization_id, material_id, variant_id, lot_number, received_quantity,
        available_quantity, entry_date, manufactured_at, expires_at, supplier_id,
        invoice_number, notes, invoice_file_path, invoice_id, unit_cost,
        test_performed_at, test_expires_at, test_report_number, test_number,
        ca_number, ca_expires_at, base_id, origin_lot_id
      ) values (
        v_source.organization_id, v_source.material_id, v_source.variant_id, v_source.lot_number,
        v_item.quantity, v_item.quantity, v_source.entry_date, v_source.manufactured_at,
        v_source.expires_at, v_source.supplier_id, v_source.invoice_number,
        concat_ws(' · ', nullif(v_source.notes, ''), 'Transferido entre bases'),
        v_source.invoice_file_path, v_source.invoice_id, v_source.unit_cost,
        v_source.test_performed_at, v_source.test_expires_at, v_source.test_report_number,
        v_source.test_number, v_source.ca_number, v_source.ca_expires_at,
        v_transfer.destination_base_id, v_origin
      ) returning id into v_destination_id;
    end if;
    update public.stock_transfer_items set destination_lot_id = v_destination_id where id = v_item.id;
    insert into public.stock_movements (organization_id, base_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_transfer.organization_id, v_transfer.destination_base_id, v_source.material_id, v_destination_id,
      'transfer', v_item.quantity, auth.uid(), 'Recebimento da transferência ' || v_transfer.id::text);
  end loop;
  update public.stock_transfers
  set status = 'received', received_at = clock_timestamp(), received_by = auth.uid()
  where id = v_transfer.id;
end;
$$;
revoke all on function public.receive_stock_transfer(uuid) from public, anon, service_role;
grant execute on function public.receive_stock_transfer(uuid) to authenticated;

create or replace function public.cancel_stock_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.stock_transfers;
  v_item record;
begin
  if auth.uid() is null or not private.current_user_can_access_page('/transfers') then raise exception 'Acesso à página de transferências necessário'; end if;
  select * into v_transfer from public.stock_transfers transfer
  where transfer.id = p_transfer_id and transfer.organization_id = private.current_organization_id()
  for update;
  if not found or v_transfer.status <> 'in_transit' then raise exception 'Somente transferências em trânsito podem ser canceladas'; end if;
  if not private.can_access_base(v_transfer.source_base_id) then raise exception 'Você não tem acesso à base de origem'; end if;
  for v_item in select * from public.stock_transfer_items where transfer_id = v_transfer.id for update loop
    update public.material_lots set available_quantity = available_quantity + v_item.quantity
    where id = v_item.source_lot_id and organization_id = v_transfer.organization_id and base_id = v_transfer.source_base_id;
    if not found then raise exception 'Não foi possível restaurar o saldo do lote'; end if;
    insert into public.stock_movements (organization_id, base_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_transfer.organization_id, v_transfer.source_base_id, v_item.material_id, v_item.source_lot_id,
      'transfer', v_item.quantity, auth.uid(), 'Cancelamento da transferência ' || v_transfer.id::text);
  end loop;
  update public.stock_transfers set status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = auth.uid()
  where id = v_transfer.id;
end;
$$;
revoke all on function public.cancel_stock_transfer(uuid) from public, anon, service_role;
grant execute on function public.cancel_stock_transfer(uuid) to authenticated;

create or replace function public.get_pending_stock_transfer_quantities(p_base_id uuid)
returns table (source_lot_id uuid, quantity bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.current_user_can_access_page('/stock') then
    raise exception 'Seu perfil não tem acesso ao estoque';
  end if;
  if not private.can_access_base(p_base_id) then raise exception 'Você não tem acesso a esta base'; end if;
  return query
  select item.source_lot_id, sum(item.quantity)::bigint
  from public.stock_transfers transfer
  join public.stock_transfer_items item on item.transfer_id = transfer.id and item.organization_id = transfer.organization_id
  where transfer.organization_id = private.current_organization_id()
    and transfer.source_base_id = p_base_id and transfer.status = 'in_transit'
  group by item.source_lot_id;
end;
$$;
revoke all on function public.get_pending_stock_transfer_quantities(uuid) from public, anon, service_role;
grant execute on function public.get_pending_stock_transfer_quantities(uuid) to authenticated;

drop policy if exists "organization members can access" on public.organization_bases;
create policy "organization members can read base names"
  on public.organization_bases for select to authenticated
  using (organization_id = private.current_organization_id());
create policy "rh manages organization bases"
  on public.organization_bases for all to authenticated
  using (organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/bases'))
  with check (organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/bases'));
revoke all on public.organization_bases, public.profile_base_access from anon;
revoke all on public.organization_bases, public.profile_base_access from public;
grant select, insert, update, delete on public.organization_bases to authenticated;
grant select on public.profile_base_access to authenticated;
revoke insert, update, delete on public.profile_base_access from authenticated;

create policy "users read own base assignments"
  on public.profile_base_access for select to authenticated
  using (organization_id = private.current_organization_id()
    and (profile_id = auth.uid() or private.has_current_organization_role(array['admin', 'rh'])));
create policy "rh manages base assignments"
  on public.profile_base_access for all to authenticated
  using (organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/bases'))
  with check (organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/bases'));

create policy "authorized users read accessible stock transfers"
  on public.stock_transfers for select to authenticated
  using (organization_id = private.current_organization_id()
    and private.current_user_can_access_page('/transfers')
    and (private.can_access_base(source_base_id) or private.can_access_base(destination_base_id)));
create policy "authorized users read accessible stock transfer items"
  on public.stock_transfer_items for select to authenticated
  using (organization_id = private.current_organization_id()
    and private.current_user_can_access_page('/transfers')
    and exists (
      select 1 from public.stock_transfers transfer
      where transfer.id = transfer_id and transfer.organization_id = organization_id
        and (private.can_access_base(transfer.source_base_id) or private.can_access_base(transfer.destination_base_id))
    ));
revoke insert, update, delete on public.stock_transfers, public.stock_transfer_items from authenticated;
grant select on public.stock_transfers, public.stock_transfer_items to authenticated;
revoke all on public.stock_transfers, public.stock_transfer_items from anon;
revoke all on public.stock_transfers, public.stock_transfer_items from public;

drop policy if exists "authorized pages read operational employee directory" on public.employees;
drop policy if exists "hr history can read employee directory" on public.employees;
create policy "authorized pages read operational employee directory"
  on public.employees for select to authenticated
  using (organization_id = private.current_organization_id()
    and private.can_access_base(base_id)
    and (private.current_user_can_access_page('/')
      or private.current_user_can_access_page('/employees')
      or private.current_user_can_access_page('/deliveries')
      or private.current_user_can_access_page('/returns')
      or private.current_user_can_access_page('/discounts')
      or private.current_user_can_access_page('/requests')
      or private.current_user_can_access_page('/validities')
      or private.current_user_can_access_page('/reports')
      or private.current_user_can_access_page('/movements')
      or private.current_user_can_access_page('/teams')
      or private.current_user_can_access_page('/bases')
      or private.current_user_can_access_page('/attendance')
      or private.current_user_can_access_page('/transfers')));
create policy "hr history can read employee directory"
  on public.employees for select to authenticated
  using (organization_id = private.current_organization_id()
    and private.can_access_base(base_id)
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employee-history'));

do $$
declare
  table_name text;
  policy record;
begin
  foreach table_name in array array['material_lots','stock_movements','stock_invoices','material_units','deliveries','delivery_items','pending_deliveries','returns','return_items','return_accountability'] loop
    for policy in select policyname from pg_policies where schemaname = 'public' and tablename = table_name loop
      execute format('drop policy %I on public.%I', policy.policyname, table_name);
    end loop;
  end loop;
end;
$$;

create policy "users read accessible stock lots"
  on public.material_lots for select to authenticated
  using (organization_id = private.current_organization_id()
    and (
      (private.can_access_base(base_id)
        and (private.current_user_can_access_page('/stock') or private.current_user_can_access_page('/entries')
          or private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/returns')
          or private.current_user_can_access_page('/validities') or private.current_user_can_access_page('/tests')
          or private.current_user_can_access_page('/movements') or private.current_user_can_access_page('/reports')
          or private.current_user_can_access_page('/transfers')))
      or (private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/returns'))
        and exists (select 1 from public.delivery_items item
          join public.deliveries delivery on delivery.id = item.delivery_id and delivery.organization_id = item.organization_id
          join public.employees employee on employee.id = delivery.employee_id and employee.organization_id = delivery.organization_id
          where item.lot_id = material_lots.id and item.organization_id = material_lots.organization_id
            and private.can_access_base(employee.base_id))
    ));
revoke all on public.material_lots from anon, authenticated, public;
grant select on public.material_lots to authenticated;

create policy "users read accessible stock movements"
  on public.stock_movements for select to authenticated
  using (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and (private.current_user_can_access_page('/movements') or private.current_user_can_access_page('/stock')
      or private.current_user_can_access_page('/entries') or private.current_user_can_access_page('/deliveries')
      or private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/costs')
      or private.current_user_can_access_page('/reports') or private.current_user_can_access_page('/transfers')));
revoke all on public.stock_movements from anon, authenticated, public;
grant select on public.stock_movements to authenticated;

create policy "users read accessible stock invoices"
  on public.stock_invoices for select to authenticated
  using (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and (private.current_user_can_access_page('/entries') or private.current_user_can_access_page('/stock')));
revoke all on public.stock_invoices from anon, authenticated, public;
grant select on public.stock_invoices to authenticated;

create policy "users read accessible physical units"
  on public.material_units for select to authenticated
  using (organization_id = private.current_organization_id()
    and (private.can_access_base(base_id) or (employee_id is not null and exists (
      select 1 from public.employees employee where employee.id = material_units.employee_id
        and employee.organization_id = material_units.organization_id and private.can_access_base(employee.base_id)
    )))
    and (private.current_user_can_access_page('/units') or private.current_user_can_access_page('/deliveries')
      or private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees')));
create policy "tst manages accessible physical units"
  on public.material_units for all to authenticated
  using (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and private.has_current_organization_role(array['admin','tst'])
    and (private.current_user_can_access_page('/units') or private.current_user_can_access_page('/deliveries')
      or private.current_user_can_access_page('/returns') or private.is_current_organization_admin()))
  with check (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and private.has_current_organization_role(array['admin','tst'])
    and (private.current_user_can_access_page('/units') or private.current_user_can_access_page('/deliveries')
      or private.current_user_can_access_page('/returns') or private.is_current_organization_admin()));

create policy "users read accessible deliveries"
  on public.deliveries for select to authenticated
  using (organization_id = private.current_organization_id()
    and (private.can_access_base(base_id) or exists (
      select 1 from public.employees employee where employee.id = deliveries.employee_id
        and employee.organization_id = deliveries.organization_id and private.can_access_base(employee.base_id)
    ))
    and (private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/employees')));
create policy "authorized users manage accessible deliveries"
  on public.deliveries for all to authenticated
  using (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and private.current_user_can_access_page('/deliveries'))
  with check (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and private.current_user_can_access_page('/deliveries'));

create policy "users read accessible delivery items"
  on public.delivery_items for select to authenticated
  using (organization_id = private.current_organization_id()
    and exists (select 1 from public.deliveries delivery where delivery.id = delivery_id
      and delivery.organization_id = organization_id
      and (private.can_access_base(delivery.base_id) or exists (
        select 1 from public.employees employee where employee.id = delivery.employee_id
          and employee.organization_id = delivery.organization_id and private.can_access_base(employee.base_id)
      ))
      and (private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/employees'))));
create policy "authorized users manage accessible delivery items"
  on public.delivery_items for all to authenticated
  using (organization_id = private.current_organization_id()
    and exists (select 1 from public.deliveries delivery where delivery.id = delivery_id
      and delivery.organization_id = organization_id and private.can_access_base(delivery.base_id)
      and private.current_user_can_access_page('/deliveries')))
  with check (organization_id = private.current_organization_id()
    and exists (select 1 from public.deliveries delivery where delivery.id = delivery_id
      and delivery.organization_id = organization_id and private.can_access_base(delivery.base_id)
      and private.current_user_can_access_page('/deliveries')));

create policy "users read accessible pending deliveries"
  on public.pending_deliveries for select to authenticated
  using (organization_id = private.current_organization_id()
    and (private.can_access_base(base_id) or (status = 'completed' and exists (
      select 1 from public.employees employee where employee.id = pending_deliveries.employee_id
        and employee.organization_id = pending_deliveries.organization_id and private.can_access_base(employee.base_id)
    )))
    and (private.current_user_can_access_page('/deliveries') or (status = 'completed' and private.current_user_can_access_page('/employees'))));

create policy "users read accessible returns"
  on public.returns for select to authenticated
  using (organization_id = private.current_organization_id()
    and (private.can_access_base(base_id) or exists (
      select 1 from public.employees employee where employee.id = returns.employee_id
        and employee.organization_id = returns.organization_id and private.can_access_base(employee.base_id)
    ))
    and (private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees')
      or private.current_user_can_access_page('/discounts')));
create policy "authorized users manage accessible returns"
  on public.returns for all to authenticated
  using (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and private.current_user_can_access_page('/returns'))
  with check (organization_id = private.current_organization_id() and private.can_access_base(base_id)
    and private.current_user_can_access_page('/returns'));

create policy "users read accessible return items"
  on public.return_items for select to authenticated
  using (organization_id = private.current_organization_id()
    and exists (select 1 from public.returns return_record where return_record.id = return_id
      and return_record.organization_id = organization_id
      and (private.can_access_base(return_record.base_id) or exists (
        select 1 from public.employees employee where employee.id = return_record.employee_id
          and employee.organization_id = return_record.organization_id and private.can_access_base(employee.base_id)
      ))
      and (private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees')
        or private.current_user_can_access_page('/discounts'))));
create policy "authorized users manage accessible return items"
  on public.return_items for all to authenticated
  using (organization_id = private.current_organization_id()
    and exists (select 1 from public.returns return_record where return_record.id = return_id
      and return_record.organization_id = organization_id and private.can_access_base(return_record.base_id)
      and private.current_user_can_access_page('/returns')))
  with check (organization_id = private.current_organization_id()
    and exists (select 1 from public.returns return_record where return_record.id = return_id
      and return_record.organization_id = organization_id and private.can_access_base(return_record.base_id)
      and private.current_user_can_access_page('/returns')));

create policy "users read accessible return accountability"
  on public.return_accountability for select to authenticated
  using (organization_id = private.current_organization_id()
    and exists (select 1 from public.returns return_record where return_record.id = return_id
      and return_record.organization_id = organization_id
      and (private.can_access_base(return_record.base_id) or exists (
        select 1 from public.employees employee where employee.id = return_record.employee_id
          and employee.organization_id = return_record.organization_id and private.can_access_base(employee.base_id)
      ))
      and (private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees')
        or private.current_user_can_access_page('/discounts'))));
create policy "authorized users manage accessible return accountability"
  on public.return_accountability for all to authenticated
  using (organization_id = private.current_organization_id()
    and exists (select 1 from public.returns return_record where return_record.id = return_id
      and return_record.organization_id = organization_id and private.can_access_base(return_record.base_id)
      and private.current_user_can_access_page('/returns')))
  with check (organization_id = private.current_organization_id()
    and exists (select 1 from public.returns return_record where return_record.id = return_id
      and return_record.organization_id = organization_id and private.can_access_base(return_record.base_id)
      and private.current_user_can_access_page('/returns')));

create or replace function private.current_user_can_access_page(p_page text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_organization uuid := private.current_organization_id();
  v_role text;
  v_page_paths text[];
begin
  if v_user is null or v_organization is null or nullif(trim(p_page), '') is null then return false; end if;
  select profile.role::text into v_role from public.profiles profile
  where profile.id = v_user and profile.organization_id = v_organization;
  if not found then return false; end if;
  if p_page = '/discounts' and coalesce(v_role, '') not in ('admin', 'rh') then return false; end if;
  if p_page = '/bases' then return v_role in ('admin', 'rh'); end if;
  if v_role = 'admin' then return true; end if;
  select access.page_paths into v_page_paths from public.profile_access_overrides access
  where access.profile_id = v_user and access.organization_id = v_organization;
  if v_page_paths is null then
    select access.page_paths into v_page_paths from public.organization_role_access access
    where access.organization_id = v_organization and access.role::text = v_role;
  end if;
  if v_page_paths is not null then return p_page = any(v_page_paths); end if;
  return case v_role
    when 'rh' then p_page = any(array['/','/employees','/deliveries','/returns','/discounts','/attendance','/employee-history','/asos','/requests','/stock','/validities','/reports','/bases','/transfers','/help'])
    when 'tst' then p_page = any(array['/','/materials','/entries','/deliveries','/returns','/stock','/validities','/ca','/contract-requirements','/tests','/training-compliance','/compliance','/costs','/reports','/movements','/transfers','/help'])
    else false
  end;
end;
$$;
revoke all on function private.current_user_can_access_page(text) from public, anon;
grant execute on function private.current_user_can_access_page(text) to authenticated, service_role;

update public.organization_role_access
set page_paths = array_append(coalesce(page_paths, array[]::text[]), '/transfers')
where role::text in ('rh','tst') and not ('/transfers' = any(coalesce(page_paths, array[]::text[])));

update public.profile_access_overrides override
set page_paths = array_append(coalesce(override.page_paths, array[]::text[]), '/transfers')
from public.profiles profile
where profile.id = override.profile_id and profile.organization_id = override.organization_id
  and profile.role::text in ('rh','tst') and not ('/transfers' = any(coalesce(override.page_paths, array[]::text[])));

-- Privileged actions must verify base access before using their definer helpers.
create or replace function public.confirm_pending_delivery_physical(
  p_pending_delivery_id uuid,
  p_signature_file_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_id uuid;
begin
  if auth.uid() is null or private.current_organization_id() is null
    or not private.current_user_can_access_page('/deliveries') then
    raise exception 'Delivery page access required';
  end if;
  select pending.base_id into v_base_id
  from public.pending_deliveries pending
  where pending.id = p_pending_delivery_id
    and pending.organization_id = private.current_organization_id()
    and pending.status = 'pending_signature';
  if not found or not private.can_access_base(v_base_id) then
    raise exception 'Pending delivery not found in an authorized base';
  end if;
  return private.confirm_pending_delivery_physical_internal(p_pending_delivery_id, p_signature_file_path);
end;
$$;
revoke all on function public.confirm_pending_delivery_physical(uuid, text) from public, anon, service_role;
grant execute on function public.confirm_pending_delivery_physical(uuid, text) to authenticated;
revoke all on function private.confirm_pending_delivery_physical_internal(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.cancel_pending_delivery(p_pending_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_id uuid;
begin
  if auth.uid() is null or private.current_organization_id() is null
    or not private.current_user_can_access_page('/deliveries') then
    raise exception 'Delivery page access required';
  end if;
  select pending.base_id into v_base_id
  from public.pending_deliveries pending
  where pending.id = p_pending_delivery_id
    and pending.organization_id = private.current_organization_id()
    and pending.status = 'pending_signature';
  if not found or not private.can_access_base(v_base_id) then
    raise exception 'Pending delivery not found in an authorized base';
  end if;
  perform private.cancel_pending_delivery_internal(p_pending_delivery_id);
end;
$$;
revoke all on function public.cancel_pending_delivery(uuid) from public, anon, service_role;
grant execute on function public.cancel_pending_delivery(uuid) to authenticated;
revoke all on function private.cancel_pending_delivery_internal(uuid) from public, anon, authenticated, service_role;

create or replace function public.record_return_accountability(
  p_return_id uuid,
  p_incident_type text,
  p_incident_description text,
  p_employee_signature_name text,
  p_deduction_requested boolean,
  p_deduction_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_id uuid;
  v_employee_base_id uuid;
  v_employee_id uuid;
begin
  if auth.uid() is null or private.current_organization_id() is null
    or not private.current_user_can_access_page('/returns') then
    raise exception 'Return page access required';
  end if;
  select return_record.base_id, return_record.employee_id, employee.base_id
  into v_base_id, v_employee_id, v_employee_base_id
  from public.returns return_record
  join public.employees employee
    on employee.id = return_record.employee_id
    and employee.organization_id = return_record.organization_id
  where return_record.id = p_return_id
    and return_record.organization_id = private.current_organization_id();
  if not found then raise exception 'Return not found in this organization'; end if;
  if not (private.can_access_base(v_base_id) or private.can_access_base(v_employee_base_id)) then
    raise exception 'You do not have access to this return base';
  end if;
  return private.record_return_accountability_internal(
    p_return_id, p_incident_type, p_incident_description,
    p_employee_signature_name, p_deduction_requested, p_deduction_amount
  );
end;
$$;
revoke all on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) from public, anon, service_role;
grant execute on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) to authenticated;
revoke all on function private.record_return_accountability_internal(uuid, text, text, text, boolean, numeric) from public, anon, authenticated, service_role;

create or replace function public.update_stock_entry_invoice(
  p_invoice_id uuid,
  p_invoice_number text,
  p_entry_date date,
  p_notes text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_invoice public.stock_invoices;
  v_item jsonb;
  v_lot public.material_lots;
  v_lot_id uuid;
  v_quantity integer;
  v_delta integer;
  v_consumed integer;
  v_lot_number text;
  v_manufactured_at date;
  v_expires_at date;
  v_unit_cost numeric(12,2);
  v_invoice_number text := nullif(trim(p_invoice_number), '');
begin
  if auth.uid() is null or v_org is null
    or not private.has_current_organization_role(array['admin','tst'])
    or not private.current_user_can_access_page('/entries') then
    raise exception 'Entry edit permission required';
  end if;
  select * into v_invoice from public.stock_invoices invoice
  where invoice.id = p_invoice_id and invoice.organization_id = v_org
  for update;
  if not found then raise exception 'Entry not found'; end if;
  if not private.can_access_base(v_invoice.base_id) then raise exception 'You do not have access to this entry base'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A entrada precisa ter ao menos um item';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item(value)
    group by item.value->>'lot_id' having count(*) > 1
  ) then raise exception 'A lot was repeated while editing this entry'; end if;
  if exists (
    select 1 from public.material_lots lot
    where lot.organization_id = v_org and lot.invoice_id = p_invoice_id and lot.base_id <> v_invoice.base_id
  ) then raise exception 'This entry cannot be edited after its lots were transferred to another base'; end if;

  update public.stock_invoices
  set invoice_number = v_invoice_number,
      without_invoice = v_invoice_number is null,
      issued_at = coalesce(p_entry_date, issued_at),
      notes = nullif(trim(p_notes), '')
  where id = p_invoice_id and organization_id = v_org;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::integer;
    v_lot_number := nullif(trim(v_item->>'lot_number'), '');
    v_manufactured_at := nullif(v_item->>'manufactured_at', '')::date;
    v_expires_at := nullif(v_item->>'expires_at', '')::date;
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_lot_id is null or v_quantity is null or v_quantity <= 0 or v_lot_number is null then
      raise exception 'Revise lote e quantidade dos itens';
    end if;
    select * into v_lot from public.material_lots lot
    where lot.id = v_lot_id and lot.organization_id = v_org
      and lot.invoice_id = p_invoice_id and lot.base_id = v_invoice.base_id
    for update;
    if not found then raise exception 'Entry item not found in this base'; end if;
    v_consumed := v_lot.received_quantity - v_lot.available_quantity;
    if v_quantity < v_consumed then
      raise exception 'Lot quantity % cannot be less than the quantity already issued (%).', v_lot.lot_number, v_consumed;
    end if;
    v_delta := v_quantity - v_lot.received_quantity;
    update public.material_lots
    set lot_number = v_lot_number,
        received_quantity = v_quantity,
        available_quantity = v_lot.available_quantity + v_delta,
        manufactured_at = v_manufactured_at,
        expires_at = v_expires_at,
        unit_cost = v_unit_cost,
        invoice_number = v_invoice_number
    where id = v_lot_id and organization_id = v_org and base_id = v_invoice.base_id;
    if v_delta <> 0 then
      insert into public.stock_movements (organization_id, base_id, material_id, lot_id, movement_type, quantity, created_by, notes)
      values (v_org, v_invoice.base_id, v_lot.material_id, v_lot_id, 'adjustment', abs(v_delta), auth.uid(),
        case when v_delta > 0 then 'Entry correction: increase of ' else 'Entry correction: decrease of ' end || abs(v_delta)::text || ' unit(s)');
    end if;
  end loop;
end;
$$;
revoke all on function public.update_stock_entry_invoice(uuid, text, date, text, jsonb) from public, anon, service_role;
grant execute on function public.update_stock_entry_invoice(uuid, text, date, text, jsonb) to authenticated;

create or replace function public.delete_stock_entry_invoice(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_organization_id();
  v_invoice public.stock_invoices;
begin
  if auth.uid() is null or v_org is null
    or not private.has_current_organization_role(array['admin','tst'])
    or not private.current_user_can_access_page('/entries') then
    raise exception 'Entry deletion permission required';
  end if;
  select * into v_invoice from public.stock_invoices invoice
  where invoice.id = p_invoice_id and invoice.organization_id = v_org
  for update;
  if not found then raise exception 'Invoice not found'; end if;
  if not private.can_access_base(v_invoice.base_id) then raise exception 'You do not have access to this entry base'; end if;
  if exists (
    select 1 from public.material_lots lot
    where lot.organization_id = v_org and lot.invoice_id = p_invoice_id and lot.base_id <> v_invoice.base_id
  ) then raise exception 'This entry cannot be deleted after its lots were transferred to another base'; end if;
  if exists (
    select 1 from public.material_lots lot
    where lot.organization_id = v_org and lot.invoice_id = p_invoice_id
      and lot.base_id = v_invoice.base_id and lot.received_quantity <> lot.available_quantity
  ) then
    raise exception 'This entry cannot be deleted because some materials have already been issued';
  end if;
  delete from public.stock_movements movement
  where movement.organization_id = v_org and movement.base_id = v_invoice.base_id
    and movement.lot_id in (
      select lot.id from public.material_lots lot
      where lot.organization_id = v_org and lot.invoice_id = p_invoice_id and lot.base_id = v_invoice.base_id
    );
  delete from public.material_lots lot
  where lot.organization_id = v_org and lot.invoice_id = p_invoice_id and lot.base_id = v_invoice.base_id;
  delete from public.stock_invoices invoice where invoice.id = p_invoice_id and invoice.organization_id = v_org;
  return v_invoice.file_path;
end;
$$;
revoke all on function public.delete_stock_entry_invoice(uuid) from public, anon, service_role;
grant execute on function public.delete_stock_entry_invoice(uuid) to authenticated;

drop policy if exists "organization members can read invoice attachments" on storage.objects;
drop policy if exists "organization members can upload invoice attachments" on storage.objects;
drop policy if exists "organization members can update invoice attachments" on storage.objects;
drop policy if exists "organization members can delete invoice attachments" on storage.objects;
create policy "users read invoice attachments for accessible bases"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoice-attachments'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and (private.current_user_can_access_page('/entries') or private.current_user_can_access_page('/stock'))
    and (
      exists (select 1 from public.organization_bases base
        where base.organization_id = private.current_organization_id()
          and base.id::text = (storage.foldername(name))[2] and private.can_access_base(base.id))
      or exists (select 1 from public.stock_invoices invoice
        where invoice.organization_id = private.current_organization_id() and invoice.file_path = storage.objects.name
          and private.can_access_base(invoice.base_id))
      or exists (select 1 from public.material_lots lot
        where lot.organization_id = private.current_organization_id() and lot.invoice_file_path = storage.objects.name
          and private.can_access_base(lot.base_id))
    ));
create policy "users upload invoice attachments to accessible bases"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-attachments'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and private.current_user_can_access_page('/entries')
    and exists (select 1 from public.organization_bases base
      where base.organization_id = private.current_organization_id()
        and base.id::text = (storage.foldername(name))[2] and base.is_active and private.can_access_base(base.id)));
create policy "users update invoice attachments for accessible bases"
  on storage.objects for update to authenticated
  using (bucket_id = 'invoice-attachments'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and private.current_user_can_access_page('/entries')
    and exists (select 1 from public.organization_bases base
      where base.organization_id = private.current_organization_id()
        and base.id::text = (storage.foldername(name))[2] and private.can_access_base(base.id)))
  with check (bucket_id = 'invoice-attachments'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and private.current_user_can_access_page('/entries')
    and exists (select 1 from public.organization_bases base
      where base.organization_id = private.current_organization_id()
        and base.id::text = (storage.foldername(name))[2] and private.can_access_base(base.id)));
create policy "users delete invoice attachments for accessible bases"
  on storage.objects for delete to authenticated
  using (bucket_id = 'invoice-attachments'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and private.current_user_can_access_page('/entries')
    and (owner_id = auth.uid()::text or exists (
      select 1 from public.organization_bases base
      where base.organization_id = private.current_organization_id()
        and base.id::text = (storage.foldername(name))[2] and private.can_access_base(base.id))));

comment on table public.organization_bases is 'Bases operacionais de uma organização; o acesso operacional é concedido por perfil.';
comment on table public.profile_base_access is 'Bases operacionais autorizadas para cada usuário TST/Almoxarife.';
comment on table public.stock_transfers is 'Transferências de materiais entre bases, com confirmação de recebimento.';
comment on column public.material_lots.origin_lot_id is 'Lote de origem quando o saldo foi transferido ou devolvido para outra base.';
