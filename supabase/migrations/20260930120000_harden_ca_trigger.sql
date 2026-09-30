-- Evita que o gatilho de atualização do CA dependa do search_path da sessão.
alter function public.touch_ca_certificate_updated_at() set search_path = public;
