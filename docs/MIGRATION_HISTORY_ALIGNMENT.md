# Reconciliação #97 — 2026-10-23

Base main: `adc99fb56fed77d0e29c1f61602ee428a2da1291`.
Leitura oficial `list_migrations`, projeto EstoqueNK `isdjboconmwaqipjrjvp`:
45 versões. Snapshot somente de versões em
`tests/fixtures/nk-migration-history-20261023.json`, sem dados operacionais.

A única divergência era o timestamp do catálogo físico. Rename:
`20261022191356_physical_catalog_management.sql` →
`20261022200954_physical_catalog_management.sql`.
Mesmo blob Git `6c28c343e9857476bea24f190f689580c5e3a3b3` (rename 100%).
O nome descritivo remoto ainda inclui o timestamp anterior; a comparação do CLI
usa a versão, não esse nome. Nenhum SQL reaplicado, migration repair ou write remoto.
Após rename: 45/45 antigas alinhadas; zero pendências antigas.

## Próximo rollout, somente após autorização humana

O conector `apply_migration` atribuiu sua própria versão no rollout anterior.
Não usá-lo presumindo que respeitará o timestamp do arquivo. Coordenar a próxima
aplicação com o CLI oficial, conferindo previamente `migration list` e um
`db push --dry-run` autorizado. A nova migration da #100 deverá ser a única
pendente. O `db push` real continua proibido nesta tarefa e exige autorização
separada, assim como qualquer correção remota/backfill. Não modificar a tabela
remota de histórico e não executar `migration repair` para mascarar divergências.

Validação: `node --test tests/migration-history-alignment.test.mjs`, referências
de testes/documentação atualizadas e SQL byte-idêntico. O snapshot registra a
leitura desta data; não substitui nova conferência read-only antes do rollout.
