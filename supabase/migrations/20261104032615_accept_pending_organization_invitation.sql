create or replace function private.accept_organization_invitation_internal(p_token text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_inv public.organization_invitations%rowtype;
  v_current_organization_id uuid;
  v_profile_exists boolean;
  v_profile_name text;
  v_matching_invites integer;
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
    select count(*)::integer
      into v_matching_invites
    from public.organization_invitations as invitation
    where lower(invitation.email) = v_email
      and invitation.accepted_at is null
      and invitation.expires_at > now();

    if v_matching_invites = 0 then
      raise exception 'Não há convite ativo para o e-mail desta conta';
    end if;
    if v_matching_invites > 1 then
      raise exception 'Há mais de um convite ativo para esta conta. Use o link enviado pelo administrador';
    end if;

    select invitation.*
      into v_inv
    from public.organization_invitations as invitation
    where lower(invitation.email) = v_email
      and invitation.accepted_at is null
      and invitation.expires_at > now()
    order by invitation.created_at desc
    limit 1
    for update;
  else
    select invitation.*
      into v_inv
    from public.organization_invitations as invitation
    where invitation.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and invitation.accepted_at is null
      and invitation.expires_at > now()
    for update;
  end if;

  if v_inv.id is null then
    raise exception 'Convite inválido ou expirado';
  end if;
  if v_email is null or v_email <> lower(v_inv.email) then
    raise exception 'Este convite foi criado para outro e-mail';
  end if;

  select profile.organization_id
    into v_current_organization_id
  from public.profiles as profile
  where profile.id = v_user
  for update;
  v_profile_exists := found;

  if v_profile_exists and v_current_organization_id is not null then
    raise exception 'Este usuário já pertence a uma organização';
  end if;

  v_profile_name := coalesce(nullif(trim(p_full_name), ''), split_part(v_inv.email, '@', 1));
  if v_profile_exists then
    update public.profiles
    set organization_id = v_inv.organization_id,
        full_name = v_profile_name,
        role = v_inv.role
    where id = v_user;
  else
    insert into public.profiles (id, organization_id, full_name, role)
    values (v_user, v_inv.organization_id, v_profile_name, v_inv.role);
  end if;

  insert into public.profile_access_overrides (organization_id, profile_id, page_paths)
  values (v_inv.organization_id, v_user, coalesce(v_inv.page_paths, '{}'))
  on conflict (profile_id) do update
    set organization_id = excluded.organization_id,
        page_paths = excluded.page_paths,
        updated_at = now();

  update public.organization_invitations
  set accepted_at = now()
  where id = v_inv.id;

  return v_user;
end;
$function$;

revoke all on function private.accept_organization_invitation_internal(text, text) from public, anon, authenticated;
grant execute on function private.accept_organization_invitation_internal(text, text) to authenticated;

create or replace function public.accept_my_pending_organization_invitation(p_full_name text)
returns uuid
language sql
security invoker
set search_path = pg_catalog
as $function$
  select private.accept_organization_invitation_internal(null, p_full_name);
$function$;

revoke all on function public.accept_my_pending_organization_invitation(text) from public, anon;
grant execute on function public.accept_my_pending_organization_invitation(text) to authenticated;
