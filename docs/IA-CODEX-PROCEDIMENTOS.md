# Procedimentos para Codex - EPIs-EPCs

Este documento adapta os procedimentos uteis do kit para o Codex neste repositorio.

## Antes de alterar

1. Confirmar o escopo e ler o `AGENTS.md`.
2. Verificar `git status --short --branch`.
3. Mapear arquivos e dependencias antes de mover, renomear ou excluir.
4. Nao abrir `.env.local` nem copiar segredos, tokens, chaves Supabase, CPFs ou dados reais.
5. Para alteracoes destrutivas, pedir plano, snapshot e aprovacao explicita.

## Supabase/PostgreSQL

- Preferir leitura e ambiente de teste.
- Nao executar alteracao remota sem aprovacao explicita.
- Tabelas expostas devem ter RLS e politicas coerentes com o modelo de acesso.
- Nao usar `service_role` ou chave secreta em cliente publico.
- Nao usar `user_metadata` para decisao de autorizacao.
- Para mudanca de schema, revisar migration, politicas, views, funcoes e grants.
- Depois de uma mudanca aprovada, executar verificacao apropriada e registrar a saida.

## Verificacoes do projeto

Executar conforme o escopo da alteracao:

```powershell
npm.cmd run check:encoding
npm.cmd run lint
npm.cmd run build
npm.cmd run check:production
```

Nao afirmar que um teste passou sem mostrar sua saida. Se nao foi executado, registrar `NAO VERIFICADO`.

## Git e entrega

- Antes do commit: `git status --short --branch`.
- Revisar nomes staged sem exibir valores sensiveis: `git diff --cached --name-only`.
- Nao adicionar `.env.local`, chaves, tokens ou dados pessoais.
- Registrar FATO, HIPOTESE e NAO VERIFICADO separadamente.
- Nunca fazer force push, reset destrutivo ou exclusao sem aprovacao especifica.

## Retomada

Ao iniciar ou encerrar uma sessao, registrar:

- objetivo e escopo;
- commit e status Git;
- o que foi feito e o que nao foi feito;
- testes executados e saidas;
- bloqueios, hipoteses e proximo passo.

## Limite do documento

Este procedimento vale para o Codex neste repositorio. Ele nao instala nem simula hooks, skills, agents ou rules do Claude Code.
