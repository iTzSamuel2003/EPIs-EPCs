begin;

do $$
declare
  canonical_id uuid;
  duplicate_id uuid;
begin
  select id into canonical_id from public.materials
  where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
    and contract_item_code = 'A04-063';
  select id into duplicate_id from public.materials
  where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
    and contract_item_code = 'A05-094';

  if canonical_id is not null and duplicate_id is not null
     and not exists (select 1 from public.material_lots where material_id = duplicate_id)
     and not exists (select 1 from public.stock_movements where material_id = duplicate_id)
     and not exists (select 1 from public.material_units where material_id = duplicate_id)
     and not exists (select 1 from public.material_tests where material_id = duplicate_id)
     and not exists (select 1 from public.delivery_items where material_id = duplicate_id)
     and not exists (select 1 from public.return_items where material_id = duplicate_id)
  then
    delete from public.contract_requirements requirement
    where requirement.material_id = duplicate_id
      and exists (
        select 1 from public.contract_requirements existing
        where existing.scenario_id = requirement.scenario_id
          and existing.usage_scope = requirement.usage_scope
          and existing.material_id = canonical_id
      );
    update public.contract_requirements set material_id = canonical_id where material_id = duplicate_id;
    update public.materials set status = 'inactive' where id = duplicate_id;
  end if;
end $$;

commit;
