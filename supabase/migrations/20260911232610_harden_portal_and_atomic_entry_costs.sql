-- Keep the internal cleanup queue inaccessible through the Data API, including
-- authenticated clients. The service role and the guarded claim function are
-- the only supported access paths.
drop policy if exists "cleanup queue is not client accessible" on public.employee_request_attachment_cleanup;
create policy "cleanup queue is not client accessible"
on public.employee_request_attachment_cleanup
for all to authenticated
using (false)
with check (false);

-- Retire portal function versions superseded by the current v3 contract. The
-- active portal functions remain explicitly granted to anon below.
revoke all on function public.get_employee_portal(text, text) from public, anon, authenticated;
revoke all on function public.get_employee_portal_data(text, text) from public, anon, authenticated;
revoke all on function public.get_employee_portal_data_v2(text, text) from public, anon, authenticated;
revoke all on function public.submit_employee_portal_course(text, text, text, text, date, date, text) from public, anon, authenticated;

-- Course uploads must use the server-generated UUID filename. This prevents
-- arbitrary object paths from being inserted into the public upload surface.
drop policy if exists "portal users can upload course documents" on storage.objects;
create policy "portal users can upload course documents"
on storage.objects
for insert to anon
with check (
  bucket_id = 'employee-course-documents'
  and name ~ '^portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$'
);

-- Ensure the certificate RPC cannot attach a path outside the upload prefix.
create or replace function public.submit_employee_portal_course(
  p_registration text, p_cpf text, p_name text, p_provider text,
  p_completed_at date, p_expires_at date, p_certificate_number text,
  p_certificate_file_path text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_employee public.employees; v_id uuid; v_path text := nullif(trim(p_certificate_file_path), '');
begin
  select * into v_employee from public.employees
  where registration = trim(p_registration)
    and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Informe o nome do curso'; end if;
  if v_path is not null and v_path !~ '^portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$' then
    raise exception 'Anexo de certificado inválido';
  end if;
  insert into public.employee_courses (
    employee_id, organization_id, name, provider, completed_at, expires_at,
    certificate_number, certificate_file_path
  ) values (
    v_employee.id, v_employee.organization_id, trim(p_name),
    nullif(trim(p_provider), ''), p_completed_at, p_expires_at,
    nullif(trim(p_certificate_number), ''), v_path
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text) from public, authenticated;
grant execute on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text) to anon;

-- Keep entry cost and lot creation in the same transaction as the invoice.
create or replace function public.register_stock_entry_batch(
  p_invoice_number text, p_entry_date date, p_items jsonb,
  p_invoice_file_path text default null, p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id(); v_invoice uuid; v_item jsonb; v_lot uuid;
  v_material uuid; v_quantity int; v_unit_cost numeric(12,2);
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
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantidade inválida para um dos itens'; end if;
    if v_unit_cost < 0 then raise exception 'Custo unitário inválido para um dos itens'; end if;
    if not exists (select 1 from public.materials where id = v_material and organization_id = v_org) then raise exception 'Material não encontrado na organização'; end if;
    insert into public.material_lots (
      organization_id, material_id, lot_number, received_quantity, available_quantity,
      entry_date, manufactured_at, expires_at, invoice_number, invoice_file_path,
      invoice_id, unit_cost, notes
    ) values (
      v_org, v_material, trim(v_item->>'lot_number'), v_quantity, v_quantity,
      coalesce(p_entry_date, current_date), nullif(v_item->>'manufactured_at', '')::date,
      nullif(v_item->>'expires_at', '')::date, v_invoice_number,
      nullif(trim(p_invoice_file_path), ''), v_invoice, v_unit_cost,
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

-- Cover the hottest joins used by stock, delivery, return and compliance screens.
create index if not exists delivery_items_org_material_idx on public.delivery_items(organization_id, material_id);
create index if not exists delivery_items_org_lot_idx on public.delivery_items(organization_id, lot_id);
create index if not exists material_lots_org_invoice_idx on public.material_lots(organization_id, invoice_id);
create index if not exists stock_movements_org_material_created_idx on public.stock_movements(organization_id, material_id, created_at desc);
create index if not exists contract_requirements_org_material_idx on public.contract_requirements(organization_id, material_id);
drop index if exists public.returns_items_delivery_item_idx;
