# Firebase Cloud Messaging — Safisa pronta

O Firebase é usado somente como canal opcional de Web Push para o evento
`SAFISA_FULLY_READY` e `SAFISA_ITEM_READY`. Supabase continua responsável por autenticação, perfis,
Pedidos, auditoria e persistência. Este projeto não usa Firebase Auth,
Firestore, Storage, Analytics ou Remote Config.

## 1. Criar e preparar o projeto Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Adicione um Web App e copie apenas a configuração pública desse app.
3. Em **Cloud Messaging**, habilite a API necessária ao FCM Web.
4. Em **Web Push certificates**, gere uma chave VAPID.
5. Em **Project settings > Service accounts**, gere uma credencial exclusiva
   para o backend. Não salve o JSON no repositório.

Referências oficiais:

- [Configurar FCM para Web](https://firebase.google.com/docs/cloud-messaging/web/get-started)
- [Receber mensagens Web](https://firebase.google.com/docs/cloud-messaging/web/receive-messages)
- [Enviar com o Admin SDK](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)
- [Gerenciar registros por Firebase Installation ID](https://firebase.google.com/docs/cloud-messaging/manage-tokens)

## 2. Variáveis públicas

Configure localmente e no ambiente da Vercel:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_VAPID_KEY
```

Esses valores identificam o Web App Firebase e a chave VAPID pública. Nunca
use prefixo `NEXT_PUBLIC_` em credenciais administrativas.

## 3. Variáveis exclusivas do servidor

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Na Vercel, `FIREBASE_PRIVATE_KEY` pode conter quebras de linha escapadas como
`\n`; o helper server-side as normaliza. Não imprima essas variáveis e não as
grave em arquivos versionados.

## 4. Aplicar a migration após revisão

A migration preparada é:

```text
20260825113000_safisa_fully_ready_push_notifications.sql
20261006104415_safisa_item_ready_push_notifications.sql
```

Ela deve ser revisada e aplicada pelo protocolo remoto controlado do projeto.
Não use `migration repair`, `--include-all` ou seed remoto.

## 5. Validar um dispositivo

1. Acesse o NK autenticado com um perfil interno ativo.
2. Abra o sino de retiradas Safisa.
3. Toque em **Ativar notificações**. A permissão nunca é pedida ao carregar a
   página.
4. Confirme que o painel informa que o dispositivo está ativado.
5. Use somente fixture/local ou um teste operacional autorizado para produzir
   `SAFISA_FULLY_READY`.
6. Toque no push e confirme que `/pedidos?order=<uuid>` abre no mesmo NK.
7. Use **Desativar** e confirme que apenas esse dispositivo deixa de receber.

No iPhone/iPad, instale primeiro o PWA na Tela de Início e abra-o em modo
standalone. Fora desse modo, o NK mostra a instrução de instalação sem pedir
permissão inutilmente.

## 6. Operação e diagnóstico

- O sino interno continua sendo a fonte de verdade e também mostra estados
  parcialmente prontos.
- Push externo existe para pedido totalmente pronto e incrementos individuais
  de linha. Correção não gera push de item; a ação final gera apenas o push de pedido.
- Falha, timeout, quota ou configuração ausente do Firebase nunca reverte uma
  atualização Safisa.
- O navegador registra o dispositivo por Firebase Installation ID (FID) usando
  `register`/`onRegistered`; o servidor envia por `fids`, sem depender do fluxo
  legado `getToken`/`deleteToken`.
- Um FID renovado é sincronizado com o backend e atualiza `last_seen_at` sem
  duplicar a inscrição do dispositivo.
- Instalações explicitamente não registradas pelo FCM são desativadas sem
  registrar o identificador em logs. Erros genéricos como `INVALID_ARGUMENT`
  não removem inscrições automaticamente.
- O service worker raiz continua sendo `/sw.js`; não crie
  `firebase-messaging-sw.js` concorrente.

## 7. Prontidão por linha — PR #82

| Ação canônica | Evento de push da ação |
| --- | --- |
| Incremento individual, inclusive restante da linha, sem concluir o pedido | `SAFISA_ITEM_READY` |
| Incremento individual que conclui o pedido | Somente `SAFISA_FULLY_READY` |
| Concluir todo o pedido (`mark_safisa_order_remaining_ready`) | Somente um `SAFISA_FULLY_READY` |
| Correção, inclusive positiva | Nenhum `SAFISA_ITEM_READY`; transição FULLY_READY existente preservada |
| Cancelamento que completa semanticamente o pedido | Comportamento FULLY_READY existente preservado |

O gatilho de INSERT no ledger imutável aceita somente
`READY_QUANTITY_INCREMENTED`. Copia código/descrição da linha oficial e o
`quantity_delta` da operação, não o total acumulado. O worker de quantidade e
o mark-all não são reescritos. O wrapper autenticado acrescenta o
`portal_event_id` ao resultado, inclusive em replay; autoria continua derivada
da sessão e da membership ativa.

`push_notification_events` mantém RLS e ausência de acesso direto do cliente.
A unicidade FULLY_READY continua por pedido, agora em índice parcial.
ITEM_READY possui unicidade por `portal_event_id`, FK RESTRICT para o evento
canônico e para a linha, snapshots e delta positivo obrigatórios. Nenhum evento
histórico é retroativamente notificado.

Exemplos de mensagens:

```text
SAFISA_FULLY_READY
Pedido pronto para retirada ✅
Pedido 40959 está completamente pronto na Safisa.

SAFISA_ITEM_READY
Item pronto no pedido 40959 ✅
Cód. 1H — SERVO MBF-025 — 3 unidades prontas.
```

FCM recebe apenas strings em `data`; ITEM_READY inclui `type`, `eventId`,
`supplierOrderId`, `supplierOrderItemId`, `negotiationNumber`, `code`,
`description` e `quantity`, além de título/corpo e URL interna. Código e
descrição são convertidos em texto simples e limitados a 80/300 caracteres
Unicode na entrega; os snapshots completos permanecem na fila. O worker
rejeita payload inválido, HTML, UUID inválido, tipo desconhecido ou destino
externo de item e deriva `/pedidos?order=<id>` de um UUID validado. A tag de
ITEM_READY usa o ID do evento, nunca somente o pedido. FULLY_READY mantém
texto, tag e comportamento anteriores. Foreground atualiza o mesmo listener
de alertas/pedidos para ambos os tipos.

Claim/complete permanecem exclusivos de service_role. O claim individual
considera a origem exata, não outro evento pendente daquele pedido. SKIP LOCKED,
três tentativas, recuperação de SENDING após dez minutos, timeout FCM de oito
segundos, chunks de 500 e estados SENT/FAILED/NO_RECIPIENTS são preservados.
O número da tentativa protege a conclusão contra um worker de lease expirado,
inclusive nos claims FULLY_READY atualizados. Destinatários continuam sendo
dispositivos habilitados de perfis internos ativos; membership Safisa não cria
destinatário interno. FIDs nunca são enviados ao cliente nem registrados em logs.

A operação e seu evento durável são atômicos; retry com a mesma chave não cria
outro incremento/evento/push. Uma nova chave legítima produz um novo delta.
Não há promessa de exactly-once do transporte FCM: resposta perdida depois de
entrega pode levar a retry do mesmo evento/tag. Não foi criado cron/worker novo;
configuração ausente deixa PENDING e falhas conservam o registro para o retry
existente. Falha de entrega não muda o sucesso da operação Safisa.

Reset/backup: o dump lógico completo já inclui todas as colunas e ambos os
tipos. O reset já apaga toda a fila antes do ledger Safisa/linhas/pedidos,
compatível com as novas FKs. O contrato histórico da PR #68 **não foi
atualizado nem enfraquecido**: novo schema/migrations continuam exigindo uma
auditoria e contrato explícitos antes de qualquer reset futuro. O fixture de
transporte gera identidade de migrations somente para teste mock, sem alterar
fingerprints PRE/POST ou autorizar transporte real.

Validação local: `npm run test:safisa-push` e
`npm run test:safisa-push:local` (container dedicado
`supabase_db_nk_pr82_push`, label `nk.disposable=nk-pr82-push`, sem porta remota).
O ensaio prova deltas 3/2, replay, restante da linha, correção, última linha,
mark-all com três linhas 2/3/1 e um único FULLY_READY, cancelamento, concorrência,
SKIP LOCKED, lease fencing, grants/RLS e ordem de exclusão do reset em rollback.
Nenhuma migration ou operação de prontidão/estoque deve ser executada no remoto
para validar o Preview sem autorização humana separada. Antes da migration,
a aplicação mantém o caminho FULLY_READY existente; ITEM_READY começa somente
após aplicação autorizada da migration e publicação da aplicação/worker.

NOTE de ambiente local: a suíte legada `safisa-portal-migration.local.mjs`
chegou ao check H e falhou esperando ausência de UPDATE direto em
`supplier_orders`. O container-fonte local já possuía esse grant antes da PR
(`has_table_privilege` confirmou o mesmo resultado no fonte e no clone).
Não foi alterado esse fixture-fonte nem inferido o estado do remoto. A suíte
dedicada de push valida os grants/RLS da fila e novas RPCs; a suíte SQL de
lifecycle automático A–O e seus quatro cenários concorrentes passou.
