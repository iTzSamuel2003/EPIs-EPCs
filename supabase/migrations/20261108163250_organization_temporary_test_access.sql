-- Applied to production as migration 20261108163250.
create table private.organization_test_access (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  login_name text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_test_access_login_name_check
    check (login_name ~ '^teste-[a-z0-9][a-z0-9-]{2,62}$')
);

alter table private.organization_test_access enable row level security;
revoke all on table private.organization_test_access from public, anon, authenticated, service_role;

create function private.has_active_organization_test_access(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.organization_test_access as test_access
    join public.organizations as organization
      on organization.id = test_access.organization_id
    where test_access.user_id = p_user_id
      and test_access.organization_id = p_organization_id
      and test_access.revoked_at is null
      and test_access.expires_at > now()
      and organization.lifecycle_status in ('draft', 'awaiting_admin', 'active')
  )
$function$;

revoke all on function private.has_active_organization_test_access(uuid, uuid) from public, anon, authenticated;

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
        and (
          (
            organization.lifecycle_status = 'active'
            and not exists (
              select 1
              from private.organization_test_access as test_access
              where test_access.user_id = profile.id
            )
          )
          or private.has_active_organization_test_access(profile.id, organization.id)
        )
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
  select organization.name,
         case
           when private.has_active_organization_test_access(profile.id, organization.id) then 'active'
           when exists (
             select 1
             from private.organization_test_access as test_access
             where test_access.user_id = profile.id
           ) then 'suspended'
           else organization.lifecycle_status
         end
  from public.profiles as profile
  join public.organizations as organization
    on organization.id = profile.organization_id
  where profile.id = (select auth.uid())
$function$;

revoke all on function public.get_my_organization_lifecycle_status() from public, anon;
grant execute on function public.get_my_organization_lifecycle_status() to authenticated;

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

  if exists (
    select 1
    from private.contract_template_install_context as install_context
    where install_context.backend_pid = pg_catalog.pg_backend_pid()
      and install_context.transaction_id = pg_catalog.txid_current()
      and install_context.organization_id = v_organization_id
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_organization_id = private.current_organization_id()
     and private.has_active_organization_test_access(auth.uid(), v_organization_id)
     and v_lifecycle_status in ('draft', 'awaiting_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  raise exception 'A organização não está ativa para operações';
end;
$function$;

revoke all on function private.require_active_organization_for_write() from public, anon, authenticated;

create function public.list_platform_organization_test_access()
returns table (
  organization_id uuid,
  user_id uuid,
  login_name text,
  expires_at timestamptz,
  revoked_at timestamptz,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado' using errcode = 'P0001';
  end if;

  return query
  select test_access.organization_id,
         test_access.user_id,
         test_access.login_name,
         test_access.expires_at,
         test_access.revoked_at,
         private.has_active_organization_test_access(test_access.user_id, test_access.organization_id)
  from private.organization_test_access as test_access
  order by test_access.created_at desc;
end;
$function$;

revoke all on function public.list_platform_organization_test_access() from public, anon;
grant execute on function public.list_platform_organization_test_access() to authenticated;

create function public.save_platform_organization_test_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_login_name text,
  p_expected_user_id uuid
)
returns table (login_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_organization public.organizations%rowtype;
  v_existing private.organization_test_access%rowtype;
  v_expires_at timestamptz := clock_timestamp() + interval '7 days';
  v_email text;
begin
  if v_actor_id is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado' using errcode = 'P0001';
  end if;

  if p_login_name !~ '^teste-[a-z0-9][a-z0-9-]{2,62}$' then
    raise exception 'Identificador de teste inválido' using errcode = 'P0001';
  end if;

  select organization.* into v_organization
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.lifecycle_status in ('draft', 'awaiting_admin', 'active')
  for update;

  if v_organization.id is null then
    raise exception 'Organização indisponível para acesso de teste' using errcode = 'P0001';
  end if;

  select test_access.* into v_existing
  from private.organization_test_access as test_access
  where test_access.organization_id = p_organization_id
  for update;

  if v_existing.user_id is distinct from p_expected_user_id then
    raise exception 'O acesso foi alterado por outra solicitação. Atualize a página e tente novamente.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from private.organization_test_access as test_access
    where test_access.login_name = p_login_name
      and test_access.organization_id <> p_organization_id
  ) then
    raise exception 'O usuário de teste já está em uso' using errcode = 'P0001';
  end if;

  select lower(auth_user.email) into v_email
  from auth.users as auth_user
  where auth_user.id = p_user_id;

  if v_email is distinct from lower(p_login_name || '@test.epistemporario.invalid') then
    raise exception 'Conta de teste não reconhecida' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.profiles as profile
    where profile.id = p_user_id
      and profile.organization_id is not null
      and profile.organization_id <> p_organization_id
  ) then
    raise exception 'A conta já está vinculada a outra organização' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.profiles as profile
    where profile.id = p_user_id
      and p_user_id is distinct from v_existing.user_id
  ) then
    raise exception 'A conta já possui um perfil de organização' using errcode = 'P0001';
  end if;

  if v_existing.user_id is not null and v_existing.user_id <> p_user_id then
    delete from public.profiles as profile
    where profile.id = v_existing.user_id
      and profile.organization_id = p_organization_id;
  end if;

  insert into public.profiles (id, organization_id, full_name, role)
  values (p_user_id, p_organization_id, 'Acesso temporário de teste', 'admin'::public.app_role)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        full_name = excluded.full_name,
        role = excluded.role;

  insert into private.organization_test_access (
    organization_id, user_id, login_name, expires_at, revoked_at,
    created_by, updated_by, updated_at
  ) values (
    p_organization_id, p_user_id, p_login_name, v_expires_at, null,
    v_actor_id, v_actor_id, now()
  )
  on conflict (organization_id) do update
    set user_id = excluded.user_id,
        login_name = excluded.login_name,
        expires_at = excluded.expires_at,
        revoked_at = null,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into private.platform_organization_events (
    organization_id, organization_name, actor_id, event_type,
    previous_status, new_status, reason, details
  ) values (
    p_organization_id,
    v_organization.name,
    v_actor_id,
    case when v_existing.user_id is null then 'test_access_issued' else 'test_access_renewed' end,
    v_organization.lifecycle_status,
    v_organization.lifecycle_status,
    case when v_existing.user_id is null then 'Acesso temporário de teste emitido' else 'Acesso temporário de teste renovado' end,
    jsonb_build_object('login_name', p_login_name, 'expires_at', v_expires_at)
  );

  return query select p_login_name, v_expires_at;
end;
$function$;

revoke all on function public.save_platform_organization_test_access(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.save_platform_organization_test_access(uuid, uuid, text, uuid) to authenticated;

create function public.revoke_platform_organization_test_access(
  p_organization_id uuid,
  p_expected_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_access private.organization_test_access%rowtype;
  v_organization_name text;
begin
  if v_actor_id is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado' using errcode = 'P0001';
  end if;

  select test_access.* into v_access
  from private.organization_test_access as test_access
  where test_access.organization_id = p_organization_id
  for update;

  if v_access.user_id is distinct from p_expected_user_id then
    raise exception 'O acesso foi alterado por outra solicitação. Atualize a página e tente novamente.' using errcode = 'P0001';
  end if;

  if v_access.user_id is null then return null; end if;

  if v_access.revoked_at is null then
    update private.organization_test_access
    set revoked_at = now(), updated_by = v_actor_id, updated_at = now()
    where organization_id = p_organization_id;

    select organization.name into v_organization_name
    from public.organizations as organization
    where organization.id = p_organization_id;

    insert into private.platform_organization_events (
      organization_id, organization_name, actor_id, event_type,
      previous_status, new_status, reason, details
    )
    select p_organization_id, v_organization_name, v_actor_id,
           'test_access_revoked', organization.lifecycle_status,
           organization.lifecycle_status, 'Acesso temporário de teste revogado',
           jsonb_build_object('login_name', v_access.login_name)
    from public.organizations as organization
    where organization.id = p_organization_id;
  end if;

  return v_access.user_id;
end;
$function$;

revoke all on function public.revoke_platform_organization_test_access(uuid, uuid) from public, anon;
grant execute on function public.revoke_platform_organization_test_access(uuid, uuid) to authenticated;
