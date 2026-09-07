create or replace function public.get_employee_portal(p_registration text, p_cpf text)
returns table(employee_id uuid, employee_name text, function_name text, organization_name text, shirt_size text, pants_size text, shoe_size text, helmet_size text, glove_size text, uniform_notes text)
language sql security definer set search_path = public
as $$
  select e.id, e.full_name, coalesce(e.function_name, e.job_title, ''), o.name,
    p.shirt_size, p.pants_size, p.shoe_size, p.helmet_size, p.glove_size, p.uniform_notes
  from public.employees e
  join public.organizations o on o.id = e.organization_id
  left join public.employee_profiles p on p.employee_id = e.id
  where e.registration = trim(p_registration)
    and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and e.status <> 'terminated'
  limit 1;
$$;

create or replace function public.submit_employee_portal_measurements(p_registration text, p_cpf text, p_shirt_size text, p_pants_size text, p_shoe_size text, p_helmet_size text, p_glove_size text, p_notes text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_employee public.employees;
begin
  select * into v_employee from public.employees
  where registration = trim(p_registration)
    and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  insert into public.employee_profiles (employee_id, organization_id, shirt_size, pants_size, shoe_size, helmet_size, glove_size, uniform_notes, completed_by_employee, updated_at)
  values (v_employee.id, v_employee.organization_id, nullif(trim(p_shirt_size), ''), nullif(trim(p_pants_size), ''), nullif(trim(p_shoe_size), ''), nullif(trim(p_helmet_size), ''), nullif(trim(p_glove_size), ''), nullif(trim(p_notes), ''), true, now())
  on conflict (employee_id) do update set shirt_size = excluded.shirt_size, pants_size = excluded.pants_size, shoe_size = excluded.shoe_size, helmet_size = excluded.helmet_size, glove_size = excluded.glove_size, uniform_notes = excluded.uniform_notes, completed_by_employee = true, updated_at = now();
  return true;
end;
$$;

revoke all on function public.get_employee_portal(text, text) from public, authenticated;
revoke all on function public.submit_employee_portal_measurements(text, text, text, text, text, text, text, text) from public, authenticated;
grant execute on function public.get_employee_portal(text, text) to anon;
grant execute on function public.submit_employee_portal_measurements(text, text, text, text, text, text, text, text) to anon;
