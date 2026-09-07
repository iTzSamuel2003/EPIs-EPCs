do $$
declare
  pair record;
  canonical_id uuid;
  duplicate_id uuid;
begin
  for pair in
    select * from (values
      ('A05-001', 'A04-001'), ('A05-002', 'A04-002'), ('A05-007', 'A04-005'),
      ('A05-011', 'A04-006'), ('A05-015', 'A04-008'), ('A05-017', 'A04-010'),
      ('A05-018', 'A04-011'), ('A05-019', 'A04-012'), ('A05-023', 'A04-018'),
      ('A05-024', 'A04-019'), ('A05-025', 'A04-020'), ('A05-026', 'A04-021'),
      ('A05-028', 'A04-022'), ('A05-029', 'A04-023'), ('A05-031', 'A04-025'),
      ('A05-032', 'A04-026'), ('A05-108', 'A04-027'), ('A05-109', 'A04-028'),
      ('A05-110', 'A04-029'), ('A05-045', 'A04-030'), ('A05-046', 'A04-031'),
      ('A05-047', 'A04-032'), ('A05-068', 'A04-043'), ('A05-083', 'A04-050'),
      ('A05-084', 'A04-051'), ('A05-085', 'A04-052'), ('A05-086', 'A04-053'),
      ('A05-087', 'A04-054'), ('A05-088', 'A04-055'), ('A05-089', 'A04-058'),
      ('A05-091', 'A04-060'), ('A05-092', 'A04-061'), ('A05-093', 'A04-062'),
      ('A05-096', 'A04-065'), ('A05-097', 'A04-066'), ('A05-098', 'A04-067'),
      ('A05-099', 'A04-069'), ('A05-102', 'A04-071'), ('A05-103', 'A04-074'),
      ('A05-118', 'A04-079'), ('A05-081', 'A05-071')
    ) as mappings(duplicate_code, canonical_code)
  loop
    select id into canonical_id from public.materials
    where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
      and contract_item_code = pair.canonical_code;
    select id into duplicate_id from public.materials
    where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
      and contract_item_code = pair.duplicate_code
      and status = 'active';

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
  end loop;
end $$;
