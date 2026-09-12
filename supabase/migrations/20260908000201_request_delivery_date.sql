-- Registra quando uma solicitação foi efetivamente entregue.
alter table public.employee_portal_requests
  add column if not exists delivered_at date;

create index if not exists employee_portal_requests_delivered_idx
  on public.employee_portal_requests(organization_id, delivered_at)
  where delivered_at is not null;

