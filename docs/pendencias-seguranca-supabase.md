# Pendências de segurança e desempenho do Supabase

Registradas em 22/10/2026 após a publicação do fluxo de devolução. Revisar depois da validação funcional, sem alterar permissões durante a validação atual.

## Segurança — RPCs `SECURITY DEFINER` acessíveis a `anon`

O Supabase Advisor sinalizou seis funções no schema `public` que podem ser executadas pelo papel `anon`:

- `get_employee_portal_data_v3`
- `get_measurement_request`
- `submit_employee_portal_course`
- `submit_employee_portal_measurements`
- `submit_employee_portal_request`
- `submit_measurement_request`

Próximos passos:

- Conferir `GRANT EXECUTE`, validação de identidade/token, limites de tentativas e escopo dos dados retornados por cada função.
- Decidir caso a caso se o acesso anônimo é necessário para os fluxos públicos do portal; não revogar em lote, pois isso pode interromper o portal do colaborador.
- Se necessário, restringir a execução ou mover operações privilegiadas para funções internas/Edge Functions com validação explícita.
- Testar portal, cursos, solicitações e links de medidas após qualquer mudança.

Referência do Advisor: [função `SECURITY DEFINER` executável por `anon`](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Desempenho — chaves estrangeiras sem índice de cobertura

O Advisor listou nove FKs sem índice de cobertura:

- `material_units.pending_return_item_id`
- `organization_invitations.created_by`
- `profile_access_overrides.organization_id`
- `return_accountability.deduction_reviewed_by`
- `return_items.deduction_reviewed_by`
- `term_signature_links.created_by`
- `term_signature_links.delivery_id`
- `term_signature_links.employee_id`
- `term_signature_links.return_id`

Próximos passos:

- Conferir índices existentes e consultas/cascatas que usam cada FK antes de adicionar índices.
- Revisar `material_units_pending_return_idx`: ele foi criado na migração do fluxo de devolução como índice parcial e o Advisor ainda apontou a FK como sem cobertura; avaliar se é necessário um índice não parcial.
- Reconsultar Advisor e planos de consulta após a correção. O índice recém-criado também pode aparecer como “não utilizado” até haver consultas representativas.

Referência do Advisor: [FKs sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
