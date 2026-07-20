"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import {
  adjustInventoryStock,
  changeConfigurationMinimumStock,
  changeItemMinimumStock,
} from "@/app/(authenticated)/estoque/actions";
import type { InventoryActionTarget } from "@/lib/inventory-action-types";

const maximumInteger = 2_147_483_647;
const maximumReasonLength = 500;

type DialogBaseProps = {
  onClose: () => void;
  onSuccess: (message: string) => void;
};

function useAccessibleDialog(
  dialogRef: RefObject<HTMLDivElement | null>,
  initialFocusRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  isPending: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    initialFocusRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
        ),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dialogRef, initialFocusRef, isPending, onClose]);
}

function DialogFrame({
  children,
  descriptionId,
  dialogRef,
  isPending,
  onClose,
  title,
  titleId,
}: Omit<DialogBaseProps, "onSuccess"> & {
  children: React.ReactNode;
  descriptionId: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  isPending: boolean;
  title: string;
  titleId: string;
}) {
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-inventory-action-dialog="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))]"
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-brand-gold/35 bg-surface shadow-2xl">
        <div className="border-b border-border-neutral bg-brand-charcoal px-5 py-4 text-white">
          <h2 id={titleId} className="text-xl font-black">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function targetCode(target: InventoryActionTarget) {
  return target.kind === "ITEM"
    ? target.code
    : target.commercialCodes.join(" / ");
}

function targetDescription(target: InventoryActionTarget) {
  return target.description;
}

function currentTargetQuantity(target: InventoryActionTarget) {
  return target.kind === "ITEM"
    ? target.looseQuantity
    : target.assembledQuantity;
}

export function InventoryAdjustmentDialog({
  target,
  onClose,
  onSuccess,
}: DialogBaseProps & { target: InventoryActionTarget }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const [countedQuantity, setCountedQuantity] = useState(
    String(currentTargetQuantity(target)),
  );
  const [reason, setReason] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isLooseComponent =
    target.kind === "ITEM" &&
    (target.itemType === "SERVO" ||
      target.itemType === "INSTALLATION_KIT");
  const currentQuantity = currentTargetQuantity(target);

  useAccessibleDialog(dialogRef, quantityInputRef, isPending, onClose);

  function renewIdempotencyKey() {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const quantity = Number(countedQuantity);
    const normalizedReason = reason.trim();

    if (
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > maximumInteger
    ) {
      setError("Informe uma quantidade inteira maior ou igual a zero.");
      return;
    }

    if (!normalizedReason || normalizedReason.length > maximumReasonLength) {
      setError(
        `Informe um motivo com até ${maximumReasonLength} caracteres.`,
      );
      return;
    }

    const idempotencyKey =
      idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;

    startTransition(async () => {
      const result = await adjustInventoryStock({
        target_kind: target.kind,
        target_id:
          target.kind === "ITEM" ? target.itemId : target.configurationId,
        counted_quantity: quantity,
        reason: normalizedReason,
        idempotency_key: idempotencyKey,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (!result.receipt.adjustmentApplied) {
        onSuccess("Saldo conferido. Nenhum ajuste foi necessário.");
        return;
      }

      const changeLabel =
        result.receipt.quantityChange > 0
          ? `+${result.receipt.quantityChange}`
          : String(result.receipt.quantityChange);
      onSuccess(
        `Estoque ajustado para ${result.receipt.quantityAfter} (${changeLabel}).`,
      );
    });
  }

  return (
    <DialogFrame
      dialogRef={dialogRef}
      titleId={titleId}
      descriptionId={descriptionId}
      title="Ajustar estoque"
      isPending={isPending}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <div id={descriptionId} className="rounded-xl bg-app-background p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
            {target.kind === "ITEM" ? "Código" : "Códigos comerciais"}
          </p>
          <p className="font-mono text-lg font-black text-text-primary">
            {targetCode(target)}
          </p>
          <p className="mt-1 text-sm leading-5 font-semibold text-text-muted">
            {targetDescription(target)}
          </p>
        </div>

        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border-neutral px-3 py-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">
              {target.kind === "CONFIGURATION"
                ? "Caixas completas atuais"
                : isLooseComponent
                  ? "Saldo avulso atual"
                  : "Saldo atual"}
            </dt>
            <dd className="mt-1 font-mono text-xl font-black text-text-primary">
              {currentQuantity}
            </dd>
          </div>
          {isLooseComponent && target.kind === "ITEM" ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-3">
              <dt className="text-xs font-bold uppercase tracking-wide text-violet-800">
                Em caixas completas
              </dt>
              <dd className="mt-1 font-mono text-xl font-black text-text-primary">
                {target.mountedQuantity}
              </dd>
            </div>
          ) : null}
        </dl>

        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-text-primary">
            {target.kind === "CONFIGURATION"
              ? "Quantidade conferida"
              : isLooseComponent
                ? "Quantidade avulsa conferida"
                : "Quantidade conferida"}
          </span>
          <input
            ref={quantityInputRef}
            type="number"
            min="0"
            max={maximumInteger}
            step="1"
            inputMode="numeric"
            required
            disabled={isPending}
            value={countedQuantity}
            onChange={(event) => {
              setCountedQuantity(event.target.value);
              renewIdempotencyKey();
            }}
            className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-text-primary">
            Motivo
          </span>
          <textarea
            required
            maxLength={maximumReasonLength}
            rows={3}
            disabled={isPending}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              renewIdempotencyKey();
            }}
            placeholder="Ex.: divergência encontrada na contagem física"
            className="nk-field w-full resize-y rounded-xl border px-3 py-3 text-base outline-none"
          />
          <span className="mt-1 block text-right text-xs text-text-muted">
            {reason.length}/{maximumReasonLength}
          </span>
        </label>

        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 font-semibold text-amber-950">
          Informe a quantidade final encontrada na contagem. O sistema calculará
          a diferença e registrará o ajuste no histórico.
        </p>

        {error ? (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="nk-focus min-h-12 rounded-xl border border-border-neutral px-4 text-sm font-bold text-text-primary disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="nk-focus min-h-12 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:cursor-wait disabled:opacity-70"
          >
            {isPending ? "Salvando ajuste..." : "Confirmar ajuste"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function MinimumStockDialog({
  target,
  onClose,
  onSuccess,
}: DialogBaseProps & { target: InventoryActionTarget }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [minimumStock, setMinimumStock] = useState(String(target.minimumStock));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useAccessibleDialog(dialogRef, inputRef, isPending, onClose);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedMinimumStock = Number(minimumStock);

    if (
      !Number.isInteger(normalizedMinimumStock) ||
      normalizedMinimumStock < 0 ||
      normalizedMinimumStock > maximumInteger
    ) {
      setError("Informe um estoque mínimo inteiro e maior ou igual a zero.");
      return;
    }

    startTransition(async () => {
      const result =
        target.kind === "ITEM"
          ? await changeItemMinimumStock({
              item_id: target.itemId,
              minimum_stock: normalizedMinimumStock,
            })
          : await changeConfigurationMinimumStock({
              configuration_id: target.configurationId,
              minimum_stock: normalizedMinimumStock,
            });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onSuccess(
        result.receipt.changeApplied
          ? `Estoque mínimo alterado para ${result.receipt.newMinimumStock}.`
          : "O estoque mínimo já estava com esse valor.",
      );
    });
  }

  return (
    <DialogFrame
      dialogRef={dialogRef}
      titleId={titleId}
      descriptionId={descriptionId}
      title="Alterar estoque mínimo"
      isPending={isPending}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <div id={descriptionId} className="rounded-xl bg-app-background p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
            {target.kind === "ITEM" ? "Código" : "Código(s) comercial(is)"}
          </p>
          <p className="font-mono text-lg font-black text-text-primary">
            {target.kind === "ITEM"
              ? target.code
              : target.commercialCodes.join(" / ")}
          </p>
          <p className="mt-1 text-sm leading-5 font-semibold text-text-muted">
            {target.description}
          </p>
          {target.kind === "CONFIGURATION" ? (
            <p className="mt-2 text-xs leading-5 font-semibold text-violet-800">
              {target.commercialCodes.length > 1
                ? "Estes códigos representam a mesma Caixa completa e compartilham um único estoque mínimo."
                : "O estoque mínimo pertence à Caixa completa, não ao alias comercial."}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-border-neutral px-3 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Estoque mínimo atual
          </p>
          <p className="mt-1 font-mono text-xl font-black text-text-primary">
            {target.minimumStock}
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-text-primary">
            Novo estoque mínimo
          </span>
          <input
            ref={inputRef}
            type="number"
            min="0"
            max={maximumInteger}
            step="1"
            inputMode="numeric"
            required
            disabled={isPending}
            value={minimumStock}
            onChange={(event) => setMinimumStock(event.target.value)}
            className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
          />
          <span className="mt-1 block text-xs leading-5 text-text-muted">
            Use zero quando não houver limite mínimo configurado.
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="nk-focus min-h-12 rounded-xl border border-border-neutral px-4 text-sm font-bold text-text-primary disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="nk-focus min-h-12 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:cursor-wait disabled:opacity-70"
          >
            {isPending ? "Salvando..." : "Salvar estoque mínimo"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
