# Catalogo Contratual Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar os requisitos contratuais de materiais, kits e conformidade sem inventar estoque fisico.

**Architecture:** O catalogo contratual sera separado do estoque por meio de metadados no material e tabelas de requisitos por cenario/equipe. Unidades rastreaveis e registros de ensaio serao ligados ao material, mantendo entregas atuais compatíveis. A carga sera idempotente por chave contratual e origem do anexo.

**Tech Stack:** Next.js, TypeScript, Supabase Postgres, migrations SQL, Supabase Storage, CSS existente.

---

### Task 1: Mapear o schema atual

**Files:**
- Review: `supabase/migrations/20260902000100_initial_schema.sql`
- Review: `supabase/migrations/20260903000200_material_tests.sql`
- Review: `src/types/domain.ts`

- [ ] Confirmar colunas e constraints atuais de `materials`, `material_tests`, `function_templates` e estoque.
- [ ] Confirmar compatibilidade com entregas, devolucoes e saldo atual.
- [ ] Registrar qualquer ajuste necessario antes de criar a migration.

### Task 2: Criar metadados contratuais

**Files:**
- Create: `supabase/migrations/<timestamp>_contract_catalog_metadata.sql`
- Modify: `src/types/domain.ts`

- [ ] Adicionar metadados de categoria contratual, uso individual/coletivo, anexo de origem, cenario, CA exigido, ensaio exigido, laudo/ART e periodicidade.
- [ ] Criar tabela de unidades rastreaveis para lote, serie, fabricante, modelo, tamanho, fabricacao, validade e status.
- [ ] Adicionar RLS por organizacao e indices para consultas de conformidade.
- [ ] Manter valores padrao compativeis com materiais existentes.

### Task 3: Criar requisitos por equipe e funcao

**Files:**
- Modify: `supabase/migrations/<timestamp>_contract_catalog_metadata.sql`
- Create: `src/lib/contract-catalog.ts`

- [ ] Criar cenarios para C&M, Poda, Linha Viva Distribuicao, STC e Motociclista.
- [ ] Separar requisitos individuais de kits coletivos.
- [ ] Armazenar quantidade, unidade, tipo de uso, anexo e observacao de especificacao.
- [ ] Permitir que classificacoes de funcao herdem o mesmo kit contratual.

### Task 4: Importar o catalogo contratual

**Files:**
- Create: `supabase/migrations/<timestamp>_seed_contract_catalog.sql`
- Create: `docs/contract-catalog-source.csv`

- [ ] Importar os itens dos Anexos 04, 05, 06 e 07 com nomes normalizados e especificacoes preservadas.
- [ ] Usar chave de origem/anexo/item para tornar a carga idempotente.
- [ ] Criar todos os itens com estoque fisico zero, sem criar entradas ou movimentos.
- [ ] Evitar duplicidades entre anexos sem perder diferentes classes de tensao, tamanhos ou especificacoes.
- [ ] Conferir contagens esperadas por anexo antes de aplicar a migration.

### Task 5: Criar kits por equipe e funcao

**Files:**
- Modify: `src/app/function-templates/page.tsx`
- Create: `src/app/contract-requirements/page.tsx`
- Modify: `src/app/globals.css`

- [ ] Exibir kits contratuais por cenario e composicao de equipe.
- [ ] Mostrar quantidade exigida, estoque disponivel e deficit.
- [ ] Permitir filtrar itens individuais, coletivos e sujeitos a ensaio.
- [ ] Preservar as listas de funcao existentes e permitir associar uma funcao a um cenario.

### Task 6: Implementar conformidade de CA e ensaios

**Files:**
- Modify: `src/app/materials/page.tsx`
- Modify: `src/app/tests/page.tsx`
- Create: `src/app/compliance/page.tsx`
- Modify: `src/lib/transaction-attachments.ts`

- [ ] Exibir CA, validade, ensaio exigido e status tecnico no material.
- [ ] Permitir anexar laudo, certificado e ART.
- [ ] Criar filtros para pendente, vencido, proximo do vencimento, aprovado e reprovado.
- [ ] Bloquear entrega apenas quando o item exigir controle e estiver vencido/reprovado; itens ainda sem inventario continuam cadastraveis.

### Task 7: Validar e publicar

**Files:**
- Review: migrations criadas
- Review: `docs/contract-catalog-source.csv`

- [ ] Aplicar migrations no Supabase vinculado usando `supabase db query --linked --file`.
- [ ] Consultar contagens, chaves, requisitos e ausencia de movimentos de estoque.
- [ ] Executar `npm.cmd run build`.
- [ ] Executar `git diff --check`.
- [ ] Publicar commit e deploy somente depois de todos os checks passarem.
