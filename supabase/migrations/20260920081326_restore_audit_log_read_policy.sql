-- Restore the read policy removed by the organization write hardening pass.
-- Audit rows remain immutable from the client: only SELECT is granted here.
drop policy if exists "organization members read audit logs" on public.audit_logs;

create policy "organization members read audit logs"
on public.audit_logs
for select
to authenticated
using (organization_id = private.current_organization_id());

grant select on public.audit_logs to authenticated;
