create or replace function public.create_organization_invitation(
  p_email text,
  p_role public.app_role,
  p_page_paths text[],
  p_token text
)
returns table(invitation_id uuid, expires_at timestamptz)
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
    raise exception 'Informe um e-mail valido';
  end if;
  if coalesce(p_token, '') !~ '^[0-9a-f]{32,128}$' then
    raise exception 'Token de convite invalido';
  end if;
  if p_role is null or p_role::text not in ('admin', 'rh', 'tst', 'user') then
    raise exception 'Perfil de convite invalido';
  end if;
  if coalesce(array_length(p_page_paths, 1), 0) > cardinality(v_allowed_paths)
     or exists (
       select 1 from unnest(coalesce(p_page_paths, '{}'::text[])) as requested(path)
       where not (requested.path = any(v_allowed_paths))
     ) then
    raise exception 'A lista de permissoes contem paginas invalidas';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));

  update public.organization_invitations as invitation
  set revoked_at = now(), revoked_by = v_actor
  where invitation.organization_id = v_organization_id
    and lower(invitation.email) = v_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at <= now();

  if exists (
    select 1
    from public.organization_invitations as invitation
    where lower(invitation.email) = v_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()
  ) then
    raise exception 'Ja existe um convite pendente para este e-mail. Reutilize o link existente ou cancele-o antes de criar outro.';
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
