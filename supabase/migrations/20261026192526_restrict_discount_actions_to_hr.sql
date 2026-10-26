-- Discount-case RLS is restricted to admin/RH. Keep page overrides from
-- granting the same privileged route and its SECURITY DEFINER actions to TST.
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
  if v_user is null or v_organization is null or nullif(trim(p_page), '') is null then
    return false;
  end if;

  select profile.role::text into v_role
  from public.profiles profile
  where profile.id = v_user and profile.organization_id = v_organization;
  if not found then return false; end if;

  if p_page = '/discounts' and coalesce(v_role, '') not in ('admin', 'rh') then
    return false;
  end if;
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
