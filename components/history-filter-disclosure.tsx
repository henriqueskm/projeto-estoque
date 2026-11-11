"use client";

import { useId, useState, type ReactNode } from "react";
import { useSemanticTransient } from "@/components/semantic-back-provider";

// Only the disclosure is client-side; the GET form/data remain server-rendered.
// Rare filters stay folded on every screen size to keep the list simple.
export function HistoryFilterDisclosure({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(activeCount > 0);
  const [manuallyOpened, setManuallyOpened] = useState(false);
  const panelId = useId();
  useSemanticTransient(isOpen && manuallyOpened, () => setIsOpen(false));

  return (
    <>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => { setManuallyOpened(true); setIsOpen((current) => !current); }}
        className="nk-focus mt-3 flex min-h-12 w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-border-neutral bg-surface px-4 text-base font-bold text-text-primary"
      >
        <span>{isOpen ? "Menos filtros" : "Mais filtros"}</span>
        <span className="text-sm text-text-muted">
          {activeCount > 0
            ? `${activeCount} ${activeCount === 1 ? "filtro ativo" : "filtros ativos"}`
            : "Data, pessoa…"}
        </span>
      </button>
      <div id={panelId} className={isOpen ? "block" : "hidden"}>
        {children}
      </div>
    </>
  );
}
