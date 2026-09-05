create table public.transaction_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid references public.deliveries(id) on delete cascade,
  return_id uuid references public.returns(id) on delete cascade,
  attachment_type text not null check (attachment_type in ('delivery', 'return')),
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((attachment_type = 'delivery' and delivery_id is not null and return_id is null) or (attachment_type = 'return' and return_id is not null and delivery_id is null))
);

create index transaction_attachments_delivery_idx on public.transaction_attachments(delivery_id, created_at desc);
create index transaction_attachments_return_idx on public.transaction_attachments(return_id, created_at desc);

alter table public.transaction_attachments enable row level security;
create policy "organization members can access transaction attachments" on public.transaction_attachments for all to authenticated
using (organization_id = private.current_organization_id())
with check (organization_id = private.current_organization_id());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transaction-photos', 'transaction-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "organization members can read transaction photos" on storage.objects for select to authenticated
using (bucket_id = 'transaction-photos' and (storage.foldername(name))[1] = private.current_organization_id()::text);

create policy "organization members can upload transaction photos" on storage.objects for insert to authenticated
with check (bucket_id = 'transaction-photos' and (storage.foldername(name))[1] = private.current_organization_id()::text);

create policy "organization members can delete transaction photos" on storage.objects for delete to authenticated
using (bucket_id = 'transaction-photos' and (storage.foldername(name))[1] = private.current_organization_id()::text);
