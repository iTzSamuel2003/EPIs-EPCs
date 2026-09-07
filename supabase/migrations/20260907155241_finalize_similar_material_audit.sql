begin;

update public.materials
set name = 'Conjunto de equipamentos conjugados de resgate de eletricista de rede aérea de distribuição de energia elétrica - Escada - Freio EDDY',
    contract_specification = 'Conjunto de equipamentos conjugados de resgate de eletricista de rede aérea de distribuição de energia elétrica - Escada - Freio EDDY'
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and contract_item_code = 'A05-059';

update public.materials
set name = 'Alicate volt/amperímetro 750 V / 1000 A digital',
    contract_specification = 'Alicate Volt/Amperimetro 750v 1000A digital'
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and contract_item_code = 'A04-070';

update public.materials
set name = 'Alicate volt/amperímetro 750 V / 1000 A digital (categoria IV)',
    contract_specification = 'Alicate Volt/Amperimetro 750v 1000A digital (categoria IV)'
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and contract_item_code = 'A05-100';

do $$
declare
  canonical_id uuid;
  duplicate_id uuid;
begin
  select id into canonical_id from public.materials
  where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
    and contract_item_code = 'A04-080';
  select id into duplicate_id from public.materials
  where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
    and contract_item_code = 'A05-119';

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
end $$;

commit;
