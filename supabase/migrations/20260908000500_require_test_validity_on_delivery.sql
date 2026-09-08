create or replace function public.require_test_validity_on_delivery_item()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from public.materials m
    where m.id = new.material_id
      and m.test_required = true
  ) and new.expected_replacement_at is null then
    raise exception 'Informe a data de validade do ensaio antes de entregar este material';
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_items_require_test_validity on public.delivery_items;
create trigger delivery_items_require_test_validity
before insert or update of material_id, expected_replacement_at on public.delivery_items
for each row execute function public.require_test_validity_on_delivery_item();

revoke all on function public.require_test_validity_on_delivery_item() from public;
grant execute on function public.require_test_validity_on_delivery_item() to authenticated;
