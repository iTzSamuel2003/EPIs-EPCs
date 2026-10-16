-- Keeps company data isolated and provisions new organizations through a
-- platform-admin-only invitation flow.

create schema if not exists private;

create table if not exists private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table private.platform_admins enable row level security;
revoke all on table private.platform_admins from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Bootstrap the only existing administrator as platform administrator. This
-- deliberately does not guess when a project already has multiple admins.
insert into private.platform_admins (user_id)
select profile.id
from public.profiles as profile
where profile.role = 'admin'::public.app_role
  and profile.organization_id is not null
  and (select count(*) from public.organizations) = 1
  and (select count(*) from public.profiles where role = 'admin'::public.app_role) = 1
on conflict (user_id) do nothing;

-- Profiles are provisioned by the invitation acceptance function. Ordinary
-- clients may only change the role column, and RLS still limits that to
-- administrators within the same organization.
drop policy if exists "users can update their profile" on public.profiles;
revoke insert, update, delete on table public.profiles from public, anon, authenticated;
do $migration$
declare
  v_column text;
begin
  for v_column in
    select attribute.attname
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'public.profiles'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
  loop
    execute format(
      'revoke update (%I) on table public.profiles from public, anon, authenticated',
      v_column
    );
  end loop;
end;
$migration$;
grant select on table public.profiles to authenticated;
grant update (role) on table public.profiles to authenticated;

-- Organizations may be read and edited through the existing tenant policies,
-- but cannot be inserted or deleted directly through the Data API.
revoke insert, delete on table public.organizations from public, anon, authenticated;

create or replace function private.is_platform_admin_internal()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from private.platform_admins as platform_admin
    where platform_admin.user_id = auth.uid()
  );
$function$;

revoke all on function private.is_platform_admin_internal() from public, anon, authenticated;
grant execute on function private.is_platform_admin_internal() to authenticated;

create or replace function public.current_user_is_platform_admin()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select private.is_platform_admin_internal();
$function$;

revoke all on function public.current_user_is_platform_admin() from public, anon;
grant execute on function public.current_user_is_platform_admin() to authenticated;

create or replace function private.list_platform_organizations_internal()
returns table (
  id uuid,
  name text,
  cnpj text,
  created_at timestamptz,
  member_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;

  return query
  select organization_row.id,
         organization_row.name,
         organization_row.cnpj,
         organization_row.created_at,
         count(profile.id)::bigint
  from public.organizations as organization_row
  left join public.profiles as profile
    on profile.organization_id = organization_row.id
  group by organization_row.id, organization_row.name, organization_row.cnpj, organization_row.created_at
  order by organization_row.name;
end;
$function$;

revoke all on function private.list_platform_organizations_internal() from public, anon, authenticated;
grant execute on function private.list_platform_organizations_internal() to authenticated;

create or replace function public.list_platform_organizations()
returns table (
  id uuid,
  name text,
  cnpj text,
  created_at timestamptz,
  member_count bigint
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select * from private.list_platform_organizations_internal();
$function$;

revoke all on function public.list_platform_organizations() from public, anon;
grant execute on function public.list_platform_organizations() to authenticated;

create or replace function private.create_organization_with_admin_invitation_internal(
  p_name text,
  p_cnpj text,
  p_admin_email text,
  p_admin_page_paths text[],
  p_token text
)
returns table (organization_id uuid, invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_actor uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_admin_email, '')));
  v_organization_id uuid;
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
begin
  if v_actor is null or not private.is_platform_admin_internal() then
    raise exception 'Acesso negado';
  end if;
  if length(v_name) < 2 or length(v_name) > 150 then
    raise exception 'Informe o nome da empresa (de 2 a 150 caracteres)';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido para o administrador';
  end if;
  if coalesce(array_length(p_admin_page_paths, 1), 0) = 0 then
    raise exception 'Não foi possível configurar as permissões do administrador';
  end if;
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Token de convite inválido';
  end if;
  if exists (
    select 1
    from auth.users as auth_user
    join public.profiles as profile on profile.id = auth_user.id
    where lower(auth_user.email) = v_email
      and profile.organization_id is not null
  ) then
    raise exception 'Este e-mail já pertence a uma organização. Use um e-mail sem vínculo ativo.';
  end if;
  if exists (
    select 1
    from public.organization_invitations as invitation
    where lower(invitation.email) = v_email
      and invitation.accepted_at is null
      and invitation.expires_at > now()
  ) then
    raise exception 'Este e-mail já possui um convite ativo. Aguarde a aceitação ou o vencimento antes de criar outro.';
  end if;

  insert into public.organizations (name, cnpj)
  values (v_name, nullif(trim(coalesce(p_cnpj, '')), ''))
  returning id into v_organization_id;

  insert into public.organization_invitations (
    organization_id, email, role, token_hash, page_paths, expires_at, created_by
  ) values (
    v_organization_id,
    v_email,
    'admin'::public.app_role,
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    p_admin_page_paths,
    v_expires_at,
    v_actor
  ) returning id into v_invitation_id;

  return query select v_organization_id, v_invitation_id, v_expires_at;
end;
$function$;

revoke all on function private.create_organization_with_admin_invitation_internal(text, text, text, text[], text) from public, anon, authenticated;
grant execute on function private.create_organization_with_admin_invitation_internal(text, text, text, text[], text) to authenticated;

create or replace function public.create_organization_with_admin_invitation(
  p_name text,
  p_cnpj text,
  p_admin_email text,
  p_admin_page_paths text[],
  p_token text
)
returns table (organization_id uuid, invitation_id uuid, expires_at timestamptz)
language sql
security invoker
set search_path = pg_catalog
as $function$
  select *
  from private.create_organization_with_admin_invitation_internal(
    p_name, p_cnpj, p_admin_email, p_admin_page_paths, p_token
  );
$function$;

revoke all on function public.create_organization_with_admin_invitation(text, text, text, text[], text) from public, anon;
grant execute on function public.create_organization_with_admin_invitation(text, text, text, text[], text) to authenticated;

-- Accept invitations for users who already have an unassigned profile as well
-- as new users, while keeping the single-organization-per-login invariant.
create or replace function private.accept_organization_invitation_internal(p_token text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.organization_invitations%rowtype;
  v_current_organization_id uuid;
  v_profile_exists boolean;
  v_profile_name text;
begin
  if v_user is null then
    raise exception 'Entre ou crie sua conta antes de aceitar o convite';
  end if;

  select lower(auth_user.email)
    into v_email
  from auth.users as auth_user
  where auth_user.id = v_user;

  select invitation.*
    into v_inv
  from public.organization_invitations as invitation
  where invitation.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and invitation.accepted_at is null
    and invitation.expires_at > now()
  for update;

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
