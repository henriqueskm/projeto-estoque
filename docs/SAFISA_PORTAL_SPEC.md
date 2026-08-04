# NK-SAF-001 — Auditoria e especificação do Portal da Safisa

- **Prioridade:** alta para o piloto comercial
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** C/D — exige migration/RPC e decisões humanas antes da implementação
- **Projeto auditado:** `isdjboconmwaqipjrjvp`
- **Data da auditoria:** 2026-08-04

## Escopo e premissas aprovadas

Existe um único fornecedor, Safisa. Cada pessoa da Safisa terá uma conta individual. Todas as contas ativas poderão consultar os Pedidos explicitamente autorizados e registrar, de forma concorrente e auditável, quantidades prontas por item.

A quantidade pronta será cumulativa: inclui unidades já retiradas e nunca poderá ficar abaixo de `picked_quantity`. A retirada continuará exclusiva do aplicativo interno; a entrada no Estoque continuará sendo uma operação posterior e separada. O portal não poderá criar ou editar Pedido, negociação, catálogo, retirada, entrada ou saldo.

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

## Impactos obrigatórios nas operações atuais

- Retirada unitária deve rejeitar `picked_quantity > ready_quantity`.
- “Marcar tudo como retirado” deve operar somente sobre unidades prontas ou ser bloqueado até o Pedido estar completamente pronto, conforme decisão humana.
- Edição não pode reduzir quantidade pedida abaixo de pronta+cancelada, remover linha com prontidão ou trocar sua identidade física.
- Cancelamento não pode invalidar prontidão existente; o tratamento de unidades prontas ainda não retiradas exige decisão humana.
- Finalização e revogação de acesso precisam definir se a Safisa mantém consulta histórica.
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

## Migrations necessárias

Recomendação: uma migration atômica e integralmente revisada para evitar estado intermediário inseguro, contendo:

1. associação de membros Safisa e autorização de Pedidos;
2. default seguro de novos perfis;
3. `ready_quantity`, backfill, constraints e índices;
4. views/retornos internos com prontidão e alertas;
5. ledger de auditoria e idempotência;
6. RPCs fechadas de leitura, incremento e correção;
7. endurecimento das RPCs de retirada, edição e cancelamento;
8. RLS, grants/revokes, comments e testes defensivos.

Desabilitar cadastro público é uma alteração de configuração do Supabase Auth, separada da migration, e exige aprovação específica.

## Índices e performance

- PK por `user_id` em membros;
- índice/unique por `supplier_order_id` em autorizações ativas;
- índice parcial em linhas com `ready_quantity > picked_quantity` por Pedido;
- índice de eventos por Pedido/linha/data;
- paginação server-side e limites explícitos;
- leituras agrupadas, sem catálogo completo e sem N+1.

## Riscos

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

## Decisões humanas necessárias

1. Aprovar default deny para novos perfis e o processo administrativo de criação/ativação das contas.
2. Decidir se o cadastro público será desabilitado no Supabase Auth.
3. Aprovar autorização explícita por Pedido e o backfill inicial sem Pedidos publicados.
4. Definir se correções de total exigem justificativa obrigatória e quem pode realizá-las.
5. Definir “Marcar tudo como retirado”: retirar somente o pronto ou bloquear até tudo estar pronto.
6. Definir o tratamento de unidades prontas ainda não retiradas ao cancelar saldo/Pedido.
7. Definir acesso da Safisa a Pedidos finalizados, cancelados ou com autorização revogada.
8. Confirmar `/safisa` no mesmo deploy como endereço do piloto.

## Plano por fases e estimativa relativa

| Fase | Entrega | Tamanho relativo | Dependência |
|---|---|---:|---|
| 0 | decisões humanas e threat model final | S | aprovação deste documento |
| 1 | migration atômica de identidade, prontidão, auditoria, RLS e RPCs | XL | Fase 0 |
| 2 | testes locais/SQL de isolamento, concorrência, replay e invariantes | L | Fase 1 |
| 3 | portal Safisa autenticado e responsivo | L | Fases 1–2 |
| 4 | alertas e regras de retirada no aplicativo principal | M | Fases 1–2 |
| 5 | validação visual autenticada e testes concorrentes controlados | L | Fases 3–4; aprovação humana |
| 6 | piloto, observabilidade sanitizada e rollout | M | smoke tests aprovados |

Estimativa total relativa: **XL**, dominada por segurança de identidade, migration transacional e testes de concorrência, não pela interface.

## Conclusão

O domínio de Pedidos é uma base forte, mas o Portal Safisa não pode ser implementado apenas na aplicação. A classificação é C/D: exige migration/RPC e decisões humanas. Nenhuma migration, função ou dado remoto foi alterado nesta auditoria.
