begin;

with repairs(code, name) as (
  values
    ('A04-045', 'Cobertura circular - 150mm x 300mm - Tensão Nominal 26,4KV'),
    ('A04-046', 'Cobertura circular - 150mm x 600mm - Tensão Nominal 26,4KV'),
    ('A04-047', 'Cobertura circular - 150mm x 900mm - Tensão Nominal 26,4KV'),
    ('A04-048', 'Cobertura circular - 230mm x 1800mm - Tensão Nominal 26,4KV')
)
update public.materials m
set name = repairs.name, contract_specification = repairs.name
from repairs
where m.organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and m.contract_item_code = repairs.code;

do $$
declare
  pair record;
  canonical_id uuid;
  duplicate_id uuid;
begin
  for pair in
    select * from (values
      ('A04-045', 'A05-048'),
      ('A04-046', 'A05-049'),
      ('A04-047', 'A05-050'),
      ('A04-048', 'A05-051')
    ) as pairs(canonical_code, duplicate_code)
  loop
    select id into canonical_id from public.materials
    where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
      and contract_item_code = pair.canonical_code;
    select id into duplicate_id from public.materials
    where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
      and contract_item_code = pair.duplicate_code;

    if canonical_id is not null and duplicate_id is not null then
      delete from public.contract_requirements requirement
      where requirement.material_id = duplicate_id
        and exists (
          select 1 from public.contract_requirements existing
          where existing.scenario_id = requirement.scenario_id
            and existing.usage_scope = requirement.usage_scope
            and existing.material_id = canonical_id
        );
      update public.contract_requirements set material_id = canonical_id where material_id = duplicate_id;
      update public.material_lots set material_id = canonical_id where material_id = duplicate_id;
      update public.stock_movements set material_id = canonical_id where material_id = duplicate_id;
      update public.material_units set material_id = canonical_id where material_id = duplicate_id;
      update public.material_tests set material_id = canonical_id where material_id = duplicate_id;
      update public.delivery_items set material_id = canonical_id where material_id = duplicate_id;
      update public.return_items set material_id = canonical_id where material_id = duplicate_id;
      update public.materials set status = 'inactive' where id = duplicate_id;
    end if;
  end loop;

  select id into canonical_id from public.materials
  where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
    and contract_item_code = 'A04-084';
  select id into duplicate_id from public.materials
  where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
    and contract_item_code is null
    and lower(trim(name)) = 'agulhão';

  if canonical_id is not null and duplicate_id is not null then
    update public.material_lots set material_id = canonical_id where material_id = duplicate_id;
    update public.stock_movements set material_id = canonical_id where material_id = duplicate_id;
    update public.material_units set material_id = canonical_id where material_id = duplicate_id;
    update public.material_tests set material_id = canonical_id where material_id = duplicate_id;
    update public.delivery_items set material_id = canonical_id where material_id = duplicate_id;
    update public.return_items set material_id = canonical_id where material_id = duplicate_id;
    update public.materials set status = 'inactive' where id = duplicate_id;
  end if;
end $$;

commit;
