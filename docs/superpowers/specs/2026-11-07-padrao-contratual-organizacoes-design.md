# Padrão contratual por organização

**Status:** Aprovado pelo usuário em 2026-11-07
**Projeto:** EPIS+
**Escopo:** catálogo e regras contratuais compartilhadas, com cópias independentes por organização.

## Objetivo

Garantir que organizações novas recebam uma base contratual completa desde a criação do rascunho e permitir que o administrador da plataforma aplique manualmente versões futuras às organizações existentes, sem copiar dados operacionais nem depender da DSX como modelo vivo.

## Decisões confirmadas

- Incluir todos os anexos hoje catalogados, inclusive STC e Motociclista; cada organização decide quais anexos ficam ativos.
- Cada organização cadastra suas próprias bases, podendo ter uma ou várias, inclusive em cidades diferentes. Bases da DSX não são copiadas.
- Novas versões do padrão são aplicadas às organizações existentes somente por ação explícita do administrador da plataforma.
- Rascunhos novos recebem automaticamente a versão vigente do padrão.
- Cada organização mantém uma cópia independente e pode personalizar sua configuração sem alterar o padrão nem outras organizações.

## Base inicial

Snapshot somente de leitura da DSX em produção, verificado em 2026-11-07:

- 243 materiais contratuais canônicos e 370 vínculos material/anexo.
- 9 cenários contratuais, com 864 requisitos no total: 6 cenários e 664 requisitos ativos hoje; 3 cenários e 200 requisitos de Anexos 06/07 inativos hoje.
- 5 listas por função com 106 itens.
- 11 requisitos de cursos do Anexo 03.
- Nenhuma variação de tamanho cadastrada na tabela de variantes.

O snapshot incluirá as definições completas, independentemente do estado atual de ativação. A ativação inicial seguirá a DSX: Anexos 03, 04 e 05 ativos; Anexos 06 e 07 inativos. A organização pode alterar essa seleção depois.

## Arquitetura e comportamento

1. Manter versões imutáveis do padrão em armazenamento interno do banco, separado da organização DSX e não acessível diretamente pelo Data API. A migration da versão contém um snapshot congelado dos dados capturados da DSX em 2026-11-07; não consulta a DSX durante o deploy. Novas versões são adicionadas por migrations e a versão corrente é selecionada por migration; não haverá editor de padrão no painel nesta etapa.
2. Copiar a versão atual para a organização na mesma transação que cria o rascunho. Uma falha cancela toda a criação para não deixar organização parcialmente configurada.
3. Registrar a versão aplicada por organização. A ação do administrador para organizações existentes será explícita, auditável e idempotente; cada organização é processada em sua própria transação.
4. Registrar ownership por organização/tipo/chave de origem/ID de destino e snapshot anterior dos campos gerenciados. Somente IDs vinculados à versão anterior podem ser atualizados automaticamente. Na primeira aplicação, se uma chave padrão colidir com registro não vinculado já existente, abortar toda a aplicação e informar o conflito; não adotar nem sobrescrever esse registro. Usar chaves estáveis e qualificadas: código contratual do material; código de cenário; cenário + código do material + escopo do requisito; chave imutável da lista por função; lista + código do material (ou nome normalizado + tipo quando não houver código); alias normalizado (lowercase, acentos removidos e pontuação reduzida a espaço); grupo + nome normalizado do curso; código do item/anexo. Renomear uma chave cria item novo; o anterior não é removido e fica para revisão manual. Ao reapply, comparar cada campo gerenciado com o snapshot anterior: atualizar apenas campos ainda iguais ao padrão anterior, preservar campos personalizados e reportar overrides/conflitos; inserir itens novos e nunca apagar registros ausentes da nova versão. Registros obsoletos são marcados para revisão manual. Preservar CA real, fabricante/modelo, estoque mínimo, localização, notas/foto, ativações de anexos e todos os dados operacionais; não alterar estoque/lotes/unidades, pessoas, entregas, movimentações, fornecedores, equipes operacionais/membros, documentos, identidade visual ou bases.
5. Propagar as ativações de anexo para os consumidores de cenários, materiais, requisitos, equipes e cursos. Cenários inativos no snapshot permanecem disponíveis; o estado efetivo vem da configuração da organização.
6. Restringir funções de cópia/aplicação ao administrador da plataforma, com `SECURITY DEFINER` somente onde necessário, `search_path` fixo, execução revogada de `PUBLIC`/`anon` e validação interna da autorização. Uma falha reverte toda a cópia da organização atual; uma aplicação em lote, se criada no futuro, deve reportar resultados por organização.

## Interface

- Na gestão da plataforma, mostrar a versão padrão instalada e permitir aplicá-la a organizações existentes por ação explícita com confirmação. Após aplicar, informar itens adicionados/atualizados, campos locais preservados e registros retirados do padrão que ficaram para revisão.
- Ao criar rascunho, informar que o catálogo e as regras contratuais serão preparados automaticamente.
- Em Materiais, permitir ativar/desativar Anexo 03 (cursos) e Anexos 04–07 (materiais/equipes), mantendo o comportamento atual de bloqueio de entradas de anexos desativados.
- Mostrar feedback e permitir recarregar após a aplicação; erro não pode apresentar sucesso nem esconder falha parcial.

## Segurança e falhas

- Nenhum usuário comum ou administrador de organização pode ler o snapshot privado nem aplicar uma versão global a outra organização.
- RPCs verificam `auth.uid()` e autorização de administrador da plataforma no servidor, não confiando em dados de perfil fornecidos pelo cliente.
- Clonagem e aplicação são atômicas e transacionais; chaves contratuais estáveis evitam duplicidade.
- Desativar um anexo não exclui definições, cursos registrados ou histórico; apenas impede seu uso nos fluxos que devem respeitar a seleção.
- Bases e dados físicos do inventário são sempre cadastrados por organização.

## Verificação de aceite

- Criar rascunho resulta em cópia completa do padrão: 243 materiais, 370 vínculos material/anexo, 9 cenários, 864 requisitos, 5 listas por função/106 itens, 10 aliases e 11 requisitos de cursos; todos os dados permanecem associados à nova organização.
- A versão 1 mantém esses mesmos números em ambientes diferentes, pois o conteúdo está congelado na migration e não é consultado da DSX no deploy.
- Uma impressão digital SHA-256 do snapshot e registros canônicos de referência detectam conteúdo incorreto com contagens aparentemente corretas.
- Aplicar novamente a mesma versão não duplica itens nem elimina personalizações locais.
- Aplicação manual a organização existente registra versão e ator, aplica mudanças somente a campos contratuais sem override local, preserva ativações/campos operacionais/itens locais e não copia dados operacionais da DSX.
- Desativar/reativar cada anexo atualiza consistentemente Materiais, Entradas, Requisitos contratuais, Listas por função, Equipes, Conformidade, Matriz de cursos, ficha de cursos e portal do colaborador; dados históricos permanecem intactos.
- Reaplicar uma versão atualiza a instalação apenas para uma organização por transação; falha reverte toda a cópia dessa organização.
- Usuário sem privilégio de plataforma não consegue acionar RPCs de cópia/aplicação nem acessar tabelas privadas.
- As organizações mantêm seus próprios cadastros de bases.

## Definições obrigatórias de implementação

- “Instalar no rascunho” significa copiar a versão imutável vigente para as tabelas contratuais da nova organização na mesma transação de `create_organization_draft`; não cria um editor do padrão nem uma referência mutável à DSX.
- A instalação inclui somente catálogo e definições contratuais: materiais e seus vínculos a anexos, cenários/requisitos, listas e aliases de função, requisitos de cursos e configurações de anexos. Não inclui estoque, lotes, movimentos, unidades físicas, variantes de tamanho, bases, pessoas ou dados operacionais.
- A aplicação manual atende uma organização por chamada/transação. Não haverá operação em lote nesta etapa. Se futuramente a interface disparar várias chamadas, cada organização terá resultado independente e explícito; uma falha nunca será apresentada como sucesso global.
- A organização só altera as próprias ativações: leitura restrita à organização autenticada; escrita limitada aos papéis `admin` e `tst` conforme a política RLS existente. A aplicação do padrão a qualquer organização é exclusiva do administrador da plataforma e a RPC valida `auth.uid()`/papel no servidor, sem aceitar organização do cliente como prova de acesso.
- Anexos 03–07 sempre têm configuração explícita. Primeira instalação usa 03/04/05 ativos e 06/07 inativos; ao aplicar em organização existente, preencher somente configurações ausentes com esses valores e nunca sobrescrever escolhas já salvas.
- Anexo inativo não apaga nem oculta o histórico: deixa de oferecer os materiais/requisitos/cenários/cursos em seletores de novas operações, impede novas entradas ou correções positivas de estoque, novas entregas/atribuições de materiais e novas submissões de cursos daquele anexo; permanece visível como inativo na configuração. Devoluções, correções que diminuem saldo, equipes existentes, cursos realizados, materiais já atribuídos e registros históricos continuam consultáveis. Reativar restaura as opções sem recriar nem duplicar registros.
- Para material associado a vários anexos, fica disponível se ao menos um vínculo contratual estiver ativo; somente material com todos os anexos vinculados inativos fica bloqueado. Material sem vínculo contratual continua disponível conforme o comportamento atual. A mesma regra é validada no cliente e nas RPCs/triggers que criam entradas ou entregas para evitar bypass.
- A disponibilidade efetiva é determinada por `organization_annex_settings`, não pelo `contract_scenarios.active` legado. Cenários sem anexo identificado mantêm o comportamento atual. Se a tela permitir ativação específica de cenário no futuro, ela será uma regra adicional separada, não um substituto da ativação do anexo.
- Chaves de origem são persistidas no payload versionado e não derivadas de nomes mutáveis durante a aplicação. O normalizador de fallback é: Unicode NFKD, remover marcas diacríticas, converter para minúsculas, substituir cada sequência de pontuação/espaço por um espaço e aparar espaços. Chaves: material=`contract_item_code` normalizado; cenário=`code` normalizado; requisito=`scenario_key|material_key|usage_scope_normalizado`; lista=`source_key` imutável; item de lista=`material_key`, ou `nome_normalizado|item_type` quando não tiver código; alias=`alias_normalizado`; curso=`function_group_normalizado|course_name_normalizado`; vínculo material/anexo=`contract_item_code` (chave primária).
- O ownership guarda a organização, tipo, chave de origem, ID local, última versão e JSON dos campos gerenciados na versão anterior. Campos gerenciados: materiais (`internal_code`, `name`, `description`, `type`, `unit`, `replacement_interval_days`, `useful_life_months`, `contract_item_code`, `contract_item_number`, `contract_category`, `usage_scope`, `contract_source`, `contract_specification`, `voltage_class`, `ca_required`, `test_required`, `test_type`, `test_interval_months`, `report_required`, `art_required`, `size`); vínculos de anexo (material local, anexo, código contratual e fonte); cenários (código, nome, anexo, tamanho, composição e estado legado); requisitos (cenário/material locais, anexo, item, quantidade, unidade, escopo e observações); listas (nome, documento de origem, cenário local, grupo e herança de classificação); itens (material local/nome, quantidade e tipo); aliases (texto/chave normalizada/função canônica/cenário local); cursos (grupo, nome, anexo, obrigatoriedade, validade e observações). Campos não listados são operacionais/locais e nunca são sobrescritos; CA real, fabricante/modelo, categoria operacional, estoque mínimo, status, local, notas, foto e lotes ficam locais.
- Na atualização, um campo só acompanha a nova versão se seu valor local for igual ao campo correspondente da última versão instalada (`IS NOT DISTINCT FROM`). Se divergir, preservar como override e manter no ownership o último valor padrão conhecido para permitir decisões reproduzíveis em futuras aplicações. Relações UUID são remapeadas por chaves de origem. Itens ausentes numa nova versão recebem marca de revisão manual e nunca são apagados.
- Cada aplicação bloqueia a linha da organização (`FOR UPDATE`) para serializar reexecuções. Aplicar a versão já instalada é um no-op idempotente, sem novo evento de aplicação duplicado. Aplicações efetivas gravam ator, organização, versão/hash e resumo de inserções, atualizações, overrides e registros para revisão. Uma colisão com qualquer registro sem ownership aborta a transação integral daquela organização.
- O hash cobre UTF-8 da representação textual de um único `jsonb` canônico: array ordenado por `entity_type, source_key`, objetos `jsonb` com as chaves do payload, arrays internos ordenados pela chave estável e sem campos operacionais nem UUIDs locais da origem. A migration fixa o SHA-256 esperado e inclui linhas de referência; teste recalcula-o no banco antes de permitir provisionamento. UUIDs originais do catálogo DSX são mantidos separadamente como metadados privados para registrar a instalação v1 da própria DSX sem consultar suas tabelas no deploy; esses IDs nunca são usados nas cópias de outras organizações.
- A versão inicial reconhece DSX como já instalada v1 usando somente os UUIDs de origem congelados e associações estáticas do payload; outras organizações existentes recebem o padrão apenas por ação manual. Isso evita colisão ao tentar “copiar” o catálogo para a organização que o forneceu e mantém sua trilha de ownership para futuras versões.
- Para cumprir a restrição `materials.ca_number` de EPIs, a cópia inicial define `PENDENTE` quando `type='EPI'` ou `ca_required=true`, e `NULL` nos demais casos, pois o snapshot contratual não fornece um CA verificável. `ca_number` nunca é campo gerenciado: valores reais informados pela organização são preservados em atualizações.
- A chave de um vínculo em `material_contract_annexes` é apenas `contract_item_code` (chave primária da tabela); `source_item_number` pertence a `contract_requirements`, não ao vínculo material/anexo. Cada item de lista recebe uma chave estável gerada no snapshot e reutilizada em versões posteriores, usando material+tipo se não houver repetição.
- Para impedir perda de edições concorrentes, bloquear a organização e cada linha local gerenciada com `FOR UPDATE` antes de ler e comparar. As atualizações de campo também incluem condição com valor anterior (`IS NOT DISTINCT FROM`) e, se a linha tiver mudado, tratá-la como override. A transação nunca grava sobre uma edição concorrente não observada.
- Colisão/erro é sinalizado com exceção PostgreSQL (`P0001` e mensagem legível), não com retorno de status normal; assim a chamada e toda a organização atual sofrem rollback. A UI apresenta erro sem afirmar sucesso. A RPC opera em qualquer organização existente, sem alterar seu estado de ciclo de vida; não há lote nesta versão.
- A RPC de status da plataforma será nova e separada, sem alterar o `RETURNS TABLE` fixo de `list_platform_organizations()`. A tela chama essa RPC e a aplicação manual dedicada.
- Toda organização recebe linhas de configuração 03–07 na criação e as organizações já existentes recebem somente linhas ausentes na migration; defaults ausentes nunca significam “anexo ativo”. A trigger da organização usa `ON CONFLICT DO NOTHING`, portanto não sobrescreve escolhas já salvas.
- Estruturas privadas da v1: `private.contract_template_versions` (número, hash, payload canônico, organização-fonte e versão vigente), `private.contract_template_records` (payload por tipo/chave), `private.contract_template_source_rows` (UUIDs de origem DSX fora do hash), `private.organization_contract_template_installs` (versão instalada por organização), `private.organization_contract_template_ownership` (ID local e snapshot de campos gerenciados por chave) e `private.organization_contract_template_events` (aplicações efetivas e resumo). Tabelas privadas não recebem grants de leitura; RPCs autorizadas são a única superfície de acesso.
- O arquivo versionado de referência é `supabase/contract-template-v1.json`; a migration incorpora seus `canonical_records` sem UUIDs de origem e mantém `source_rows` separados. O payload canônico tem 1.618 registros e SHA-256 `083a88f58186b7836fcc1195552095a3df7f950b248b5ff946a7978c76691b69`. O teste recalcula o hash, verifica o valor literal e inclui registros canônicos de referência.
- Snapshot, ownership, instalação e auditoria ficam no schema `private`, fora dos schemas expostos pelo Data API. Preservar o `USAGE` que aplicações e políticas existentes precisem no schema `private`, mas revogar explicitamente privilégios nas novas tabelas de `PUBLIC`, `anon` e `authenticated`; habilitar RLS como defesa adicional quando compatível. Revogar execução das funções internas para esses papéis. RPCs públicas usam `search_path` fixo, são concedidas somente a `authenticated` e validam autorização no servidor.
- API definida para a primeira versão: `public.list_platform_contract_template_status()` (consulta administrativa de status, somente platform admin) e `public.apply_contract_template_version(p_organization_id uuid)` (aplica apenas a versão corrente a uma organização). O wrapper de aplicação lança `P0001` em falha; a instalação interna usada por `create_organization_draft(text,text)` não é uma API pública.
