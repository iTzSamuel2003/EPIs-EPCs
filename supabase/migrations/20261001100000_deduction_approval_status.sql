alter table public.return_accountability
  add column if not exists deduction_approval_status text not null default 'pending'
    check (deduction_approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists deduction_reviewed_at timestamptz,
  add column if not exists deduction_reviewed_by uuid references auth.users(id);

alter table public.return_items
  add column if not exists deduction_approval_status text not null default 'pending'
    check (deduction_approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists deduction_reviewed_at timestamptz,
  add column if not exists deduction_reviewed_by uuid references auth.users(id);

update public.return_accountability
set deduction_approval_status = case when deduction_requested then 'pending' else 'rejected' end;

update public.return_items
set deduction_approval_status = case when deduction_requested then 'pending' else 'rejected' end;

create or replace function public.record_return_accountability(
  p_return_id uuid,
  p_incident_type text,
  p_incident_description text,
  p_employee_signature_name text,
  p_deduction_requested boolean,
  p_deduction_amount numeric
) returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_employee uuid;
  v_id uuid;
begin
  select employee_id into v_employee from public.returns where id = p_return_id and organization_id = v_org;
  if v_employee is null then raise exception 'Devolução não encontrada'; end if;
  insert into public.return_accountability (organization_id, return_id, employee_id, incident_type, incident_description, employee_signature_name, signed_at, deduction_requested, deduction_amount, deduction_approval_status, created_by)
  values (v_org, p_return_id, v_employee, coalesce(nullif(p_incident_type, ''), 'normal'), nullif(trim(p_incident_description), ''), nullif(trim(p_employee_signature_name), ''), case when nullif(trim(p_employee_signature_name), '') is not null then now() end, coalesce(p_deduction_requested, false), case when p_deduction_requested then p_deduction_amount else null end, case when coalesce(p_deduction_requested, false) then 'pending' else 'rejected' end, auth.uid())
  on conflict (return_id) do update set incident_type = excluded.incident_type, incident_description = excluded.incident_description, employee_signature_name = excluded.employee_signature_name, signed_at = excluded.signed_at, deduction_requested = excluded.deduction_requested, deduction_amount = excluded.deduction_amount, deduction_approval_status = excluded.deduction_approval_status, deduction_reviewed_at = null, deduction_reviewed_by = null
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) from public;
grant execute on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) to authenticated;
