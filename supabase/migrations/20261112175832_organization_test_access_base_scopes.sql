create function private.list_platform_organization_test_access_bases_internal()
returns table (organization_id uuid, base_id uuid, base_name text)
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
  select base.organization_id, base.id, base.name
  from public.organization_bases as base
  where base.is_active
  order by base.organization_id, base.name;
end;
$function$;

revoke all on function private.list_platform_organization_test_access_bases_internal() from public, anon, service_role;
grant execute on function private.list_platform_organization_test_access_bases_internal() to authenticated;

create function public.list_platform_organization_test_access_bases()
returns table (organization_id uuid, base_id uuid, base_name text)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.list_platform_organization_test_access_bases_internal()
$function$;

revoke all on function public.list_platform_organization_test_access_bases() from public, anon;
grant execute on function public.list_platform_organization_test_access_bases() to authenticated;

drop function public.list_platform_organization_test_access();
drop function private.list_platform_organization_test_access_internal();

create function private.list_platform_organization_test_access_internal()
returns table (
  organization_id uuid,
  user_id uuid,
  login_name text,
  expires_at timestamptz,
  revoked_at timestamptz,
  is_active boolean,
  role public.app_role,
  base_ids uuid[]
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
         private.has_active_organization_test_access(test_access.user_id, test_access.organization_id),
         test_access.role,
         coalesce(
           array(
             select profile_base_access.base_id
             from public.profile_base_access as profile_base_access
             where profile_base_access.profile_id = test_access.user_id
               and profile_base_access.organization_id = test_access.organization_id
             order by profile_base_access.base_id
           ),
           array[]::uuid[]
         )
  from private.organization_test_access as test_access
  order by test_access.created_at desc;
end;
$function$;

revoke all on function private.list_platform_organization_test_access_internal() from public, anon, service_role;
grant execute on function private.list_platform_organization_test_access_internal() to authenticated;

create function public.list_platform_organization_test_access()
returns table (
  organization_id uuid,
  user_id uuid,
  login_name text,
  expires_at timestamptz,
  revoked_at timestamptz,
  is_active boolean,
  role public.app_role,
  base_ids uuid[]
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.list_platform_organization_test_access_internal()
$function$;

revoke all on function public.list_platform_organization_test_access() from public, anon;
grant execute on function public.list_platform_organization_test_access() to authenticated;

drop function public.save_platform_organization_test_access(uuid, uuid, text, public.app_role, uuid);
drop function private.save_platform_organization_test_access_internal(uuid, uuid, text, public.app_role, uuid);

create function private.save_platform_organization_test_access_internal(
  p_organization_id uuid,
  p_user_id uuid,
  p_login_name text,
  p_role public.app_role,
  p_expected_user_id uuid,
  p_base_ids uuid[]
)
returns table (login_name text, expires_at timestamptz, role public.app_role, base_ids uuid[])
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
  v_base_ids uuid[] := coalesce(p_base_ids, array[]::uuid[]);
  v_valid_base_count bigint;
begin
  if v_actor_id is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado' using errcode = 'P0001';
  end if;

  if p_role is null or p_role not in ('rh'::public.app_role, 'tst'::public.app_role, 'user'::public.app_role) then
    raise exception 'Função inválida para acesso de teste' using errcode = 'P0001';
  end if;

  if p_login_name is null or p_login_name !~ '^teste-[a-z0-9][a-z0-9-]{2,62}$' then
    raise exception 'Identificador de teste inválido' using errcode = 'P0001';
  end if;

  if p_role <> 'tst'::public.app_role and cardinality(v_base_ids) > 0 then
    raise exception 'Somente acessos TST podem receber bases específicas' using errcode = 'P0001';
  end if;

  select organization.* into v_organization
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.lifecycle_status in ('draft', 'awaiting_admin', 'active')
  for update;

  if v_organization.id is null then
    raise exception 'Organização indisponível para acesso de teste' using errcode = 'P0001';
  end if;

  if p_role = 'tst'::public.app_role then
    if cardinality(v_base_ids) = 0 then
      raise exception 'Selecione pelo menos uma base para o acesso TST' using errcode = 'P0001';
    end if;

    select count(*) into v_valid_base_count
    from public.organization_bases as base
    where base.organization_id = p_organization_id
      and base.is_active
      and base.id = any(v_base_ids);

    if v_valid_base_count <> cardinality(v_base_ids) then
      raise exception 'Uma ou mais bases estão inativas ou não pertencem à organização' using errcode = 'P0001';
    end if;
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
  values (p_user_id, p_organization_id, 'Acesso temporário de teste', p_role)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        full_name = excluded.full_name,
        role = excluded.role;

  delete from public.profile_base_access as profile_base_access
  where profile_base_access.profile_id = p_user_id;

  if p_role = 'tst'::public.app_role then
    insert into public.profile_base_access (organization_id, profile_id, base_id)
    select p_organization_id, p_user_id, base.id
    from public.organization_bases as base
    where base.organization_id = p_organization_id
      and base.is_active
      and base.id = any(v_base_ids);
  end if;

  insert into private.organization_test_access (
    organization_id, user_id, login_name, role, expires_at, revoked_at,
    created_by, updated_by, updated_at
  ) values (
    p_organization_id, p_user_id, p_login_name, p_role, v_expires_at, null,
    v_actor_id, v_actor_id, now()
  )
  on conflict (organization_id) do update
    set user_id = excluded.user_id,
        login_name = excluded.login_name,
        role = excluded.role,
        expires_at = excluded.expires_at,
        revoked_at = null,
        updated_by = excluded.updated_by,
        updated_at = now();

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
    jsonb_build_object('login_name', p_login_name, 'expires_at', v_expires_at, 'role', p_role, 'base_ids', v_base_ids)
  );

  return query select p_login_name, v_expires_at, p_role, v_base_ids;
end;
$function$;

revoke all on function private.save_platform_organization_test_access_internal(uuid, uuid, text, public.app_role, uuid, uuid[]) from public, anon, service_role;
grant execute on function private.save_platform_organization_test_access_internal(uuid, uuid, text, public.app_role, uuid, uuid[]) to authenticated;

create function public.save_platform_organization_test_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_login_name text,
  p_role public.app_role,
  p_expected_user_id uuid,
  p_base_ids uuid[] default array[]::uuid[]
)
returns table (login_name text, expires_at timestamptz, role public.app_role, base_ids uuid[])
language sql
security invoker
set search_path = ''
as $function$
  select * from private.save_platform_organization_test_access_internal(
    p_organization_id, p_user_id, p_login_name, p_role, p_expected_user_id, p_base_ids
  )
$function$;

revoke all on function public.save_platform_organization_test_access(uuid, uuid, text, public.app_role, uuid, uuid[]) from public, anon;
grant execute on function public.save_platform_organization_test_access(uuid, uuid, text, public.app_role, uuid, uuid[]) to authenticated;
