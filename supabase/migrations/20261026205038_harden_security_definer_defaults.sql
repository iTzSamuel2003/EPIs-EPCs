-- Fail closed for future RPCs created by postgres in the exposed API schema.
-- New public functions must receive an explicit EXECUTE grant for each caller role.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

-- Pin privileged routines to the catalog and schema-qualified objects only.
alter function private.audit_row_change() set search_path = '';
alter function private.create_employee_material_request(text, text, uuid, text) set search_path = '';
alter function private.current_organization_id() set search_path = '';
alter function private.has_current_organization_role(text[]) set search_path = '';
alter function private.is_current_organization_admin() set search_path = '';
alter function public.audit_row_change() set search_path = '';
alter function public.claim_employee_request_attachment_cleanup(integer) set search_path = '';
alter function public.create_employee_material_request(text, text, uuid, text) set search_path = '';
alter function public.get_employee_portal(text, text) set search_path = '';
alter function public.get_employee_portal_data(text, text) set search_path = '';
alter function public.get_employee_portal_data_v2(text, text) set search_path = '';
alter function public.submit_employee_portal_course(text, text, text, text, date, date, text)
  set search_path = '';

-- The rate-limit helper is called by SECURITY DEFINER portal entry points as postgres.
-- Application roles do not need to invoke it directly.
revoke all on function private.enforce_employee_portal_rate_limit(text, text)
  from public, anon, authenticated, service_role;
