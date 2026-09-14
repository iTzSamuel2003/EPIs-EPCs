-- Permite entradas sem número de nota e identifica explicitamente esses lançamentos.
alter table public.stock_invoices
  alter column invoice_number drop not null;

alter table public.stock_invoices
  add column if not exists without_invoice boolean not null default false;

update public.stock_invoices
set without_invoice = invoice_number is null
where without_invoice is distinct from (invoice_number is null);

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
    v_lot_number := 'LOTE-' || to_char(coalesce(p_entry_date, current_date), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if v_material_row.id is null then raise exception 'Material não encontrado na organização'; end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then raise exception 'A variação selecionada não pertence ao material ou está inativa'; end if;
    if v_material_row.test_required and (v_test_performed_at is null or v_test_expires_at is null) then raise exception 'Informe a data do ensaio e a validade do ensaio para o material (%)', v_material_row.name; end if;
    if v_test_expires_at is not null and v_test_performed_at is not null and v_test_expires_at < v_test_performed_at then raise exception 'A validade do ensaio não pode ser anterior à data do ensaio'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantidade inválida para um dos itens'; end if;
    if v_unit_cost < 0 then raise exception 'Custo unitário inválido para um dos itens'; end if;

    insert into public.material_lots (organization_id, material_id, variant_id, lot_number, received_quantity, available_quantity, entry_date, manufactured_at, expires_at, test_performed_at, test_expires_at, invoice_number, invoice_file_path, invoice_id, unit_cost, notes)
    values (v_org, v_material, v_variant, v_lot_number, v_quantity, v_quantity, coalesce(p_entry_date, current_date), nullif(v_item->>'manufactured_at', '')::date, nullif(v_item->>'expires_at', '')::date, v_test_performed_at, v_test_expires_at, v_invoice_number, nullif(trim(p_invoice_file_path), ''), v_invoice, v_unit_cost, nullif(trim(coalesce(v_item->>'notes', p_notes)), '')) returning id into v_lot;

    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_org, v_material, v_lot, 'entry', v_quantity, auth.uid(), nullif(trim(p_notes), ''));
  end loop;
  return v_invoice;
end;
$$;

revoke all on function public.register_stock_entry_batch(text, date, jsonb, text, text) from public;
grant execute on function public.register_stock_entry_batch(text, date, jsonb, text, text) to authenticated;

create or replace function public.update_stock_entry_invoice(
  p_invoice_id uuid, p_invoice_number text, p_entry_date date,
  p_notes text, p_items jsonb
)
returns void language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_invoice public.stock_invoices;
  v_item jsonb;
  v_lot public.material_lots;
  v_lot_id uuid;
  v_quantity int;
  v_delta int;
  v_consumed int;
  v_lot_number text;
  v_manufactured_at date;
  v_expires_at date;
  v_unit_cost numeric(12,2);
  v_invoice_number text := nullif(trim(p_invoice_number), '');
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  select * into v_invoice from public.stock_invoices where id = p_invoice_id and organization_id = v_org for update;
  if v_invoice.id is null then raise exception 'Entrada não encontrada'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'A entrada precisa ter ao menos um item'; end if;
  update public.stock_invoices set invoice_number = v_invoice_number, without_invoice = v_invoice_number is null, issued_at = coalesce(p_entry_date, issued_at), notes = nullif(trim(p_notes), '') where id = p_invoice_id and organization_id = v_org;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid; v_quantity := (v_item->>'quantity')::int; v_lot_number := nullif(trim(v_item->>'lot_number'), ''); v_manufactured_at := nullif(v_item->>'manufactured_at', '')::date; v_expires_at := nullif(v_item->>'expires_at', '')::date; v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_lot_id is null or v_quantity is null or v_quantity <= 0 or v_lot_number is null then raise exception 'Revise lote e quantidade dos itens'; end if;
    select * into v_lot from public.material_lots where id = v_lot_id and organization_id = v_org and invoice_id = p_invoice_id for update;
    if v_lot.id is null then raise exception 'Item da entrada não encontrado'; end if;
    v_consumed := v_lot.received_quantity - v_lot.available_quantity;
    if v_quantity < v_consumed then raise exception 'A quantidade do lote % não pode ser menor que o que já saiu do estoque (%).', v_lot.lot_number, v_consumed; end if;
    v_delta := v_quantity - v_lot.received_quantity;
    update public.material_lots set lot_number = v_lot_number, received_quantity = v_quantity, available_quantity = v_lot.available_quantity + v_delta, manufactured_at = v_manufactured_at, expires_at = v_expires_at, unit_cost = v_unit_cost, invoice_number = v_invoice_number where id = v_lot_id;
    if v_delta <> 0 then insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values (v_org, v_lot.material_id, v_lot_id, 'adjustment', abs(v_delta), auth.uid(), case when v_delta > 0 then 'Correção de entrada: aumento de ' else 'Correção de entrada: redução de ' end || abs(v_delta)::text || ' unidade(s)'); end if;
  end loop;
end;
$$;
revoke all on function public.update_stock_entry_invoice(uuid, text, date, text, jsonb) from public;
grant execute on function public.update_stock_entry_invoice(uuid, text, date, text, jsonb) to authenticated;
