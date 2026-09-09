alter table public.employees
  add column if not exists birth_date date;
