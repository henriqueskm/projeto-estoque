# Gerenciamento seguro do catálogo físico — Issue #95

Base: `81a424d0080610cc0c2d0cfd8767f41740f8059b` (main atualizada).

## Escopo V1

Na tela Estoque, `+` cadastra na categoria física selecionada e o menu de cada
item permite **Editar código/descrição** e **Excluir produto**. As quatro
categorias são fixas: SERVO, INSTALLATION_KIT, REPAIR_KIT e LOOSE_PART.
Não há reclassificação de categoria nem edição de modelo/subtipo existente.

- Cadastro inicia com mínimo/saldo zero, sem balance row, lote ou movimento.
  SERVO exige modelo; cada tipo recebe seu subregistro correto. Compatibilidades
  de reparo são selecionadas explicitamente entre Servos ativos, nunca inferidas.
- Edição altera somente `items.code`/`description`/`updated_at`. IDs, subtipos,
  modelo, saldos e snapshots de Pedidos/movimentos existentes não são reescritos.
  A auditoria privada registra código/descrição anteriores e posteriores.
- Exclusão é inativação, nunca DELETE físico. Se houver saldo livre positivo,
  a correção até zero é ADJUSTMENT/MANUAL, não venda/OUTBOUND.
- Configurações, receitas (mesmo sem saldo), compatibilidades, aplicações e
  Pedidos ativos ou com retirada/entrada pendente impedem exclusão. Referências
  históricas de Pedidos encerrados e sem pendências permanecem válidas.
- Saldo livre, montado e embutido não foram redefinidos. Nenhum componente
  montado/embutido pode ser apagado por este fluxo.

## Banco / atomicidade / concorrência

Migration nova: `20261022191356_physical_catalog_management.sql`.
**Somente criada no Git e aplicada ao PostgreSQL descartável local. Não aplicada
ao Supabase remoto.** Nenhuma migration histórica foi editada.

RPCs autenticadas:

- `get_physical_catalog_item_preview(uuid)`: leitura fresca de metadata, saldo,
  token de versão e contadores de dependências. Também permite verificar um
  item já inativo após commit.
- `manage_physical_catalog(jsonb, uuid)`: CREATE / EDIT / ARCHIVE, sem identidade
  de usuário fornecida pelo cliente. Reutiliza a autorização canônica de perfil
  ativo com nome cadastrado, `auth.uid()`, `search_path = ''`, workers privados e
  EXECUTE mínimo para authenticated. Anon sem EXECUTE; helpers privados sem
  EXECUTE para clientes; ledger com RLS e sem leitura/escrita direta.

O ledger imutável `private.physical_catalog_requests` reserva a identidade lógica
por usuário + chave, guarda request/result, autor/nome, horário e snapshot anterior.
Replays iguais retornam o receipt já persistido; payload diferente é rejeitado.
O writer central `lib/catalog-writer.ts` encaminha estas operações à RPC: replay
precisa ocorrer **antes** de rejeitar colisão com o próprio produto recém-criado.
O banco continua usando `catalog_code_write_policy` e o trigger/locks da política
unificada de items/configuration codes/bundle codes, inclusive regras INV.

Ordem: autorização → lock da tentativa → locks de namespace ordenados quando
necessários → metadata do item (`FOR NO KEY UPDATE`) → balance (`FOR UPDATE`).
Compatibilidades de novos reparos bloqueiam Servos em ordem de UUID. Não são
adquiridos locks de Pedidos após o lock de item: a verificação de dependências lê
o estado comprometido; os writers de Pedido resolvem o catálogo `FOR SHARE`.
Isso preserva sua hierarquia Pedido → linhas → metadata → balances.

A versão inclui metadata e `stock_balances.updated_at`/quantity, detectando também
mudança de saldo que depois volta ao mesmo número (ABA). Linha de saldo ausente
é materializada em zero **somente ao arquivar**, para serializar também writers
legados; uma inserção concorrente é relida e invalida a versão antiga.

Com saldo positivo, `private.adjust_inventory_stock_checked` executa **dentro da
mesma transação** com chave filha interna única. A inativação e o receipt são
comprometidos juntos. Saldo zero não cria ajuste, lote ou movimento vazio. Uma
falha após a correção desfaz saldo, lote, movimento, ledger e inativação.

O trigger `stock_balance_active_catalog_guard` impede saldo positivo em item
inativo, inclusive pelo ajuste absoluto legado. Não adquire locks de metadata
depois do balance (evita inversão). A exclusão sempre bloqueia/materializa esse
balance antes de inativar. Cenários concorrentes reais verificaram os dois
vencedores contra Entrada, Saída, Ajuste, criação de Pedido e Entrada legada.
Não há correção automática de dados preexistentes.

ACLs de items/subtipos/stock_balances explicitam SELECT para authenticated e
removem escrita/TRUNCATE direta dos clientes; RLS permanece ativa. Nenhum writer
canônico foi substituído. Identidade e autoria continuam derivadas no servidor.

## UI, confirmação e cache

Abrir edição/exclusão busca nova prévia no servidor. Antes do submit há revisão
explícita de código, descrição, saldo e vínculos. Stale bloqueia a confirmação e
exige **Atualizar prévia**. Resultado incerto bloqueia edição e reutiliza a mesma
request/chave em **Verificar tentativa**; não há retry automático com chave nova.

Após a RPC, a ação invalida o catálogo estrutural e relê o produto sem cache.
Somente receipt válido + releitura consistente permitem sucesso. Erro de leitura
pós-commit é tratado como resultado incerto, não como falha definitivamente sem
commit. Metadata concorrente divergente também impede falso sucesso.
O feedback pertence ao workspace, não à linha removida; permanece visível após
arquivamento e é descartado pelo cleanup de Effect quando Activity oculta a rota.

Revalida Estoque, Relatório, Entrada, Saída, Assistente, Pedidos e Aplicações.
Saldos operacionais não recebem cache novo. Workspace schema v1, filtros, busca,
accordions, scroll, writers de estoque, Semantic Back e Instant Navigation não
foram alterados. Os diálogos usam o gate de mutation e transientes já existentes:
Back fecha, Forward não restaura confirmação, Activity não ressuscita o modal.

## Continuidade comercial / códigos / reset

Esta V1 **não** oferece criação/edição/exclusão de configurações ou conjuntos.
Uma PR futura deverá separar aliases de identidade física, mostrar impacto em
Pedidos abertos e validar inativação dos aliases compartilhados. Não poderá mudar
`servo_id`/`installation_kit_id` nem receita usada; alterações de composição exigem
nova definição aprovada. As ações comerciais existentes continuam iguais.

Reativação fica para fluxo futuro que preserve o mesmo ID. O código atual de item
inativo permanece protegido pelo namespace existente para impedir reutilização
ambígua de identidade. Ao renomear, o código antigo não fica artificialmente
reservado; continua identificável no snapshot imutável da auditoria. Nenhum
snapshot histórico é reescrito para o código novo.

O ledger é histórico estrutural do catálogo, com FK RESTRICT para item, e deve
acompanhar backup completo do schema private. A referência ao lote de ajuste
fica no receipt imutável, sem FK para um lote operacional apagável por reset
autorizado. Guards antigos de reset não foram enfraquecidos: schema/FKs novos
invalidam contratos antigos; qualquer reset futuro exige nova revisão/backup e
contrato aprovado. O FK impede DELETE físico de item auditado.

## Evidência reproduzível

```powershell
# Container próprio já criado com label nk.disposable=nk-issue95 e --network none.
# Não usar banco/URL de produção nem o container de baseline como destino.
node scripts/setup-physical-catalog-test.mjs
node tests/physical-catalog-management.local.mjs
node --experimental-strip-types --experimental-loader ./tests/physical-catalog-management-loader.mjs --test tests/physical-catalog-management.test.mjs
node tests/physical-catalog-management.browser-fixture.mjs
```

O setup verifica label/rede do destino antes de recriar **somente** `nk95_test`,
restaura schema sem dados do baseline e usa catálogo estrutural versionado. A
suíte limpa exclusivamente seu DB descartável e cria usuários/produtos sintéticos.
Testes não dependem de credenciais, não acessam hosts remotos e usam timeout curto
nas corridas. São **32 SQL + 15 app/UI** novos; Inventory/bundle/busca (98) e
catálogo/Workspace/Activity/Semantic Back/Instant Navigation/layout/reset (196)
também passaram: **341 testes**, sem falhas ou skips. TypeScript e ESLint sem
warnings; diff-check, Webpack e build padrão Next passaram.

Smoke local executado com o componente real em Chrome/CUA, com ações fake
**somente no harness**, nunca na aplicação. Mobile 320/375, tablet 768 e desktop
1440 sem overflow horizontal. Verificados foco inicial após prévia assíncrona,
Shift+Tab/Escape, Back/Forward (sem reabrir confirmação), Activity (fecha modal e
preserva grupo), criação/revisão/cancelamento, exclusão com feedback sobrevivendo
à remoção da linha, bloqueio por receita, stale com confirmação desabilitada,
resultado incerto + verificação da mesma tentativa e texto de 120/500 caracteres
com saldo máximo PostgreSQL. Nenhum console error/warning no harness. A primeira
rodada encontrou foco perdido após load e feedback desmontando junto da linha;
ambos corrigidos e confirmados no navegador. Não foi criado motion novo.
Screenshots temporárias e dados de sessão não são commitados.

Limitações: o Preview não pode testar CRUD real enquanto a migration não for
aplicada por humano em ambiente autorizado. Não é permitido testar essas mutações
contra produção. Emulação não comprova teclado/safe areas em aparelho físico.
