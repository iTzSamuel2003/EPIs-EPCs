-- Compose accented UTF-8 characters in SQL to avoid transport encoding corruption.
create or replace function private.save_platform_organization_test_access_internal(
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
    raise exception 'Identificador de teste invalido' using errcode = 'P0001';
  end if;

  select organization.* into v_organization
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.lifecycle_status in ('draft', 'awaiting_admin', 'active')
  for update;

  if v_organization.id is null then
    raise exception 'Organizacao indisponivel para acesso de teste' using errcode = 'P0001';
  end if;

  select test_access.* into v_existing
  from private.organization_test_access as test_access
  where test_access.organization_id = p_organization_id
  for update;

  if v_existing.user_id is distinct from p_expected_user_id then
    raise exception 'Acesso alterado por outra solicitacao. Atualize a pagina e tente novamente.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from private.organization_test_access as test_access
    where test_access.login_name = p_login_name
      and test_access.organization_id <> p_organization_id
  ) then
    raise exception 'Usuario de teste ja esta em uso' using errcode = 'P0001';
  end if;

  select lower(auth_user.email) into v_email
  from auth.users as auth_user
  where auth_user.id = p_user_id;

  if v_email is distinct from lower(p_login_name || '@test.epistemporario.invalid') then
    raise exception 'Conta de teste nao reconhecida' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.profiles as profile
    where profile.id = p_user_id
      and profile.organization_id is not null
      and profile.organization_id <> p_organization_id
  ) then
    raise exception 'Conta vinculada a outra organizacao' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.profiles as profile
    where profile.id = p_user_id
      and p_user_id is distinct from v_existing.user_id
  ) then
    raise exception 'Conta ja possui perfil de organizacao' using errcode = 'P0001';
  end if;

  if v_existing.user_id is not null and v_existing.user_id <> p_user_id then
    delete from public.profiles as profile
    where profile.id = v_existing.user_id
      and profile.organization_id = p_organization_id;
  end if;

  insert into public.profiles (id, organization_id, full_name, role)
  values (
    p_user_id,
    p_organization_id,
    'Acesso tempor' || chr(225) || 'rio de teste',
    'admin'::public.app_role
  )
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
    case
      when v_existing.user_id is null then 'Acesso tempor' || chr(225) || 'rio de teste emitido'
      else 'Acesso tempor' || chr(225) || 'rio de teste renovado'
    end,
    jsonb_build_object('login_name', p_login_name, 'expires_at', v_expires_at)
  );

  return query select p_login_name, v_expires_at;
end;
$function$;

revoke all on function private.save_platform_organization_test_access_internal(uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function private.save_platform_organization_test_access_internal(uuid, uuid, text, uuid) to authenticated;

update public.profiles as profile
set full_name = 'Acesso tempor' || chr(225) || 'rio de teste'
from private.organization_test_access as test_access
where profile.id = test_access.user_id;
