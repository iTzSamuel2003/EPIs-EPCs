do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.register_delivery(uuid, text, date, jsonb, text)'::regprocedure)
    into function_definition;
  function_definition := regexp_replace(function_definition, '\s+unit_number\s+(integer|int)\s*;', '', 1, 0, 'i');
  execute function_definition;
end;
$$;

revoke all on function public.register_delivery(uuid, text, date, jsonb, text) from public;
grant execute on function public.register_delivery(uuid, text, date, jsonb, text) to authenticated;
