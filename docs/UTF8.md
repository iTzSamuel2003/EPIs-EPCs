# Padrão de codificação do projeto

Todos os arquivos do sistema devem ser salvos em UTF-8, sem BOM e sem conversão para ANSI, Windows-1252 ou outra codificação local.

## Antes de publicar

Execute:

```bash
npm run check:encoding
npm run build
```

O build também executa essa verificação automaticamente por meio do script `prebuild`.

## Regras para alterações

- Preserve acentos, símbolos e emojis diretamente no código-fonte.
- Use um editor configurado explicitamente como UTF-8.
- Não use `Get-Content`/`Set-Content` do PowerShell sem informar a codificação ao regravar arquivos.
- Para automações, leia e grave arquivos com `utf8` explicitamente.
- Não copie texto renderizado pelo terminal para dentro do código; o terminal pode exibir UTF-8 incorretamente.
- Se aparecer `Ã`, `Â`, `â€`, `ðŸ` ou `�` em textos que deveriam estar em português, interrompa a publicação e corrija o arquivo original.

## Recuperação

Quando uma alteração já foi publicada com texto quebrado, corrija os arquivos localmente, rode os dois comandos acima e publique um novo commit. Não faça conversões repetidas no mesmo arquivo, pois isso pode danificar acentos que já estão corretos.
