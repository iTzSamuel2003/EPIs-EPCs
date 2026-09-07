begin;

with repairs(code, name) as (
  values
    ('A04-003', 'Bolsa de lona verde nº 10 para acondicionar bastão de manobra'),
    ('A04-004', 'Bolsa de lona verde nº 10 para acondicionar vara de manobra 7 elementos'),
    ('A04-013', 'Estropo de nylon de 500mm com argola, capacidade de 454kg, peso aprox. 0,55kg'),
    ('A04-014', 'Estropo de nylon de 800mm com argola, capacidade de 454kg, peso aprox. 0,65kg'),
    ('A04-015', 'Farol SEALED BEAM com lâmpada BIÔDO, com tomada de força no veículo'),
    ('A04-024', 'Bolsa de lona nº 10 para acondicionar ferramentas com cadeado'),
    ('A04-033', 'Cone de sinalização com faixa refletiva, flexível, maleável e inquebrável - Tamanho 750mm x 400mm'),
    ('A04-037', 'Conjunto de equipamentos de resgate de eletricista de rede aérea de distribuição de energia elétrica - Escada'),
    ('A04-042', 'Fita de ancoragem para utilização no montante da escada extensível - Fita Eureka'),
    ('A04-044', 'Vara de manobra seccionável com 7 elementos, 01Pç Elemento Ponta, 05Pç Elemento Intermediário e 01Pç Elemento de Punho'),
    ('A04-068', 'Teste neon/detector de tensão tipo caneta, c/sinal de detecção luminosa e sonora'),
    ('A04-084', 'Agulhão para colocação de linha de vida em poste de concreto'),
    ('A04-131', 'Câmera veicular para gravação de trajeto e execução dos serviços - Veículos - Pesados'),
    ('A04-132', 'Monitoramento Veicular "AVL" - GPS com rastreador com dispositivo de localização Global GPRS, para análise de localização e trajetos executados'),
    ('A04-133', 'Rádio Móvel - Motorola - DGM8000 com GPS (45W) - Componentes: Kit cabo e conectores RF para antena; Antena de ganho 3DB; Licença IP SITE CONENECT DGM8000; Suporte calha para antena'),
    ('A05-016', 'Corda de fibra sintética (polipropileno), torcida, 03 pernas, cor branca, Ø1/2”, capacidade de 381kg, carga de ruptura mínima de 1.810kg, fornecida em rolos de 220 metros, peso aprox. 0,104kg/m'),
    ('A05-017', 'Corda poliéster 12mm para amarração da escada com 20mts'),
    ('A05-020', 'Estropo de nylon de 500mm com argola, capacidade de 454kg, peso aprox. 0,55kg'),
    ('A05-021', 'Farol SEALED BEAM com lâmpada BIÔDO, com tomada de força no veículo'),
    ('A05-040', 'By-pass com cabo ultraflexível 4/0 para linha viva completo 2 metros.'),
    ('A05-041', 'By-pass com cabo ultraflexível 4/0 para linha viva completo 5 metros. - 69Kv'),
    ('A05-057', 'Cone de sinalização com faixa refletiva, flexível, maleável e inquebrável - Tamanho 750mm x 400mm'),
    ('A05-060', 'Conjunto de equipamentos conjugados de resgate de eletricista de rede aérea de distribuição de energia elétrica - Cesto Aéreo'),
    ('A05-061', 'Cruzeta auxiliar c/ mastro 64 x 2410mm - completo com os acessórios: 01 bastão mastro com a sela ou suporte para fixação no poste, 01 bastão cruzeta, 01 cabeçote olhal, 04 presilhas de suspensão e os acessórios'),
    ('A05-070', 'Vara de manobra seccionável com 6 elementos, 01Pç Elemento Ponta, 04 Pç Elemento Intermediário e 01Pç Elemento de Punho'),
    ('A05-075', 'Arco de serra isolado'),
    ('A05-105', 'Testador de fases até 16Kv (fasímetro/sequencímetro com isolamento de 150KV)'),
    ('A05-107', 'LOADBUSTER 15/25 KV 600 A, uso em vara de manobra 5300 mm. Ferramenta Portátil de Abertura em Carga'),
    ('A05-111', 'Escada isolada de fiberglass para Linha Viva 6500 x 12000mm - Ref.: RITZ - EE/LV-120'),
    ('A05-113', 'Fita de ancoragem para utilização no montante da escada extensível - Fita Eureka'),
    ('A05-127', 'Câmera veicular para gravação de trajeto e execução dos serviços - Veículos - Pesados'),
    ('A05-128', 'Monitoramento Veicular "AVL" - GPS com rastreador com dispositivo de localização Global GPRS, para análise de localização e trajetos executados'),
    ('A05-129', 'Rádio Móvel - Motorola - DGM8000 com GPS (45W) - Componentes: Kit cabo e conectores RF para antena; Antena de ganho 3DB; Licença IP SITE CONENECT DGM8000; Suporte calha para antena')
)
update public.materials m
set name = repairs.name, contract_specification = repairs.name
from repairs
where m.organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and m.contract_item_code = repairs.code;

do $$
declare
  duplicate_group record;
  duplicate_material record;
  canonical_id uuid;
begin
  for duplicate_group in
    select lower(regexp_replace(trim(name), '[^[:alnum:]]+', ' ', 'g')) as normalized_name
    from public.materials
    where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
      and status = 'active'
      and contract_item_code is not null
      and contract_source in ('Contrato WS 93000 - Anexo 04', 'Contrato WS 93000 - Anexo 05')
    group by 1
    having count(*) > 1
  loop
    select id into canonical_id
    from public.materials
    where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
      and status = 'active'
      and contract_item_code is not null
      and contract_source in ('Contrato WS 93000 - Anexo 04', 'Contrato WS 93000 - Anexo 05')
      and lower(regexp_replace(trim(name), '[^[:alnum:]]+', ' ', 'g')) = duplicate_group.normalized_name
    order by case when contract_item_code like 'A04-%' then 0 else 1 end, contract_item_code
    limit 1;

    for duplicate_material in
      select id
      from public.materials
      where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
        and status = 'active'
        and id <> canonical_id
        and contract_item_code is not null
        and contract_source in ('Contrato WS 93000 - Anexo 04', 'Contrato WS 93000 - Anexo 05')
        and lower(regexp_replace(trim(name), '[^[:alnum:]]+', ' ', 'g')) = duplicate_group.normalized_name
    loop
      if not exists (select 1 from public.material_lots where material_id = duplicate_material.id)
         and not exists (select 1 from public.stock_movements where material_id = duplicate_material.id)
         and not exists (select 1 from public.material_units where material_id = duplicate_material.id)
         and not exists (select 1 from public.material_tests where material_id = duplicate_material.id)
         and not exists (select 1 from public.delivery_items where material_id = duplicate_material.id)
         and not exists (select 1 from public.return_items where material_id = duplicate_material.id)
      then
        delete from public.contract_requirements requirement
        where requirement.material_id = duplicate_material.id
          and exists (
            select 1 from public.contract_requirements existing
            where existing.scenario_id = requirement.scenario_id
              and existing.usage_scope = requirement.usage_scope
              and existing.material_id = canonical_id
          );
        update public.contract_requirements
        set material_id = canonical_id
        where material_id = duplicate_material.id;
        update public.materials set status = 'inactive' where id = duplicate_material.id;
      end if;
    end loop;
  end loop;
end $$;

commit;
