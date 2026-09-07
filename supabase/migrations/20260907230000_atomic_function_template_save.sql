create or replace function public.save_function_template(
  p_template_id uuid,
  p_name text,
  p_source_document text,
  p_contract_scenario_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_org uuid := private.current_organization_id();
  v_template_id uuid := p_template_id;
  v_item jsonb;
  v_material_id uuid;
  v_name text;
  v_quantity int;
  v_type text;
begin
  if v_org is null then raise exception 'Usuário sem organização vinculada'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Informe o nome da função'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Adicione ao menos um material'; end if;

  if v_template_id is null then
    insert into public.function_templates (organization_id, name, source_document, contract_scenario_id)
    values (v_org, trim(p_name), nullif(trim(p_source_document), ''), p_contract_scenario_id)
    returning id into v_template_id;
  else
    update public.function_templates
      set name = trim(p_name), source_document = nullif(trim(p_source_document), ''), contract_scenario_id = p_contract_scenario_id
      where id = v_template_id and organization_id = v_org;
    if not found then raise exception 'Lista por função não encontrada'; end if;
    delete from public.function_template_items where template_id = v_template_id and organization_id = v_org;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_material_id := nullif(v_item->>'material_id', '')::uuid;
    v_name := nullif(trim(v_item->>'material_name'), '');
    v_quantity := (v_item->>'quantity')::int;
    v_type := coalesce(nullif(v_item->>'item_type', ''), 'EPI');
    if v_name is null or v_quantity is null or v_quantity <= 0 then raise exception 'Material ou quantidade inválida'; end if;
    if v_material_id is not null and not exists (select 1 from public.materials where id = v_material_id and organization_id = v_org and status = 'active') then raise exception 'Material não encontrado na organização'; end if;
    insert into public.function_template_items (organization_id, template_id, material_id, material_name, quantity, item_type)
      values (v_org, v_template_id, v_material_id, v_name, v_quantity, v_type);
  end loop;
  return v_template_id;
end;
$$;

revoke all on function public.save_function_template(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.save_function_template(uuid, text, text, uuid, jsonb) to authenticated;
