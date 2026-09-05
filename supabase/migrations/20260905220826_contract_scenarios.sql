insert into public.contract_scenarios (organization_id, code, name, source_annex, team_size, composition)
values
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'CM_LEVE', 'Construcao e Manutencao Leve', 'Anexo 04', 4, '1 encarregado + 2 eletricistas + 1 eletricista operador de guindauto'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'CM_PESADA', 'Construcao e Manutencao Pesada', 'Anexo 04', 7, '1 encarregado + 5 eletricistas + 1 eletricista operador de guindauto'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'PODA_LEVE', 'Poda Leve', 'Anexo 04', 3, '1 encarregado + 2 podadores'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'PODA_PESADA', 'Poda Pesada', 'Anexo 04', 4, '1 encarregado + 3 podadores'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'LV_DIST_LEVE', 'Linha Viva Distribuicao Leve', 'Anexo 05', 3, '1 encarregado + 2 eletricistas'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'LV_DIST_PESADA', 'Linha Viva Distribuicao Pesada', 'Anexo 05', 4, '1 encarregado + 3 eletricistas'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'STC_OPERACAO', 'STC Operacao', 'Anexo 06', 2, '2 eletricistas'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'STC_PERDAS', 'STC Perdas', 'Anexo 06', 2, '2 eletricistas'),
  ('4dc792c1-5087-4eea-a806-e2957cd0d09d', 'MOTOCICLISTA', 'Motociclista', 'Anexo 07', 1, '1 motociclista')
on conflict (organization_id, code) do update set
  name = excluded.name,
  source_annex = excluded.source_annex,
  team_size = excluded.team_size,
  composition = excluded.composition;
