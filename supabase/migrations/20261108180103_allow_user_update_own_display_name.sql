create or replace function private.update_my_profile_full_name_internal(p_full_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_full_name text := nullif(btrim(p_full_name), '');
begin
  if v_user_id is null then
    raise exception 'Entre novamente para atualizar seu perfil';
  end if;
  if v_full_name is null then
    raise exception 'Informe seu nome completo';
  end if;
  if char_length(v_full_name) > 200 then
    raise exception 'O nome completo deve ter no máximo 200 caracteres';
  end if;

  update public.profiles
  set full_name = v_full_name
  where id = v_user_id;

  if not found then
    raise exception 'Não foi possível localizar seu perfil';
  end if;

  return v_full_name;
end;
$function$;

revoke all on function private.update_my_profile_full_name_internal(text) from public, anon, authenticated;
grant execute on function private.update_my_profile_full_name_internal(text) to authenticated;

create or replace function public.update_my_profile_full_name(p_full_name text)
returns text
language sql
security invoker
set search_path = ''
as $function$
  select private.update_my_profile_full_name_internal(p_full_name)
$function$;

revoke all on function public.update_my_profile_full_name(text) from public, anon;
grant execute on function public.update_my_profile_full_name(text) to authenticated;
