# Solicitacoes de troca pelo portal - Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir solicitacoes de troca por material individual com anexo no portal e acompanhar/atualizar esses pedidos em uma nova tela interna.

**Architecture:** O portal continua identificando o colaborador por matricula + CPF e consulta uma RPC publica versionada. Uma Edge Function recebe o formulario multipart, valida o item entregue, cria o pedido e grava o anexo em bucket privado. A area interna usa consultas autenticadas com RLS por organizacao e papel `admin` para alteracoes.

**Tech Stack:** Next.js App Router, React/TypeScript, Supabase Postgres/RLS/Storage/Edge Functions, Lucide, CSS existente.

---

### Task 1: Atualizar o modelo e as politicas do Supabase

**Files:**
- Create: `supabase/migrations/<timestamp>_employee_material_requests.sql`
- Create: `supabase/functions/submit-employee-portal-request/index.ts`
- Create: `supabase/functions/submit-employee-portal-request/deno.json`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Criar a migration e a Edge Function pelos comandos oficiais**

Run `supabase.cmd migration new employee_material_requests` e `supabase.cmd functions new submit-employee-portal-request`; use os arquivos gerados, sem inventar o timestamp.

- [ ] **Step 2: Adicionar colunas e indices**

Adicionar `delivery_item_id`, `requested_quantity`, snapshots de material/lote, caminho/data do anexo, `review_notes`, `updated_at` e indice unico parcial `WHERE status IN ('pending', 'in_review', 'approved')` por item.

- [ ] **Step 3: Criar validacao transacional e configurar bucket/RLS**

Criar uma funcao SQL interna no schema `private`, com `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, que bloqueie o `delivery_item` com `FOR UPDATE`, valide a cadeia item -> entrega -> funcionario -> organizacao, saldo e duplicidade, grave snapshots e retorne o id. Atualizar `register_return` para usar o mesmo lock antes de calcular devolucoes. Criar bucket privado `employee-request-attachments` com limite 10 MB e `allowed_mime_types` PDF/JPG/PNG/WEBP; remover a politica ampla atual e conceder SELECT por organizacao, INSERT somente pelo fluxo controlado e UPDATE/DELETE apenas para admin. Usar helper `private.is_current_organization_admin()` com `SECURITY DEFINER`, `search_path` fixo e sem consulta recursiva a policies para validar `profiles.role`.

- [ ] **Step 4: Implementar a Edge Function**

Receber multipart, aplicar CORS e validar matricula/CPF, `delivery_item_id`, descricao e arquivo (PDF/JPG/PNG/WEBP, 10 MB). Chamar a funcao SQL transacional para criar o pedido, usar caminho `organization_id/request_id/nome-seguro`, fazer upload definitivo com service key somente no servidor e atualizar o registro; se upload ou update falhar, tentar remover imediatamente e registrar o path em `employee_request_attachment_cleanup` para retry idempotente. Criar rotina de limpeza autenticada para processar essa tabela. Configurar `verify_jwt = false` em `supabase/config.toml` para o portal anonimo e aplicar limite basico por IP/identificador.

- [ ] **Step 5: Criar RPC publica de leitura versionada**

Adicionar `get_employee_portal_data_v3` preservando `courses` e `requirements`, com materiais por `delivery_item`, lote e quantidade, e pedidos sem `review_notes`, paths ou dados internos; usar somente `has_attachment`. Manter as RPCs antigas e configurar `revoke all`, `grant execute` e `search_path` seguro.

- [ ] **Step 6: Aplicar e reconciliar a migration**

Verificar o historico remoto antes de aplicar. Aplicar SQL uma vez com `supabase.cmd db query --linked --file <arquivo>` e registrar a versao com `supabase.cmd migration repair --linked --status applied <timestamp>`, ou usar `supabase.cmd db push` somente se a migration estiver reconciliada. Verificar tabelas, bucket, funcoes e policies com consultas SQL.

- [ ] **Step 7: Commit do schema**

Run `git add supabase/migrations supabase/functions && git commit -m "feat: estruturar solicitacoes de troca com anexos"`.

### Task 2: Atualizar dados e formulario do portal

**Files:**
- Modify: `src/app/portal/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Expandir os tipos do portal**

Representar materiais como itens individuais com `delivery_item_id`, lote e quantidade vinculada; incluir somente `has_attachment` e demais campos publicos nas solicitacoes retornadas. Auditar que as RPCs antigas continuam sem paths, `review_notes` ou outros dados internos.

- [ ] **Step 2: Migrar login/refresh para a RPC v3**

Trocar somente a leitura do portal para `get_employee_portal_data_v3`, mantendo mensagens de login invalidas indistinguiveis.

- [ ] **Step 3: Adicionar o seletor de material**

Quando o tipo for `replacement`, mostrar select obrigatorio com os materiais do colaborador e quantidade total vinculada. Limpar a selecao ao trocar o tipo.

- [ ] **Step 4: Adicionar upload de foto/PDF**

Adicionar input opcional aceitando PDF/JPG/PNG/WEBP, validar 10 MB no cliente e enviar o formulario para a Edge Function. Somente `replacement` com material usa a Edge Function; os demais tipos continuam na RPC antiga sem anexo. Sem upload direto ao Storage pelo browser.

- [ ] **Step 5: Atualizar envio e feedback**

Enviar uma unica solicitacao por material, tratar duplicidade/item devolvido/falha de upload e atualizar a lista local imediatamente sem reload. Exibir tipo, material e status no historico.

- [ ] **Step 6: Ajustar responsividade**

Manter o bloco de troca alinhado em desktop e meia tela, com campos empilhados em larguras menores.

- [ ] **Step 7: Commit do portal**

Run `git add src/app/portal/page.tsx src/app/globals.css && git commit -m "feat: permitir troca de material no portal"`.

### Task 3: Criar painel interno de solicitacoes

**Files:**
- Create: `src/app/requests/page.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Criar consulta autenticada**

Carregar solicitacoes da organizacao com funcionario, matricula, material, lote, descricao, anexo, status e observacao interna; a consulta respeita RLS e nao depende de service key.

- [ ] **Step 2: Montar tabela e filtros**

Exibir data, funcionario, matricula, material, tipo, descricao, anexo e status, com busca, tipo e status.

- [ ] **Step 3: Adicionar visualizacao segura**

Gerar URL assinada do bucket privado sob demanda, sem expor caminho ou service key no browser.

- [ ] **Step 4: Adicionar atualizacao administrativa**

Permitir status e observacao interna somente para admin por policy separada, com `USING`/`WITH CHECK` e sem depender de recursao em `profiles`; exigir confirmacao visual em aprovacao/recusa/conclusao e recarregar a lista apos salvar.

- [ ] **Step 5: Adicionar item no menu**

Incluir `Solicitacoes` em categoria coerente do menu lateral e garantir que a rota fique acessivel em todas as larguras.

- [ ] **Step 6: Commit do painel**

Run `git add src/app/requests/page.tsx src/components/app-shell.tsx src/app/globals.css && git commit -m "feat: adicionar painel de solicitacoes"`.

### Task 4: Validar ponta a ponta e publicar

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-employee-material-requests-design.md` only if implementation decisions diverge.

- [ ] **Step 1: Rodar verificacao de encoding e build**

Registrar o estado inicial de `next-env.d.ts`, executar `npm.cmd run build` e restaurar apenas a alteracao gerada pelo build, sem apagar mudancas preexistentes.

- [ ] **Step 2: Verificar Supabase**

Confirmar bucket privado, limite/MIME types, policies exatas, RPC v3, Edge Function, indice unico e lock compartilhado com `register_return`. Testar acesso entre organizacoes e bloqueio de usuario nao-admin.

- [ ] **Step 3: Testar fluxo do portal**

Testar troca sem material, troca com material, anexo valido, arquivo maior que 10 MB, item ja devolvido e pedido duplicado.

- [ ] **Step 4: Testar fluxo interno**

Testar filtros, URL assinada, alteracao de status, observacao interna, reflexo do status no portal e recuperacao de falha de upload.

- [ ] **Step 5: Publicar web e Edge Function**

Configurar secrets da Edge Function sem commit, executar `supabase.cmd functions deploy submit-employee-portal-request`, verificar a configuracao `verify_jwt = false`, rodar `git status`, `git push origin main` e confirmar o deploy automatico da Vercel.
