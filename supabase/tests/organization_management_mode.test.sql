begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema private to authenticated;
grant usage on schema auth to authenticated;
grant usage on schema storage to authenticated;
grant select on all tables in schema public to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, update on public.organizations to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

select no_plan();

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000011',
    'authenticated',
    'authenticated',
    'management.platform@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000012',
    'authenticated',
    'authenticated',
    'management.ordinary@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000013',
    'authenticated',
    'authenticated',
    'management.profiled-platform@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

insert into private.platform_admins (user_id)
values
  ('10000000-0000-4000-8000-000000000011'),
  ('10000000-0000-4000-8000-000000000013');

create temporary table organization_management_fixture (
  first_organization_id uuid not null,
  second_organization_id uuid not null,
  suspended_organization_id uuid not null
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000011"}',
  true
);

insert into organization_management_fixture
select
  public.create_organization_draft('Management target one', null),
  public.create_organization_draft('Management target two', null),
  public.create_organization_draft('Management suspended target', null);

update public.organizations
set lifecycle_status = 'active'
where id in (
  (select first_organization_id from organization_management_fixture),
  (select second_organization_id from organization_management_fixture)
);

update public.organizations
set lifecycle_status = 'suspended'
where id = (select suspended_organization_id from organization_management_fixture);

insert into public.profiles (id, organization_id, full_name, role)
select
  '10000000-0000-4000-8000-000000000013',
  second_organization_id,
  'Platform admin with tenant profile',
  'admin'
from organization_management_fixture;

insert into public.categories (organization_id, name)
select first_organization_id, 'Category in target one'
from organization_management_fixture;

insert into public.categories (organization_id, name)
select second_organization_id, 'Category in target two'
from organization_management_fixture;

grant select on organization_management_fixture to authenticated;

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'organization-logos',
  first_organization_id::text || '/existing-logo.svg',
  '10000000-0000-4000-8000-000000000011',
  '{"mimetype":"image/svg+xml","size":1}'::jsonb
from organization_management_fixture;

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'organization-logos',
  second_organization_id::text || '/existing-logo.svg',
  '10000000-0000-4000-8000-000000000011',
  '{"mimetype":"image/svg+xml","size":1}'::jsonb
from organization_management_fixture;

update public.organizations
set lifecycle_status = 'draft'
where id = (select first_organization_id from organization_management_fixture);

insert into auth.sessions (id, user_id, created_at, updated_at)
values
  (
    '20000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000011',
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000013',
    now(),
    now()
  );

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","session_id":"20000000-0000-4000-8000-000000000011"}', true);

select ok(
  private.current_organization_id() is null,
  'a platform administrator without a management session has no tenant scope'
);

select ok(
  to_regprocedure('public.start_platform_organization_management_session(uuid,text)') is not null,
  'the management-session RPC is installed'
);

select is(
  (select count(*)::integer from public.profiles where id = auth.uid()),
  0,
  'a platform-only administrator has no tenant profile before management'
);

select is(
  has_function_privilege('anon', 'public.start_platform_organization_management_session(uuid,text)', 'EXECUTE'),
  false,
  'anonymous users cannot start a platform management session'
);

select is(
  has_table_privilege('authenticated', 'private.platform_organization_management_sessions', 'SELECT'),
  false,
  'authenticated users cannot read private management sessions'
);

select is(
  has_table_privilege('authenticated', 'private.platform_organization_management_audit', 'SELECT'),
  false,
  'authenticated users cannot read private management audit events'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'private'
      and tablename = 'platform_organization_management_sessions'
      and policyname = 'deny_authenticated_management_session_access'
      and permissive = 'RESTRICTIVE'
      and roles @> array['authenticated']::name[]
      and cmd = 'ALL'
      and qual = 'false'
      and with_check = 'false'
  ),
  1,
  'private management sessions have an explicit authenticated deny-all policy'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'private'
      and tablename = 'platform_organization_management_audit'
      and policyname = 'deny_authenticated_management_audit_access'
      and permissive = 'RESTRICTIVE'
      and roles @> array['authenticated']::name[]
      and cmd = 'ALL'
      and qual = 'false'
      and with_check = 'false'
  ),
  1,
  'private management audit has an explicit authenticated deny-all policy'
);

select ok(
  to_regclass('private.platform_organization_management_audit_actor_created_idx') is not null,
  'management audit actor and timestamp lookups are indexed'
);

set local role authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000012', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000012","session_id":"20000000-0000-4000-8000-000000000012"}', true);

select throws_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Prepare tenant'
  ),
  'P0001',
  'Acesso negado',
  'an ordinary user cannot begin platform management'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011"}', true);

select throws_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Prepare tenant'
  ),
  'P0001',
  'Sessão autenticada inválida',
  'management requires the verified Auth session id from the JWT'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","session_id":"20000000-0000-4000-8000-000000000099"}', true);

select throws_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Prepare tenant'
  ),
  'P0001',
  'Sessão autenticada inválida',
  'management rejects an Auth session id that does not exist for the actor'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","session_id":"20000000-0000-4000-8000-000000000011"}', true);

select throws_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    '   '
  ),
  'P0001',
  'Informe um motivo entre 5 e 500 caracteres.',
  'management requires a meaningful access reason'
);

select throws_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select suspended_organization_id from organization_management_fixture),
    'Support requested by the organization'
  ),
  'P0001',
  'Organização indisponível para gestão',
  'suspended organizations cannot be opened for management'
);

select lives_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Preparação inicial da organização'
  ),
  'a platform administrator can open a draft organization'
);

select is(
  (select context.organization_id from public.get_platform_organization_management_context() as context),
  (select first_organization_id from organization_management_fixture),
  'the trusted context rpc returns the selected organization'
);

select is(
  (select context.organization_name from public.get_platform_organization_management_context() as context),
  'Management target one',
  'the trusted context rpc returns the selected organization name'
);

select ok(
  (select context.expires_at > now() + interval '59 minutes'
   from public.get_platform_organization_management_context() as context),
  'management uses a fixed one-hour expiration'
);

select is(
  private.current_organization_id(),
  (select first_organization_id from organization_management_fixture),
  'tenant scope resolves from the database session record'
);

select is(
  public.current_user_is_platform_admin(),
  false,
  'platform-only operations are disabled while tenant management is active'
);

select is(
  private.is_current_organization_admin(),
  true,
  'the selected organization grants tenant-admin-equivalent checks'
);

select is(
  (select count(*)::integer from public.categories
   where organization_id = (select first_organization_id from organization_management_fixture)),
  1,
  'the authenticated management session can read its selected tenant'
);

select is(
  (select count(*)::integer from public.categories
   where organization_id = (select second_organization_id from organization_management_fixture)),
  0,
  'the authenticated management session cannot read a different tenant'
);

select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'organization-logos'
     and name = (select first_organization_id::text || '/existing-logo.svg' from organization_management_fixture)),
  1,
  'management can read storage objects under the selected organization prefix'
);

select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'organization-logos'
     and name = (select second_organization_id::text || '/existing-logo.svg' from organization_management_fixture)),
  0,
  'management cannot read storage objects under another organization prefix'
);

select lives_ok(
  format(
    'insert into public.categories (organization_id, name) values (%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Management-created category'
  ),
  'management writes are allowed inside the selected draft organization'
);

select throws_ok(
  format(
    'insert into public.categories (organization_id, name) values (%L::uuid, %L)',
    (select second_organization_id from organization_management_fixture),
    'Cross-tenant category'
  ),
  '42501',
  'new row violates row-level security policy for table "categories"',
  'management cannot insert data into a different tenant'
);

select lives_ok(
  format(
    'insert into storage.objects (bucket_id, name, owner_id, metadata) values (%L, %L, %L, %L::jsonb)',
    'organization-logos',
    (select first_organization_id::text || '/management-logo.svg' from organization_management_fixture),
    '10000000-0000-4000-8000-000000000011',
    '{"mimetype":"image/svg+xml","size":1}'
  ),
  'management can upload a storage object to the selected organization'
);

select throws_ok(
  format(
    'insert into storage.objects (bucket_id, name, owner_id, metadata) values (%L, %L, %L, %L::jsonb)',
    'organization-logos',
    (select second_organization_id::text || '/cross-tenant-logo.svg' from organization_management_fixture),
    '10000000-0000-4000-8000-000000000011',
    '{"mimetype":"image/svg+xml","size":1}'
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'management cannot upload storage objects to another organization'
);

select lives_ok(
  format(
    'update public.organizations set name = %L where id = %L::uuid',
    'Configured organization name',
    (select first_organization_id from organization_management_fixture)
  ),
  'tenant organization settings can be edited while in management mode'
);

select is(
  (select count(*)::integer from public.get_platform_organization_management_context()),
  1,
  'the session context remains active after tenant writes'
);

select is(
  has_table_privilege('authenticated', 'private.platform_organization_management_audit', 'UPDATE'),
  false,
  'authenticated users cannot alter management audit events'
);

select throws_ok(
  $$select public.create_organization_draft('Forbidden from tenant scope', null)$$,
  'P0001',
  'Acesso negado',
  'platform organization administration RPCs are unavailable in tenant scope'
);

select lives_ok(
  $$select public.audit_sensitive_management_read('/employees')$$,
  'an allowlisted HR page can record its read in management mode'
);

select lives_ok(
  $$select public.audit_sensitive_management_read('/employees')$$,
  'repeated visits to the same HR page can be recorded idempotently'
);

select throws_ok(
  $$select public.audit_sensitive_management_read('/not-a-sensitive-resource')$$,
  'P0001',
  'Recurso de auditoria não permitido',
  'the sensitive-read audit RPC rejects arbitrary resources'
);

reset role;

select is(
  (select count(*)::integer from public.profiles
   where id = '10000000-0000-4000-8000-000000000011'),
  0,
  'starting management does not create a tenant profile'
);

select is(
  (select count(*)::integer from private.platform_organization_management_audit
   where event_type = 'sensitive_read'
     and resource_name = '/employees'
     and auth_session_id = '20000000-0000-4000-8000-000000000011'),
  1,
  'the HR read audit is deduplicated by management session and resource'
);

select is(
  (select count(*)::integer from private.platform_organization_management_audit
   where event_type = 'tenant_write'
     and table_name = 'public.categories'
     and organization_id = (select first_organization_id from organization_management_fixture)),
  1,
  'tenant writes are audited without storing row payloads'
);

select is(
  (select count(*)::integer from private.platform_organization_management_audit
   where event_type = 'tenant_write'
     and table_name = 'storage.objects'
     and organization_id = (select first_organization_id from organization_management_fixture)),
  1,
  'storage uploads are recorded without copying file contents'
);

select throws_ok(
  format(
    'update private.platform_organization_management_audit set event_type = %L where event_type = %L',
    'tampered',
    'sensitive_read'
  ),
  '55000',
  'A trilha de auditoria é imutável',
  'management audit records are append-only'
);

set local role authenticated;

select lives_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select second_organization_id from organization_management_fixture),
    'Second organization review'
  ),
  'a platform administrator can switch management scope'
);

select is(
  private.current_organization_id(),
  (select second_organization_id from organization_management_fixture),
  'a scope switch resolves only the newly selected organization'
);

select is(
  (select count(*)::integer from public.categories
   where organization_id = (select first_organization_id from organization_management_fixture)),
  0,
  'the previous organization is no longer readable after a scope switch'
);

reset role;

select is(
  (select count(*)::integer from private.platform_organization_management_sessions
   where auth_session_id = '20000000-0000-4000-8000-000000000011'
     and ended_at is null),
  1,
  'one Auth session has at most one open management scope'
);

select is(
  (select count(*)::integer from private.platform_organization_management_audit
   where event_type = 'session_end'
     and end_reason = 'scope_switched'
     and auth_session_id = '20000000-0000-4000-8000-000000000011'),
  1,
  'scope replacement is recorded in the audit trail'
);

set local role authenticated;

select is(public.end_platform_organization_management_session(), true, 'the platform administrator can close the current scope');
select ok(private.current_organization_id() is null, 'closing management restores the platform-only scope');
select is(public.current_user_is_platform_admin(), true, 'platform administration is restored after management closes');

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000013', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000013","session_id":"20000000-0000-4000-8000-000000000013"}', true);

select lives_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Verify profile membership remains unchanged'
  ),
  'a platform administrator who already has a tenant profile can open another organization'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000013', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000013","session_id":"20000000-0000-4000-8000-000000000013"}', true);

select is(
  private.current_organization_id(),
  (select first_organization_id from organization_management_fixture),
  'a management session overrides rather than mutates the administrator profile organization'
);

select lives_ok(
  $$update public.profiles set role = 'user' where id = auth.uid()$$,
  'self-profile edits cannot alter a platform administrator role during management'
);

reset role;

select is(
  (select profile.organization_id
   from public.profiles as profile
   where profile.id = '10000000-0000-4000-8000-000000000013'),
  (select second_organization_id from organization_management_fixture),
  'the platform administrator profile remains unchanged after management'
);

select is(
  (select profile.role::text
   from public.profiles as profile
   where profile.id = '10000000-0000-4000-8000-000000000013'),
  'admin',
  'the platform administrator tenant role remains unchanged after management'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","session_id":"20000000-0000-4000-8000-000000000011"}', true);

select lives_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Prepare expiration review'
  ),
  'a new management session can be started for expiration review'
);

update private.platform_organization_management_sessions
set expires_at = now() - interval '1 second'
where auth_session_id = '20000000-0000-4000-8000-000000000011'
  and ended_at is null;

set local role authenticated;
select is(
  (select count(*)::integer from public.get_platform_organization_management_context()),
  0,
  'an expired management session immediately loses its trusted context'
);

reset role;

select is(
  (select count(*)::integer from private.platform_organization_management_audit
   where event_type = 'session_end'
     and end_reason = 'expired'
     and auth_session_id = '20000000-0000-4000-8000-000000000011'),
  1,
  'management expiration is recorded'
);

insert into auth.sessions (id, user_id, created_at, updated_at)
values ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000011', now(), now());
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","session_id":"20000000-0000-4000-8000-000000000014"}', true);

set local role authenticated;
select lives_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Verify revoked Auth session handling'
  ),
  'a fresh Auth session can open management after an earlier session expires'
);
reset role;

delete from auth.sessions where id = '20000000-0000-4000-8000-000000000014';

set local role authenticated;
select is(
  (select count(*)::integer from public.get_platform_organization_management_context()),
  0,
  'revoking the Auth session invalidates its management scope'
);
reset role;

select is(
  (select count(*)::integer from private.platform_organization_management_audit
   where event_type = 'session_end'
     and end_reason = 'auth_session_revoked'
     and auth_session_id = '20000000-0000-4000-8000-000000000014'),
  1,
  'Auth-session revocation is recorded'
);

insert into auth.sessions (id, user_id, created_at, updated_at)
values ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000011', now(), now());
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","session_id":"20000000-0000-4000-8000-000000000015"}', true);

set local role authenticated;
select lives_ok(
  format(
    'select * from public.start_platform_organization_management_session(%L::uuid, %L)',
    (select first_organization_id from organization_management_fixture),
    'Verify platform administrator revocation'
  ),
  'the platform administrator can open management before privilege revocation'
);
reset role;

delete from private.platform_admins where user_id = '10000000-0000-4000-8000-000000000011';

set local role authenticated;
select ok(private.current_organization_id() is null, 'revoking the platform role immediately removes tenant scope');
select is(public.current_user_is_platform_admin(), false, 'a revoked platform administrator cannot use platform RPCs');
reset role;

select is(
  (select count(*)::integer from private.platform_organization_management_audit
   where event_type = 'session_end'
     and end_reason = 'platform_admin_revoked'
     and auth_session_id = '20000000-0000-4000-8000-000000000015'),
  1,
  'platform-role revocation is recorded'
);

select * from finish();

rollback;
