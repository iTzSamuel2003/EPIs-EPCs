# Gestão da plataforma e preparação de organizações

## Objetivo

Permitir que um administrador da plataforma crie e prepare organizações sem exigir, no momento da criação, o e-mail ou todos os dados do futuro administrador da empresa. O administrador da plataforma poderá preencher dados conhecidos, configurar os módulos da organização e, quando estiver pronto, convidar o administrador da empresa. A conta da plataforma permanece distinta das contas de cada organização.

## Contexto atual

- A plataforma já possui o papel global `platform_admin`, separado dos papéis `admin`, `rh`, `tst` e `user` das organizações.
- A página `/settings/organizations` lista organizações e membros, mas sua criação exige nome, e-mail do primeiro administrador e cria o convite na mesma operação.
- O fluxo de convite já atribui ao convidado o papel e as permissões definidos no convite após ele confirmar o endereço e aceitar.
- Cada perfil comum tem um único `organization_id`. As páginas e as políticas RLS atuais dependem desse vínculo para resolver o escopo dos dados.
- A tabela `organizations` já contém dados opcionais e parâmetros básicos, mas não possui um ciclo de preparação/ativação da organização.

## Experiência proposta

### Criar e preparar

1. Em **Configurações → Organizações**, o administrador da plataforma cria uma organização em estado de preparação sem precisar informar e-mail de administrador.
2. Um identificador legível é obrigatório para distinguir organizações; pode ser provisório, por exemplo, “Organização em preparação 01”. CNPJ, endereço, telefone, logo e demais informações podem ficar em branco até serem conhecidos.
3. A organização pode ser editada e configurada gradualmente. Campos desconhecidos permanecem vazios; o sistema não inventa dados legais, pessoas, estoque ou informações operacionais.
4. A lista mostra o estado e as pendências de preparação, além de ações para editar, abrir a gestão, convidar administrador e encerrar a preparação.

### Abrir a gestão de uma organização

- O administrador da plataforma seleciona **Abrir gestão** e informa o motivo do acesso, por exemplo, preparação inicial ou suporte solicitado.
- Uma RPC de início valida a identidade autenticada e o papel `platform_admin`, lê o `session_id` do JWT verificado pelo Supabase e grava uma sessão de gestão privada com o usuário, sessão, organização, motivo e expiração fixa de 60 minutos. Cada sessão autenticada pode ter somente um escopo ativo; para trocar de organização, encerra o atual e inicia outro.
- O escopo usado pelas consultas não vem de um `organization_id` livre enviado pelo navegador. Um helper privado resolve a organização ativa a partir da sessão de gestão no banco e valida que o papel global continua ativo e que o `session_id` ainda corresponde a uma sessão existente em `auth.sessions`.
- As políticas RLS comparam a organização de cada linha ao escopo resolvido no banco. Sem sessão de gestão ativa, o usuário conserva apenas o escopo do próprio perfil; com sessão ativa, as políticas permitem somente a organização registrada naquela sessão.
- A aplicação obtém o escopo atual por uma RPC confiável e o compartilha em um provider. Um aviso persistente identifica o modo de gestão da plataforma, a organização e o usuário da plataforma; a ação **Sair da gestão** encerra o contexto.
- A conta não é adicionada a `profiles` como membro, não muda seu `organization_id` e não assume o papel de administrador da empresa. O ator de cada operação continua sendo o administrador da plataforma.
- O modo é temporário e vinculado à sessão autenticada. Expiração em 60 minutos, logout, encerramento manual ou revogação do papel global invalida o contexto. Após expiração ou logout, novas consultas e gravações de gestão são negadas pelo banco, mesmo que a interface ainda exiba dados em cache.
- A abertura de outro escopo na mesma sessão Auth encerra o escopo anterior atomicamente. Outras abas são notificadas para recarregar o contexto e não podem continuar mostrando dados com o rótulo antigo.
- Com esse escopo, o administrador da plataforma recebe as permissões de dados disponíveis ao papel `admin` da empresa, exclusivamente na organização selecionada e sem adquirir permissões de plataforma diferentes das já existentes.
- O escopo abrange todas as páginas de organização listadas em `PAGE_PERMISSIONS`, incluindo cadastros, operações, estoque, conformidade, RH, funcionários e subpáginas. Também pode administrar convites e permissões de usuários dessa organização, mas não pode ler senhas, tokens de autenticação ou segredos, editar a lista global de `platform_admins`, nem acessar dados de outra organização.
- Leituras de telas com dados pessoais de RH e cada gravação no modo de gestão geram eventos de auditoria com ator, organização, sessão e ação; a trilha não copia conteúdo pessoal ou segredos desnecessários.

### Convidar o administrador da empresa

1. O administrador da plataforma informa o e-mail quando estiver disponível e gera o convite separadamente da criação da organização.
2. O convite mantém o papel `admin` e as permissões completas restritas à própria organização.
3. Convites pendentes podem ser revogados e reemitidos; reemitir revoga o link anterior e cria um novo link com validade de 7 dias. Expiração mantém o estado `awaiting_admin` com indicação “convite expirado” para permitir reemissão; revogar o último convite do primeiro administrador retorna a organização a `draft`. Só pode haver um convite ativo para o primeiro administrador por organização. O banco armazena somente o hash do token: o link em texto puro é devolvido apenas ao ser criado ou reemitido. Se o administrador perder o link, deve reemitir o convite, invalidando o anterior e recebendo um novo; o token antigo não pode ser recuperado. Envio automático só será incluído se houver um serviço de e-mail configurado.
4. Toda aceitação valida atomicamente que o convite tem token correspondente, `accepted_at` nulo, `revoked_at` nulo e `expires_at` posterior ao horário atual, além de exigir autenticação com o e-mail verificado do convite. Um convite novo do tipo `first_admin` só pode ser aceito quando a organização estiver em `awaiting_admin`; um convite existente do tipo `member` continua válido para uma organização `active`, preservando o fluxo anterior. Convites de qualquer tipo são recusados enquanto a organização estiver suspensa.
5. Para `first_admin`, usuário sem organização é vinculado como `admin`; membro já vinculado à mesma organização é promovido a `admin` somente porque aceitou um convite explícito de primeiro administrador, com auditoria; admin já vinculado tem aceite idempotente. Para `member`, usuário sem organização é associado à organização ativa com o papel do convite; usuário já vinculado à mesma organização tem aceite idempotente sem alteração de papel; usuário vinculado a outra organização é recusado sem consumir o convite, mover ou alterar seu perfil. Migração entre empresas exige um fluxo separado.
6. Aceitar `first_admin` muda `awaiting_admin` para `active` e registra o evento. Convites legados anteriores à migração são classificados como `member`; organizações legadas permanecem `active`, então a aceitação deles continua permitida sem nova emissão e sem alterar o ciclo de vida.
7. O acesso de plataforma continua separado e auditado depois da ativação.

## Estados da organização

- Um único campo `lifecycle_status` representa o estado: `draft`, `awaiting_admin`, `active` ou `suspended`. Não há um segundo campo de estado de onboarding.
- `draft`: organização em preparação, ainda sem convite ativo para o primeiro administrador. Apenas administradores da plataforma podem abrir sua gestão.
- `awaiting_admin`: convite `first_admin` emitido, aguardando aceitação. Expiração mantém esse estado com indicação “convite expirado”; a plataforma pode reemitir. Revogar o último convite `first_admin` pendente retorna a organização a `draft`.
- `active`: primeiro convite aceito; usuários autorizados da empresa acessam a organização.
- `suspended`: overlay de bloqueio representado pelo próprio `lifecycle_status`. Ao suspender, o evento append-only guarda o estado anterior (`draft`, `awaiting_admin` ou `active`) e o motivo. Reativar restaura exatamente aquele estado. Convites não podem ser aceitos durante a suspensão; após reativar, um convite expirado pode ser reemitido.

Estados existentes devem ser migrados para `active` para não alterar o acesso atual; convites existentes recebem `invite_kind = 'member'` e continuam aceitos nesse estado. Organizações criadas pelo fluxo novo começam em `draft`. “Concluir preparação” significa emitir convite `first_admin`; a organização só se torna ativa após a aceitação.

Transições permitidas: criar `draft`; emitir convite `first_admin` muda `draft` para `awaiting_admin`; expiração mantém `awaiting_admin`; revogar o único convite pendente retorna a `draft`; aceitar convite `first_admin` muda `awaiting_admin` para `active`; convite `member` aceito em `active` não altera o estado. A plataforma pode suspender qualquer estado, mas durante `suspended` não emite/revoga convites nem aceita convites. Reativar restaura o estado salvo no evento de suspensão. Cada transição exige motivo quando for ação manual e registra ator, estado anterior e novo estado.

Um `draft` só pode ser excluído pelo administrador da plataforma, após confirmação explícita, se não tiver perfis vinculados, convites (inclusive revogados), registros em qualquer tabela de dados da organização, arquivos no Storage sob seu prefixo ou sessão de gestão aberta. A RPC de exclusão valida todas essas condições no banco e cobre todas as tabelas e buckets inventariados. A exclusão gera evento de auditoria com snapshot mínimo do nome/ID e não apaga a trilha global; depois de qualquer convite ou dado relacionado, a organização permanece como rascunho ou é suspensa, sem exclusão em cascata.

## Matriz de autorização

| Ator e estado | Dados da organização | Alterar ciclo de vida/convites |
|---|---|---|
| Administrador da plataforma, sem modo de gestão | Lista de organizações, nome, CNPJ, criação, contagem e lista administrativa de membros (nome, e-mail e papel); sem consultas aos módulos da empresa | Criar rascunho e editar dados básicos; convidar/revogar/reemitir primeiro admin em `draft`/`awaiting_admin`; suspender/reativar. Gestão de convites de membros exige organização `active` e permissão de admin na gestão da organização |
| Administrador da plataforma, com sessão ativa | Ler e gravar dados disponíveis ao admin da empresa apenas na organização e sessão selecionadas; leituras de RH e gravações auditadas | Encerrar gestão; demais operações globais permanecem fora do escopo da sessão |
| Admin/RH/TST/usuário da empresa | Acesso da função apenas à própria organização quando `active` | Sem criar rascunho, suspender ou iniciar gestão de plataforma |
| Qualquer membro da empresa quando `draft`, `awaiting_admin` ou `suspended` | Negado | Negado, exceto convite válido para o primeiro admin enquanto `awaiting_admin` |

## Segurança e auditoria

- Toda autorização é validada no banco; ocultar botões ou filtrar consultas somente no navegador não é controle de acesso.
- O ciclo de vida também precisa ser respeitado pelos endpoints públicos/Edge Functions que usam credenciais privilegiadas para acessar dados de uma organização; RLS não é suficiente para operações com `service_role`. O portal do colaborador, solicitações, cursos e assinatura por link devem consultar o estado da organização antes de ler ou gravar dados relacionados.
- A gestão entre organizações exige simultaneamente um `platform_admin` válido, um JWT autenticado, um `session_id` existente em `auth.sessions` e uma sessão ativa do banco vinculada à organização-alvo. Não há acesso irrestrito apenas por o usuário ser administrador da plataforma.
- A sessão de gestão registra usuário, sessão Auth, organização, motivo, início, expiração, encerramento e resultado. Cada escrita e cada acesso a telas de dados pessoais de RH registra ator, organização e ação em trilha append-only, sem copiar segredos ou conteúdo pessoal desnecessário.
- A aplicação não aceita um `organization_id` do navegador como prova de autorização. RLS e rotinas de escrita devem resolver a organização a partir da sessão de gestão registrada no banco; adulterar filtros, IDs, local storage ou o provider não amplia o acesso.
- O usuário da plataforma não pode consultar diretamente a tabela privada de sessões, criar ou editar sessões, conceder a si mesmo papel global, mudar o escopo sem a RPC de início, nem alterar a trilha de auditoria.
- Usuários comuns não podem criar organizações, iniciar modo de gestão, consultar outras organizações ou alterar a trilha de auditoria.
- A remoção de privilégios de `platform_admin` ou o encerramento da sessão invalida novos acessos imediatamente.

## Arquitetura prevista

- Separar criação de rascunho, edição básica e emissão/revogação/reemissão de convite em operações distintas, todas restritas a `platform_admin`.
- Adicionar um único `lifecycle_status` à organização e uma tabela/evento append-only de transições que preserva o estado anterior à suspensão. A tabela de convites passa a registrar `invite_kind` (`first_admin` ou `member`), revogação e ator da revogação.
- Adicionar uma tabela privada de sessões de gestão, ligada a `auth.uid()`, ao `session_id` do JWT e à organização. O helper RLS confirma a validade em cada solicitação e nega sessão expirada, encerrada, inexistente ou cujo papel global foi revogado.
- Ao iniciar nova gestão na mesma sessão Auth, encerrar de forma atômica qualquer escopo anterior ou expirado antes de abrir o novo; sincronizar outras abas para eliminar rótulos e dados em cache do escopo anterior.
- Expor o escopo atual por RPC autenticada; o provider do navegador é somente uma representação da decisão do banco. Sem escopo de plataforma ativo, o usuário comum continua usando `profiles.organization_id`.
- Inventariar tabelas, policies, RPCs, buckets e funções agendadas que usam escopo por organização. Autorizar a gestão por organização em cada superfície necessária; não criar uma policy genérica que dê acesso global a `platform_admin`.
- Atualizar o shell e cada módulo de `PAGE_PERMISSIONS` para usar o escopo validado, mantendo o ator global separado do papel local. Consultas e mutações devem continuar enviando o filtro organizacional correto como otimização, mas RLS continua sendo a autoridade.
- Criar eventos append-only para abertura, encerramento, expiração, revogação, leituras de RH e mutações no modo de gestão. A auditoria deve distinguir ações da plataforma de ações de um administrador da empresa.
- Não conceder `service_role` ao navegador nem permitir que a sessão de gestão opere em tabelas de autenticação, privilégios globais ou organizações alheias.
- Preservar o convite atual para usuários convidados; separar apenas a criação da organização do convite do primeiro administrador.

## Etapas do projeto

1. **Ciclo de vida e convite posterior:** criar/editar rascunhos sem e-mail; estados e migração compatível; gerar, revogar e reemitir convite de primeiro administrador; testes de aceite e expiração.
2. **Sessão segura de gestão:** sessão vinculada a `auth.uid()` e `session_id`, helper de escopo, banner e auditoria; validar as políticas de organização com matriz de autorização antes de habilitar módulos.
3. **Gestão operacional e de RH:** migrar, em grupos revisáveis, todas as páginas, subpáginas, RPCs e objetos de Storage da organização; testar cada domínio antes de ampliar o acesso. RH e anexos pessoais exigem auditoria de leitura e escrita.

As etapas 2 e 3 podem exigir especificações e planos próprios após a revisão deste desenho, para que a alteração abrangente de RLS não seja executada como um único patch sem checkpoints.

## Fora do escopo

- Atribuir senha ao administrador da empresa ou criar uma conta usando credenciais em nome dele. A pessoa convidada define/recupera sua própria senha pelo Supabase Auth.
- Fazer o administrador da plataforma aparecer como usuário da empresa ou registrar alterações como se fossem feitas pelo administrador da empresa.
- Importar dados externos, inventar dados ausentes ou enviar convites automaticamente sem serviço de e-mail configurado.
- Excluir organizações com registros operacionais por cascata.

## Critérios de aceite

- Criar um rascunho sem e-mail de administrador e salvar dados incompletos.
- Editar campos empresariais e, após concluir as etapas de autorização, configurar os módulos abrangidos sob um contexto visível da organização selecionada.
- Confirmar que o perfil e o papel do administrador da plataforma não mudam durante a gestão.
- Confirmar que RLS resolve o escopo pela sessão vinculada ao JWT e não permite consultar dados de outra organização por adulteração de IDs ou filtros.
- Confirmar que abertura, encerramento, expiração, revogação, leituras de RH e escritas no modo de gestão deixam registros auditáveis com o ator correto.
- Convidar posteriormente um administrador novo ou já cadastrado, aceitar com e-mail verificado e conceder papel `admin` restrito à empresa correspondente.
- Confirmar que conta já vinculada a outra organização não é transferida nem alterada silenciosamente.
- Manter organizações existentes e suas permissões operando após a migração.
- Bloquear usuários comuns e administradores de empresa de iniciar gestão de plataforma ou acessar outra organização.
- Expirar e encerrar sessões de gestão; negar operações após encerramento, logout, ausência em `auth.sessions` ou revogação do papel global.
- Verificar transições de estado, convite expirado/revogado/reemitido, suspensão e reativação, exclusão de rascunho vazio e bloqueio de exclusão de organização com dados.
- Executar lint, build, verificação de codificação e testes direcionados das políticas RLS e dos fluxos de convite.

## Riscos e decisões para a implementação

- O modo de gestão abrange dados operacionais e pessoais de RH; a matriz define acesso equivalente ao admin local apenas dentro de uma sessão e organização, com auditoria de leituras sensíveis e escritas.
- O aplicativo hoje deriva o escopo de várias páginas diretamente do perfil. A resolução compartilhada precisa ser migrada por etapas, sem relaxar silenciosamente as políticas RLS.
- O esquema e as políticas reais do Supabase devem ser inventariados antes de criar migrações, pois o banco remoto pode conter alterações posteriores às migrações versionadas localmente.
- A interface deve distinguir claramente `draft`, `awaiting_admin`, `active` e `suspended`, para evitar que organizações incompletas pareçam prontas para os usuários finais.
