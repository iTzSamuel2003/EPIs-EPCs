-- Ãndices para as consultas mais frequentes das listas e filtros do sistema.
-- Todos comeÃ§am pela organizaÃ§Ã£o porque o RLS restringe os dados por organizaÃ§Ã£o.
create index if not exists materials_org_name_idx
  on public.materials(organization_id, name);

create index if not exists materials_org_type_status_idx
  on public.materials(organization_id, type, status);

create index if not exists employees_org_status_name_idx
  on public.employees(organization_id, status, full_name);

create index if not exists lots_org_material_available_idx
  on public.material_lots(organization_id, material_id, available_quantity);

create index if not exists lots_org_expiry_available_idx
  on public.material_lots(organization_id, expires_at, available_quantity)
  where available_quantity > 0;

create index if not exists delivery_items_delivery_created_idx
  on public.delivery_items(delivery_id, created_at desc);

create index if not exists returns_items_delivery_item_idx
  on public.return_items(delivery_item_id);

