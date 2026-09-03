# Reset operacional de implantação

Este runbook define o procedimento administrativo para remover dados operacionais de teste antes da implantação real do EstoqueNK. Ele não recria o banco, não reaplica migrations, não altera o catálogo e não é uma funcionalidade da aplicação.

> **Estado desta PR:** somente o modo destrutivo em clone local descartável foi executado. Nenhuma escrita foi realizada no Supabase remoto.

## Princípios de segurança

- `DryRun` executa somente `SELECT`, produz um relatório e não abre um caminho de escrita.
- `Execute` usa uma única transação PostgreSQL. Qualquer guard ou validação final com falha causa `ROLLBACK` integral.
- O alvo é identificado pela conexão real, não apenas por um nome digitado: project ref extraído do host/usuário, database, migrations, schema e catálogo precisam corresponder ao contrato versionado.
- O modo remoto destrutivo exige o contrato padrão versionado, árvore rastreada limpa, flag remota explícita, frase exata, backup validado e aplicação/workers pausados.
- A ferramenta não é endpoint HTTP, não aparece na UI e não usa credenciais no frontend.
- Nunca usar `session_replication_role`, `DISABLE TRIGGER ALL`, reset remoto, seed remoto ou reparo de migration como atalho.

## Arquivos da ferramenta

- `scripts/deployment-operational-reset.ps1`: orquestra os guards, seleciona `DryRun`/`Execute` e não imprime a URL do banco.
- `scripts/deployment-reset/contract.json`: contrato auditado do projeto, migrations, fingerprints, contagens e itens dinâmicos preservados.
- `scripts/deployment-reset/dry-run.sql`: consulta read-only e relatório JSON.
- `scripts/deployment-reset/execute.sql`: transação administrativa e validações antes do commit.
- `tests/fixtures/deployment-operational-reset.sql`: dados operacionais apenas para clone descartável.
- `tests/deployment-operational-reset.cli.local.ps1`: prova integração, imutabilidade do dry-run, rollback e execução local.

## O que é preservado

- migrations, schema, RLS, policies, functions, RPCs e triggers;
- `items`, `servo_models`, `installation_kits`, `repair_kits` e `loose_parts`;
- `commercial_configurations`, `commercial_configuration_codes` e `servo_repair_compatibility`;
- todos os IDs e códigos oficiais, inclusive as cinco peças dinâmicas registradas no contrato;
- Auth users, `profiles` e `safisa_portal_members`;
- bucket `commercial-catalog-images`, metadados de Storage e todas as imagens referenciadas;
- `push_subscriptions` por padrão.

`items.minimum_stock` e `commercial_configurations.minimum_stock` pertencem ao catálogo, mas seus valores operacionais são reinicializados para zero. Eles foram deliberadamente excluídos do fingerprint de identidade do catálogo e verificados separadamente.

## O que é resetado

- saldos e movimentos físicos/de configurações;
- lotes, linhas de entrada/saída e operações de montagem/desmontagem;
- pedidos de fornecedor, linhas, eventos, entradas vinculadas e autorizações Safisa;
- eventos operacionais Safisa, inclusive `MEMBER_STATUS_CHANGED`, sem remover o membership atual;
- eventos push;
- auditorias de mínimo;
- idempotências privadas de ajuste e operação de configuração encontradas na auditoria.

O resultado correto contém zero linhas em `stock_balances` e `configuration_stock_balances`; a ferramenta não fabrica saldos com quantidade zero.

## Push subscriptions

O parâmetro `-PushSubscriptions` aceita:

- `PRESERVE` (padrão): mantém registros, FIDs e estado atual;
- `DISABLE`: mantém registros/FIDs, mas desabilita todos;
- `DELETE`: remove os registros.

A decisão para a execução real deve ser tomada somente após confirmar se os dispositivos atuais serão os dispositivos de produção. `DryRun` deve permanecer em `PRESERVE` até essa decisão.

## Dry-run local

Use somente um container cujo nome identifique explicitamente um banco Supabase descartável:

```powershell
./scripts/deployment-operational-reset.ps1 `
  -Mode DryRun `
  -ContainerName supabase_db_<clone_descartavel> `
  -CloneOfProjectRef isdjboconmwaqipjrjvp `
  -PushSubscriptions PRESERVE
```

## Dry-run remoto read-only

Forneça a URL do banco por variável de ambiente. Não passe senha na linha de comando e não registre seu valor em logs:

```powershell
$env:NK_RESET_DATABASE_URL = '<database-url-read-only>'
./scripts/deployment-operational-reset.ps1 `
  -Mode DryRun `
  -DatabaseUrlEnvironmentVariable NK_RESET_DATABASE_URL `
  -PushSubscriptions PRESERVE
```

O relatório deve terminar com `NENHUMA ALTERACAO FOI EXECUTADA.`. Qualquer guard divergente torna o dry-run reprovado, ainda sem mutação.

## Guards obrigatórios

Antes de uma execução, todos devem passar:

1. project ref real da conexão igual a `isdjboconmwaqipjrjvp`;
2. database igual ao contrato;
3. SHA base registrado existente e ancestral do checkout;
4. arquivos locais de migration com mesma quantidade, última versão e fingerprint do remoto;
5. schema fingerprint, incluindo colunas, constraints, índices, views, RLS, policies, functions e triggers;
6. catalog fingerprint e contagens exatas;
7. usuários, perfis e membership presentes nas contagens auditadas;
8. bucket, objetos e referências de imagem completos;
9. todas as tabelas estruturais esperadas presentes;
10. trigger nominal de imutabilidade dos eventos Safisa ativo;
11. frase exata `CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK`;
12. acknowledgement de backup validado;
13. acknowledgement de aplicação e worker push pausados;
14. `-Mode Execute` explícito; para remoto, também `-AllowRemoteExecution`.

Não confiar no project ref isoladamente: ele é somente uma das verificações.

## Backup obrigatório antes de execução real

Não prossiga com `Execute` remoto até que todos estes artefatos existam e tenham sido verificados:

1. backup/PITR do projeto confirmado e janela de restauração documentada;
2. dump lógico completo produzido com ferramenta compatível;
3. checksum criptográfico do dump registrado;
4. export do bucket `commercial-catalog-images` feito separadamente;
5. manifesto de arquivos do Storage com tamanho e checksum;
6. migrations/commit exatos registrados junto ao backup;
7. restauração do dump e do manifesto ensaiada em clone descartável;
8. relatório da restauração confirma catálogo, Auth/profiles, memberships e referências de imagem.

O switch `-BackupValidated` é apenas um acknowledgement operacional; ele não substitui essas evidências.

## Janela de manutenção para execução futura

1. obter aprovação humana do relatório dry-run;
2. confirmar a política de `push_subscriptions`;
3. congelar entradas, saídas, montagens, retiradas Safisa e criação/edição de Pedidos;
4. pausar aplicação e worker de push;
5. garantir ausência de sessões operacionais concorrentes;
6. confirmar backup e restauração ensaiada;
7. atualizar main, executar testes e exigir árvore rastreada limpa;
8. repetir dry-run imediatamente antes da execução;
9. usar `Execute` somente com todos os acknowledgements;
10. manter aplicação bloqueada até a validação pós-reset independente.

Exemplo de forma (não executar nesta PR):

```powershell
./scripts/deployment-operational-reset.ps1 `
  -Mode Execute `
  -DatabaseUrlEnvironmentVariable NK_RESET_DATABASE_URL `
  -PushSubscriptions PRESERVE `
  -Confirmation 'CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK' `
  -BackupValidated `
  -OperationsPaused `
  -AllowRemoteExecution
```

## Ordem transacional

1. capturar fingerprints/hashes de preservação dentro da transação;
2. validar contrato e objetos estruturais;
3. remover `push_notification_events`;
4. desabilitar somente `safisa_portal_events_reject_mutation`;
5. remover somente os tipos operacionais Safisa conhecidos;
6. reativar imediatamente o mesmo trigger;
7. remover autorizações, linhas/entradas/eventos de estoque vinculados ao Pedido;
8. zerar `ready_quantity`, `picked_quantity`, `stocked_quantity` e `cancelled_quantity` nas linhas de Pedido;
9. remover linhas e Pedidos;
10. remover idempotências privadas, operações, linhas e movimentos;
11. remover lotes somente após todas as referências;
12. esvaziar as duas tabelas de saldo;
13. zerar mínimos e remover suas auditorias;
14. aplicar a política escolhida de subscriptions;
15. executar todas as validações finais;
16. somente então permitir `COMMIT`.

A etapa 8 satisfaz o trigger protetor de readiness pela regra normal; ele não é desabilitado. O trigger imutável Safisa é a única exceção nominal, fica desabilitado pelo menor intervalo possível e sua reativação/fingerprint são condições de commit.

## Validação antes do commit

A transação rejeita o commit se houver:

- qualquer linha operacional, de saldo, de mínimo ou de idempotência restante;
- qualquer mínimo diferente de zero;
- alteração no catálogo, IDs/códigos, migrations ou schema;
- alteração em Auth users, perfis ou membership;
- alteração no bucket, objetos ou referências de imagem;
- política de subscriptions diferente da escolhida;
- trigger Safisa nominal inativo;
- falha proposital do ensaio de rollback.

O schema fingerprint cobre RLS, policies, RPCs/functions e triggers. O catálogo fingerprint cobre as identidades e campos oficiais, inclusive peças dinâmicas.

## Ensaio local descartável

Com o clone já criado, alinhado ao contrato e operacionalmente vazio:

```powershell
npm run test:deployment-reset
npm run test:deployment-reset:local
```

O teste local:

1. cria saldos, movimentos, entrada/saída, montagem/desmontagem, reversão, Pedido com readiness, entrada vinculada, eventos, mínimos, idempotências e evento Safisa imutável;
2. prova que o dry-run não muda o hash do estado;
3. força falha na validação final e prova rollback integral;
4. executa o reset no clone;
5. confirma zero operacional, catálogo/usuários/membership/Storage intactos, subscriptions preservadas e trigger ativo.

Se o alvo não puder ser comprovado como container local descartável, o teste aborta.

## Validação independente pós-reset

Antes de liberar o sistema, repetir em sessão separada:

- contagens zero de todos os objetos operacionais listados;
- tabelas de saldo vazias;
- mínimos zero e auditorias vazias;
- contagens e fingerprints do catálogo idênticos;
- cinco itens dinâmicos presentes com mesmos IDs/códigos;
- usuários, perfis e membership idênticos;
- 80 configurações, 80 códigos comerciais e 22 compatibilidades;
- bucket e imagens referenciadas íntegros;
- migrations, RLS, functions/RPCs e triggers idênticos e ativos;
- policy de push subscriptions aplicada exatamente;
- aplicação e readers essenciais carregando sem executar escrita.

## Contagem inicial de implantação

1. liberar o sistema somente após todas as validações do reset;
2. manter saídas congeladas durante toda a contagem;
3. separar fisicamente caixas montadas de peças avulsas;
4. não contar novamente como avulsos os componentes internos de caixas montadas;
5. lançar cada contagem pelo fluxo oficial de Entrada;
6. usar a descrição `Contagem inicial de implantação`;
7. conferir o estoque final do sistema contra a contagem física assinada;
8. investigar e corrigir divergências pelo fluxo oficial, com auditoria;
9. liberar a operação normal somente após a conciliação final.

## Riscos restantes

- o contrato é intencionalmente rígido; qualquer migration ou alteração legítima de catálogo exige nova auditoria e atualização consciente dos fingerprints;
- um dump não restaura Storage sozinho, por isso export/manifesto e ensaio de restauração são separados;
- conexões concorrentes podem gerar dados após o dry-run, por isso a aplicação e workers precisam estar pausados;
- a decisão de subscriptions continua humana até a confirmação dos dispositivos de produção;
- novos tipos de evento/tabelas idempotentes introduzidos por migrations futuras devem ser adicionados explicitamente; nunca ampliar o delete de forma genérica.
