create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'user',
  token_hash text not null unique,
  page_paths text[] not null default '{}',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.profile_page_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  page_path text not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, page_path)
);

create index if not exists organization_invitations_org_idx on public.organization_invitations(organization_id, created_at desc);
create index if not exists profile_page_permissions_org_idx on public.profile_page_permissions(organization_id, profile_id);

alter table public.organization_invitations enable row level security;
alter table public.profile_page_permissions enable row level security;

drop policy if exists "organization admins manage invitations" on public.organization_invitations;
create policy "organization admins manage invitations" on public.organization_invitations
  for all to authenticated
  using (organization_id = private.current_organization_id() and private.is_current_organization_admin())
  with check (organization_id = private.current_organization_id() and private.is_current_organization_admin());

drop policy if exists "organization admins manage page permissions" on public.profile_page_permissions;
create policy "organization admins manage page permissions" on public.profile_page_permissions
  for all to authenticated
  using (organization_id = private.current_organization_id() and private.is_current_organization_admin())
  with check (organization_id = private.current_organization_id() and private.is_current_organization_admin());

grant select, insert, update, delete on public.organization_invitations, public.profile_page_permissions to authenticated;

create or replace function public.create_organization_invitation(
  p_email text,
  p_role public.app_role,
  p_page_paths text[],
  p_token text
) returns table(invitation_id uuid, expires_at timestamptz)
language plpgsql security invoker set search_path = public, private as $$
declare v_org uuid := private.current_organization_id(); v_id uuid; v_expires timestamptz := now() + interval '7 days';
begin
  if v_org is null or not private.is_current_organization_admin() then raise exception 'Acesso negado'; end if;
  if nullif(trim(p_email), '') is null or position('@' in p_email) < 2 then raise exception 'Informe um e-mail válido'; end if;
  if length(coalesce(p_token, '')) < 32 then raise exception 'Token de convite inválido'; end if;
  insert into public.organization_invitations(organization_id, email, role, token_hash, page_paths, expires_at, created_by)
  values (v_org, lower(trim(p_email)), coalesce(p_role, 'user'), encode(digest(p_token, 'sha256'), 'hex'), coalesce(p_page_paths, '{}'), v_expires, auth.uid())
  returning id into v_id;
  return query select v_id, v_expires;
end;
$$;

revoke all on function public.create_organization_invitation(text, public.app_role, text[], text) from public, anon;
grant execute on function public.create_organization_invitation(text, public.app_role, text[], text) to authenticated;

create or replace function public.accept_organization_invitation(p_token text, p_full_name text)
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

revoke all on function public.accept_organization_invitation(text, text) from public, anon;
grant execute on function public.accept_organization_invitation(text, text) to authenticated;
