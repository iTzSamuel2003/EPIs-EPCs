# Catalogo Contratual de Materiais e Conformidade

## Objetivo

Transformar os Anexos 04, 05, 06 e 07 do contrato em um catalogo oficial do sistema, com listas por equipe e funcao, sem inventar estoque fisico. Os itens serao cadastrados com estoque inicial zero e poderao receber dados reais posteriormente.

## Escopo

- Cadastrar EPI, EPC, ferramental, equipamento, acessorio e TI.
- Separar item individual de item coletivo.
- Criar kits contratuais para C&M, Poda, Linha Viva Distribuicao, STC e Motociclista.
- Manter quantidades minimas por tipo de equipe.
- Vincular requisitos de CA, validade, ensaio, calibracao, laudo e ART.
- Preparar o cadastro para lote, serie, fabricante, modelo, tamanho, fabricacao e validade.
- Exibir pendencias de conformidade sem bloquear o cadastro do inventario inicial.

## Fora do escopo inicial

- Inventar quantidade existente.
- Vincular materiais reais a colaboradores antes do levantamento fisico.
- Definir periodicidade diferente da prevista no contrato sem validacao tecnica.
- Substituir a validacao do SESMT, responsavel tecnico ou contratante.

## Modelo de dados

### Materiais

Ampliar o cadastro atual para suportar categoria contratual, uso individual/coletivo, especificacao, classe de tensao, exigencia de CA, exigencia de ensaio, periodicidade padrao e necessidade de laudo/ART.

### Unidades rastreaveis

Criar uma camada para unidades ou lotes fisicos com material, lote, serie, fabricante, modelo, tamanho, fabricacao, validade, CA e status operacional. Itens consumiveis podem continuar controlados por lote; equipamentos e isolantes devem permitir numero de serie.

### Kits contratuais

Manter listas separadas de funcao e equipe. Cada item da lista deve guardar quantidade, unidade, tipo de uso, anexo de origem e cenario contratual.

Cenarios:

- C&M leve e C&M pesada.
- Poda leve e Poda pesada.
- Linha Viva Distribuicao leve e pesada.
- STC Operacao e STC Perdas.
- Motociclista.

### Conformidade tecnica

Relacionar cada item controlavel a registros de ensaio, certificado ou laudo. O registro deve conter data, periodicidade, vencimento, resultado, responsavel, ART, arquivo e observacoes.

## Regras de negocio

- O catalogo contratual nasce com estoque zero e status ativo.
- Itens individuais podem ser entregues a colaboradores; itens coletivos devem ser atribuidos a equipe, veiculo ou ativo operacional.
- EPI sem CA valido fica pendente de conformidade.
- Isolantes, equipamentos e plataformas sem ensaio aprovado dentro da validade ficam pendentes ou bloqueados para uso.
- Quantidade contratual e estoque fisico sao indicadores diferentes.
- Variacoes de nomes, abreviacoes e classificacoes de funcao nao alteram o kit quando pertencem ao mesmo grupo contratual.
- O sistema deve preservar a origem do item para auditoria do contrato.

## Fluxo de implantacao

1. Criar a estrutura de catalogo e metadados contratuais.
2. Importar os itens dos quatro anexos, normalizando duplicidades sem perder especificacoes.
3. Criar os kits por equipe e funcao.
4. Associar regras de CA, ensaio, calibracao, laudo e ART.
5. Criar visao de conformidade e pendencias.
6. Validar contagens e amostras contra o PDF antes de liberar a importacao do inventario real.

## Validacao

- Migration aplicada e consultavel no Supabase.
- Quantidade de itens por anexo conferida.
- Nenhum item contratual cria saldo de estoque.
- Kits exibem quantidade contratual correta.
- Pendencias de CA e ensaio aparecem sem dados reais.
- Build do Next.js passa.
- Diff e arquivos de migration revisados antes do commit.
