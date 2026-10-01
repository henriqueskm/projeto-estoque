"use client";

import { InventoryRowActions } from "@/components/inventory-row-actions";
import type { InventoryCommercialBundle } from "@/lib/inventory-types";

const states = {
  AVAILABLE: {
    label: "Pronto disponível",
    className: "bg-violet-100 text-violet-900",
  },
  LOW: { label: "Estoque baixo", className: "bg-amber-100 text-amber-950" },
  ZERO: { label: "Zerado", className: "bg-red-100 text-red-900" },
  EMPTY: {
    label: "Sem conjuntos prontos",
    className: "bg-slate-100 text-slate-700",
  },
};

export function InventoryBundleTable({
  bundles,
}: {
  bundles: InventoryCommercialBundle[];
}) {
  return (
    <div className="bg-surface p-3 sm:p-4">
      <h4 className="mb-2 text-sm font-black text-text-primary">
        Conjuntos comerciais
      </h4>
      <ul className="space-y-3">
        {bundles.map((bundle) => (
          <li
            key={bundle.id}
            className="rounded-xl border border-violet-200 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-black text-violet-900">
                    {bundle.codes.join(" / ")}
                  </span>
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-900">
                    Conjunto
                  </span>
                </p>
                <p className="mt-1 text-sm font-bold">{bundle.description}</p>
                <p className="mt-1 text-xs text-text-muted">
                  Receita:{" "}
                  {bundle.recipe
                    .map(
                      (component) =>
                        `${component.quantityPerBundle} × ${component.code}`,
                    )
                    .join(" + ")}
                </p>
              </div>
              <InventoryRowActions
                target={{
                  kind: "BUNDLE",
                  bundleId: bundle.id,
                  commercialCodes: bundle.codes,
                  commercialAliases: bundle.aliases,
                  description: bundle.description,
                  isActive: bundle.isActive,
                  readyQuantity: bundle.readyQuantity,
                  minimumStock: bundle.minimumStock,
                  maximumAssemblable: bundle.maximumAssemblable,
                  recipe: bundle.recipe,
                }}
              />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-text-muted">Saldo pronto</dt>
                <dd className="font-mono font-black">{bundle.readyQuantity}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Mínimo</dt>
                <dd className="font-mono font-black">{bundle.minimumStock}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Pode montar</dt>
                <dd className="font-mono font-black">
                  {bundle.maximumAssemblable}
                </dd>
              </div>
            </dl>
            <span
              className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${states[bundle.state].className}`}
            >
              {states[bundle.state].label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
