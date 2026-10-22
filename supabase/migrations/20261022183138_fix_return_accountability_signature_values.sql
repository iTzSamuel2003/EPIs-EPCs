-- Recupera ocorrências registradas sem a ficha de responsabilidade por uma falha
-- no INSERT da versão anterior da função.
insert into public.return_accountability (
  organization_id,
  return_id,
  employee_id,
  incident_type,
  incident_description,
  responsible_name,
  employee_signature_name,
  signed_at,
  deduction_requested,
  deduction_amount,
  deduction_approval_status,
  created_by
)
select
  r.organization_id,
  r.id,
  r.employee_id,
  case when count(distinct i.incident_type) = 1 then min(i.incident_type) else 'other' end,
  string_agg(
    distinct concat_ws(': ', nullif(i.incident_type, ''), nullif(trim(i.incident_description), '')),
    '; '
  ),
  nullif(trim(p.full_name), ''),
  r.term_signer_name,
  r.term_signed_at,
  coalesce(bool_or(i.deduction_requested), false),
  sum(i.deduction_amount) filter (where i.deduction_requested),
  case when coalesce(bool_or(i.deduction_requested), false) then 'pending' else 'rejected' end,
  r.responsible_id
from public.returns r
join public.return_items i on i.return_id = r.id and i.organization_id = r.organization_id
left join public.profiles p on p.id = r.responsible_id and p.organization_id = r.organization_id
where i.incident_type <> 'normal'
  and not exists (
    select 1 from public.return_accountability a
    where a.return_id = r.id and a.organization_id = r.organization_id
  )
group by r.organization_id, r.id, r.employee_id, r.responsible_id, r.term_signer_name, r.term_signed_at, p.full_name
on conflict (return_id) do nothing;

create or replace function public.record_return_accountability(
  p_return_id uuid,
  p_incident_type text,
  p_incident_description text,
  p_employee_signature_name text,
  p_deduction_requested boolean,
  p_deduction_amount numeric
) returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_org uuid := private.current_organization_id();
  v_employee uuid;
  v_id uuid;
begin
  select employee_id into v_employee
  from public.returns
  where id = p_return_id and organization_id = v_org;
  if v_employee is null then raise exception 'Devolução não encontrada'; end if;

  insert into public.return_accountability (
    organization_id, return_id, employee_id, incident_type, incident_description,
    responsible_name, employee_signature_name, signed_at, deduction_requested,
    deduction_amount, deduction_approval_status, created_by
  ) values (
    v_org, p_return_id, v_employee, coalesce(nullif(p_incident_type, ''), 'normal'),
    nullif(trim(p_incident_description), ''), nullif(trim(p_employee_signature_name), ''),
    null, null, coalesce(p_deduction_requested, false),
    case when p_deduction_requested then p_deduction_amount else null end,
    case when coalesce(p_deduction_requested, false) then 'pending' else 'rejected' end,
    auth.uid()
  )
  on conflict (return_id) do update set
    incident_type = excluded.incident_type,
    incident_description = excluded.incident_description,
    responsible_name = excluded.responsible_name,
    deduction_requested = excluded.deduction_requested,
    deduction_amount = excluded.deduction_amount,
    deduction_approval_status = excluded.deduction_approval_status,
    deduction_reviewed_at = null,
    deduction_reviewed_by = null
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) from public;
grant execute on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) to authenticated;
