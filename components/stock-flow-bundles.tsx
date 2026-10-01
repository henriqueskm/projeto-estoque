import type { StockFlowBundleCode } from "@/lib/inbound-types";
import type { BundleStockFlowPreview } from "@/lib/stock-flow-bundle-preview";

export function StockFlowBundleTable({
  options,
  selectedKeys,
  onAdd,
}: {
  options: StockFlowBundleCode[];
  selectedKeys: Set<string>;
  onAdd: (option: StockFlowBundleCode) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border-neutral">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-charcoal text-white">
          <tr>
            <th className="p-3">Código</th>
            <th className="p-3">Conjunto</th>
            <th className="p-3">Saldo pronto</th>
            <th className="p-3">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {options.map((option) => {
            const selected = selectedKeys.has(
              `BUNDLE_CODE:${option.bundleCodeId}`,
            );
            return (
              <tr
                key={option.bundleCodeId}
                className="border-t border-border-neutral"
              >
                <td className="p-3 font-mono font-black">{option.code}</td>
                <td className="p-3">{option.description}</td>
                <td className="p-3 font-bold">{option.readyBalance}</td>
                <td className="p-3">
                  <button
                    type="button"
                    disabled={selected}
                    onClick={() => onAdd(option)}
                    aria-label={`Adicionar conjunto ${option.code}`}
                    className="nk-focus min-h-11 rounded-xl bg-brand-charcoal px-3 font-bold text-white disabled:opacity-50"
                  >
                    {selected ? "Adicionado" : "Adicionar"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StockFlowBundleReview({
  lines,
  direction,
}: {
  lines: BundleStockFlowPreview[];
  direction: "INBOUND" | "OUTBOUND";
}) {
  if (!lines.length) return null;
  return (
    <section className="mt-6 rounded-2xl border border-border-neutral p-4">
      <h3 className="font-black">Conjuntos prontos</h3>
      <p className="mt-1 text-sm text-text-muted">
        {direction === "INBOUND"
          ? "Recebimento de conjunto já pronto."
          : "Saída somente do saldo pronto."}{" "}
        Componentes não são movimentados. Montagem e desmontagem são operações
        separadas.
      </p>
      {lines.map((line) => (
        <article
          key={line.option.bundleId}
          className="mt-3 rounded-xl bg-app-background p-3"
        >
          <p className="font-bold">
            {line.requestedCodes.join(", ")} — {line.option.description}
          </p>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt>Saldo pronto atual</dt>
              <dd className="font-black">{line.currentBalance}</dd>
            </div>
            <div>
              <dt>{direction === "INBOUND" ? "Recebimento" : "Retirada"}</dt>
              <dd className="font-black">{line.quantity}</dd>
            </div>
            <div>
              <dt>Saldo previsto</dt>
              <dd className="font-black">{line.predictedBalance}</dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  );
}
