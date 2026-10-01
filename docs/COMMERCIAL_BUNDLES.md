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
missing, inactive, ambiguous, mistyped, or colliding entry. The clean migration
chain creates the active loose parts `CIL` (Cilindro Primário), `EMP`
(Empurrador MBB), `RES` (Reservatório de Óleo), and `COT` (Cotovelo
Plástico MBB), including their subtype rows, before registering `1HC`.
Pre-existing exact rows are validated and retained without changing their IDs,
descriptions, or authorship. The system seed has null authorship and does not
create a stock balance or physical count.

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

Assembly requires the bundle, selected code, and every component to be active.
Disassembly may use the uniquely stored code and immutable recipe after those
catalog records are deactivated, so already assembled physical stock can always
be returned to its exact components.

The protected absolute-adjustment RPC records a counted bundle balance without
consuming or returning components and rejects stale displayed quantities. It is
the future path for a physical-count adjustment.

The real pre-existing `1HC` unit has **not** been entered by these PRs. The
Assistant, Histórico and Estatísticas integration remains outside NK-PR-72.
Internal bundle assembly/disassembly must never be counted as external sales.

## NK-PR-72: inventory and ready-stock flows

Estoque presents bundles separately, with explicit assembly/disassembly and
stale-protected count adjustment. Configuration alerts, minimums and filters
continue to use **free assembled stock only**. For example, `1H` with zero free
and one embedded unit remains operationally zero while displaying physical
total one. Embedded material never increases maximum assemblable capacity.

Entrada and Saída accept `BUNDLE_CODE` in their own **Conjuntos** section, with
fresh ready balances and a before/received-or-shipped/after preview. Searching
all categories opens matching sections and counts only matches; clearing the
search restores the unchanged manual section selection.

- INBOUND receives a set already ready: increase only its bundle balance.
- OUTBOUND ships a ready set: decrease only its bundle balance; insufficient
  ready stock fails atomically. It never autoassembles a bundle.
- Neither flow creates/consumes/returns component stock or an assembly record.
- Existing ITEM/configuration flow semantics, including legacy configuration
  autoassembly on Saída, remain in their existing private workers.

The new forward-only `20261001120000_bundle_ready_stock_flows.sql` extends the
canonical public APIs and preserves the historical foundation migration, also
when its remote migration version differs. It adds `bundle_batch_lines` for
commercial-code snapshots and immutable full-request receipts in
`private.bundle_stock_flow_requests`. A mixed batch uses the same transaction
and movement batch as its legacy lines. Replay checks the entire canonical
payload, actor, direction, description and outbound autoassembly policy before
any new catalog/balance validation. Alias quantities share one bundle balance.

Locks follow the existing bundle request family, shared bundle metadata,
legacy configuration/item balance order, then sorted bundle balances. Public
RPCs derive identity with `auth.uid()` and require an active profile; all new
private helpers/receipts and direct table writes remain inaccessible to clients.
The catalog writer preflight includes bundle codes, preventing loose-part
creation with an official code such as `1HC` before attempting the database RPC.

Local reproducible DB verification (PowerShell, running local baseline required):

```powershell
$env:BUNDLE_FLOW_TEST_DB_NAME = 'nk72_bundle_flow_unique_name'
$env:BUNDLE_FLOW_PREPARE = '1'
node tests/bundle-ready-stock-flows.local.mjs
```

Use a fresh disposable database name every run. The runner refuses existing
targets during preparation, supports no remote connection, and preserves the
local baseline. Fixture-only stock writes do not represent a real stock count.
No remote migration or real `1HC` stock movement is authorized by this PR.
