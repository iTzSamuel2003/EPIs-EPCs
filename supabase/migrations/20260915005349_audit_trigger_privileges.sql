revoke execute on function public.audit_row_change() from public;
revoke execute on function public.audit_row_change() from anon;
grant execute on function public.audit_row_change() to authenticated;
