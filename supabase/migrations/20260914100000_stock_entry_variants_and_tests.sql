-- Controle de variações e datas dos ensaios na entrada de estoque.
alter table public.material_lots
  add column if not exists test_performed_at date,
  add column if not exists test_expires_at date;

alter table public.material_lots
  drop constraint if exists material_lots_test_dates_check;

alter table public.material_lots
  add constraint material_lots_test_dates_check
  check (test_performed_at is null or test_expires_at is null or test_expires_at >= test_performed_at);

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
  v_material_row public.materials;
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
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_quantity := (v_item->>'quantity')::int;
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    v_test_performed_at := nullif(v_item->>'test_performed_at', '')::date;
    v_test_expires_at := nullif(v_item->>'test_expires_at', '')::date;

    select * into v_material_row from public.materials
    where id = v_material and organization_id = v_org and status = 'active';
    if v_material_row.id is null then raise exception 'Material não encontrado na organização'; end if;
    if v_variant is not null and not exists (
      select 1 from public.material_variants
      where id = v_variant and material_id = v_material and organization_id = v_org and active
    ) then raise exception 'A variação selecionada não pertence ao material ou está inativa'; end if;
    if v_material_row.test_required and (v_test_performed_at is null or v_test_expires_at is null) then
      raise exception 'Informe a data do ensaio e a validade do ensaio para o material (%)', v_material_row.name;
    end if;
    if v_test_expires_at is not null and v_test_performed_at is not null and v_test_expires_at < v_test_performed_at then
      raise exception 'A validade do ensaio não pode ser anterior à data do ensaio';
    end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantidade inválida para um dos itens'; end if;
    if v_unit_cost < 0 then raise exception 'Custo unitário inválido para um dos itens'; end if;

    insert into public.material_lots (
      organization_id, material_id, variant_id, lot_number, received_quantity, available_quantity,
      entry_date, manufactured_at, expires_at, test_performed_at, test_expires_at,
      invoice_number, invoice_file_path, invoice_id, unit_cost, notes
    ) values (
      v_org, v_material, v_variant, trim(v_item->>'lot_number'), v_quantity, v_quantity,
      coalesce(p_entry_date, current_date), nullif(v_item->>'manufactured_at', '')::date,
      nullif(v_item->>'expires_at', '')::date, v_test_performed_at, v_test_expires_at,
      v_invoice_number, nullif(trim(p_invoice_file_path), ''), v_invoice, v_unit_cost,
      nullif(trim(coalesce(v_item->>'notes', p_notes)), '')
    ) returning id into v_lot;

    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
    values (v_org, v_material, v_lot, 'entry', v_quantity, auth.uid(), nullif(trim(p_notes), ''));
  end loop;
  return v_invoice;
end;
$$;

revoke all on function public.register_stock_entry_batch(text, date, jsonb, text, text) from public;
grant execute on function public.register_stock_entry_batch(text, date, jsonb, text, text) to authenticated;

insert into public.material_variants (organization_id, material_id, name, size, active)
select m.organization_id, m.id, sizes.size, sizes.size, true
from public.materials m
cross join unnest(array['P', 'M', 'G', 'GG', 'XGG']) as sizes(size)
where lower(m.name) = 'conjunto anti-chamas'
on conflict (organization_id, material_id, name) do update set size = excluded.size, active = true;

update public.materials
set test_required = true, test_type = 'operational', test_interval_months = 12
where lower(name) = 'conjunto anti-chamas';
