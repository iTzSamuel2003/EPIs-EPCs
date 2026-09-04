create table public.employee_measurement_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '30 days',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employee_measurement_requests_org_idx on public.employee_measurement_requests(organization_id, expires_at);
alter table public.employee_measurement_requests enable row level security;
create policy "organization members manage measurement requests" on public.employee_measurement_requests for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
grant select, insert, update, delete on public.employee_measurement_requests to authenticated;

create or replace function public.get_measurement_request(p_token uuid)
returns table(employee_name text, expires_at timestamptz, completed_at timestamptz)
language sql security definer set search_path = public as $$
  select e.full_name, r.expires_at, r.completed_at
  from public.employee_measurement_requests r join public.employees e on e.id = r.employee_id
  where r.token = p_token and r.expires_at > now();
$$;

create or replace function public.submit_measurement_request(p_token uuid, p_shirt_size text, p_pants_size text, p_shoe_size text, p_helmet_size text, p_glove_size text, p_notes text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_request public.employee_measurement_requests;
begin
  select * into v_request from public.employee_measurement_requests where token = p_token and expires_at > now();
  if v_request.id is null then raise exception 'Link invÃ¡lido ou expirado'; end if;
  insert into public.employee_profiles (employee_id, organization_id, shirt_size, pants_size, shoe_size, helmet_size, glove_size, uniform_notes, completed_by_employee, updated_at)
  values (v_request.employee_id, v_request.organization_id, nullif(trim(p_shirt_size), ''), nullif(trim(p_pants_size), ''), nullif(trim(p_shoe_size), ''), nullif(trim(p_helmet_size), ''), nullif(trim(p_glove_size), ''), nullif(trim(p_notes), ''), true, now())
  on conflict (employee_id) do update set shirt_size = excluded.shirt_size, pants_size = excluded.pants_size, shoe_size = excluded.shoe_size, helmet_size = excluded.helmet_size, glove_size = excluded.glove_size, uniform_notes = excluded.uniform_notes, completed_by_employee = true, updated_at = now();
  update public.employee_measurement_requests set completed_at = now(), updated_at = now() where id = v_request.id;
  return true;
end;
$$;
revoke all on function public.get_measurement_request(uuid) from public, authenticated;
revoke all on function public.submit_measurement_request(uuid, text, text, text, text, text, text) from public, authenticated;
grant execute on function public.get_measurement_request(uuid) to anon;
grant execute on function public.submit_measurement_request(uuid, text, text, text, text, text, text) to anon;


