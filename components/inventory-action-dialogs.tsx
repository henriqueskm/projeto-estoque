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
  assembleCommercialConfiguration,
  changeConfigurationMinimumStock,
  changeItemMinimumStock,
  disassembleCommercialConfiguration,
} from "@/app/(authenticated)/estoque/actions";
import type {
  ConfigurationOperationType,
  InventoryActionTarget,
  InventoryConfigurationActionTarget,
} from "@/lib/inventory-action-types";

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
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
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
  wide = false,
}: Omit<DialogBaseProps, "onSuccess"> & {
  children: React.ReactNode;
  descriptionId: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  isPending: boolean;
  title: string;
  titleId: string;
  wide?: boolean;
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
      <div
        className={`max-h-full w-full overflow-y-auto rounded-2xl border border-brand-gold/35 bg-surface shadow-2xl ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
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

export function ConfigurationOperationDialog({
  target,
  operationType,
  onClose,
  onSuccess,
}: DialogBaseProps & {
  target: InventoryConfigurationActionTarget;
  operationType: ConfigurationOperationType;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const selectableAliases = target.commercialAliases.filter(
    (alias) => operationType === "DISASSEMBLY" || alias.isActive,
  );
  const [commercialCode, setCommercialCode] = useState(
    selectableAliases[0]?.code ?? "",
  );
  const [quantity, setQuantity] = useState("1");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const idempotencyKeyRef = useRef<string | null>(null);
  const hasSubmittedRef = useRef(false);
  const submitGuardRef = useRef(false);
  const isAssembly = operationType === "ASSEMBLY";
  const maximumQuantity = isAssembly
    ? Math.min(
        target.servo.looseQuantity,
        target.installationKit.looseQuantity,
      )
    : target.assembledQuantity;
  const parsedQuantity = Number(quantity);
  const hasValidQuantity =
    Number.isInteger(parsedQuantity) &&
    parsedQuantity > 0 &&
    parsedQuantity <= maximumQuantity &&
    parsedQuantity <= maximumInteger;
  const assemblyStatusAvailable =
    target.isActive &&
    target.servo.isActive &&
    target.installationKit.isActive;
  const operationUnavailableMessage = isAssembly
    ? !assemblyStatusAvailable
      ? "Esta caixa ou um dos componentes está inativo e não pode ser montado."
      : maximumQuantity <= 0
        ? "Sem saldo avulso suficiente para montar esta caixa."
        : null
    : maximumQuantity <= 0
      ? "Não há Caixas completas disponíveis para desmontar."
      : null;

  useAccessibleDialog(dialogRef, quantityInputRef, isPending, onClose);

  useEffect(() => {
    idempotencyKeyRef.current ??= crypto.randomUUID();
  }, []);

  function markPayloadChanged() {
    setError(null);

    if (hasSubmittedRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
      hasSubmittedRef.current = false;
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitGuardRef.current || isPending) {
      return;
    }

    setError(null);
    const normalizedDescription = description.trim();

    if (operationUnavailableMessage) {
      setError(operationUnavailableMessage);
      return;
    }

    if (!hasValidQuantity) {
      setError(
        `Informe uma quantidade inteira entre 1 e ${maximumQuantity}.`,
      );
      return;
    }

    if (normalizedDescription.length > maximumReasonLength) {
      setError(
        `A observação deve ter no máximo ${maximumReasonLength} caracteres.`,
      );
      return;
    }

    const idempotencyKey =
      idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    hasSubmittedRef.current = true;
    submitGuardRef.current = true;

    startTransition(async () => {
      try {
        const action = isAssembly
          ? assembleCommercialConfiguration
          : disassembleCommercialConfiguration;
        const result = await action({
          configuration_id: target.configurationId,
          quantity: parsedQuantity,
          idempotency_key: idempotencyKey,
          commercial_code: commercialCode || null,
          description: normalizedDescription || null,
        });

        if (!result.ok) {
          setError(result.error);
          return;
        }

        const receipt = result.receipt;
        const operationLabel = isAssembly ? "Montagem" : "Desmontagem";
        const commercialCodeLabel = receipt.commercialCode
          ? ` Código comercial: ${receipt.commercialCode}.`
          : "";

        onSuccess(
          `Operação confirmada. ${operationLabel} de ${receipt.quantity}. Servo avulso: ${receipt.servoQuantityBefore} → ${receipt.servoQuantityAfter}. Kit avulso: ${receipt.kitQuantityBefore} → ${receipt.kitQuantityAfter}. Caixas completas: ${receipt.configurationQuantityBefore} → ${receipt.configurationQuantityAfter}.${commercialCodeLabel}`,
        );
      } catch {
        setError(
          "A conexão falhou durante a confirmação. Tente novamente sem alterar os dados para reutilizar a mesma chave segura.",
        );
      } finally {
        submitGuardRef.current = false;
      }
    });
  }

  return (
    <DialogFrame
      dialogRef={dialogRef}
      titleId={titleId}
      descriptionId={descriptionId}
      title={isAssembly ? "Montar Caixa completa" : "Desmontar Caixa completa"}
      isPending={isPending}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={handleSubmit}
        aria-busy={isPending}
        className="space-y-5 p-4 sm:p-6"
      >
        <div id={descriptionId} className="rounded-xl bg-app-background p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Caixa completa
          </p>
          <p className="mt-1 font-mono text-lg font-black text-violet-900">
            {target.commercialCodes.length > 0
              ? target.commercialCodes.join(" / ")
              : "Sem código comercial"}
          </p>
          <p className="mt-1 text-sm leading-5 font-semibold text-text-primary">
            {target.description}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <article className="min-w-0 rounded-xl border border-border-neutral p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Servo {isAssembly ? "necessário" : "que retornará"}
            </p>
            <p className="mt-1 break-words font-mono text-sm font-black text-text-primary">
              {target.servo.code}
            </p>
            <p className="mt-1 text-xs leading-5 font-semibold text-text-muted">
              {target.servo.description}
            </p>
            <p className="mt-2 text-sm font-bold text-text-primary">
              Saldo avulso atual: {target.servo.looseQuantity}
            </p>
          </article>

          <article className="min-w-0 rounded-xl border border-border-neutral p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Kit {isAssembly ? "necessário" : "que retornará"}
            </p>
            <p className="mt-1 break-words font-mono text-sm font-black text-text-primary">
              {target.installationKit.code}
            </p>
            <p className="mt-1 text-xs leading-5 font-semibold text-text-muted">
              {target.installationKit.description}
            </p>
            <p className="mt-2 text-sm font-bold text-text-primary">
              Saldo avulso atual: {target.installationKit.looseQuantity}
            </p>
          </article>

          <article className="rounded-xl border border-violet-200 bg-violet-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-violet-800">
              Caixas completas atuais
            </p>
            <p className="mt-2 font-mono text-2xl font-black text-text-primary">
              {target.assembledQuantity}
            </p>
          </article>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-text-primary">
              Quantidade a {isAssembly ? "montar" : "desmontar"}
            </span>
            <input
              ref={quantityInputRef}
              type="number"
              min="1"
              max={Math.max(0, maximumQuantity)}
              step="1"
              inputMode="numeric"
              required
              disabled={isPending}
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                markPayloadChanged();
              }}
              className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
            />
            <span className="mt-1.5 block text-xs font-semibold text-text-muted">
              {isAssembly
                ? `Máximo disponível para montagem: ${maximumQuantity}`
                : `Máximo disponível para desmontagem: ${maximumQuantity}`}
            </span>
          </label>

          <div>
            <p className="mb-1.5 text-sm font-bold text-text-primary">
              Código comercial usado
            </p>
            {selectableAliases.length > 1 ? (
              <select
                value={commercialCode}
                disabled={isPending}
                onChange={(event) => {
                  setCommercialCode(event.target.value);
                  markPayloadChanged();
                }}
                className="nk-field min-h-12 w-full rounded-xl border px-3 text-base outline-none"
                aria-label="Código comercial usado na operação"
              >
                {selectableAliases.map((alias) => (
                  <option key={alias.code} value={alias.code}>
                    {alias.code}
                    {!alias.isActive ? " (inativo)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex min-h-12 items-center rounded-xl border border-border-neutral bg-app-background px-3 font-mono text-sm font-black text-text-primary">
                {selectableAliases[0]?.code ?? "Nenhum — auditoria sem alias"}
              </div>
            )}
            <p className="mt-1.5 text-xs leading-5 text-text-muted">
              O código identifica a operação no histórico. O saldo pertence à
              configuração física.
            </p>
          </div>
        </div>

        {operationUnavailableMessage ? (
          <p
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-5 font-semibold text-amber-950"
          >
            {operationUnavailableMessage}
          </p>
        ) : null}

        <section
          aria-label={`Prévia da ${isAssembly ? "montagem" : "desmontagem"}`}
          className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4"
        >
          <h3 className="text-sm font-black text-violet-950">
            Prévia da reorganização
          </h3>
          {hasValidQuantity ? (
            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-surface p-3">
                <dt className="text-xs font-bold text-text-muted">
                  {isAssembly ? "Servo avulso" : "Caixas completas"}
                </dt>
                <dd className="mt-1 font-mono font-black text-text-primary">
                  {isAssembly
                    ? `${target.servo.looseQuantity} → ${target.servo.looseQuantity - parsedQuantity}`
                    : `${target.assembledQuantity} → ${target.assembledQuantity - parsedQuantity}`}
                </dd>
              </div>
              <div className="rounded-xl bg-surface p-3">
                <dt className="text-xs font-bold text-text-muted">
                  {isAssembly ? "Kit avulso" : "Servo avulso"}
                </dt>
                <dd className="mt-1 font-mono font-black text-text-primary">
                  {isAssembly
                    ? `${target.installationKit.looseQuantity} → ${target.installationKit.looseQuantity - parsedQuantity}`
                    : `${target.servo.looseQuantity} → ${target.servo.looseQuantity + parsedQuantity}`}
                </dd>
              </div>
              <div className="rounded-xl bg-surface p-3">
                <dt className="text-xs font-bold text-text-muted">
                  {isAssembly ? "Caixas completas" : "Kit avulso"}
                </dt>
                <dd className="mt-1 font-mono font-black text-text-primary">
                  {isAssembly
                    ? `${target.assembledQuantity} → ${target.assembledQuantity + parsedQuantity}`
                    : `${target.installationKit.looseQuantity} → ${target.installationKit.looseQuantity + parsedQuantity}`}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm font-semibold text-text-muted">
              Informe uma quantidade válida para visualizar a prévia.
            </p>
          )}
          <p className="mt-3 text-xs leading-5 font-semibold text-violet-950">
            Esta operação reorganiza o estoque físico. Não representa venda ou
            entrada de mercadoria.
          </p>
        </section>

        <label className="block">
          <span className="mb-1.5 block text-sm font-bold text-text-primary">
            Observação <span className="font-normal text-text-muted">(opcional)</span>
          </span>
          <textarea
            maxLength={maximumReasonLength}
            rows={3}
            disabled={isPending}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              markPayloadChanged();
            }}
            placeholder="Ex.: reorganização das caixas na prateleira"
            className="nk-field w-full resize-y rounded-xl border px-3 py-3 text-base outline-none"
          />
          <span className="mt-1 block text-right text-xs text-text-muted">
            {description.length}/{maximumReasonLength}
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
            disabled={
              isPending ||
              Boolean(operationUnavailableMessage) ||
              !hasValidQuantity
            }
            className={`nk-focus min-h-12 rounded-xl px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60 ${
              isAssembly ? "bg-emerald-700" : "bg-violet-800"
            }`}
          >
            {isPending
              ? isAssembly
                ? "Montando..."
                : "Desmontando..."
              : isAssembly
                ? "Confirmar montagem"
                : "Confirmar desmontagem"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
