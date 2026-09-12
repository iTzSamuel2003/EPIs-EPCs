
-- The cleanup queue is maintained by trusted server-side jobs, not by users.
revoke all on function public.claim_employee_request_attachment_cleanup(integer) from public, anon, authenticated;
