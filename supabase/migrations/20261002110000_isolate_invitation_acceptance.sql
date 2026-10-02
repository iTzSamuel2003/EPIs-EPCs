create or replace function private.accept_organization_invitation_internal(p_token text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_user uuid := auth.uid(); v_inv public.organization_invitations%rowtype; v_profile uuid;
begin
  if v_user is null then raise exception 'Entre ou crie sua conta antes de aceitar o convite'; end if;
  select * into v_inv from public.organization_invitations where token_hash = encode(digest(p_token, 'sha256'), 'hex') and accepted_at is null and expires_at > now() limit 1;
  if v_inv.id is null then raise exception 'Convite inválido ou expirado'; end if;
  if exists (select 1 from public.profiles where id = v_user and organization_id is not null) then raise exception 'Este usuário já pertence a uma organização'; end if;
  insert into public.profiles(id, organization_id, full_name, role) values (v_user, v_inv.organization_id, coalesce(nullif(trim(p_full_name), ''), split_part(v_inv.email, '@', 1)), v_inv.role)
  returning id into v_profile;
  insert into public.profile_page_permissions(organization_id, profile_id, page_path)
  select v_inv.organization_id, v_profile, path from unnest(v_inv.page_paths) as path where path <> '';
  update public.organization_invitations set accepted_at = now() where id = v_inv.id;
  return v_profile;
end;
$$;

revoke all on function private.accept_organization_invitation_internal(text, text) from public, anon;
grant execute on function private.accept_organization_invitation_internal(text, text) to authenticated;

create or replace function public.accept_organization_invitation(p_token text, p_full_name text)
returns uuid language sql security invoker set search_path = public, private as $$
  select private.accept_organization_invitation_internal(p_token, p_full_name);
$$;

revoke all on function public.accept_organization_invitation(text, text) from public, anon;
grant execute on function public.accept_organization_invitation(text, text) to authenticated;
