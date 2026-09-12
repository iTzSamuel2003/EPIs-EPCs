alter table public.material_tests
  add constraint material_tests_report_url_http_check
  check (report_url is null or report_url ~* '^https?://');


