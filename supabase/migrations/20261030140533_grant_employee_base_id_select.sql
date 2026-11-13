-- Allow authorized users to read the assigned base identifier in the
-- operational employee directory without granting access to other PII.
grant select (base_id)
  on table public.employees
  to authenticated;
