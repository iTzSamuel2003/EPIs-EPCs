begin;

update public.materials
set name = 'Balaclava retardante a chamas (com duas aberturas para os olhos)',
    contract_specification = 'Balaclava retardante a chamas (com duas aberturas para os olhos)'
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and contract_item_code in ('A04-063', 'A05-094', 'A06-051');

update public.materials
set status = 'inactive'
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and status = 'active'
  and contract_item_code is null
  and lower(trim(name)) = 'agulhão'
  and not exists (select 1 from public.material_lots where material_id = public.materials.id)
  and not exists (select 1 from public.stock_movements where material_id = public.materials.id)
  and not exists (select 1 from public.material_units where material_id = public.materials.id)
  and not exists (select 1 from public.material_tests where material_id = public.materials.id)
  and not exists (select 1 from public.delivery_items where material_id = public.materials.id)
  and not exists (select 1 from public.return_items where material_id = public.materials.id);

commit;
