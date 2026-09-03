-- Registration can be filled later when the import source does not provide it.
alter table public.employees
  alter column registration drop not null;

