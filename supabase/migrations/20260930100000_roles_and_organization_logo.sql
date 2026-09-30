-- Perfis operacionais e identidade visual da organização.
alter type public.app_role add value if not exists 'rh';
alter type public.app_role add value if not exists 'tst';

create or replace function private.has_current_organization_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and organization_id is not null
      and role::text = any(p_roles)
  );
$$;

revoke all on function private.has_current_organization_role(text[]) from public, anon, authenticated;
grant execute on function private.has_current_organization_role(text[]) to authenticated;

drop policy if exists "organization admins manage profiles" on public.profiles;
create policy "organization admins manage profiles"
on public.profiles for update to authenticated
using (organization_id = private.current_organization_id() and private.is_current_organization_admin())
with check (organization_id = private.current_organization_id() and private.is_current_organization_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-logos', 'organization-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "organization members read logos" on storage.objects;
create policy "organization members read logos" on storage.objects for select to authenticated
using (bucket_id = 'organization-logos' and (storage.foldername(name))[1] = private.current_organization_id()::text);

drop policy if exists "organization admins upload logos" on storage.objects;
create policy "organization admins upload logos" on storage.objects for insert to authenticated
with check (bucket_id = 'organization-logos' and (storage.foldername(name))[1] = private.current_organization_id()::text and private.is_current_organization_admin());

drop policy if exists "organization admins update logos" on storage.objects;
create policy "organization admins update logos" on storage.objects for update to authenticated
using (bucket_id = 'organization-logos' and (storage.foldername(name))[1] = private.current_organization_id()::text and private.is_current_organization_admin())
with check (bucket_id = 'organization-logos' and (storage.foldername(name))[1] = private.current_organization_id()::text and private.is_current_organization_admin());

drop policy if exists "organization admins delete logos" on storage.objects;
create policy "organization admins delete logos" on storage.objects for delete to authenticated
using (bucket_id = 'organization-logos' and (storage.foldername(name))[1] = private.current_organization_id()::text and private.is_current_organization_admin());

-- RH controla pessoas e documentos operacionais; TST controla estoque e conformidade técnica.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['employees','employee_profiles','employee_courses','deliveries','delivery_items','returns','return_items','return_accountability','employee_portal_requests','employee_measurement_requests','transaction_attachments'] loop
    execute format('drop policy if exists "rh manages operational data" on public.%I', table_name);
    execute format('create policy "rh manages operational data" on public.%I for all to authenticated using (organization_id = private.current_organization_id() and private.has_current_organization_role(array[''admin'',''rh''])) with check (organization_id = private.current_organization_id() and private.has_current_organization_role(array[''admin'',''rh'']))', table_name);
  end loop;
  foreach table_name in array array['materials','categories','suppliers','material_lots','stock_movements','material_tests','material_variants','material_units','contract_requirements','contract_scenarios','function_templates','function_template_items','function_aliases','contract_training_requirements'] loop
    execute format('drop policy if exists "tst manages technical data" on public.%I', table_name);
    execute format('create policy "tst manages technical data" on public.%I for all to authenticated using (organization_id = private.current_organization_id() and private.has_current_organization_role(array[''admin'',''tst''])) with check (organization_id = private.current_organization_id() and private.has_current_organization_role(array[''admin'',''tst'']))', table_name);
  end loop;
end;
$$;
