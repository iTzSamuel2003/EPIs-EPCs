create table if not exists public.ca_certificates (
  ca_number text primary key,
  status text,
  valid_until date,
  process_number text,
  manufacturer_document text,
  manufacturer_name text,
  equipment_name text,
  equipment_description text,
  brand text,
  reference text,
  color text,
  approved_for_report text,
  report_restriction text,
  report_analysis_notes text,
  laboratory_document text,
  laboratory_name text,
  report_number text,
  standard text,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ca_certificates_status_idx on public.ca_certificates(status);
create index if not exists ca_certificates_valid_until_idx on public.ca_certificates(valid_until);
create index if not exists ca_certificates_equipment_name_idx on public.ca_certificates using gin (to_tsvector('simple', coalesce(equipment_name, '')));
create index if not exists ca_certificates_manufacturer_name_idx on public.ca_certificates using gin (to_tsvector('simple', coalesce(manufacturer_name, '')));

alter table public.ca_certificates enable row level security;

drop policy if exists "authenticated users can consult CA registry" on public.ca_certificates;
create policy "authenticated users can consult CA registry"
  on public.ca_certificates
  for select
  to authenticated
  using (true);

grant select on public.ca_certificates to authenticated;

create or replace function public.touch_ca_certificate_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.synced_at = now();
  return new;
end;
$$;

drop trigger if exists ca_certificates_touch_updated_at on public.ca_certificates;
create trigger ca_certificates_touch_updated_at
before update on public.ca_certificates
for each row execute function public.touch_ca_certificate_updated_at();
