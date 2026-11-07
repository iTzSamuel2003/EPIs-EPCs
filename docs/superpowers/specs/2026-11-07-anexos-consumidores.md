# Consumidores da ativação de anexos

**Projeto:** EPIS+
**Data do inventário:** 2026-11-07

Este inventário define onde as ativações 03–07 da organização devem orientar novas operações. A configuração persistida em `organization_annex_settings` é a fonte de verdade. O campo legado `contract_scenarios.active` não substitui a configuração do anexo.

## Regras comuns

- Material com vínculo em vários anexos fica disponível quando ao menos um vínculo está ativo.
- Material sem vínculo contratual continua disponível para cadastro e operação manual.
- Definições e registros históricos não são apagados por desativação; apenas deixam de ser oferecidos em novos fluxos.
- Devoluções, cursos já registrados, materiais já atribuídos e correções que reduzem saldo permanecem acessíveis.
- A interface filtra opções, mas RPCs e triggers também precisam validar novas gravações.

## Telas e operações

| Área | Comportamento esperado |
| --- | --- |
| Materiais | Exibir configurações 03–07; 03 identifica cursos, e 04–07 identificam materiais/equipes. Mostrar definições inativas sem oferecê-las para novas operações. |
| Entradas e correções de nota | Bloquear entrada de material cujo(s) anexo(s) estejam todos inativos; permitir correção que reduza o saldo. |
| Entregas | Filtrar novos materiais e validar novamente na preparação e na confirmação final; manter consulta de entregas e atribuições existentes. |
| Requisitos contratuais e conformidade | Mostrar estado do cenário/requisito e impedir seleção em novos cadastros quando o anexo estiver inativo; manter dados já registrados. |
| Listas por função | Não sugerir materiais vinculados apenas a anexos inativos; preservar listas e classificações existentes. |
| Equipes | Manter consulta de equipes existentes; bloquear novo cenário ou membro de material de anexo inativo. |
| Cursos e matriz de treinamento | Oferecer cursos do Anexo 03 somente quando ativo; não ocultar cursos concluídos nem documentos anteriores. |
| Ficha do colaborador | Preservar cursos, anexos e histórico já cadastrados, inclusive com Anexo 03 inativo. |
| Portal do colaborador | Filtrar cursos disponíveis pelo Anexo 03 e validar o envio no servidor; preservar cursos históricos. |
| Variantes e unidades físicas | Continuar permitindo consulta e controle de estoque físico existente mesmo que o anexo correspondente seja desativado. |

## Pontos de validação no banco

- `private.enforce_enabled_contract_annex_on_stock_entry()` deve aplicar a regra de vínculo ativo por organização, não bloquear um material que possua outro anexo ativo.
- `public.update_stock_entry_invoice(...)` deve validar apenas aumentos de saldo; correções negativas continuam permitidas.
- Preparação/finalização de entrega e inserção de atribuições precisam validar novamente os materiais selecionados.
- `public.save_function_template(...)` e gravações de equipes precisam rejeitar novas referências a material/cenário inativo.
- RPCs do portal filtram cursos inativos e rejeitam submissões novas do Anexo 03.
- Exclusão, edição de histórico e fluxo de devolução não devem ser barrados pelos guards de anexos.

## Revisão final

Após a implementação, revisar cada tela e cada RPC acima, conferir ativação/desativação/reversão em múltiplos anexos e testar que os fluxos históricos continuam disponíveis. O teste de banco deve confirmar as regras de autorização e que nenhuma escrita pode contornar a configuração do cliente.
