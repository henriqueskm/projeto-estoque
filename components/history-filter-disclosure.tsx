"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useSemanticTransient } from "@/components/semantic-back-provider";

// Only the disclosure is client-side; the GET form/data remain server-rendered.
export function HistoryFilterDisclosure({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(activeCount > 0);
  const manuallyOpened = useRef(false);
  const panelId = useId();
  useSemanticTransient(isOpen && manuallyOpened.current, () => setIsOpen(false));

  return (
    <>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => { manuallyOpened.current = true; setIsOpen((current) => !current); }}
        className="nk-focus mt-3 flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-border-neutral px-3 text-sm font-bold text-text-primary md:hidden"
      >
        <span>{isOpen ? "Ocultar filtros" : "Filtros"}</span>
        <span className="text-xs text-text-muted">
          {activeCount > 0
            ? `${activeCount} ${activeCount === 1 ? "filtro ativo" : "filtros ativos"}`
            : "Nenhum filtro ativo"}
        </span>
      </button>
      <div id={panelId} className={isOpen ? "block" : "hidden md:block"}>
        {children}
      </div>
    </>
  );
}
