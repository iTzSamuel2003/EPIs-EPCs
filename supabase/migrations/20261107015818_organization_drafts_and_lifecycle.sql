create schema if not exists private;

alter table public.organizations
  add column if not exists lifecycle_status text not null default 'active';

alter table public.organizations
  drop constraint if exists organizations_lifecycle_status_check;

alter table public.organizations
  add constraint organizations_lifecycle_status_check
  check (lifecycle_status in ('draft', 'awaiting_admin', 'active', 'suspended'));

alter table public.organization_invitations
  add column if not exists invite_kind text not null default 'member',
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null,
  add column if not exists created_sequence bigint generated always as identity;

alter table public.organization_invitations
  drop constraint if exists organization_invitations_invite_kind_check;

alter table public.organization_invitations
  add constraint organization_invitations_invite_kind_check
  check (invite_kind in ('first_admin', 'member'));

create unique index if not exists organization_invitations_one_pending_first_admin_idx
  on public.organization_invitations (organization_id)
  where invite_kind = 'first_admin' and accepted_at is null and revoked_at is null;

create index if not exists organization_invitations_email_pending_idx
  on public.organization_invitations (lower(email), expires_at)
  where accepted_at is null and revoked_at is null;

create table if not exists private.platform_organization_events (
  event_sequence bigint generated always as identity,
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  organization_name text not null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  previous_status text,
  new_status text,
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint platform_organization_events_status_check
    check (
      (previous_status is null or previous_status in ('draft', 'awaiting_admin', 'active', 'suspended'))
      and (new_status is null or new_status in ('draft', 'awaiting_admin', 'active', 'suspended'))
    )
);

alter table private.platform_organization_events
  add column if not exists event_sequence bigint generated always as identity;

create unique index if not exists platform_organization_events_sequence_idx
  on private.platform_organization_events (event_sequence);

create index if not exists platform_organization_events_org_created_idx
  on private.platform_organization_events (organization_id, created_at desc);

alter table private.platform_organization_events enable row level security;
revoke all on table private.platform_organization_events from public, anon, authenticated;

create or replace function private.reject_platform_organization_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'A trilha de auditoria da plataforma não pode ser alterada';
end;
$function$;

revoke all on function private.reject_platform_organization_event_mutation() from public, anon, authenticated;

drop trigger if exists platform_organization_events_append_only on private.platform_organization_events;
create trigger platform_organization_events_append_only
before update or delete on private.platform_organization_events
for each row execute function private.reject_platform_organization_event_mutation();

create or replace function private.protect_organization_lifecycle_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.lifecycle_status is distinct from new.lifecycle_status
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'O estado da organização só pode ser alterado pelos fluxos administrativos';
  end if;
  return new;
end;
$function$;

revoke all on function private.protect_organization_lifecycle_status() from public, anon, authenticated;

drop trigger if exists organizations_protect_lifecycle_status on public.organizations;
create trigger organizations_protect_lifecycle_status
before update of lifecycle_status on public.organizations
for each row execute function private.protect_organization_lifecycle_status();

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select profile.organization_id
  from public.profiles as profile
  join public.organizations as organization
    on organization.id = profile.organization_id
  where profile.id = (select auth.uid())
    and organization.lifecycle_status = 'active'
$function$;

revoke all on function private.current_organization_id() from public, anon, authenticated;
grant execute on function private.current_organization_id() to authenticated;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.current_organization_id()
$function$;

revoke all on function public.current_organization_id() from public, anon;
grant execute on function public.current_organization_id() to authenticated;

create or replace function public.get_my_organization_lifecycle_status()
returns table (organization_name text, lifecycle_status text)
language sql
stable
security definer
set search_path = ''
as $function$
  select organization.name, organization.lifecycle_status
  from public.profiles as profile
  join public.organizations as organization
    on organization.id = profile.organization_id
  where profile.id = (select auth.uid())
$function$;

revoke all on function public.get_my_organization_lifecycle_status() from public, anon;
grant execute on function public.get_my_organization_lifecycle_status() to authenticated;

create or replace function private.is_current_organization_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.organization_id = private.current_organization_id()
      and profile.role = 'admin'::public.app_role
  )
$function$;

revoke all on function private.is_current_organization_admin() from public, anon, authenticated;
grant execute on function private.is_current_organization_admin() to authenticated;

create or replace function private.has_current_organization_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.organization_id = private.current_organization_id()
      and profile.role::text = any(coalesce(p_roles, '{}'::text[]))
  )
$function$;

revoke all on function private.has_current_organization_role(text[]) from public, anon, authenticated;
grant execute on function private.has_current_organization_role(text[]) to authenticated;

create or replace function private.require_active_organization_for_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
begin
  if tg_op = 'DELETE' then
    v_organization_id := old.organization_id;
  else
    v_organization_id := new.organization_id;
  end if;

  if not exists (
    select 1 from public.organizations as organization
    where organization.id = v_organization_id
      and organization.lifecycle_status = 'active'
  ) then
    raise exception 'A organização não está ativa para operações';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id
     and not exists (
       select 1 from public.organizations as organization
       where organization.id = old.organization_id
         and organization.lifecycle_status = 'active'
     ) then
    raise exception 'A organização de origem não está ativa para operações';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.require_active_organization_for_write() from public, anon, authenticated;

do $migration$
declare
  v_table record;
begin
  for v_table in
    select relation_schema.nspname as schema_name, relation.relname as table_name
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname not in (
        'organizations', 'organization_invitations', 'profiles',
        'profile_access_overrides', 'profile_page_permissions'
      )
      and exists (
        select 1 from pg_catalog.pg_attribute as column_row
        where column_row.attrelid = relation.oid
          and column_row.attname = 'organization_id'
          and column_row.attnum > 0
          and not column_row.attisdropped
      )
  loop
    execute format('drop trigger if exists require_active_organization_for_write on %I.%I', v_table.schema_name, v_table.table_name);
    execute format(
      'create trigger require_active_organization_for_write before insert or update or delete on %I.%I for each row execute function private.require_active_organization_for_write()',
      v_table.schema_name,
      v_table.table_name
    );
  end loop;
end;
$migration$;

create or replace function public.employee_portal_organization_is_active(p_registration text, p_cpf text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_active boolean;
begin
  if nullif(trim(coalesce(p_registration, '')), '') is null
     or nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '') is null
     or length(trim(p_registration)) > 100
     or length(trim(p_cpf)) > 64 then
    perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
    return false;
  end if;

  select exists (
    select 1
    from public.employees as employee
    join public.organizations as organization
      on organization.id = employee.organization_id
    where employee.registration = trim(p_registration)
      and regexp_replace(employee.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
      and employee.status <> 'terminated'
      and organization.lifecycle_status = 'active'
  ) into v_organization_active;

  if not coalesce(v_organization_active, false) then
    perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  end if;

  return coalesce(v_organization_active, false);
end;
$function$;

revoke all on function public.employee_portal_organization_is_active(text, text) from public, anon, authenticated;
grant execute on function public.employee_portal_organization_is_active(text, text) to service_role;

create or replace function public.get_measurement_request(p_token uuid)
returns table (employee_name text, expires_at timestamptz, completed_at timestamptz)
language sql
security definer
set search_path = ''
as $function$
  select employee.full_name, request.expires_at, request.completed_at
  from public.employee_measurement_requests as request
  join public.employees as employee on employee.id = request.employee_id
  join public.organizations as organization on organization.id = request.organization_id
  where request.token = p_token
    and request.expires_at > now()
    and organization.lifecycle_status = 'active'
$function$;

create or replace function public.submit_measurement_request(
  p_token uuid,
  p_shirt_size text,
  p_pants_size text,
  p_shoe_size text,
  p_helmet_size text,
  p_glove_size text,
  p_notes text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.employee_measurement_requests%rowtype;
begin
  if length(coalesce(p_shirt_size, '')) > 50
    or length(coalesce(p_pants_size, '')) > 50
    or length(coalesce(p_shoe_size, '')) > 50
    or length(coalesce(p_helmet_size, '')) > 50
    or length(coalesce(p_glove_size, '')) > 50
    or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Uma das medidas excede o tamanho permitido';
  end if;

  select * into v_request
  from public.employee_measurement_requests
  where token = p_token and expires_at > now()
  for update;

  if v_request.id is null then raise exception 'Link inválido ou expirado'; end if;
  if v_request.completed_at is not null then raise exception 'Link já utilizado'; end if;
  if not exists (
    select 1 from public.organizations as organization
    where organization.id = v_request.organization_id
      and organization.lifecycle_status = 'active'
  ) then
    raise exception 'A organização não está ativa para receber atualizações';
  end if;

  insert into public.employee_profiles (
    employee_id, organization_id, shirt_size, pants_size, shoe_size,
    helmet_size, glove_size, uniform_notes, completed_by_employee, updated_at
  ) values (
    v_request.employee_id, v_request.organization_id,
    nullif(trim(p_shirt_size), ''), nullif(trim(p_pants_size), ''),
    nullif(trim(p_shoe_size), ''), nullif(trim(p_helmet_size), ''),
    nullif(trim(p_glove_size), ''), nullif(trim(p_notes), ''), true, now()
  )
  on conflict (employee_id) do update set
    shirt_size = excluded.shirt_size,
    pants_size = excluded.pants_size,
    shoe_size = excluded.shoe_size,
    helmet_size = excluded.helmet_size,
    glove_size = excluded.glove_size,
    uniform_notes = excluded.uniform_notes,
    completed_by_employee = true,
    updated_at = now();

  update public.employee_measurement_requests
  set completed_at = now(), updated_at = now()
  where id = v_request.id and completed_at is null;

  return true;
end;
$function$;

revoke all on function public.employee_portal_organization_is_active(text, text) from public, anon, authenticated;
grant execute on function public.employee_portal_organization_is_active(text, text) to service_role;

drop function if exists public.list_platform_organizations();
drop function if exists private.list_platform_organizations_internal();

create function private.list_platform_organizations_internal()
returns table (
  id uuid,
  name text,
  cnpj text,
  logo_url text,
  address text,
  phone text,
  sesmt_manager text,
  validity_alert_days integer,
  replacement_alert_days integer,
  default_minimum_stock integer,
  created_at timestamptz,
  lifecycle_status text,
  member_count bigint,
  first_admin_email text,
  first_admin_invitation_id uuid,
  first_admin_expires_at timestamptz,
  first_admin_invitation_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;

  return query
  select organization.id,
         organization.name,
         organization.cnpj,
         organization.logo_url,
         organization.address,
         organization.phone,
         organization.sesmt_manager,
         organization.validity_alert_days,
         organization.replacement_alert_days,
         organization.default_minimum_stock,
         organization.created_at,
         organization.lifecycle_status,
         count(profile.id)::bigint,
         invitation.email,
         invitation.id,
         invitation.expires_at,
         case
           when invitation.id is null then null
           when invitation.accepted_at is not null then 'accepted'
           when invitation.revoked_at is not null then 'revoked'
           when invitation.expires_at <= now() then 'expired'
           else 'pending'
         end
  from public.organizations as organization
  left join public.profiles as profile
    on profile.organization_id = organization.id
  left join lateral (
    select candidate.id,
           candidate.email,
           candidate.expires_at,
           candidate.accepted_at,
           candidate.revoked_at
    from public.organization_invitations as candidate
    where candidate.organization_id = organization.id
      and candidate.invite_kind = 'first_admin'
    order by candidate.created_sequence desc
    limit 1
  ) as invitation on true
  group by organization.id, invitation.id, invitation.email,
           invitation.expires_at, invitation.accepted_at, invitation.revoked_at
  order by organization.created_at desc, organization.name;
end;
$function$;

revoke all on function private.list_platform_organizations_internal() from public, anon, authenticated;
grant execute on function private.list_platform_organizations_internal() to authenticated;

create function public.list_platform_organizations()
returns table (
  id uuid,
  name text,
  cnpj text,
  logo_url text,
  address text,
  phone text,
  sesmt_manager text,
  validity_alert_days integer,
  replacement_alert_days integer,
  default_minimum_stock integer,
  created_at timestamptz,
  lifecycle_status text,
  member_count bigint,
  first_admin_email text,
  first_admin_invitation_id uuid,
  first_admin_expires_at timestamptz,
  first_admin_invitation_state text
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.list_platform_organizations_internal()
$function$;

revoke all on function public.list_platform_organizations() from public, anon;
grant execute on function public.list_platform_organizations() to authenticated;

create or replace function public.create_organization_draft(p_name text, p_cnpj text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_organization_id uuid;
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if length(v_name) < 2 or length(v_name) > 150 then
    raise exception 'Informe um nome de organização provisório, de 2 a 150 caracteres';
  end if;

  insert into public.organizations (name, cnpj, lifecycle_status)
  values (v_name, nullif(trim(coalesce(p_cnpj, '')), ''), 'draft')
  returning id into v_organization_id;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason
  ) values (
    v_organization_id, v_name, v_actor, 'draft_created', null,
    'draft', 'Organização criada como rascunho'
  );

  return v_organization_id;
end;
$function$;

revoke all on function public.create_organization_draft(text, text) from public, anon;
grant execute on function public.create_organization_draft(text, text) to authenticated;

create or replace function public.update_platform_organization_draft(
  p_organization_id uuid,
  p_name text,
  p_cnpj text,
  p_logo_url text,
  p_address text,
  p_phone text,
  p_sesmt_manager text,
  p_validity_alert_days integer,
  p_replacement_alert_days integer,
  p_default_minimum_stock integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_organization public.organizations%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_logo_url text := nullif(trim(coalesce(p_logo_url, '')), '');
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if p_organization_id is null then
    raise exception 'Organização não informada';
  end if;
  if length(v_name) < 2 or length(v_name) > 150 then
    raise exception 'Informe um nome de organização de 2 a 150 caracteres';
  end if;
  if v_logo_url is not null and v_logo_url !~* '^https?://' then
    raise exception 'O endereço do logo deve começar com http:// ou https://';
  end if;
  if p_validity_alert_days is null or p_validity_alert_days not between 0 and 365
     or p_replacement_alert_days is null or p_replacement_alert_days not between 0 and 365
     or p_default_minimum_stock is null or p_default_minimum_stock not between 0 and 1000000 then
    raise exception 'Revise os limites de alertas e estoque mínimo';
  end if;

  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;

  if v_organization.id is null then
    raise exception 'Organização não encontrada';
  end if;
  if v_organization.lifecycle_status not in ('draft', 'awaiting_admin') then
    raise exception 'Somente organizações em preparação podem ser configuradas nesta tela';
  end if;

  update public.organizations
  set name = v_name,
      cnpj = nullif(trim(coalesce(p_cnpj, '')), ''),
      logo_url = v_logo_url,
      address = nullif(trim(coalesce(p_address, '')), ''),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      sesmt_manager = nullif(trim(coalesce(p_sesmt_manager, '')), ''),
      validity_alert_days = p_validity_alert_days,
      replacement_alert_days = p_replacement_alert_days,
      default_minimum_stock = p_default_minimum_stock
  where id = v_organization.id;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason
  ) values (
    v_organization.id, v_name, v_actor, 'draft_configured',
    v_organization.lifecycle_status, v_organization.lifecycle_status,
    'Dados cadastrais da organização atualizados'
  );
end;
$function$;

revoke all on function public.update_platform_organization_draft(uuid, text, text, text, text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.update_platform_organization_draft(uuid, text, text, text, text, text, text, integer, integer, integer) to authenticated;

create or replace function public.invite_first_organization_admin(
  p_organization_id uuid,
  p_email text,
  p_page_paths text[],
  p_token text
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := coalesce(p_token, '');
  v_organization public.organizations%rowtype;
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
  v_all_admin_paths text[] := array[
    '/', '/bases', '/materials', '/employees', '/teams', '/units', '/variants',
    '/function-templates', '/entries', '/deliveries', '/returns', '/transfers',
    '/discounts', '/attendance', '/employee-history', '/asos', '/requests',
    '/stock', '/validities', '/ca', '/contract-requirements', '/tests',
    '/training-compliance', '/compliance', '/costs', '/reports', '/movements',
    '/audit', '/settings', '/help'
  ];
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if p_organization_id is null then
    raise exception 'Organização não informada';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido para o primeiro administrador';
  end if;
  if v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Token de convite inválido';
  end if;
  if coalesce(array_length(p_page_paths, 1), 0) <> cardinality(v_all_admin_paths)
     or exists (
       select 1 from unnest(v_all_admin_paths) as expected(path)
       where not (expected.path = any(coalesce(p_page_paths, '{}'::text[])))
     ) then
    raise exception 'As permissões do primeiro administrador devem incluir todas as páginas da organização';
  end if;

  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;

  if v_organization.id is null then
    raise exception 'Organização não encontrada';
  end if;
  if v_organization.lifecycle_status not in ('draft', 'awaiting_admin') then
    raise exception 'O primeiro administrador só pode ser convidado durante a preparação da organização';
  end if;
  if exists (
    select 1
    from auth.users as auth_user
    join public.profiles as profile on profile.id = auth_user.id
    where lower(auth_user.email) = v_email
      and profile.organization_id is not null
      and profile.organization_id <> p_organization_id
  ) then
    raise exception 'Este e-mail já está vinculado a outra organização';
  end if;
  if exists (
    select 1
    from public.organization_invitations as invitation
    where lower(invitation.email) = v_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()
      and not (
        invitation.organization_id = p_organization_id
        and invitation.invite_kind = 'first_admin'
      )
  ) then
    raise exception 'Este e-mail já possui outro convite ativo';
  end if;

  update public.organization_invitations
  set revoked_at = now(), revoked_by = v_actor
  where organization_id = p_organization_id
    and invite_kind = 'first_admin'
    and accepted_at is null
    and revoked_at is null;

  insert into public.organization_invitations (
    organization_id, email, role, token_hash, page_paths,
    expires_at, created_by, invite_kind
  ) values (
    p_organization_id,
    v_email,
    'admin'::public.app_role,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_all_admin_paths,
    v_expires_at,
    v_actor,
    'first_admin'
  ) returning id into v_invitation_id;

  if v_organization.lifecycle_status = 'draft' then
    update public.organizations
    set lifecycle_status = 'awaiting_admin'
    where id = p_organization_id;
  end if;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason, details
  ) values (
    p_organization_id,
    v_organization.name,
    v_actor,
    case when v_organization.lifecycle_status = 'draft' then 'first_admin_invited' else 'first_admin_invitation_reissued' end,
    v_organization.lifecycle_status,
    'awaiting_admin',
    case when v_organization.lifecycle_status = 'draft' then 'Convite inicial do primeiro administrador emitido' else 'Convite do primeiro administrador reemitido; link anterior invalidado' end,
    jsonb_build_object('invitation_id', v_invitation_id)
  );

  return query select v_invitation_id, v_expires_at;
end;
$function$;

revoke all on function public.invite_first_organization_admin(uuid, text, text[], text) from public, anon;
grant execute on function public.invite_first_organization_admin(uuid, text, text[], text) to authenticated;

create or replace function public.revoke_first_admin_invitation(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_organization public.organizations%rowtype;
  v_invitation public.organization_invitations%rowtype;
  v_new_status text;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Informe o motivo da revogação (de 3 a 500 caracteres)';
  end if;

  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;

  if v_organization.id is null or v_organization.lifecycle_status = 'suspended' then
    raise exception 'Organização não encontrada ou suspensa';
  end if;

  select * into v_invitation
  from public.organization_invitations
  where id = p_invitation_id
    and organization_id = p_organization_id
    and invite_kind = 'first_admin'
    and accepted_at is null
    and revoked_at is null
  for update;

  if v_invitation.id is null then
    raise exception 'Convite pendente não encontrado';
  end if;

  update public.organization_invitations
  set revoked_at = now(), revoked_by = v_actor
  where id = v_invitation.id;

  v_new_status := v_organization.lifecycle_status;
  if v_organization.lifecycle_status = 'awaiting_admin'
     and not exists (
       select 1 from public.organization_invitations as pending
       where pending.organization_id = p_organization_id
         and pending.invite_kind = 'first_admin'
         and pending.accepted_at is null
         and pending.revoked_at is null
     ) then
    v_new_status := 'draft';
    update public.organizations
    set lifecycle_status = 'draft'
    where id = p_organization_id;
  end if;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason, details
  ) values (
    p_organization_id,
    v_organization.name,
    v_actor,
    'first_admin_invitation_revoked',
    v_organization.lifecycle_status,
    v_new_status,
    v_reason,
    jsonb_build_object('invitation_id', v_invitation.id)
  );
end;
$function$;

revoke all on function public.revoke_first_admin_invitation(uuid, uuid, text) from public, anon;
grant execute on function public.revoke_first_admin_invitation(uuid, uuid, text) to authenticated;

create or replace function public.set_organization_suspended(p_organization_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_organization public.organizations%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Informe o motivo da suspensão (de 3 a 500 caracteres)';
  end if;

  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;

  if v_organization.id is null then
    raise exception 'Organização não encontrada';
  end if;
  if v_organization.lifecycle_status = 'suspended' then
    raise exception 'A organização já está suspensa';
  end if;

  update public.organizations
  set lifecycle_status = 'suspended'
  where id = p_organization_id;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason
  ) values (
    p_organization_id, v_organization.name, v_actor, 'suspended',
    v_organization.lifecycle_status, 'suspended', v_reason
  );
end;
$function$;

revoke all on function public.set_organization_suspended(uuid, text) from public, anon;
grant execute on function public.set_organization_suspended(uuid, text) to authenticated;

create or replace function public.reactivate_organization(p_organization_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_organization public.organizations%rowtype;
  v_previous_status text;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Informe o motivo da reativação (de 3 a 500 caracteres)';
  end if;

  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;

  if v_organization.id is null then
    raise exception 'Organização não encontrada';
  end if;
  if v_organization.lifecycle_status <> 'suspended' then
    raise exception 'A organização não está suspensa';
  end if;

  select event.previous_status into v_previous_status
  from private.platform_organization_events as event
  where event.organization_id = p_organization_id
    and event.event_type = 'suspended'
    and event.new_status = 'suspended'
  order by event.event_sequence desc
  limit 1;

  if v_previous_status is null or v_previous_status = 'suspended' then
    raise exception 'Não foi possível determinar o estado anterior da organização';
  end if;

  update public.organizations
  set lifecycle_status = v_previous_status
  where id = p_organization_id;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason
  ) values (
    p_organization_id, v_organization.name, v_actor, 'reactivated',
    'suspended', v_previous_status, v_reason
  );
end;
$function$;

revoke all on function public.reactivate_organization(uuid, text) from public, anon;
grant execute on function public.reactivate_organization(uuid, text) to authenticated;

create or replace function public.delete_organization_draft(p_organization_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_organization public.organizations%rowtype;
  v_relation record;
  v_has_data boolean;
  v_management_sessions regclass;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Informe o motivo da exclusão (de 3 a 500 caracteres)';
  end if;

  select * into v_organization
  from public.organizations
  where id = p_organization_id
  for update;

  if v_organization.id is null then
    raise exception 'Organização não encontrada';
  end if;
  if v_organization.lifecycle_status <> 'draft' then
    raise exception 'Somente um rascunho pode ser excluído';
  end if;

  for v_relation in
    select relation.oid::regclass as relation_name
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname in ('public', 'private')
      and relation.relkind in ('r', 'p')
      and relation.oid <> 'private.platform_organization_events'::regclass
      and relation.oid <> coalesce(to_regclass('private.platform_organization_management_sessions')::oid, 0::oid)
      and exists (
        select 1
        from pg_catalog.pg_attribute as column_row
        where column_row.attrelid = relation.oid
          and column_row.attname = 'organization_id'
          and column_row.attnum > 0
          and not column_row.attisdropped
      )
  loop
    execute format('select exists (select 1 from %s where organization_id = $1)', v_relation.relation_name)
      into v_has_data
      using p_organization_id;
    if v_has_data then
      raise exception 'O rascunho possui registros vinculados em %', v_relation.relation_name;
    end if;
  end loop;

  v_management_sessions := to_regclass('private.platform_organization_management_sessions');
  if v_management_sessions is not null then
    execute format(
      'select exists (select 1 from %s where organization_id = $1 and ended_at is null and expires_at > now())',
      v_management_sessions
    ) into v_has_data using p_organization_id;
    if v_has_data then
      raise exception 'Encerre a sessão ativa de gestão antes de excluir o rascunho';
    end if;
  end if;

  if to_regclass('storage.objects') is not null then
    execute 'select exists (
      select 1 from storage.objects
      where split_part(name, ''/'', 1) = $1::text
    )' into v_has_data using p_organization_id;
    if v_has_data then
      raise exception 'O rascunho possui arquivos no Storage vinculados à organização';
    end if;
  end if;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason, details
  ) values (
    v_organization.id, v_organization.name, v_actor, 'draft_deleted',
    'draft', null, v_reason,
    jsonb_build_object('organization_name_snapshot', v_organization.name)
  );

  delete from public.organizations where id = v_organization.id;
end;
$function$;

revoke all on function public.delete_organization_draft(uuid, text) from public, anon;
grant execute on function public.delete_organization_draft(uuid, text) to authenticated;

create or replace function public.create_organization_invitation(
  p_email text,
  p_role public.app_role,
  p_page_paths text[],
  p_token text
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid := private.current_organization_id();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
  v_allowed_paths text[] := array[
    '/', '/bases', '/materials', '/employees', '/teams', '/units', '/variants',
    '/function-templates', '/entries', '/deliveries', '/returns', '/transfers',
    '/discounts', '/attendance', '/employee-history', '/asos', '/requests',
    '/stock', '/validities', '/ca', '/contract-requirements', '/tests',
    '/training-compliance', '/compliance', '/costs', '/reports', '/movements',
    '/audit', '/settings', '/help'
  ];
begin
  if v_actor is null or v_organization_id is null or not private.is_current_organization_admin() then
    raise exception 'Acesso negado';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido';
  end if;
  if coalesce(p_token, '') !~ '^[0-9a-f]{32,128}$' then
    raise exception 'Token de convite inválido';
  end if;
  if p_role is null or p_role::text not in ('admin', 'rh', 'tst', 'user') then
    raise exception 'Perfil de convite inválido';
  end if;
  if coalesce(array_length(p_page_paths, 1), 0) > cardinality(v_allowed_paths)
     or exists (
       select 1 from unnest(coalesce(p_page_paths, '{}'::text[])) as requested(path)
       where not (requested.path = any(v_allowed_paths))
     ) then
    raise exception 'A lista de permissões contém páginas inválidas';
  end if;

  insert into public.organization_invitations (
    organization_id, email, role, token_hash, page_paths,
    expires_at, created_by, invite_kind
  ) values (
    v_organization_id,
    v_email,
    p_role,
    encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'),
    coalesce(p_page_paths, '{}'::text[]),
    v_expires_at,
    v_actor,
    'member'
  ) returning id into v_invitation_id;

  return query select v_invitation_id, v_expires_at;
end;
$function$;

revoke all on function public.create_organization_invitation(text, public.app_role, text[], text) from public, anon;
grant execute on function public.create_organization_invitation(text, public.app_role, text[], text) to authenticated;

revoke insert, update, delete on table public.organization_invitations from public, anon, authenticated;
grant select on table public.organization_invitations to authenticated;

drop function if exists public.create_organization_with_admin_invitation(text, text, text, text[], text);
drop function if exists private.create_organization_with_admin_invitation_internal(text, text, text, text[], text);

create or replace function private.accept_organization_invitation_internal(p_token text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_inv public.organization_invitations%rowtype;
  v_organization public.organizations%rowtype;
  v_current_organization_id uuid;
  v_profile_exists boolean;
  v_profile_name text;
  v_matching_invites integer;
  v_target_role public.app_role;
begin
  if v_user is null then
    raise exception 'Entre ou crie sua conta antes de aceitar o convite';
  end if;

  select lower(auth_user.email), auth_user.email_confirmed_at
    into v_email, v_email_confirmed_at
  from auth.users as auth_user
  where auth_user.id = v_user;

  if v_email_confirmed_at is null then
    raise exception 'Confirme o e-mail da sua conta antes de aceitar o convite';
  end if;

  if p_token is null then
    select count(*)::integer into v_matching_invites
    from public.organization_invitations as invitation
    where lower(invitation.email) = v_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now();

    if v_matching_invites = 0 then
      raise exception 'Não há convite ativo para o e-mail desta conta';
    end if;
    if v_matching_invites > 1 then
      raise exception 'Há mais de um convite ativo para esta conta. Use o link enviado pelo administrador';
    end if;

    select invitation.* into v_inv
    from public.organization_invitations as invitation
    where lower(invitation.email) = v_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()
    order by invitation.created_at desc
    limit 1
    for update;
  else
    select invitation.* into v_inv
    from public.organization_invitations as invitation
    where invitation.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()
    for update;
  end if;

  if v_inv.id is null then
    raise exception 'Convite inválido, revogado ou expirado';
  end if;
  if v_email is null or v_email <> lower(v_inv.email) then
    raise exception 'Este convite foi criado para outro e-mail';
  end if;

  select * into v_organization
  from public.organizations
  where id = v_inv.organization_id
  for update;

  if v_organization.id is null or v_organization.lifecycle_status = 'suspended' then
    raise exception 'A organização está indisponível para aceitar convites';
  end if;
  if v_inv.invite_kind = 'first_admin' and v_organization.lifecycle_status <> 'awaiting_admin' then
    raise exception 'O convite do primeiro administrador não está mais ativo';
  end if;
  if v_inv.invite_kind = 'member' and v_organization.lifecycle_status <> 'active' then
    raise exception 'A organização ainda não está ativa para receber usuários';
  end if;

  select profile.organization_id into v_current_organization_id
  from public.profiles as profile
  where profile.id = v_user
  for update;
  v_profile_exists := found;

  if v_profile_exists and v_current_organization_id is not null
     and v_current_organization_id <> v_inv.organization_id then
    raise exception 'Este usuário já pertence a outra organização';
  end if;

  v_target_role := case when v_inv.invite_kind = 'first_admin' then 'admin'::public.app_role else v_inv.role end;
  v_profile_name := coalesce(nullif(trim(p_full_name), ''), split_part(v_inv.email, '@', 1));

  if not v_profile_exists then
    insert into public.profiles (id, organization_id, full_name, role)
    values (v_user, v_inv.organization_id, v_profile_name, v_target_role);
  elsif v_current_organization_id is null then
    update public.profiles
    set organization_id = v_inv.organization_id,
        full_name = v_profile_name,
        role = v_target_role
    where id = v_user;
  elsif v_inv.invite_kind = 'first_admin' then
    update public.profiles
    set full_name = v_profile_name,
        role = 'admin'::public.app_role
    where id = v_user;
  end if;

  if v_current_organization_id is null or v_inv.invite_kind = 'first_admin' then
    insert into public.profile_access_overrides (organization_id, profile_id, page_paths)
    values (v_inv.organization_id, v_user, coalesce(v_inv.page_paths, '{}'::text[]))
    on conflict (profile_id) do update
      set organization_id = excluded.organization_id,
          page_paths = excluded.page_paths,
          updated_at = now();
  end if;

  update public.organization_invitations
  set accepted_at = now()
  where id = v_inv.id;

  if v_inv.invite_kind = 'first_admin' then
    update public.organizations
    set lifecycle_status = 'active'
    where id = v_organization.id;

    insert into private.platform_organization_events (
      organization_id, organization_name, actor_id, event_type,
      previous_status, new_status, reason, details
    ) values (
      v_organization.id,
      v_organization.name,
      v_user,
      'first_admin_accepted',
      'awaiting_admin',
      'active',
      'O primeiro administrador aceitou o convite verificado por e-mail',
      jsonb_build_object('invitation_id', v_inv.id)
    );
  end if;

  return v_user;
end;
$function$;

revoke all on function private.accept_organization_invitation_internal(text, text) from public, anon, authenticated;
grant execute on function private.accept_organization_invitation_internal(text, text) to authenticated;

create or replace function public.accept_organization_invitation(p_token text, p_full_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.accept_organization_invitation_internal(p_token, p_full_name)
$function$;

revoke all on function public.accept_organization_invitation(text, text) from public, anon;
grant execute on function public.accept_organization_invitation(text, text) to authenticated;

create or replace function public.accept_my_pending_organization_invitation(p_full_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.accept_organization_invitation_internal(null, p_full_name)
$function$;

revoke all on function public.accept_my_pending_organization_invitation(text) from public, anon;
grant execute on function public.accept_my_pending_organization_invitation(text) to authenticated;
