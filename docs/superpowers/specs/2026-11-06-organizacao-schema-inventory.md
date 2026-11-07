# Inventário de escopo organizacional

## Origem e reconciliação

- Repositório: `C:\Users\tomro\Desktop\Samuel\EPIs-EPCs`.
- Banco Supabase vinculado consultado somente para leitura em 2026-11-06.
- Migração mais recente no remoto e no repositório antes desta tarefa: `20261104032615_accept_pending_organization_invitation`.
- `supabase migration list --linked` identificou 141 versões iguais, 16 versões apenas locais e 17 apenas remotas antes da nova migração desta tarefa. Portanto, o histórico diverge apesar do mesmo último timestamp; não aplicar a nova migração no Supabase hospedado até reconciliar as histórias.
- Versões apenas locais: `20260915100000`, `20260915110000`, `20260915120000`, `20260919231108`, `20260920081326`, `20260924000100`, `20260924000200`, `20260930100000`, `20260930110000`, `20260930120000`, `20261001090000`, `20261001100000`, `20261002100000`, `20261002110000`, `20261002120000`, `20261021183314`.
- Versões apenas remotas: `20260915114455`, `20260916153807`, `20260916154238`, `20260919231120`, `20260924124723`, `20260924124822`, `20260930190924`, `20260930191818`, `20260930192009`, `20261001130632`, `20261001131120`, `20261002141555`, `20261002141831`, `20261002142056`, `20261021184942`, `20261030140533`, `20261030141252`.
- A tabela `organizations` ainda não possui estado de ciclo de vida.
- `organization_invitations` ainda contém `token_hash`, `accepted_at`, `expires_at` e metadados atuais, mas não classifica convites nem registra revogação.
- Não existe tabela de sessão temporária de gestão de plataforma.

## Tabelas por organização

As seguintes tabelas públicas possuem `organization_id` e são consideradas na auditoria e na proteção contra exclusão de rascunho:

`attendance_collective_assessments`, `attendance_function_rules`, `attendance_occurrences`, `attendance_period_records`, `attendance_reduction_rules`, `audit_logs`, `categories`, `contract_requirements`, `contract_scenarios`, `contract_team_members`, `contract_teams`, `contract_training_requirements`, `deliveries`, `delivery_items`, `employee_aso_current_status`, `employee_asos`, `employee_courses`, `employee_hr_history_feed`, `employee_hr_records`, `employee_measurement_requests`, `employee_portal_requests`, `employee_profiles`, `employees`, `function_aliases`, `function_template_items`, `function_templates`, `material_contract_annexes`, `material_lots`, `material_tests`, `material_units`, `material_variants`, `materials`, `organization_annex_settings`, `organization_bases`, `organization_invitations`, `organization_role_access`, `pending_deliveries`, `profile_access_overrides`, `profile_base_access`, `profile_page_permissions`, `profiles`, `return_accountability`, `return_deduction_cases`, `return_deduction_refusal_records`, `return_deduction_refusal_witnesses`, `return_items`, `returns`, `stock_invoices`, `stock_movements`, `stock_transfer_items`, `stock_transfers`, `suppliers`, `term_signature_links`, `transaction_attachments`.

As tabelas com referência direta de chave estrangeira a `organizations` foram inventariadas separadamente no banco. A verificação de exclusão também deve procurar toda linha pública que tenha `organization_id`, cobrindo tabelas derivadas ou sem FK direta; qualquer referência indireta restante precisa ser documentada antes de habilitar exclusão.

## RLS e funções

- Todas as tabelas públicas com `organization_id` estavam com RLS habilitado na consulta remota.
- As políticas associadas a essas tabelas referenciam `private.current_organization_id()` ou `public.current_organization_id()`; nenhuma exceção foi encontrada no filtro agregado de políticas.
- Todas as políticas organizacionais de objetos do Storage consultadas também usam o helper de organização.
- O helper privado atual resolve diretamente `profiles.organization_id`; ele ainda não verifica estado de organização. A migração de ciclo de vida deve fazer o escopo comum retornar `NULL` se a organização não estiver `active`, e atualizar `public.current_organization_id()` para delegar ao helper privado.
- Foram identificadas 50 funções em `public`/`private` cujo código usa o helper; 36 são `SECURITY DEFINER`. Testes devem confirmar que a mudança central bloqueia seus caminhos comuns sem quebrar o fluxo de ativação do primeiro administrador.
- Funções privilegiadas que não derivam escopo pelo helper — por exemplo, endpoints de link assinado, portal do colaborador e operações por token — precisam de validação explícita do estado antes de leitura e gravação. Funções globais exclusivas de `platform_admin`, como a listagem administrativa de membros, devem continuar funcionando para gestão de organizações suspensas.

## Storage

Buckets remotos: `delivery-terms`, `employee-aso-documents`, `employee-course-documents`, `employee-hr-history-documents`, `employee-request-attachments`, `invoice-attachments`, `organization-logos` e `transaction-photos`.

Os objetos privados usam políticas relacionadas ao escopo organizacional e os fluxos de upload vistos no código colocam o UUID da organização no primeiro segmento do caminho. `organization-logos` é público; seus logos não devem ser tratados como dados privados nem usados como prova de autorização. A exclusão de rascunho deve verificar objetos em todos os buckets cujo primeiro segmento do caminho seja o UUID da organização.

## Funções Edge e agendamentos

- Nenhuma extensão `pg_cron` ou schema `cron` foi encontrada no banco remoto.
- Edge Functions locais com acesso a dados organizacionais: `employee-portal`, `employee-term-signature`, `create-term-signature-link`, `submit-employee-portal-request` e `submit-employee-portal-course`.
- Esses fluxos usam uma chave privilegiada em operações relevantes e, portanto, não ficam protegidos automaticamente por RLS. Devem checar `organizations.lifecycle_status = 'active'` antes de consultar ou alterar dados do colaborador, anexos, cursos, solicitações e assinaturas.
- `caepi-import` manipula a base global de CA e não participa do escopo por organização.

## Requisitos derivados para a migração

1. Preservar todas as organizações existentes como `active` e todos os convites existentes como `member`.
2. Bloquear acesso organizacional comum a leituras, gravações, Storage e rotinas privilegiadas nos estados `draft`, `awaiting_admin` e `suspended`.
3. Manter RPCs globais de plataforma independentes do escopo comum, para que a gestão de organizações continue disponível.
4. Antes de excluir um rascunho, bloquear se existir perfil, convite (inclusive revogado), qualquer linha com `organization_id`, objeto de Storage sob seu prefixo ou sessão de gestão ativa (quando a tabela de sessões for adicionada pela etapa futura).
5. A etapa futura de gestão temporária deve substituir a checagem de sessão ausente por uma verificação concreta e impedir o início de sessão até essa proteção estar aplicada.

## Estado após implementação local — 2026-11-07

- A migração `20261107015818_organization_drafts_and_lifecycle.sql` existe apenas no repositório local e foi aplicada no Supabase descartável usado para testes.
- Com essa migração, a contagem observada passa a 141 versões em comum, 17 somente locais e 17 somente remotas. A migração não foi aplicada no Supabase hospedado.
- A bateria `supabase/tests/organization_lifecycle.test.sql` concluiu com 80 testes pgTAP aprovados no banco descartável, incluindo recusa de aceitação durante suspensão, proteção contra associação a outra organização e bloqueios de exclusão por perfil, linha tenant, convite revogado e objeto Storage.
- O projeto ainda não oferece sessão temporária para o administrador da plataforma operar dentro dos módulos de uma organização; isso continua sendo uma etapa separada.
