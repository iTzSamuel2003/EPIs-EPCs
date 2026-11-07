begin;

create extension if not exists pgtap with schema extensions;

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
    '10000000-0000-4000-8000-000000000021',
    'authenticated',
    'authenticated',
    'platform.contract-template.test@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000022',
    'authenticated',
    'authenticated',
    'organization-admin.contract-template.test@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000023',
    'authenticated',
    'authenticated',
    'ordinary.contract-template.test@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

insert into private.platform_admins (user_id)
values ('10000000-0000-4000-8000-000000000021');

create temporary table organization_contract_template_fixture (
  organization_id uuid primary key,
  independent_organization_id uuid not null,
  existing_organization_id uuid not null
);
grant select on organization_contract_template_fixture to authenticated, anon;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000021"}',
  true
);

select is(
  public.current_user_is_platform_admin(),
  true,
  'the draft creator is a platform administrator'
);

select is(
  (
    select jsonb_array_length(version.canonical_payload::jsonb)
    from private.contract_template_versions as version
    where version.version_number = 1
  ),
  1618,
  'v1 stores all 1,618 canonical contract records'
);

select is(
  (
    select encode(
      extensions.digest(convert_to(version.canonical_payload, 'UTF8'), 'sha256'),
      'hex'
    )
    from private.contract_template_versions as version
    where version.version_number = 1
  ),
  (
    select version.snapshot_sha256
    from private.contract_template_versions as version
    where version.version_number = 1
  ),
  'the stored v1 fingerprint matches SHA-256 recomputed from canonical_payload UTF-8 bytes'
);

select is(
  (
    select version.snapshot_sha256
    from private.contract_template_versions as version
    where version.version_number = 1
  ),
  '083a88f58186b7836fcc1195552095a3df7f950b248b5ff946a7978c76691b69',
  'v1 fingerprint matches the reviewed canonical_records digest'
);

select is(
  (select count(*)::integer from private.contract_template_records where version = 1),
  1618,
  'the normalized private version table contains every canonical record'
);

select is(
  (select count(*)::integer from private.contract_template_source_rows where version = 1),
  1248,
  'frozen DSX source-row IDs remain separate from the canonical content hash'
);

select is(
  (
    select count(*)::integer
    from private.organization_contract_template_ownership as ownership
    where ownership.organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  ),
  1618,
  'the source organization is registered as v1-owned without copying its catalog'
);

select is(
  (
    select installation.version
    from private.organization_contract_template_installs as installation
    where installation.organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  ),
  1,
  'the source organization is recorded as already installed at v1'
);

select ok(
  (
    select version.canonical_payload::jsonb @> '[
      {
        "entity_type": "material",
        "source_key": "A04-001",
        "payload": {
          "contract_item_code": "A04-001",
          "internal_code": "A04-001",
          "name": "Bandeirola de sinalização",
          "type": "FERRAMENTAL"
        }
      }
    ]'::jsonb
    from private.contract_template_versions as version
    where version.version_number = 1
  ),
  'canonical material A04-001 is Bandeirola de sinalização'
);

select ok(
  (
    select version.canonical_payload::jsonb @> '[
      {
        "entity_type": "material",
        "source_key": "A04-046",
        "payload": {
          "contract_item_code": "A04-046",
          "internal_code": "A04-046",
          "name": "Cobertura circular - 150mm x 600mm - Tensão Nominal 26,4KV",
          "type": "EPC"
        }
      }
    ]'::jsonb
    from private.contract_template_versions as version
    where version.version_number = 1
  ),
  'canonical material A04-046 retains its exact name, contract code, and type'
);

select ok(
  not exists (
    select 1
    from private.contract_template_versions as version
    cross join lateral jsonb_array_elements(version.canonical_payload::jsonb) as canonical_record(payload)
    where version.version_number = 1
      and coalesce((canonical_record.payload->'payload') ? 'ca_number', false)
  ),
  'the canonical snapshot does not manage organization-specific CA numbers'
);

with existing_organization as (
  insert into public.organizations (name, lifecycle_status)
  values ('pgTAP existing contract template organization', 'draft')
  returning id
)
insert into organization_contract_template_fixture (
  organization_id,
  independent_organization_id,
  existing_organization_id
)
select
  public.create_organization_draft('pgTAP contract template draft', null),
  public.create_organization_draft('pgTAP independent contract template draft', null),
  existing_organization.id
from existing_organization;

select is(
  (
    select count(*)::integer
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on setting.organization_id in (
        fixture.organization_id,
        fixture.independent_organization_id,
        fixture.existing_organization_id
      )
  ),
  15,
  'new and existing draft organizations receive five default annex settings'
);

select is(
  (
    select count(*)::integer
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on setting.organization_id in (
        fixture.organization_id,
        fixture.independent_organization_id,
        fixture.existing_organization_id
      )
    where setting.active and setting.annex_number in ('03', '04', '05')
  ),
  9,
  'annexes 03, 04, and 05 start enabled for all draft organizations'
);

select is(
  (
    select count(*)::integer
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on setting.organization_id in (
        fixture.organization_id,
        fixture.independent_organization_id,
        fixture.existing_organization_id
      )
    where not setting.active and setting.annex_number in ('06', '07')
  ),
  6,
  'annexes 06 and 07 start disabled for all draft organizations'
);

create temporary table organization_contract_template_all_organizations as
select fixture.organization_id
from organization_contract_template_fixture as fixture
union all
select fixture.independent_organization_id
from organization_contract_template_fixture as fixture
union all
select fixture.existing_organization_id
from organization_contract_template_fixture as fixture;

create temporary table organization_contract_template_apply_before as
select
  fixture.organization_id,
  status.installed_sha256,
  (
    select count(*)::integer
    from private.organization_contract_template_events as event
    where event.organization_id = fixture.organization_id
  ) as event_count
from organization_contract_template_fixture as fixture
join public.list_platform_contract_template_status() as status
  on status.organization_id = fixture.organization_id;
grant select on organization_contract_template_all_organizations to authenticated, anon;

select ok(
  (select organization_id <> independent_organization_id
   from organization_contract_template_fixture),
  'a platform administrator can create two distinct draft organizations'
);

insert into public.profiles (id, organization_id, full_name, role)
select
  '10000000-0000-4000-8000-000000000022',
  organization_id,
  'Contract template organization admin',
  'admin'::public.app_role
from organization_contract_template_fixture;

insert into private.contract_template_install_context (backend_pid, transaction_id, organization_id)
select pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), fixture.existing_organization_id
from organization_contract_template_fixture as fixture;

insert into public.organization_annex_settings (organization_id, annex_number, active)
select fixture.existing_organization_id, settings.annex_number, settings.active
from organization_contract_template_fixture as fixture
cross join (
  values
    ('03', true),
    ('04', false),
    ('05', true),
    ('06', true),
    ('07', false)
) as settings(annex_number, active)
on conflict (organization_id, annex_number)
do update set active = excluded.active;

delete from private.contract_template_install_context as install_context
where install_context.backend_pid = pg_catalog.pg_backend_pid()
  and install_context.transaction_id = pg_catalog.txid_current()
  and install_context.organization_id in (
    select fixture.existing_organization_id
    from organization_contract_template_fixture as fixture
  );

create temporary table organization_contract_template_existing_settings_before as
select setting.organization_id, setting.annex_number, setting.active
from public.organization_annex_settings as setting
join organization_contract_template_fixture as fixture
  on fixture.existing_organization_id = setting.organization_id;

select is(
  (
    select organization.lifecycle_status
    from public.organizations as organization
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = organization.id
  ),
  'draft',
  'the organization remains a draft after contract template provisioning'
);

select is(
  (
    select count(*)::integer
    from public.materials as material
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = material.organization_id
  ),
  243,
  'v1 provisions exactly 243 materials for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.materials as material
    join organization_contract_template_fixture as fixture
      on fixture.independent_organization_id = material.organization_id
  ),
  243,
  'v1 independently provisions exactly 243 materials for the second organization'
);

select is(
  (
    select count(*)::integer
    from public.material_contract_annexes as link
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = link.organization_id
  ),
  370,
  'v1 provisions exactly 370 material-annex links for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.contract_scenarios as scenario
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = scenario.organization_id
  ),
  9,
  'v1 provisions exactly 9 contract scenarios for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.contract_requirements as requirement
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = requirement.organization_id
  ),
  864,
  'v1 provisions exactly 864 scenario requirements for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.function_templates as template
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = template.organization_id
  ),
  5,
  'v1 provisions exactly 5 function templates for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.function_template_items as item
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = item.organization_id
  ),
  106,
  'v1 provisions exactly 106 function-template items for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.function_aliases as alias
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = alias.organization_id
  ),
  10,
  'v1 provisions exactly 10 function aliases for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.contract_training_requirements as training
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = training.organization_id
  ),
  11,
  'v1 provisions exactly 11 course requirements for the new organization'
);

select is(
  (
    select count(*)::integer
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = setting.organization_id
  ),
  5,
  'v1 provisions settings for all five contract annexes'
);

select is(
  (
    select setting.active
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = setting.organization_id
    where setting.annex_number = '03'
  ),
  true,
  'Annex 03 is active by default'
);

select is(
  (
    select setting.active
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = setting.organization_id
    where setting.annex_number = '04'
  ),
  true,
  'Annex 04 is active by default'
);

select is(
  (
    select setting.active
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = setting.organization_id
    where setting.annex_number = '05'
  ),
  true,
  'Annex 05 is active by default'
);

select is(
  (
    select setting.active
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = setting.organization_id
    where setting.annex_number = '06'
  ),
  false,
  'Annex 06 is inactive by default'
);

select is(
  (
    select setting.active
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = setting.organization_id
    where setting.annex_number = '07'
  ),
  false,
  'Annex 07 is inactive by default'
);

select ok(
  exists (
    select 1
    from public.materials as material
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = material.organization_id
    where material.type = 'EPI'
      and material.ca_number = 'PENDENTE'
  ),
  'the cloned catalog contains EPI records with the PENDENTE CA placeholder'
);

select is(
  (
    select count(*)::integer
    from public.materials as material
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = material.organization_id
    where (
      (
        material.type = 'EPI'
        or coalesce(material.ca_required, false)
      )
      and material.ca_number is distinct from 'PENDENTE'
    )
    or (
      not (
        material.type = 'EPI'
        or coalesce(material.ca_required, false)
      )
      and material.ca_number is not null
    )
  ),
  0,
  'initial CA is PENDENTE for EPIs or CA-required materials and NULL otherwise'
);

select isnt(
  (
    select material.id
    from public.materials as material
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = material.organization_id
    where material.contract_item_code = 'A04-001'
  ),
  (
    select material.id
    from public.materials as material
    join organization_contract_template_fixture as fixture
      on fixture.independent_organization_id = material.organization_id
    where material.contract_item_code = 'A04-001'
  ),
  'the same canonical material receives a distinct local UUID in each organization'
);

select isnt(
  (
    select scenario.id
    from public.contract_scenarios as scenario
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = scenario.organization_id
    order by scenario.code
    limit 1
  ),
  (
    select scenario.id
    from public.contract_scenarios as scenario
    join organization_contract_template_fixture as fixture
      on fixture.independent_organization_id = scenario.organization_id
    where scenario.code = (
      select source_scenario.code
      from public.contract_scenarios as source_scenario
      join organization_contract_template_fixture as source_fixture
        on source_fixture.organization_id = source_scenario.organization_id
      order by source_scenario.code
      limit 1
    )
    limit 1
  ),
  'the same canonical scenario receives a distinct local UUID in each organization'
);

select is(
  (
    select scenario.code
    from public.contract_scenarios as scenario
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = scenario.organization_id
    order by scenario.code
    limit 1
  ),
  (
    select scenario.code
    from public.contract_scenarios as scenario
    join organization_contract_template_fixture as fixture
      on fixture.independent_organization_id = scenario.organization_id
    order by scenario.code
    limit 1
  ),
  'both organizations receive the same canonical scenario key'
);

select is(
  (
    select count(*)::integer
    from public.contract_requirements as requirement
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = requirement.organization_id
    left join public.contract_scenarios as scenario
      on scenario.id = requirement.scenario_id
    left join public.materials as material
      on material.id = requirement.material_id
    where scenario.organization_id is distinct from fixture.organization_id
       or material.organization_id is distinct from fixture.organization_id
  ),
  0,
  'requirements in every organization reference only local scenarios and materials'
);

select is(
  (
    select count(*)::integer
    from public.material_contract_annexes as link
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = link.organization_id
    left join public.materials as material
      on material.id = link.material_id
    where material.organization_id is distinct from fixture.organization_id
  ),
  0,
  'material-annex links in every organization reference only local materials'
);

select is(
  (
    select count(*)::integer
    from public.function_template_items as item
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = item.organization_id
    left join public.function_templates as template
      on template.id = item.template_id
    left join public.materials as material
      on material.id = item.material_id
    where template.organization_id is distinct from fixture.organization_id
       or (item.material_id is not null and material.organization_id is distinct from fixture.organization_id)
  ),
  0,
  'function items reference local templates and any non-null local material'
);

select is(
  (
    select count(*)::integer
    from public.function_aliases as alias
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = alias.organization_id
    left join public.contract_scenarios as scenario
      on scenario.id = alias.contract_scenario_id
    where alias.contract_scenario_id is not null
      and scenario.organization_id is distinct from fixture.organization_id
  ),
  0,
  'every non-null function-alias scenario reference is organization-local'
);

select is(
  (
    select count(*)::integer
    from public.function_templates as template
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = template.organization_id
    left join public.contract_scenarios as scenario
      on scenario.id = template.contract_scenario_id
    where template.contract_scenario_id is not null
      and scenario.organization_id is distinct from fixture.organization_id
  ),
  0,
  'every non-null function-template scenario reference is organization-local'
);

select is(
  (
    select count(*)::integer
    from public.organization_bases as base
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = base.organization_id
  ),
  0,
  'draft provisioning does not copy operational bases'
);

select is(
  (
    select count(*)::integer
    from public.employees as employee
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = employee.organization_id
  ),
  0,
  'draft provisioning does not copy employees'
);

select is(
  (
    (select count(*)::integer from public.employee_profiles as employee_profile
     join organization_contract_template_all_organizations as fixture
       on fixture.organization_id = employee_profile.organization_id)
    + (select count(*)::integer from public.employee_courses as employee_course
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = employee_course.organization_id)
    + (select count(*)::integer from public.employee_portal_requests as portal_request
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = portal_request.organization_id)
    + (select count(*)::integer from public.employee_measurement_requests as measurement_request
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = measurement_request.organization_id)
    + (select count(*)::integer from public.employee_hr_records as hr_record
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = hr_record.organization_id)
    + (select count(*)::integer from public.employee_asos as aso
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = aso.organization_id)
  ),
  0,
  'provisioning excludes employee measures, courses, requests, HR records, and ASOs'
);

select is(
  (
    select count(*)::integer
    from public.material_lots as lot
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = lot.organization_id
  ),
  0,
  'draft provisioning does not copy material lots'
);

select is(
  (
    select count(*)::integer
    from public.stock_movements as movement
    join organization_contract_template_all_organizations as fixture
      on fixture.organization_id = movement.organization_id
  ),
  0,
  'draft provisioning does not copy stock movements'
);

select is(
  (
    (select count(*)::integer from public.material_units as unit_record
     join organization_contract_template_all_organizations as fixture
       on fixture.organization_id = unit_record.organization_id)
    + (select count(*)::integer from public.material_variants as variant
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = variant.organization_id)
    + (select count(*)::integer from public.suppliers as supplier
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = supplier.organization_id)
    + (select count(*)::integer from public.stock_invoices as invoice
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = invoice.organization_id)
    + (select count(*)::integer from public.stock_transfers as transfer
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = transfer.organization_id)
    + (select count(*)::integer from public.stock_transfer_items as transfer_item
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = transfer_item.organization_id)
    + (select count(*)::integer from public.pending_deliveries as pending_delivery
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = pending_delivery.organization_id)
  ),
  0,
  'provisioning excludes units, variants, suppliers, invoices, transfers, and pending deliveries'
);

select is(
  (
    (select count(*)::integer from public.deliveries as delivery
     join organization_contract_template_all_organizations as fixture
       on fixture.organization_id = delivery.organization_id)
    + (select count(*)::integer from public.delivery_items as delivery_item
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = delivery_item.organization_id)
    + (select count(*)::integer from public.returns as material_return
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = material_return.organization_id)
    + (select count(*)::integer from public.return_items as return_item
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = return_item.organization_id)
    + (select count(*)::integer from public.return_accountability as accountability
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = accountability.organization_id)
  ),
  0,
  'provisioning excludes deliveries, returns, return items, and accountability records'
);

select is(
  (
    (select count(*)::integer from public.contract_teams as team
     join organization_contract_template_all_organizations as fixture
       on fixture.organization_id = team.organization_id)
    + (select count(*)::integer from public.contract_team_members as team_member
       join organization_contract_template_all_organizations as fixture
         on fixture.organization_id = team_member.organization_id)
  ),
  0,
  'provisioning excludes operational teams and team members'
);

create temporary table organization_contract_template_counts_before as
select
  (select count(*)::integer from public.materials where organization_id = fixture.organization_id) as materials,
  (select count(*)::integer from public.material_contract_annexes where organization_id = fixture.organization_id) as material_annex_links,
  (select count(*)::integer from public.contract_scenarios where organization_id = fixture.organization_id) as scenarios,
  (select count(*)::integer from public.contract_requirements where organization_id = fixture.organization_id) as requirements,
  (select count(*)::integer from public.function_templates where organization_id = fixture.organization_id) as function_templates,
  (select count(*)::integer from public.function_template_items where organization_id = fixture.organization_id) as function_template_items,
  (select count(*)::integer from public.function_aliases where organization_id = fixture.organization_id) as function_aliases,
  (select count(*)::integer from public.contract_training_requirements where organization_id = fixture.organization_id) as course_requirements,
  (select count(*)::integer from public.organization_annex_settings where organization_id = fixture.organization_id) as annex_settings
from organization_contract_template_fixture as fixture;

create temporary table organization_contract_template_rollback_before as
select
  (select count(*)::integer from public.materials) as materials,
  (select count(*)::integer from public.material_contract_annexes) as material_annex_links,
  (select count(*)::integer from public.contract_scenarios) as scenarios,
  (select count(*)::integer from public.contract_requirements) as requirements,
  (select count(*)::integer from public.function_templates) as function_templates,
  (select count(*)::integer from public.function_template_items) as function_template_items,
  (select count(*)::integer from public.function_aliases) as function_aliases,
  (select count(*)::integer from public.contract_training_requirements) as course_requirements,
  (select count(*)::integer from public.organization_annex_settings) as annex_settings,
  (select count(*)::integer from private.organization_contract_template_installs) as installs,
  (select count(*)::integer from private.organization_contract_template_ownership) as ownership,
  (select count(*)::integer from private.organization_contract_template_events) as template_events,
  (select count(*)::integer from private.platform_organization_events) as lifecycle_events;

create function pg_temp.fail_contract_requirement_insert_for_rollback()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.organizations as organization
    where organization.id = new.organization_id
      and organization.name = 'pgTAP contract template rollback'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'test-only contract requirement failure';
  end if;

  return new;
end;
$function$;

create trigger pgtap_fail_contract_requirement_insert_for_rollback
before insert on public.contract_requirements
for each row execute function pg_temp.fail_contract_requirement_insert_for_rollback();

set local role authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000021"}',
  true
);

select throws_ok(
  $$select public.create_organization_draft('pgTAP contract template rollback', null)$$,
  'P0001',
  'test-only contract requirement failure',
  'a test-only requirement trigger aborts the draft provisioning transaction'
);

reset role;

drop trigger pgtap_fail_contract_requirement_insert_for_rollback on public.contract_requirements;
drop function pg_temp.fail_contract_requirement_insert_for_rollback();

select is(
  (select count(*)::integer from public.organizations where name = 'pgTAP contract template rollback'),
  0,
  'a failed provisioning leaves no organization row'
);

select is(
  (select count(*)::integer from private.platform_organization_events
   where organization_name = 'pgTAP contract template rollback'),
  0,
  'a failed provisioning leaves no lifecycle event'
);

select is(
  (
    select to_jsonb(prior)
    from organization_contract_template_rollback_before as prior
  ),
  jsonb_build_object(
    'materials', (select count(*)::integer from public.materials),
    'material_annex_links', (select count(*)::integer from public.material_contract_annexes),
    'scenarios', (select count(*)::integer from public.contract_scenarios),
    'requirements', (select count(*)::integer from public.contract_requirements),
    'function_templates', (select count(*)::integer from public.function_templates),
    'function_template_items', (select count(*)::integer from public.function_template_items),
    'function_aliases', (select count(*)::integer from public.function_aliases),
    'course_requirements', (select count(*)::integer from public.contract_training_requirements),
    'annex_settings', (select count(*)::integer from public.organization_annex_settings),
    'installs', (select count(*)::integer from private.organization_contract_template_installs),
    'ownership', (select count(*)::integer from private.organization_contract_template_ownership),
    'template_events', (select count(*)::integer from private.organization_contract_template_events),
    'lifecycle_events', (select count(*)::integer from private.platform_organization_events)
  ),
  'the injected failure rolls back all catalog, install, ownership, and event writes'
);

set local role authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000021"}',
  true
);

select lives_ok(
  $$select * from public.list_platform_contract_template_status()$$,
  'a platform administrator can read contract template status'
);

select lives_ok(
  format(
    'select public.apply_contract_template_version(p_organization_id => %L::uuid)',
    (select existing_organization_id from organization_contract_template_fixture)
  ),
  'a platform administrator can apply v1 to an existing organization'
);

select lives_ok(
  format(
    'select public.apply_contract_template_version(p_organization_id => %L::uuid)',
    (select organization_id from organization_contract_template_fixture)
  ),
  'applying the already installed v1 is an idempotent no-op'
);

select is(
  (
    select bool_and(not has_table_privilege(access.role_name, access.table_name, 'SELECT'))
    from (values
      ('anon', 'private.contract_template_versions'),
      ('anon', 'private.contract_template_records'),
      ('anon', 'private.contract_template_source_rows'),
      ('anon', 'private.organization_contract_template_installs'),
      ('anon', 'private.organization_contract_template_ownership'),
      ('anon', 'private.organization_contract_template_events'),
      ('authenticated', 'private.contract_template_versions'),
      ('authenticated', 'private.contract_template_records'),
      ('authenticated', 'private.contract_template_source_rows'),
      ('authenticated', 'private.organization_contract_template_installs'),
      ('authenticated', 'private.organization_contract_template_ownership'),
      ('authenticated', 'private.organization_contract_template_events')
    ) as access(role_name, table_name)
  ),
  true,
  'anon and authenticated have no table-level SELECT on any private baseline, install, ownership, or event table'
);

select is(
  (
    select bool_and(not has_any_column_privilege(access.role_name, access.table_name, 'SELECT'))
    from (values
      ('anon', 'private.contract_template_versions'),
      ('anon', 'private.contract_template_records'),
      ('anon', 'private.contract_template_source_rows'),
      ('anon', 'private.organization_contract_template_installs'),
      ('anon', 'private.organization_contract_template_ownership'),
      ('anon', 'private.organization_contract_template_events'),
      ('authenticated', 'private.contract_template_versions'),
      ('authenticated', 'private.contract_template_records'),
      ('authenticated', 'private.contract_template_source_rows'),
      ('authenticated', 'private.organization_contract_template_installs'),
      ('authenticated', 'private.organization_contract_template_ownership'),
      ('authenticated', 'private.organization_contract_template_events')
    ) as access(role_name, table_name)
  ),
  true,
  'anon and authenticated have no column-level SELECT on any private baseline, install, ownership, or event table'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000021"}',
  true
);

select is(
  (
    select to_jsonb(counts)
    from organization_contract_template_counts_before as counts
  ),
  (
    select jsonb_build_object(
      'materials', (select count(*)::integer from public.materials where organization_id = fixture.organization_id),
      'material_annex_links', (select count(*)::integer from public.material_contract_annexes where organization_id = fixture.organization_id),
      'scenarios', (select count(*)::integer from public.contract_scenarios where organization_id = fixture.organization_id),
      'requirements', (select count(*)::integer from public.contract_requirements where organization_id = fixture.organization_id),
      'function_templates', (select count(*)::integer from public.function_templates where organization_id = fixture.organization_id),
      'function_template_items', (select count(*)::integer from public.function_template_items where organization_id = fixture.organization_id),
      'function_aliases', (select count(*)::integer from public.function_aliases where organization_id = fixture.organization_id),
      'course_requirements', (select count(*)::integer from public.contract_training_requirements where organization_id = fixture.organization_id),
      'annex_settings', (select count(*)::integer from public.organization_annex_settings where organization_id = fixture.organization_id)
    )
    from organization_contract_template_fixture as fixture
  ),
  'reapplying v1 leaves every provisioned catalog count unchanged'
);

set local role authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000022', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000022"}',
  true
);

select throws_ok(
  $$select * from public.list_platform_contract_template_status()$$,
  'P0001',
  'Acesso negado',
  'an organization administrator cannot read platform-wide contract template status'
);

select throws_ok(
  format(
    'select public.apply_contract_template_version(p_organization_id => %L::uuid)',
    (select organization_id from organization_contract_template_fixture)
  ),
  'P0001',
  'Acesso negado',
  'an organization administrator cannot invoke the global version apply RPC'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000023', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000023"}',
  true
);

select throws_ok(
  $$select * from public.list_platform_contract_template_status()$$,
  'P0001',
  'Acesso negado',
  'a regular authenticated user cannot read platform-wide contract template status'
);

select throws_ok(
  format(
    'select public.apply_contract_template_version(p_organization_id => %L::uuid)',
    (select organization_id from organization_contract_template_fixture)
  ),
  'P0001',
  'Acesso negado',
  'a non-platform user cannot invoke the global version apply RPC'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000021"}',
  true
);

select is(
  (
    select count(*)::integer
    from (
      (
        select prior.organization_id, prior.annex_number, prior.active
        from organization_contract_template_existing_settings_before as prior
        except
        select setting.organization_id, setting.annex_number, setting.active
        from public.organization_annex_settings as setting
        join organization_contract_template_fixture as fixture
          on fixture.existing_organization_id = setting.organization_id
      )
      union all
      (
        select setting.organization_id, setting.annex_number, setting.active
        from public.organization_annex_settings as setting
        join organization_contract_template_fixture as fixture
          on fixture.existing_organization_id = setting.organization_id
        except
        select prior.organization_id, prior.annex_number, prior.active
        from organization_contract_template_existing_settings_before as prior
      )
    ) as settings_difference
  ),
  0,
  'manual application preserves every pre-existing annex setting'
);

select is(
  (
    select setting.active
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.existing_organization_id = setting.organization_id
    where setting.annex_number = '04'
  ),
  false,
  'manual application preserves a custom inactive Annex 04'
);

select is(
  (
    select setting.active
    from public.organization_annex_settings as setting
    join organization_contract_template_fixture as fixture
      on fixture.existing_organization_id = setting.organization_id
    where setting.annex_number = '06'
  ),
  true,
  'manual application preserves a custom active Annex 06'
);

select is(
  (
    select status.installed_version
    from public.list_platform_contract_template_status() as status
    join organization_contract_template_fixture as fixture
      on fixture.existing_organization_id = status.organization_id
  ),
  1,
  'manual application records v1 for the existing organization'
);

select is(
  (
    select status.installed_sha256
    from public.list_platform_contract_template_status() as status
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = status.organization_id
  ),
  (
    select prior.installed_sha256
    from organization_contract_template_apply_before as prior
  ),
  'idempotent apply leaves the installed content hash unchanged'
);

select is(
  (
    select count(*)::integer
    from private.organization_contract_template_events as event
    join organization_contract_template_fixture as fixture
      on fixture.organization_id = event.organization_id
  ),
  (
    select prior.event_count
    from organization_contract_template_apply_before as prior
  ),
  'idempotent apply does not append a duplicate application event'
);

insert into public.organization_bases (organization_id, name)
select fixture.organization_id, 'Contract annex guard test base'
from organization_contract_template_fixture as fixture;

update public.materials as duplicate
set merged_into_material_id = canonical.id
from public.materials as canonical
join organization_contract_template_fixture as fixture
  on fixture.organization_id = canonical.organization_id
where duplicate.organization_id = canonical.organization_id
  and duplicate.contract_item_code = 'A04-001'
  and canonical.contract_item_code = 'A04-002';

select throws_ok(
  format(
    $test$
      insert into public.material_lots (
        organization_id, material_id, base_id, lot_number,
        received_quantity, available_quantity
      )
      select fixture.organization_id, material.id, base.id, 'merged-material-guard', 1, 1
      from organization_contract_template_fixture as fixture
      join public.materials as material
        on material.organization_id = fixture.organization_id
       and material.contract_item_code = 'A04-001'
      join public.organization_bases as base
        on base.organization_id = fixture.organization_id
       and base.name = 'Contract annex guard test base'
    $test$
  ),
  'P0001',
  'Este cadastro foi consolidado. Selecione o material principal para registrar a entrada.',
  'the stock-entry guard still rejects materials consolidated into another catalog item'
);

select * from finish();

rollback;
