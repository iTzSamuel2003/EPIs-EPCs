delete from public.contract_training_requirements
where lower(trim(function_group)) in ('motociclista', 'stc');
