-- Complementos operacionais do MVP: variantes, perfil do colaborador,
-- custos, responsabilização de devoluções e auditoria.

create table if not exists public.material_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  name text not null,
  size text,
  color text,
  model text,
  sku text,
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, material_id, name)
);

alter table public.material_lots add column if not exists variant_id uuid references public.material_variants(id);
alter table public.material_lots add column if not exists unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0);
alter table public.stock_invoices add column if not exists total_amount numeric(12,2) not null default 0 check (total_amount >= 0);
create index if not exists material_variants_material_idx on public.material_variants(organization_id, material_id, active);
create index if not exists material_lots_variant_idx on public.material_lots(organization_id, variant_id);

create table if not exists public.employee_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shirt_size text,
  pants_size text,
  shoe_size text,
  helmet_size text,
  glove_size text,
  uniform_notes text,
  completed_by_employee boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null,
  provider text,
  completed_at date,
  expires_at date,
  certificate_number text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists employee_courses_employee_idx on public.employee_courses(organization_id, employee_id, expires_at);

create table if not exists public.return_accountability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_id uuid not null unique references public.returns(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  incident_type text not null check (incident_type in ('normal','misuse','loss','theft','damage','other')) default 'normal',
  incident_description text,
  employee_signature_name text,
  signed_at timestamptz,
  deduction_requested boolean not null default false,
  deduction_amount numeric(12,2) check (deduction_amount is null or deduction_amount >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists return_accountability_employee_idx on public.return_accountability(organization_id, employee_id, created_at desc);

alter table public.material_variants enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.employee_courses enable row level security;
alter table public.return_accountability enable row level security;

drop policy if exists "organization members can access material variants" on public.material_variants;
create policy "organization members can access material variants" on public.material_variants for all to authenticated
  using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
drop policy if exists "organization members can access employee profiles" on public.employee_profiles;
create policy "organization members can access employee profiles" on public.employee_profiles for all to authenticated
  using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
drop policy if exists "organization members can access employee courses" on public.employee_courses;
create policy "organization members can access employee courses" on public.employee_courses for all to authenticated
  using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
drop policy if exists "organization members can access return accountability" on public.return_accountability;
create policy "organization members can access return accountability" on public.return_accountability for all to authenticated
  using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());

grant select, insert, update, delete on public.material_variants, public.employee_profiles, public.employee_courses, public.return_accountability to authenticated;

create or replace function public.record_return_accountability(
  p_return_id uuid,
  p_incident_type text,
  p_incident_description text,
  p_employee_signature_name text,
  p_deduction_requested boolean,
  p_deduction_amount numeric
) returns uuid language plpgsql security invoker set search_path = public, private as $$
declare
  v_org uuid := private.current_organization_id();
  v_employee uuid;
  v_id uuid;
begin
  select employee_id into v_employee from public.returns where id = p_return_id and organization_id = v_org;
  if v_employee is null then raise exception 'Devolução não encontrada'; end if;
  insert into public.return_accountability (organization_id, return_id, employee_id, incident_type, incident_description, employee_signature_name, signed_at, deduction_requested, deduction_amount, created_by)
  values (v_org, p_return_id, v_employee, coalesce(nullif(p_incident_type, ''), 'normal'), nullif(trim(p_incident_description), ''), nullif(trim(p_employee_signature_name), ''), case when nullif(trim(p_employee_signature_name), '') is not null then now() end, coalesce(p_deduction_requested, false), case when p_deduction_requested then p_deduction_amount else null end, auth.uid())
  on conflict (return_id) do update set incident_type = excluded.incident_type, incident_description = excluded.incident_description, employee_signature_name = excluded.employee_signature_name, signed_at = excluded.signed_at, deduction_requested = excluded.deduction_requested, deduction_amount = excluded.deduction_amount
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) from public;
grant execute on function public.record_return_accountability(uuid, text, text, text, boolean, numeric) to authenticated;

create or replace function public.audit_row_change() returns trigger language plpgsql security invoker set search_path = public, private as $$
begin
  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (coalesce(new.organization_id, old.organization_id), auth.uid(), lower(tg_op), tg_table_name, coalesce(nullif(to_jsonb(new)->>'id','')::uuid, nullif(to_jsonb(old)->>'id','')::uuid, nullif(to_jsonb(new)->>'employee_id','')::uuid, nullif(to_jsonb(old)->>'employee_id','')::uuid), to_jsonb(old), to_jsonb(new));
  return coalesce(new, old);
end;
$$;

drop trigger if exists employees_audit on public.employees;
create trigger employees_audit after insert or update or delete on public.employees for each row execute function public.audit_row_change();
drop trigger if exists materials_audit on public.materials;
create trigger materials_audit after insert or update or delete on public.materials for each row execute function public.audit_row_change();
drop trigger if exists material_lots_audit on public.material_lots;
create trigger material_lots_audit after insert or update or delete on public.material_lots for each row execute function public.audit_row_change();
drop trigger if exists return_accountability_audit on public.return_accountability;
create trigger return_accountability_audit after insert or update or delete on public.return_accountability for each row execute function public.audit_row_change();
