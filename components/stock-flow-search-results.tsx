"use client";

import { useMemo } from "react";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import { StockFlowAddButton } from "@/components/stock-flow-add-button";
import {
  buildStockFlowSearchResults, stockFlowSearchBalance, stockFlowSearchCategory,
  stockFlowSearchKey, type StockFlowSearchOption,
} from "@/lib/stock-flow-search-results";

const numberFormatter = new Intl.NumberFormat("pt-BR");

export function StockFlowSearchResults<T extends StockFlowSearchOption>({ options, search, selectedKeys, onAdd }: {
  options: T[];
  search: string;
  selectedKeys: Set<string>;
  onAdd: (option: T) => void;
}) {
  const { results, total } = useMemo(() => buildStockFlowSearchResults(options, search), [options, search]);
  if (!search.trim()) return <p className="mt-3 text-sm text-text-muted">Digite um código, modelo ou descrição para encontrar um item.</p>;
  return (
    <section className="mt-4 min-w-0" aria-label="Resultados da pesquisa">
      <p aria-live="polite" className="mb-2 text-xs font-semibold text-text-muted">
        {total > results.length ? `Mostrando ${results.length} de ${total} resultados. Refine a pesquisa.` : `${total} ${total === 1 ? "resultado encontrado" : "resultados encontrados"}`}
      </p>
      {total === 0 ? <p className="py-3 text-sm text-text-muted">Nenhum resultado. Tente outro código, modelo ou descrição.</p> : (
        <ul className="divide-y divide-border-neutral" aria-label="Itens encontrados">
          {results.map((option) => {
            const key = stockFlowSearchKey(option);
            const noun = option.kind === "ITEM" ? "item" : option.kind === "BUNDLE_CODE" ? "conjunto" : "Servo com kit";
            return (
              <li key={key} className="flex min-w-0 items-center gap-3 py-3" data-stock-flow-result={key}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="break-all font-mono text-sm font-black text-text-primary sm:text-base">{option.code}</span>
                    <span className="text-[0.65rem] font-semibold text-text-muted sm:text-xs">{stockFlowSearchCategory(option)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 break-words text-xs leading-4 text-text-primary sm:text-sm sm:leading-5">{option.description}</p>
                  {option.kind === "COMMERCIAL_CODE" && option.hasImage ? <CommercialConfigurationImage
                    commercialCodes={[option.code, ...option.aliases]} configurationId={option.configurationId}
                    hasImage={option.hasImage} compact triggerVariant="text-link" /> : null}
                </div>
                <div className="max-w-24 shrink-0 text-right">
                  <span className="block text-[0.65rem] text-text-muted">{option.kind === "ITEM" ? "Saldo" : option.kind === "COMMERCIAL_CODE" ? "Montado" : "Pronto"}</span>
                  <span className="block break-all font-mono text-base font-extrabold tabular-nums text-text-primary">{numberFormatter.format(stockFlowSearchBalance(option))}</span>
                </div>
                <StockFlowAddButton isSelected={selectedKeys.has(key)} onAdd={() => onAdd(option)} label={`Adicionar ${noun} ${option.code}`} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
