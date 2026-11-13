-- Allow RLS policies to evaluate base access for delivery and return rows
-- without granting table-wide SELECT or access to restricted signer data.
grant select (base_id)
  on table public.deliveries
  to authenticated;

grant select (base_id)
  on table public.returns
  to authenticated;
