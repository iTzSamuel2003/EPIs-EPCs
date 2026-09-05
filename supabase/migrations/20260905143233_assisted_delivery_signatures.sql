alter table public.deliveries add column if not exists term_signature_method text check (term_signature_method in ('physical_upload', 'assisted'));
alter table public.deliveries add column if not exists term_signed_at timestamptz;
alter table public.deliveries add column if not exists term_signer_name text;
alter table public.deliveries add column if not exists term_signer_cpf text;
