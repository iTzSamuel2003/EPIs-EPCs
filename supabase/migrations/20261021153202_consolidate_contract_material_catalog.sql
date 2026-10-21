create table public.material_contract_annexes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  annex_number text not null check (annex_number ~ '^[0-9]{2}$'),
  contract_item_code text not null,
  contract_source text,
  created_at timestamptz not null default now(),
  primary key (organization_id, contract_item_code)
);

create index material_contract_annexes_material_idx
  on public.material_contract_annexes (organization_id, material_id, annex_number);

alter table public.material_contract_annexes enable row level security;
revoke all on table public.material_contract_annexes from public, anon, authenticated;
grant select on table public.material_contract_annexes to authenticated;

create policy "organization members read material contract annexes"
  on public.material_contract_annexes
  for select to authenticated
  using (organization_id = private.current_organization_id());

alter table public.materials
  add column if not exists merged_into_material_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'materials_merged_into_material_id_fkey'
      and conrelid = 'public.materials'::regclass
  ) then
    alter table public.materials
      add constraint materials_merged_into_material_id_fkey
      foreign key (merged_into_material_id) references public.materials(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'materials_not_merged_into_self_check'
      and conrelid = 'public.materials'::regclass
  ) then
    alter table public.materials
      add constraint materials_not_merged_into_self_check
      check (merged_into_material_id is null or merged_into_material_id <> id);
  end if;
end;
$$;

create index if not exists materials_merged_into_material_id_idx
  on public.materials (merged_into_material_id)
  where merged_into_material_id is not null;

insert into public.material_contract_annexes (
  organization_id,
  material_id,
  annex_number,
  contract_item_code,
  contract_source
)
select
  material.organization_id,
  material.id,
  lpad((regexp_match(material.contract_item_code, '^A([0-9]{1,2})[-.]', 'i'))[1], 2, '0'),
  material.contract_item_code,
  material.contract_source
from public.materials as material
where material.merged_into_material_id is null
  and material.contract_item_code ~* '^A[0-9]{1,2}[-.]'
on conflict (organization_id, contract_item_code) do nothing;

create temporary table material_consolidation_map on commit drop as
with ranked_materials as (
  select
    material.organization_id,
    material.id as source_material_id,
    lower(regexp_replace(btrim(material.name), '[[:space:]]+', ' ', 'g')) as normalized_name,
    material.contract_item_code,
    dense_rank() over (
      partition by material.organization_id,
        lower(regexp_replace(btrim(material.name), '[[:space:]]+', ' ', 'g'))
      order by
        material.type,
        material.category_id,
        material.contract_category,
        material.unit,
        material.description,
        material.brand,
        material.manufacturer,
        material.model,
        material.contract_specification,
        material.voltage_class,
        material.usage_scope,
        material.ca_required,
        material.test_required,
        material.test_type,
        material.test_interval_months,
        material.report_required,
        material.art_required,
        material.size,
        material.useful_life_months,
        material.replacement_interval_days
    ) as profile_number,
    count(*) over (
      partition by material.organization_id,
        lower(regexp_replace(btrim(material.name), '[[:space:]]+', ' ', 'g'))
    ) as same_name_count,
    (
      exists (select 1 from public.material_lots lot where lot.material_id = material.id)
      or exists (select 1 from public.delivery_items delivery where delivery.material_id = material.id)
      or exists (select 1 from public.stock_movements movement where movement.material_id = material.id)
      or exists (select 1 from public.material_units unit where unit.material_id = material.id)
      or exists (select 1 from public.material_variants variant where variant.material_id = material.id)
      or exists (select 1 from public.material_tests test where test.material_id = material.id)
      or exists (select 1 from public.return_items item where item.material_id = material.id)
    ) as has_operational_history,
    material.minimum_stock,
    material.notes
  from public.materials as material
  where material.status = 'active'
    and material.merged_into_material_id is null
    and material.contract_item_code ~* '^A[0-9]{1,2}[-.]'
),
compatible_names as (
  select organization_id, normalized_name
  from ranked_materials
  group by organization_id, normalized_name
  having count(*) > 1
    and count(distinct profile_number) = 1
),
eligible as (
  select ranked_materials.*
  from ranked_materials
  join compatible_names using (organization_id, normalized_name)
),
canonical_order as (
  select
    eligible.*,
    first_value(source_material_id) over (
      partition by organization_id, normalized_name
      order by
        has_operational_history desc,
        case when contract_item_code ~* '^A04[-.]' then 0 else 1 end,
        contract_item_code,
        source_material_id
    ) as canonical_material_id
  from eligible
)
select organization_id, source_material_id, canonical_material_id
from canonical_order;

do $$
begin
  if exists (
    select 1
    from public.contract_requirements as requirement
    join material_consolidation_map as mapping
      on mapping.source_material_id = requirement.material_id
    group by requirement.organization_id, requirement.scenario_id,
      mapping.canonical_material_id, requirement.usage_scope
    having count(*) > 1
  ) then
    raise exception 'Consolidação cancelada: há requisitos contratuais que colidiriam no mesmo cenário.';
  end if;

  if exists (
    select 1
    from public.material_lots as lot
    join material_consolidation_map as mapping
      on mapping.source_material_id = lot.material_id
    group by lot.organization_id, mapping.canonical_material_id, lot.lot_number
    having count(*) > 1
  ) then
    raise exception 'Consolidação cancelada: há números de lote duplicados para o mesmo material.';
  end if;

  if exists (
    select 1
    from public.material_variants as variant
    join material_consolidation_map as mapping
      on mapping.source_material_id = variant.material_id
    group by variant.organization_id, mapping.canonical_material_id, variant.name
    having count(*) > 1
  ) then
    raise exception 'Consolidação cancelada: há variações com o mesmo nome que precisam de revisão.';
  end if;
end;
$$;

create table private.material_consolidation_reference_archive (
  source_table text not null,
  source_record_id uuid not null,
  source_material_id uuid not null references public.materials(id),
  canonical_material_id uuid not null references public.materials(id),
  archived_at timestamptz not null default now(),
  primary key (source_table, source_record_id)
);
revoke all on table private.material_consolidation_reference_archive from public, anon, authenticated;

insert into private.material_consolidation_reference_archive (
  source_table, source_record_id, source_material_id, canonical_material_id
)
select 'contract_requirements', requirement.id, requirement.material_id, mapping.canonical_material_id
from public.contract_requirements as requirement
join material_consolidation_map as mapping on mapping.source_material_id = requirement.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'function_template_items', template_item.id, template_item.material_id, mapping.canonical_material_id
from public.function_template_items as template_item
join material_consolidation_map as mapping on mapping.source_material_id = template_item.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'material_lots', lot.id, lot.material_id, mapping.canonical_material_id
from public.material_lots as lot
join material_consolidation_map as mapping on mapping.source_material_id = lot.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'delivery_items', delivery.id, delivery.material_id, mapping.canonical_material_id
from public.delivery_items as delivery
join material_consolidation_map as mapping on mapping.source_material_id = delivery.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'stock_movements', movement.id, movement.material_id, mapping.canonical_material_id
from public.stock_movements as movement
join material_consolidation_map as mapping on mapping.source_material_id = movement.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'material_tests', test.id, test.material_id, mapping.canonical_material_id
from public.material_tests as test
join material_consolidation_map as mapping on mapping.source_material_id = test.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'material_units', unit.id, unit.material_id, mapping.canonical_material_id
from public.material_units as unit
join material_consolidation_map as mapping on mapping.source_material_id = unit.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'material_variants', variant.id, variant.material_id, mapping.canonical_material_id
from public.material_variants as variant
join material_consolidation_map as mapping on mapping.source_material_id = variant.material_id
where mapping.source_material_id <> mapping.canonical_material_id
union all
select 'return_items', return_item.id, return_item.material_id, mapping.canonical_material_id
from public.return_items as return_item
join material_consolidation_map as mapping on mapping.source_material_id = return_item.material_id
where mapping.source_material_id <> mapping.canonical_material_id;

update public.material_contract_annexes as annex
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where annex.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.contract_requirements as requirement
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where requirement.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.function_template_items as template_item
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where template_item.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.material_lots as lot
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where lot.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.delivery_items as delivery
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where delivery.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.stock_movements as movement
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where movement.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.material_tests as test
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where test.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.material_units as unit
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where unit.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.material_variants as variant
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where variant.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

update public.return_items as return_item
set material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where return_item.material_id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

with merged_values as (
  select
    mapping.canonical_material_id,
    max(material.minimum_stock) as minimum_stock,
    string_agg(distinct nullif(btrim(material.notes), ''), E'\n'
      order by nullif(btrim(material.notes), '')) as notes
  from material_consolidation_map as mapping
  join public.materials as material on material.id = mapping.source_material_id
  group by mapping.canonical_material_id
)
update public.materials as canonical
set minimum_stock = merged_values.minimum_stock,
    notes = coalesce(merged_values.notes, canonical.notes)
from merged_values
where canonical.id = merged_values.canonical_material_id;

update public.materials as duplicate
set status = 'inactive',
    merged_into_material_id = mapping.canonical_material_id
from material_consolidation_map as mapping
where duplicate.id = mapping.source_material_id
  and mapping.source_material_id <> mapping.canonical_material_id;

create or replace function private.enforce_enabled_contract_annex_on_stock_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_annex_number text;
  v_has_annex_links boolean;
  v_has_enabled_annex boolean;
  v_disabled_annexes text;
  v_merged_into uuid;
begin
  select material.merged_into_material_id, material.contract_item_code, material.contract_source
  into v_merged_into, v_annex_number, v_disabled_annexes
  from public.materials as material
  where material.id = new.material_id
    and material.organization_id = new.organization_id;

  if v_merged_into is not null then
    raise exception 'Este cadastro foi consolidado. Selecione o material principal para registrar a entrada.';
  end if;

  select exists (
    select 1
    from public.material_contract_annexes as annex
    where annex.organization_id = new.organization_id
      and annex.material_id = new.material_id
  ) into v_has_annex_links;

  if v_has_annex_links then
    select
      coalesce(bool_or(coalesce(settings.active, true)), false),
      string_agg(distinct annex.annex_number, ', ' order by annex.annex_number)
    into v_has_enabled_annex, v_disabled_annexes
    from public.material_contract_annexes as annex
    left join public.organization_annex_settings as settings
      on settings.organization_id = annex.organization_id
      and settings.annex_number = annex.annex_number
    where annex.organization_id = new.organization_id
      and annex.material_id = new.material_id;

    if not v_has_enabled_annex then
      raise exception 'Todos os anexos vinculados (%) estão desativados. Reative ao menos um em Materiais para registrar uma nova entrada.', v_disabled_annexes;
    end if;

    return new;
  end if;

  v_annex_number := coalesce(
    lpad((regexp_match(v_annex_number, '^A([0-9]{1,2})[-.]', 'i'))[1], 2, '0'),
    lpad((regexp_match(v_disabled_annexes, 'anexo[[:space:]]*(n[º°.]?[[:space:]]*)?([0-9]{1,2})', 'i'))[2], 2, '0')
  );

  if v_annex_number is not null and exists (
    select 1
    from public.organization_annex_settings as settings
    where settings.organization_id = new.organization_id
      and settings.annex_number = v_annex_number
      and settings.active = false
  ) then
    raise exception 'O Anexo % está desativado. Reative-o em Materiais para registrar uma nova entrada.', v_annex_number;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_enabled_contract_annex_on_stock_entry() from public, anon, authenticated;
