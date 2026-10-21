-- A validade do Certificado de Aprovação pertence ao lote recebido, não ao cadastro mestre.
alter table public.material_lots
  add column if not exists ca_number text,
  add column if not exists ca_expires_at date;

-- Preserve os dados já informados: lotes existentes herdam o CA anteriormente salvo no material.
update public.material_lots lot
set ca_number = coalesce(lot.ca_number, nullif(trim(material.ca_number), '')),
    ca_expires_at = coalesce(lot.ca_expires_at, material.ca_expires_at)
from public.materials material
where material.id = lot.material_id
  and material.organization_id = lot.organization_id
  and (lot.ca_number is null or lot.ca_expires_at is null)
  and (nullif(trim(material.ca_number), '') is not null or material.ca_expires_at is not null);

-- Quando o CA já estiver na base sincronizada, use também a validade oficial
-- para que lotes antigos não sejam tratados como válidos por falta de data.
update public.material_lots lot
set ca_expires_at = certificate.valid_until
from public.ca_certificates certificate
where certificate.ca_number = lot.ca_number
  and lot.ca_expires_at is null
  and certificate.valid_until is not null;

-- O catálogo não deve mais exigir um CA único no registro mestre.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.materials'::regclass
      and contype = 'c'
  loop
    if position('ca_number' in lower(v_constraint.definition)) > 0 then
      execute format('alter table public.materials drop constraint %I', v_constraint.conname);
    end if;
  end loop;
end;
$$;

comment on column public.materials.ca_number is 'Legado: novos CAs devem ser registrados em material_lots.ca_number.';
comment on column public.materials.ca_expires_at is 'Legado: novas validades de CA devem ser registradas em material_lots.ca_expires_at.';

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
  v_ca_number text;
  v_ca_expires_at date;
  v_official_ca_expires_at date;
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
    v_ca_number := nullif(trim(v_item->>'ca_number'), '');
    v_ca_expires_at := nullif(v_item->>'ca_expires_at', '')::date;
    v_test_performed_at := nullif(v_item->>'test_performed_at', '')::date;
    v_test_expires_at := nullif(v_item->>'test_expires_at', '')::date;
    v_test_report_number := nullif(trim(v_item->>'test_report_number'), '');
    v_lot_number := 'LOTE-' || to_char(coalesce(p_entry_date, current_date), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if v_material_row.id is null then raise exception 'Material não encontrado na organização'; end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then raise exception 'A variação selecionada não pertence ao material ou está inativa'; end if;
    if v_material_row.ca_required and (v_ca_number is null or upper(v_ca_number) in ('PENDENTE', 'N/A')) then raise exception 'Informe o número do CA para o material (%)', v_material_row.name; end if;
    if v_ca_number is not null then
      select valid_until into v_official_ca_expires_at from public.ca_certificates where ca_number = v_ca_number;
      if v_official_ca_expires_at is not null then v_ca_expires_at := v_official_ca_expires_at; end if;
    end if;
    if v_material_row.ca_required and v_ca_expires_at is null then raise exception 'Informe a validade oficial do CA para o material (%)', v_material_row.name; end if;
    if v_material_row.test_required and (v_test_performed_at is null or v_test_expires_at is null) then raise exception 'Informe a data do ensaio e a validade do ensaio para o material (%)', v_material_row.name; end if;
    if v_material_row.test_required and v_material_row.report_required and v_test_report_number is null then raise exception 'Informe o número do laudo/ensaio para o material (%)', v_material_row.name; end if;
    if v_test_expires_at is not null and v_test_performed_at is not null and v_test_expires_at < v_test_performed_at then raise exception 'A validade do ensaio não pode ser anterior à data do ensaio'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantidade inválida para um dos itens'; end if;
    if v_unit_cost < 0 then raise exception 'Custo unitário inválido para um dos itens'; end if;

    insert into public.material_lots (organization_id, material_id, variant_id, lot_number, received_quantity, available_quantity, entry_date, manufactured_at, expires_at, ca_number, ca_expires_at, test_performed_at, test_expires_at, test_report_number, invoice_number, invoice_file_path, invoice_id, unit_cost, notes)
    values (v_org, v_material, v_variant, v_lot_number, v_quantity, v_quantity, coalesce(p_entry_date, current_date), nullif(v_item->>'manufactured_at', '')::date, nullif(v_item->>'expires_at', '')::date, v_ca_number, v_ca_expires_at, v_test_performed_at, v_test_expires_at, v_test_report_number, v_invoice_number, nullif(trim(p_invoice_file_path), ''), v_invoice, v_unit_cost, nullif(trim(coalesce(v_item->>'notes', p_notes)), ''))
    returning id into v_lot;

    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_org, v_material, v_lot, 'entry', v_quantity, auth.uid(), nullif(trim(p_notes), ''));
  end loop;
  return v_invoice;
end;
$$;

revoke all on function public.register_stock_entry_batch(text, date, jsonb, text, text) from public;
grant execute on function public.register_stock_entry_batch(text, date, jsonb, text, text) to authenticated;

-- O caminho legado não recebe CA; bloqueie entradas sem lote de CA quando o controle for obrigatório.
create or replace function public.register_stock_entry(
  p_material_id uuid, p_lot_number text, p_quantity integer,
  p_entry_date date default current_date, p_manufactured_at date default null,
  p_expires_at date default null, p_invoice_number text default null, p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_lot uuid;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'A quantidade deve ser maior que zero'; end if;
  if exists (select 1 from public.materials where id = p_material_id and organization_id = v_org and ca_required) then
    raise exception 'Use Entrada de materiais para registrar o CA obrigatório por lote';
  end if;
  if not exists (select 1 from public.materials where id = p_material_id and organization_id = v_org) then raise exception 'Material não encontrado na organização'; end if;
  insert into public.material_lots (organization_id, material_id, lot_number, received_quantity, available_quantity, entry_date, manufactured_at, expires_at, invoice_number, notes)
  values (v_org, p_material_id, trim(p_lot_number), p_quantity, p_quantity, coalesce(p_entry_date, current_date), p_manufactured_at, p_expires_at, nullif(trim(p_invoice_number), ''), nullif(trim(p_notes), ''))
  returning id into v_lot;
  insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
  values (v_org, p_material_id, v_lot, 'entry', p_quantity, auth.uid(), nullif(trim(p_notes), ''));
  return v_lot;
end;
$$;

revoke all on function public.register_stock_entry(uuid, text, integer, date, date, date, text, text) from public;
grant execute on function public.register_stock_entry(uuid, text, integer, date, date, date, text, text) to authenticated;

create or replace function public.register_delivery(
  p_employee_id uuid, p_reason text, p_delivered_at date, p_items jsonb, p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_delivery uuid;
  v_delivery_item uuid;
  v_item jsonb;
  v_material uuid;
  v_variant uuid;
  v_requested int;
  v_remaining int;
  v_take int;
  v_eligible_quantity bigint;
  v_delivery_date date := coalesce(p_delivered_at, current_date);
  v_lot record;
  v_material_row record;
  v_variant_size text;
  unit_number int;
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
    if lower(v_material_row.name) like '%bota de borracha%' and v_variant is null then raise exception 'Informe a numeração da bota de borracha'; end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then raise exception 'A numeração selecionada não pertence ao material ou está inativa'; end if;

    select coalesce(sum(lot.available_quantity), 0) into v_eligible_quantity
    from public.material_lots lot
    where lot.organization_id = v_org and lot.material_id = v_material
      and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null))
      and lot.available_quantity > 0
      and (lot.expires_at is null or lot.expires_at >= v_delivery_date)
      and (not v_material_row.ca_required or (
        nullif(trim(lot.ca_number), '') is not null
        and upper(trim(lot.ca_number)) not in ('PENDENTE', 'N/A')
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) is not null
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) >= v_delivery_date
        and not exists (select 1 from public.ca_certificates certificate where certificate.ca_number = lot.ca_number and (certificate.status ilike '%cancel%' or certificate.status ilike '%suspens%' or certificate.status ilike '%revog%' or certificate.status ilike '%inativ%' or certificate.status ilike '%inval%' or certificate.status ilike '%vencid%' or certificate.status ilike '%expir%'))
      ))
      and (not v_material_row.test_required or (
        lot.test_performed_at is not null and lot.test_performed_at <= v_delivery_date and lot.test_expires_at is not null
        and lot.test_expires_at >= v_delivery_date
        and (not v_material_row.report_required or nullif(trim(lot.test_report_number), '') is not null)
      ));
    if v_eligible_quantity < v_requested then
      if v_material_row.ca_required then raise exception 'Estoque insuficiente em lotes com CA válido para o material (%)', v_material_row.name; end if;
      if v_material_row.test_required then raise exception 'Estoque insuficiente em lotes com ensaio válido para o material (%)', v_material_row.name; end if;
      raise exception 'Estoque insuficiente para o material (%)', v_material_row.name;
    end if;
  end loop;

  insert into public.deliveries (organization_id, employee_id, delivered_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, v_delivery_date, p_reason, auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_delivery;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_requested := (v_item->>'quantity')::int;
    v_remaining := v_requested;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org;
    select coalesce(size, name) into v_variant_size from public.material_variants where id = v_variant and organization_id = v_org;
    for v_lot in
      select lot.id, lot.lot_number, lot.available_quantity, lot.variant_id, lot.manufactured_at, lot.test_performed_at, lot.test_expires_at, lot.test_report_number, lot.test_number, lot.ca_number, lot.ca_expires_at
      from public.material_lots lot
      where lot.organization_id = v_org and lot.material_id = v_material
        and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null))
        and lot.available_quantity > 0
        and (lot.expires_at is null or lot.expires_at >= v_delivery_date)
        and (not v_material_row.ca_required or (
          nullif(trim(lot.ca_number), '') is not null
          and upper(trim(lot.ca_number)) not in ('PENDENTE', 'N/A')
          and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) is not null
          and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) >= v_delivery_date
          and not exists (select 1 from public.ca_certificates certificate where certificate.ca_number = lot.ca_number and (certificate.status ilike '%cancel%' or certificate.status ilike '%suspens%' or certificate.status ilike '%revog%' or certificate.status ilike '%inativ%' or certificate.status ilike '%inval%' or certificate.status ilike '%vencid%' or certificate.status ilike '%expir%'))
        ))
        and (not v_material_row.test_required or (
          lot.test_performed_at is not null and lot.test_performed_at <= v_delivery_date and lot.test_expires_at is not null
          and lot.test_expires_at >= v_delivery_date
          and (not v_material_row.report_required or nullif(trim(lot.test_report_number), '') is not null)
        ))
      order by lot.expires_at asc nulls last, lot.entry_date asc, lot.created_at asc
      for update loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_lot.available_quantity);
      update public.material_lots set available_quantity = available_quantity - v_take where id = v_lot.id;
      insert into public.delivery_items (organization_id, delivery_id, material_id, variant_id, lot_id, quantity, expected_replacement_at, test_performed_at, test_expires_at)
      values (v_org, v_delivery, v_material, v_variant, v_lot.id, v_take, nullif(v_item->>'expected_replacement_at', '')::date, v_lot.test_performed_at, v_lot.test_expires_at)
      returning id into v_delivery_item;
      if v_material_row.test_required then
        for unit_number in 1..v_take loop
          insert into public.material_units (organization_id, material_id, unit_identifier, lot_number, size, manufactured_at, ca_number, ca_expires_at, test_performed_at, test_report_number, status, location, notes, delivery_item_id, employee_id, delivered_at, valid_until)
          values (v_org, v_material, 'MU-' || lpad(nextval('public.material_unit_identifier_seq')::text, 8, '0'), v_lot.lot_number, v_variant_size, v_lot.manufactured_at, v_lot.ca_number, v_lot.ca_expires_at, v_lot.test_performed_at, v_lot.test_report_number, 'assigned', null, 'Gerado automaticamente na entrega ' || v_delivery::text, v_delivery_item, p_employee_id, v_delivery_date, v_lot.test_expires_at);
        end loop;
      end if;
      insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
      values (v_org, v_material, v_lot.id, 'delivery', v_take, auth.uid(), 'Entrega ' || v_delivery::text);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then raise exception 'Estoque insuficiente para a variação selecionada'; end if;
  end loop;
  return v_delivery;
end;
$$;

revoke all on function public.register_delivery(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_delivery(uuid, text, date, jsonb, text) to authenticated;
