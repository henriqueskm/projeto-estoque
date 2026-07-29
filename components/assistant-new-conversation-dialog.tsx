"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useDocumentScrollLock } from "@/lib/use-document-scroll-lock";

export function AssistantNewConversationDialog({
  isOpen,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useDocumentScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-2xl border border-border-neutral bg-surface p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-black text-text-primary">
          Iniciar uma nova conversa?
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm leading-6 font-semibold text-text-muted"
        >
          A conversa atual será limpa desta aba. Estoque e Pedidos não serão
          alterados.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="nk-focus min-h-11 rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
          >
            Continuar aqui
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="nk-focus min-h-11 rounded-xl bg-brand-charcoal px-3 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
          >
            Nova conversa
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
