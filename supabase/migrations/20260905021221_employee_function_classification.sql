alter table public.employees add column if not exists function_classification text;

update public.employees
set function_classification = upper(regexp_replace(function_name, '^.*\s+(VI|V|IV|III|II|I)$', '\1'))
where function_name ~* '\s+(VI|V|IV|III|II|I)$' and function_classification is null;

update public.employees
set function_name = case
  when upper(function_name) like '%ELETRICISTA%LM%' or upper(function_name) like '%ELETRICISTA%LINHA MORTA%' then 'Eletricista de linha morta'
  when upper(function_name) like '%ELETRICISTA%LV%' or upper(function_name) like '%ELETRICISTA%LINHA VIVA%' then 'Eletricista de linha viva'
  when upper(function_name) like '%AJUDANTE%PODA%' or upper(function_name) like '%ELETRICISTA PODADOR%' then 'Ajudante de poda'
  when upper(function_name) like '%MOTORISTA%MUNCK%' then 'Motorista operador de Munck'
  when upper(function_name) like '%ENCARREGADO%LM%' or upper(function_name) like '%ENCARREGADO%LINHA MORTA%' then 'Encarregado LM'
  else regexp_replace(function_name, '\s+(VI|V|IV|III|II|I)$', '', 'i')
end
where function_name is not null;
