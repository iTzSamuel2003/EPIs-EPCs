alter table public.deliveries
  drop constraint if exists deliveries_term_signature_method_check;
alter table public.deliveries
  add constraint deliveries_term_signature_method_check
  check (term_signature_method in ('physical_upload', 'assisted', 'whatsapp_link'));

alter table public.returns
  drop constraint if exists returns_term_signature_method_check;
alter table public.returns
  add constraint returns_term_signature_method_check
  check (term_signature_method in ('physical_upload', 'assisted', 'whatsapp_link'));

create table public.term_signature_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  delivery_id uuid references public.deliveries(id) on delete cascade,
  return_id uuid references public.returns(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accessed_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  signer_name text,
  signer_cpf text,
  signature_file_path text,
  check ((delivery_id is not null) <> (return_id is not null)),
  check (expires_at > created_at),
  check (revoked_at is null or used_at is null)
);

create index term_signature_links_delivery_idx
  on public.term_signature_links (organization_id, delivery_id, created_at desc)
  where delivery_id is not null;
create index term_signature_links_return_idx
  on public.term_signature_links (organization_id, return_id, created_at desc)
  where return_id is not null;

alter table public.term_signature_links enable row level security;
create policy "organization members can view term signature links"
  on public.term_signature_links for select to authenticated
  using (organization_id = private.current_organization_id());

revoke all on public.term_signature_links from public, anon, authenticated;
revoke insert, update, delete on public.term_signature_links from authenticated;
grant select on public.term_signature_links to authenticated;
grant select, insert, update on public.term_signature_links to service_role;

create or replace function public.record_term_signature_failure(p_link_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  update public.term_signature_links
  set failed_attempts = failed_attempts + 1,
      locked_until = case
        when failed_attempts + 1 >= 5 then clock_timestamp() + interval '15 minutes'
        else locked_until
      end
  where id = p_link_id
    and used_at is null
    and revoked_at is null
  returning failed_attempts into v_attempts;

  return coalesce(v_attempts, 0);
end;
$$;

revoke all on function public.record_term_signature_failure(uuid) from public, anon, authenticated;
grant execute on function public.record_term_signature_failure(uuid) to service_role;

create or replace function public.complete_employee_term_signature(
  p_link_id uuid,
  p_signature_file_path text,
  p_signer_name text,
  p_signer_cpf text
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link public.term_signature_links;
  v_signed_at timestamptz := clock_timestamp();
  v_record_id uuid;
begin
  select * into v_link
  from public.term_signature_links
  where id = p_link_id
  for update;

  if v_link.id is null
    or v_link.expires_at <= v_signed_at
    or v_link.used_at is not null
    or v_link.revoked_at is not null
    or (v_link.locked_until is not null and v_link.locked_until > v_signed_at) then
    raise exception 'Link de assinatura inválido, expirado ou já utilizado';
  end if;

  if nullif(trim(p_signer_name), '') is null
    or length(trim(p_signer_name)) > 160
    or p_signer_cpf is null
    or p_signer_cpf !~ '^[0-9]{11}$'
    or p_signature_file_path is null then
    raise exception 'Dados da assinatura inválidos';
  end if;

  if p_signature_file_path not like v_link.organization_id::text || '/' ||
      coalesce(v_link.delivery_id, v_link.return_id)::text || '/whatsapp-signature-%' then
    raise exception 'Arquivo de assinatura fora do caminho permitido';
  end if;

  if not exists (
    select 1 from public.employees e
    where e.id = v_link.employee_id
      and e.organization_id = v_link.organization_id
      and regexp_replace(e.cpf, '[^0-9]', '', 'g') = p_signer_cpf
      and lower(regexp_replace(trim(e.full_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(p_signer_name), '\s+', ' ', 'g'))
  ) then
    raise exception 'Dados do colaborador não correspondem';
  end if;

  if v_link.delivery_id is not null then
    update public.deliveries
    set term_file_path = p_signature_file_path,
        term_uploaded_at = v_signed_at,
        term_uploaded_by = null,
        term_signature_method = 'whatsapp_link',
        term_signed_at = v_signed_at,
        term_signer_name = trim(p_signer_name),
        term_signer_cpf = p_signer_cpf
    where id = v_link.delivery_id
      and organization_id = v_link.organization_id
      and employee_id = v_link.employee_id
      and term_signed_at is null
    returning id into v_record_id;
  else
    update public.returns
    set term_file_path = p_signature_file_path,
        term_uploaded_at = v_signed_at,
        term_uploaded_by = null,
        term_signature_method = 'whatsapp_link',
        term_signed_at = v_signed_at,
        term_signer_name = trim(p_signer_name),
        term_signer_cpf = p_signer_cpf
    where id = v_link.return_id
      and organization_id = v_link.organization_id
      and employee_id = v_link.employee_id
      and term_signed_at is null
    returning id into v_record_id;
  end if;

  if v_record_id is null then
    raise exception 'A ficha já foi assinada ou não está mais disponível';
  end if;

  update public.term_signature_links
  set used_at = v_signed_at,
      signer_name = trim(p_signer_name),
      signer_cpf = p_signer_cpf,
      signature_file_path = p_signature_file_path
  where id = v_link.id;

  update public.term_signature_links
  set revoked_at = v_signed_at
  where organization_id = v_link.organization_id
    and id <> v_link.id
    and used_at is null
    and revoked_at is null
    and ((v_link.delivery_id is not null and delivery_id = v_link.delivery_id)
      or (v_link.return_id is not null and return_id = v_link.return_id));

  return v_signed_at;
end;
$$;

revoke all on function public.complete_employee_term_signature(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_employee_term_signature(uuid, text, text, text) to service_role;
