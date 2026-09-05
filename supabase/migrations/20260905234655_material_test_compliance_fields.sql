alter table public.material_tests
  add column if not exists professional_registration text,
  add column if not exists art_number text,
  add column if not exists report_reference text,
  add column if not exists report_url text;
