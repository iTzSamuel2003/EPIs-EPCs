alter table public.employees
  add column termination_date date;

alter table public.employees
  add constraint employees_termination_date_after_admission
  check (
    termination_date is null
    or admission_date is null
    or termination_date >= admission_date
  );
