# Histórico de materiais do funcionário

## Objetivo

Disponibilizar um acesso direto, a partir da ficha do funcionário, para consultar todas as movimentações de EPI, EPC e Ferramental vinculadas a ele.

## Experiência

- Adicionar o botão `Histórico de materiais` na navegação/ações da ficha do funcionário.
- Criar a rota `/employees/[id]/history`.
- Exibir nome, matrícula e função no cabeçalho.
- Exibir resumo de materiais atuais, total entregue, devoluções e ocorrências.
- Listar as movimentações em tabela, com data, material, quantidade, lote, tipo, motivo e responsável.
- Permitir filtros por período, tipo de movimentação e material.
- Disponibilizar impressão do histórico do funcionário.

## Dados

O histórico será derivado dos registros existentes de `deliveries`, `delivery_items`, `returns`, `return_items` e `return_accountability`. Não será criada uma cópia manual dos eventos. Entregas e devoluções serão combinadas em uma consulta ordenada por data; ocorrências de responsabilização serão exibidas associadas à devolução correspondente.

## Segurança e estados

- Consultar apenas registros da organização ativa e do funcionário selecionado.
- Exibir estado vazio quando não houver movimentações.
- Exibir erro compreensível quando o funcionário não existir ou a consulta falhar.
- Manter a impressão sem ações, filtros temporários ou elementos de navegação.

## Validação

- Verificar navegação do botão para a rota correta.
- Verificar carregamento com entregas, devoluções e ocorrência de mau uso/extravio.
- Verificar filtros e estado vazio.
- Executar encoding check, lint e build.
