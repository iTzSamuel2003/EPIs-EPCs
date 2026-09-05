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
  v_quantity int;
  v_invoice_number text := nullif(trim(p_invoice_number), '');
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if v_invoice_number is null then raise exception 'Informe o número da nota fiscal'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um item'; end if;
  insert into public.stock_invoices (organization_id, invoice_number, issued_at, file_path, notes, created_by)
  values (v_org, v_invoice_number, coalesce(p_entry_date, current_date), nullif(trim(p_invoice_file_path), ''), nullif(trim(p_notes), ''), auth.uid())
  returning id into v_invoice;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid;
    v_quantity := (v_item->>'quantity')::int;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantidade inválida para um dos itens'; end if;
    if not exists (select 1 from public.materials where id = v_material and organization_id = v_org) then raise exception 'Material não encontrado na organização'; end if;
    insert into public.material_lots (organization_id, material_id, lot_number, received_quantity, available_quantity, entry_date, manufactured_at, expires_at, invoice_number, invoice_file_path, invoice_id, notes)
    values (v_org, v_material, trim(v_item->>'lot_number'), v_quantity, v_quantity, coalesce(p_entry_date, current_date), nullif(v_item->>'manufactured_at', '')::date, nullif(v_item->>'expires_at', '')::date, v_invoice_number, nullif(trim(p_invoice_file_path), ''), v_invoice, nullif(trim(coalesce(v_item->>'notes', p_notes)), '')) returning id into v_lot;
    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_org, v_material, v_lot, 'entry', v_quantity, auth.uid(), nullif(trim(p_notes), ''));
  end loop;
  return v_invoice;
end;
$$;

revoke all on function public.register_stock_entry_batch(text, date, jsonb, text, text) from public;
grant execute on function public.register_stock_entry_batch(text, date, jsonb, text, text) to authenticated;

do $$
declare
  v_org uuid;
  v_invoice uuid;
  v_invoice_number text;
begin
  select organization_id into v_org
  from public.material_lots
  where invoice_id is null
  order by created_at
  limit 1;
  if v_org is not null then
    v_invoice_number := 'SEM-NOTA-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
    insert into public.stock_invoices (organization_id, invoice_number, issued_at, notes)
    values (v_org, v_invoice_number, current_date, 'Entrada recuperada sem número de nota fiscal.')
    returning id into v_invoice;
    update public.material_lots
    set invoice_id = v_invoice, invoice_number = v_invoice_number
    where organization_id = v_org and invoice_id is null;
  end if;
end $$;
