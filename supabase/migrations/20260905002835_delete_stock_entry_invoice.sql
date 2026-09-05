create or replace function public.delete_stock_entry_invoice(p_invoice_id uuid)
returns text
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_org uuid := private.current_organization_id();
  v_file_path text;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  select file_path into v_file_path
  from public.stock_invoices
  where id = p_invoice_id and organization_id = v_org
  for update;
  if not found then raise exception 'Nota fiscal não encontrada'; end if;
  if exists (
    select 1 from public.material_lots
    where invoice_id = p_invoice_id and received_quantity <> available_quantity
  ) then
    raise exception 'Não é possível excluir uma entrada com materiais já entregues. Corrija a quantidade ou registre a devolução.';
  end if;

  delete from public.stock_movements
  where lot_id in (select id from public.material_lots where invoice_id = p_invoice_id);
  delete from public.material_lots where invoice_id = p_invoice_id;
  delete from public.stock_invoices where id = p_invoice_id and organization_id = v_org;
  return v_file_path;
end;
$$;

revoke all on function public.delete_stock_entry_invoice(uuid) from public;
grant execute on function public.delete_stock_entry_invoice(uuid) to authenticated;
