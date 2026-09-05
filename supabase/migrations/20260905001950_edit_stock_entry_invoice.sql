create or replace function public.update_stock_entry_invoice(
  p_invoice_id uuid,
  p_invoice_number text,
  p_entry_date date,
  p_notes text,
  p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, private
as $$
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
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  select * into v_invoice from public.stock_invoices where id = p_invoice_id and organization_id = v_org for update;
  if v_invoice.id is null then raise exception 'Nota fiscal não encontrada'; end if;
  if nullif(trim(p_invoice_number), '') is null then raise exception 'Informe o número da nota fiscal'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'A nota precisa ter ao menos um item'; end if;

  update public.stock_invoices
  set invoice_number = trim(p_invoice_number), issued_at = coalesce(p_entry_date, issued_at), notes = nullif(trim(p_notes), '')
  where id = p_invoice_id and organization_id = v_org;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_quantity := (v_item->>'quantity')::int;
    v_lot_number := nullif(trim(v_item->>'lot_number'), '');
    v_manufactured_at := nullif(v_item->>'manufactured_at', '')::date;
    v_expires_at := nullif(v_item->>'expires_at', '')::date;
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_lot_id is null or v_quantity is null or v_quantity <= 0 or v_lot_number is null then raise exception 'Revise lote e quantidade dos itens'; end if;
    select * into v_lot from public.material_lots where id = v_lot_id and organization_id = v_org and invoice_id = p_invoice_id for update;
    if v_lot.id is null then raise exception 'Item da nota fiscal não encontrado'; end if;
    v_consumed := v_lot.received_quantity - v_lot.available_quantity;
    if v_quantity < v_consumed then raise exception 'A quantidade do lote % não pode ser menor que o que já saiu do estoque (%).', v_lot.lot_number, v_consumed; end if;
    v_delta := v_quantity - v_lot.received_quantity;
    update public.material_lots set lot_number = v_lot_number, received_quantity = v_quantity, available_quantity = v_lot.available_quantity + v_delta, manufactured_at = v_manufactured_at, expires_at = v_expires_at, unit_cost = v_unit_cost, invoice_number = trim(p_invoice_number) where id = v_lot_id;
    if v_delta <> 0 then
      insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
      values (v_org, v_lot.material_id, v_lot_id, 'adjustment', abs(v_delta), auth.uid(), case when v_delta > 0 then 'Correção de entrada: aumento de ' else 'Correção de entrada: redução de ' end || abs(v_delta)::text || ' unidade(s)');
    end if;
  end loop;
end;
$$;

revoke all on function public.update_stock_entry_invoice(uuid, text, date, text, jsonb) from public;
grant execute on function public.update_stock_entry_invoice(uuid, text, date, text, jsonb) to authenticated;
