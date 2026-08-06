# Objetivo atual

- **ID:** MIG-HIST-001
- **Título:** Auditoria da reprodutibilidade histórica do catálogo
- **Estado:** WAITING_HUMAN_REVIEW
- **Classificação:** C — exige uma migration-ponte e alinhamento posterior do histórico remoto
- **Branch:** `agent/migration-history-reproducibility-audit`
- **Base:** `origin/main`
- **Dependência bloqueada:** MIG-SAF-001 / PR #5

## Resultado

- a cadeia foi reproduzida somente em Supabase local descartável;
- a carga mestre usa UUIDs aleatórios, enquanto a correção posterior exige 24 UUIDs fixos;
- 19 identidades precisam de remapeamento e 5 UUIDs futuros precisam estar livres;
- todas as FKs relevantes são `ON UPDATE NO ACTION` e `NOT DEFERRABLE`;
- a técnica recomendada combina tabela temporária explícita e diferimento transacional controlado das FKs;
- a auditoria completa está em `docs/MIGRATION_HISTORY_REPRODUCIBILITY.md`.

## Escopo concluído

- reprodução dos pontos de corte históricos;
- mapa de identidades;
- grafo de FKs e triggers;
- estratégia transacional, no-op e testes futuros;
- nenhuma migration antiga ou nova criada/alterada.

## Próximo passo humano

Aprovar ou rejeitar a técnica proposta, o timestamp retroativo, a lista de FKs,
o ramo de no-op e a estratégia futura de `migration repair`. Somente depois
poderão ser autorizadas a escrita da ponte e a retomada do PR #5.

**Ponto de parada:** `WAITING_HUMAN_REVIEW`.
