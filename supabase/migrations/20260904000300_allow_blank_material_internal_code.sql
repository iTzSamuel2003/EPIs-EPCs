-- O código interno é opcional: a empresa pode preenchê-lo posteriormente.
alter table public.materials
  alter column internal_code drop not null;
