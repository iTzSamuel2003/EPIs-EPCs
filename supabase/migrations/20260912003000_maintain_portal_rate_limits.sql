create index if not exists employee_portal_rate_limits_updated_idx
  on private.employee_portal_rate_limits(updated_at);

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
  if length(trim(p_registration)) > 100 or length(trim(p_cpf)) > 64 then
    raise exception 'Dados de acesso inválidos';
  end if;

  delete from private.employee_portal_rate_limits
  where updated_at < now() - interval '1 day';

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
