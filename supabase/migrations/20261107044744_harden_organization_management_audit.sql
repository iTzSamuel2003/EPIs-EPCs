create index platform_organization_management_audit_actor_created_idx
  on private.platform_organization_management_audit (actor_id, created_at desc);

create policy deny_authenticated_management_session_access
  on private.platform_organization_management_sessions
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create policy deny_authenticated_management_audit_access
  on private.platform_organization_management_audit
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);
