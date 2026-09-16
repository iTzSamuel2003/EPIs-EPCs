alter table public.returns add column if not exists term_file_path text;
alter table public.returns add column if not exists term_uploaded_at timestamptz;
alter table public.returns add column if not exists term_uploaded_by uuid references auth.users(id);
alter table public.returns add column if not exists term_signature_method text check (term_signature_method in ('physical_upload', 'assisted'));
alter table public.returns add column if not exists term_signed_at timestamptz;
alter table public.returns add column if not exists term_signer_name text;
alter table public.returns add column if not exists term_signer_cpf text;
