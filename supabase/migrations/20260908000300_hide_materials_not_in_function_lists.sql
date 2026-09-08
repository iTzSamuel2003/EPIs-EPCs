update public.materials m
set status = 'inactive'
where m.status = 'active'
  and not exists (
    select 1
    from public.function_template_items fti
    where fti.material_id = m.id
  );
