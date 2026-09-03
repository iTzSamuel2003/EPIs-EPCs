-- Ferramental passa a ser um terceiro tipo de cadastro.
alter type public.material_type add value if not exists 'FERRAMENTAL';

-- Apenas EPI exige Certificado de Aprovação (CA).
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_constraint
  where conrelid = 'public.materials'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%type%' and pg_get_constraintdef(oid) like '%ca_number%';
  if constraint_name is not null then execute format('alter table public.materials drop constraint %I', constraint_name); end if;
end $$;

alter table public.materials add constraint materials_epi_ca_check check (type <> 'EPI' or ca_number is not null);

-- Cabeçalho único da nota fiscal. Uma nota pode ter vários lotes/produtos.
create table public.stock_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_number text not null,
  issued_at date,
  supplier_id uuid references public.suppliers(id),
  file_path text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

alter table public.stock_invoices enable row level security;
create policy "organization members can access stock invoices" on public.stock_invoices for all to authenticated
  using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());

alter table public.material_lots add column if not exists invoice_id uuid references public.stock_invoices(id);
create index if not exists stock_invoices_org_date_idx on public.stock_invoices(organization_id, created_at desc);
create index if not exists lots_invoice_idx on public.material_lots(invoice_id);

create or replace function public.register_stock_entry_batch(
  p_invoice_number text, p_entry_date date, p_items jsonb,
  p_invoice_file_path text default null, p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id(); v_invoice uuid; v_item jsonb; v_lot uuid;
  v_material uuid; v_quantity int; v_invoice_number text := nullif(trim(p_invoice_number), '');
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um item'; end if;
  if v_invoice_number is not null then
    insert into public.stock_invoices (organization_id, invoice_number, issued_at, file_path, notes, created_by)
    values (v_org, v_invoice_number, coalesce(p_entry_date, current_date), nullif(trim(p_invoice_file_path), ''), nullif(trim(p_notes), ''), auth.uid()) returning id into v_invoice;
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material := (v_item->>'material_id')::uuid; v_quantity := (v_item->>'quantity')::int;
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
