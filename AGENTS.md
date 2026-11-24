<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Escopo e seguranca do projeto

- Este repositorio e o unico escopo desta configuracao.
- Mapear antes de mexer; nenhuma movimentacao, renomeacao ou exclusao sem plano aprovado.
- Nunca gravar segredos, chaves Supabase, tokens, credenciais, CPFs ou dados reais de colaboradores em codigo, docs, logs ou commits.
- `.env.local` e somente local; nunca abrir ou copiar seu conteudo para o repositorio, relatorio ou conversa.
- Usar apenas nomes de variaveis de ambiente, nunca os valores.

## Supabase e PostgreSQL

- Tratar tabelas expostas como protegidas por RLS, com politicas especificas ao modelo de acesso.
- Nunca expor `service_role` ou chave secreta em cliente publico.
- Nao usar `user_metadata` para autorizacao.
- Nao alterar schema remoto sem aprovacao explicita, plano, migracao e verificacao.
- Preferir ambiente de teste e consultas de leitura quando a tarefa nao exigir escrita.

## Codex e verificacao

- O Codex usa este `AGENTS.md`; `CLAUDE.md`, hooks e skills do Claude nao sao considerados carregados automaticamente.
- Antes de alterar codigo, ler os guias relevantes do Next.js em `node_modules/next/dist/docs/`.
- Antes de publicar alteracoes, executar `npm run check:encoding`.
- Quando aplicavel, executar `npm run lint`, `npm run build` e `npm run check:production`, registrando a saida.
- Separar FATO, HIPOTESE e NAO VERIFICADO.
