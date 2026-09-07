update public.materials duplicate
set status = 'inactive'
where duplicate.status = 'active'
  and duplicate.contract_item_code is null
  and lower(regexp_replace(trim(duplicate.name), '[^[:alnum:]]+', ' ', 'g')) in ('luva de cobertura', 'luva de vaqueta', 'trava quedas')
  and not exists (select 1 from public.material_lots where material_id = duplicate.id)
  and not exists (select 1 from public.stock_movements where material_id = duplicate.id)
  and not exists (select 1 from public.material_units where material_id = duplicate.id)
  and not exists (select 1 from public.material_tests where material_id = duplicate.id)
  and not exists (select 1 from public.delivery_items where material_id = duplicate.id)
  and not exists (select 1 from public.return_items where material_id = duplicate.id);
