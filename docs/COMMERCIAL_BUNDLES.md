# Commercial bundles

`commercial_bundle` is an assembled commercial set with its own available
stock and a fixed component recipe. It is deliberately separate from both
physical `items` and `commercial_configurations`.

A `commercial_configuration` remains exactly one servo plus one installation
kit. A bundle may consume free physical items and/or an already assembled
commercial configuration. Bundle nesting is not supported.

## 1HC

`1HC` is a commercial bundle, not an alias of `1H` and not another
servo-plus-kit configuration. Its recipe is:

- 1 × active commercial configuration resolved by code `1H`;
- 1 × active loose part `CIL`;
- 1 × active loose part `EMP`;
- 1 × active loose part `RES`;
- 1 × active loose part `COT`.

The forward migration resolves these business codes and fails closed on a
missing, inactive, ambiguous, mistyped, or colliding entry. A clean local
migration chain does not contain the post-reset loose parts, so registration is
deferred only when the loose-part catalog is wholly empty. The strict private
registration guard remains the single path used once that catalog exists.

No environment-specific catalog UUID is embedded in the migration.

## Stock meaning

Assembly transfers free component balances into the bundle balance in one
transaction. Disassembly performs the exact inverse. The component still
exists physically while embedded, but is no longer free for another assembly.

Therefore future readers can calculate three different values:

- **free:** current item/configuration balance;
- **embedded:** recipe quantity multiplied by current bundle balance;
- **physical total:** free plus embedded.

`maximum assemblable` uses only free balances. Existing minimum-stock rules
remain unchanged; the bundle owns a separate `minimum_stock` value.

## Audit and lifecycle

Assembly and disassembly write one movement batch, every component movement,
the bundle movement, and a recipe snapshot. Completed idempotency receipts are
immutable. A recipe can be edited before first use, but becomes immutable after
the first bundle movement or first positive bundle balance.

The protected absolute-adjustment RPC records a counted bundle balance without
consuming or returning components and rejects stale displayed quantities. It is
the future path for a physical-count adjustment.

The real pre-existing `1HC` unit has **not** been entered by this PR. No UI,
Assistant, Entrada/Saída screen, Histórico screen, or Estatísticas screen reads
the new bundle tables yet. A later integration PR must consume the ledger and
present free, embedded, and physical totals without counting internal bundle
assembly/disassembly as external sales.
