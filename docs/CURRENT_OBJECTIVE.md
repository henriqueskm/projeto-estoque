# Objetivo atual

- **ID:** NK-SAF-003
- **Título:** Safisa automática por Pedido
- **Prioridade:** crítica para entrega do piloto
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** B — aplicação sobre RPCs oficiais já implantadas
- **Branch de execução:** `agent/safisa-automatic-orders`
- **Pull request:** [#10](https://github.com/henriqueskm/projeto-estoque/pull/10) (draft)
- **Base:** `origin/main` no merge aprovado `5e94db50f1b017749a486eae01b7edece75279b1`
- **Dependências:** MIG-SAF-001 e MIG-SAF-003 aplicadas no Supabase remoto

## Entrega implementada

- `/safisa/login` usa o Supabase Auth existente e valida membership Safisa sem
  exigir `profiles.is_active = true`;
- `/safisa` possui layout próprio, guard server-side e não expõe navegação da
  aplicação interna;
- lista e detalhe consomem `list_safisa_orders` e `get_safisa_order`, sem
  depender de autorização explícita por Pedido;
- incremento e “marcar restante” usam somente
  `increment_safisa_ready_quantity`, com delta positivo e idempotência;
- correção absoluta exige total, justificativa, confirmação e versão e usa
  somente `correct_safisa_ready_quantity`;
- conflito concorrente recarrega os dados e nunca sobrescreve silenciosamente;
- Pedidos concluídos pela retirada permanecem legíveis e sem controles de
  mutação; cancelados permanecem apenas no histórico interno;
- contas Safisa simultâneas mantêm sessão e autoria individuais.

## Ciclo automático aprovado

- todo `supplier_order` é Safisa-managed automaticamente, inclusive os
  existentes, sem criar autorizações artificiais;
- o Portal separa `Em andamento` (`waiting_pickup_quantity > 0`) de
  `Concluídos` (`waiting_pickup_quantity = 0`), sempre excluindo cancelados;
- `picked_quantity <= ready_quantity` é universal; a compatibilidade legada da
  MIG-SAF-003 foi supersedida sem modificar sua migration histórica;
- “Excluir pedido” continua sendo cancelamento lógico, auditado e bloqueado
  quando existir quantidade pronta ainda não retirada;
- `safisa_order_authorizations` e suas RPCs de publicação permanecem somente
  para compatibilidade/auditoria histórica e não controlam Portal, alertas ou
  retirada.

## Validação local concluída

- baseline + MIG-SAF-001 + MIG-SAF-003 + MIG-SAF-004 reconstruídos exclusivamente no Supabase
  Local;
- fixtures locais com duas contas Safisa, usuário sem acesso, Pedidos publicados,
  oculto, revogado e encerrado;
- testes A–O e quatro concorrências PostgreSQL reais aprovados com fixtures
  fictícias;
- navegador integrado validado em 320, 375, 768 e 1440 px, sem overflow ou erro
  de console;
- incremento, prevenção de double-submit, correção, conflito e marcação do
  restante executados apenas sobre fixtures locais.

## Fora do escopo

- provisionar conta Safisa real;
- publicar Pedido real ou alterar autorização histórica;
- administrar memberships;
- alertas internos de retirada;
- alterar Auth, Estoque, RPCs ou migrations;
- executar `db push` ou qualquer mutação no Supabase remoto.

## Próximo passo

Revisar humanamente a MIG-SAF-004, a UI do ciclo automático e o PR draft.
Merge, provisionamento e piloto exigem autorizações posteriores.

**Ponto de parada:** `WAITING_HUMAN_REVIEW`.
