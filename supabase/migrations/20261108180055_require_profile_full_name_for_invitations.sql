create or replace function public.accept_organization_invitation(p_token text, p_full_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_full_name text := nullif(btrim(p_full_name), '');
begin
  if v_full_name is null then
    raise exception 'Informe seu nome completo';
  end if;
  if char_length(v_full_name) > 200 then
    raise exception 'O nome completo deve ter no máximo 200 caracteres';
  end if;

  return private.accept_organization_invitation_internal(p_token, v_full_name);
end;
$function$;

create or replace function public.accept_my_pending_organization_invitation(p_full_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_full_name text := nullif(btrim(p_full_name), '');
begin
  if v_full_name is null then
    raise exception 'Informe seu nome completo';
  end if;
  if char_length(v_full_name) > 200 then
    raise exception 'O nome completo deve ter no máximo 200 caracteres';
  end if;

  return private.accept_organization_invitation_internal(null, v_full_name);
end;
$function$;
