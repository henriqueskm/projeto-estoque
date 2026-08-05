# Objetivo atual

- **ID:** MIG-SAF-001
- **Título:** Fundação de banco do Portal da Safisa
- **Prioridade:** alta para o piloto comercial
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** C — migration escrita localmente e aguardando revisão humana antes de qualquer aplicação
- **Branch de execução:** `agent/safisa-portal-migration`
- **Commit base:** `6beeb4e16d36b5591ffa5b26db95b16229fea5d8`
- **Dependências:** NK-SAF-001 concluído; decisões DEC-SAF-001 a DEC-SAF-008 aprovadas; PR #4 mesclado

## Resultado da auditoria

- a infraestrutura atual de Auth, perfis, snapshots, Pedidos, eventos, locks e idempotência é reutilizável;
- o modelo atual não distingue conta interna de conta Safisa;
- todo perfil ativo possui acesso amplo demais para um usuário externo;
- não existe quantidade pronta, autorização de Pedido, alerta de prontidão ou RPC específica da Safisa;
- a solução exige migration atômica, RPCs fechadas e endurecimento das regras de retirada/edição/cancelamento;
- o relatório completo está em `docs/SAFISA_PORTAL_SPEC.md`.

## Decisões aprovadas para o futuro piloto

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
- provisionamento administrativo, membership próprio e ativação/desativação individual;
- signup público deverá ser desabilitado em etapa remota futura e específica;
- nenhum Pedido antigo ou novo será publicado automaticamente;
- publicação e revogação serão explícitas e preservarão a auditoria;
- incremento será atômico e idempotente;
- correção absoluta exigirá justificativa, confirmação e controle de versão;
- a ação interna será “Retirar tudo que está pronto” e nunca alcançará unidade não pronta;
- cancelamento poderá atingir somente saldo ainda não pronto, sem reduzir `ready_quantity` implicitamente;
- Pedidos encerrados serão somente leitura enquanto autorizados;
- o portal ficará em `/safisa`, no mesmo deploy, com layout, navegação e guards separados.

## MIG-SAF-001 escrita, não aplicada

A migration `supabase/migrations/20260804044500_safisa_portal_foundation.sql` materializa o contrato aprovado: membership, autorização explícita de Pedidos, `ready_quantity`, ledger de auditoria/idempotência, constraints, índices, RLS, grants/revokes, RPCs fixas, backfill sem publicação automática e endurecimento transacional de retirada, edição e cancelamento. O teste estático de contrato cobre isolamento, replay, payload conflitante, concorrência, invariantes, permissões e ausência de seed/configuração remota.

## Escopo proibido nesta etapa

- aplicar migration;
- alterar RPC, RLS, grants ou configuração remota;
- implementar portal ou alertas;
- criar contas Safisa;
- executar operação real;
- fazer `db push` ou merge.

## Pontos de parada

- revisão do SQL da MIG-SAF-001: `WAITING_HUMAN_REVIEW`;
- aplicação da migration/RPC: aprovação humana específica obrigatória e separada;
- configuração do Supabase Auth: aprovação humana específica obrigatória;
- testes autenticados e concorrentes: aprovação operacional específica.

## Execução

- **Última ação:** NK-SAF-001 concluído e PR #4 mesclado; MIG-SAF-001 escrita localmente com teste estático, sem aplicação.
- **Próximo passo:** revisar o SQL e o contrato da MIG-SAF-001 no PR draft; o remoto permanece bloqueado.
- **Decisões concluídas:** DEC-SAF-001 a DEC-SAF-008.
- **Aprovação ainda pendente:** revisão humana da migration; depois, autorizações separadas para aplicação remota e para alterar a configuração remota de signup.
