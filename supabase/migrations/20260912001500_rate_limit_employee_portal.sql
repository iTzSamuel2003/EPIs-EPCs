create table if not exists private.employee_portal_rate_limits (
  access_key text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  updated_at timestamptz not null default now()
);

revoke all on private.employee_portal_rate_limits from public, anon, authenticated;

create or replace function private.enforce_employee_portal_rate_limit(
  p_registration text,
  p_cpf text
)
returns void
language plpgsql
security definer
set search_path = private
as $$
declare
  v_key text;
  v_attempts integer;
begin
  if nullif(trim(p_registration), '') is null or nullif(trim(p_cpf), '') is null then
    raise exception 'Informe matrícula e CPF';
  end if;

  v_key := md5(lower(trim(p_registration)) || '|' || regexp_replace(p_cpf, '\D', '', 'g'));

  insert into private.employee_portal_rate_limits (access_key, window_started_at, attempt_count, updated_at)
  values (v_key, now(), 1, now())
  on conflict (access_key) do update set
    window_started_at = case
      when private.employee_portal_rate_limits.window_started_at <= now() - interval '15 minutes' then now()
      else private.employee_portal_rate_limits.window_started_at
    end,
    attempt_count = case
      when private.employee_portal_rate_limits.window_started_at <= now() - interval '15 minutes' then 1
      else private.employee_portal_rate_limits.attempt_count + 1
    end,
    updated_at = now()
  returning attempt_count into v_attempts;

  if v_attempts > 20 then
    raise exception 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  end if;
end;
$$;

revoke all on function private.enforce_employee_portal_rate_limit(text, text) from public, anon, authenticated;
grant execute on function private.enforce_employee_portal_rate_limit(text, text) to anon;

create or replace function public.get_employee_portal_data_v3(p_registration text, p_cpf text)
returns table(employee_id uuid, employee_name text, function_name text, organization_name text, shirt_size text, pants_size text, shoe_size text, helmet_size text, glove_size text, uniform_notes text, courses jsonb, materials jsonb, requests jsonb, requirements jsonb)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  if length(trim(p_registration)) > 100 or length(trim(p_cpf)) > 64 then
    raise exception 'Dados de acesso inválidos';
  end if;

  return query
  select e.id, e.full_name, coalesce(e.function_name, e.job_title, ''), o.name,
    p.shirt_size, p.pants_size, p.shoe_size, p.helmet_size, p.glove_size, p.uniform_notes,
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'provider', c.provider, 'completed_at', c.completed_at, 'expires_at', c.expires_at, 'certificate_number', c.certificate_number, 'has_attachment', c.certificate_file_path is not null) order by c.expires_at nulls last) from public.employee_courses c where c.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('delivery_item_id', x.delivery_item_id, 'material_name', x.material_name, 'lot_number', x.lot_number, 'quantity', x.quantity, 'unit', x.unit, 'last_delivery', x.last_delivery) order by x.last_delivery desc, x.material_name) from (select di.id delivery_item_id, m.name material_name, ml.lot_number, m.unit, di.quantity - coalesce((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id), 0) quantity, d.delivered_at last_delivery from public.delivery_items di join public.deliveries d on d.id = di.delivery_id join public.materials m on m.id = di.material_id join public.material_lots ml on ml.id = di.lot_id where d.employee_id = e.id and di.quantity - coalesce((select sum(ri.quantity) from public.return_items ri where ri.delivery_item_id = di.id), 0) > 0) x), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'request_type', r.request_type, 'material_name', r.material_name_snapshot, 'description', r.description, 'status', r.status, 'has_attachment', r.attachment_path is not null, 'created_at', r.created_at, 'updated_at', r.updated_at) order by r.created_at desc) from public.employee_portal_requests r where r.employee_id = e.id), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'function_group', t.function_group, 'course_name', t.course_name, 'source_annex', t.source_annex, 'mandatory', t.mandatory, 'validity_months', t.validity_months, 'notes', t.notes) order by t.function_group, t.course_name) from public.contract_training_requirements t where t.organization_id = e.organization_id), '[]'::jsonb)
  from public.employees e join public.organizations o on o.id = e.organization_id left join public.employee_profiles p on p.employee_id = e.id
  where e.registration = trim(p_registration) and regexp_replace(e.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and e.status <> 'terminated'
  limit 1;
end;
$$;

create or replace function public.submit_employee_portal_measurements(p_registration text, p_cpf text, p_shirt_size text, p_pants_size text, p_shoe_size text, p_helmet_size text, p_glove_size text, p_notes text)
returns boolean
language plpgsql security definer set search_path = public, private
as $$
declare v_employee public.employees;
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  if length(coalesce(p_shirt_size, '')) > 50 or length(coalesce(p_pants_size, '')) > 50 or length(coalesce(p_shoe_size, '')) > 50 or length(coalesce(p_helmet_size, '')) > 50 or length(coalesce(p_glove_size, '')) > 50 or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Uma das medidas excede o tamanho permitido';
  end if;
  select * into v_employee from public.employees where registration = trim(p_registration) and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  insert into public.employee_profiles (employee_id, organization_id, shirt_size, pants_size, shoe_size, helmet_size, glove_size, uniform_notes, completed_by_employee, updated_at)
  values (v_employee.id, v_employee.organization_id, nullif(trim(p_shirt_size), ''), nullif(trim(p_pants_size), ''), nullif(trim(p_shoe_size), ''), nullif(trim(p_helmet_size), ''), nullif(trim(p_glove_size), ''), nullif(trim(p_notes), ''), true, now())
  on conflict (employee_id) do update set shirt_size = excluded.shirt_size, pants_size = excluded.pants_size, shoe_size = excluded.shoe_size, helmet_size = excluded.helmet_size, glove_size = excluded.glove_size, uniform_notes = excluded.uniform_notes, completed_by_employee = true, updated_at = now();
  return true;
end;
$$;

create or replace function public.submit_employee_portal_course(p_registration text, p_cpf text, p_name text, p_provider text, p_completed_at date, p_expires_at date, p_certificate_number text, p_certificate_file_path text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_employee public.employees; v_id uuid; v_path text := nullif(trim(p_certificate_file_path), '');
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  if length(coalesce(p_name, '')) > 200 or length(coalesce(p_provider, '')) > 200 or length(coalesce(p_certificate_number, '')) > 100 then raise exception 'Dados do curso excedem o tamanho permitido'; end if;
  select * into v_employee from public.employees where registration = trim(p_registration) and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Informe o nome do curso'; end if;
  if v_path is not null and v_path !~ '^portal/[0-9a-f-]{36}-[A-Za-z0-9._-]+$' then raise exception 'Anexo de certificado inválido'; end if;
  insert into public.employee_courses (employee_id, organization_id, name, provider, completed_at, expires_at, certificate_number, certificate_file_path)
  values (v_employee.id, v_employee.organization_id, trim(p_name), nullif(trim(p_provider), ''), p_completed_at, p_expires_at, nullif(trim(p_certificate_number), ''), v_path) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_employee_portal_request(p_registration text, p_cpf text, p_request_type text, p_description text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v_employee public.employees; v_id uuid;
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);
  if length(coalesce(p_description, '')) > 2000 then raise exception 'A descrição excede o tamanho permitido'; end if;
  select * into v_employee from public.employees where registration = trim(p_registration) and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g') and status <> 'terminated';
  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if p_request_type not in ('replacement', 'return', 'new_material', 'course', 'other') then raise exception 'Tipo de solicitação inválido'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Descreva a solicitação'; end if;
  insert into public.employee_portal_requests (organization_id, employee_id, request_type, description) values (v_employee.organization_id, v_employee.id, p_request_type, trim(p_description)) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.get_employee_portal_data_v3(text, text) from public, authenticated;
grant execute on function public.get_employee_portal_data_v3(text, text) to anon;
revoke all on function public.submit_employee_portal_measurements(text, text, text, text, text, text, text, text) from public, authenticated;
grant execute on function public.submit_employee_portal_measurements(text, text, text, text, text, text, text, text) to anon;
revoke all on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text) from public, authenticated;
grant execute on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text) to anon;
revoke all on function public.submit_employee_portal_request(text, text, text, text) from public, authenticated;
grant execute on function public.submit_employee_portal_request(text, text, text, text) to anon;
