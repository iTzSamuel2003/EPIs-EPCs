begin;

create temp table material_catalog_map on commit drop as
with canonical as (
  select distinct on (lower(trim(name)), type)
    id as canonical_id,
    lower(trim(name)) as normalized_name,
    type
  from public.materials
  where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  order by lower(trim(name)), type,
    (contract_item_code is not null) desc,
    (status = 'active') desc,
    contract_item_code nulls last,
    created_at,
    id
), required as (
  select distinct cr.material_id
  from public.contract_requirements cr
  join public.contract_scenarios s on s.id = cr.scenario_id and s.active
)
select m.id as material_id, c.canonical_id
from required r
join public.materials m on m.id = r.material_id
join canonical c on c.normalized_name = lower(trim(m.name)) and c.type = m.type;

delete from public.contract_requirements requirement
using material_catalog_map mapping
where requirement.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id
  and exists (
    select 1
    from public.contract_requirements existing
    where existing.scenario_id = requirement.scenario_id
      and existing.material_id = mapping.canonical_id
      and existing.usage_scope = requirement.usage_scope
  );

update public.contract_requirements requirement
set material_id = mapping.canonical_id
from material_catalog_map mapping
where requirement.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.function_template_items item
set material_id = mapping.canonical_id
from material_catalog_map mapping
where item.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.material_lots item
set material_id = mapping.canonical_id
from material_catalog_map mapping
where item.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.stock_movements item
set material_id = mapping.canonical_id
from material_catalog_map mapping
where item.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.material_units item
set material_id = mapping.canonical_id
from material_catalog_map mapping
where item.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.material_tests item
set material_id = mapping.canonical_id
from material_catalog_map mapping
where item.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.delivery_items item
set material_id = mapping.canonical_id
from material_catalog_map mapping
where item.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.return_items item
set material_id = mapping.canonical_id
from material_catalog_map mapping
where item.material_id = mapping.material_id
  and mapping.material_id <> mapping.canonical_id;

update public.materials material
set status = 'active'
where material.id in (select canonical_id from material_catalog_map);

update public.materials material
set status = 'inactive'
where material.id in (select material_id from material_catalog_map where material_id <> canonical_id);

commit;
