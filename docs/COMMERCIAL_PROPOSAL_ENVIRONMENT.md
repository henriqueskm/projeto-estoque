# Proposta comercial privada — variáveis de ambiente

Configure as variáveis abaixo no ambiente local usado para a proposta e em cada ambiente da Vercel que deverá permitir o acesso à área comercial. Elas são exclusivas de `/apresentacao/proposta` e não substituem nem alteram o login operacional.

| Variável | Finalidade |
| --- | --- |
| `NK_PROPOSAL_USERNAME` | Usuário da proposta comercial. |
| `NK_PROPOSAL_PASSWORD` | Senha da proposta comercial. |
| `NK_PROPOSAL_SESSION_SECRET` | Segredo usado para assinar a sessão comercial. Use uma string aleatória forte, com pelo menos 32 caracteres. |

Não use o prefixo `NEXT_PUBLIC_` nessas variáveis. Não registre os valores em arquivos versionados, screenshots, logs ou mensagens de erro.

Para validar em Preview, configure valores de teste somente no ambiente Preview. Em Produção, configure as credenciais comerciais aprovadas e um segredo de sessão exclusivo.
