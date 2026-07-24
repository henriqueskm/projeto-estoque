# Dataset estatístico de desenvolvimento

Esta pasta contém ferramentas administrativas para criar, verificar e remover
exclusivamente o dataset fictício `NK_STATS_TEST_V1`.

O dataset usa o catálogo existente. Ele não cria itens, configurações, aliases,
usuários ou imagens e não altera estoque mínimo.

## Segurança

- Execute apenas por uma conexão PostgreSQL administrativa direta em ambiente
  de desenvolvimento ou teste.
- Não exponha a URL do banco em código, logs ou variáveis `NEXT_PUBLIC_*`.
- Não execute os arquivos pela interface da aplicação.
- O seed aborta se o marcador ou qualquer UUID reservado já existir.
- O reset exige a variável psql `confirm_reset` com o valor exato
  `NK_STATS_TEST_V1`.
- O reset aborta se houver qualquer batch não pertencente ao dataset criado
  depois do seed. Isso evita reescrever saldos após operações reais posteriores.
- Nenhum arquivo desta pasta implementa reset total do sistema.

## Catálogo exigido

Itens físicos ativos:

- servos `1`, `2`, `1INV`, `1DESL` e `6RB`;
- kits `KT-02`, `KT-18`, `KT-07`, `KT-29` e `KT-71`;
- reparo `R064`;
- peça avulsa `110`.

Códigos comerciais ativos:

- `1B` e `1D`, obrigatoriamente aliases da mesma configuração;
- `2A`, `1F`, `1H` e `6P`;
- `3A`, usado somente para comprovar uma configuração sem movimento.

Se qualquer pré-condição divergir, o seed aborta antes de inserir dados.

## Ordem recomendada

1. Execute `preview-statistics-test-data.sql`.
2. Revise o impacto previsto.
3. Execute `seed-statistics-test-data.sql`.
4. Execute `verify-statistics-test-data.sql`.
5. Desenvolva e valide Estatísticas.
6. Antes do reset, interrompa operações reais no ambiente.
7. Execute novamente `preview-statistics-test-data.sql` e revise as seções
   `reset_record_preview`, `reset_item_balance_preview` e
   `reset_configuration_balance_preview`.
8. Execute o reset com confirmação explícita:

```sh
psql "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=confirm_reset=NK_STATS_TEST_V1 \
  --file=reset-statistics-test-data.sql
```

9. Execute novamente `verify-statistics-test-data.sql`; o total do dataset deve
   ser zero.

## Modelo temporal

Os 30 batches são posicionados entre 88 e 1 dia antes da execução. O período
atravessa pelo menos três meses-calendário na maior parte das datas de execução
e sempre cobre três faixas relativas:

- 61–90 dias: 14 batches;
- 31–60 dias: 7 batches;
- 0–30 dias: 9 batches.

`occurred_at` e os timestamps dos movimentos são retroativos. `created_at` dos
batches registra o momento real do seed e é usado pela proteção do reset.

## Decisão sobre as RPCs

As RPCs públicas não permitem backdating. Por isso, o seed insere diretamente
nas tabelas operacionais, dentro de uma única transação, reproduzindo as
invariantes de saldo, histórico e auditoria. Nenhuma RPC de produção é alterada.

## Cenário de mínimos

O cenário `NK_STATS_TEST_MINIMUMS_V1` é complementar ao dataset estatístico.
Ele não cria movimentos nem altera saldos: modifica somente `minimum_stock` e
`updated_at` de seis itens e três configurações físicas previamente conhecidas.

Resultados esperados após a aplicação:

- estoque baixo: itens `2`, `KT-18`, `R064` e `110`, mais a configuração `1F`;
- estoque zerado: item `3` e configuração `3A`;
- mínimo positivo e estoque saudável: item `1` e configuração compartilhada
  pelos aliases `1B` e `1D`;
- controles com mínimo zero: item `1INV` e configuração `2A`.

Os indicadores de estoque baixo e zerado representam o estado atual dos
saldos. Na página Estatísticas, eles não mudam com o filtro de período usado
para analisar o histórico de movimentações.

Ordem segura:

1. Execute `preview-statistics-test-minimums.sql`.
2. Confirme o dataset base, os IDs, os saldos e os estados previstos.
3. Execute `apply-statistics-test-minimums.sql`.
4. Execute `verify-statistics-test-minimums.sql`.
5. Mantenha o cenário enquanto desenvolve e testa alertas de estoque.
6. Quando o reset for autorizado, interrompa alterações administrativas nos
   mesmos registros e execute:

```sh
psql "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=confirm_reset=NK_STATS_TEST_MINIMUMS_V1 \
  --file=reset-statistics-test-minimums.sql
```

O apply usa locks `NOWAIT` e aborta se o baseline ou os saldos esperados
divergirem. O reset restaura os mínimos e timestamps originais somente se todos
os nove alvos ainda conservarem exatamente os valores e o timestamp gravados
pelo cenário. Uma alteração administrativa posterior faz o reset abortar, em
vez de sobrescrever a mudança real.

## Arquivos

- `preview-statistics-test-data.sql`: baseline e impacto previsto, somente leitura.
- `seed-statistics-test-data.sql`: seed transacional e idempotente por abort.
- `verify-statistics-test-data.sql`: consistência e métricas observadas.
- `reset-statistics-test-data.sql`: reset atômico e restrito ao dataset.
- `preview-statistics-test-minimums.sql`: preview somente leitura dos mínimos.
- `apply-statistics-test-minimums.sql`: aplicação transacional e protegida.
- `verify-statistics-test-minimums.sql`: verificação somente leitura dos alertas.
- `reset-statistics-test-minimums.sql`: restauração protegida dos mínimos.
- `expected-statistics.json`: resultados determinísticos esperados.
