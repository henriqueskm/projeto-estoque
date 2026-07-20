"use client";

import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";

type StockFlowSectionProps = {
  id: string;
  title: string;
  description: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function StockFlowSection({
  id,
  title,
  description,
  count,
  isOpen,
  onToggle,
  children,
}: StockFlowSectionProps) {
  const panelId = `${id}-panel`;

  return (
    <section className="overflow-hidden rounded-2xl border border-border-neutral bg-surface">
      <h3>
        <button
          id={id}
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="nk-focus flex min-h-18 w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-app-background sm:px-5"
        >
          <span className="min-w-0">
            <span className="block font-black text-text-primary">{title}</span>
            <span className="mt-0.5 block text-xs font-semibold text-text-muted">
              {description}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-brand-gold-soft px-2.5 py-1 text-xs font-black text-brand-charcoal">
              {count}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={`size-5 text-text-muted transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>
      </h3>
      {isOpen ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={id}
          className="border-t border-border-neutral p-4 sm:p-5"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
