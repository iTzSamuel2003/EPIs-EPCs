create or replace function private.get_tst_employee_directory_internal(p_employee_id uuid default null, p_search text default null)
returns table (
  id uuid,
  registration text,
  full_name text,
  job_title text,
  function_name text,
  function_classification text,
  department text,
  unit text,
  status text,
  shirt_size text,
  pants_size text,
  shoe_size text,
  helmet_size text,
  glove_size text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not private.has_current_organization_role(array['tst']) then
    raise exception 'Acesso restrito ao TST';
  end if;

  return query
  select
    employee.id,
    employee.registration,
    employee.full_name,
    employee.job_title,
    employee.function_name,
    employee.function_classification,
    employee.department,
    employee.unit,
    employee.status::text,
    profile.shirt_size,
    profile.pants_size,
    profile.shoe_size,
    profile.helmet_size,
    profile.glove_size
  from public.employees as employee
  left join public.employee_profiles as profile
    on profile.employee_id = employee.id
    and profile.organization_id = employee.organization_id
  where employee.organization_id = private.current_organization_id()
    and (p_employee_id is null or employee.id = p_employee_id)
    and (nullif(trim(p_search), '') is null or concat_ws(' ', employee.full_name, employee.registration, employee.department, employee.function_name, employee.function_classification) ilike '%' || trim(p_search) || '%')
    and private.can_access_base(employee.base_id)
  order by employee.full_name;
end;
$function$;

create or replace function public.get_tst_employee_directory(p_employee_id uuid default null, p_search text default null)
returns table (
  id uuid,
  registration text,
  full_name text,
  job_title text,
  function_name text,
  function_classification text,
  department text,
  unit text,
  status text,
  shirt_size text,
  pants_size text,
  shoe_size text,
  helmet_size text,
  glove_size text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select * from private.get_tst_employee_directory_internal(p_employee_id, p_search);
$function$;

revoke all on function private.get_tst_employee_directory_internal(uuid, text) from public, anon, authenticated;
revoke all on function public.get_tst_employee_directory(uuid, text) from public, anon;
grant execute on function public.get_tst_employee_directory(uuid, text) to authenticated;
