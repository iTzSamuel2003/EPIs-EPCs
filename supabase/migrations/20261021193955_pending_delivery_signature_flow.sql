create table public.pending_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  requested_by uuid not null references auth.users(id),
  delivered_at date not null,
  reason text not null check (reason in ('admission','periodic_change','damaged','lost','role_change','replacement','other')),
  notes text,
  request_items jsonb not null check (jsonb_typeof(request_items) = 'array' and jsonb_array_length(request_items) > 0),
  lot_plan jsonb not null check (jsonb_typeof(lot_plan) = 'array' and jsonb_array_length(lot_plan) > 0),
  snapshot jsonb,
  status text not null default 'pending_signature' check (status in ('pending_signature','completed','cancelled')),
  completed_delivery_id uuid references public.deliveries(id),
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pending_deliveries_org_status_idx
  on public.pending_deliveries (organization_id, status, created_at desc);

alter table public.pending_deliveries enable row level security;
create policy "organization members can view pending deliveries"
  on public.pending_deliveries for select to authenticated
  using (organization_id = private.current_organization_id());
revoke all on public.pending_deliveries from public, anon, authenticated;
grant select on public.pending_deliveries to authenticated;
grant select, insert, update on public.pending_deliveries to service_role;

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
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org and status <> 'terminated') then raise exception 'Funcionário não encontrado ou desligado'; end if;
  if p_reason not in ('admission','periodic_change','damaged','lost','role_change','replacement','other') then raise exception 'Motivo de entrega inválido'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as requests(value)
    group by requests.value->>'material_id', nullif(requests.value->>'variant_id', '')
    having count(*) > 1
  ) then raise exception 'Cada material e variação deve aparecer uma única vez na ficha'; end if;

  for v_item in select requests.value from jsonb_array_elements(p_items) as requests(value) loop
    v_item_index := v_item_index + 1;
    v_material := nullif(v_item->>'material_id', '')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_requested := (v_item->>'quantity')::integer;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if not found then raise exception 'Material não encontrado ou inativo'; end if;
    if v_requested is null or v_requested <= 0 then raise exception 'Quantidade inválida para o material'; end if;
    if lower(v_material_row.name) like '%bota de borracha%' and v_variant is null then raise exception 'Informe a numeração da bota de borracha'; end if;
    if exists (select 1 from public.material_variants where material_id = v_material and organization_id = v_org and active) and (v_variant is null or not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active)) then
      raise exception 'Selecione a variação do material';
    end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then raise exception 'A variação selecionada não pertence ao material ou está inativa'; end if;

    select coalesce(sum(lot.available_quantity), 0) into v_eligible_quantity
    from public.material_lots lot
    where lot.organization_id = v_org and lot.material_id = v_material
      and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null))
      and lot.available_quantity > 0
      and (lot.expires_at is null or lot.expires_at >= v_date)
      and (not v_material_row.ca_required or (
        nullif(trim(lot.ca_number), '') is not null
        and upper(trim(lot.ca_number)) not in ('PENDENTE', 'N/A')
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) is not null
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) >= v_date
        and not exists (select 1 from public.ca_certificates certificate where certificate.ca_number = lot.ca_number and (certificate.status ilike '%cancel%' or certificate.status ilike '%suspens%' or certificate.status ilike '%revog%' or certificate.status ilike '%inativ%' or certificate.status ilike '%inval%' or certificate.status ilike '%vencid%' or certificate.status ilike '%expir%'))
      ))
      and (not v_material_row.test_required or (
        lot.test_performed_at is not null and lot.test_performed_at <= v_date
        and lot.test_expires_at is not null and lot.test_expires_at >= v_date
        and (not v_material_row.report_required or nullif(trim(lot.test_report_number), '') is not null)
      ));
    if v_eligible_quantity < v_requested then raise exception 'Estoque insuficiente em lotes elegíveis para o material (%)', v_material_row.name; end if;

    v_remaining := v_requested;
    for v_lot in
      select lot.id, lot.available_quantity
      from public.material_lots lot
      where lot.organization_id = v_org and lot.material_id = v_material
        and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null))
        and lot.available_quantity > 0
        and (lot.expires_at is null or lot.expires_at >= v_date)
        and (not v_material_row.ca_required or (
          nullif(trim(lot.ca_number), '') is not null and upper(trim(lot.ca_number)) not in ('PENDENTE', 'N/A')
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
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'item_index', v_item_index, 'material_id', v_material, 'variant_id', v_variant,
        'lot_id', v_lot.id, 'quantity', v_take
      ));
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

drop function public.register_delivery(uuid, text, date, jsonb, text);
create function public.register_delivery(
  p_employee_id uuid, p_reason text, p_delivered_at date, p_items jsonb, p_notes text default null,
  p_lot_plan jsonb default null
)
returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_delivery uuid;
  v_delivery_item uuid;
  v_item jsonb;
  v_item_index integer := 0;
  v_material uuid;
  v_variant uuid;
  v_requested int;
  v_remaining int;
  v_take int;
  v_eligible_quantity bigint;
  v_planned_quantity bigint;
  v_delivery_date date := coalesce(p_delivered_at, current_date);
  v_lot record;
  v_material_row record;
  v_variant_size text;
  unit_number int;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org and status <> 'terminated') then raise exception 'Funcionário não encontrado ou desligado'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;
  if p_lot_plan is not null and jsonb_typeof(p_lot_plan) <> 'array' then raise exception 'Plano de lotes inválido'; end if;

  for v_item in select requests.value from jsonb_array_elements(p_items) as requests(value) loop
    v_item_index := v_item_index + 1;
    v_material := (v_item->>'material_id')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_requested := (v_item->>'quantity')::int;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org and status = 'active';
    if not found then raise exception 'Material não encontrado ou inativo'; end if;
    if v_requested is null or v_requested <= 0 then raise exception 'Quantidade inválida para o material'; end if;
    if lower(v_material_row.name) like '%bota de borracha%' and v_variant is null then raise exception 'Informe a numeração da bota de borracha'; end if;
    if exists (select 1 from public.material_variants where material_id = v_material and organization_id = v_org and active) and (v_variant is null or not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active)) then raise exception 'Selecione a variação do material'; end if;
    if v_variant is not null and not exists (select 1 from public.material_variants where id = v_variant and material_id = v_material and organization_id = v_org and active) then raise exception 'A variação selecionada não pertence ao material ou está inativa'; end if;

    select coalesce(sum(lot.available_quantity), 0) into v_eligible_quantity
    from public.material_lots lot
    where lot.organization_id = v_org and lot.material_id = v_material
      and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null)) and lot.available_quantity > 0
      and (lot.expires_at is null or lot.expires_at >= v_delivery_date)
      and (not v_material_row.ca_required or (
        nullif(trim(lot.ca_number), '') is not null and upper(trim(lot.ca_number)) not in ('PENDENTE', 'N/A')
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) is not null
        and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) >= v_delivery_date
        and not exists (select 1 from public.ca_certificates certificate where certificate.ca_number = lot.ca_number and (certificate.status ilike '%cancel%' or certificate.status ilike '%suspens%' or certificate.status ilike '%revog%' or certificate.status ilike '%inativ%' or certificate.status ilike '%inval%' or certificate.status ilike '%vencid%' or certificate.status ilike '%expir%'))
      ))
      and (not v_material_row.test_required or (
        lot.test_performed_at is not null and lot.test_performed_at <= v_delivery_date and lot.test_expires_at is not null
        and lot.test_expires_at >= v_delivery_date and (not v_material_row.report_required or nullif(trim(lot.test_report_number), '') is not null)
      ));
    if v_eligible_quantity < v_requested then
      if v_material_row.ca_required then raise exception 'Estoque insuficiente em lotes com CA válido para o material (%)', v_material_row.name; end if;
      if v_material_row.test_required then raise exception 'Estoque insuficiente em lotes com ensaio válido para o material (%)', v_material_row.name; end if;
      raise exception 'Estoque insuficiente para o material (%)', v_material_row.name;
    end if;
    if p_lot_plan is not null then
      select coalesce(sum((allocation.value->>'quantity')::integer), 0) into v_planned_quantity
      from jsonb_array_elements(p_lot_plan) as allocation(value)
      where (allocation.value->>'item_index')::integer = v_item_index
        and (allocation.value->>'material_id')::uuid = v_material
        and nullif(allocation.value->>'variant_id', '')::uuid is not distinct from v_variant;
      if v_planned_quantity <> v_requested then raise exception 'A alocação de lotes desta ficha não corresponde às quantidades assinadas'; end if;
      if exists (
        select 1 from jsonb_array_elements(p_lot_plan) as allocation(value)
        where (allocation.value->>'item_index')::integer = v_item_index
          and ((allocation.value->>'material_id')::uuid is distinct from v_material
            or nullif(allocation.value->>'variant_id', '')::uuid is distinct from v_variant
            or coalesce((allocation.value->>'quantity')::integer, 0) <= 0)
      ) then raise exception 'A alocação de lotes desta ficha está inválida'; end if;
    end if;
  end loop;

  insert into public.deliveries (organization_id, employee_id, delivered_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, v_delivery_date, p_reason, auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_delivery;

  v_item_index := 0;
  for v_item in select requests.value from jsonb_array_elements(p_items) as requests(value) loop
    v_item_index := v_item_index + 1;
    v_material := (v_item->>'material_id')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_requested := (v_item->>'quantity')::int;
    v_remaining := v_requested;
    select * into v_material_row from public.materials where id = v_material and organization_id = v_org;
    select coalesce(size, name) into v_variant_size from public.material_variants where id = v_variant and organization_id = v_org;
    for v_lot in
      select lot.id, lot.lot_number, lot.available_quantity, lot.variant_id, lot.manufactured_at,
        lot.test_performed_at, lot.test_expires_at, lot.test_report_number, lot.test_number,
        lot.ca_number, lot.ca_expires_at,
        (allocation.value->>'quantity')::integer as planned_quantity
      from public.material_lots lot
      left join lateral (
        select allocation.value from jsonb_array_elements(coalesce(p_lot_plan, '[]'::jsonb)) as allocation(value)
        where (allocation.value->>'item_index')::integer = v_item_index
          and (allocation.value->>'lot_id')::uuid = lot.id
          and (allocation.value->>'material_id')::uuid = v_material
          and nullif(allocation.value->>'variant_id', '')::uuid is not distinct from v_variant
      ) allocation on true
      where lot.organization_id = v_org and lot.material_id = v_material
        and (lot.variant_id = v_variant or (lot.variant_id is null and v_variant is null))
        and lot.available_quantity > 0
        and (p_lot_plan is null or allocation.value is not null)
        and (lot.expires_at is null or lot.expires_at >= v_delivery_date)
        and (not v_material_row.ca_required or (
          nullif(trim(lot.ca_number), '') is not null and upper(trim(lot.ca_number)) not in ('PENDENTE', 'N/A')
          and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) is not null
          and coalesce((select certificate.valid_until from public.ca_certificates certificate where certificate.ca_number = lot.ca_number), lot.ca_expires_at) >= v_delivery_date
          and not exists (select 1 from public.ca_certificates certificate where certificate.ca_number = lot.ca_number and (certificate.status ilike '%cancel%' or certificate.status ilike '%suspens%' or certificate.status ilike '%revog%' or certificate.status ilike '%inativ%' or certificate.status ilike '%inval%' or certificate.status ilike '%vencid%' or certificate.status ilike '%expir%'))
        ))
        and (not v_material_row.test_required or (
          lot.test_performed_at is not null and lot.test_performed_at <= v_delivery_date and lot.test_expires_at is not null
          and lot.test_expires_at >= v_delivery_date and (not v_material_row.report_required or nullif(trim(lot.test_report_number), '') is not null)
        ))
      order by lot.expires_at asc nulls last, lot.entry_date asc, lot.created_at asc
      for update of lot
    loop
      exit when v_remaining = 0;
      v_take := case when p_lot_plan is null then least(v_remaining, v_lot.available_quantity) else v_lot.planned_quantity end;
      if v_take is null or v_take <= 0 or v_take > v_lot.available_quantity or v_take > v_remaining then raise exception 'Um dos lotes desta ficha não possui mais saldo suficiente. Gere uma nova ficha para assinatura.'; end if;
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
    if v_remaining > 0 then raise exception 'Estoque insuficiente para a variação selecionada ou o plano de lotes expirou'; end if;
  end loop;
  return v_delivery;
end;
$$;

revoke all on function public.register_delivery(uuid, text, date, jsonb, text, jsonb) from public, anon;
grant execute on function public.register_delivery(uuid, text, date, jsonb, text, jsonb) to authenticated, service_role;
grant execute on function private.current_organization_id() to service_role;

create or replace function private.finalize_pending_delivery(
  p_pending_id uuid,
  p_signature_file_path text,
  p_signature_method text,
  p_signer_name text,
  p_signer_cpf text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending public.pending_deliveries;
  v_delivery uuid;
  v_signed_at timestamptz := clock_timestamp();
  v_claim_role text := current_setting('request.jwt.claim.role', true);
begin
  if p_signature_method not in ('whatsapp_link', 'physical_upload') then raise exception 'Forma de assinatura inválida'; end if;
  if p_signature_method = 'whatsapp_link' and v_claim_role <> 'service_role' then raise exception 'Assinatura digital não autorizada'; end if;
  if p_signature_method = 'physical_upload' and auth.uid() is null then raise exception 'Entre novamente para confirmar a ficha física'; end if;
  if nullif(trim(p_signature_file_path), '') is null or nullif(trim(p_signer_name), '') is null or p_signer_cpf is null or p_signer_cpf !~ '^[0-9]{11}$' then raise exception 'Dados da assinatura inválidos'; end if;

  select * into v_pending from public.pending_deliveries where id = p_pending_id for update;
  if not found or v_pending.status <> 'pending_signature' then raise exception 'Esta ficha não está mais pendente de assinatura'; end if;
  if p_signature_method = 'physical_upload' and (auth.uid() <> v_pending.requested_by or private.current_organization_id() is distinct from v_pending.organization_id) then raise exception 'Somente o responsável que criou a ficha pode confirmar a assinatura física'; end if;
  if p_signature_method = 'whatsapp_link' and v_pending.requested_by is null then raise exception 'Responsável da ficha inválido'; end if;
  if p_signature_method = 'physical_upload'
    and p_signature_file_path not like v_pending.organization_id::text || '/' || v_pending.id::text || '/physical-%' then
    raise exception 'Arquivo de assinatura fora do caminho permitido';
  end if;
  if p_signature_method = 'whatsapp_link'
    and p_signature_file_path not like v_pending.organization_id::text || '/' || v_pending.id::text || '/whatsapp-signature-%' then
    raise exception 'Arquivo de assinatura fora do caminho permitido';
  end if;

  perform set_config('request.jwt.claim.sub', v_pending.requested_by::text, true);
  v_delivery := public.register_delivery(
    v_pending.employee_id, v_pending.reason, v_pending.delivered_at,
    v_pending.request_items, v_pending.notes, v_pending.lot_plan
  );
  update public.deliveries
  set term_file_path = p_signature_file_path,
      term_uploaded_at = v_signed_at,
      term_uploaded_by = case when p_signature_method = 'physical_upload' then v_pending.requested_by else null end,
      term_signature_method = p_signature_method,
      term_signed_at = v_signed_at,
      term_signer_name = trim(p_signer_name),
      term_signer_cpf = p_signer_cpf
  where id = v_delivery and organization_id = v_pending.organization_id;
  update public.pending_deliveries
  set status = 'completed', completed_delivery_id = v_delivery, signed_at = v_signed_at
  where id = v_pending.id;
  return v_delivery;
end;
$$;

revoke all on function private.finalize_pending_delivery(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function private.finalize_pending_delivery(uuid, text, text, text, text) to service_role;

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
  v_pending public.pending_deliveries;
  v_employee public.employees;
  v_delivery uuid;
  v_cpf text;
begin
  if auth.uid() is null then raise exception 'Entre novamente para confirmar a ficha física'; end if;
  select * into v_pending from public.pending_deliveries where id = p_pending_delivery_id for update;
  if not found or v_pending.status <> 'pending_signature' then raise exception 'Esta ficha não está mais pendente'; end if;
  if v_pending.requested_by <> auth.uid() or private.current_organization_id() is distinct from v_pending.organization_id then raise exception 'Somente quem criou a ficha pode confirmá-la'; end if;
  if p_signature_file_path not like v_pending.organization_id::text || '/' || v_pending.id::text || '/physical-%' then raise exception 'Arquivo de assinatura fora do caminho permitido'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'delivery-terms' and name = p_signature_file_path) then raise exception 'O arquivo assinado não foi encontrado'; end if;
  select * into v_employee from public.employees where id = v_pending.employee_id and organization_id = v_pending.organization_id;
  if not found then raise exception 'Funcionário da ficha não encontrado'; end if;
  v_cpf := regexp_replace(v_employee.cpf, '[^0-9]', '', 'g');
  v_delivery := private.finalize_pending_delivery(v_pending.id, p_signature_file_path, 'physical_upload', v_employee.full_name, v_cpf);
  return v_delivery;
end;
$$;

revoke all on function public.confirm_pending_delivery_physical(uuid, text) from public, anon;
grant execute on function public.confirm_pending_delivery_physical(uuid, text) to authenticated;

create or replace function public.cancel_pending_delivery(p_pending_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending public.pending_deliveries;
begin
  if auth.uid() is null then raise exception 'Entre novamente para cancelar a ficha'; end if;
  select * into v_pending from public.pending_deliveries where id = p_pending_delivery_id for update;
  if not found or v_pending.status <> 'pending_signature' then raise exception 'Esta ficha não está mais pendente'; end if;
  if v_pending.requested_by <> auth.uid() or private.current_organization_id() is distinct from v_pending.organization_id then raise exception 'Somente quem criou a ficha pode cancelá-la'; end if;
  update public.pending_deliveries set status = 'cancelled' where id = v_pending.id;
end;
$$;

revoke all on function public.cancel_pending_delivery(uuid) from public, anon;
grant execute on function public.cancel_pending_delivery(uuid) to authenticated;

alter table public.term_signature_links add column pending_delivery_id uuid references public.pending_deliveries(id) on delete cascade;
do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
    where conrelid = 'public.term_signature_links'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%delivery_id%'
      and pg_get_constraintdef(oid) ilike '%return_id%'
  loop execute format('alter table public.term_signature_links drop constraint %I', v_constraint.conname); end loop;
end;
$$;
alter table public.term_signature_links
  add constraint term_signature_links_one_record_check
  check (num_nonnulls(delivery_id, return_id, pending_delivery_id) = 1);
create index term_signature_links_pending_delivery_idx
  on public.term_signature_links (organization_id, pending_delivery_id, created_at desc)
  where pending_delivery_id is not null;

create or replace function public.complete_employee_term_signature(
  p_link_id uuid,
  p_signature_file_path text,
  p_signer_name text,
  p_signer_cpf text
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link public.term_signature_links;
  v_signed_at timestamptz := clock_timestamp();
  v_record_id uuid;
  v_pending public.pending_deliveries;
  v_delivery_id uuid;
begin
  select * into v_link from public.term_signature_links where id = p_link_id for update;
  if v_link.id is null or v_link.expires_at <= v_signed_at or v_link.used_at is not null or v_link.revoked_at is not null or (v_link.locked_until is not null and v_link.locked_until > v_signed_at) then raise exception 'Link de assinatura inválido, expirado ou já utilizado'; end if;
  if nullif(trim(p_signer_name), '') is null or length(trim(p_signer_name)) > 160 or p_signer_cpf is null or p_signer_cpf !~ '^[0-9]{11}$' or p_signature_file_path is null then raise exception 'Dados da assinatura inválidos'; end if;
  if p_signature_file_path not like v_link.organization_id::text || '/' || coalesce(v_link.pending_delivery_id, v_link.delivery_id, v_link.return_id)::text || '/whatsapp-signature-%' then raise exception 'Arquivo de assinatura fora do caminho permitido'; end if;
  if not exists (
    select 1 from public.employees e where e.id = v_link.employee_id and e.organization_id = v_link.organization_id
      and regexp_replace(e.cpf, '[^0-9]', '', 'g') = p_signer_cpf
      and lower(regexp_replace(trim(e.full_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_signer_name), '\s+', ' ', 'g'))
  ) then raise exception 'Dados do colaborador não correspondem'; end if;

  if v_link.pending_delivery_id is not null then
    select * into v_pending from public.pending_deliveries where id = v_link.pending_delivery_id for update;
    if not found or v_pending.organization_id <> v_link.organization_id or v_pending.employee_id <> v_link.employee_id or v_pending.status <> 'pending_signature' then raise exception 'A ficha não está mais pendente de assinatura'; end if;
    v_delivery_id := private.finalize_pending_delivery(v_pending.id, p_signature_file_path, 'whatsapp_link', trim(p_signer_name), p_signer_cpf);
    v_record_id := v_delivery_id;
  elsif v_link.delivery_id is not null then
    update public.deliveries set term_file_path = p_signature_file_path, term_uploaded_at = v_signed_at, term_uploaded_by = null, term_signature_method = 'whatsapp_link', term_signed_at = v_signed_at, term_signer_name = trim(p_signer_name), term_signer_cpf = p_signer_cpf
    where id = v_link.delivery_id and organization_id = v_link.organization_id and employee_id = v_link.employee_id and term_signed_at is null
    returning id into v_record_id;
  else
    update public.returns set term_file_path = p_signature_file_path, term_uploaded_at = v_signed_at, term_uploaded_by = null, term_signature_method = 'whatsapp_link', term_signed_at = v_signed_at, term_signer_name = trim(p_signer_name), term_signer_cpf = p_signer_cpf
    where id = v_link.return_id and organization_id = v_link.organization_id and employee_id = v_link.employee_id and term_signed_at is null
    returning id into v_record_id;
  end if;
  if v_record_id is null then raise exception 'A ficha já foi assinada ou não está mais disponível'; end if;
  update public.term_signature_links set used_at = v_signed_at, signer_name = trim(p_signer_name), signer_cpf = p_signer_cpf, signature_file_path = p_signature_file_path where id = v_link.id;
  update public.term_signature_links set revoked_at = v_signed_at
  where organization_id = v_link.organization_id and id <> v_link.id and used_at is null and revoked_at is null
    and ((v_link.delivery_id is not null and delivery_id = v_link.delivery_id)
      or (v_link.return_id is not null and return_id = v_link.return_id)
      or (v_link.pending_delivery_id is not null and pending_delivery_id = v_link.pending_delivery_id));
  return v_signed_at;
end;
$$;

revoke all on function public.complete_employee_term_signature(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_employee_term_signature(uuid, text, text, text) to service_role;
