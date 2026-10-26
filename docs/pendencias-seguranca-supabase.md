# Pendências de segurança e desempenho do Supabase

Registradas em 22/10/2026 após a publicação do fluxo de devolução; atualizadas em 24/10/2026 após auditoria read-only do Supabase e Vercel. Nenhuma permissão, dado de produção, variável ou regra de firewall foi alterada durante esta auditoria.

## Auditoria de segurança — 24/10/2026

### Achados confirmados que aguardam correção

1. **Leitura ampla dentro da organização.** O banco permite `SELECT` a qualquer usuário autenticado da organização em `employees`, `employee_courses`, `employee_portal_requests`, `deliveries` e `returns`, entre outras tabelas. Isso não atravessa organizações, mas ignora as permissões de página/função definidas no aplicativo. Os campos expostos incluem CPF, telefone, e-mail, nascimento, observações, solicitações e caminhos de certificados; os arquivos privados de cursos e solicitações também podem ser lidos por qualquer usuário autenticado da mesma organização. Políticas RLS permissivas se combinam com `OR`, portanto adicionar uma policy mais restrita não remove a policy ampla existente.
   - **Correção proposta:** reservar dados pessoais e documentos para RH/Admin; criar uma consulta controlada de diretório operacional (nome, matrícula, função, setor e unidade) para fluxos que realmente precisem listar colaboradores. Atualizar os chamadores e testar cada perfil no PostgREST.
   - **Escopo confirmado em 26/10/2026:** CPF, contatos, documentos, medidas e cursos restritos a RH/Admin. TST/Almoxarife mantêm acesso aos dados operacionais necessários (nome, matrícula, função, setor, admissão/desligamento) e às fichas de Entrega/Devolução. Migração e telas ajustadas localmente; aguardam validação de banco e publicação antes de entrar em produção.

2. **Portal público de colaboradores usa matrícula + CPF como único fator.** O portal retorna dados e aceita alterações, solicitações e declarações de cursos com esses dois dados. As RPCs de consulta/cursos usam limite persistente de 20 tentativas por combinação matrícula/CPF a cada 15 minutos. A Edge Function de solicitações aplica limite de 10 tentativas por IP e por combinação em 5 minutos, mas o contador fica em memória local da instância e pode ser reiniciado ou distribuído entre instâncias. Nenhum desses controles é um segundo fator verificado.
   - **Correção proposta:** adicionar código de uso único enviado por canal previamente verificado, vincular sessão e alterações ao desafio, reforçar rate limit por IP/colaborador e minimizar a retenção de CPF no navegador. Esse segundo fator é uma prova adicional de posse do canal; não é assinatura ICP-Brasil.
   - **Pendente:** escolher canal/provedor e aceitar eventual custo ou limitações operacionais. Não foi habilitado WhatsApp/SMS/e-mail nesta auditoria.

3. **Cursos informados pelo colaborador podem aparecer como válidos sem análise do RH.** O portal aceita envio sem anexo; a RPC `SECURITY DEFINER` insere o curso e as datas diretamente e não registra estado de revisão. A consulta do portal não distingue autodeclaração de comprovante aprovado.
   - **Correção proposta:** criar estado “pendente de análise”; somente contar como válido após aprovação do RH e registrar revisor/data. Se a autodeclaração for mantida, exibi-la explicitamente como não verificada.
   - **Escopo confirmado em 26/10/2026:** cursos já existentes e submissões pelo portal começam pendentes; a matriz só conta cursos aprovados e a ficha mostra o estado de análise. Cursos cadastrados diretamente pelo RH são marcados como aprovados pelo usuário autenticado. Migração e telas ajustadas localmente; aguardam validação de banco e publicação antes de entrar em produção.

4. **Importação CAEPI usa FTP sem proteção de transporte.** O workflow baixa o ZIP por `ftp://` e depois envia os dados a um importador que valida o OIDC do GitHub. O OIDC identifica o workflow, mas não autentica os bytes recebidos por FTP; uma alteração em trânsito poderia contaminar os dados de CA.
   - **Correção proposta:** localizar uma fonte governamental HTTPS atual ou artefato com assinatura/checksum recebido por canal independente; adicionar controles de timestamp, volume e mudanças inesperadas.
   - **Pendente:** validar atualidade e formato antes de trocar a origem. O MTE documenta o FTP como fonte oficial, mas o ZIP HTTPS apresentado na página do MTE aparece atualizado em 2023, e o CSV oficial listado aparece datado de 2025. Não trocar por um espelho antigo sem confirmar a atualização.
   - Referências oficiais: [FAQ do MTE — base de dados CAEPI](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/equipamentos-de-protecao-individual-epi/perguntas_e_respostas), [página de arquivos do MTE](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/equipamentos-de-protecao-individual-epi) e [consulta CAEPI](https://caepi.trabalho.gov.br/internet/ConsultaCAInternet.aspx).

### Controles verificados / itens que não são achados confirmados

- PostgreSQL de produção está saudável na versão **17.11**; a atualização previamente autorizada foi concluída.
- Vercel não tinha regras customizadas de firewall ativas nem rascunhos; a amostra consultada não mostrou ataques mitigados. Um deployment de Preview consultado redirecionou para o SSO da Vercel. As variáveis listadas são somente nomes públicos de URL/chave Supabase; seus valores não foram lidos. **Ainda não foi confirmado se Preview usa projeto Supabase isolado.**
- Buckets de documentos estão privados; o bucket público de logos é esperado para exibir a marca e limita tamanho/tipos. Isso não corrige, porém, as policies de leitura organizacional descritas no achado 1.
- Cabeçalhos HTTP relevantes estão configurados em `next.config.ts`. `npm audit` não reportou vulnerabilidades no lockfile; uma busca por padrões de credenciais de alta confiança não encontrou segredos nos arquivos versionados nem no histórico disponível.
- O Advisor sinaliza RPCs `SECURITY DEFINER` acessíveis a `anon` e a `authenticated`; os endpoints públicos revisados têm finalidade no portal/link e as RPCs de alteração protegidas por página foram conferidas. Não revogar em lote. Leaked Password Protection está desligado e o plano Supabase atual é Free; a funcionalidade requer Pro ou superior segundo a [documentação oficial do Supabase](https://supabase.com/docs/guides/auth/password-security). Nenhum upgrade pago foi autorizado.
- A configuração local em `supabase/config.toml` ainda permite senha mínima de 6 caracteres e não exige confirmação de e-mail. Os valores equivalentes da configuração Auth de produção não puderam ser lidos pelas ferramentas disponíveis; verificar no painel antes de classificar como configuração ativa.
- A auditoria cobriu os principais caminhos de segurança do Supabase/Vercel, mas não foi um exame linha a linha dos 272 arquivos. O segundo revisor independente não pôde iniciar por limite de agentes; a cobertura permanece parcial.

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
