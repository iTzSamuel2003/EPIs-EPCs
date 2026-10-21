create index if not exists pending_deliveries_employee_id_idx
  on public.pending_deliveries (employee_id);

create index if not exists pending_deliveries_requested_by_idx
  on public.pending_deliveries (requested_by);

create index if not exists pending_deliveries_completed_delivery_id_idx
  on public.pending_deliveries (completed_delivery_id)
  where completed_delivery_id is not null;

create index if not exists term_signature_links_pending_delivery_fk_idx
  on public.term_signature_links (pending_delivery_id)
  where pending_delivery_id is not null;
