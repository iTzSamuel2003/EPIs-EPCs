revoke all on function public.submit_employee_portal_course(
  text, text, text, text, date, date, text, text
) from public, anon, authenticated;

grant execute on function public.submit_employee_portal_course(
  text, text, text, text, date, date, text, text
) to service_role;
