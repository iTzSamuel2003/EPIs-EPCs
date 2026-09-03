create or replace function public.register_stock_entry(
  p_material_id uuid,
  p_lot_number text,
  p_quantity integer,
  p_entry_date date default current_date,
  p_manufactured_at date default null,
  p_expires_at date default null,
  p_invoice_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_organization_id uuid;
  v_lot_id uuid;
begin
  v_organization_id := private.current_organization_id();
  if v_organization_id is null then
    raise exception 'Usuário sem organização vinculada';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A quantidade deve ser maior que zero';
  end if;
  if not exists (select 1 from public.materials where id = p_material_id and organization_id = v_organization_id) then
    raise exception 'Material não encontrado na organização';
  end if;

  insert into public.material_lots (organization_id, material_id, lot_number, received_quantity, available_quantity, entry_date, manufactured_at, expires_at, invoice_number, notes)
  values (v_organization_id, p_material_id, trim(p_lot_number), p_quantity, p_quantity, coalesce(p_entry_date, current_date), p_manufactured_at, p_expires_at, nullif(trim(p_invoice_number), ''), nullif(trim(p_notes), ''))
  returning id into v_lot_id;

  insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
  values (v_organization_id, p_material_id, v_lot_id, 'entry', p_quantity, (select auth.uid()), nullif(trim(p_notes), ''));
  return v_lot_id;
end;
$$;

revoke all on function public.register_stock_entry(uuid, text, integer, date, date, date, text, text) from public;
grant execute on function public.register_stock_entry(uuid, text, integer, date, date, date, text, text) to authenticated;
