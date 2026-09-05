alter table public.materials
  add column if not exists contract_item_code text,
  add column if not exists contract_item_number int,
  add column if not exists contract_category text not null default 'EPI' check (contract_category in ('EPI','EPC','FERRAMENTAL','EQUIPAMENTO','ACESSORIO','TI')),
  add column if not exists usage_scope text not null default 'individual' check (usage_scope in ('individual','coletivo')),
  add column if not exists contract_source text,
  add column if not exists contract_specification text,
  add column if not exists voltage_class text,
  add column if not exists ca_required boolean not null default false,
  add column if not exists test_required boolean not null default false,
  add column if not exists test_type text check (test_type in ('dielectric','calibration','operational','inspection','other')),
  add column if not exists test_interval_months int check (test_interval_months in (6,12)),
  add column if not exists report_required boolean not null default false,
  add column if not exists art_required boolean not null default false;

update public.materials
set ca_required = type = 'EPI'
where ca_required = false;

create unique index if not exists materials_contract_code_uidx
  on public.materials(organization_id, contract_item_code)
  where contract_item_code is not null;

create table if not exists public.contract_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  source_annex text not null,
  team_size int,
  composition text,
  created_at timestamptz not null default now(),
  unique(organization_id, code)
);

create table if not exists public.contract_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id uuid not null references public.contract_scenarios(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  source_annex text not null,
  source_item_number int,
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null default 'un.',
  usage_scope text not null check (usage_scope in ('individual','coletivo')),
  notes text,
  created_at timestamptz not null default now(),
  unique(scenario_id, material_id, usage_scope)
);

create index if not exists contract_requirements_org_scenario_idx
  on public.contract_requirements(organization_id, scenario_id);

create table if not exists public.material_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  unit_identifier text not null,
  lot_number text,
  serial_number text,
  manufacturer text,
  model text,
  size text,
  manufactured_at date,
  expires_at date,
  ca_number text,
  ca_expires_at date,
  status text not null default 'available' check (status in ('available','assigned','maintenance','quarantine','discarded')),
  location text,
  notes text,
  created_at timestamptz not null default now(),
  unique(organization_id, unit_identifier)
);

create index if not exists material_units_material_status_idx
  on public.material_units(organization_id, material_id, status);

alter table public.contract_scenarios enable row level security;
alter table public.contract_requirements enable row level security;
alter table public.material_units enable row level security;

drop policy if exists "organization members can access contract scenarios" on public.contract_scenarios;
create policy "organization members can access contract scenarios" on public.contract_scenarios
  for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists "organization members can access contract requirements" on public.contract_requirements;
create policy "organization members can access contract requirements" on public.contract_requirements
  for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists "organization members can access material units" on public.material_units;
create policy "organization members can access material units" on public.material_units
  for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
