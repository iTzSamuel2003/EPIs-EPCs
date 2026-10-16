-- Expose organization member names and contact emails only to platform admins.

create or replace function private.list_platform_organization_members_internal(
  p_organization_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.app_role
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if auth.uid() is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;

  if p_organization_id is null then
    raise exception 'Organização não informada';
  end if;

  return query
  select profile.id,
         profile.full_name,
         auth_user.email::text,
         profile.role
  from public.profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.id
  where profile.organization_id = p_organization_id
  order by lower(profile.full_name), auth_user.email;
end;
$function$;

revoke all on function private.list_platform_organization_members_internal(uuid) from public, anon, authenticated;
grant execute on function private.list_platform_organization_members_internal(uuid) to authenticated;

create or replace function public.list_platform_organization_members(
  p_organization_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.app_role
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select * from private.list_platform_organization_members_internal(p_organization_id);
$function$;

revoke all on function public.list_platform_organization_members(uuid) from public, anon;
grant execute on function public.list_platform_organization_members(uuid) to authenticated;
