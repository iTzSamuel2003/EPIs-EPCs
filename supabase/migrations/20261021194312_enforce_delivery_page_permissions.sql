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
    when 'rh' then p_page = any(array['/employees','/deliveries','/returns','/requests','/stock','/validities','/reports'])
    when 'tst' then p_page = any(array['/entries','/deliveries','/returns','/stock','/validities','/tests','/ca','/reports'])
    else false
  end;
end;
$$;

revoke all on function private.current_user_can_access_page(text) from public, anon;
grant execute on function private.current_user_can_access_page(text) to authenticated, service_role;

alter function public.prepare_delivery_for_signature(uuid, text, date, jsonb, text) set schema private;
alter function private.prepare_delivery_for_signature(uuid, text, date, jsonb, text) rename to prepare_delivery_for_signature_internal;
revoke all on function private.prepare_delivery_for_signature_internal(uuid, text, date, jsonb, text) from public, anon, authenticated;
grant execute on function private.prepare_delivery_for_signature_internal(uuid, text, date, jsonb, text) to authenticated;

create function public.prepare_delivery_for_signature(
  p_employee_id uuid, p_reason text, p_delivered_at date, p_items jsonb, p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.current_user_can_access_page('/deliveries') then
    raise exception 'Seu perfil não tem acesso à página de entregas';
  end if;
  return private.prepare_delivery_for_signature_internal(p_employee_id, p_reason, p_delivered_at, p_items, p_notes);
end;
$$;
revoke all on function public.prepare_delivery_for_signature(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.prepare_delivery_for_signature(uuid, text, date, jsonb, text) to authenticated;

alter function public.confirm_pending_delivery_physical(uuid, text) set schema private;
alter function private.confirm_pending_delivery_physical(uuid, text) rename to confirm_pending_delivery_physical_internal;
revoke all on function private.confirm_pending_delivery_physical_internal(uuid, text) from public, anon, authenticated;
grant execute on function private.confirm_pending_delivery_physical_internal(uuid, text) to authenticated;

create function public.confirm_pending_delivery_physical(p_pending_delivery_id uuid, p_signature_file_path text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.current_user_can_access_page('/deliveries') then
    raise exception 'Seu perfil não tem acesso à página de entregas';
  end if;
  return private.confirm_pending_delivery_physical_internal(p_pending_delivery_id, p_signature_file_path);
end;
$$;
revoke all on function public.confirm_pending_delivery_physical(uuid, text) from public, anon;
grant execute on function public.confirm_pending_delivery_physical(uuid, text) to authenticated;

alter function public.cancel_pending_delivery(uuid) set schema private;
alter function private.cancel_pending_delivery(uuid) rename to cancel_pending_delivery_internal;
revoke all on function private.cancel_pending_delivery_internal(uuid) from public, anon, authenticated;
grant execute on function private.cancel_pending_delivery_internal(uuid) to authenticated;

create function public.cancel_pending_delivery(p_pending_delivery_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.current_user_can_access_page('/deliveries') then
    raise exception 'Seu perfil não tem acesso à página de entregas';
  end if;
  perform private.cancel_pending_delivery_internal(p_pending_delivery_id);
end;
$$;
revoke all on function public.cancel_pending_delivery(uuid) from public, anon;
grant execute on function public.cancel_pending_delivery(uuid) to authenticated;
