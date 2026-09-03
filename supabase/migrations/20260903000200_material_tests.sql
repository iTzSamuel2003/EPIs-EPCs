create table public.material_tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  performed_at date not null,
  interval_months int not null check (interval_months in (6, 12)),
  next_due_at date not null,
  result text not null check (result in ('approved','approved_with_restrictions','failed','pending')),
  examiner text,
  certificate_number text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index material_tests_org_due_idx on public.material_tests(organization_id, next_due_at);
create index material_tests_material_idx on public.material_tests(material_id, performed_at desc);

alter table public.material_tests enable row level security;
create policy "organization members can access material tests" on public.material_tests for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());

create or replace function public.register_material_test(
  p_material_id uuid,
  p_performed_at date,
  p_interval_months int,
  p_result text,
  p_examiner text default null,
  p_certificate_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_org uuid := private.current_organization_id();
  v_id uuid;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if not exists (select 1 from public.materials where id = p_material_id and organization_id = v_org and status = 'active') then raise exception 'Material não encontrado ou inativo'; end if;
  if p_interval_months not in (6, 12) then raise exception 'A periodicidade deve ser de 6 ou 12 meses'; end if;
  insert into public.material_tests (organization_id, material_id, performed_at, interval_months, next_due_at, result, examiner, certificate_number, notes, created_by)
  values (v_org, p_material_id, coalesce(p_performed_at, current_date), p_interval_months, (coalesce(p_performed_at, current_date) + (p_interval_months || ' months')::interval)::date, p_result, nullif(trim(p_examiner), ''), nullif(trim(p_certificate_number), ''), nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.register_material_test(uuid, date, int, text, text, text, text) from public;
grant execute on function public.register_material_test(uuid, date, int, text, text, text, text) to authenticated;
