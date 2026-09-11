-- Organization members can keep using the application in read-only mode.
-- Only administrators may mutate organization-scoped records.
do $$
declare
  table_row record;
  policy_row record;
begin
  for table_row in
    select distinct p.tablename
    from pg_policies p
    join information_schema.columns c
      on c.table_schema = p.schemaname
     and c.table_name = p.tablename
     and c.column_name = 'organization_id'
    where p.schemaname = 'public'
      and p.cmd = 'ALL'
      and p.policyname like 'organization members%'
  loop
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_row.tablename
        and cmd = 'ALL'
        and policyname like 'organization members%'
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_row.tablename);
    end loop;

    execute format('drop policy if exists "organization members read organization data" on public.%I', table_row.tablename);
    execute format('drop policy if exists "organization admins insert organization data" on public.%I', table_row.tablename);
    execute format('drop policy if exists "organization admins update organization data" on public.%I', table_row.tablename);
    execute format('drop policy if exists "organization admins delete organization data" on public.%I', table_row.tablename);

    execute format('create policy "organization members read organization data" on public.%I for select to authenticated using (organization_id = private.current_organization_id())', table_row.tablename);
    execute format('create policy "organization admins insert organization data" on public.%I for insert to authenticated with check (organization_id = private.current_organization_id() and private.is_current_organization_admin())', table_row.tablename);
    execute format('create policy "organization admins update organization data" on public.%I for update to authenticated using (organization_id = private.current_organization_id() and private.is_current_organization_admin()) with check (organization_id = private.current_organization_id() and private.is_current_organization_admin())', table_row.tablename);
    execute format('create policy "organization admins delete organization data" on public.%I for delete to authenticated using (organization_id = private.current_organization_id() and private.is_current_organization_admin())', table_row.tablename);
  end loop;
end;
$$;
