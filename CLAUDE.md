@AGENTS.md

# Padrão obrigatório de codificação

- Salvar todos os arquivos de código e documentação em UTF-8, sem conversão para ANSI/Windows-1252.
- Preservar acentos e símbolos diretamente nos textos em português.
- Antes de publicar alterações, executar `npm run check:encoding` e corrigir todas as ocorrências apontadas.
- Não usar comandos que regravem arquivos com a codificação padrão do terminal. Para edições, usar o patch do agente ou um editor configurado para UTF-8.
