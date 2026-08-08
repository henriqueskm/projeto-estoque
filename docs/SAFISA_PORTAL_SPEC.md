# NK-SAF-001 — Auditoria e especificação do Portal da Safisa

- **Prioridade:** alta para o piloto comercial
- **Estado:** DONE — fundação aplicada; Portal MVP em `WAITING_HUMAN_REVIEW`
- **Classificação:** B — interface sobre RPCs oficiais já implantadas
- **Projeto auditado:** `isdjboconmwaqipjrjvp`
- **Data da auditoria:** 2026-08-04

## Escopo e premissas aprovadas

Existe um único fornecedor, Safisa. Cada pessoa da Safisa terá uma conta individual. Todas as contas ativas poderão consultar os Pedidos explicitamente autorizados e registrar, de forma concorrente e auditável, quantidades prontas por item.

A quantidade pronta será cumulativa: inclui unidades já retiradas e nunca poderá ficar abaixo de `picked_quantity`. A retirada continuará exclusiva do aplicativo interno; a entrada no Estoque continuará sendo uma operação posterior e separada. O portal não poderá criar ou editar Pedido, negociação, catálogo, retirada, entrada ou saldo.

DEC-SAF-001 a DEC-SAF-009 foram aprovadas. Contas serão individuais, administrativamente provisionadas e isoladas dos perfis internos. Pedidos serão publicados e revogados explicitamente. Incrementos serão atômicos e idempotentes; correções absolutas exigirão justificativa, confirmação e controle de versão. O aplicativo interno retirará somente unidades prontas depois que o Pedido entrar no ciclo Safisa; Pedidos nunca publicados preservam temporariamente a retirada legada. O portal ficará em `/safisa`, no mesmo deploy, com layout e guardas próprios.

## Evidências do estado atual

- 22 migrations locais/remotas estão alinhadas.
- Existem 2 usuários autenticados, ambos com perfil ativo e nome; não existe distinção de tipo de conta.
- O cadastro por e-mail está habilitado, confirmação automática está desabilitada e o trigger atual cria `profiles.is_active = true` por padrão.
- Existem 6 Pedidos, 17 linhas e 19 eventos; 5 Pedidos estão ativos e 1 está no histórico.
- Totais atuais: 76 unidades pedidas, 15 retiradas, 8 lançadas no Estoque e 0 canceladas.
- Oito linhas já possuem retirada. Um backfill seguro de prontidão deve iniciar essas linhas com `ready_quantity = picked_quantity`.
- Não existe coluna, tabela, view ou RPC de quantidade pronta/preparada.
- As invariantes atuais estão íntegras: nenhum `stocked_quantity > picked_quantity`, nenhuma soma retirada+cancelada acima do pedido e nenhuma quantidade negativa.

## Estrutura reutilizável existente

### Autenticação e identidade

- Supabase Auth e SSR já renovam e validam a sessão.
- `auth.users` possui correspondência integral com `public.profiles`.
- `profiles.name` e snapshots de nome já suportam auditoria nominal.
- O aplicativo interno já possui guards server-side, logout e isolamento de rotas autenticadas.

### Pedidos

- `supplier_orders`, `supplier_order_items` e `supplier_order_events` já preservam snapshots do catálogo e histórico imutável.
- `ordered_quantity`, `picked_quantity`, `stocked_quantity` e `cancelled_quantity` já separam Pedido, retirada e entrada no Estoque.
- Views oficiais já calculam pendência de retirada e de entrada.
- RPCs usam wrappers `SECURITY DEFINER`, workers privados, `search_path` vazio, perfil ativo, locks, idempotência e snapshots do usuário.
- Atualizações sensíveis bloqueiam o Pedido e as linhas em ordem estável e usam `updated_at` integral para detectar prévias antigas.
- A entrada vinculada ao Pedido é atômica e permanece separada da retirada.

## Lacunas bloqueantes

1. `profiles` não distingue usuário interno de usuário Safisa.
2. Todo perfil ativo pode ler Estoque/Pedidos e chamar RPCs operacionais concedidas a `authenticated`.
3. Novos perfis nascem ativos; uma conta externa não pode ser criada com segurança pelo fluxo atual.
4. Não existe associação de conta à Safisa nem ciclo de ativação/revogação do portal.
5. Não existe autorização explícita de quais Pedidos podem aparecer no portal.
6. Não existe `ready_quantity`, estado parcial/completo, pendência pronta para retirada ou alerta interno.
7. As RPCs de retirada não limitam a retirada ao total informado como pronto.
8. Edição, cancelamento e finalização atuais não conhecem quantidade pronta.
9. Não existem RPCs restritas para incremento/correção nem ledger idempotente específico da Safisa.
10. A interface atual de Pedidos envia catálogo e ações internas que não podem ser reutilizados diretamente no portal.

## Modelo de dados recomendado

### Identidade externa

Criar `public.safisa_portal_members` com uma linha por `auth.users`/`profiles`, contendo estado ativo, datas e auditoria de provisionamento. Como existe somente a Safisa, não criar tabela genérica de fornecedores nesta fase.

Contas Safisa devem manter `profiles.is_active = false`, usando a associação ativa do portal como autoridade própria. Isso faz com que as RLS e RPCs internas existentes continuem negando Estoque, Pedidos internos e operações. O trigger/default de novos perfis deve passar a ser seguro por padrão (`is_active = false`); usuários internos futuros exigirão ativação administrativa explícita.

### Autorização de Pedidos

Criar `public.safisa_order_authorizations`, com `supplier_order_id` único, estado autorizado/revogado, usuário interno responsável e snapshots. O portal verá somente Pedidos com autorização ativa.

O backfill recomendado é não autorizar nenhum Pedido automaticamente. A primeira lista deve ser publicada conscientemente pelo usuário interno.

### Quantidade pronta

Adicionar a `supplier_order_items`:

- `ready_quantity integer not null`;
- backfill inicial `ready_quantity = picked_quantity`;
- constraint `ready_quantity >= picked_quantity`;
- constraint `ready_quantity + cancelled_quantity <= ordered_quantity`.

Derivados oficiais:

- pronto pendente de retirada: `ready_quantity - picked_quantity`;
- ainda não pronto: `ordered_quantity - cancelled_quantity - ready_quantity`;
- Pedido completamente pronto: todas as linhas satisfazem `ready_quantity + cancelled_quantity = ordered_quantity`;
- Pedido parcialmente pronto: existe prontidão maior que zero, mas a condição completa ainda não foi alcançada.

### Auditoria

Reutilizar o padrão de `supplier_order_events`, mas criar eventos específicos e seguros para o portal ou uma tabela dedicada caso a exposição seletiva do ledger atual não seja suficiente. Cada evento deve registrar usuário, snapshot do nome, Pedido, linha, modo `INCREMENT` ou `CORRECTION`, valor anterior, delta, valor novo, chave de idempotência e data.

O portal não deve receber a chave de idempotência, `details` internos ou eventos operacionais do aplicativo principal.

## Permissões e RLS/RPCs

- Não conceder `INSERT`, `UPDATE` ou `DELETE` direto em nenhuma tabela ao navegador.
- Manter tabelas de Estoque, catálogo e Pedidos internos inacessíveis às contas Safisa.
- Criar guard privado `require_active_safisa_portal_member()` que derive o usuário somente de `auth.uid()` e exija perfil com nome.
- Leitura do portal deve passar por RPCs `SECURITY DEFINER` de contrato fechado, retornando somente campos necessários dos Pedidos autorizados.
- Escrita deve usar duas RPCs fixas: incremento de novas unidades prontas e correção do total.
- Workers privados permanecem `SECURITY INVOKER`, com `search_path` vazio e sem `EXECUTE` para clientes.
- As RPCs internas atuais continuam exigindo `profiles.is_active = true`; testes de segurança devem cobrir todas as operações de Estoque e Pedido com uma conta Safisa.
- `anon` e `PUBLIC` não recebem acesso; contas Safisa recebem somente as RPCs do portal.

## Concorrência e idempotência

### Incremento

O incremento é delta positivo. A RPC deve:

1. adquirir lock transacional da chave de idempotência;
2. bloquear Pedido e linha em ordem estável;
3. reler autorização, associação e quantidades;
4. aplicar `ready_quantity = ready_quantity + delta` sobre o valor atual;
5. validar o limite do Pedido;
6. gravar evento e retorno na mesma transação.

Dois incrementos simultâneos devem serializar e ambos somar; nenhum pode sobrescrever o outro.

### Correção de total

A correção é absoluta e deve exigir `expected_updated_at` integral após os locks. Se qualquer incremento ou correção ocorreu depois da leitura, a correção falha com conflito e exige recarregamento. Nunca pode resultar em valor abaixo da retirada ou acima do total não cancelado.

Mesma chave e mesmo payload retornam replay; mesma chave com payload diferente é rejeitada. Não haverá retry automático com nova chave.

## Impactos obrigatórios nas operações atuais — aprovados

- Retirada unitária deve rejeitar `picked_quantity > ready_quantity`.
- A ação interna deve se chamar “Retirar tudo que está pronto” e operar somente sobre `ready_quantity - picked_quantity`, preservando a retirada parcial.
- Edição não pode reduzir quantidade pedida abaixo de pronta+cancelada, remover linha com prontidão ou trocar sua identidade física.
- Cancelamento pode atingir separadamente apenas o saldo ainda não pronto; unidades prontas não retiradas exigem retirada ou correção justificada e `ready_quantity` nunca é reduzida implicitamente.
- Pedidos concluídos ou cancelados permanecem somente leitura enquanto autorizados; revogação remove acesso sem apagar dados ou auditoria.
- Entrada no Estoque continua usando exclusivamente `picked_quantity - stocked_quantity` e não consulta `ready_quantity`.

## Interface proposta

### Portal Safisa

- rota e layout próprios, recomendação inicial `/safisa` no mesmo deploy;
- login individual e identificação visível do usuário;
- lista paginada somente de Pedidos autorizados;
- badges “Parcialmente pronto” e “Completamente pronto”;
- por linha: código, descrição, pedido, pronto, retirado, pronto pendente e ainda não pronto;
- ação principal “Adicionar unidades prontas”;
- correção de total como ação secundária, com confirmação e conflito visível;
- histórico seguro mostrando quem alterou e quando;
- nenhum botão de edição, retirada, entrada ou Estoque.

### Aplicativo principal

- alerta agregado de itens prontos pendentes (`ready_quantity - picked_quantity > 0`);
- acesso ao Pedido/linha correspondente;
- atualização do alerta depois de retirada;
- distinção clara entre preparação, retirada e entrada no Estoque.

Para o piloto, revalidar após cada operação e ao retornar à página é suficiente. Realtime ou polling contínuo não é requisito inicial; a atomicidade permanece no banco.

## MIG-SAF-001 — fundação aplicada

O contrato foi materializado em `supabase/migrations/20260804044500_safisa_portal_foundation.sql`. A migration é única e atômica, permaneceu imutável após a revisão e foi aplicada remotamente em conjunto com a transição incremental MIG-SAF-003, sob protocolo controlado.

### Tabelas

`public.safisa_portal_members`:

- `user_id uuid` como PK e FK para `auth.users` com exclusão restrita;
- `is_active boolean not null default false`;
- `created_at`, `updated_at`, `activated_at`, `deactivated_at`;
- `created_by`, `updated_by` e snapshots nominais internos;
- constraint temporal coerente entre estado e datas.

`public.safisa_order_authorizations`:

- `supplier_order_id uuid` como PK/FK com `ON DELETE RESTRICT`;
- `is_authorized boolean not null default false`;
- datas de publicação/revogação;
- usuário e snapshot de quem publicou ou revogou;
- versão/`updated_at` para conflito e auditoria.

`public.safisa_portal_events`:

- PK UUID, Pedido/linha ou usuário-alvo, ator Safisa ou interno e snapshot do nome;
- tipos fechados para membership, publicação/revogação, `READY_QUANTITY_INCREMENTED` e `READY_QUANTITY_CORRECTED`;
- quantidade anterior, delta, total novo, justificativa nullable somente para incremento e obrigatória para correção;
- `idempotency_key`, payload normalizado exato, resultado e `created_at`;
- FKs com `ON DELETE RESTRICT` e imutabilidade do ledger.

### Colunas, backfill e constraints

Adicionar `supplier_order_items.ready_quantity integer`. Na mesma transação:

1. criar a coluna inicialmente nullable;
2. preencher todas as linhas com `picked_quantity`;
3. validar que nenhuma linha viola as invariantes atuais;
4. tornar `ready_quantity not null` e definir default seguro para novas linhas;
5. adicionar constraints `ready_quantity >= picked_quantity` e `ready_quantity + cancelled_quantity <= ordered_quantity`;
6. não criar nenhuma autorização de Pedido no backfill.

Nenhum Pedido antigo ou novo é publicado automaticamente. O trigger de perfil deve passar a default deny, mas desabilitar signup público é uma alteração remota separada e continua não autorizada.

### Índices

- PK/unique por `safisa_portal_members.user_id`;
- índice parcial para membros ativos;
- PK/unique por `safisa_order_authorizations.supplier_order_id` e índice parcial para autorizações ativas;
- índice parcial em `supplier_order_items(supplier_order_id, id)` quando `ready_quantity > picked_quantity`;
- índice de eventos por `(supplier_order_id, supplier_order_item_id, created_at desc)`;
- unique por `(actor_user_id, idempotency_key)` quando a chave não for nula.

### RLS e grants

- habilitar e forçar RLS nas novas tabelas quando aplicável;
- negar acesso direto a `anon`, `PUBLIC` e clientes autenticados;
- não conceder `INSERT`, `UPDATE` ou `DELETE` direto;
- contas Safisa acessam dados somente por wrappers públicos de contrato fechado;
- wrappers públicos `SECURITY DEFINER`, `search_path` vazio e referências qualificadas;
- workers privados `SECURITY INVOKER`, `search_path` vazio e sem `EXECUTE` para clientes;
- guard privado deriva identidade exclusivamente de `auth.uid()`, exige membership ativo e nome cadastrado;
- perfis Safisa continuam incapazes de executar RPCs internas de Pedido, retirada, entrada ou Estoque.

### RPCs fixas

- listar Pedidos autorizados com paginação e projeção mínima;
- carregar detalhe e histórico seguro de um Pedido autorizado;
- incrementar unidades prontas com delta positivo e chave idempotente;
- corrigir o total pronto com justificativa, confirmação, `expected_updated_at` integral e chave idempotente;
- publicar/revogar Pedido por usuário interno autorizado em operação separada;
- consultar o alerta interno de unidades prontas ainda não retiradas.

Nenhuma RPC aceita nome de tabela, nome de função, usuário ou autoridade escolhidos pelo navegador. Incremento e correção bloqueiam Pedido e linhas deterministicamente, revalidam autorização e gravam evento na mesma transação.

### Endurecimento das operações internas

- retirada unitária e parcial limitadas a `ready_quantity - picked_quantity`;
- “Retirar tudo que está pronto” calcula e bloqueia todas as linhas elegíveis na transação;
- edição impede reduzir quantidade abaixo de `ready_quantity + cancelled_quantity`, remover ou trocar linha com prontidão;
- cancelamento separado alcança somente `ordered_quantity - cancelled_quantity - ready_quantity`;
- nenhuma operação reduz `ready_quantity` implicitamente;
- correção justificada é o único caminho para reduzir prontidão, nunca abaixo de `picked_quantity`;
- finalização/encerramento bloqueia novas atualizações Safisa, preservando leitura enquanto autorizado;
- entrada no Estoque permanece baseada somente em `picked_quantity - stocked_quantity`.

### Plano de testes obrigatório

- isolamento: conta Safisa não lê nem chama rotas/RPCs internas; conta interna não ganha acesso implícito ao portal;
- autorização: Pedido não publicado é invisível; publicação habilita; revogação bloqueia sem apagar histórico;
- idempotência: mesmo usuário/chave/payload retorna replay; payload diferente é rejeitado; usuários diferentes não colidem;
- concorrência: dois incrementos simultâneos acumulam; correção concorrente falha por versão; retirada concorrente não excede prontidão;
- invariantes: prontidão nunca abaixo do retirado nem acima do total não cancelado;
- cancelamento/edição: unidades prontas não são removidas ou alteradas silenciosamente;
- auditoria: cada mudança registra exatamente o ator, snapshots, antes, delta, depois e modo;
- permissões: `anon`/`PUBLIC` sem acesso e workers privados inacessíveis aos clientes;
- rollback: qualquer falha deixa prontidão, eventos e Pedido inalterados.

### Fases de implantação

1. revisão humana desta especificação e autorização para criar SQL — concluída;
2. criação local da migration, sem aplicação remota — concluída;
3. revisão estática, duas reconstruções por baseline e testes dinâmicos locais
   A–H, incluindo cinco disputas com duas conexões — concluída nesta branch;
4. revisão humana do PR #5 e aplicação remota controlada da fundação e da
   transição legado — concluídas;
5. implementação do Portal Safisa MVP — concluída nesta branch e aguardando
   revisão humana;
6. configuração remota separada para desabilitar signup, se novamente autorizada;
7. provisionamento administrativo, publicação gradual do primeiro Pedido e
   validação autenticada do piloto — dependem de autorização posterior.

O escopo consolidado da migration inclui:

1. associação de membros Safisa e autorização de Pedidos;
2. default seguro de novos perfis;
3. `ready_quantity`, backfill, constraints e índices;
4. views/retornos internos com prontidão e alertas;
5. ledger de auditoria e idempotência;
6. RPCs fechadas de leitura, incremento e correção;
7. endurecimento das RPCs de retirada, edição e cancelamento;
8. RLS, grants/revokes, comments e testes defensivos.

Desabilitar cadastro público é uma alteração de configuração do Supabase Auth separada da migration. A decisão futura está aprovada, mas a mudança remota ainda não está autorizada.

## Índices e performance

- PK por `user_id` em membros;
- índice/unique por `supplier_order_id` em autorizações ativas;
- índice parcial em linhas com `ready_quantity > picked_quantity` por Pedido;
- índice de eventos por Pedido/linha/data;
- paginação server-side e limites explícitos;
- leituras agrupadas, sem catálogo completo e sem N+1.

## Riscos residuais

| Risco | Classificação | Mitigação |
|---|---|---|
| Conta Safisa herdar acesso interno | Crítico | perfil interno inativo, membership separado e testes negativos de todas as RPCs |
| Cadastro público criar perfil ativo | Crítico | default deny e decisão sobre desabilitar signup |
| Incrementos simultâneos perderem unidades | Crítico | lock de linha e soma sobre o valor relido |
| Correção sobrescrever incremento recente | Crítico | `expected_updated_at` sob lock |
| Retirada exceder quantidade pronta | Crítico | constraint e endurecimento das RPCs oficiais |
| Cancelamento invalidar prontidão | Alto | regra explícita e validação transacional |
| Vazamento de notas/eventos internos | Alto | RPCs de leitura com projeção mínima; sem SELECT direto do portal |
| Replay ou clique duplo | Alto | ledger idempotente por usuário/chave |
| Alertas desatualizados | Médio | revalidação após mutação e ao focar/navegar |

## Decisões humanas aprovadas

1. DEC-SAF-001: contas individuais, provisionamento administrativo, membership próprio e ativação/desativação individual; conta Safisa não é perfil interno.
2. DEC-SAF-002: signup público será desabilitado futuramente; mudança remota ainda não autorizada; contas administrativas.
3. DEC-SAF-003: publicação/revogação explícita; nenhum Pedido publicado automaticamente; auditoria preservada.
4. DEC-SAF-004: incremento atômico/idempotente; correção absoluta justificada, confirmada, versionada e auditada, inclusive por usuário interno autorizado.
5. DEC-SAF-005: “Retirar tudo que está pronto” alcança somente o pronto ainda não retirado, com validação transacional e retirada parcial preservada.
6. DEC-SAF-006: cancelamento silencioso de unidades prontas bloqueado; somente o saldo ainda não pronto pode ser cancelado separadamente.
7. DEC-SAF-007: encerrados somente leitura enquanto autorizados; revogação remove acesso sem apagar dados/auditoria.
8. DEC-SAF-008: `/safisa` no mesmo deploy, com layout, navegação, guards e autorização server-side/banco separados.
9. DEC-SAF-009: ausência de `safisa_order_authorizations` identifica Pedido legado; sua retirada autoavança `ready_quantity` até `picked_quantity`; a primeira publicação muda o regime permanentemente e revogação não restaura o comportamento legado.

## MIG-SAF-003 — transição segura de Pedidos legados

O gate de implantação da MIG-SAF-001 encontrou Pedidos ativos ainda não
gerenciados pelo portal. Para evitar interrupção operacional, a migration
incremental `20260807091653_safisa_legacy_order_transition.sql` preserva os
workers e wrappers existentes e altera somente a relação entre retirada,
prontidão e existência da autorização.

- sem autorização: a retirada usa os limites históricos e eleva
  `ready_quantity` atomicamente quando `picked_quantity` avança;
- com autorização existente: `picked_quantity` nunca ultrapassa
  `ready_quantity`, mesmo depois de revogação;
- nenhuma autorização, membership ou evento Safisa é criado pelo autoavanço;
- “retirar tudo” usa o saldo válido histórico no legado e somente o pronto no
  regime Safisa-managed;
- publicação e retirada compartilham o lock do Pedido, eliminando a janela de
  transição concorrente;
- alertas Safisa continuam excluindo Pedidos que nunca tiveram autorização.

A migration foi validada apenas em Supabase Local com fixtures agregadas e sem
identificadores reais, incluindo publicação irreversível, revogação, cinco
cenários concorrentes com duas conexões e duas reconstruções independentes.
MIG-SAF-001 permanece imutável. A aplicação remota controlada ocorreu somente
para MIG-SAF-001 e MIG-SAF-003; este MVP não executou escrita remota.

MIG-SAF-001 e MIG-SAF-003 foram revisadas, mescladas e aplicadas remotamente em
protocolo controlado. A alteração remota de signup permanece uma autorização
operacional separada e ainda não faz parte do Portal MVP.

## NK-SAF-002 — Portal Safisa MVP

Com a fundação e a transição legado aplicadas, o MVP foi implementado na branch
`agent/safisa-portal-ui` e está disponível para revisão no
[#9](https://github.com/henriqueskm/projeto-estoque/pull/9) (draft):

- login separado em `/safisa/login`, sem ativar acesso interno;
- guard server-side baseado na sessão real e no contrato das RPCs Safisa;
- experiência própria em `/safisa`, sem sidebar, Estoque ou Assistente;
- lista e detalhe limitados a Pedidos explicitamente autorizados;
- incremento de novas unidades prontas e ação confirmada para todo o restante;
- correção secundária com justificativa, confirmação e versão otimista;
- chave idempotente criada uma vez por confirmação e bloqueio síncrono contra
  double-submit;
- Pedidos encerrados somente leitura e revogados invisíveis;
- layout mobile-first e acessível, validado de 320 a 1440 px.

Toda validação mutável usou fixtures fictícias no Supabase Local. Nenhuma conta,
membership, autorização, prontidão, Pedido, Estoque, migration ou configuração
remota foi alterada durante a implementação.

## Plano por fases e estimativa relativa

| Fase | Entrega | Tamanho relativo | Dependência |
|---|---|---:|---|
| 0 | threat model final e aprovação da MIG-SAF-001 documental | S | decisões DEC-SAF aprovadas |
| 1 | migration atômica de identidade, prontidão, auditoria, RLS e RPCs | XL | Fase 0 |
| 2 | testes locais/SQL de isolamento, concorrência, replay e invariantes | L | Fase 1 |
| 3 | portal Safisa autenticado e responsivo | L | Fases 1–2 |
| 4 | alertas e regras de retirada no aplicativo principal | M | Fases 1–2 |
| 5 | validação visual autenticada e testes concorrentes controlados | L | Fases 3–4; aprovação humana |
| 6 | piloto, observabilidade sanitizada e rollout | M | smoke tests aprovados |

Estimativa total relativa: **XL**, dominada por segurança de identidade, migration transacional e testes de concorrência, não pela interface.

## Conclusão

O domínio de Pedidos e as RPCs Safisa agora fornecem a base necessária ao Portal
Safisa. O MVP foi implementado e validado somente contra fixtures locais; contas
Safisa reais, memberships, publicação de Pedidos e o piloto continuam dependentes
de provisionamento administrativo e revisão humana posterior.

## NK-SAF-003 — ciclo automático por Pedido

DEC-SAF-010 supersede as decisões anteriores de publicação explícita e de
transição legado (DEC-SAF-003 e DEC-SAF-009), que permanecem neste documento
somente como histórico da implantação inicial. Safisa é o único fornecedor:
todo `supplier_order` é automaticamente Safisa-managed, sem criar ou consultar
uma linha de `safisa_order_authorizations` para decidir visibilidade, alertas ou
retirada. A tabela e suas RPCs de publicação/revogação permanecem deprecadas por
compatibilidade e auditoria, sem apagar seus registros históricos.

O Portal usa os leitores semânticos `list_safisa_orders` e
`get_safisa_order`. Um Pedido não cancelado fica **Em andamento** quando
`waiting_pickup_quantity > 0` e fica **Concluído** (somente leitura) quando esse
valor é zero; `stocked_quantity` não altera essa classificação. Pedidos
cancelados não aparecem no Portal e permanecem no histórico interno.

A prontidão é estrita para todos os Pedidos: `picked_quantity <= ready_quantity`.
O botão interno “Retirar tudo que está pronto” limita-se ao pronto ainda não
retirado. “Excluir pedido” é um cancelamento lógico auditado (DEC-SAF-011), exige
motivo e nunca faz `DELETE` físico; ele é bloqueado enquanto houver
`ready_quantity > picked_quantity`, para que unidades prontas não sejam
descartadas silenciosamente.

MIG-SAF-004 é incremental sobre MIG-SAF-001 e MIG-SAF-003, não cria
autorizações, memberships, eventos ou backfill operacional de prontidão. A
validação foi executada apenas em Supabase Local com fixtures fictícias,
incluindo quatro disputas PostgreSQL reais. Nenhuma mutação remota ocorreu.
