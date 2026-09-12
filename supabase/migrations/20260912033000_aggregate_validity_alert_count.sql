create or replace function public.get_validity_alert_count()
returns bigint
language sql
stable
security invoker
set search_path = public, private
as $$
  select count(*)
  from (
    select ml.material_id
    from public.material_lots ml
    where ml.organization_id = private.current_organization_id()
      and ml.available_quantity > 0
      and ml.expires_at is not null
      and ml.expires_at <= current_date + 30
    union
    select ml.material_id
    from public.delivery_items di
    join public.material_lots ml on ml.id = di.lot_id
    where di.organization_id = private.current_organization_id()
      and di.quantity > coalesce((
        select sum(ri.quantity)
        from public.return_items ri
        where ri.delivery_item_id = di.id
      ), 0)
      and ml.expires_at is not null
      and ml.expires_at <= current_date + 30
  ) alerts;
$$;

revoke all on function public.get_validity_alert_count() from public, anon;
grant execute on function public.get_validity_alert_count() to authenticated;
