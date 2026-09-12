drop policy if exists "portal users can upload course documents" on storage.objects;

create or replace function public.submit_employee_portal_course(
  p_registration text,
  p_cpf text,
  p_name text,
  p_provider text,
  p_completed_at date,
  p_expires_at date,
  p_certificate_number text,
  p_certificate_file_path text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_employee public.employees;
  v_id uuid;
  v_path text := nullif(trim(p_certificate_file_path), '');
  v_function_name text;
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  if length(coalesce(p_name, '')) > 200
    or length(coalesce(p_provider, '')) > 200
    or length(coalesce(p_certificate_number, '')) > 100 then
    raise exception 'Dados do curso excedem o tamanho permitido';
  end if;

  select * into v_employee
  from public.employees
  where registration = trim(p_registration)
    and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and status <> 'terminated';
  if v_employee.id is null then
    raise exception 'Matricula ou CPF nao conferem';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Informe o nome do curso';
  end if;

  v_function_name := coalesce(v_employee.function_name, v_employee.job_title, '');
  if not exists (
    select 1
    from public.contract_training_requirements t
    where t.organization_id = v_employee.organization_id
      and t.course_name = trim(p_name)
      and (
        t.function_group = 'Todos os grupos'
        or lower(v_function_name) like '%' || lower(t.function_group) || '%'
        or (t.function_group = 'Poda' and lower(v_function_name) like '%pod%')
        or (t.function_group = 'Operador de Guindauto'
          and (lower(v_function_name) like '%munck%' or lower(v_function_name) like '%guindauto%'))
      )
  ) then
    raise exception 'Curso nao previsto para a funcao do colaborador';
  end if;

  if v_path is not null then
    if v_path !~ '^portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$' then
      raise exception 'Anexo de certificado invalido';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'employee-course-documents' and name = v_path
    ) then
      raise exception 'Anexo de certificado nao encontrado';
    end if;
  end if;

  insert into public.employee_courses (
    employee_id, organization_id, name, provider, completed_at, expires_at,
    certificate_number, certificate_file_path
  ) values (
    v_employee.id, v_employee.organization_id, trim(p_name),
    nullif(trim(p_provider), ''), p_completed_at, p_expires_at,
    nullif(trim(p_certificate_number), ''), v_path
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text) from public, authenticated;
grant execute on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text) to anon;
