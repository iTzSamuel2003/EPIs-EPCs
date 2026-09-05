alter table public.materials
  add column if not exists replacement_interval_days integer
  check (replacement_interval_days is null or replacement_interval_days > 0);
