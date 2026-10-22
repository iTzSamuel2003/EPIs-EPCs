create table public.return_deduction_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_id uuid not null references public.returns(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  approved_amount numeric(12,2) check (approved_amount is null or approved_amount > 0),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'signed')),
  review_notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  signer_name text,
  signer_cpf text check (signer_cpf is null or signer_cpf ~ '^[0-9]{11}$'),
  signed_at timestamptz,
  signed_term_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, return_id),
  check ((status in ('approved', 'signed')) = (approved_amount is not null)),
  check ((status = 'signed') = (signed_at is not null and signed_term_path is not null))
);

create index return_deduction_cases_queue_idx
  on public.return_deduction_cases (organization_id, status, created_at desc);
create index return_deduction_cases_employee_idx
  on public.return_deduction_cases (organization_id, employee_id, created_at desc);

alter table public.return_deduction_cases enable row level security;
create policy "RH can view organization deduction cases"
  on public.return_deduction_cases for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.current_user_can_access_page('/discounts')
  );

revoke all on public.return_deduction_cases from public, anon, authenticated;
grant select on public.return_deduction_cases to authenticated;
grant all on public.return_deduction_cases to service_role;

create or replace function private.create_return_deduction_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deduction_requested then
    insert into public.return_deduction_cases as existing (
      organization_id, return_id, employee_id
    ) values (
      new.organization_id, new.return_id, new.employee_id
    )
    on conflict (organization_id, return_id) do update
      set employee_id = excluded.employee_id,
          updated_at = clock_timestamp()
      where existing.status = 'pending_review';
  end if;
  return new;
end;
$$;
revoke all on function private.create_return_deduction_case() from public, anon, authenticated;

insert into public.return_deduction_cases (
  organization_id, return_id, employee_id
)
select flagged.organization_id, flagged.return_id, flagged.employee_id
from (
  select ri.organization_id, ri.return_id, r.employee_id
  from public.return_items ri
  join public.returns r on r.id = ri.return_id and r.organization_id = ri.organization_id
  where ri.deduction_requested
  union
  select ra.organization_id, ra.return_id, r.employee_id
  from public.return_accountability ra
  join public.returns r on r.id = ra.return_id and r.organization_id = ra.organization_id
  where ra.deduction_requested
) flagged
on conflict (organization_id, return_id) do nothing;

create or replace function private.sync_return_item_deduction_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid;
  v_has_deduction boolean;
begin
  select r.employee_id into v_employee
  from public.returns r
  where r.id = new.return_id and r.organization_id = new.organization_id;
  if v_employee is null then return new; end if;

  select exists (
    select 1 from public.return_items ri
    where ri.organization_id = new.organization_id and ri.return_id = new.return_id
      and ri.deduction_requested
  ) into v_has_deduction;

  if v_has_deduction then
    insert into public.return_deduction_cases as existing (
      organization_id, return_id, employee_id
    ) values (new.organization_id, new.return_id, v_employee)
    on conflict (organization_id, return_id) do update
      set employee_id = excluded.employee_id, updated_at = clock_timestamp()
      where existing.status = 'pending_review';
  else
    delete from public.return_deduction_cases
    where organization_id = new.organization_id and return_id = new.return_id and status = 'pending_review';
  end if;
  return new;
end;
$$;
revoke all on function private.sync_return_item_deduction_case() from public, anon, authenticated;

-- Return occurrences no longer require an estimated amount at registration.
create or replace function public.register_return(
  p_employee_id uuid,
  p_reason text,
  p_returned_at date,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_org uuid := private.current_organization_id();
  v_return uuid;
  v_item jsonb;
  v_delivery_item uuid;
  v_requested int;
  v_delivered int;
  v_returned int;
  v_return_item_id uuid;
  v_material uuid;
  v_lot uuid;
  v_condition text;
  v_destination text;
  v_incident text;
  v_description text;
  v_deduction boolean;
  v_movement public.movement_type;
begin
  if v_org is null then raise exception 'Usuario sem organizacao vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org) then raise exception 'Funcionario nao encontrado'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um equipamento'; end if;

  insert into public.returns (organization_id, employee_id, returned_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_returned_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_return;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_delivery_item := nullif(v_item->>'delivery_item_id', '')::uuid;
    v_requested := nullif(v_item->>'quantity', '')::int;
    v_condition := coalesce(nullif(v_item->>'equipment_condition', ''), 'good');
    v_destination := coalesce(nullif(v_item->>'destination', ''), 'stock');
    v_incident := coalesce(nullif(v_item->>'incident_type', ''), 'normal');
    v_description := nullif(trim(v_item->>'incident_description'), '');
    v_deduction := coalesce((v_item->>'deduction_requested')::boolean, false);

    if v_condition not in ('good', 'used', 'damaged', 'unusable') then raise exception 'Condicao do equipamento invalida'; end if;
    if v_destination not in ('stock', 'disposal', 'maintenance', 'not_returned') then raise exception 'Destino do equipamento invalido'; end if;
    if v_incident not in ('normal', 'misuse', 'loss', 'theft', 'damage', 'other') then raise exception 'Ocorrencia do equipamento invalida'; end if;
    if v_destination = 'stock' and (v_incident <> 'normal' or v_condition in ('damaged', 'unusable')) then raise exception 'Material com ocorrencia ou danificado nao pode retornar ao estoque disponivel'; end if;
    if v_destination = 'not_returned' and v_incident not in ('loss', 'theft') then raise exception 'Somente material extraviado ou furtado pode ficar marcado como nao devolvido'; end if;

    select di.material_id, di.lot_id, di.quantity into v_material, v_lot, v_delivered
    from public.delivery_items di
    join public.deliveries d on d.id = di.delivery_id
    where di.id = v_delivery_item and di.organization_id = v_org and d.employee_id = p_employee_id
    for update of di;
    if v_material is null then raise exception 'Equipamento entregue nao encontrado'; end if;

    select coalesce(sum(quantity), 0) into v_returned
    from public.return_items where delivery_item_id = v_delivery_item;
    if v_requested is null or v_requested <= 0 or v_requested > v_delivered - v_returned then raise exception 'Quantidade devolvida invalida'; end if;

    if v_destination = 'stock' then
      update public.material_lots set available_quantity = available_quantity + v_requested where id = v_lot and organization_id = v_org;
      v_movement := 'return';
    elsif v_destination = 'disposal' then
      v_movement := 'discard';
    else
      v_movement := 'adjustment';
    end if;

    insert into public.return_items (
      organization_id, return_id, delivery_item_id, material_id, lot_id, quantity,
      equipment_condition, destination, incident_type, incident_description,
      deduction_requested, deduction_amount
    ) values (
      v_org, v_return, v_delivery_item, v_material, v_lot, v_requested,
      v_condition, v_destination, v_incident, v_description, v_deduction, null
    ) returning id into v_return_item_id;

    if v_destination = 'not_returned' then
      update public.material_units
      set pending_return_item_id = v_return_item_id
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item and employee_id = p_employee_id
          and status = 'assigned' and pending_return_item_id is null
        order by created_at limit v_requested
      );
    elsif v_destination = 'disposal' and v_deduction then
      update public.material_units
      set status = 'quarantine', employee_id = null, delivered_at = null,
          location = 'Aguardando assinatura para baixa',
          pending_return_item_id = v_return_item_id,
          notes = concat_ws(' · ', nullif(notes, ''), 'Baixa de descarte aguardando assinatura do termo')
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item and employee_id = p_employee_id and status = 'assigned'
          and pending_return_item_id is null order by created_at limit v_requested
      );
    else
      update public.material_units
      set status = case when v_destination = 'stock' then 'available' when v_destination = 'maintenance' then 'maintenance' else 'discarded' end,
          employee_id = null,
          delivered_at = null,
          location = case when v_destination = 'stock' then 'Estoque' else initcap(v_destination) end,
          pending_return_item_id = null,
          notes = concat_ws(' · ', nullif(notes, ''), case when v_incident <> 'normal' then 'Ocorrência: ' || v_incident else null end)
      where id in (
        select id from public.material_units
        where organization_id = v_org and delivery_item_id = v_delivery_item and employee_id = p_employee_id and status = 'assigned'
        order by created_at limit v_requested
      );
      if not (v_destination = 'disposal' and v_deduction) then
        insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes)
        values (v_org, v_material, v_lot, v_movement, v_requested, auth.uid(), 'Return ' || v_return::text || ' · destination: ' || v_destination);
      end if;
    end if;
  end loop;
  return v_return;
end;
$$;
revoke all on function public.register_return(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;

create trigger return_items_sync_deduction_case
after insert or update on public.return_items
for each row execute function private.sync_return_item_deduction_case();

create trigger return_accountability_create_deduction_case
after insert or update
on public.return_accountability
for each row execute function private.create_return_deduction_case();

create or replace function public.review_return_deduction_case(
  p_case_id uuid,
  p_decision text,
  p_approved_amount numeric default null,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid := private.current_organization_id();
  v_case public.return_deduction_cases;
begin
  if v_user is null or v_org is null then raise exception 'Sessão inválida'; end if;
  if not private.current_user_can_access_page('/discounts') then
    raise exception 'Seu perfil não tem acesso à página de descontos';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'Decisão inválida'; end if;
  if p_review_notes is not null and length(trim(p_review_notes)) > 2000 then raise exception 'Observação muito longa'; end if;
  if p_decision = 'approved' and (p_approved_amount is null or p_approved_amount <= 0) then
    raise exception 'Informe um valor aprovado maior que zero';
  end if;
  if nullif(trim(p_review_notes), '') is null then raise exception 'Informe a justificativa da análise'; end if;

  select * into v_case from public.return_deduction_cases
  where id = p_case_id and organization_id = v_org for update;
  if not found then raise exception 'Caso de desconto não encontrado'; end if;
  if v_case.status <> 'pending_review' then raise exception 'Este caso já foi analisado'; end if;

  update public.return_deduction_cases
  set status = p_decision,
      approved_amount = case when p_decision = 'approved' then p_approved_amount else null end,
      review_notes = nullif(trim(p_review_notes), ''),
      reviewed_by = v_user,
      reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_case.id;

  update public.return_accountability
  set deduction_approval_status = p_decision,
      deduction_reviewed_by = v_user,
      deduction_reviewed_at = clock_timestamp()
  where organization_id = v_org and return_id = v_case.return_id;

  update public.return_items
  set deduction_approval_status = p_decision,
      deduction_reviewed_by = v_user,
      deduction_reviewed_at = clock_timestamp()
  where organization_id = v_org and return_id = v_case.return_id and deduction_requested;

  return v_case.id;
end;
$$;
revoke all on function public.review_return_deduction_case(uuid, text, numeric, text) from public, anon;
grant execute on function public.review_return_deduction_case(uuid, text, numeric, text) to authenticated;

alter table public.term_signature_links
  add column deduction_case_id uuid references public.return_deduction_cases(id) on delete cascade;

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
  check (num_nonnulls(delivery_id, return_id, pending_delivery_id, deduction_case_id) = 1);

create index term_signature_links_deduction_case_idx
  on public.term_signature_links (organization_id, deduction_case_id, created_at desc)
  where deduction_case_id is not null;

create or replace function public.complete_employee_deduction_signature(
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
  v_case public.return_deduction_cases;
  v_signed_at timestamptz := clock_timestamp();
begin
  select * into v_link from public.term_signature_links where id = p_link_id for update;
  if v_link.id is null or v_link.deduction_case_id is null
    or v_link.expires_at <= v_signed_at or v_link.used_at is not null or v_link.revoked_at is not null
    or (v_link.locked_until is not null and v_link.locked_until > v_signed_at) then
    raise exception 'Link de assinatura inválido, expirado ou já utilizado';
  end if;
  if nullif(trim(p_signer_name), '') is null or length(trim(p_signer_name)) > 160
    or p_signer_cpf is null or p_signer_cpf !~ '^[0-9]{11}$' or p_signature_file_path is null then
    raise exception 'Dados da assinatura inválidos';
  end if;
  if p_signature_file_path not like v_link.organization_id::text || '/' ||
      v_link.deduction_case_id::text || '/whatsapp-signature-' || v_link.id::text || '-%' then
    raise exception 'Arquivo de assinatura fora do caminho permitido';
  end if;

  select * into v_case from public.return_deduction_cases
  where id = v_link.deduction_case_id and organization_id = v_link.organization_id
    and employee_id = v_link.employee_id for update;
  if not found or v_case.status <> 'approved' or v_case.signed_at is not null then
    raise exception 'A autorização não está mais pendente de assinatura';
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = v_link.employee_id and e.organization_id = v_link.organization_id
      and regexp_replace(e.cpf, '[^0-9]', '', 'g') = p_signer_cpf
      and lower(regexp_replace(trim(e.full_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(p_signer_name), '\s+', ' ', 'g'))
  ) then raise exception 'Dados do colaborador não correspondem'; end if;

  update public.return_deduction_cases
  set status = 'signed', signer_name = trim(p_signer_name), signer_cpf = p_signer_cpf,
      signed_at = v_signed_at, signed_term_path = p_signature_file_path,
      updated_at = v_signed_at
  where id = v_case.id;

  update public.term_signature_links
  set used_at = v_signed_at, signer_name = trim(p_signer_name), signer_cpf = p_signer_cpf,
      signature_file_path = p_signature_file_path
  where id = v_link.id;

  update public.term_signature_links
  set revoked_at = v_signed_at
  where organization_id = v_link.organization_id and deduction_case_id = v_link.deduction_case_id
    and id <> v_link.id and used_at is null and revoked_at is null;

  return v_signed_at;
end;
$$;
revoke all on function public.complete_employee_deduction_signature(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_employee_deduction_signature(uuid, text, text, text) to service_role;

update public.organization_role_access
set page_paths = array(select distinct unnest(page_paths || array['/discounts']))
where role::text = 'rh' and not ('/discounts' = any(page_paths));

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
  select profile.role::text into v_role
  from public.profiles profile
  where profile.id = v_user and profile.organization_id = v_organization;
  if not found then return false; end if;
  if v_role = 'admin' then return true; end if;

  select access.page_paths into v_page_paths
  from public.profile_access_overrides access
  where access.profile_id = v_user and access.organization_id = v_organization;
  if v_page_paths is null then
    select access.page_paths into v_page_paths
    from public.organization_role_access access
    where access.organization_id = v_organization and access.role::text = v_role;
  end if;
  if v_page_paths is not null then return p_page = any(v_page_paths); end if;

  return case v_role
    when 'rh' then p_page = any(array['/employees','/deliveries','/returns','/discounts','/requests','/stock','/validities','/reports'])
    when 'tst' then p_page = any(array['/entries','/deliveries','/returns','/stock','/validities','/tests','/ca','/reports'])
    else false
  end;
end;
$$;
revoke all on function private.current_user_can_access_page(text) from public, anon;
grant execute on function private.current_user_can_access_page(text) to authenticated, service_role;

drop trigger if exists return_deduction_cases_audit on public.return_deduction_cases;
create trigger return_deduction_cases_audit
after insert or update or delete on public.return_deduction_cases
for each row execute function public.audit_row_change();
