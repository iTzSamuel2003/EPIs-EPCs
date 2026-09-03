create table public.function_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  source_document text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.function_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.function_templates(id) on delete cascade,
  material_name text not null,
  quantity int not null check (quantity > 0),
  item_type text not null default 'EPI' check (item_type in ('EPI', 'FERRAMENTAL')),
  created_at timestamptz not null default now(),
  unique (template_id, material_name)
);

create index function_templates_org_idx on public.function_templates(organization_id);
create index function_template_items_template_idx on public.function_template_items(template_id);

alter table public.function_templates enable row level security;
alter table public.function_template_items enable row level security;
create policy "organization members can access function templates" on public.function_templates for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());
create policy "organization members can access function template items" on public.function_template_items for all to authenticated using (organization_id = private.current_organization_id()) with check (organization_id = private.current_organization_id());

do $$
declare
  v_org uuid := '4dc792c1-5087-4eea-a806-e2957cd0d09d';
  v_template uuid;
  v_item jsonb;
begin
  insert into public.function_templates (organization_id, name, source_document) values (v_org, 'Ajudante de poda', 'FICHA DE EPI -Ajudante de PODA.docx') returning id into v_template;
  for v_item in select * from jsonb_array_elements('[
    {"name":"Conjunto anti-chamas","quantity":5,"type":"EPI"},{"name":"Capacete aba total","quantity":1,"type":"EPI"},{"name":"Perneira","quantity":1,"type":"EPI"},{"name":"Óculos de proteção","quantity":1,"type":"EPI"},{"name":"Calçado de segurança","quantity":2,"type":"EPI"},{"name":"Luva de vaqueta","quantity":1,"type":"EPI"},{"name":"Balaclava","quantity":2,"type":"EPI"},{"name":"Óculos incolor","quantity":1,"type":"EPI"},{"name":"Capa de chuva","quantity":1,"type":"EPI"},{"name":"Bota de borracha","quantity":1,"type":"EPI"},{"name":"Protetor solar","quantity":1,"type":"EPI"}
  ]'::jsonb) loop insert into public.function_template_items (organization_id, template_id, material_name, quantity, item_type) values (v_org, v_template, v_item->>'name', (v_item->>'quantity')::int, v_item->>'type'); end loop;

  insert into public.function_templates (organization_id, name, source_document) values (v_org, 'Eletricista de linha viva', 'FICHA DE EPI - MODELO linha viva .docx') returning id into v_template;
  for v_item in select * from jsonb_array_elements('[
    {"name":"Conjunto anti-chamas","quantity":5,"type":"EPI"},{"name":"Calçado de segurança","quantity":2,"type":"EPI"},{"name":"Capacete aba total","quantity":1,"type":"EPI"},{"name":"Luva de vaqueta","quantity":2,"type":"EPI"},{"name":"Perneira","quantity":1,"type":"EPI"},{"name":"Óculos cinza","quantity":1,"type":"EPI"},{"name":"Óculos incolor","quantity":1,"type":"EPI"},{"name":"Balaclava","quantity":2,"type":"EPI"},{"name":"Bota de borracha","quantity":1,"type":"EPI"},{"name":"Luva isolante classe 2","quantity":1,"type":"EPI"},{"name":"Luva isolante classe 4","quantity":1,"type":"EPI"},{"name":"Luva de cobertura","quantity":2,"type":"EPI"},{"name":"Manga isolante classe 2","quantity":1,"type":"EPI"},{"name":"Manga isolante classe 4","quantity":1,"type":"EPI"},{"name":"Protetor solar","quantity":1,"type":"EPI"},{"name":"Cinto linha viva","quantity":1,"type":"EPI"},{"name":"Bolsa de serviço","quantity":1,"type":"FERRAMENTAL"},{"name":"Bolsa de lona para luvas e mangas","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave inglesa ajustável 12","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave inglesa ajustável 8","quantity":1,"type":"FERRAMENTAL"},{"name":"Faca curva","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave combinada 1/2 isolada","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave boca fixa 6-32","quantity":1,"type":"FERRAMENTAL"},{"name":"Alicate bomba d''água","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave de fenda","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave Phillips","quantity":1,"type":"FERRAMENTAL"},{"name":"Alicate universal","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave catraca 3","quantity":1,"type":"FERRAMENTAL"},{"name":"Bolsa para capacete","quantity":1,"type":"FERRAMENTAL"},{"name":"Estojo para óculos","quantity":2,"type":"FERRAMENTAL"}
  ]'::jsonb) loop insert into public.function_template_items (organization_id, template_id, material_name, quantity, item_type) values (v_org, v_template, v_item->>'name', (v_item->>'quantity')::int, v_item->>'type'); end loop;

  insert into public.function_templates (organization_id, name, source_document) values (v_org, 'Motorista operador de Munck', 'FICHA DE EPI -Motorista LM- JACO.docx') returning id into v_template;
  for v_item in select * from jsonb_array_elements('[
    {"name":"Conjunto anti-chamas","quantity":5,"type":"EPI"},{"name":"Calçado de segurança","quantity":2,"type":"EPI"},{"name":"Capacete aba total","quantity":1,"type":"EPI"},{"name":"Óculos de proteção","quantity":1,"type":"EPI"},{"name":"Perneira","quantity":1,"type":"EPI"},{"name":"Luva de vaqueta","quantity":1,"type":"EPI"},{"name":"Balaclava","quantity":2,"type":"EPI"},{"name":"Óculos incolor","quantity":1,"type":"EPI"},{"name":"Bota de borracha","quantity":1,"type":"EPI"},{"name":"Luva de cobertura","quantity":2,"type":"EPI"},{"name":"Luva isolante classe 4","quantity":1,"type":"EPI"},{"name":"Luva isolante classe 2","quantity":1,"type":"EPI"},{"name":"Bolsa para mangas e luvas","quantity":1,"type":"FERRAMENTAL"},{"name":"Capa de chuva","quantity":1,"type":"EPI"},{"name":"Protetor solar","quantity":1,"type":"EPI"}
  ]'::jsonb) loop insert into public.function_template_items (organization_id, template_id, material_name, quantity, item_type) values (v_org, v_template, v_item->>'name', (v_item->>'quantity')::int, v_item->>'type'); end loop;

  insert into public.function_templates (organization_id, name, source_document) values (v_org, 'Encarregado LM', 'FICHA DE EPI - Encarregado LM (1).docx') returning id into v_template;
  for v_item in select * from jsonb_array_elements('[
    {"name":"Conjunto anti-chamas","quantity":5,"type":"EPI"},{"name":"Calçado de segurança","quantity":2,"type":"EPI"},{"name":"Perneira","quantity":1,"type":"EPI"},{"name":"Óculos de proteção","quantity":1,"type":"EPI"},{"name":"Capacete aba total","quantity":1,"type":"EPI"},{"name":"Luva de vaqueta","quantity":3,"type":"EPI"},{"name":"Capa de chuva","quantity":1,"type":"EPI"},{"name":"Bota de borracha","quantity":1,"type":"EPI"},{"name":"Protetor solar","quantity":1,"type":"EPI"},{"name":"Balaclava","quantity":2,"type":"EPI"}
  ]'::jsonb) loop insert into public.function_template_items (organization_id, template_id, material_name, quantity, item_type) values (v_org, v_template, v_item->>'name', (v_item->>'quantity')::int, v_item->>'type'); end loop;

  insert into public.function_templates (organization_id, name, source_document) values (v_org, 'Eletricista de linha morta I', 'FICHA DE EPI -ELETRICISTA LM - DIONE.docx') returning id into v_template;
  for v_item in select * from jsonb_array_elements('[
    {"name":"Conjunto anti-chamas","quantity":5,"type":"EPI"},{"name":"Calçado de segurança","quantity":2,"type":"EPI"},{"name":"Capacete aba total","quantity":1,"type":"EPI"},{"name":"Óculos de proteção","quantity":1,"type":"EPI"},{"name":"Perneira","quantity":1,"type":"EPI"},{"name":"Cinto tipo paraquedista","quantity":1,"type":"EPI"},{"name":"Talabarte","quantity":1,"type":"EPI"},{"name":"Trava-quedas","quantity":1,"type":"EPI"},{"name":"Luva de vaqueta","quantity":1,"type":"EPI"},{"name":"Luva de cobertura","quantity":2,"type":"EPI"},{"name":"Manga isolante classe 2","quantity":1,"type":"EPI"},{"name":"Luva isolante classe 2","quantity":1,"type":"EPI"},{"name":"Luva isolante classe 0","quantity":1,"type":"EPI"},{"name":"Balaclava","quantity":2,"type":"EPI"},{"name":"Bota de borracha","quantity":1,"type":"EPI"},{"name":"Capa de chuva","quantity":1,"type":"EPI"},{"name":"Protetor solar","quantity":1,"type":"EPI"},{"name":"Bolsa para EPI","quantity":2,"type":"FERRAMENTAL"},{"name":"Balde de içamento","quantity":1,"type":"FERRAMENTAL"},{"name":"Arco de serra","quantity":1,"type":"FERRAMENTAL"},{"name":"Alicate bomba d''água","quantity":1,"type":"FERRAMENTAL"},{"name":"Alicate universal","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave inglesa 8","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave inglesa 12","quantity":1,"type":"FERRAMENTAL"},{"name":"Marreta","quantity":1,"type":"FERRAMENTAL"},{"name":"Agulhão","quantity":1,"type":"FERRAMENTAL"},{"name":"Gancho de ancoragem","quantity":1,"type":"FERRAMENTAL"},{"name":"Corda de linha de vida","quantity":1,"type":"FERRAMENTAL"},{"name":"Corda de serviço","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave de fenda isolada","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave Phillips isolada","quantity":1,"type":"FERRAMENTAL"},{"name":"Kit ABS","quantity":1,"type":"FERRAMENTAL"},{"name":"Chave 13 combinada","quantity":1,"type":"FERRAMENTAL"},{"name":"Bolsa para manga e luva","quantity":1,"type":"FERRAMENTAL"},{"name":"Faca curva com bainha","quantity":1,"type":"FERRAMENTAL"},{"name":"Mosquetão","quantity":4,"type":"FERRAMENTAL"},{"name":"Carretilha","quantity":1,"type":"FERRAMENTAL"},{"name":"Capa de capacete","quantity":1,"type":"FERRAMENTAL"},{"name":"Bolsa de corda","quantity":1,"type":"FERRAMENTAL"},{"name":"Porta-óculos","quantity":2,"type":"FERRAMENTAL"}
  ]'::jsonb) loop insert into public.function_template_items (organization_id, template_id, material_name, quantity, item_type) values (v_org, v_template, v_item->>'name', (v_item->>'quantity')::int, v_item->>'type'); end loop;

end $$;

