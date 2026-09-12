do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.register_delivery(uuid, text, date, jsonb, text)'::regprocedure)
    into function_definition;
  function_definition := regexp_replace(function_definition, '\s+v_unit_no\s+(integer|int)\s*;', '', 1, 0, 'i');
  function_definition := replace(function_definition, 'FOR v_unit_no IN', 'FOR unit_number IN');
  execute function_definition;
end;
$$;

revoke all on function public.register_delivery(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_delivery(uuid, text, date, jsonb, text) to authenticated;
