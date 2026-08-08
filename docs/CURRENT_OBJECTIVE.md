# Objetivo atual

- **ID:** NK-DIS-002
- **Título:** Implementação da desmontagem pela Assistente
- **Prioridade:** alta
- **Estado:** WAITING_HUMAN_VISUAL_REVIEW
- **Classificação:** B — contrato oficial existente, com integração de aplicação
- **Branch de execução:** `agent/assistant-disassembly`
- **Base:** `origin/main` em `a6aa8f28eb7b20e82d7ce963b97064979db1b794`
- **Dependência concluída:** NK-DIS-001; NK-SAF-004 concluído no PR #12.

## Escopo desta implementação

- intenção determinística para desmontagem de Servo com kit;
- resolução segura por código comercial, modelo ou seleção estruturada;
- prévia assinada por HMAC, confirmação exclusiva por botão e rota fixa
  `/api/assistant/actions/configuration-disassembly`;
- execução exclusivamente pela ação interna `disassembleCommercialConfiguration`,
  que termina na RPC oficial `public.disassemble_commercial_configuration`;
- recibo estruturado, idempotência e expiração sem persistir proposalToken.

Nenhuma migration, alteração de RPC, operação remota ou desmontagem real é
parte deste objetivo. A próxima etapa é a validação visual humana autenticada.

## Histórico do objetivo anterior: NK-SAF-004

NK-SAF-004 foi concluído e mesclado no PR #12; os detalhes abaixo permanecem
como registro da arquitetura aprovada dos alertas Safisa.

### Encerramento de NK-SAF-003

- todo Pedido é Safisa-managed automaticamente e não depende de publicação por Pedido;
- a MIG-SAF-004 está aplicada em produção, sem backfill operacional;
- o Portal Safisa foi validado em produção, inclusive login, abas `Em andamento` e
  `Concluídos` e o layout compacto das linhas;
- `picked_quantity <= ready_quantity` é universal, e cancelamento lógico continua
  bloqueado quando existe prontidão pendente;
- `safisa_order_authorizations` permanece apenas como histórico/compatibilidade.

## Auditoria de dados e contratos

- `supplier_order_summaries` e `supplier_order_item_details` já fornecem
  `ready_quantity`, `picked_quantity`, `cancelled_quantity`,
  `ready_waiting_pickup_quantity`, `waiting_pickup_quantity` e
  `readiness_status`;
- o alerta atual é derivável por linha quando
  `ready_quantity - picked_quantity > 0`;
- um Pedido está totalmente preparado quando, no agregado de suas linhas,
  `sum(ready_quantity + cancelled_quantity) = sum(ordered_quantity)`;
- o alerta fica ativo somente se o Pedido não estiver cancelado, ainda tiver
  `waiting_pickup_quantity > 0` e houver unidade pronta aguardando retirada;
- `safisa_portal_events` preserva o incremento/correção de prontidão, o ator e
  o horário para contexto recente, mas não é a fonte do estado atual;
- `public.list_safisa_ready_pickup_alerts(p_limit)` já retorna as linhas atuais
  elegíveis, com negociação, quantidade pronta/retirada, pendência e status, e
  exige `private.require_supplier_order_user()`.

## Decisão técnica

**NO_MIGRATION_REQUIRED.** O estado atual pode ser derivado das views, da RPC de
leitura existente e, quando necessário, dos eventos Safisa. Uma tabela nova só
passaria a ser necessária para preferências persistentes por usuário, como
`lido/não lido`, dismiss manual ou histórico próprio de notificações.

## UX proposta

- sino no shell interno (`AppSidebar` desktop e cabeçalho mobile), com contador
  apenas quando existir alerta atual;
- painel compacto, somente leitura, sem ação destrutiva: alerta total mostra
  “Pedido <negociação> pronto para retirada” e `<X> de <X> unidades prontas`;
  alerta parcial mostra “Novas unidades prontas no Pedido <negociação>” e a
  pendência de retirada; ambos oferecem somente `Ver pedido`;
- dashboard/Home recebe bloco compacto condicional; quando não houver alerta,
  não ocupa espaço;
- `/pedidos` prioriza pedidos com `readyWaitingPickupQuantity > 0`, com badge
  textual discreto e ordenação estável, sem transformar cards inteiros em verde;
- o detalhe do Pedido mostra a pendência pronta por linha e a origem recente
  apenas como contexto, sem criar ação adicional.

## Concorrência e segurança

- Safisa pode informar prontidão enquanto o interno visualiza: o painel sempre
  se baseia em resposta atual e é revalidado após foco/navegação e operações de
  retirada;
- se a retirada vencer a concorrência, `ready_quantity - picked_quantity` volta
  a zero e o alerta some no próximo refresh; o painel não confirma retirada;
- a última unidade pronta e a retirada seguem os locks e invariantes existentes;
  a UI tolera estado obsoleto sem contador fantasma;
- somente perfil interno ativo consulta os alertas; Safisa não recebe navegação,
  painel ou acesso ao contrato interno; não há service role no cliente nem query
  livre.

## Implementação local A–E

1. **Fase A — dados/contratos:** adaptador server-side tipado sobre a RPC
   oficial, enriquecido por uma única leitura batelada de resumos para calcular
   o agregado do Pedido sem N+1.
2. **Fase B — sino e painel global:** contador de Pedidos ativos, painel somente
   leitura, foco, Escape, clique externo e links internos.
3. **Fase C — Home:** bloco compacto, condicional e limitado aos três primeiros
   Pedidos; não reserva espaço quando vazio.
4. **Fase D — Pedidos:** priorização estável de retirada pronta, badge textual e
   indicador no detalhe; o fluxo oficial de retirada permanece inalterado.
5. **Fase E — atualização e testes:** atualização do estado do sino em foco e a
   cada 60 segundos somente com a aba visível, sem `router.refresh()` global;
   testes unitários e de integração estática aguardam validação visual humana.

## Fora do escopo desta fase

- ações mutáveis, Server Actions, RPCs novas ou migrations;
- qualquer escrita remota, operação real, alteração de Vercel ou merge.

**Ponto de parada:** `WAITING_HUMAN_REVIEW` após validação visual humana.
