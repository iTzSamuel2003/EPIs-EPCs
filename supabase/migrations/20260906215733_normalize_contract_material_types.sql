begin;

update public.materials
set type = 'FERRAMENTAL', contract_category = 'FERRAMENTAL', ca_required = false,
    test_required = false, test_type = null, test_interval_months = null,
    report_required = false, art_required = false, ca_number = null
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and contract_item_code in ('A04-027', 'A05-108', 'A06-024', 'A04-028', 'A05-109', 'A06-025');

update public.materials
set type = 'EPC', contract_category = 'EPC', usage_scope = 'coletivo', ca_required = false,
    test_required = true, test_type = 'dielectric', test_interval_months = 12,
    report_required = true, art_required = true, ca_number = null
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and contract_item_code in ('A04-029', 'A05-110');

update public.materials
set type = 'EPI', contract_category = 'EPI', usage_scope = 'individual', ca_required = true,
    ca_number = coalesce(nullif(ca_number, ''), 'PENDENTE'), test_required = true,
    test_type = 'dielectric', test_interval_months = 12, report_required = true, art_required = true
where organization_id = '4dc792c1-5087-4eea-a806-e2957cd0d09d'
  and contract_item_code = 'A07-009';

commit;
