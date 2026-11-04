alter table public.pending_deliveries
  add column record_in_employee_history boolean not null default false;

create function public.enable_pending_delivery_history_entry(p_pending_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or private.current_organization_id() is null
    or not private.current_user_can_access_page('/deliveries') then
    raise exception 'Acesso restrito ao responsavel pela entrega';
  end if;

  update public.pending_deliveries
  set record_in_employee_history = true
  where id = p_pending_delivery_id
    and organization_id = private.current_organization_id()
    and requested_by = auth.uid()
    and private.can_access_base(base_id)
    and status = 'pending_signature';

  if not found then
    raise exception 'Ficha pendente nao encontrada ou sem permissao para alteracao';
  end if;
end;
$$;

revoke all on function public.enable_pending_delivery_history_entry(uuid) from public, anon;
grant execute on function public.enable_pending_delivery_history_entry(uuid) to authenticated;

create policy "employee history can view flagged completed deliveries"
  on public.pending_deliveries for select to authenticated
  using (
    record_in_employee_history
    and status = 'completed'
    and organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employee-history')
    and private.can_access_base(base_id)
  );

create policy "employee history can view delivery source records"
  on public.deliveries for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employee-history')
    and private.can_access_base(base_id)
  );

create policy "employee history can view delivery source items"
  on public.delivery_items for select to authenticated
  using (
    organization_id = private.current_organization_id()
    and private.has_current_organization_role(array['admin', 'rh'])
    and private.current_user_can_access_page('/employee-history')
    and exists (
      select 1
      from public.deliveries delivery
      where delivery.id = delivery_items.delivery_id
        and delivery.organization_id = delivery_items.organization_id
        and private.can_access_base(delivery.base_id)
    )
  );

create or replace view public.employee_hr_history_feed
with (security_invoker = true)
as
select occurrence.id as event_id,
  occurrence.organization_id,
  record.employee_id,
  occurrence.employee_name_snapshot as employee_name,
  occurrence.registration_snapshot as registration,
  occurrence.function_name_snapshot as function_name,
  'attendance'::text as source,
  occurrence.occurrence_type as event_type,
  occurrence.occurred_on,
  null::date as end_date,
  occurrence.occurred_at,
  occurrence.days_count,
  case occurrence.occurrence_type
    when 'late' then 'Atraso na jornada'
    when 'absence_justified' then 'Falta justificada'
    when 'absence_unjustified' then 'Falta injustificada'
    when 'convocation_absence' then 'Falta de convocação'
    when 'medical_certificate' then 'Atestado médico'
    when 'warning' then 'Advertência'
    else 'Ocorrência de assiduidade'
  end::text as title,
  null::text as details,
  record.period_start,
  record.period_end,
  occurrence.created_by,
  occurrence.created_by_name_snapshot as created_by_name,
  occurrence.created_at,
  null::text as document_path,
  null::timestamptz as voided_at,
  null::text as voided_by_name,
  null::text as void_reason
from public.attendance_occurrences occurrence
join public.attendance_period_records record
  on record.id = occurrence.attendance_record_id
 and record.organization_id = occurrence.organization_id
union all
select record.id as event_id,
  record.organization_id,
  record.employee_id,
  record.employee_name_snapshot as employee_name,
  record.registration_snapshot as registration,
  record.function_name_snapshot as function_name,
  'hr'::text as source,
  record.event_type,
  record.occurred_on,
  record.end_date,
  null::time without time zone as occurred_at,
  1::integer as days_count,
  record.title,
  record.details,
  null::date as period_start,
  null::date as period_end,
  record.created_by,
  record.created_by_name_snapshot as created_by_name,
  record.created_at,
  record.document_path,
  record.voided_at,
  record.voided_by_name_snapshot as voided_by_name,
  record.void_reason
from public.employee_hr_records record
union all
select delivery.id as event_id,
  delivery.organization_id,
  delivery.employee_id,
  employee.full_name as employee_name,
  employee.registration,
  coalesce(nullif(trim(employee.function_name), ''), nullif(trim(employee.job_title), ''), 'Não informado') as function_name,
  'delivery'::text as source,
  delivery.reason as event_type,
  delivery.delivered_at as occurred_on,
  null::date as end_date,
  null::time without time zone as occurred_at,
  1::integer as days_count,
  case delivery.reason
    when 'lost' then 'Perda ou extravio de material'
    when 'damaged' then 'Substituição de material danificado'
    else 'Entrega de materiais'
  end::text as title,
  concat_ws(
    E'\n',
    string_agg(
      format(
        '%s %s - %s%s',
        delivery_item.quantity,
        coalesce(nullif(trim(material.unit), ''), 'un.'),
        coalesce(material.name, 'Material'),
        case
          when material_variant.id is null then ''
          else format(' (%s)', coalesce(nullif(trim(material_variant.size), ''), material_variant.name))
        end
      ),
      E'\n' order by material.name
    ) filter (where delivery_item.id is not null),
    case when nullif(trim(delivery.notes), '') is null then null else 'Observações: ' || trim(delivery.notes) end
  ) as details,
  null::date as period_start,
  null::date as period_end,
  delivery.responsible_id as created_by,
  null::text as created_by_name,
  delivery.created_at,
  null::text as document_path,
  null::timestamptz as voided_at,
  null::text as voided_by_name,
  null::text as void_reason
from public.deliveries delivery
join public.pending_deliveries pending
  on pending.completed_delivery_id = delivery.id
 and pending.organization_id = delivery.organization_id
join public.employees employee
  on employee.id = delivery.employee_id
 and employee.organization_id = delivery.organization_id
left join public.delivery_items delivery_item
  on delivery_item.delivery_id = delivery.id
 and delivery_item.organization_id = delivery.organization_id
left join public.materials material
  on material.id = delivery_item.material_id
 and material.organization_id = delivery_item.organization_id
left join public.material_variants material_variant
  on material_variant.id = delivery_item.variant_id
 and material_variant.organization_id = delivery_item.organization_id
where pending.status = 'completed'
  and pending.record_in_employee_history
group by delivery.id, delivery.organization_id, delivery.employee_id,
  employee.full_name, employee.registration, employee.function_name, employee.job_title,
  delivery.reason, delivery.delivered_at, delivery.created_at, delivery.responsible_id, delivery.notes;

revoke all on public.employee_hr_history_feed from public, anon;
grant select on public.employee_hr_history_feed to authenticated;
