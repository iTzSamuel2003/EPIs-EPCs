alter table public.function_template_items
  add column if not exists material_id uuid references public.materials(id) on delete set null;

create index if not exists function_template_items_material_idx
  on public.function_template_items(organization_id, material_id);

update public.function_template_items item
set material_id = material.id
from public.materials material
where item.material_id is null
  and item.organization_id = material.organization_id
  and lower(trim(item.material_name)) = lower(trim(material.name));
