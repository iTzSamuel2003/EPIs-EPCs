# Padrão contratual por organização — Plano de implementação

> Implementação local concluída; validação pgTAP permanece pendente porque o banco local não conecta sem Docker. Nenhuma mudança foi aplicada em produção.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instalar uma base contratual versionada e independente por organização, com atualização explícita das organizações existentes.

**Architecture:** Guardar um snapshot privado, versionado e gerado da configuração contratual da DSX. Uma RPC autorizada copia o snapshot às tabelas operacionais existentes, com IDs locais e transação atômica; a criação de rascunho invoca essa cópia. O cliente mostra a versão instalada e aplica versões manualmente, e os módulos filtram suas opções pelas ativações de anexo da própria organização.

**Tech Stack:** Next.js 16, React, Supabase Postgres/RLS/RPC, Supabase CLI, TypeScript e testes SQL pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-07-padrao-contratual-organizacoes-design.md`

---

### Task 1: Escrever testes de provisionamento

**Files:**
- Create: `supabase/tests/organization_contract_template.test.sql`
- Inspect: `supabase/tests/organization_lifecycle.test.sql`
- Inspect: `supabase/tests/organization_management_mode.test.sql`

- [x] Escrever pgTAP cobrindo criação, cópia completa, ativação 03–05/06–07, ator/versão, ausência de dados operacionais, acesso privado negado e RPC negada para usuário sem perfil de plataforma ou administrador de organização.
- [x] Conferir todas as contagens esperadas: 243 materiais, 370 vínculos, 9 cenários, 864 requisitos, 5 listas/106 itens, 10 aliases e 11 cursos.
- [ ] Rodar somente o teste novo para confirmar que falha antes da migration.

### Task 2: Congelar e armazenar versão 1

**Files:**
- Create via CLI: `supabase/migrations/<timestamp>_organization_contract_templates.sql`
- Create: `supabase/contract-template-v1.json`
- Modify: `supabase/tests/organization_contract_template.test.sql`

- [ ] Criar a migration usando `supabase migration new organization_contract_templates`.
- [ ] Criar tabelas internas privadas e versionadas, sem exposição direta pelo Data API.
- [ ] Inserir export estático capturado da DSX em 2026-11-07; migration não deve selecionar tabelas DSX para gerar o payload.
- [ ] Versionar `canonical_records` e `source_rows` no arquivo de referência e incorporá-los sem alteração à migration; hash esperado: `083a88f58186b7836fcc1195552095a3df7f950b248b5ff946a7978c76691b69`.
- [ ] Incluir IDs de origem em metadados privados separados do hash para registrar a própria DSX como já instalada na v1, sem fazer consulta ao catálogo DSX durante o deploy.
- [ ] Usar chaves qualificadas e estáveis: código material, código cenário, cenário/material/escopo, grupo+curso, alias normalizado e lista+material.
- [ ] Incluir ownership por organização/tipo/chave/ID local; somente IDs já mapeados podem ser atualizados em versões seguintes. Colisão inicial com registro local aborta sem alterar dados.
- [ ] Armazenar o snapshot anterior dos campos gerenciados para detectar overrides locais em atualizações futuras.
- [ ] Salvar versão corrente e ativação inicial: 03/04/05 ativas, 06/07 inativas.
- [ ] Fixar fingerprint SHA-256 e linhas de referência; testar identidade além das contagens.

### Task 3: Clonar atomicamente no cadastro

**Files:**
- Modify: migration `organization_contract_templates`
- Modify: `supabase/tests/organization_contract_template.test.sql`

- [ ] Criar função interna de provisionamento que insere dados relacionados com UUIDs locais, resolve referências por chaves estáveis, registra ownership e mantém campos operacionais específicos.
- [ ] Incluir materiais, associações, cenários, requisitos, listas, aliases, cursos e configurações de anexos na mesma transação.
- [ ] Registrar origem/chave/ID local para cada linha contratual instalada e detectar colisões com registros não mapeados antes de inserir.
- [ ] Substituir `public.create_organization_draft` em migration nova, chamando provisionamento antes do retorno sem editar migration histórica.
- [ ] Preservar assinatura, retorno UUID, mensagem de validação, privilégio do administrador da plataforma e gravação do evento de rascunho da função substituída.
- [ ] Confirmar que falha do provisionamento reverte a criação do rascunho e seus eventos.
- [ ] Rodar `supabase.cmd test db supabase/tests/organization_contract_template.test.sql` e verificar cópia/rollback.

### Task 4: Aplicar versões manualmente

**Files:**
- Modify: migration `organization_contract_templates`
- Modify: `supabase/tests/organization_contract_template.test.sql`

- [ ] Criar RPC de status por organização protegida por verificação de administrador da plataforma.
- [ ] Manter essa RPC separada de `list_platform_organizations()` para preservar a assinatura SQL existente.
- [ ] Criar RPC para aplicar a versão vigente a uma única organização por transação e registrar ator/data/versão.
- [ ] Reaplicação deve comparar cada campo gerenciado ao snapshot anterior, atualizar somente campos sem override local, inserir itens novos, preservar settings/dados operacionais/registros locais e nunca apagar itens removidos.
- [ ] Serializar aplicação concorrente com `SELECT ... FOR UPDATE` na organização; reaplicação da versão já atual deve ser no-op sem duplicar auditoria.
- [ ] Bloquear linhas de catálogo gerenciadas e usar atualizações condicionais que comparem os valores anteriores para não sobrescrever uma edição concorrente.
- [ ] Registrar versão, hash, ator e contagens; qualquer colisão/erro reverte integralmente a organização corrente.
- [ ] Se algum registro inicial colidir com chave local não mapeada, lançar exceção `P0001` com mensagem legível para garantir rollback de toda a organização.
- [ ] Mostrar resumo de itens adicionados/atualizados, campos locais preservados e itens retirados do padrão para revisão.
- [ ] Testar idempotência, upgrade sintético, preservação de override local, auditoria, isolamento entre organizações e autorização.
- [ ] Testar diretamente que `authenticated` não tem privilégios de leitura nas tabelas privadas do padrão, sem revogar o `USAGE` no schema necessário aos helpers existentes.
- [ ] Revogar execução de `PUBLIC`/`anon`, usar `search_path` fixo e executar advisors; revisar grants/RLS.

### Task 5: Administrar a versão na plataforma

**Files:**
- Modify: `src/app/settings/organizations/page.tsx`
- Modify: `src/app/settings/organizations` estilos existentes, somente se necessário

- [ ] Consultar versão/hash instalada por organização pela nova RPC de status protegida; não alterar o retorno fixo de `list_platform_organizations()`.
- [ ] Usar `public.list_platform_contract_template_status()` e `public.apply_contract_template_version(uuid)` como contratos RPC da primeira versão.
- [ ] Mostrar DSX como fonte já instalada na v1 por metadados congelados; não oferecer cópia inicial sobre o catálogo de origem.
- [ ] Exibir status da base contratual e ação de aplicar versão atual em organizações existentes.
- [ ] Mostrar confirmação explicando que o padrão atualiza dados contratuais, sem copiar estoque, pessoas ou bases.
- [ ] Avisar que campos contratuais não personalizados recebem a versão nova; overrides, ativações e dados operacionais são preservados e itens ausentes ficam para revisão, sem exclusão automática.
- [ ] Atualizar a lista após sucesso e manter o erro visível se a RPC falhar.
- [ ] Explicar no formulário de criação que rascunhos recebem o padrão automaticamente.

### Task 6: Configurar a ativação de anexos

**Files:**
- Modify: `src/lib/contract-annex.ts`
- Modify: `src/app/materials/page.tsx`

- [ ] Incluir Anexo 03 (cursos) na tela de configuração sem remover Anexos 04–07.
- [ ] Implementar helper testável para resolver estado de anexo configurado por organização.
- [ ] Manter definições inativas acessíveis na configuração e materiais sem vínculo contratual disponíveis para operações manuais.
- [ ] Confirmar que a política RLS atual limita a escrita aos papéis `admin`/`tst` da própria organização.

### Task 7: Inventariar os consumidores de anexos

**Files:**
- Create: `docs/superpowers/specs/2026-11-07-anexos-consumidores.md`
- Inspect: `src/app/**`
- Inspect: employee-portal RPCs in `supabase/migrations/**`

- [ ] Usar `rg` para listar cada leitura e escrita de cenários, requisitos e cursos, incluindo seletores e RPCs do portal.
- [ ] Para cada consumidor, registrar o comportamento atual e a regra-alvo para anexo ativo/inativo no inventário salvo.
- [ ] Confirmar que registros históricos continuam consultáveis enquanto novos usos do anexo inativo ficam bloqueados.
- [ ] Inventariar RPCs/triggers de correção de entrada, entrega/atribuição, save de lista por função e gravação de equipe; definir como bloquear novas operações sem impedir devolução nem redução/correção negativa de saldo.

### Task 8: Aplicar a regra de anexos aos módulos

**Files:**
- Modify: `src/lib/contract-annex.ts`
- Modify: módulos e RPCs mapeados na Task 7

- [ ] Implementar helper para estado efetivo por organização e anexo, incluindo defaults explícitos 03–07.
- [ ] Atualizar páginas de catálogo, requisitos, listas, equipes, conformidade e cursos sem apagar definições/histórico.
- [ ] Filtrar cursos inativos nas RPCs do portal e recusar novas submissões para o Anexo 03 desativado.
- [ ] Bloquear entradas e correções positivas de saldo, e entregas/novas atribuições, nos RPCs/triggers; manter devoluções e correções de redução permitidas.
- [ ] Aplicar regra “qualquer vínculo ativo” a material associado a vários anexos; material sem vínculo mantém disponibilidade atual.
- [ ] Testar leitura, escrita, desativação e reativação em cada consumidor inventariado.

### Task 9: Revisar integração e validar

**Files:**
- Modify: `src/types/database.ts` ou tipos equivalentes, se presentes
- Modify: `README.md` ou documentação técnica de provisionamento, se necessário

- [ ] Ler documentação Next local relevante e documentação Supabase atual antes das mudanças finais.
- [ ] Rodar `supabase.cmd test db supabase/tests/organization_contract_template.test.sql` e os testes existentes `organization_lifecycle.test.sql` e `organization_management_mode.test.sql`.
- [ ] Rodar os testes de política de anexo/inativação adicionados para leituras, entradas e cursos do portal.
- [ ] Rodar `npm run lint`, `npm run check:encoding` e `npm run build`.
- [ ] Revisar diff, permissões, RLS, ausência de dados operacionais no snapshot e efeitos em ativação de anexos.
- [ ] Não aplicar migration nem executar RPC de provisionamento em produção sem etapa explícita de publicação.
- [ ] Confirmar que cada operação manual é por organização, com lock, rollback integral e resultado/auditoria independente; não implementar lote parcial nesta versão.
