-- Public portal requests now pass through Edge Functions. The gateway IP and
-- credential fingerprints are HMACs created with the server-only service key.
create or replace function private.enforce_employee_portal_rate_limit(
  p_registration text,
  p_cpf text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_ip_key text;
  v_registration_key text;
  v_credential_key text;
  v_attempts integer;
  v_counter record;
begin
  if nullif(trim(p_registration), '') is null or nullif(trim(p_cpf), '') is null then
    raise exception 'Informe matrícula e CPF';
  end if;
  if length(trim(p_registration)) > 100 or length(trim(p_cpf)) > 64 then
    raise exception 'Dados de acesso inválidos';
  end if;

  v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip_key := lower(coalesce(v_headers ->> 'x-employee-portal-ip', ''));
  v_registration_key := lower(coalesce(v_headers ->> 'x-employee-portal-registration', ''));
  v_credential_key := lower(coalesce(v_headers ->> 'x-employee-portal-credential', ''));
  if v_ip_key !~ '^[a-f0-9]{64}$'
    or v_registration_key !~ '^[a-f0-9]{64}$'
    or v_credential_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '42501', message = 'EMPLOYEE_PORTAL_REQUEST_CONTEXT_MISSING';
  end if;

  delete from private.employee_portal_rate_limits
  where updated_at < now() - interval '1 day';

  for v_counter in
    select * from (values
      ('edge:registration:' || v_registration_key, 30),
      ('edge:credential:' || v_credential_key, 20)
    ) as limits(access_key, attempt_limit)
  loop
    insert into private.employee_portal_rate_limits (access_key, window_started_at, attempt_count, updated_at)
    values (v_counter.access_key, now(), 1, now())
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

    if v_attempts > v_counter.attempt_limit then
      raise exception using errcode = 'P0001', message = 'PORTAL_RATE_LIMIT_EXCEEDED';
    end if;
  end loop;
end;
$$;

revoke all on function private.enforce_employee_portal_rate_limit(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_employee_portal_ip_rate_limit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_ip_key text;
  v_attempts integer;
begin
  v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip_key := lower(coalesce(v_headers ->> 'x-employee-portal-ip', ''));
  if v_ip_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '42501', message = 'EMPLOYEE_PORTAL_REQUEST_CONTEXT_MISSING';
  end if;

  delete from private.employee_portal_rate_limits
  where updated_at < now() - interval '1 day';

  insert into private.employee_portal_rate_limits (access_key, window_started_at, attempt_count, updated_at)
  values ('edge:ip:' || v_ip_key, now(), 1, now())
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

  if v_attempts > 300 then
    raise exception using errcode = 'P0001', message = 'PORTAL_RATE_LIMIT_EXCEEDED';
  end if;
end;
$$;

revoke all on function public.enforce_employee_portal_ip_rate_limit()
  from public, anon, authenticated, service_role;
grant execute on function public.enforce_employee_portal_ip_rate_limit() to service_role;

-- Service-role Edge Functions are the only public-portal entry points. Token
-- based measurement links remain separately available to anon and are unchanged.
revoke all on function public.get_employee_portal_data_v3(text, text)
  from public, anon, authenticated;
grant execute on function public.get_employee_portal_data_v3(text, text) to service_role;

revoke all on function public.submit_employee_portal_measurements(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_employee_portal_measurements(text, text, text, text, text, text, text, text)
  to service_role;

revoke all on function public.submit_employee_portal_request(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_employee_portal_request(text, text, text, text)
  to service_role;

revoke all on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_employee_portal_course(text, text, text, text, date, date, text, text)
  to service_role;

-- Keep the existing course-approval, employee ownership, and attachment checks;
-- add the same shared IP/credential limiter to the replacement-request path.
create or replace function private.create_employee_material_request(
  p_registration text,
  p_cpf text,
  p_delivery_item_id uuid,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_delivery_item public.delivery_items;
  v_material public.materials;
  v_lot public.material_lots;
  v_returned integer;
  v_remaining integer;
  v_request_id uuid;
begin
  perform private.enforce_employee_portal_rate_limit(p_registration, p_cpf);

  select * into v_employee
  from public.employees
  where registration = trim(p_registration)
    and regexp_replace(cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and status <> 'terminated'
  limit 1;

  if v_employee.id is null then raise exception 'Matrícula ou CPF não conferem'; end if;
  if p_delivery_item_id is null then raise exception 'Selecione o material'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Descreva a solicitação'; end if;

  select di.*
  into v_delivery_item
  from public.delivery_items di
  join public.deliveries d on d.id = di.delivery_id
  where di.id = p_delivery_item_id
    and di.organization_id = v_employee.organization_id
    and d.organization_id = v_employee.organization_id
    and d.employee_id = v_employee.id
  for update of di;

  if v_delivery_item.id is null then raise exception 'Material entregue não encontrado'; end if;

  select * into v_material from public.materials where id = v_delivery_item.material_id;
  select * into v_lot from public.material_lots where id = v_delivery_item.lot_id;
  select coalesce(sum(quantity), 0) into v_returned
  from public.return_items
  where delivery_item_id = p_delivery_item_id;
  v_remaining := v_delivery_item.quantity - v_returned;
  if v_remaining <= 0 then raise exception 'Material já foi totalmente devolvido'; end if;

  insert into public.employee_portal_requests (
    organization_id, employee_id, request_type, description,
    delivery_item_id, requested_quantity, material_name_snapshot, lot_number_snapshot
  ) values (
    v_employee.organization_id, v_employee.id, 'replacement', trim(p_description),
    p_delivery_item_id, v_remaining, v_material.name, v_lot.lot_number
  ) returning id into v_request_id;

  return v_request_id;
exception
  when unique_violation then
    raise exception 'Já existe uma solicitação aberta para este material';
end;
$$;

revoke all on function private.create_employee_material_request(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function private.create_employee_material_request(text, text, uuid, text)
  to service_role;

-- The p_signed_at/name/CPF parameters remain for API compatibility with old
-- clients, but the database records its own timestamp and reads employee
-- identity from the tenant-scoped delivery/return row.
create or replace function public.record_hr_delivery_term_signature(
  p_delivery_id uuid,
  p_term_file_path text,
  p_signed_at timestamptz,
  p_signature_method text,
  p_signer_name text,
  p_signer_cpf text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.current_organization_id();
  v_employee_name text;
  v_employee_cpf text;
  v_recorded_at timestamptz;
begin
  if auth.uid() is null or v_organization_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Access restricted to HR';
  end if;
  if p_delivery_id is null or p_signature_method not in ('assisted', 'physical_upload')
    or p_signature_method is null or p_term_file_path is null
    or left(p_term_file_path, length(v_organization_id::text || '/' || p_delivery_id::text || '/'))
      <> (v_organization_id::text || '/' || p_delivery_id::text || '/') then
    raise exception 'Invalid delivery signature data';
  end if;

  select e.full_name, regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g')
  into v_employee_name, v_employee_cpf
  from public.deliveries d
  join public.employees e on e.id = d.employee_id and e.organization_id = d.organization_id
  where d.id = p_delivery_id and d.organization_id = v_organization_id;
  if not found or nullif(trim(v_employee_name), '') is null or coalesce(length(v_employee_cpf), 0) <> 11 then
    raise exception 'Delivery employee not found or has incomplete identity data';
  end if;

  v_recorded_at := clock_timestamp();
  update public.deliveries d
  set term_file_path = p_term_file_path,
      term_uploaded_at = v_recorded_at,
      term_uploaded_by = auth.uid(),
      term_signature_method = p_signature_method,
      term_signed_at = v_recorded_at,
      term_signer_name = trim(v_employee_name),
      term_signer_cpf = v_employee_cpf
  where d.id = p_delivery_id and d.organization_id = v_organization_id
    and d.term_signed_at is null;
  if not found then raise exception 'Delivery not found or already signed'; end if;
end;
$$;

revoke all on function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text)
  from public, anon, service_role;
grant execute on function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text)
  to authenticated;

create or replace function public.record_hr_return_term_signature(
  p_return_id uuid,
  p_term_file_path text,
  p_signed_at timestamptz,
  p_signature_method text,
  p_signer_name text,
  p_signer_cpf text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.current_organization_id();
  v_employee_name text;
  v_employee_cpf text;
  v_recorded_at timestamptz;
begin
  if auth.uid() is null or v_organization_id is null
    or not private.has_current_organization_role(array['admin', 'rh'])
    or not private.current_user_can_access_page('/employees') then
    raise exception 'Access restricted to HR';
  end if;
  if p_return_id is null or p_signature_method not in ('assisted', 'physical_upload')
    or p_signature_method is null or p_term_file_path is null
    or left(p_term_file_path, length(v_organization_id::text || '/' || p_return_id::text || '/'))
      <> (v_organization_id::text || '/' || p_return_id::text || '/') then
    raise exception 'Invalid return signature data';
  end if;

  select e.full_name, regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g')
  into v_employee_name, v_employee_cpf
  from public.returns r
  join public.employees e on e.id = r.employee_id and e.organization_id = r.organization_id
  where r.id = p_return_id and r.organization_id = v_organization_id;
  if not found or nullif(trim(v_employee_name), '') is null or coalesce(length(v_employee_cpf), 0) <> 11 then
    raise exception 'Return employee not found or has incomplete identity data';
  end if;

  v_recorded_at := clock_timestamp();
  update public.returns r
  set term_file_path = p_term_file_path,
      term_uploaded_at = v_recorded_at,
      term_uploaded_by = auth.uid(),
      term_signature_method = p_signature_method,
      term_signed_at = v_recorded_at,
      term_signer_name = trim(v_employee_name),
      term_signer_cpf = v_employee_cpf
  where r.id = p_return_id and r.organization_id = v_organization_id
    and r.term_signed_at is null;
  if not found then raise exception 'Return not found or already signed'; end if;
end;
$$;

revoke all on function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text)
  from public, anon, service_role;
grant execute on function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text)
  to authenticated;

comment on function public.record_hr_delivery_term_signature(uuid, text, timestamptz, text, text, text)
  is 'HR records a delivery term; timestamp and signer identity are derived by the database, not trusted from client parameters.';
comment on function public.record_hr_return_term_signature(uuid, text, timestamptz, text, text, text)
  is 'HR records a return term; timestamp and signer identity are derived by the database, not trusted from client parameters.';
