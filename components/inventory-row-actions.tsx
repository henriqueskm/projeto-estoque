"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import {
  ConfigurationOperationDialog,
  InventoryAdjustmentDialog,
  MinimumStockDialog,
} from "@/components/inventory-action-dialogs";
import type { InventoryActionTarget } from "@/lib/inventory-action-types";

type InventoryRowActionsProps = {
  target: InventoryActionTarget;
  imageUrl?: string | null;
};

type ActiveDialog =
  | "ASSEMBLY"
  | "DISASSEMBLY"
  | "ADJUSTMENT"
  | "MINIMUM_STOCK"
  | null;

export function InventoryRowActions({
  target,
  imageUrl = null,
}: InventoryRowActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLabel =
    target.kind === "ITEM"
      ? target.code
      : target.commercialCodes.join(" / ") || target.description;

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const finishAction = useCallback((message: string) => {
    setFeedback(message);
    setActiveDialog(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();

    function hasOpenImageDialog() {
      return Boolean(
        document.querySelector('[data-commercial-image-dialog="true"]'),
      );
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        hasOpenImageDialog() ||
        menuRef.current?.contains(event.target as Node) ||
        triggerRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || hasOpenImageDialog()) {
        return;
      }

      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!menuRef.current) {
      return;
    }

    const items = Array.from(
      menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }

    if (nextIndex !== null && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  }

  function openDialog(dialog: Exclude<ActiveDialog, null>) {
    setIsOpen(false);
    setFeedback(null);
    setActiveDialog(dialog);
  }

  return (
    <>
      <div className="relative inline-flex justify-end">
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Abrir ações de ${targetLabel}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={menuId}
          onClick={() => setIsOpen((current) => !current)}
          className="nk-focus inline-flex size-11 items-center justify-center rounded-xl border border-border-neutral bg-surface text-xl font-black leading-none text-text-primary transition hover:border-brand-gold-dark hover:bg-brand-gold-soft"
        >
          <span aria-hidden="true">⋯</span>
        </button>

        {isOpen ? (
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Ações disponíveis para ${targetLabel}`}
            onKeyDown={handleMenuKeyDown}
            className="absolute top-full right-0 z-30 mt-1 w-56 rounded-xl border border-border-neutral bg-surface p-1.5 shadow-xl"
          >
            {target.kind === "CONFIGURATION" ? (
              <>
                <p role="presentation" className="px-3 pt-1 pb-1 text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
                  Operações
                </p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openDialog("ASSEMBLY")}
                  className="nk-focus flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-bold text-emerald-800 transition hover:bg-emerald-50"
                >
                  Montar
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openDialog("DISASSEMBLY")}
                  className="nk-focus flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-bold text-violet-900 transition hover:bg-violet-50"
                >
                  Desmontar
                </button>
                <div
                  role="separator"
                  className="my-1 border-t border-border-neutral"
                />
                <p role="presentation" className="px-3 pt-1 pb-1 text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
                  Gestão
                </p>
              </>
            ) : null}

            <button
              type="button"
              role="menuitem"
              onClick={() => openDialog("ADJUSTMENT")}
              className="nk-focus flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-bold text-text-primary transition hover:bg-app-background"
            >
              Ajustar estoque
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openDialog("MINIMUM_STOCK")}
              className="nk-focus flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-bold text-text-primary transition hover:bg-app-background"
            >
              Alterar estoque mínimo
            </button>

            {target.kind === "CONFIGURATION" && imageUrl ? (
              <>
                <div
                  role="separator"
                  className="my-1 border-t border-border-neutral"
                />
                <p role="presentation" className="px-3 pt-1 pb-1 text-[0.65rem] font-black tracking-wide text-text-muted uppercase">
                  Imagem
                </p>
                <CommercialConfigurationImage
                  commercialCodes={target.commercialCodes}
                  imageUrl={imageUrl}
                  triggerVariant="menu-item"
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {activeDialog === "ADJUSTMENT" ? (
        <InventoryAdjustmentDialog
          target={target}
          onClose={closeDialog}
          onSuccess={finishAction}
        />
      ) : null}

      {activeDialog === "MINIMUM_STOCK" ? (
        <MinimumStockDialog
          target={target}
          onClose={closeDialog}
          onSuccess={finishAction}
        />
      ) : null}

      {activeDialog === "ASSEMBLY" && target.kind === "CONFIGURATION" ? (
        <ConfigurationOperationDialog
          target={target}
          operationType="ASSEMBLY"
          onClose={closeDialog}
          onSuccess={finishAction}
        />
      ) : null}

      {activeDialog === "DISASSEMBLY" && target.kind === "CONFIGURATION" ? (
        <ConfigurationOperationDialog
          target={target}
          operationType="DISASSEMBLY"
          onClose={closeDialog}
          onSuccess={finishAction}
        />
      ) : null}

      {feedback ? (
        <div
          role="status"
          className="fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 z-[70] mx-auto flex max-w-md items-start justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950 shadow-xl lg:right-5 lg:bottom-5 lg:left-auto"
        >
          <span className="leading-5">{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Fechar confirmação"
            className="nk-focus shrink-0 rounded-md px-1 font-black"
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
