do $$
declare
  org_id uuid := '4dc792c1-5087-4eea-a806-e2957cd0d09d';
  item record;
  scenario record;
  v_material_id uuid;
begin
  for item in
    select * from (values
      ('A04-049','Luva isolante classe 0','EPI','PAR','individual','EPI'),
      ('A04-050','Luva isolante classe II','EPI','PAR','individual','EPI'),
      ('A04-051','Óculos de segurança lente escura','EPI','un.','individual','EPI'),
      ('A04-052','Óculos de segurança lente transparente','EPI','un.','individual','EPI'),
      ('A04-053','Luva de cobertura','EPI','PAR','individual','EPI'),
      ('A04-054','Luva de vaqueta','EPI','PAR','individual','EPI'),
      ('A04-055','Botina sem componente metálico','EPI','PAR','individual','EPI'),
      ('A04-056','Bota de PVC','EPI','PAR','individual','EPI'),
      ('A04-057','Conjunto impermeável','EPI','un.','individual','EPI'),
      ('A04-058','Cinto de segurança tipo paraquedista dielétrico','EPI','un.','individual','EPI'),
      ('A04-059','Talabarte de posicionamento dielétrico','EPI','un.','individual','EPI'),
      ('A04-060','Trava-quedas','EPI','un.','individual','EPI'),
      ('A04-061','Vestimenta retardante a chamas','EPI','un.','individual','EPI'),
      ('A04-063','Balaclava retardante a chamas','EPI','un.','individual','EPI'),
      ('A04-064','Manga isolante classe 0','EPI','PAR','individual','EPI'),
      ('A04-066','Capacete classe B aba total','EPI','un.','individual','EPI'),
      ('A04-067','Mosquetão tripla trava tipo pera','EPI','un.','individual','EPI'),
      ('A04-068','Detector de tensão tipo caneta','EPI','un.','individual','EPI'),
      ('A04-069','Freio EDDY','EPI','un.','individual','EPI'),
      ('A04-034','Conjunto de aterramento para RD 15 kV','EPC','un.','coletivo','EPC'),
      ('A04-035','Conjunto de aterramento para rede multiplexada BT 800 V','EPC','un.','coletivo','EPC'),
      ('A04-038','Detector de tensão por aproximação 110 V a 40 kV','EPC','un.','coletivo','EPC'),
      ('A04-039','Escada de fibra de vidro extensível 4,33 m x 7,26 m','EPC','un.','coletivo','EPC'),
      ('A04-044','Vara de manobra seccionável com 7 elementos','EPC','un.','coletivo','EPC'),
      ('A04-045','Cobertura circular 150 x 300 mm 26,4 kV','EPC','un.','coletivo','EPC'),
      ('A04-048','Cobertura circular 230 x 1800 mm 26,4 kV','EPC','un.','coletivo','EPC'),
      ('A04-070','Alicate volt/amperímetro 750 V 1000 A','FERRAMENTAL','un.','coletivo','EQUIPAMENTO'),
      ('A04-073','Dinamômetro 150 kgf completo','FERRAMENTAL','un.','coletivo','EQUIPAMENTO'),
      ('A04-077','Banqueta isolada 40 kV','FERRAMENTAL','un.','coletivo','FERRAMENTAL'),
      ('A04-081','Terrômetro','FERRAMENTAL','un.','coletivo','FERRAMENTAL'),
      ('A04-083','Trena de fibra 50 m','FERRAMENTAL','un.','coletivo','FERRAMENTAL'),
      ('A04-129','Motosserra','FERRAMENTAL','un.','coletivo','FERRAMENTAL'),
      ('A05-035','Bastão garra para linha viva','EPC','un.','coletivo','EPC'),
      ('A05-37','By-pass com cabo 35 mm² completo','EPC','un.','coletivo','EPC'),
      ('A05-63','Detector de tensão por aproximação DTM40','EPC','un.','coletivo','EPC'),
      ('A05-65','Lençol isolante classe 4 36 kV','EPC','un.','coletivo','EPC'),
      ('A05-66','Lençol isolante classe 2 17 kV','EPC','un.','coletivo','EPC'),
      ('A05-83','Luva isolante classe II linha viva','EPI','PAR','individual','EPI'),
      ('A05-89','Cinto de segurança paraquedista dielétrico linha viva','EPI','un.','individual','EPI'),
      ('A05-111','Escada isolada de fiberglass para linha viva','FERRAMENTAL','un.','coletivo','FERRAMENTAL'),
      ('A06-27','Conjunto de aterramento para RD 15 kV STC','EPC','un.','coletivo','EPC'),
      ('A06-31','Detector de tensão por aproximação STC','EPC','un.','coletivo','EPC'),
      ('A06-32','Escada de fibra de vidro extensível STC','EPC','un.','coletivo','EPC'),
      ('A06-37','Luva isolante classe 0 STC','EPI','PAR','individual','EPI'),
      ('A06-54','Capacete classe B aba total STC','EPI','un.','individual','EPI'),
      ('A07-01','Capacete para motociclista com queixeira e viseira','FERRAMENTAL','un.','individual','ACESSORIO'),
      ('A07-02','Luva para motociclista','FERRAMENTAL','PAR','individual','ACESSORIO'),
      ('A07-05','Botina de segurança cano longo','FERRAMENTAL','PAR','individual','ACESSORIO'),
      ('A07-07','Camisa manga longa com fita refletiva','EPI','un.','individual','EPI'),
      ('A07-10','Óculos de segurança lente escura motociclista','EPI','un.','individual','EPI')
    ) as v(code,name,material_type,unit,scope,category)
  loop
    insert into public.materials (
      organization_id, internal_code, name, type, unit, ca_number, minimum_stock, status,
      contract_item_code, contract_item_number, contract_category, usage_scope, contract_source,
      ca_required, test_required, test_type, test_interval_months, report_required, art_required, notes
    ) values (
      org_id, item.code, item.name, item.material_type::public.material_type, item.unit,
      case when item.material_type = 'EPI' then 'PENDENTE' else null end, 0, 'active',
      item.code, null, item.category, item.scope, 'Contrato WS 93000 - Anexos 04 a 07',
      item.material_type = 'EPI', item.material_type in ('EPI','EPC'),
      case when item.material_type in ('EPI','EPC') then 'dielectric' else null end,
      case when item.material_type in ('EPI','EPC') then 12 else null end,
      item.material_type in ('EPI','EPC'), item.material_type in ('EPI','EPC'),
      'Catálogo contratual inicial. Validar fabricante, CA, especificação e laudo antes do uso.'
    )
    on conflict (organization_id, contract_item_code) where contract_item_code is not null
    do update set name = excluded.name, type = excluded.type, unit = excluded.unit,
      contract_category = excluded.contract_category, usage_scope = excluded.usage_scope,
      ca_required = excluded.ca_required, test_required = excluded.test_required,
      test_type = excluded.test_type, test_interval_months = excluded.test_interval_months,
      report_required = excluded.report_required, art_required = excluded.art_required;
  end loop;

  for scenario in
    select id, code from public.contract_scenarios where organization_id = org_id
  loop
    for item in
      select * from (values
        ('A04-049', case when scenario.code = 'CM_LEVE' then 3 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 3 else 0 end),
        ('A04-050', case when scenario.code = 'CM_LEVE' then 4 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 4 else 0 end),
        ('A04-051', case when scenario.code = 'CM_LEVE' then 3 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 4 else 0 end),
        ('A04-054', case when scenario.code = 'CM_LEVE' then 3 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 4 else 0 end),
        ('A04-055', case when scenario.code = 'CM_LEVE' then 3 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 4 else 0 end),
        ('A04-058', case when scenario.code = 'CM_LEVE' then 3 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 4 else 0 end),
        ('A04-060', case when scenario.code = 'CM_LEVE' then 3 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 4 else 0 end),
        ('A04-066', case when scenario.code = 'CM_LEVE' then 3 when scenario.code = 'CM_PESADA' then 3 when scenario.code = 'PODA_LEVE' then 3 when scenario.code = 'PODA_PESADA' then 4 else 0 end),
        ('A04-034', case when scenario.code in ('CM_LEVE','CM_PESADA') then 2 else 0 end),
        ('A04-038', case when scenario.code in ('CM_LEVE','CM_PESADA') then 1 else 0 end),
        ('A04-044', case when scenario.code in ('CM_LEVE','CM_PESADA') then 2 else 0 end),
        ('A04-039', case when scenario.code = 'CM_LEVE' then 1 when scenario.code = 'CM_PESADA' then 3 else 0 end),
        ('A04-070', case when scenario.code in ('CM_LEVE','CM_PESADA') then 1 else 0 end),
        ('A04-077', case when scenario.code in ('CM_LEVE','CM_PESADA') then 1 else 0 end),
        ('A04-081', case when scenario.code in ('CM_LEVE','CM_PESADA') then 1 else 0 end),
        ('A05-035', case when scenario.code in ('LV_DIST_LEVE','LV_DIST_PESADA') then 1 else 0 end),
        ('A05-37', case when scenario.code in ('LV_DIST_LEVE','LV_DIST_PESADA') then 6 else 0 end),
        ('A05-63', case when scenario.code in ('LV_DIST_LEVE','LV_DIST_PESADA') then 1 else 0 end),
        ('A05-65', case when scenario.code in ('LV_DIST_LEVE','LV_DIST_PESADA') then 1 else 0 end),
        ('A05-83', case when scenario.code = 'LV_DIST_LEVE' then 3 when scenario.code = 'LV_DIST_PESADA' then 4 else 0 end),
        ('A05-89', case when scenario.code = 'LV_DIST_LEVE' then 3 when scenario.code = 'LV_DIST_PESADA' then 4 else 0 end),
        ('A06-27', case when scenario.code in ('STC_OPERACAO','STC_PERDAS') then 2 else 0 end),
        ('A06-31', case when scenario.code in ('STC_OPERACAO','STC_PERDAS') then 1 else 0 end),
        ('A06-37', case when scenario.code in ('STC_OPERACAO','STC_PERDAS') then 2 else 0 end),
        ('A06-54', case when scenario.code in ('STC_OPERACAO','STC_PERDAS') then 2 else 0 end),
        ('A07-01', case when scenario.code = 'MOTOCICLISTA' then 1 else 0 end),
        ('A07-02', case when scenario.code = 'MOTOCICLISTA' then 1 else 0 end),
        ('A07-05', case when scenario.code = 'MOTOCICLISTA' then 1 else 0 end),
        ('A07-07', case when scenario.code = 'MOTOCICLISTA' then 2 else 0 end)
      ) as q(code,quantity)
      where q.quantity > 0
    loop
      select id into v_material_id from public.materials where organization_id = org_id and contract_item_code = item.code;
      insert into public.contract_requirements (organization_id, scenario_id, material_id, source_annex, source_item_number, quantity, unit, usage_scope, notes)
      select org_id, scenario.id, v_material_id, case when item.code like 'A04-%' then 'Anexo 04' when item.code like 'A05-%' then 'Anexo 05' when item.code like 'A06-%' then 'Anexo 06' else 'Anexo 07' end, null, item.quantity, m.unit, m.usage_scope, 'Quantidade mínima contratual; ajustar proporcionalmente ao efetivo da equipe.'
      from public.materials m where m.id = v_material_id
      on conflict (scenario_id, material_id, usage_scope) do update set quantity = excluded.quantity, unit = excluded.unit, notes = excluded.notes;
    end loop;
  end loop;
end $$;
