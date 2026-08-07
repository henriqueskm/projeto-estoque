# MIG-BASE-001 — Baseline reproduzível do estado atual

**Estado:** `WAITING_HUMAN_REVIEW` no draft PR [#7](https://github.com/henriqueskm/projeto-estoque/pull/7).

## Objetivo e limite

O baseline reconstrói localmente o estado estrutural atual do Negócios K sem
executar a cadeia histórica não reproduzível. Ele não substitui migrations,
não é aplicado ao remoto e não contém dados operacionais ou pessoais.

Fonte: `main` em `d06bedb275e4b178fb0e26fb7e6c56f66726a19b`.
Cutoff histórico local: `20260729001230`.

## Allowlist referencial

- `public.items` — 102 linhas;
- `public.servo_models` — 22 linhas;
- `public.installation_kits` — 74 linhas;
- `public.repair_kits` — 5 linhas;
- `public.loose_parts` — 1 linha;
- `public.commercial_configurations` — 80 linhas;
- `public.commercial_configuration_codes` — 80 linhas;
- `public.servo_repair_compatibility` — 22 linhas;
- metadado determinístico do bucket privado `commercial-catalog-images` — 1 linha.

O bucket é reconstruído a partir do contrato versionado. Nenhuma linha de
`storage.objects` ou arquivo enviado foi extraído.

## Exclusões

Auth, perfis, e-mails, sessões, tokens, Pedidos, linhas, negociações, retiradas,
entradas, saídas, saldos, movimentos, lotes, eventos, auditorias, chaves de
idempotência, objetos de Storage, logs e configurações privadas.

## Restauração local

`scripts/reset-local-from-baseline.ps1`:

1. aceita somente host local;
2. valida SHA-256 antes de iniciar;
3. cria workspace descartável em `%TEMP%`;
4. inicia Supabase Local sem migrations históricas;
5. aplica schema e dados referenciais com constraints ativas;
6. registra localmente as versões históricas até o cutoff com a opção oficial
   `migration repair --local`;
7. aplica apenas migrations futuras acima do cutoff;
8. valida RLS, RPCs, constraints, catálogo e estado operacional vazio;
9. remove o stack em falhas e quando solicitado pelo teste.

O script exibe `ALVO CONFIRMADO: SUPABASE LOCAL` antes de qualquer criação.

## Resultados locais

Duas reconstruções independentes produziram:

- assinatura de schema: `eb51ac5bddd2b8caaf75be078cfb55c6`;
- assinatura de catálogo: `9e010282ce86835cb5973da9b50a5d52`.

Também passaram rejeições para host remoto, checksum incorreto, tabela
operacional, dado pessoal, falha durante schema e falha durante dados. A
limpeza removeu todos os containers após sucesso e falha.

## Continuidade das migrations

Migrations históricas permanecem no repositório, intactas. Novas migrations
devem ter timestamp superior a `20260729001230`. A MIG-SAF-001 precisará ser
renomeada quando o PR #5 for retomado, sem alteração nesta tarefa.

`migration repair` remoto e aplicação remota do baseline não estão autorizados.

**Estado:** `WAITING_HUMAN_REVIEW`.
