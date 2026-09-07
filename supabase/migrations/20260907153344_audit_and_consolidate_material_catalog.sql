begin;

with repairs(code, name) as (
  values
    ('A04-003', 'Bolsa de lona verde nº 10 para acondicionar bastão de manobra'),
    ('A04-004', 'Bolsa de lona verde nº 10 para acondicionar vara de manobra 7 elementos'),
    ('A04-010', 'Corda poliéster 12mm para amarração da escada com 20mts'),
    ('A04-013', 'Estropo de nylon de 500mm com argola, capacidade de 454kg, peso aprox. 0,55kg'),
    ('A04-014', 'Estropo de nylon de 800mm com argola, capacidade de 454kg, peso aprox. 0,65kg'),
    ('A04-015', 'Farol SEALED BEAM com lâmpada BIÔDO, com tomada de força no veículo'),
    ('A04-033', 'Cone de sinalização com faixa refletiva, flexível, maleável e inquebrável - Tamanho 750mm x 400mm'),
    ('A04-035', 'Conjunto aterramento para rede multiplexadas BT - 800V'),
    ('A04-037', 'Conjunto de equipamentos de resgate de eletricista de rede aérea de distribuição de energia elétrica - Escada'),
    ('A04-042', 'Fita de ancoragem para utilização no montante da escada extensível - Fita Eureka'),
    ('A04-044', 'Vara de manobra seccionável com 7 elementos, 01Pç Elemento Ponta, 05Pç Elemento Intermediário e 01Pç Elemento de Punho'),
    ('A04-067', 'Mosquetão tripla trava tipo pera'),
    ('A04-068', 'Teste neon/detector de tensão tipo caneta, c/sinal de detecção luminosa e sonora'),
    ('A04-073', 'Dinamômetro 150 Kgf completo (gancho e corda)'),
    ('A04-080', 'Sacola para içar ferramentas (Balde de Lona Verde nº 10)'),
    ('A04-086', 'Alicate de compressão hidráulico'),
    ('A04-091', 'Baú grande para guardar ferramentas'),
    ('A05-073', 'Alicate hidráulico'),
    ('A05-074', 'Alicate volt/amperímetro'),
    ('A05-105', 'Testador de fases até 16 kV (fasímetro/sequencímetro com isolamento de 150 kV)')
)
update public.materials m
set name = repairs.name, contract_specification = repairs.name
from repairs
where m.organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and m.contract_item_code = repairs.code;

do $$
declare
  candidate record;
begin
  for candidate in
    select id
    from public.materials
    where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
      and status = 'active'
      and contract_item_code is null
      and lower(regexp_replace(trim(name), '[^[:alnum:]]+', ' ', 'g')) in (
        'agulhão',
        'arco de serra',
        'luva isolante classe 0',
        'luva isolante classe 2',
        'manga isolante classe 2'
      )
  loop
    if not exists (select 1 from public.material_lots where material_id = candidate.id)
       and not exists (select 1 from public.stock_movements where material_id = candidate.id)
       and not exists (select 1 from public.material_units where material_id = candidate.id)
       and not exists (select 1 from public.material_tests where material_id = candidate.id)
       and not exists (select 1 from public.delivery_items where material_id = candidate.id)
       and not exists (select 1 from public.return_items where material_id = candidate.id)
    then
      update public.materials set status = 'inactive' where id = candidate.id;
    end if;
  end loop;
end $$;

commit;
