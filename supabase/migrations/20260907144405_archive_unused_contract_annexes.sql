alter table public.contract_scenarios
  add column if not exists active boolean not null default true;

update public.contract_scenarios
set active = false
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and code in ('STC_OPERACAO', 'STC_PERDAS', 'MOTOCICLISTA');

update public.materials
set status = 'inactive'
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and (contract_source like '%Anexo 06%' or contract_source like '%Anexo 07%');
