do $$
declare
  duplicate_material record;
  canonical_id uuid;
  canonical_code text;
begin
  for duplicate_material in
    select m.id, m.organization_id, m.contract_item_code,
      split_part(m.contract_item_code, '-', 1) || '-' || lpad(split_part(m.contract_item_code, '-', 2), 3, '0') as normalized_code
    from public.materials m
    where m.contract_item_code ~ '^A0[4-7]-[0-9]{1,2}$'
      and m.contract_item_code <> split_part(m.contract_item_code, '-', 1) || '-' || lpad(split_part(m.contract_item_code, '-', 2), 3, '0')
  loop
    canonical_code := duplicate_material.normalized_code;
    select id into canonical_id from public.materials where organization_id = duplicate_material.organization_id and contract_item_code = canonical_code;
    if canonical_id is null then
      update public.materials set contract_item_code = canonical_code, internal_code = canonical_code where id = duplicate_material.id;
    elsif canonical_id <> duplicate_material.id then
      update public.contract_requirements set material_id = canonical_id where material_id = duplicate_material.id
        and not exists (select 1 from public.contract_requirements existing where existing.scenario_id = contract_requirements.scenario_id and existing.material_id = canonical_id and existing.usage_scope = contract_requirements.usage_scope);
      delete from public.contract_requirements where material_id = duplicate_material.id;
      delete from public.material_units where material_id = duplicate_material.id;
      delete from public.materials where id = duplicate_material.id;
    end if;
  end loop;
end $$;
