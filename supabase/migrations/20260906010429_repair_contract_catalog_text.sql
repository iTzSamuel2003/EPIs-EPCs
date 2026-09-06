update public.materials
set name = regexp_replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(name, 'Ã§', 'c'), 'Ã£', 'a'), 'Ã¡', 'a'), 'Ã©', 'e'), 'Ã­', 'i'), 'Ã³', 'o'), 'Ãº', 'u'), 'Ã´', 'o'), 'Ãª', 'e'), 'Ãµ', 'o'), '[^\x20-\x7EÀ-ÿ]', '', 'g'),
    contract_specification = regexp_replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(contract_specification, 'Ã§', 'c'), 'Ã£', 'a'), 'Ã¡', 'a'), 'Ã©', 'e'), 'Ã­', 'i'), 'Ã³', 'o'), 'Ãº', 'u'), 'Ã´', 'o'), 'Ãª', 'e'), 'Ãµ', 'o'), '[^\x20-\x7EÀ-ÿ]', '', 'g')
where contract_source like 'Contrato WS 93000%'
  and (name like '%Ã%' or name like '%Â%' or name like '%â%');
