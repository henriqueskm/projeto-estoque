# Orquestração humana do laboratório

O laboratório combina duas camadas diferentes. O **harness** é código local e reproduzível; os **agentes** são revisão humana/agentic independente. Um não é apresentado como se fosse o outro.

## Papéis usados em NK-AI-EVAL-001A

- **Subagente A — gerador adversarial:** propôs as 40 variações do held-out antes da sua primeira execução.
- **Subagente B — juiz independente:** definiu a rubrica cega de correção, contexto, clareza, naturalidade, concisão e não-alucinação. Ele não julgou respostas reais nesta rodada, pois o provider não estava configurado.
- **Subagente C — revisor de segurança:** revisou o isolamento do futuro runner live, o bloqueio explícito, a ausência de ferramentas e o não armazenamento de respostas cruas.
- **Corretor:** recebeu somente as 17 falhas concretas registradas no baseline inicial e alterou os parsers correspondentes.
- **Orquestrador:** executou o baseline, consolidou a classificação, preservou o corpus histórico e decidiu quais falhas virariam regressões permanentes.

## Separação contra overfitting

1. `cases.ts` contém o corpus histórico imutável de 157 casos.
2. `held-out-cases.ts` contém 40 casos novos e teve a primeira execução registrada em `baselines/held-out-001a-initial.json` antes de mudanças de roteador.
3. Depois da classificação, somente as 17 falhas observadas foram espelhadas em `promoted-regressions.ts`. O held-out original permanece arquivado para comparação de antes/depois; ele não substitui a baseline histórica.
4. Não se reescrevem expectativas para obter aprovação: uma alteração exige falha reprodutível, classificação e regressão associada.

## Provider opcional

`eval:assistant:live` usa apenas casos sintéticos em `live-cases.ts`. Quando ativado, há duas interações isoladas por caso: um respondente e um juiz com rubrica cega — sem código, diff, roteador ou justificativa de correção. O runner não importa handlers, clientes Supabase nem ações operacionais.

O comando só pode alcançar o provider quando **ambos** estiverem presentes:

- `GEMINI_API_KEY`;
- `NK_ASSISTANT_EVAL_LIVE=1`.

Sem isso, retorna `not_configured` sem erro e sem chamada externa. A execução humana começa com `npm run eval:assistant:live -- --limit=3`, segue para dez casos somente se todos completarem e só então roda os 37. O runner usa intervalo mínimo configurável de 5 segundos por interação, timeout de 45 segundos e no máximo dois retries para 429, timeout/rede e 5xx; 400, 401, 403 e 404 não recebem retry. O relatório sanitizado diferencia rate limit, quota, timeout, indisponibilidade, autenticação, permissão e request inválido, sem imprimir prompt, resposta crua, cabeçalhos ou credenciais.

Falhas de infraestrutura ficam como `NOT_EVALUATED`, não contaminam `safetyPassRate` e não são falhas semânticas. A qualidade oficial só é declarada com cobertura dos 37 casos; execuções menores mostram cobertura e observação parcial, mas ficam `inconclusive`. Para verificar estabilidade, a execução humana roda a suíte completa duas vezes e compara `providerSemanticQuality`, `safetyPassRate` e falhas. A execução live não persiste prompts ou respostas cruas, somente o resumo sanitizado em stdout.

### Registro da tentativa anterior à correção 001B

`LIVE_PROVIDER_ATTEMPTED`: 37 casos solicitados, um concluído e 36 sem resposta utilizável do provider. A execução foi reclassificada como `INFRASTRUCTURE_FAILURES_36` e `SEMANTIC_RESULT_INCONCLUSIVE`; ela não demonstra falha semântica da Assistente nem falha de segurança, porque os 36 casos não chegaram ao julgamento.

Uma revisão independente de respostas reais continua pendente até que o provider seja configurado e produza casos para o papel de juiz. Não se emite marcador de qualidade real antes disso.
