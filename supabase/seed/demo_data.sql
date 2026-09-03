-- Dados demonstrativos fictícios para apresentação do EPIS+.
-- Seguro para executar novamente: usa IDs fixos e ON CONFLICT.
do $$
declare
  v_org uuid;
  v_admin uuid := '6d3667d5-eba6-4c0e-b8ec-7ae8f96f5fcb';
begin
  select id into v_org from public.organizations where name = 'EPIS+ - Organização principal' limit 1;
  if v_org is null then raise exception 'Organização principal não encontrada'; end if;

  insert into public.suppliers (id, organization_id, name, document, contact) values
    ('11111111-1111-4111-8111-111111111111', v_org, 'Segurança Total Equipamentos', '12.345.678/0001-90', 'contato@segurancatotal.example')
  on conflict (id) do nothing;

  insert into public.materials (id, organization_id, internal_code, name, description, type, unit, ca_number, ca_expires_at, useful_life_months, minimum_stock, location, status) values
    ('22222222-2222-4222-8222-222222222221', v_org, 'EPI-00001', 'Cinturão paraquedista', 'Material flexível para trabalho em altura', 'EPI', 'un.', '48721', '2028-06-30', 24, 5, 'Almoxarifado A', 'active'),
    ('22222222-2222-4222-8222-222222222222', v_org, 'EPI-00002', 'Talabarte duplo com absorvedor', 'Equipamento flexível para retenção de queda', 'EPI', 'un.', '51209', '2027-12-31', 18, 3, 'Almoxarifado A', 'active'),
    ('22222222-2222-4222-8222-222222222223', v_org, 'EPC-00001', 'Fita de isolamento de área', 'EPC para sinalização e isolamento temporário', 'EPC', 'rolo', null, null, 12, 2, 'Almoxarifado B', 'active')
  on conflict (id) do nothing;

  insert into public.employees (id, organization_id, registration, full_name, cpf, job_title, function_name, department, cost_center, company, unit, admission_date, phone, email, status) values
    ('33333333-3333-4333-8333-333333333331', v_org, 'MAT-0001', 'Mariana Costa', '111.111.111-11', 'Técnica de Segurança', 'Técnica de Segurança do Trabalho', 'SESMT', 'CC-010', 'EPIS+ Indústria', 'Unidade Norte', '2024-02-05', '(65) 99999-1001', 'mariana.costa@example.com', 'active'),
    ('33333333-3333-4333-8333-333333333332', v_org, 'MAT-0002', 'Rafael Mendes', '222.222.222-22', 'Operador de Produção', 'Operador', 'Produção', 'CC-020', 'EPIS+ Indústria', 'Unidade Norte', '2023-08-14', '(65) 99999-1002', 'rafael.mendes@example.com', 'active'),
    ('33333333-3333-4333-8333-333333333333', v_org, 'MAT-0003', 'Ana Paula Reis', '333.333.333-33', 'Auxiliar de Logística', 'Auxiliar', 'Logística', 'CC-030', 'EPIS+ Indústria', 'Unidade Sul', '2025-01-20', '(65) 99999-1003', 'ana.reis@example.com', 'active')
  on conflict (id) do nothing;

  insert into public.material_lots (id, organization_id, material_id, lot_number, received_quantity, available_quantity, entry_date, expires_at, supplier_id, invoice_number) values
    ('44444444-4444-4444-8444-444444444441', v_org, '22222222-2222-4222-8222-222222222221', 'LOTE-CIN-2026-01', 25, 24, '2026-01-15', '2028-01-15', '11111111-1111-4111-8111-111111111111', 'NF-2026-001'),
    ('44444444-4444-4444-8444-444444444442', v_org, '22222222-2222-4222-8222-222222222222', 'LOTE-TAL-2026-01', 10, 8, '2026-02-10', '2027-08-10', '11111111-1111-4111-8111-111111111111', 'NF-2026-002'),
    ('44444444-4444-4444-8444-444444444443', v_org, '22222222-2222-4222-8222-222222222223', 'LOTE-FIT-2026-01', 8, 8, '2026-03-03', '2027-03-03', '11111111-1111-4111-8111-111111111111', 'NF-2026-003')
  on conflict (id) do nothing;

  insert into public.stock_movements (id, organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values
    ('55555555-5555-4555-8555-555555555551', v_org, '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444441', 'entry', 25, v_admin, 'Carga demonstrativa'),
    ('55555555-5555-4555-8555-555555555552', v_org, '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442', 'entry', 10, v_admin, 'Carga demonstrativa'),
    ('55555555-5555-4555-8555-555555555553', v_org, '22222222-2222-4222-8222-222222222223', '44444444-4444-4444-8444-444444444443', 'entry', 8, v_admin, 'Carga demonstrativa')
  on conflict (id) do nothing;

  insert into public.deliveries (id, organization_id, employee_id, delivered_at, reason, responsible_id, notes) values
    ('66666666-6666-4666-8666-666666666661', v_org, '33333333-3333-4333-8333-333333333331', '2026-03-04', 'admission', v_admin, 'Entrega demonstrativa de integração')
  on conflict (id) do nothing;
  insert into public.delivery_items (id, organization_id, delivery_id, material_id, lot_id, quantity, expected_replacement_at) values
    ('77777777-7777-4777-8777-777777777771', v_org, '66666666-6666-4666-8666-666666666661', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444441', 2, '2028-03-04'),
    ('77777777-7777-4777-8777-777777777772', v_org, '66666666-6666-4666-8666-666666666661', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442', 2, '2027-09-04')
  on conflict (id) do nothing;
  insert into public.stock_movements (id, organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values
    ('55555555-5555-4555-8555-555555555554', v_org, '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444441', 'delivery', 2, v_admin, 'Entrega demonstrativa'),
    ('55555555-5555-4555-8555-555555555555', v_org, '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442', 'delivery', 2, v_admin, 'Entrega demonstrativa')
  on conflict (id) do nothing;

  insert into public.returns (id, organization_id, employee_id, returned_at, reason, responsible_id, notes) values
    ('88888888-8888-4888-8888-888888888881', v_org, '33333333-3333-4333-8333-333333333331', '2026-06-10', 'replacement', v_admin, 'Devolução demonstrativa em bom estado')
  on conflict (id) do nothing;
  insert into public.return_items (id, organization_id, return_id, delivery_item_id, material_id, lot_id, quantity) values
    ('99999999-9999-4999-8999-999999999991', v_org, '88888888-8888-4888-8888-888888888881', '77777777-7777-4777-8777-777777777771', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444441', 1)
  on conflict (id) do nothing;
  insert into public.stock_movements (id, organization_id, material_id, lot_id, movement_type, quantity, created_by, notes) values
    ('55555555-5555-4555-8555-555555555556', v_org, '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444441', 'return', 1, v_admin, 'Devolução demonstrativa')
  on conflict (id) do nothing;

  insert into public.material_tests (id, organization_id, material_id, performed_at, interval_months, next_due_at, result, examiner, certificate_number, notes, created_by) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', v_org, '22222222-2222-4222-8222-222222222221', '2026-03-01', 6, '2026-09-01', 'approved_with_restrictions', 'Engenharia Segura Ltda.', 'LAUDO-2026-031', 'Atenção ao desgaste visual nas fitas.', v_admin),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', v_org, '22222222-2222-4222-8222-222222222222', '2026-06-15', 12, '2027-06-15', 'approved', 'Engenharia Segura Ltda.', 'LAUDO-2026-062', 'Ensaio periódico aprovado.', v_admin)
  on conflict (id) do nothing;
end $$;

