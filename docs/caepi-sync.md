# Sincronização da consulta de CA

A consulta de CA usa a base oficial do CAEPI disponibilizada pelo Ministério do Trabalho e Emprego. O workflow `Sincronizar base CAEPI` baixa o arquivo oficial pelo FTP e atualiza a tabela `ca_certificates` no Supabase uma vez por semana ou quando executado manualmente.

O workflow usa um token OIDC de curta duração do GitHub Actions, validado pela função `caepi-import` no Supabase. Assim, nenhuma chave de serviço precisa ser cadastrada no GitHub ou colocada no código do navegador.

Para testar a leitura localmente sem gravar dados:

```bash
node scripts/import-caepi.mjs caminho/para/tgg_export_caepi.txt --dry-run
```

O arquivo da fonte oficial utiliza `|` como separador. O importador também aceita CSV separado por `;` ou `,`, datas brasileiras e datas ISO.
