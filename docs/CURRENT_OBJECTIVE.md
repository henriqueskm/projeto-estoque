# Objetivo atual

- **ID:** MIG-SAF-003
- **Título:** Transição segura de Pedidos legados
- **Prioridade:** alta para desbloquear a implantação controlada do Portal Safisa
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** C — migration incremental validada localmente; merge e aplicação remota exigem autorizações separadas
- **Branch de execução:** `agent/safisa-legacy-order-transition`
- **Pull request:** [#8](https://github.com/henriqueskm/projeto-estoque/pull/8) — draft
- **Base:** `origin/main` no merge aprovado `a822c65af4429aa01c700ca284c7371b423df7cc`
- **Dependências:** MIG-SAF-001 mesclada e MIG-BASE-001 concluída; DEC-SAF-001 a DEC-SAF-009 aprovadas

## Motivo da transição

O gate anterior impediu corretamente a aplicação remota da MIG-SAF-001 porque
existem Pedidos ativos anteriores ao Portal Safisa. O backfill
`ready_quantity = picked_quantity` é mantido, mas esses Pedidos não podem ter a
retirada histórica bloqueada antes de serem publicados no portal.

Nenhum identificador ou dado de Pedido real foi copiado para esta branch. Os
testes usam somente fixtures locais equivalentes em quantidade.

## Contrato da MIG-SAF-003

- ausência de linha em `safisa_order_authorizations` identifica o regime legado;
- retirada legada mantém todos os limites históricos e autoavança
  `ready_quantity` até o novo `picked_quantity`, atomicamente e sem reduzi-la;
- existência da autorização identifica permanentemente o regime Safisa-managed,
  independentemente de `is_authorized`;
- no regime gerenciado, retirada individual e “retirar tudo” permanecem
  limitadas ao que está pronto;
- revogação controla visibilidade e não restaura comportamento legado;
- autoavanço legado não cria autorização, membership ou evento Safisa;
- publicação e retirada são serializadas pelo lock canônico do Pedido;
- entrada no Estoque e `stocked_quantity` permanecem operações separadas.

## Validação local concluída

- migration estática: 6 testes aprovados;
- suíte Safisa existente: cenários A–H e cinco concorrências aprovados;
- nova suíte: fixtures equivalentes a 5 Pedidos, 14 linhas e 61 unidades
  pendentes, publicação irreversível, revogação, alertas e cinco concorrências
  com duas conexões aprovadas;
- duas reconstruções independentes: `SchemaSignature e5b32608e246d03522d8e06b0cadcf4f`
  e `CatalogSignature 9e010282ce86835cb5973da9b50a5d52` em ambas;
- regressões do baseline e da Assistente, lint, TypeScript, build e
  `git diff --check` aprovados;
- MIG-SAF-001 permaneceu inalterada.

## Escopo proibido

- aplicar MIG-SAF-001 ou MIG-SAF-003 remotamente;
- executar `db push`, `migration repair` ou SQL mutável remoto;
- alterar Auth, RPCs remotas, contas ou publicações Safisa;
- executar operação real de Pedido ou Estoque;
- marcar o PR ready ou fazer merge.

## Próximo passo

Revisar humanamente o PR #8. A eventual sequência de aplicação remota das duas
migrations exigirá uma autorização operacional nova e específica.

**Ponto de parada:** `WAITING_HUMAN_REVIEW`.
