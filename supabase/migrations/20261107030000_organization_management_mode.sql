create table private.platform_organization_management_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  auth_session_id uuid not null,
  organization_id uuid not null,
  access_reason text not null check (char_length(trim(access_reason)) between 5 and 500),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  constraint platform_organization_management_session_end_reason_check
    check (end_reason is null or end_reason in (
      'manual_exit', 'scope_switched', 'expired', 'auth_session_revoked',
      'platform_admin_revoked', 'organization_suspended'
    )),
  constraint platform_organization_management_session_end_state_check
    check ((ended_at is null) = (end_reason is null))
);

create unique index platform_organization_management_one_open_session_idx
  on private.platform_organization_management_sessions (auth_session_id)
  where ended_at is null;

create index platform_organization_management_actor_started_idx
  on private.platform_organization_management_sessions (actor_id, started_at desc);

create table private.platform_organization_management_audit (
  id uuid primary key default gen_random_uuid(),
  management_session_id uuid,
  auth_session_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  organization_id uuid not null,
  event_type text not null check (event_type in (
    'session_start', 'session_end', 'sensitive_read', 'tenant_write'
  )),
  end_reason text,
  reason text,
  resource_name text,
  table_name text,
  operation text,
  record_key uuid,
  created_at timestamptz not null default now()
);

create index platform_organization_management_audit_org_created_idx
  on private.platform_organization_management_audit (organization_id, created_at desc);

create unique index platform_organization_management_audit_read_once_idx
  on private.platform_organization_management_audit (management_session_id, resource_name)
  where event_type = 'sensitive_read';

alter table private.platform_organization_management_sessions enable row level security;
alter table private.platform_organization_management_audit enable row level security;
revoke all on table private.platform_organization_management_sessions from public, anon, authenticated, service_role;
revoke all on table private.platform_organization_management_audit from public, anon, authenticated, service_role;

create function private.platform_admin_has_management_grant(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.platform_admins as platform_admin
    where platform_admin.user_id = p_user_id
  )
$function$;

revoke all on function private.platform_admin_has_management_grant(uuid) from public, anon, authenticated;

create function private.current_management_session_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select management_session.id
  from private.platform_organization_management_sessions as management_session
  join auth.sessions as auth_session
    on auth_session.id = management_session.auth_session_id
   and auth_session.user_id = management_session.actor_id
  join public.organizations as organization
    on organization.id = management_session.organization_id
  where management_session.actor_id = (select auth.uid())
    and management_session.auth_session_id::text = auth.jwt() ->> 'session_id'
    and management_session.ended_at is null
    and management_session.expires_at > now()
    and (auth_session.not_after is null or auth_session.not_after > now())
    and organization.lifecycle_status <> 'suspended'
    and private.platform_admin_has_management_grant(management_session.actor_id)
  limit 1
$function$;

revoke all on function private.current_management_session_id() from public, anon, authenticated;

create function private.is_current_organization_management_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.current_management_session_id() is not null
$function$;

revoke all on function private.is_current_organization_management_session() from public, anon;
grant execute on function private.is_current_organization_management_session() to authenticated;

create or replace function private.is_platform_admin_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.platform_admin_has_management_grant((select auth.uid()))
    and private.current_management_session_id() is null
$function$;

revoke all on function private.is_platform_admin_internal() from public, anon, authenticated;
grant execute on function private.is_platform_admin_internal() to authenticated;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select management_session.organization_id
      from private.platform_organization_management_sessions as management_session
      where management_session.id = private.current_management_session_id()
    ),
    (
      select profile.organization_id
      from public.profiles as profile
      join public.organizations as organization
        on organization.id = profile.organization_id
      where profile.id = (select auth.uid())
        and organization.lifecycle_status = 'active'
    )
  )
$function$;

revoke all on function private.current_organization_id() from public, anon, authenticated;
grant execute on function private.current_organization_id() to authenticated;

create or replace function public.get_my_organization_lifecycle_status()
returns table (organization_name text, lifecycle_status text)
language sql
stable
security definer
set search_path = ''
as $function$
  select organization.name, organization.lifecycle_status
  from public.organizations as organization
  where organization.id = private.current_organization_id()
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
  select case
    when private.current_management_session_id() is not null then true
    else exists (
      select 1
      from public.profiles as profile
      where profile.id = (select auth.uid())
        and profile.organization_id = private.current_organization_id()
        and profile.role = 'admin'::public.app_role
    )
  end
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
  select case
    when private.current_management_session_id() is not null
      then 'admin' = any(coalesce(p_roles, '{}'::text[]))
    else exists (
      select 1
      from public.profiles as profile
      where profile.id = (select auth.uid())
        and profile.organization_id = private.current_organization_id()
        and profile.role::text = any(coalesce(p_roles, '{}'::text[]))
    )
  end
$function$;

revoke all on function private.has_current_organization_role(text[]) from public, anon, authenticated;
grant execute on function private.has_current_organization_role(text[]) to authenticated;

create or replace function private.current_user_can_access_page(p_page text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_organization uuid := private.current_organization_id();
  v_role text;
  v_page_paths text[];
begin
  if v_user is null or v_organization is null or nullif(trim(p_page), '') is null then
    return false;
  end if;

  if private.current_management_session_id() is not null then
    return p_page = any(array[
      '/', '/bases', '/materials', '/employees', '/teams', '/units', '/variants',
      '/function-templates', '/entries', '/deliveries', '/returns', '/transfers',
      '/discounts', '/attendance', '/employee-history', '/asos', '/requests',
      '/stock', '/validities', '/ca', '/contract-requirements', '/tests',
      '/training-compliance', '/compliance', '/costs', '/reports', '/movements',
      '/audit', '/settings', '/help'
    ]::text[]);
  end if;

  select profile.role::text into v_role
  from public.profiles as profile
  where profile.id = v_user
    and profile.organization_id = v_organization;

  if not found then return false; end if;
  if p_page = '/discounts' and coalesce(v_role, '') not in ('admin', 'rh') then return false; end if;
  if p_page = '/bases' then return v_role in ('admin', 'rh'); end if;
  if v_role = 'admin' then return true; end if;

  select access.page_paths into v_page_paths
  from public.profile_access_overrides as access
  where access.profile_id = v_user
    and access.organization_id = v_organization;

  if v_page_paths is null then
    select access.page_paths into v_page_paths
    from public.organization_role_access as access
    where access.organization_id = v_organization
      and access.role::text = v_role;
  end if;

  if v_page_paths is not null then return p_page = any(v_page_paths); end if;

  return case v_role
    when 'rh' then p_page = any(array[
      '/', '/employees', '/deliveries', '/returns', '/discounts', '/attendance',
      '/employee-history', '/asos', '/requests', '/stock', '/validities',
      '/reports', '/bases', '/transfers', '/help'
    ]::text[])
    when 'tst' then p_page = any(array[
      '/', '/materials', '/entries', '/deliveries', '/returns', '/stock',
      '/validities', '/ca', '/contract-requirements', '/tests',
      '/training-compliance', '/compliance', '/costs', '/reports',
      '/movements', '/transfers', '/help'
    ]::text[])
    else false
  end;
end;
$function$;

revoke all on function private.current_user_can_access_page(text) from public, anon, authenticated;
grant execute on function private.current_user_can_access_page(text) to authenticated;

create or replace function private.require_active_organization_for_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
  v_lifecycle_status text;
  v_management_session_id uuid := private.current_management_session_id();
begin
  if tg_op = 'DELETE' then
    v_organization_id := old.organization_id;
  else
    v_organization_id := new.organization_id;
  end if;

  select organization.lifecycle_status into v_lifecycle_status
  from public.organizations as organization
  where organization.id = v_organization_id;

  if v_lifecycle_status = 'active' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_management_session_id is not null
     and v_organization_id = private.current_organization_id()
     and v_lifecycle_status in ('draft', 'awaiting_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  raise exception 'A organização não está ativa para operações';
end;
$function$;

revoke all on function private.require_active_organization_for_write() from public, anon, authenticated;

drop policy if exists "users can update their profile" on public.profiles;
create policy "users can update their profile" on public.profiles
for update to authenticated
using (
  id = (select auth.uid())
  and not private.is_current_organization_management_session()
)
with check (
  id = (select auth.uid())
  and not private.is_current_organization_management_session()
);

create function private.close_stale_current_management_session()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_auth_session_text text := auth.jwt() ->> 'session_id';
  v_session record;
  v_end_reason text;
begin
  if v_actor_id is null or nullif(v_auth_session_text, '') is null then return; end if;

  for v_session in
    select management_session.*,
           organization.lifecycle_status,
           exists (
             select 1
             from auth.sessions as auth_session
             where auth_session.id = management_session.auth_session_id
               and auth_session.user_id = management_session.actor_id
               and (auth_session.not_after is null or auth_session.not_after > now())
           ) as auth_session_exists,
           private.platform_admin_has_management_grant(management_session.actor_id) as platform_admin_exists
    from private.platform_organization_management_sessions as management_session
    join public.organizations as organization
      on organization.id = management_session.organization_id
    where management_session.actor_id = v_actor_id
      and management_session.auth_session_id::text = v_auth_session_text
      and management_session.ended_at is null
    for update of management_session
  loop
    v_end_reason := case
      when v_session.expires_at <= now() then 'expired'
      when not v_session.auth_session_exists then 'auth_session_revoked'
      when not v_session.platform_admin_exists then 'platform_admin_revoked'
      when v_session.lifecycle_status = 'suspended' then 'organization_suspended'
      else null
    end;

    if v_end_reason is null then continue; end if;

    update private.platform_organization_management_sessions as management_session
    set ended_at = now(), end_reason = v_end_reason
    where management_session.id = v_session.id;

    insert into private.platform_organization_management_audit (
      management_session_id, auth_session_id, actor_id, organization_id,
      event_type, end_reason
    )
    values (
      v_session.id, v_session.auth_session_id, v_session.actor_id,
      v_session.organization_id, 'session_end', v_end_reason
    );
  end loop;
end;
$function$;

revoke all on function private.close_stale_current_management_session() from public, anon, authenticated;

create function private.audit_platform_management_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'A trilha de auditoria é imutável' using errcode = '55000';
end;
$function$;

revoke all on function private.audit_platform_management_immutable() from public, anon, authenticated;

create trigger platform_organization_management_audit_immutable
before update or delete on private.platform_organization_management_audit
for each row execute function private.audit_platform_management_immutable();

create function private.close_platform_management_sessions_on_admin_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session record;
begin
  for v_session in
    select management_session.*
    from private.platform_organization_management_sessions as management_session
    where management_session.actor_id = old.user_id
      and management_session.ended_at is null
    for update
  loop
    update private.platform_organization_management_sessions as management_session
    set ended_at = now(), end_reason = 'platform_admin_revoked'
    where management_session.id = v_session.id;

    insert into private.platform_organization_management_audit (
      management_session_id, auth_session_id, actor_id, organization_id,
      event_type, end_reason
    )
    values (
      v_session.id, v_session.auth_session_id, v_session.actor_id,
      v_session.organization_id, 'session_end', 'platform_admin_revoked'
    );
  end loop;

  return old;
end;
$function$;

revoke all on function private.close_platform_management_sessions_on_admin_revocation() from public, anon, authenticated;

create trigger platform_admins_close_management_sessions
before delete on private.platform_admins
for each row execute function private.close_platform_management_sessions_on_admin_revocation();

create function private.audit_platform_management_tenant_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid := private.current_management_session_id();
  v_row jsonb;
  v_management_session private.platform_organization_management_sessions%rowtype;
  v_organization_id text;
  v_record_key uuid;
  v_record_key_text text;
begin
  if v_session_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_organization_id := v_row ->> 'organization_id';

  select * into v_management_session
  from private.platform_organization_management_sessions as management_session
  where management_session.id = v_session_id;

  if v_management_session.id is null
     or v_organization_id is distinct from v_management_session.organization_id::text then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_record_key_text := v_row ->> 'id';
  if v_record_key_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_record_key := v_record_key_text::uuid;
  end if;

  insert into private.platform_organization_management_audit (
    management_session_id, auth_session_id, actor_id, organization_id,
    event_type, table_name, operation, record_key
  )
  values (
    v_management_session.id, v_management_session.auth_session_id,
    v_management_session.actor_id, v_management_session.organization_id,
    'tenant_write', tg_table_schema || '.' || tg_table_name, tg_op, v_record_key
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.audit_platform_management_tenant_write() from public, anon, authenticated;

create function private.audit_platform_management_organization_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid := private.current_management_session_id();
  v_management_session private.platform_organization_management_sessions%rowtype;
  v_organization_id uuid;
begin
  if v_session_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  v_organization_id := case when tg_op = 'DELETE' then old.id else new.id end;

  select * into v_management_session
  from private.platform_organization_management_sessions as management_session
  where management_session.id = v_session_id
    and management_session.organization_id = v_organization_id;

  if v_management_session.id is not null then
    insert into private.platform_organization_management_audit (
      management_session_id, auth_session_id, actor_id, organization_id,
      event_type, table_name, operation, record_key
    )
    values (
      v_management_session.id, v_management_session.auth_session_id,
      v_management_session.actor_id, v_management_session.organization_id,
      'tenant_write', 'public.organizations', tg_op, v_organization_id
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.audit_platform_management_organization_write() from public, anon, authenticated;

create trigger organizations_audit_platform_management_write
after insert or update or delete on public.organizations
for each row execute function private.audit_platform_management_organization_write();

create function private.audit_platform_management_storage_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid := private.current_management_session_id();
  v_management_session private.platform_organization_management_sessions%rowtype;
  v_row jsonb;
  v_object_id uuid;
  v_organization_prefix text;
begin
  if v_session_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_object_id := nullif(v_row ->> 'id', '')::uuid;
  v_organization_prefix := (storage.foldername(v_row ->> 'name'))[1];

  select * into v_management_session
  from private.platform_organization_management_sessions as management_session
  where management_session.id = v_session_id
    and management_session.organization_id::text = v_organization_prefix;

  if v_management_session.id is not null then
    insert into private.platform_organization_management_audit (
      management_session_id, auth_session_id, actor_id, organization_id,
      event_type, table_name, operation, record_key
    )
    values (
      v_management_session.id, v_management_session.auth_session_id,
      v_management_session.actor_id, v_management_session.organization_id,
      'tenant_write', 'storage.objects', tg_op, v_object_id
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.audit_platform_management_storage_write() from public, anon, authenticated;

create trigger storage_objects_audit_platform_management_write
after insert or update or delete on storage.objects
for each row execute function private.audit_platform_management_storage_write();

do $migration$
declare
  v_table record;
begin
  for v_table in
    select relation_schema.nspname as schema_name, relation.relname as table_name
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as relation_schema
      on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and exists (
        select 1
        from pg_catalog.pg_attribute as column_row
        where column_row.attrelid = relation.oid
          and column_row.attname = 'organization_id'
          and column_row.attnum > 0
          and not column_row.attisdropped
      )
  loop
    execute format(
      'drop trigger if exists audit_platform_management_tenant_write on %I.%I',
      v_table.schema_name,
      v_table.table_name
    );
    execute format(
      'create trigger audit_platform_management_tenant_write after insert or update or delete on %I.%I for each row execute function private.audit_platform_management_tenant_write()',
      v_table.schema_name,
      v_table.table_name
    );
  end loop;
end;
$migration$;

create function public.start_platform_organization_management_session(
  p_organization_id uuid,
  p_reason text
)
returns table (
  management_session_id uuid,
  organization_id uuid,
  organization_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_auth_session_id uuid;
  v_organization_name text;
  v_started_at timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_previous_session private.platform_organization_management_sessions%rowtype;
begin
  if v_actor_id is null
     or not private.platform_admin_has_management_grant(v_actor_id) then
    raise exception 'Acesso negado' using errcode = 'P0001';
  end if;

  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'Informe um motivo entre 5 e 500 caracteres.' using errcode = 'P0001';
  end if;

  if nullif(auth.jwt() ->> 'session_id', '') is null then
    raise exception 'Sessão autenticada inválida' using errcode = 'P0001';
  end if;

  select auth_session.id into v_auth_session_id
  from auth.sessions as auth_session
  where auth_session.id::text = auth.jwt() ->> 'session_id'
    and auth_session.user_id = v_actor_id
    and (auth_session.not_after is null or auth_session.not_after > now());

  if v_auth_session_id is null then
    raise exception 'Sessão autenticada inválida' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_auth_session_id::text, 0));
  perform private.close_stale_current_management_session();

  select organization.name into v_organization_name
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.lifecycle_status in ('draft', 'awaiting_admin', 'active')
  for share;

  if v_organization_name is null then
    raise exception 'Organização indisponível para gestão' using errcode = 'P0001';
  end if;

  for v_previous_session in
    select management_session.*
    from private.platform_organization_management_sessions as management_session
    where management_session.auth_session_id = v_auth_session_id
      and management_session.ended_at is null
    for update
  loop
    update private.platform_organization_management_sessions as management_session
    set ended_at = now(), end_reason = 'scope_switched'
    where management_session.id = v_previous_session.id;

    insert into private.platform_organization_management_audit (
      management_session_id, auth_session_id, actor_id, organization_id,
      event_type, end_reason
    )
    values (
      v_previous_session.id, v_previous_session.auth_session_id,
      v_previous_session.actor_id, v_previous_session.organization_id,
      'session_end', 'scope_switched'
    );
  end loop;

  v_expires_at := v_started_at + interval '60 minutes';

  insert into private.platform_organization_management_sessions (
    actor_id, auth_session_id, organization_id, access_reason,
    started_at, expires_at
  )
  values (
    v_actor_id, v_auth_session_id, p_organization_id, v_reason,
    v_started_at, v_expires_at
  )
  returning id into management_session_id;

  insert into private.platform_organization_management_audit (
    management_session_id, auth_session_id, actor_id, organization_id,
    event_type, reason
  )
  values (
    management_session_id, v_auth_session_id, v_actor_id, p_organization_id,
    'session_start', v_reason
  );

  organization_id := p_organization_id;
  organization_name := v_organization_name;
  expires_at := v_expires_at;
  return next;
end;
$function$;

revoke all on function public.start_platform_organization_management_session(uuid, text) from public, anon;
grant execute on function public.start_platform_organization_management_session(uuid, text) to authenticated;

create function public.end_platform_organization_management_session()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_session_id text := auth.jwt() ->> 'session_id';
  v_session private.platform_organization_management_sessions%rowtype;
begin
  if v_actor_id is null or nullif(v_session_id, '') is null then return false; end if;

  perform private.close_stale_current_management_session();

  update private.platform_organization_management_sessions as management_session
  set ended_at = now(), end_reason = 'manual_exit'
  where management_session.actor_id = v_actor_id
    and management_session.auth_session_id::text = v_session_id
    and management_session.ended_at is null
  returning management_session.* into v_session;

  if v_session.id is null then return false; end if;

  insert into private.platform_organization_management_audit (
    management_session_id, auth_session_id, actor_id, organization_id,
    event_type, end_reason
  )
  values (
    v_session.id, v_session.auth_session_id, v_session.actor_id,
    v_session.organization_id, 'session_end', 'manual_exit'
  );

  return true;
end;
$function$;

revoke all on function public.end_platform_organization_management_session() from public, anon;
grant execute on function public.end_platform_organization_management_session() to authenticated;

create function public.get_platform_organization_management_context()
returns table (
  management_session_id uuid,
  organization_id uuid,
  organization_name text,
  organization_logo_url text,
  lifecycle_status text,
  started_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.close_stale_current_management_session();

  return query
  select management_session.id,
         organization.id,
         organization.name,
         organization.logo_url,
         organization.lifecycle_status,
         management_session.started_at,
         management_session.expires_at
  from private.platform_organization_management_sessions as management_session
  join public.organizations as organization
    on organization.id = management_session.organization_id
  where management_session.id = private.current_management_session_id();
end;
$function$;

revoke all on function public.get_platform_organization_management_context() from public, anon;
grant execute on function public.get_platform_organization_management_context() to authenticated;

create function public.audit_sensitive_management_read(p_resource_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_management_session_id uuid := private.current_management_session_id();
  v_management_session private.platform_organization_management_sessions%rowtype;
  v_allowed_resources constant text[] := array[
    '/employees', '/employee-history', '/attendance', '/asos', '/requests',
    '/returns', '/discounts', '/deliveries', '/training-compliance', '/compliance'
  ];
begin
  if p_resource_name is null or not (p_resource_name = any(v_allowed_resources)) then
    raise exception 'Recurso de auditoria não permitido' using errcode = 'P0001';
  end if;

  if v_management_session_id is null then
    raise exception 'Sessão de gestão inválida' using errcode = 'P0001';
  end if;

  select * into v_management_session
  from private.platform_organization_management_sessions as management_session
  where management_session.id = v_management_session_id;

  insert into private.platform_organization_management_audit (
    management_session_id, auth_session_id, actor_id, organization_id,
    event_type, resource_name
  )
  values (
    v_management_session.id, v_management_session.auth_session_id,
    v_management_session.actor_id, v_management_session.organization_id,
    'sensitive_read', p_resource_name
  )
  on conflict (management_session_id, resource_name)
    where event_type = 'sensitive_read'
    do nothing;

  return true;
end;
$function$;

revoke all on function public.audit_sensitive_management_read(text) from public, anon;
grant execute on function public.audit_sensitive_management_read(text) to authenticated;
