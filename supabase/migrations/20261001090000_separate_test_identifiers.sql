-- Identificador próprio do ensaio, separado do identificador de cada material entregue.
create sequence if not exists public.material_test_identifier_seq;

alter table public.material_tests add column if not exists test_number text;
alter table public.material_lots add column if not exists test_number text;
alter table public.material_units add column if not exists test_number text;

create unique index if not exists material_tests_org_test_number_idx
  on public.material_tests(organization_id, test_number)
  where test_number is not null;
create unique index if not exists material_lots_org_test_number_idx
  on public.material_lots(organization_id, test_number)
  where test_number is not null;

create or replace function private.assign_material_test_number()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if new.test_number is null and exists (
    select 1 from public.materials
    where id = new.material_id and organization_id = new.organization_id and test_required
  ) then
    new.test_number := 'ENSAIO-' || lpad(nextval('public.material_test_identifier_seq')::text, 8, '0');
  end if;
  return new;
end;
$$;

create or replace function private.assign_lot_test_number()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if new.test_number is null and exists (
    select 1 from public.materials
    where id = new.material_id and organization_id = new.organization_id and test_required
  ) then
    new.test_number := 'ENSAIO-' || lpad(nextval('public.material_test_identifier_seq')::text, 8, '0');
  end if;
  return new;
end;
$$;

create or replace function private.assign_unit_test_number()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if new.test_number is null and new.lot_number is not null then
    select test_number into new.test_number
    from public.material_lots
    where organization_id = new.organization_id and material_id = new.material_id and lot_number = new.lot_number
    order by created_at desc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists material_tests_assign_number on public.material_tests;
create trigger material_tests_assign_number before insert on public.material_tests
for each row execute function private.assign_material_test_number();

drop trigger if exists material_lots_assign_number on public.material_lots;
create trigger material_lots_assign_number before insert on public.material_lots
for each row execute function private.assign_lot_test_number();

drop trigger if exists material_units_assign_number on public.material_units;
create trigger material_units_assign_number before insert on public.material_units
for each row execute function private.assign_unit_test_number();

update public.material_tests
set test_number = 'ENSAIO-' || lpad(nextval('public.material_test_identifier_seq')::text, 8, '0')
where test_number is null;

update public.material_lots lot
set test_number = 'ENSAIO-' || lpad(nextval('public.material_test_identifier_seq')::text, 8, '0')
where test_number is null
  and exists (select 1 from public.materials material where material.id = lot.material_id and material.organization_id = lot.organization_id and material.test_required);

update public.material_units unit
set test_number = lot.test_number
from public.material_lots lot
where unit.test_number is null
  and lot.organization_id = unit.organization_id
  and lot.material_id = unit.material_id
  and lot.lot_number = unit.lot_number;
