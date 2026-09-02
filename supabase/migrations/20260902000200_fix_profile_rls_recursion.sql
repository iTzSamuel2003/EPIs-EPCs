create schema if not exists private;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = (select auth.uid())
$$;

revoke all on function private.current_organization_id() from public;
grant execute on function private.current_organization_id() to authenticated;

drop policy if exists "organization members can access organization" on public.organizations;
drop policy if exists "users can read their profile" on public.profiles;
drop policy if exists "users can update their profile" on public.profiles;

create policy "organization members can access organization" on public.organizations
for all to authenticated
using (id = private.current_organization_id())
with check (id = private.current_organization_id());

create policy "users can read their profile" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or organization_id = private.current_organization_id());

create policy "users can update their profile" on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

do $$ declare t text; begin
  for t in select unnest(array['categories','materials','employees','suppliers','material_lots','stock_movements','audit_logs']) loop
    execute format('drop policy if exists "organization members can access" on public.%I', t);
    execute format('create policy "organization members can access" on public.%I for all to authenticated using (organization_id=private.current_organization_id()) with check (organization_id=private.current_organization_id())', t);
  end loop;
end $$;

