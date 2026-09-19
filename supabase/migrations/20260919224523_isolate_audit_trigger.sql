create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (
    coalesce(new.organization_id, old.organization_id),
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(
      nullif(to_jsonb(new)->>'id', '')::uuid,
      nullif(to_jsonb(old)->>'id', '')::uuid,
      nullif(to_jsonb(new)->>'employee_id', '')::uuid,
      nullif(to_jsonb(old)->>'employee_id', '')::uuid
    ),
    to_jsonb(old),
    to_jsonb(new)
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_row_change() from public;
grant execute on function private.audit_row_change() to authenticated;

drop trigger if exists employees_audit on public.employees;
create trigger employees_audit after insert or update or delete on public.employees for each row execute function private.audit_row_change();
drop trigger if exists materials_audit on public.materials;
create trigger materials_audit after insert or update or delete on public.materials for each row execute function private.audit_row_change();
drop trigger if exists material_lots_audit on public.material_lots;
create trigger material_lots_audit after insert or update or delete on public.material_lots for each row execute function private.audit_row_change();
drop trigger if exists return_accountability_audit on public.return_accountability;
create trigger return_accountability_audit after insert or update or delete on public.return_accountability for each row execute function private.audit_row_change();

revoke all on function public.audit_row_change() from public;
revoke all on function public.audit_row_change() from authenticated;
