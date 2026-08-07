# Objetivo atual

- **ID:** NK-SAF-002
- **Título:** Portal Safisa MVP
- **Prioridade:** crítica para entrega do piloto
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** B — aplicação sobre RPCs oficiais já implantadas
- **Branch de execução:** `agent/safisa-portal-ui`
- **Pull request:** [#9](https://github.com/henriqueskm/projeto-estoque/pull/9) (draft)
- **Base:** `origin/main` no merge aprovado `da2b4cbad325344ddfade4f5ed4ef0d1261dc02a`
- **Dependências:** MIG-SAF-001 e MIG-SAF-003 aplicadas no Supabase remoto

## Entrega implementada

- `/safisa/login` usa o Supabase Auth existente e valida membership Safisa sem
  exigir `profiles.is_active = true`;
- `/safisa` possui layout próprio, guard server-side e não expõe navegação da
  aplicação interna;
- lista e detalhe consomem apenas `list_safisa_authorized_orders` e
  `get_safisa_authorized_order`;
- incremento e “marcar restante” usam somente
  `increment_safisa_ready_quantity`, com delta positivo e idempotência;
- correção absoluta exige total, justificativa, confirmação e versão e usa
  somente `correct_safisa_ready_quantity`;
- conflito concorrente recarrega os dados e nunca sobrescreve silenciosamente;
- Pedidos encerrados permanecem legíveis e sem controles de mutação;
- contas Safisa simultâneas mantêm sessão e autoria individuais.

## Validação local concluída

- baseline + MIG-SAF-001 + MIG-SAF-003 reconstruídos exclusivamente no Supabase
  Local;
- fixtures locais com duas contas Safisa, usuário sem acesso, Pedidos publicados,
  oculto, revogado e encerrado;
- testes de migrations A–H, cinco concorrências e transição legado aprovados;
- navegador integrado validado em 320, 375, 768 e 1440 px, sem overflow ou erro
  de console;
- incremento, prevenção de double-submit, correção, conflito e marcação do
  restante executados apenas sobre fixtures locais.

## Fora do escopo

- provisionar conta Safisa real;
- publicar Pedido real;
- administrar memberships;
- alertas internos de retirada;
- alterar Auth, Estoque, RPCs ou migrations;
- executar `db push` ou qualquer mutação no Supabase remoto.

## Próximo passo

Revisar humanamente o PR draft e a experiência autenticada. Merge,
provisionamento e publicação do primeiro Pedido exigem autorizações posteriores.

**Ponto de parada:** `WAITING_HUMAN_REVIEW`.
