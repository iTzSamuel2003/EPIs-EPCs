alter table public.employee_portal_requests
  add column if not exists delivery_item_id uuid references public.delivery_items(id),
  add column if not exists requested_quantity integer,
  add column if not exists material_name_snapshot text,
  add column if not exists lot_number_snapshot text,
  add column if not exists attachment_path text,
  add column if not exists attachment_uploaded_at timestamptz,
  add column if not exists review_notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.employee_portal_requests
  drop constraint if exists employee_portal_requests_requested_quantity_check;
alter table public.employee_portal_requests
  add constraint employee_portal_requests_requested_quantity_check
  check (requested_quantity is null or requested_quantity > 0);

create unique index if not exists employee_portal_requests_open_delivery_item_uidx
  on public.employee_portal_requests(delivery_item_id)
  where status in ('pending', 'in_review', 'approved');
create index if not exists employee_portal_requests_org_status_idx
  on public.employee_portal_requests(organization_id, status, created_at desc);

create or replace function private.set_employee_portal_request_updated_at()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employee_portal_requests_set_updated_at on public.employee_portal_requests;
create trigger employee_portal_requests_set_updated_at
before update on public.employee_portal_requests
for each row execute function private.set_employee_portal_request_updated_at();

create or replace function private.is_current_organization_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'::public.app_role
      and organization_id is not null
  );
$$;

revoke all on function private.is_current_organization_admin() from public, anon, authenticated;
grant execute on function private.is_current_organization_admin() to authenticated;

drop policy if exists "organization members manage employee portal requests" on public.employee_portal_requests;
drop policy if exists "organization members read employee portal requests" on public.employee_portal_requests;
drop policy if exists "organization admins update employee portal requests" on public.employee_portal_requests;

create policy "organization members read employee portal requests"
on public.employee_portal_requests for select to authenticated
using (organization_id = private.current_organization_id());

create policy "organization admins update employee portal requests"
on public.employee_portal_requests for update to authenticated
using (organization_id = private.current_organization_id() and private.is_current_organization_admin())
with check (organization_id = private.current_organization_id() and private.is_current_organization_admin());

revoke insert on public.employee_portal_requests from authenticated;
grant select, update on public.employee_portal_requests to authenticated;

create table if not exists public.employee_request_attachment_cleanup (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  attachment_path text not null,
  attempt_count integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  cleaned_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.employee_request_attachment_cleanup enable row level security;

create index if not exists employee_request_attachment_cleanup_pending_idx
  on public.employee_request_attachment_cleanup(next_attempt_at)
  where cleaned_at is null;

revoke all on public.employee_request_attachment_cleanup from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-request-attachments',
  'employee-request-attachments',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "employee request attachments public upload" on storage.objects;
drop policy if exists "employee request attachments authenticated upload" on storage.objects;
drop policy if exists "employee request attachments organization read" on storage.objects;
drop policy if exists "employee request attachments organization update" on storage.objects;
drop policy if exists "employee request attachments organization delete" on storage.objects;

create policy "employee request attachments organization read"
on storage.objects for select to authenticated
using (
  bucket_id = 'employee-request-attachments'
  and exists (
    select 1 from public.employee_portal_requests r
    where r.attachment_path = name
      and r.organization_id = private.current_organization_id()
  )
);

create policy "employee request attachments organization update"
on storage.objects for update to authenticated
using (
  bucket_id = 'employee-request-attachments'
  and private.is_current_organization_admin()
  and exists (
    select 1 from public.employee_portal_requests r
    where r.attachment_path = name
      and r.organization_id = private.current_organization_id()
  )
)
with check (bucket_id = 'employee-request-attachments');

create policy "employee request attachments organization delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-request-attachments'
  and private.is_current_organization_admin()
  and exists (
    select 1 from public.employee_portal_requests r
    where r.attachment_path = name
      and r.organization_id = private.current_organization_id()
  )
);

create or replace function private.create_employee_material_request(
  p_registration text,
  p_cpf text,
  p_delivery_item_id uuid,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_employee public.employees;
  v_delivery_item public.delivery_items;
  v_material public.materials;
  v_lot public.material_lots;
  v_returned integer;
  v_remaining integer;
  v_request_id uuid;
begin
  select * into v_employee
  from public.employees
  where registration = trim(p_registration)
    and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and status <> 'terminated'
  limit 1;
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if p_delivery_item_id is null then raise exception 'Selecione o material'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Descreva a solicitação'; end if;

  select di
  into v_delivery_item
  from public.delivery_items di
  join public.deliveries d on d.id = di.delivery_id
  where di.id = p_delivery_item_id
    and di.organization_id = v_employee.organization_id
    and d.organization_id = v_employee.organization_id
    and d.employee_id = v_employee.id
  for update of di;
  if v_delivery_item.id is null then raise exception 'Material entregue não encontrado'; end if;

  select * into v_material from public.materials where id = v_delivery_item.material_id;
  select * into v_lot from public.material_lots where id = v_delivery_item.lot_id;
  select coalesce(sum(quantity), 0) into v_returned
  from public.return_items
  where delivery_item_id = p_delivery_item_id;
  v_remaining := v_delivery_item.quantity - v_returned;
  if v_remaining <= 0 then raise exception 'Material já foi totalmente devolvido'; end if;

  insert into public.employee_portal_requests (
    organization_id, employee_id, request_type, description,
    delivery_item_id, requested_quantity, material_name_snapshot, lot_number_snapshot
  ) values (
    v_employee.organization_id, v_employee.id, 'replacement', trim(p_description),
    p_delivery_item_id, v_remaining, v_material.name, v_lot.lot_number
  ) returning id into v_request_id;
  return v_request_id;
exception
  when unique_violation then
    raise exception 'Já existe uma solicitação aberta para este material';
end;
$$;

revoke all on function private.create_employee_material_request(text, text, uuid, text) from public, anon, authenticated;
grant execute on function private.create_employee_material_request(text, text, uuid, text) to service_role;

create or replace function public.create_employee_material_request(
  p_registration text,
  p_cpf text,
  p_delivery_item_id uuid,
  p_description text
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select private.create_employee_material_request(p_registration, p_cpf, p_delivery_item_id, p_description);
$$;

revoke all on function public.create_employee_material_request(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_employee_material_request(text, text, uuid, text) to service_role;

create or replace function public.claim_employee_request_attachment_cleanup(p_limit integer default 25)
returns table(id uuid, request_id uuid, attachment_path text, attempt_count integer)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_current_organization_admin() then raise exception 'Acesso negado'; end if;
  return query
  update public.employee_request_attachment_cleanup c
  set attempt_count = c.attempt_count + 1,
      next_attempt_at = now() + interval '5 minutes'
  where c.id in (
    select pending.id
    from public.employee_request_attachment_cleanup pending
    where pending.cleaned_at is null and pending.next_attempt_at <= now()
    order by pending.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  )
  returning c.id, c.request_id, c.attachment_path, c.attempt_count;
end;
$$;

revoke all on function public.claim_employee_request_attachment_cleanup(integer) from public, anon;
grant execute on function public.claim_employee_request_attachment_cleanup(integer) to authenticated;

create or replace function public.get_employee_portal_data_v3(p_registration text, p_cpf text)
returns table(employee_id uuid, employee_name text, function_name text, organization_name text, shirt_size text, pants_size text, shoe_size text, helmet_size text, glove_size text, uniform_notes text, courses jsonb, materials jsonb, requests jsonb, requirements jsonb)
language sql
security definer
set search_path = public
as $$
  select e.id, e.full_name, coalesce(e.function_name, e.job_title, ''), o.name,
    p.shirt_size, p.pants_size, p.shoe_size, p.helmet_size, p.glove_size, p.uniform_notes,
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'provider', c.provider, 'completed_at', c.completed_at, 'expires_at', c.expires_at, 'certificate_number', c.certificate_number, 'has_attachment', c.certificate_file_path is not null) order by c.expires_at nulls last) from public.employee_courses c where c.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('delivery_item_id', x.delivery_item_id, 'material_name', x.material_name, 'lot_number', x.lot_number, 'quantity', x.quantity, 'unit', x.unit, 'last_delivery', x.last_delivery) order by x.last_delivery desc, x.material_name) from (select di.id delivery_item_id, m.name material_name, ml.lot_number, m.unit, di.quantity - coalesce((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id), 0) quantity, d.delivered_at last_delivery from public.delivery_items di join public.deliveries d on d.id = di.delivery_id join public.materials m on m.id = di.material_id join public.material_lots ml on ml.id = di.lot_id where d.employee_id = e.id and di.quantity - coalesce((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id), 0) > 0) x), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'request_type', r.request_type, 'material_name', r.material_name_snapshot, 'description', r.description, 'status', r.status, 'has_attachment', r.attachment_path is not null, 'created_at', r.created_at, 'updated_at', r.updated_at) order by r.created_at desc) from public.employee_portal_requests r where r.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'function_group', t.function_group, 'course_name', t.course_name, 'source_annex', t.source_annex, 'mandatory', t.mandatory, 'validity_months', t.validity_months, 'notes', t.notes) order by t.function_group, t.course_name) from public.contract_training_requirements t where t.organization_id = e.organization_id), '[]'::jsonb)
  from public.employees e join public.organizations o on o.id = e.organization_id left join public.employee_profiles p on p.employee_id = e.id
  where e.registration = trim(p_registration) and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and e.status <> 'terminated' limit 1;
$$;

revoke all on function public.get_employee_portal_data_v3(text, text) from public, authenticated;
grant execute on function public.get_employee_portal_data_v3(text, text) to anon;

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
  v_material uuid;
  v_lot uuid;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and organization_id = v_org) then raise exception 'Funcionário não encontrado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um equipamento'; end if;
  insert into public.returns (organization_id, employee_id, returned_at, reason, responsible_id, notes)
  values (v_org, p_employee_id, coalesce(p_returned_at, current_date), p_reason, auth.uid(), nullif(trim(p_notes), '')) returning id into v_return;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_delivery_item := (v_item->>'delivery_item_id')::uuid;
    v_requested := (v_item->>'quantity')::int;
    select di.material_id, di.lot_id, di.quantity into v_material, v_lot, v_delivered
    from public.delivery_items di join public.deliveries d on d.id = di.delivery_id
    where di.id = v_delivery_item and di.organization_id = v_org and d.employee_id = p_employee_id
    for update of di;
    if v_material is null then raise exception 'Equipamento entregue não encontrado'; end if;
    select coalesce(sum(quantity), 0) into v_returned from public.return_items where delivery_item_id = v_delivery_item;
    if v_requested is null or v_requested <= 0 or v_requested > v_delivered - v_returned then raise exception 'Quantidade devolvida inválida'; end if;
    update public.material_lots set available_quantity = available_quantity + v_requested where id = v_lot and organization_id = v_org;
    insert into public.return_items (organization_id, return_id, delivery_item_id, material_id, lot_id, quantity) values (v_org, v_return, v_delivery_item, v_material, v_lot, v_requested);
    insert into public.stock_movements (organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values (v_org, v_material, v_lot, 'return', v_requested, auth.uid(), 'Devolução ' || v_return::text);
  end loop;
  return v_return;
end;
$$;

revoke all on function public.register_return(uuid, text, date, jsonb, text) from public, anon, authenticated;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;
