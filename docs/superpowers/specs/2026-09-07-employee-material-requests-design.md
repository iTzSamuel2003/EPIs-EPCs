# Solicitacoes de troca pelo portal

## Objetivo

Permitir que o colaborador abra uma solicitacao de troca para um unico material ainda sob sua responsabilidade, com motivo/descricao e foto ou PDF opcional. A equipe interna acompanha todas as solicitacoes em uma aba propria.

## Experiencia do colaborador

- O tipo `Troca de material` exibe um seletor com os materiais atualmente vinculados ao colaborador.
- Cada envio referencia exatamente um `delivery_item`, preservando lote, quantidade e historico.
- A troca sera solicitada para a quantidade total ainda vinculada ao item; troca parcial fica fora da primeira versao.
- O sistema impede novo pedido aberto para o mesmo item enquanto existir status `pending`, `in_review` ou `approved`.
- O colaborador informa descricao obrigatoria e pode anexar PDF, JPG, PNG ou WEBP de ate 10 MB.
- Apos enviar, o portal atualiza a lista sem recarregar e mostra o status.
- Os demais tipos continuam funcionando sem material obrigatorio.

## Dados e seguranca

- A migracao adiciona `delivery_item_id uuid null references public.delivery_items(id)`, `requested_quantity integer`, `material_name_snapshot text`, `lot_number_snapshot text`, `attachment_path text`, `attachment_uploaded_at timestamptz`, `review_notes text` e `updated_at timestamptz not null default now()` em `employee_portal_requests`, com indices por organizacao/status. A funcao confirma que `delivery_items.delivery_id` pertence a `deliveries.employee_id` e que ambos pertencem a `organization_id`; pedidos abertos terao indice unico parcial por `delivery_item_id` para evitar concorrencia.
- A solicitacao registra snapshot da quantidade e do material no momento do pedido. Nao reserva estoque; ao aprovar, a equipe revalida o saldo atual e a quantidade solicitada antes de efetivar a troca.
- Uma Edge Function `submit-employee-portal-request` recebera multipart com matricula, CPF, item, descricao e anexo opcional. Ela valida colaborador, item, saldo e duplicidade, cria o pedido, envia o arquivo ao Storage privado no caminho definitivo e atualiza o pedido; em qualquer falha remove arquivo e registro. A RPC antiga continua para pedidos sem material de clientes antigos.
- A resposta publica sera versionada como `get_employee_portal_data_v3`: materiais terao `delivery_item_id`, lote, nome e quantidade vinculada; pedidos terao apenas status, tipo, material, descricao e datas. `review_notes`, paths de storage e dados internos nunca serao retornados.
- O anexo usara bucket privado `employee-request-attachments`, no caminho `organization_id/request_id/nome-seguro`. O browser nunca recebera service key e nao fara upload direto; a Edge Function usara service role apenas no servidor.
- A politica ampla atual `for all` sera removida. A tabela tera leitura autenticada somente na organizacao, insercao apenas pela funcao/RPC controlada e atualizacao autenticada somente para `profiles.role = 'admin'`, sempre com `USING` e `WITH CHECK` por organizacao. O colaborador anonimo nao acessa a tabela diretamente.
- O Storage tera leitura e delete apenas para `authenticated` da mesma organizacao; o portal nao tera permissao de leitura. A Edge Function validara MIME, extensao e 10 MB, e podera aplicar limite de tentativas por IP/identificador.

## Experiencia interna

- Nova pagina `/requests` no menu lateral, seguindo o tema atual.
- Tabela com data, funcionario, matricula, material, tipo, descricao, anexo e status.
- Filtros por busca, tipo e status.
- Acoes para abrir anexo por URL temporaria e atualizar status entre `Pendente`, `Em analise`, `Aprovada`, `Recusada` e `Concluida`.
- Recusar, aprovar ou concluir exige confirmacao visual; a lista atualiza apos salvar.

## Fluxo de dados

1. O portal carrega os itens `delivery_item` ainda nao devolvidos.
2. Ao escolher troca, o formulario exige um unico item.
3. O portal envia o formulario para a Edge Function, que valida tamanho e tipo do arquivo, funcionario, organizacao, item, saldo e duplicidade.
4. A Edge Function cria o pedido com snapshot, envia o anexo definitivo e finaliza a linha; o indice unico parcial trata duas tentativas simultaneas.
5. O painel consulta pedidos da organizacao e gera URL assinada somente ao abrir o arquivo.

## Erros e validacoes

- Bloquear envio sem item, descricao, ou com item totalmente devolvido.
- Remover arquivo e registro em qualquer falha de gravacao.
- Manter pedidos antigos compativeis, com `delivery_item_id` nulo.
- Mostrar mensagens claras para arquivo invalido, limite, concorrencia e falha de atualizacao.
- Nao revelar se matricula/CPF existe em respostas de login invalidas.
- As RPCs atuais `get_employee_portal_data` e `get_employee_portal_data_v2` permanecem disponiveis para clientes antigos, sem expor campos internos; o portal web migra para `get_employee_portal_data_v3`. As novas RPCs especificam `security definer`, `set search_path = public`, `revoke all` e `grant execute` somente aos papeis necessarios.
- Clientes antigos continuam criando pedidos sem material pela RPC antiga; pedidos novos com anexo usam as RPCs novas sem quebrar leituras antigas.

## Verificacao

- Build de producao.
- Verificacao das RPCs, bucket e politicas no Supabase.
- Teste manual de troca com anexo e atualizacao de status.
- Teste de autorizacao entre organizacoes, item devolvido, duplicidade, concorrencia, limpeza de arquivo em falha e permissao da Edge Function.
- Verificar que usuario comum nao altera status/observacao e que paths de outra organizacao nao geram URL assinada.
