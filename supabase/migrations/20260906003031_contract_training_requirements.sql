create table if not exists public.contract_training_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  function_group text not null,
  course_name text not null,
  source_annex text not null default 'Anexo 03',
  mandatory boolean not null default true,
  validity_months int,
  notes text,
  created_at timestamptz not null default now(),
  unique (organization_id, function_group, course_name)
);

alter table public.contract_training_requirements enable row level security;
drop policy if exists "organization members can access contract training requirements" on public.contract_training_requirements;
create policy "organization members can access contract training requirements" on public.contract_training_requirements
  for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());

insert into public.contract_training_requirements (organization_id, function_group, course_name, source_annex, validity_months, notes)
select '4dc792c1-5087-4eea-a806-e2957cd0d09d', group_name, course_name, 'Anexo 03', validity, notes
from (values
  ('Todos os grupos', 'NR-06 - Equipamentos de Proteção Individual', null::int, 'Integração e uso, guarda e conservação de EPI.'),
  ('Eletricista de Linha Morta', 'NR-10 - Segurança em Instalações e Serviços em Eletricidade', 24, 'Treinamento e reciclagem conforme exigência aplicável.'),
  ('Eletricista de Linha Viva', 'NR-10 - SEP e trabalho em proximidade', 24, 'Aplicável às atividades em redes energizadas.'),
  ('Eletricista de Linha Viva', 'Treinamento específico de Linha Viva', 24, 'Procedimentos e técnicas de linha viva.'),
  ('Todos os grupos', 'NR-35 - Trabalho em Altura', 24, 'Aplicável a atividades com risco de queda.'),
  ('Operador de Guindauto', 'NR-11 - Operação e movimentação de cargas', 24, 'Aplicável à operação de guindauto e movimentação.'),
  ('Operador de Guindauto', 'NR-12 - Segurança em máquinas e equipamentos', 24, 'Aplicável ao equipamento utilizado.'),
  ('Todos os grupos', 'Direção defensiva', 24, 'Aplicável aos condutores e equipes que utilizam veículos.'),
  ('Todos os grupos', 'Primeiros socorros e atendimento a emergências', 24, 'Capacitação prevista para resposta a emergências.'),
  ('Poda', 'Treinamento de poda e operação de motosserra/motopoda', 24, 'Aplicável às equipes de poda.'),
  ('Motociclista', 'Direção segura de motocicleta', 24, 'Aplicável ao deslocamento e execução das atividades.'),
  ('Todos os grupos', 'Integração de segurança da contratante', 12, 'Integração antes do início das atividades.')
) as seed(group_name, course_name, validity, notes)
on conflict (organization_id, function_group, course_name) do update set validity_months = excluded.validity_months, notes = excluded.notes;
