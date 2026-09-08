alter table public.materials
  add column if not exists size text;

comment on column public.materials.size is
  'Tamanho, numeração ou característica da variação principal do material.';
