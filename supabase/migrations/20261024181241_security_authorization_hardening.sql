-- Keep bearer measurement tokens private to authorized employee administrators.
drop policy if exists "organization members manage measurement requests"
  on public.employee_measurement_requests;
drop policy if exists "organization members read organization data"
  on public.employee_measurement_requests;
drop policy if exists "rh manages operational data"
  on public.employee_measurement_requests;

create policy "employee admins manage measurement requests"
  on public.employee_measurement_requests for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employees')
  );

-- Page permissions must also constrain PostgREST reads, not only the client UI.
drop policy if exists "organization members can view term signature links"
  on public.term_signature_links;
drop policy if exists "organization members read organization data"
  on public.term_signature_links;
create policy "authorized pages can view term signature links"
  on public.term_signature_links for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and case
      when deduction_case_id is not null or refusal_witness_id is not null
        then private.current_user_can_access_page('/discounts')
      when delivery_id is not null or pending_delivery_id is not null
        then private.current_user_can_access_page('/deliveries')
      when return_id is not null
        then private.current_user_can_access_page('/returns')
      else false
    end
  );

drop policy if exists "organization members can view pending deliveries"
  on public.pending_deliveries;
drop policy if exists "organization members read organization data"
  on public.pending_deliveries;
create policy "delivery page can view pending deliveries"
  on public.pending_deliveries for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and (
      private.current_user_can_access_page('/deliveries')
      or (status = 'completed' and private.current_user_can_access_page('/employees'))
    )
  );

-- Return records are also read from employee history and the discounts queue.
-- Writes remain restricted to users with the Returns page permission.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['returns', 'return_items', 'return_accountability'] loop
    execute format('drop policy if exists %I on public.%I', 'organization members read organization data', table_name);
    execute format('drop policy if exists %I on public.%I', 'rh manages operational data', table_name);
    execute format('drop policy if exists %I on public.%I', 'organization members can access returns', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = private.current_organization_id() and (private.current_user_can_access_page(''/returns'') or private.current_user_can_access_page(''/employees'') or private.current_user_can_access_page(''/discounts'')))', 'authorized pages can view return records', table_name);
    execute format('create policy %I on public.%I for all to authenticated using (organization_id = private.current_organization_id() and private.current_user_can_access_page(''/returns'')) with check (organization_id = private.current_organization_id() and private.current_user_can_access_page(''/returns''))', 'returns page can manage return records', table_name);
  end loop;
end;
$$;

-- Public RPC entry points enforce the same page permission as the UI.
alter function public.register_return(uuid, text, date, jsonb, text) set schema private;
alter function private.register_return(uuid, text, date, jsonb, text) rename to register_return_internal;
revoke all on function private.register_return_internal(uuid, text, date, jsonb, text) from public, anon, authenticated;

create function public.register_return(
  p_employee_id uuid,
  p_reason text,
  p_returned_at date,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.current_user_can_access_page('/returns') then
    raise exception 'Seu perfil não tem acesso à página de devoluções';
  end if;
  return private.register_return_internal(p_employee_id, p_reason, p_returned_at, p_items, p_notes);
end;
$$;
revoke all on function public.register_return(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.register_return(uuid, text, date, jsonb, text) to authenticated;

alter function public.record_return_accountability(uuid, text, text, text, boolean, numeric) set schema private;
alter function private.record_return_accountability(uuid, text, text, text, boolean, numeric) rename to record_return_accountability_internal;
revoke all on function private.record_return_accountability_internal(uuid, text, text, text, boolean, numeric) from public, anon, authenticated;

create function public.record_return_accountability(
  p_return_id uuid,
  p_incident_type text,
  p_incident_description text,
  p_employee_signature_name text,
  p_deduction_requested boolean,
  p_deduction_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.current_user_can_access_page('/returns') then
    raise exception 'Seu perfil não tem acesso à página de devoluções';
  end if;
  return private.record_return_accountability_internal(
    p_return_id,
    p_incident_type,
    p_incident_description,
    p_employee_signature_name,
    p_deduction_requested,
    p_deduction_amount
  );
end;
$$;
revoke all on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) from public, anon;
grant execute on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) to authenticated;

-- The prior limit was keyed by registration+CPF, so rotating CPF values avoided
-- the counter. Keep the stricter pair limit and add a broader per-registration cap.
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
  v_limit integer;
  v_attempts integer;
begin
  if nullif(trim(p_registration), '') is null or nullif(trim(p_cpf), '') is null then
    raise exception 'Informe matrícula e CPF';
  end if;
  if length(trim(p_registration)) > 100 or length(trim(p_cpf)) > 64 then
    raise exception 'Dados de acesso inválidos';
  end if;

  delete from private.employee_portal_rate_limits
  where updated_at < now() - interval '1 day';

  for v_key, v_limit in
    select bucket.access_key, bucket.max_attempts
    from (values
      (md5('pair|' || lower(trim(p_registration)) || '|' || regexp_replace(p_cpf, '\D', '', 'g')), 20),
      (md5('registration|' || lower(trim(p_registration))), 100)
    ) as bucket(access_key, max_attempts)
  loop
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

    if v_attempts > v_limit then
      raise exception 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    end if;
  end loop;
end;
$$;
revoke all on function private.enforce_employee_portal_rate_limit(text, text) from public, anon, authenticated;
grant execute on function private.enforce_employee_portal_rate_limit(text, text) to anon;

-- Signed documents are immutable; application uploads already use unique paths and upsert=false.
drop policy if exists "organization members can update delivery terms" on storage.objects;

-- A tenant prefix alone is not enough to authorize access to sensitive PDFs.
drop policy if exists "organization members can read delivery terms" on storage.objects;
create policy "authorized pages can read delivery terms"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-terms'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and (
      exists (
        select 1 from public.deliveries d
        where d.id::text = (storage.foldername(name))[2]
          and d.organization_id = private.current_organization_id()
          and (private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/employees'))
      )
      or exists (
        select 1 from public.pending_deliveries pd
        where pd.id::text = (storage.foldername(name))[2]
          and pd.organization_id = private.current_organization_id()
          and (
            private.current_user_can_access_page('/deliveries')
            or (pd.status = 'completed' and private.current_user_can_access_page('/employees'))
          )
      )
      or exists (
        select 1 from public.returns r
        where r.id::text = (storage.foldername(name))[2]
          and r.organization_id = private.current_organization_id()
          and (private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees'))
      )
      or exists (
        select 1 from public.return_deduction_cases c
        where c.id::text = (storage.foldername(name))[2]
          and c.organization_id = private.current_organization_id()
          and private.current_user_can_access_page('/discounts')
      )
      or exists (
        select 1 from public.return_deduction_refusal_records rr
        where rr.id::text = (storage.foldername(name))[2]
          and rr.organization_id = private.current_organization_id()
          and private.current_user_can_access_page('/discounts')
      )
    )
  );

-- Invoice PDFs should only be readable through pages that manage stock entries.
drop policy if exists "organization members can read invoice attachments" on storage.objects;
create policy "authorized pages can read invoice attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'invoice-attachments'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and exists (
      select 1 from public.material_lots lot
      where lot.invoice_file_path = name
        and lot.organization_id = private.current_organization_id()
        and (
          private.current_user_can_access_page('/entries')
          or private.current_user_can_access_page('/stock')
          or private.current_user_can_access_page('/reports')
        )
    )
  );

drop policy if exists "organization members can upload invoice attachments" on storage.objects;
create policy "entries page can upload invoice attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'invoice-attachments'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and private.current_user_can_access_page('/entries')
  );

drop policy if exists "organization members can update invoice attachments" on storage.objects;

-- Photo metadata and objects follow the permissions of their delivery/return.
drop policy if exists "organization members can access transaction attachments"
  on public.transaction_attachments;
drop policy if exists "organization members read organization data"
  on public.transaction_attachments;
drop policy if exists "rh manages operational data"
  on public.transaction_attachments;
create policy "authorized pages can read transaction attachments"
  on public.transaction_attachments for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and (
      (attachment_type = 'delivery' and (private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/employees')))
      or (attachment_type = 'return' and (private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees')))
    )
  );
create policy "authorized pages can add transaction attachments"
  on public.transaction_attachments for insert to authenticated
  with check (
    organization_id = private.current_organization_id()
    and (
      (attachment_type = 'delivery' and delivery_id is not null and return_id is null
        and private.current_user_can_access_page('/deliveries')
        and exists (select 1 from public.deliveries d where d.id = delivery_id and d.organization_id = private.current_organization_id()))
      or (attachment_type = 'return' and return_id is not null and delivery_id is null
        and private.current_user_can_access_page('/returns')
        and exists (select 1 from public.returns r where r.id = return_id and r.organization_id = private.current_organization_id()))
    )
  );

drop policy if exists "organization members can read transaction photos" on storage.objects;
create policy "authorized pages can read transaction photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'transaction-photos'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and exists (
      select 1 from public.transaction_attachments a
      where a.file_path = name and a.organization_id = private.current_organization_id()
        and (
          (a.attachment_type = 'delivery' and (private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/employees')))
          or (a.attachment_type = 'return' and (private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees')))
        )
    )
  );
drop policy if exists "organization members can upload transaction photos" on storage.objects;
create policy "authorized pages can upload transaction photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'transaction-photos'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and (
      ((storage.foldername(name))[2] = 'delivery' and private.current_user_can_access_page('/deliveries')
        and exists (select 1 from public.deliveries d where d.id::text = (storage.foldername(name))[3] and d.organization_id = private.current_organization_id()))
      or ((storage.foldername(name))[2] = 'return' and private.current_user_can_access_page('/returns')
        and exists (select 1 from public.returns r where r.id::text = (storage.foldername(name))[3] and r.organization_id = private.current_organization_id()))
    )
  );

drop policy if exists "organization members can upload delivery terms" on storage.objects;
create policy "authorized pages can upload delivery terms"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-terms'
    and (storage.foldername(name))[1] = private.current_organization_id()::text
    and (
      exists (
        select 1 from public.deliveries d
        where d.id::text = (storage.foldername(name))[2]
          and d.organization_id = private.current_organization_id()
          and (private.current_user_can_access_page('/deliveries') or private.current_user_can_access_page('/employees'))
      )
      or exists (
        select 1 from public.pending_deliveries pd
        where pd.id::text = (storage.foldername(name))[2]
          and pd.organization_id = private.current_organization_id()
          and (
            private.current_user_can_access_page('/deliveries')
            or (pd.status = 'completed' and private.current_user_can_access_page('/employees'))
          )
      )
      or exists (
        select 1 from public.returns r
        where r.id::text = (storage.foldername(name))[2]
          and r.organization_id = private.current_organization_id()
          and (private.current_user_can_access_page('/returns') or private.current_user_can_access_page('/employees'))
      )
      or exists (
        select 1 from public.return_deduction_cases c
        where c.id::text = (storage.foldername(name))[2]
          and c.organization_id = private.current_organization_id()
          and private.current_user_can_access_page('/discounts')
      )
      or exists (
        select 1 from public.return_deduction_refusal_records rr
        where rr.id::text = (storage.foldername(name))[2]
          and rr.organization_id = private.current_organization_id()
          and private.current_user_can_access_page('/discounts')
      )
    )
  );
