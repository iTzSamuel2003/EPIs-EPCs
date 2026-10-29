-- Cover foreign keys introduced for employee history lookups and cleanup.
create index if not exists attendance_occurrences_organization_id_idx
  on public.attendance_occurrences (organization_id);
create index if not exists attendance_occurrences_created_by_idx
  on public.attendance_occurrences (created_by);

create index if not exists employee_hr_records_employee_id_idx
  on public.employee_hr_records (employee_id);
create index if not exists employee_hr_records_created_by_idx
  on public.employee_hr_records (created_by);
create index if not exists employee_hr_records_updated_by_idx
  on public.employee_hr_records (updated_by);
create index if not exists employee_hr_records_voided_by_idx
  on public.employee_hr_records (voided_by);
