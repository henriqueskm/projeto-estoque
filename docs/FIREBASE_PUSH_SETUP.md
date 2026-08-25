# Firebase Cloud Messaging — Safisa pronta

O Firebase é usado somente como canal opcional de Web Push para o evento
`SAFISA_FULLY_READY`. Supabase continua responsável por autenticação, perfis,
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
- Push externo existe somente para `FULLY_READY`.
- Falha, timeout, quota ou configuração ausente do Firebase nunca reverte uma
  atualização Safisa.
- Tokens inválidos retornados pelo FCM são desativados sem serem registrados em
  logs.
- O service worker raiz continua sendo `/sw.js`; não crie
  `firebase-messaging-sw.js` concorrente.
