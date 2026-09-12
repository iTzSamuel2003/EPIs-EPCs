create or replace function public.get_validity_alert_count()
returns bigint
language sql
stable
security invoker
set search_path = public, private
as $$
  select count(distinct material_id)
  from (
    select ml.material_id
    from public.material_lots ml
    join public.organizations organization_row on organization_row.id = ml.organization_id
    where ml.organization_id = private.current_organization_id()
      and ml.available_quantity > 0
      and ml.expires_at is not null
      and ml.expires_at <= current_date + organization_row.validity_alert_days
    union all
    select di.material_id
    from public.delivery_items di
    join public.material_lots ml on ml.id = di.lot_id
    join public.organizations organization_row on organization_row.id = di.organization_id
    left join (
      select organization_id, delivery_item_id, sum(quantity) as returned_quantity
      from public.return_items
      group by organization_id, delivery_item_id
    ) returned on returned.organization_id = di.organization_id
      and returned.delivery_item_id = di.id
    where di.organization_id = private.current_organization_id()
      and di.quantity > coalesce(returned.returned_quantity, 0)
      and ml.expires_at is not null
      and ml.expires_at <= current_date + organization_row.validity_alert_days
  ) alerts;
$$;

revoke all on function public.get_validity_alert_count() from public, anon;
grant execute on function public.get_validity_alert_count() to authenticated;
