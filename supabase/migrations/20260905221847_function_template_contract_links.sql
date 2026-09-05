alter table public.function_templates
  add column if not exists contract_scenario_id uuid references public.contract_scenarios(id) on delete set null,
  add column if not exists function_group text,
  add column if not exists classification_inherits_materials boolean not null default true;

create index if not exists function_templates_contract_scenario_idx
  on public.function_templates(contract_scenario_id);

create table if not exists public.function_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  canonical_function text not null,
  contract_scenario_id uuid references public.contract_scenarios(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id, normalized_alias)
);

alter table public.function_aliases enable row level security;
drop policy if exists "organization members can access function aliases" on public.function_aliases;
create policy "organization members can access function aliases" on public.function_aliases
  for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

do $$
declare
  v_org uuid := '4dc792c1-5087-4eea-a806-e2957cd0d09d';
begin
  update public.function_templates ft
  set contract_scenario_id = cs.id,
      function_group = case
        when lower(ft.name) like '%linha viva%' then 'Eletricista de Linha Viva'
        when lower(ft.name) like '%linha morta%' or lower(ft.name) like '%encarregado lm%' then 'Eletricista de Linha Morta'
        when lower(ft.name) like '%poda%' then 'Poda'
        when lower(ft.name) like '%munck%' then 'Operador de Guindauto'
        else ft.name
      end
  from public.contract_scenarios cs
  where ft.organization_id = v_org
    and ((lower(ft.name) like '%linha viva%' and cs.code = 'LV_DIST_LEVE')
      or ((lower(ft.name) like '%linha morta%' or lower(ft.name) like '%encarregado lm%') and cs.code = 'CM_LEVE')
      or (lower(ft.name) like '%poda%' and cs.code = 'PODA_LEVE')
      or (lower(ft.name) like '%munck%' and cs.code = 'CM_LEVE'));

  insert into public.function_aliases (organization_id, alias, normalized_alias, canonical_function, contract_scenario_id)
  select v_org, value.alias, lower(regexp_replace(value.alias, '[^a-zA-Z0-9]+', ' ', 'g')), value.canonical_function, cs.id
  from (values
    ('Eletricista LM', 'Eletricista de Linha Morta', 'CM_LEVE'),
    ('Eletricista de Linha Morta', 'Eletricista de Linha Morta', 'CM_LEVE'),
    ('Eletricista Linha Morta', 'Eletricista de Linha Morta', 'CM_LEVE'),
    ('Eletricista LV', 'Eletricista de Linha Viva', 'LV_DIST_LEVE'),
    ('Eletricista de Linha Viva', 'Eletricista de Linha Viva', 'LV_DIST_LEVE'),
    ('Eletricista Linha Viva', 'Eletricista de Linha Viva', 'LV_DIST_LEVE'),
    ('Ajudante de Poda', 'Ajudante de poda', 'PODA_LEVE'),
    ('Podador', 'Ajudante de poda', 'PODA_LEVE'),
    ('Operador de Guindauto', 'Motorista operador de Munck', 'CM_LEVE'),
    ('Motorista de Munck', 'Motorista operador de Munck', 'CM_LEVE')
  ) as value(alias, canonical_function, scenario_code)
  join public.contract_scenarios cs on cs.organization_id = v_org and cs.code = value.scenario_code
  on conflict (organization_id, normalized_alias) do update set canonical_function = excluded.canonical_function, contract_scenario_id = excluded.contract_scenario_id;
end $$;
