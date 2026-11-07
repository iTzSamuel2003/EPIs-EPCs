begin;

create extension if not exists pgtap with schema extensions;

select plan(80);

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
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'platform.lifecycle.test@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'ordinary.lifecycle.test@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'first.admin.lifecycle@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'member.lifecycle@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'unverified.lifecycle@example.invalid',
    '',
    null,
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'cross.organization.lifecycle@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

insert into private.platform_admins (user_id)
values ('10000000-0000-4000-8000-000000000001');

create temporary table organization_lifecycle_fixture (
  organization_id uuid not null,
  invitation_id uuid,
  invite_token text not null
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  public.current_user_is_platform_admin(),
  true,
  'a platform administrator is recognized without an organization profile'
);

select is(
  (select count(*) from public.profiles where id = auth.uid()),
  0::bigint,
  'the platform administrator fixture has no tenant profile'
);

insert into organization_lifecycle_fixture (organization_id, invite_token)
select public.create_organization_draft('pgTAP lifecycle draft', null),
       repeat('a', 64);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'draft',
  'creating an organization without administrator details produces a draft'
);

select is(
  (select count(*)::integer
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.organization_id = invitation.organization_id),
  0,
  'creating a draft does not create an invitation'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.current_user_is_platform_admin(),
  false,
  'an ordinary user is not recognized as a platform administrator'
);

select throws_ok(
  format(
    'select public.update_platform_organization_draft(%L, %L, null, null, null, null, null, null, null, null)',
    (select organization_id from organization_lifecycle_fixture),
    'Unauthorized edit'
  ),
  'P0001',
  'Acesso negado',
  'a non-platform user cannot edit a draft'
);

select throws_ok(
  $$select public.create_organization_draft('Unauthorized draft', null)$$,
  'P0001',
  'Acesso negado',
  'a non-platform user cannot create a draft'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    'select * from public.invite_first_organization_admin(%L, %L, %L::text[], %L)',
    (select organization_id from organization_lifecycle_fixture),
    'first.admin.lifecycle@example.invalid',
    array[
      '/', '/bases', '/materials', '/employees', '/teams', '/units', '/variants',
      '/function-templates', '/entries', '/deliveries', '/returns', '/transfers',
      '/discounts', '/attendance', '/employee-history', '/asos', '/requests',
      '/stock', '/validities', '/ca', '/contract-requirements', '/tests',
      '/training-compliance', '/compliance', '/costs', '/reports', '/movements',
      '/audit', '/settings', '/help'
    ],
    repeat('b', 64)
  ),
  'a platform admin can invite the first organization administrator later'
);

update organization_lifecycle_fixture as fixture
set invitation_id = invitation.id
from public.organization_invitations as invitation
where invitation.organization_id = fixture.organization_id
  and lower(invitation.email) = 'first.admin.lifecycle@example.invalid';

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select throws_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('b', 64), 'Wrong Email'),
  'P0001',
  'Este convite foi criado para outro e-mail',
  'a user with another verified email cannot accept the first-admin invitation'
);

select ok(
  (select invitation.accepted_at is null
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'a wrong-email attempt does not consume the invitation'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'awaiting_admin',
  'a first-admin invitation moves the draft to awaiting_admin'
);

select is(
  (select invitation.invite_kind::text
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'first_admin',
  'the delayed invitation is classified as first_admin'
);

select ok(
  (select invitation.expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'first-admin invitations expire after seven days'
);

select ok(
  (select invitation.token_hash = encode(extensions.digest(repeat('b', 64), 'sha256'), 'hex')
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'only the hash of the raw first-admin token is persisted'
);

select lives_ok(
  format(
    'select public.revoke_first_admin_invitation(%L, %L, %L)',
    (select organization_id from organization_lifecycle_fixture),
    (select invitation_id from organization_lifecycle_fixture),
    'Replacing the initial invitation'
  ),
  'a platform admin can revoke a pending first-admin invitation'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'draft',
  'revoking the last pending first-admin invitation returns the organization to draft'
);

select ok(
  (select invitation.revoked_at is not null and invitation.revoked_by = auth.uid()
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'revocation records its time and platform actor'
);

select lives_ok(
  format(
    'select public.set_organization_suspended(%L, %L)',
    (select organization_id from organization_lifecycle_fixture),
    'Lifecycle suspension test'
  ),
  'a platform admin can suspend an organization'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'suspended',
  'suspension records the suspended state'
);

select lives_ok(
  format(
    'select public.reactivate_organization(%L, %L)',
    (select organization_id from organization_lifecycle_fixture),
    'Restore previous lifecycle state'
  ),
  'a platform admin can reactivate an organization'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'draft',
  'reactivation restores the exact state that preceded suspension'
);

select ok(
  exists (
    select 1
    from private.platform_organization_events as event
    join organization_lifecycle_fixture as fixture on fixture.organization_id = event.organization_id
    where event.actor_id = auth.uid()
      and event.reason is not null
      and event.previous_status = 'draft'
      and event.new_status = 'suspended'
  ),
  'manual lifecycle transitions retain actor, reason, and previous/new state'
);

select is(
  (select private.current_organization_id()),
  null::uuid,
  'non-active organization members have no tenant scope'
);

select ok(
  (select count(*) = 0
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.organization_id = invitation.organization_id
   where invitation.accepted_at is null
     and invitation.revoked_at is null
     and invitation.expires_at > now()),
  'revoked first-admin invitations are excluded from active invitation state'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('b', 64), 'First Admin'),
  'P0001',
  'Convite inválido, revogado ou expirado',
  'a revoked first-admin token cannot be accepted'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    'select * from public.invite_first_organization_admin(%L, %L, %L::text[], %L)',
    (select organization_id from organization_lifecycle_fixture),
    'first.admin.lifecycle@example.invalid',
    array[
      '/', '/bases', '/materials', '/employees', '/teams', '/units', '/variants',
      '/function-templates', '/entries', '/deliveries', '/returns', '/transfers',
      '/discounts', '/attendance', '/employee-history', '/asos', '/requests',
      '/stock', '/validities', '/ca', '/contract-requirements', '/tests',
      '/training-compliance', '/compliance', '/costs', '/reports', '/movements',
      '/audit', '/settings', '/help'
    ],
    repeat('c', 64)
  ),
  'a platform admin can reissue the first-admin invitation with a replacement token'
);

update organization_lifecycle_fixture as fixture
set invitation_id = invitation.id
from public.organization_invitations as invitation
where invitation.organization_id = fixture.organization_id
  and invitation.token_hash = encode(extensions.digest(repeat('c', 64), 'sha256'), 'hex');

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'awaiting_admin',
  'reissuing the invitation restores awaiting_admin state'
);

select lives_ok(
  format(
    'select public.set_organization_suspended(%L, %L)',
    (select organization_id from organization_lifecycle_fixture),
    'Suspend organization with pending first administrator'
  ),
  'a pending first-admin organization can be suspended'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'suspended',
  'the organization with a pending first admin enters suspended state'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('c', 64), 'First Admin'),
  'P0001',
  'A organiza' || chr(231) || chr(227) || 'o est' || chr(225) || ' indispon' || chr(237) || 'vel para aceitar convites',
  'a first administrator cannot accept an invitation while the organization is suspended'
);

select ok(
  (select invitation.accepted_at is null
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'a suspended-organization attempt does not consume the invitation'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    'select public.reactivate_organization(%L, %L)',
    (select organization_id from organization_lifecycle_fixture),
    'Restore organization awaiting its first administrator'
  ),
  'a suspended organization awaiting its first administrator can be restored'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'awaiting_admin',
  'reactivation restores awaiting_admin instead of activating prematurely'
);

update public.organization_invitations as invitation
set expires_at = now() - interval '1 minute'
from organization_lifecycle_fixture as fixture
where invitation.id = fixture.invitation_id;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select throws_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('c', 64), 'Unverified User'),
  'P0001',
  'Confirme o e-mail da sua conta antes de aceitar o convite',
  'an unverified account cannot accept an organization invitation'
);

select ok(
  (select invitation.accepted_at is null
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'an unverified acceptance attempt leaves the invitation pending'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('c', 64), 'First Admin'),
  'P0001',
  'Convite inv' || chr(225) || 'lido, revogado ou expirado',
  'an expired first-admin invitation cannot be accepted'
);

select ok(
  (select invitation.accepted_at is null
   from public.organization_invitations as invitation
   join organization_lifecycle_fixture as fixture on fixture.invitation_id = invitation.id),
  'an expired acceptance attempt does not consume the invitation'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    'select * from public.invite_first_organization_admin(%L, %L, %L::text[], %L)',
    (select organization_id from organization_lifecycle_fixture),
    'first.admin.lifecycle@example.invalid',
    array[
      '/', '/bases', '/materials', '/employees', '/teams', '/units', '/variants',
      '/function-templates', '/entries', '/deliveries', '/returns', '/transfers',
      '/discounts', '/attendance', '/employee-history', '/asos', '/requests',
      '/stock', '/validities', '/ca', '/contract-requirements', '/tests',
      '/training-compliance', '/compliance', '/costs', '/reports', '/movements',
      '/audit', '/settings', '/help'
    ],
    repeat('d', 64)
  ),
  'a platform admin can replace an expired first-admin invitation'
);

update organization_lifecycle_fixture as fixture
set invitation_id = invitation.id
from public.organization_invitations as invitation
where invitation.organization_id = fixture.organization_id
  and invitation.token_hash = encode(extensions.digest(repeat('d', 64), 'sha256'), 'hex');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('c', 64), 'First Admin'),
  'P0001',
  'Convite inv' || chr(225) || 'lido, revogado ou expirado',
  'reissuing an expired invitation invalidates its previous token'
);

select lives_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('d', 64), 'First Admin'),
  'an email-verified first-admin invitee can accept the invitation'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'active',
  'accepting the first-admin invitation activates the organization'
);

select is(
  (select profile.role::text
   from public.profiles as profile
   join organization_lifecycle_fixture as fixture on fixture.organization_id = profile.organization_id
   where profile.id = '10000000-0000-4000-8000-000000000003'),
  'admin',
  'the first invitee is linked with the organization administrator role'
);

select is(
  (select cardinality(access_override.page_paths)
   from public.profile_access_overrides as access_override
   where access_override.profile_id = '10000000-0000-4000-8000-000000000003'),
  30,
  'the first administrator receives every current organization page permission'
);

select is(
  (select private.current_organization_id()),
  (select organization_id from organization_lifecycle_fixture),
  'an active first administrator receives the tenant scope'
);

select lives_ok(
  format(
    'select * from public.create_organization_invitation(%L, %L::public.app_role, %L::text[], %L)',
    'member.lifecycle@example.invalid',
    'user',
    array['/', '/help'],
    repeat('e', 64)
  ),
  'an active organization administrator can create a regular member invitation'
);

select is(
  (select invitation.invite_kind::text
   from public.organization_invitations as invitation
   where invitation.token_hash = encode(extensions.digest(repeat('e', 64), 'sha256'), 'hex')),
  'member',
  'organization-created invitations remain classified as member invitations'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

select lives_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('e', 64), 'Organization Member'),
  'a member invitation remains acceptable for an active organization'
);

select is(
  (select profile.role::text
   from public.profiles as profile
   where profile.id = '10000000-0000-4000-8000-000000000004'),
  'user',
  'a regular invitation assigns only its requested member role'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

create temporary table organization_cross_scope_fixture (
  organization_id uuid not null,
  invitation_id uuid
);

insert into organization_cross_scope_fixture (organization_id)
select public.create_organization_draft('pgTAP cross-organization invitation', null);

select lives_ok(
  format(
    'select * from public.invite_first_organization_admin(%L, %L, %L::text[], %L)',
    (select organization_id from organization_cross_scope_fixture),
    'cross.organization.lifecycle@example.invalid',
    array[
      '/', '/bases', '/materials', '/employees', '/teams', '/units', '/variants',
      '/function-templates', '/entries', '/deliveries', '/returns', '/transfers',
      '/discounts', '/attendance', '/employee-history', '/asos', '/requests',
      '/stock', '/validities', '/ca', '/contract-requirements', '/tests',
      '/training-compliance', '/compliance', '/costs', '/reports', '/movements',
      '/audit', '/settings', '/help'
    ],
    repeat('f', 64)
  ),
  'a first-admin invitation can be issued before an account is linked elsewhere'
);

update organization_cross_scope_fixture as fixture
set invitation_id = invitation.id
from public.organization_invitations as invitation
where invitation.organization_id = fixture.organization_id
  and invitation.token_hash = encode(extensions.digest(repeat('f', 64), 'sha256'), 'hex');

insert into public.profiles (id, organization_id, full_name, role)
select '10000000-0000-4000-8000-000000000006',
       fixture.organization_id,
       'Cross Organization User',
       'user'::public.app_role
from organization_lifecycle_fixture as fixture;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select throws_ok(
  format('select public.accept_organization_invitation(%L, %L)', repeat('f', 64), 'Cross Organization User'),
  'P0001',
  'Este usu' || chr(225) || 'rio j' || chr(225) || ' pertence a outra organiza' || chr(231) || chr(227) || 'o',
  'an invitation cannot move a profile already linked to another organization'
);

select is(
  (select profile.organization_id
   from public.profiles as profile
   where profile.id = '10000000-0000-4000-8000-000000000006'),
  (select organization_id from organization_lifecycle_fixture),
  'a cross-organization invitation attempt leaves the existing profile association unchanged'
);

select ok(
  (select invitation.accepted_at is null
   from public.organization_invitations as invitation
   join organization_cross_scope_fixture as fixture on fixture.invitation_id = invitation.id),
  'a cross-organization invitation attempt does not consume the invitation'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    'select public.set_organization_suspended(%L, %L)',
    (select organization_id from organization_lifecycle_fixture),
    'Suspension acceptance test'
  ),
  'a platform admin can suspend an active organization'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'suspended',
  'an active organization transitions to suspended'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

select is(
  (select private.current_organization_id()),
  null::uuid,
  'suspended members lose their tenant scope immediately'
);

select throws_ok(
  format(
    'select * from public.create_organization_invitation(%L, %L::public.app_role, %L::text[], %L)',
    'blocked.lifecycle@example.invalid', 'user', array['/'], repeat('e', 64)
  ),
  'P0001',
  'Acesso negado',
  'members cannot create invitations while the organization is suspended'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    'select public.reactivate_organization(%L, %L)',
    (select organization_id from organization_lifecycle_fixture),
    'Restore active organization'
  ),
  'a platform admin can reactivate a suspended organization'
);

select is(
  (select organization.lifecycle_status
   from public.organizations as organization
   join organization_lifecycle_fixture as fixture on fixture.organization_id = organization.id),
  'active',
  'reactivation restores the organization to active'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

select is(
  (select private.current_organization_id()),
  (select organization_id from organization_lifecycle_fixture),
  'members regain their tenant scope after reactivation'
);

select ok(
  to_regprocedure('public.employee_portal_organization_is_active(text,text)') is not null,
  'service-role employee portal calls can check organization lifecycle'
);

select ok(
  (select count(distinct relation.relname) >= 4
   from pg_catalog.pg_trigger as trigger_row
   join pg_catalog.pg_class as relation on relation.oid = trigger_row.tgrelid
   join pg_catalog.pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
   where relation_schema.nspname = 'public'
     and trigger_row.tgname = 'require_active_organization_for_write'
     and not trigger_row.tgisinternal),
  'tenant write triggers protect privileged writes when an organization is inactive'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'lifecycle_status'
  ),
  'organizations expose a lifecycle status'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_invitations'
      and column_name = 'invite_kind'
  ),
  'invitations distinguish first-admin from member invites'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_invitations'
      and column_name = 'revoked_at'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_invitations'
      and column_name = 'revoked_by'
  ),
  'invitation revocations record timestamp and actor'
);

select ok(
  to_regclass('private.platform_organization_events') is not null,
  'platform organization lifecycle events are retained privately'
);

select ok(
  to_regprocedure('public.create_organization_draft(text,text)') is not null,
  'platform admins can create an organization draft without an email'
);

select ok(
  to_regprocedure('public.update_platform_organization_draft(uuid,text,text,text,text,text,text,integer,integer,integer)') is not null,
  'platform admins can configure a draft before inviting its administrator'
);

select ok(
  to_regprocedure('public.invite_first_organization_admin(uuid,text,text[],text)') is not null,
  'platform admins can invite the first organization administrator later'
);

select ok(
  to_regprocedure('public.revoke_first_admin_invitation(uuid,uuid,text)') is not null,
  'platform admins can revoke a pending first-admin invitation'
);

select ok(
  to_regprocedure('public.set_organization_suspended(uuid,text)') is not null
    and to_regprocedure('public.reactivate_organization(uuid,text)') is not null,
  'organizations can be suspended and restored through audited transitions'
);

select ok(
  to_regprocedure('public.delete_organization_draft(uuid,text)') is not null,
  'only an empty draft can be deleted through a guarded RPC'
);

select ok(
  to_regprocedure('public.list_platform_organizations()') is not null,
  'platform organization listing remains available with lifecycle data'
);

select ok(
  to_regprocedure('public.get_my_organization_lifecycle_status()') is not null,
  'members can learn why their own inactive organization is blocked'
);

select ok(
  exists (
    select 1
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'private'
      and function_row.proname = 'current_organization_id'
      and pg_get_functiondef(function_row.oid) ilike '%lifecycle_status%'
  ),
  'ordinary organization scope rejects non-active organizations'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

create temporary table organization_delete_fixtures (
  empty_draft_id uuid not null,
  revoked_invite_draft_id uuid not null,
  profile_draft_id uuid not null,
  tenant_row_draft_id uuid not null,
  storage_object_draft_id uuid not null
);

create table public.organization_lifecycle_delete_guard_fixture (
  organization_id uuid not null
);

insert into organization_delete_fixtures
select public.create_organization_draft('pgTAP empty draft deletion', null),
       public.create_organization_draft('pgTAP revoked invite deletion', null),
       public.create_organization_draft('pgTAP profile guard', null),
       public.create_organization_draft('pgTAP tenant row guard', null),
       public.create_organization_draft('pgTAP storage guard', null);

insert into public.profiles (id, organization_id, full_name, role)
select '10000000-0000-4000-8000-000000000005',
       fixture.profile_draft_id,
       'Unverified Test User',
       'user'::public.app_role
from organization_delete_fixtures as fixture;

insert into public.organization_lifecycle_delete_guard_fixture (organization_id)
select fixture.tenant_row_draft_id
from organization_delete_fixtures as fixture;

insert into storage.objects (bucket_id, name)
select 'organization-logos', fixture.storage_object_draft_id::text || '/logo.png'
from organization_delete_fixtures as fixture;

insert into public.organization_invitations (
  organization_id, email, role, token_hash, page_paths, expires_at,
  created_by, invite_kind, revoked_at, revoked_by
)
select fixture.revoked_invite_draft_id,
       'revoked.delete.lifecycle@example.invalid',
       'admin'::public.app_role,
       encode(extensions.digest('revoked-delete-fixture', 'sha256'), 'hex'),
       '{}'::text[],
       now() + interval '7 days',
       auth.uid(),
       'first_admin',
       now(),
       auth.uid()
from organization_delete_fixtures as fixture;

select throws_ok(
  format(
    'select public.delete_organization_draft(%L, %L)',
    (select revoked_invite_draft_id from organization_delete_fixtures),
    'Do not delete a draft with an invitation'
  ),
  'P0001',
  'O rascunho possui registros vinculados em public.organization_invitations',
  'even a revoked invitation prevents draft deletion'
);

select throws_ok(
  format(
    'select public.delete_organization_draft(%L, %L)',
    (select profile_draft_id from organization_delete_fixtures),
    'Do not delete a draft with a profile'
  ),
  'P0001',
  'O rascunho possui registros vinculados em public.profiles',
  'a profile linked to a draft prevents its deletion'
);

select throws_ok(
  format(
    'select public.delete_organization_draft(%L, %L)',
    (select tenant_row_draft_id from organization_delete_fixtures),
    'Do not delete a draft with tenant data'
  ),
  'P0001',
  'O rascunho possui registros vinculados em public.organization_lifecycle_delete_guard_fixture',
  'any tenant table row with organization_id prevents draft deletion'
);

select throws_ok(
  format(
    'select public.delete_organization_draft(%L, %L)',
    (select storage_object_draft_id from organization_delete_fixtures),
    'Do not delete a draft with a storage object'
  ),
  'P0001',
  'O rascunho possui arquivos no Storage vinculados ' || chr(224) || ' organiza' || chr(231) || chr(227) || 'o',
  'an organization-prefixed Storage object prevents draft deletion'
);

select lives_ok(
  format(
    'select public.delete_organization_draft(%L, %L)',
    (select empty_draft_id from organization_delete_fixtures),
    'Remove empty draft'
  ),
  'an empty draft can be deleted when no management-session table exists yet'
);

select ok(
  exists (
    select 1
    from private.platform_organization_events as event
    where event.event_type = 'draft_deleted'
      and event.organization_id = (select empty_draft_id from organization_delete_fixtures)
      and event.details ->> 'organization_name_snapshot' = 'pgTAP empty draft deletion'
  ),
  'the deletion audit event survives after its organization row is removed'
);

select * from finish();

rollback;
