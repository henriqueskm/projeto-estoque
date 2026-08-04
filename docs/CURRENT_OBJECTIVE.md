# Objetivo atual

- **ID:** NK-SAF-001
- **Título:** Auditoria e especificação do Portal da Safisa
- **Prioridade:** alta para o piloto comercial
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** C/D — exige migration/RPC e decisões humanas
- **Branch de execução:** `agent/safisa-portal-audit`
- **Commit base:** `2038b232ab1d0deb5aed793587a97165f79a962a`
- **Dependências:** Pedidos existentes; NK-ASM-002 concluído; PR #3 mesclado

## Resultado da auditoria

- a infraestrutura atual de Auth, perfis, snapshots, Pedidos, eventos, locks e idempotência é reutilizável;
- o modelo atual não distingue conta interna de conta Safisa;
- todo perfil ativo possui acesso amplo demais para um usuário externo;
- não existe quantidade pronta, autorização de Pedido, alerta de prontidão ou RPC específica da Safisa;
- a solução exige migration atômica, RPCs fechadas e endurecimento das regras de retirada/edição/cancelamento;
- o relatório completo está em `docs/SAFISA_PORTAL_SPEC.md`.

## Escopo aprovado para o futuro piloto

- um único fornecedor: Safisa;
- contas individuais e auditáveis;
- acesso compartilhado somente a Pedidos autorizados;
- incremento atômico de novas unidades prontas;
- correção de total com proteção de concorrência;
- `ready_quantity >= picked_quantity`;
- alerta interno de itens prontos pendentes;
- estados parcialmente/completamente pronto;
- retirada exclusiva do aplicativo interno;
- entrada no Estoque separada;
- nenhuma permissão da Safisa para editar Pedido, negociação ou Estoque.

## Escopo proibido nesta etapa

- criar ou aplicar migration;
- alterar RPC, RLS, grants ou configuração remota;
- implementar portal ou alertas;
- criar contas Safisa;
- executar operação real;
- fazer `db push` ou merge.

## Pontos de parada

- decisões de identidade, publicação, correção, retirada e cancelamento: `WAITING_HUMAN_REVIEW`;
- migration/RPC: aprovação humana específica obrigatória;
- configuração do Supabase Auth: aprovação humana específica obrigatória;
- testes autenticados e concorrentes: aprovação operacional específica.

## Execução

- **Última ação:** NK-ASM-002 concluído; montagem validada operacionalmente; PR #3 mesclado e smoke test aprovado sem duplicidade ou efeito colateral. Auditoria NK-SAF-001 concluída por leitura.
- **Próximo passo:** revisar `SAFISA_PORTAL_SPEC.md` e decidir os itens DEC-SAF-001 a DEC-SAF-008.
- **Decisões humanas pendentes:** provisionamento, cadastro público, publicação de Pedidos, correção, retirada total, cancelamento, histórico e URL do piloto.
