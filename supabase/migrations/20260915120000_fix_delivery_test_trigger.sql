-- Atualiza o gatilho legado para validar a validade do ensaio correta.
create or replace function public.require_test_validity_on_delivery_item()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.materials m where m.id = new.material_id and m.test_required = true)
     and new.test_expires_at is null then
    raise exception 'Informe a data de validade do ensaio antes de entregar este material';
  end if;
  return new;
end;
$$;
