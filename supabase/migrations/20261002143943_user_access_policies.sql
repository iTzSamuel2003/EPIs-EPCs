create table if not exists public.organization_role_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.app_role not null check (role in ('rh', 'tst', 'user')),
  page_paths text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (organization_id, role)
);

create table if not exists public.profile_access_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  page_paths text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (profile_id)
);

alter table public.organization_role_access enable row level security;
alter table public.profile_access_overrides enable row level security;

create policy "organization members read role access"
  on public.organization_role_access for select to authenticated
  using (organization_id = private.current_organization_id());
create policy "organization admins manage role access"
  on public.organization_role_access for all to authenticated
  using (organization_id = private.current_organization_id() and private.is_current_organization_admin())
  with check (organization_id = private.current_organization_id() and private.is_current_organization_admin());

create policy "users read own access override"
  on public.profile_access_overrides for select to authenticated
  using (profile_id = (select auth.uid()) or (organization_id = private.current_organization_id() and private.is_current_organization_admin()));
create policy "organization admins manage profile access overrides"
  on public.profile_access_overrides for all to authenticated
  using (organization_id = private.current_organization_id() and private.is_current_organization_admin())
  with check (organization_id = private.current_organization_id() and private.is_current_organization_admin());

grant select, insert, update, delete on public.organization_role_access, public.profile_access_overrides to authenticated;

insert into public.profile_access_overrides(organization_id, profile_id, page_paths)
select permissions.organization_id, permissions.profile_id, array_agg(permissions.page_path order by permissions.page_path)
from public.profile_page_permissions as permissions
group by permissions.organization_id, permissions.profile_id
on conflict (profile_id) do nothing;

create or replace function private.accept_organization_invitation_internal(p_token text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_user uuid := auth.uid(); v_inv public.organization_invitations%rowtype; v_profile uuid; v_email text;
begin
  if v_user is null then raise exception 'Entre ou crie sua conta antes de aceitar o convite'; end if;
  select email into v_email from auth.users where id = v_user;
  select * into v_inv from public.organization_invitations where token_hash = encode(digest(p_token, 'sha256'), 'hex') and accepted_at is null and expires_at > now() limit 1;
  if v_inv.id is null then raise exception 'Convite inválido ou expirado'; end if;
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then raise exception 'Este convite foi criado para outro e-mail'; end if;
  if exists (select 1 from public.profiles where id = v_user and organization_id is not null) then raise exception 'Este usuário já pertence a uma organização'; end if;
  insert into public.profiles(id, organization_id, full_name, role) values (v_user, v_inv.organization_id, coalesce(nullif(trim(p_full_name), ''), split_part(v_inv.email, '@', 1)), v_inv.role)
  returning id into v_profile;
  insert into public.profile_access_overrides(organization_id, profile_id, page_paths)
  values (v_inv.organization_id, v_profile, coalesce(v_inv.page_paths, '{}'));
  update public.organization_invitations set accepted_at = now() where id = v_inv.id;
  return v_profile;
end;
$$;

revoke all on function private.accept_organization_invitation_internal(text, text) from public, anon;
grant execute on function private.accept_organization_invitation_internal(text, text) to authenticated;
