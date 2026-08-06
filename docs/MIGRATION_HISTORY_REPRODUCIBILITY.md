# MIG-HIST-001 — Reprodutibilidade histórica do catálogo

## Estado

- **Objetivo:** auditar uma migration-ponte que permita reconstruir o banco desde zero.
- **Estado:** `WAITING_HUMAN_REVIEW`.
- **Escopo desta entrega:** auditoria e especificação; nenhum SQL de ponte foi criado.
- **Dependência bloqueada:** MIG-SAF-001 e o PR #5 permanecem inalterados.

## Prova do alvo e reprodução

A reprodução ocorreu somente em uma instância Supabase local descartável, com
`project_id` e portas próprias em diretório temporário. Não foram usados
`--linked`, connection string remota, service role remoto, dump ou dados do
projeto `isdjboconmwaqipjrjvp`.

Ambiente observado:

- Supabase CLI `2.111.0`;
- PostgreSQL `17.6` (`x86_64-pc-linux-gnu`);
- Docker Desktop com contexto `desktop-linux`;
- cadeia inspecionada em quatro pontos de corte por `db reset --local --version`.

Resultados:

| Ponto de corte | Resultado |
|---|---|
| `20260716000925` | 6 migrations aplicadas; catálogo inicial com item `2`, kit `KT-18` e código `2A` |
| `20260716002426` | carga mestre aplicada; 100 itens, 76 configurações e 80 códigos comerciais |
| `20260718134339` | 11 migrations aplicadas; estado operacional vazio e catálogo pré-correção íntegro por chaves naturais |
| `20260718175621` | falha reproduzida antes de qualquer correção |

Falha registrada:

- SQLSTATE: `23514`;
- mensagem: `Commercial catalog correction aborted: an expected servo identity, model, type, or status diverged.`

## Causa raiz

`20260716002426_load_master_catalog_data.sql` resolve o catálogo por chaves
naturais e deixa que os defaults `gen_random_uuid()` gerem as identidades. Já
`20260718175621_correct_commercial_catalog_variants.sql` valida e manipula o
mesmo catálogo por UUIDs fixos que existiam no ambiente original.

Assim, um reset preserva códigos, modelos e relações, mas produz UUIDs novos.
A correção histórica procura os UUIDs fixos antes de resolver as chaves
naturais e aborta. Nenhuma divergência de descrição, modelo, tipo ou estado foi
observada quando os registros locais foram consultados por código.

As migrations envolvidas diretamente são:

1. `20260715205337_create_catalog_tables.sql`, que define UUID aleatório como default;
2. `20260715230815_seed_initial_catalog_data.sql`, que cria o catálogo inicial sem UUIDs fixos;
3. `20260716000925_split_commercial_configuration_codes.sql`;
4. `20260716002426_load_master_catalog_data.sql`, que completa o catálogo por código;
5. `20260718175621_correct_commercial_catalog_variants.sql`, que exige identidades fixas.

## Mapa de UUIDs

Os UUIDs locais abaixo pertencem exclusivamente a uma execução descartável.
Outra execução gera valores diferentes. A coluna “referências” considera o
estado imediatamente anterior à correção e não inclui a própria linha-pai.

### Itens e subtipos existentes

| Entidade | UUID histórico esperado | Chave natural | Descrição/modelo esperado | UUID local observado | Referências pré-correção | Estratégia |
|---|---|---|---|---|---:|---|
| item/servo | `b84223d3-19cc-4861-b6f1-1c43b1dda668` | `5` | SERVO MBF-040 / MBF-040 | `2086e191-bd7b-4268-a684-d33e6c38eb4a` | 13 | remapear item, subtipo, 11 configurações e 1 compatibilidade |
| item/servo | `52c34551-fead-4ec3-8b58-50e2d5d35e29` | `5INV028` | SERVO MBF-040 Invertido 028 | `07270032-2dce-4a7e-990a-a4bb2da84365` | 4 | remapear item, subtipo, 2 configurações e 1 compatibilidade |
| item/servo | `3e930061-5865-479b-89d8-47f73cca376b` | `6` | SERVO VF-040 / VF-040 | `c13fb2c9-9db5-44f2-9ade-3045971413ec` | 14 | remapear item, subtipo, 12 configurações e 1 compatibilidade |
| item/servo | `f09bbe2e-8f8f-4ba2-ae92-27d9d88ac3e5` | `9` | SERVO MBF-032 / MBF-032 | `3f85a5de-62c4-4598-9ff2-4c6fe86c5b3e` | 4 | remapear item, subtipo, 2 configurações e 1 compatibilidade |
| item/servo | `a82ee8d4-aabd-46bc-819e-9b2b3a354588` | `9INV` | SERVO MBF-032 Invertido 028 | `f7ada9b7-cd16-484e-8069-68cd67bdb4de` | 3 | remapear item, subtipo, 1 configuração e 1 compatibilidade |
| item/kit | `2d46ee2f-ea66-4f43-bb69-f780c3f794ba` | `KT-31` | Kit de instalação 9A / 9D | `f5c394b1-120b-4f9e-860a-f4b762c85aeb` | 2 | remapear item, subtipo e configuração |
| item/kit | `cb6e34ec-99e8-47e7-a821-38c344372a55` | `KT-59` | Kit de instalação 5Z | `ba73ee68-a4a7-4086-815f-d1a7dbdef467` | 2 | remapear item, subtipo e configuração |
| item/kit | `cb5baf6d-e842-4ea5-a159-3aa2a5c1a24a` | `KT-64` | Kit de instalação 6R | `3ba700b8-4436-4d53-9f35-b58ce37c7b4f` | 2 | remapear item, subtipo e configuração |
| item/kit | `e7cb7310-a952-4e7f-81dc-b9248148b2fd` | `KT-71` | Kit de instalação 6P | `67201379-d9ff-4578-8f5c-6d57eb4bc2b6` | 2 | remapear item, subtipo e configuração |
| item/reparo | `75be273b-f74f-4403-a8fb-bc4b7dc338e3` | `R066` | JOGO DE REPARO 066 | `0d42a796-1729-4c56-b85c-2940aeeb5144` | 2 | remapear item, subtipo e compatibilidade |

### Códigos comerciais existentes

| Entidade | UUID histórico esperado | Código | Configuração pré-correção | UUID local observado | Referências externas | Estratégia |
|---|---|---|---|---|---:|---|
| código comercial | `8fbc18e1-8e61-4426-a80b-537e798866d6` | `9A` | 9 + KT-31 | `8443bdc8-347e-412b-9f75-65c137bdd5eb` | 0 | remapear PK e eventuais linhas de lote |
| código comercial | `44d24a7d-742b-47c1-9d2c-37f3a6fa30e5` | `9D` | 9 + KT-31 | `d76d8ccc-1d63-4f00-8279-d5fc74ae400d` | 0 | remapear PK e eventuais linhas de lote |
| código comercial | `5e27bd1e-750b-4493-a684-2febd9b7bb30` | `5Z` | 5 + KT-59 | `dd6ff9bc-2628-4953-9215-47d342d765ac` | 0 | remapear PK e eventuais linhas de lote |
| código comercial | `6851b2c8-01e4-4cdd-b8a2-97b059f8d308` | `6P` | 6 + KT-71 | `d3567cfc-165e-4c3a-a4c7-7f070c2673c1` | 0 | remapear PK e eventuais linhas de lote |
| código comercial | `b029c1c8-54f2-49f2-a058-e8f657384990` | `6R` | 6 + KT-64 | `31f354b4-12b3-4d30-a96e-b61ff58a2318` | 0 | remapear PK e eventuais linhas de lote |

### Configurações existentes

| UUID histórico esperado | Chave natural servo + kit | UUID local observado | Aliases | Estratégia |
|---|---|---|---:|---|
| `7809b0b5-a697-4f30-8808-7475b420603d` | 9 + KT-31 | `3970db12-21a2-4b79-8b22-24b3fd1a6884` | 2 (`9A`, `9D`) | remapear PK e todas as FKs da configuração |
| `f4653cf0-0aa1-4d61-8450-e84dbea1bfc5` | 5 + KT-59 | `7bf9d81f-a3eb-43bb-ad23-4de9ce03b10f` | 1 (`5Z`) | remapear PK e todas as FKs da configuração |
| `f6370e18-a9c4-4a94-8b75-8b3aa5348cd7` | 6 + KT-71 | `4f5e056e-1245-452e-86de-41a21769c718` | 1 (`6P`) | remapear PK e todas as FKs da configuração |
| `316c0cec-8f98-409a-bbad-66f85095ef8b` | 6 + KT-64 | `03558084-45a1-4d72-96e8-c2bdce1467d9` | 1 (`6R`) | remapear PK e todas as FKs da configuração |

### UUIDs novos reservados pela correção

Estes cinco UUIDs não possuem linha aleatória correspondente antes da
correção. A ponte deve apenas provar que estão livres:

| Entidade futura | UUID reservado | Identidade futura |
|---|---|---|
| item/servo | `7d65b2e0-d07c-466d-b920-ccd42b59a97f` | `6RB`, SERVO VF-040 Rebaixado |
| configuração | `62316df6-e0ca-4e9c-8f55-73811596b74b` | 9INV + KT-31 (`9D`) |
| configuração | `b6aebf6f-2dd4-4288-ab56-c54e3c96adb2` | 5INV028 + KT-59 (`5Z`) |
| configuração | `0837fec5-6a54-4c84-a6e6-e142b34a9e22` | 6RB + KT-71 (`6P`) |
| configuração | `2a2f5d77-bfe2-42cb-9942-cba87625b28d` | 6RB + KT-64 (`6R`) |

**Total:** 24 UUIDs fixos, sendo 19 remapeamentos e 5 reservas.

## Grafo de chaves estrangeiras

Todas as FKs abaixo foram observadas com `ON UPDATE NO ACTION` e
`NOT DEFERRABLE`. Isso impede atualizar uma PK isoladamente.

| Origem | Coluna | Destino | ON DELETE | Trigger relevante |
|---|---|---|---|---|
| `servo_models` | `item_id` | `items.id` | CASCADE | valida subtipo em INSERT/UPDATE |
| `installation_kits` | `item_id` | `items.id` | CASCADE | valida subtipo em INSERT/UPDATE |
| `repair_kits` | `item_id` | `items.id` | CASCADE | valida subtipo em INSERT/UPDATE |
| `loose_parts` | `item_id` | `items.id` | CASCADE | valida subtipo em INSERT/UPDATE |
| `stock_balances` | `item_id` | `items.id` | RESTRICT | nenhum |
| `stock_movements` | `item_id` | `items.id` | RESTRICT | nenhum |
| `inbound_batch_lines` | `item_id` | `items.id` | RESTRICT | nenhum |
| `outbound_batch_lines` | `item_id` | `items.id` | RESTRICT | nenhum |
| `commercial_configurations` | `servo_id` | `servo_models.item_id` | NO ACTION | nenhum |
| `commercial_configurations` | `installation_kit_id` | `installation_kits.item_id` | NO ACTION | nenhum |
| `servo_repair_compatibility` | `servo_id` | `servo_models.item_id` | CASCADE | nenhum |
| `servo_repair_compatibility` | `repair_kit_id` | `repair_kits.item_id` | CASCADE | nenhum |
| `commercial_configuration_codes` | `configuration_id` | `commercial_configurations.id` | RESTRICT | nenhum |
| `configuration_stock_balances` | `configuration_id` | `commercial_configurations.id` | RESTRICT | nenhum |
| `configuration_stock_movements` | `configuration_id` | `commercial_configurations.id` | RESTRICT | nenhum |
| `assembly_operations` | `configuration_id` | `commercial_configurations.id` | RESTRICT | nenhum |
| `inbound_batch_lines` | `commercial_configuration_code_id` | `commercial_configuration_codes.id` | RESTRICT | nenhum |
| `outbound_batch_lines` | `commercial_configuration_code_id` | `commercial_configuration_codes.id` | RESTRICT | nenhum |

O trigger de `items` atua somente na mudança de `item_type`; a mudança de
`items.id` não o dispara. Os triggers dos subtipos consultam o novo pai, logo a
PK de `items` precisa ser remapeada antes da PK do subtipo dentro do bloco com
constraints diferidas.

### Ordem segura proposta

1. bloquear, em ordem determinística, tabelas operacionais, códigos,
   configurações, compatibilidades, subtipos e itens;
2. inventariar FKs reais e abortar se alguma FK relevante não estiver na lista
   aprovada;
3. validar todo o estado e preencher uma tabela temporária de mapeamento;
4. tornar temporariamente diferíveis somente as FKs aprovadas;
5. diferir essas constraints;
6. atualizar `items.id`;
7. atualizar PKs dos subtipos e todas as referências a itens/subtipos;
8. atualizar `commercial_configurations.id` e suas referências;
9. atualizar `commercial_configuration_codes.id` e suas referências;
10. validar pós-condições, executar `SET CONSTRAINTS ... IMMEDIATE` e restaurar
    cada FK para `NOT DEFERRABLE`;
11. concluir somente se o catálogo, as constraints e os metadados das FKs
    forem idênticos ao contrato esperado.

## Técnicas avaliadas

### A. Atualização direta de PK

Rejeitada isoladamente. As FKs são `ON UPDATE NO ACTION` e não diferíveis.

### B. Clonar identidade fixa e trocar referências

Possível, mas menos segura. As unicidades de código e de par servo/kit exigem
identidades ou valores transitórios e aumentam a superfície de erro.

### C. Tornar constraints diferíveis durante a transação

Viável para atualizar pai e filhos sem identidades artificiais. Exige lista
fechada de FKs, locks fortes e restauração comprovada dos metadados.

### D. Tabela temporária explícita de mapeamento

Necessária para separar UUID esperado, UUID encontrado, entidade e chave
natural, além de permitir validações de cardinalidade antes da escrita.

### Técnica recomendada

Combinar **C + D**: tabela temporária de mapeamento e diferimento transacional
controlado das FKs. É a única opção avaliada que não cria dados fictícios, não
depende de UUID aleatório, não altera chaves naturais e mantém rollback total.

## Algoritmo transacional proposto

A futura migration-ponte deve ter timestamp livre posterior a
`20260718134339` e anterior a `20260718175621`; por exemplo,
`20260718170000` — o nome e timestamp ainda dependem de aprovação.

1. adquirir locks `NOWAIT` em ordem fixa;
2. verificar ausência de histórico operacional e saldos não zero;
3. detectar primeiro o estado pós-correção completo;
4. se as 24 identidades e relações finais estiverem corretas e não existirem
   fontes aleatórias concorrentes, retornar sem DDL ou DML;
5. caso contrário, exigir exatamente o estado pré-correção por código, modelo,
   tipo, descrição, par servo/kit, aliases e cardinalidade;
6. exigir que os 5 UUIDs novos estejam livres e que cada UUID histórico dos 19
   remapeamentos esteja livre ou pertença à mesma identidade;
7. materializar o mapa em tabela temporária e validar 19 linhas únicas;
8. inventariar as FKs e abortar diante de FK inesperada;
9. diferir temporariamente as FKs aprovadas;
10. executar os remapeamentos na ordem do grafo;
11. validar valores, relações, contagens e ausência de linhas antigas;
12. forçar a checagem imediata das constraints;
13. restaurar `NOT DEFERRABLE` e validar `pg_constraint`;
14. deixar qualquer falha reverter dados e DDL integralmente.

Não deve haver detecção por host, projeto ou variável. O estado dos dados é a
única entrada válida para decidir entre remapeamento, no-op e aborto.

## Comportamento no remoto já corrigido — prova estática

Sem acessar o remoto, `20260718175621` define a pós-condição completa:

- todos os 10 itens e 5 códigos usam os UUIDs fixos;
- as 4 configurações antigas usam UUIDs fixos;
- `6RB` e as 4 configurações novas existem nos 5 UUIDs reservados;
- `9A`, `9D`, `5Z`, `6P` e `6R` apontam para as relações finais;
- as configurações antigas exclusivas ficam inativas e sem aliases.

O ramo de no-op deve validar exatamente essa pós-condição e retornar antes de
alterar constraints. Estado parcial ou identidade duplicada deve abortar, não
ser tratado como no-op.

Como a ponte teria timestamp anterior a uma migration já registrada no remoto,
uma implantação futura exigirá procedimento separado e autorização humana:

1. comparar migrations locais e remotas;
2. provar por consultas somente leitura que a pós-condição já existe;
3. revisar hash e SQL da ponte aprovada;
4. considerar `migration repair --status applied` apenas para alinhar o
   histórico, sem executar a ponte;
5. listar migrations novamente e só então retomar migrations posteriores.

Nenhum `migration repair` foi executado nesta auditoria.

## Testes necessários para a futura implementação

1. reset completo desde zero até a `main`;
2. ponte aplicada em estado pré-correção aleatório;
3. segunda execução conceitual retornando no-op;
4. no-op no estado pós-correção completo;
5. UUID fixo ocupado por identidade errada;
6. código ausente e código duplicado;
7. descrição, modelo ou tipo divergente;
8. relação servo/kit ou conjunto de aliases divergente;
9. FK inesperada detectada antes da escrita;
10. histórico operacional existente;
11. saldo físico ou de configuração não zero;
12. falha injetada após cada etapa com rollback integral;
13. constraints e propriedades `NOT DEFERRABLE` restauradas;
14. execução completa de todas as migrations até `main`;
15. rebase posterior do PR #5;
16. execução completa incluindo MIG-SAF-001;
17. comparação do schema final com uma reconstrução de referência.

## Riscos residuais

- a lista de FKs pode crescer antes da implementação;
- DDL de constraints exige locks fortes e pode falhar por concorrência;
- um estado parcialmente corrigido não pode ser reparado automaticamente;
- triggers futuros podem reagir a alterações de PK;
- alinhar o histórico remoto exige `migration repair`, operação ainda não
  autorizada;
- o timestamp retroativo precisa ser aceito pelo fluxo de deploy e pelo CLI;
- o PR #5 deve ser rebaseado e retestado somente depois da ponte aprovada.

## Ponto de parada humano

Antes de escrever SQL, é necessário aprovar:

- a técnica C + D;
- o timestamp e nome da ponte;
- a lista fechada de FKs;
- o ramo de no-op pós-correção;
- o futuro procedimento de `migration repair` remoto;
- a retomada e rebase do PR #5.

**MIG-HIST-001 — WAITING_HUMAN_REVIEW.**
