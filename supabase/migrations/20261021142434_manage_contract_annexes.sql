create table public.organization_annex_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  annex_number text not null check (annex_number ~ '^[0-9]{2}$'),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, annex_number)
);

alter table public.organization_annex_settings enable row level security;

grant select, insert, update on public.organization_annex_settings to authenticated;

create policy "organization members read annex settings"
  on public.organization_annex_settings
  for select to authenticated
  using (organization_id = private.current_organization_id());

create policy "organization admins and tst manage annex settings"
  on public.organization_annex_settings
  for all to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'tst'])
  )
  with check (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'tst'])
  );

create or replace function private.enforce_enabled_contract_annex_on_stock_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_annex_number text;
begin
  select coalesce(
    lpad((regexp_match(m.contract_item_code, '^A([0-9]{1,2})[-.]', 'i'))[1], 2, '0'),
    lpad((regexp_match(m.contract_source, 'anexo[[:space:]]*(n[º°.]?[[:space:]]*)?([0-9]{1,2})', 'i'))[2], 2, '0')
  )
  into v_annex_number
  from public.materials as m
  where m.id = new.material_id
    and m.organization_id = new.organization_id;

  if v_annex_number is not null and exists (
    select 1
    from public.organization_annex_settings as settings
    where settings.organization_id = new.organization_id
      and settings.annex_number = v_annex_number
      and settings.active = false
  ) then
    raise exception 'O Anexo % está desativado. Reative-o em Materiais para registrar uma nova entrada.', v_annex_number;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_enabled_contract_annex_on_stock_entry() from public, anon, authenticated;

create trigger enforce_enabled_contract_annex_on_stock_entry
  before insert on public.material_lots
  for each row execute function private.enforce_enabled_contract_annex_on_stock_entry();
