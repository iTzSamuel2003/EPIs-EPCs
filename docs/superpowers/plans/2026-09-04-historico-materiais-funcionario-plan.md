# Histórico de materiais do funcionário Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma página dedicada para consultar o histórico completo de materiais de um funcionário.

**Architecture:** A nova página client-side carregará funcionário, entregas, itens de entrega, devoluções e responsabilizações pelas tabelas existentes do Supabase. Os eventos serão normalizados em memória, ordenados por data e filtrados na interface; nenhuma tabela histórica duplicada será criada.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase JS, CSS existente e `lucide-react`.

---

### Task 1: Expandir navegação do funcionário

**Files:**
- Modify: `src/components/employee-navigation.tsx`

- [x] Adicionar a seção `history` ao tipo de navegação.
- [x] Adicionar o link `Histórico` apontando para `/employees/[id]/history`.
- [x] Confirmar que o estado ativo funciona sem alterar os links existentes.

### Task 2: Criar página de histórico

**Files:**
- Create: `src/app/employees/[id]/history/page.tsx`

- [x] Carregar os dados do funcionário e retornar uma mensagem de erro quando ele não existir.
- [x] Buscar entregas com seus itens, materiais e lotes; buscar devoluções com itens e responsabilização.
- [x] Normalizar eventos de entrega e devolução em um único modelo para a tabela e os cards.
- [x] Exibir cabeçalho do funcionário, resumo, filtros por período/tipo/material e estado vazio.
- [x] Exibir motivo, estado/destino da devolução, ocorrência, assinatura e desconto quando existirem.
- [x] Adicionar impressão usando `window.print()` e classes `no-print`.

### Task 3: Integrar e validar

**Files:**
- Modify: `src/app/employees/[id]/page.tsx`

- [x] Adicionar ação visível para abrir o histórico a partir da ficha.
- [x] Executar `npm.cmd run check:encoding`.
- [x] Executar `npm.cmd run lint` e corrigir apenas erros relacionados à implementação.
- [x] Executar `npm.cmd run build` e confirmar a rota dinâmica `/employees/[id]/history`.
