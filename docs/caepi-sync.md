# Sincronização da consulta de CA

A consulta de CA usa a base oficial do CAEPI disponibilizada pelo Ministério do Trabalho e Emprego. O workflow `Sincronizar base CAEPI` baixa o arquivo oficial pelo FTP e atualiza a tabela `ca_certificates` no Supabase uma vez por semana ou quando executado manualmente.

Configure no GitHub as secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. A chave de serviço é usada somente pelo workflow de importação e nunca deve ser colocada no código do navegador ou em variáveis `NEXT_PUBLIC_*`.

Para testar a leitura localmente sem gravar dados:

```bash
node scripts/import-caepi.mjs caminho/para/tgg_export_caepi.txt --dry-run
```

O arquivo da fonte oficial utiliza `|` como separador. O importador também aceita CSV separado por `;` ou `,`, datas brasileiras e datas ISO.
