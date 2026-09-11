-- Organization metadata may be viewed by members but changed only by admins.
drop policy if exists "organization members can access organization" on public.organizations;
drop policy if exists "organization members read organization" on public.organizations;
drop policy if exists "organization admins update organization" on public.organizations;

create policy "organization members read organization"
on public.organizations for select to authenticated
using (id = private.current_organization_id());

create policy "organization admins update organization"
on public.organizations for update to authenticated
using (id = private.current_organization_id() and private.is_current_organization_admin())
with check (id = private.current_organization_id() and private.is_current_organization_admin());

-- Audit records are produced by database triggers and must not be editable
-- through the client Data API.
drop policy if exists "organization admins insert organization data" on public.audit_logs;
drop policy if exists "organization admins update organization data" on public.audit_logs;
drop policy if exists "organization admins delete organization data" on public.audit_logs;
revoke insert, update, delete on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;
