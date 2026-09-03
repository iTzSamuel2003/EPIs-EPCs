-- Classify imported employees by the function recorded in the source spreadsheet.
update public.employees
set department = case
  when lower(coalesce(function_name, '')) like '%poda%'
    or lower(coalesce(function_name, '')) like '%podador%' then 'Poda'
  when lower(coalesce(function_name, '')) like '%eletricista lm%'
    or lower(coalesce(function_name, '')) like '%eletricista lv%'
    or lower(coalesce(function_name, '')) like '%encarregado lm%'
    or lower(coalesce(function_name, '')) like '%encarregado lv%' then 'Construção'
  else 'Administrativo'
end
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d';

