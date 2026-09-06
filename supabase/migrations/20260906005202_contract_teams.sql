create table if not exists public.contract_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  scenario_id uuid not null references public.contract_scenarios(id),
  vehicle_identifier text,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.contract_team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.contract_teams(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (team_id, employee_id)
);

alter table public.contract_teams enable row level security;
alter table public.contract_team_members enable row level security;
drop policy if exists "organization members can access contract teams" on public.contract_teams;
create policy "organization members can access contract teams" on public.contract_teams for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
drop policy if exists "organization members can access contract team members" on public.contract_team_members;
create policy "organization members can access contract team members" on public.contract_team_members for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
