-- As listas por função podem incluir EPI, EPC e ferramental.
alter table public.function_template_items
  drop constraint if exists function_template_items_item_type_check;

alter table public.function_template_items
  add constraint function_template_items_item_type_check
  check (item_type in ('EPI', 'EPC', 'FERRAMENTAL'));
