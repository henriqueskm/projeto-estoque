"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { CompatibleKitImages } from "@/components/compatible-kit-images";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import type {
  AssistantClarificationBlock,
  AssistantClarificationCategory,
  AssistantCatalogMediaBlock,
  AssistantCatalogMediaTarget,
  AssistantInventoryAlertCard,
  AssistantInventoryAlertsBlock,
  AssistantInventoryItemSummaryBlock,
  AssistantInventoryItemSummaryTarget,
  AssistantMediaDescriptor,
  AssistantPurchaseRecommendationBlock,
  AssistantSupplierOrderAggregateBlock,
  AssistantSupplierOrderAmbiguityBlock,
  AssistantSupplierOrderCard,
  AssistantSupplierOrderCatalogLine,
  AssistantSupplierOrderDetailBlock,
  AssistantSupplierOrderItemCard,
  AssistantSupplierOrderListBlock,
  AssistantSupplierOrderPickupPreviewBlock,
  AssistantSupplierOrderPickupResultBlock,
  AssistantSupplierOrderStockEntryPreviewBlock,
  AssistantSupplierOrderStockEntryResultBlock,
  AssistantManualStockEntryPreviewBlock,
  AssistantManualStockEntryResultBlock,
  AssistantManualStockOutputPreviewBlock,
  AssistantManualStockOutputResultBlock,
  AssistantConfigurationAssemblyPreviewBlock,
  AssistantConfigurationAssemblyResultBlock,
  AssistantConfigurationAssemblySelection,
  AssistantConfigurationDisassemblyPreviewBlock,
  AssistantConfigurationDisassemblyResultBlock,
  AssistantConfigurationDisassemblySelection,
  AssistantSupplierOrderFinalizationPreviewBlock,
  AssistantSupplierOrderFinalizationResultBlock,
  AssistantSupplierOrderPhotoPreviewBlock,
  AssistantSupplierOrderPhotoCreateResultBlock,
  AssistantStockEntryTarget,
  AssistantServoModelInventoryAction,
  AssistantServoModelInventoryBreakdownBlock,
  AssistantStructuredBlock,
  AssistantStockEntrySelection,
  AssistantStockOutputSelection,
  AssistantStatisticsBlock,
} from "@/lib/assistant-types";
import type { PurchaseRecommendationItem } from "@/lib/purchase-recommendation-types";
import { updateSupplierOrderPhotoPreviewLine } from "@/lib/assistant-supplier-order-photo-preview";
import {
  createSupplierOrderPhotoPrepareInputFromPreview,
  parseAssistantSupplierOrderPhotoCreateResultBlock,
  parseSupplierOrderPhotoCreatePreparation,
  supplierOrderPhotoPreviewCanCreate,
  type SupplierOrderPhotoCreatePreparation,
} from "@/lib/assistant-supplier-order-photo-create-contract";
import { useDocumentScrollLock } from "@/lib/use-document-scroll-lock";

const quantityFormatter = new Intl.NumberFormat("pt-BR");
const orderDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const orderStatusLabels = {
  PENDING: "Pendente",
  PARTIAL: "Parcial",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
} as const;

function AssistantStatistics({ block }: { block: AssistantStatisticsBlock }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-neutral bg-surface" aria-label={block.title}>
      <div className="border-b border-border-neutral px-4 py-3">
        <p className="text-[11px] font-black tracking-[0.12em] text-brand-gold-ink uppercase">Estatísticas · últimos {block.period} dias</p>
        <h3 className="mt-1 text-base font-black text-text-primary">{block.title}</h3>
        <p className="mt-1 text-sm leading-5 font-semibold text-text-muted">{block.description}</p>
      </div>
      {block.metrics.length > 0 ? (
        <dl className="grid grid-cols-2 gap-px bg-border-neutral sm:grid-cols-4">
          {block.metrics.map((metric) => (
            <div key={metric.label} className="bg-surface px-3 py-2.5">
              <dt className="text-[10px] font-black tracking-wide text-text-muted uppercase">{metric.label}</dt>
              <dd className="mt-0.5 text-xl font-black tabular-nums text-text-primary">{quantityFormatter.format(metric.value)}</dd>
              {metric.detail ? <dd className="text-xs font-bold text-text-muted">{metric.detail}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}
      {block.ranking.length > 0 ? (
        <ol className="divide-y divide-border-neutral">
          {block.ranking.map((item) => (
            <li key={`${item.position}-${item.code}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
              <span className="text-sm font-black text-brand-gold-ink">{item.position}º</span>
              <span className="min-w-0">
                <strong className="block text-sm font-black text-text-primary">Cód. {item.code}</strong>
                <span className="block text-xs leading-4 font-semibold text-text-muted">{item.description}</span>
              </span>
              <strong className="text-sm font-black tabular-nums text-text-primary">{quantityFormatter.format(item.quantity)}</strong>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="border-t border-border-neutral px-3 py-2.5">
        <Link href={block.statisticsHref} className="nk-focus inline-flex min-h-10 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary hover:bg-app-background">
          Abrir Estatísticas
        </Link>
      </div>
    </section>
  );
}

function SupplierOrderPhotoPreview({
  block,
  disabled,
  onUpdate,
}: {
  block: AssistantSupplierOrderPhotoPreviewBlock;
  disabled: boolean;
  onUpdate?: (
    block: AssistantSupplierOrderPhotoPreviewBlock | AssistantSupplierOrderPhotoCreateResultBlock,
  ) => void;
}) {
  const [dialog, setDialog] = useState<null | { mode: "correct" | "create"; lineIndex: number; code: string; description: string }>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const submitInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const createDialogRef = useRef<HTMLElement>(null);
  const createCancelRef = useRef<HTMLButtonElement>(null);
  const [createProposal, setCreateProposal] = useState<SupplierOrderPhotoCreatePreparation | null>(null);
  const [isPreparingCreate, setIsPreparingCreate] = useState(false);
  const [isConfirmingCreate, setIsConfirmingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createDialogTitleId = useId();
  const dialogMode = dialog?.mode;
  useDocumentScrollLock(Boolean(dialog || createProposal));

  useEffect(() => {
    if (!dialogMode) return;
    firstFieldRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        setDialog(null);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        );
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogMode, isSubmitting]);

  useEffect(() => {
    if (!createProposal) return;
    createCancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isConfirmingCreate) {
        event.preventDefault();
        setCreateProposal(null);
        setCreateError(null);
        window.requestAnimationFrame(() => createTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const controls = createDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [createProposal, isConfirmingCreate]);

  function closeDialog() {
    if (isSubmitting) return;
    setDialog(null);
    setDialogError(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function submitDialog() {
    if (!dialog || submitInFlightRef.current || !onUpdate) return;
    const code = dialog.code.trim();
    const description = dialog.description.trim();
    if (!code || code.length > 120 || (dialog.mode === "create" && (!description || description.length > 500))) {
      setDialogError("Revise o código e a descrição informados.");
      return;
    }
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setDialogError(null);
    try {
      const endpoint = dialog.mode === "correct"
        ? "/api/assistant/order-photo/resolve-code"
        : "/api/assistant/order-photo/create-loose-part";
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dialog.mode === "correct" ? { code } : { code, description }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const result = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown> : null;
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Não foi possível concluir a operação.");
      if (dialog.mode === "correct" && result?.status === "NOT_FOUND") {
        setDialog({ ...dialog, mode: "create", code });
        setDialogError("Código não cadastrado. Você pode cadastrar uma peça avulsa.");
        return;
      }
      if (typeof result?.code !== "string" || typeof result.description !== "string") {
        throw new Error("Não foi possível validar o retorno do catálogo.");
      }
      onUpdate(updateSupplierOrderPhotoPreviewLine(block, dialog.lineIndex, {
        code: result.code, description: result.description,
      }));
      setNotice(dialog.mode === "create"
        ? `Peça avulsa ${result.created === false ? "já cadastrada" : "cadastrada"}. Estoque inicial: 0.`
        : `Cód. ${result.code} identificado no catálogo.`);
      setDialog(null);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Não foi possível concluir a operação.");
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function prepareCreate(trigger: HTMLButtonElement) {
    if (createInFlightRef.current || disabled || !onUpdate) return;
    const input = createSupplierOrderPhotoPrepareInputFromPreview(block);
    if (!input) {
      setCreateError("Revise todos os dados antes de criar o Pedido.");
      return;
    }
    createTriggerRef.current = trigger;
    createInFlightRef.current = true;
    setIsPreparingCreate(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/assistant/order-photo/prepare-create", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown> : null;
      const duplicate = parseAssistantSupplierOrderPhotoCreateResultBlock(record?.block);
      if (duplicate?.outcome === "duplicate") {
        onUpdate(duplicate);
        return;
      }
      const preparation = parseSupplierOrderPhotoCreatePreparation(record?.preparation);
      if (!response.ok || record?.status !== "READY" || !preparation) {
        throw new Error(typeof record?.error === "string"
          ? record.error : "Não foi possível preparar a criação agora.");
      }
      setCreateProposal(preparation);
    } catch (error) {
      setCreateError(error instanceof Error
        ? error.message : "Não foi possível preparar a criação agora.");
    } finally {
      createInFlightRef.current = false;
      setIsPreparingCreate(false);
    }
  }

  function closeCreateDialog() {
    if (isConfirmingCreate) return;
    setCreateProposal(null);
    setCreateError(null);
    window.requestAnimationFrame(() => createTriggerRef.current?.focus());
  }

  async function confirmCreate() {
    if (!createProposal || createInFlightRef.current || !onUpdate) return;
    createInFlightRef.current = true;
    setIsConfirmingCreate(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/assistant/order-photo/confirm-create", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalToken: createProposal.proposalToken }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown> : null;
      const result = parseAssistantSupplierOrderPhotoCreateResultBlock(record?.block);
      if (!response.ok || !result) {
        throw new Error(typeof record?.error === "string"
          ? record.error
          : "Não foi possível confirmar o resultado. Verifique se o Pedido foi criado antes de iniciar uma nova tentativa.");
      }
      onUpdate(result);
      setCreateProposal(null);
    } catch (error) {
      setCreateError(error instanceof Error
        ? error.message
        : "Não foi possível confirmar o resultado. Verifique se o Pedido foi criado antes de iniciar uma nova tentativa.");
    } finally {
      createInFlightRef.current = false;
      setIsConfirmingCreate(false);
    }
  }

  const stateLabels = {
    READY_FOR_REVIEW: "Pronta para revisão",
    NEEDS_REVIEW: "Precisa de revisão",
    DUPLICATE_NEGOTIATION: "Pedido existente",
    NOT_A_SUPPLIER_ORDER: "Documento não identificado",
    UNREADABLE: "Foto ilegível",
    ERROR: "Análise indisponível",
  } as const;

  return (
    <section className="overflow-hidden rounded-2xl border border-border-neutral bg-surface shadow-sm">
      <div className="border-b border-border-neutral bg-violet-50 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[0.65rem] font-black tracking-[0.12em] text-violet-800 uppercase">
              Foto do Pedido
            </p>
            <h3 className="mt-0.5 text-base font-black text-text-primary">{block.title}</h3>
          </div>
          <span className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[0.65rem] font-black text-violet-800">
            {stateLabels[block.state]}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 font-semibold text-text-muted">{block.message}</p>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-950">
          {block.banner}
        </div>

        {(block.negotiationNumber || block.orderDate) ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-app-background p-3 text-sm">
            <div>
              <span className="block text-[0.62rem] font-black tracking-wide text-text-muted uppercase">Pedido</span>
              <strong className="text-text-primary">{block.negotiationNumber ?? "Não identificado"}</strong>
            </div>
            <div>
              <span className="block text-[0.62rem] font-black tracking-wide text-text-muted uppercase">Data</span>
              <strong className="text-text-primary">
                {block.orderDate ? orderDateFormatter.format(new Date(`${block.orderDate}T00:00:00Z`)) : "Não identificada"}
              </strong>
            </div>
          </div>
        ) : null}

        {block.lines.length ? (
          <div className="divide-y divide-border-neutral overflow-hidden rounded-xl border border-border-neutral">
            {block.lines.map((line, index) => {
              const hasCodeBlocker = line.blockingReasons.some((reason) => reason.startsWith("CODE_"));
              const hasCatalogAmbiguity = line.blockingReasons.includes("CODE_AMBIGUOUS") &&
                line.catalogOptions.length > 0;
              const canCreateDirectly = line.blockingReasons.includes("CODE_NOT_FOUND") &&
                !line.blockingReasons.includes("CODE_UNCERTAIN") && Boolean(line.rawCode);
              return (
              <article key={`${line.rawCode ?? "unknown"}-${index}`} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-violet-800">
                      {line.displayCode ? `Cód. ${line.displayCode}` : "Código não identificado"}
                    </p>
                    <p className="mt-0.5 break-words text-sm font-black text-text-primary">
                      {line.description ?? line.rawDescription ?? "Descrição não identificada"}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[0.62rem] font-black ${line.resolution === "IDENTIFIED" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"}`}>
                    {line.resolution === "IDENTIFIED" ? "Identificado" : "Revisar"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-text-muted">
                    Quantidade: <strong className="text-text-primary">{line.quantity ?? "ilegível"}</strong>
                  </span>
                  {line.consolidatedLineCount > 1 ? (
                    <span className="font-semibold text-text-muted">{line.consolidatedLineCount} linhas consolidadas</span>
                  ) : null}
                </div>
                {line.warning ? (
                  <p className={`mt-2 text-xs leading-5 font-semibold ${line.resolution === "IDENTIFIED" ? "text-sky-800" : "text-amber-900"}`}>
                    {line.resolution === "IDENTIFIED" ? "ℹ" : "⚠"} {line.warning}
                  </p>
                ) : null}
                {line.resolution === "NEEDS_REVIEW" && hasCatalogAmbiguity ? (
                  <fieldset className="mt-3 space-y-2">
                    <legend className="text-xs font-black text-text-primary">Definir produto</legend>
                    <div className="grid gap-2">
                      {line.catalogOptions.map((option) => (
                        <button
                          key={`${option.code}-${option.description}`}
                          type="button"
                          disabled={disabled || isSubmitting}
                          onClick={() => {
                            if (!onUpdate) return;
                            onUpdate(updateSupplierOrderPhotoPreviewLine(block, index, option));
                            setNotice(`Cód. ${option.code} definido para a linha da foto.`);
                          }}
                          className="nk-focus min-h-11 rounded-xl border border-border-neutral bg-surface px-3 py-2 text-left transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50"
                        >
                          <strong className="block text-xs text-violet-800">Cód. {option.code}</strong>
                          <span className="mt-0.5 block text-xs font-semibold text-text-muted">{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : line.resolution === "NEEDS_REVIEW" && hasCodeBlocker ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={disabled || isSubmitting} onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      setDialogError(null);
                      setDialog({ mode: "correct", lineIndex: index, code: line.displayCode ?? line.rawCode ?? "", description: line.rawDescription ?? "" });
                    }} className="nk-focus min-h-10 rounded-xl border border-border-neutral px-3 text-xs font-black text-text-primary hover:bg-app-background disabled:opacity-50">
                      Corrigir código
                    </button>
                    {canCreateDirectly ? (
                      <button type="button" disabled={disabled || isSubmitting} onClick={(event) => {
                        triggerRef.current = event.currentTarget;
                        setDialogError(null);
                        setDialog({ mode: "create", lineIndex: index, code: line.rawCode ?? "", description: line.rawDescription ?? "" });
                      }} className="nk-focus min-h-10 rounded-xl bg-brand-charcoal px-3 text-xs font-black text-white hover:bg-brand-charcoal-soft disabled:opacity-50">
                        Cadastrar peça avulsa
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );})}
          </div>
        ) : null}

        {notice ? <p role="status" className="text-xs font-bold text-emerald-800">{notice}</p> : null}

        {block.warnings.length ? (
          <ul className="space-y-1 text-xs leading-5 font-semibold text-amber-900">
            {block.warnings.map((warning, index) => <li key={`${warning}-${index}`}>⚠ {warning}</li>)}
          </ul>
        ) : null}

        {block.lines.length ? (
          <p className="text-right text-sm font-black text-text-primary">Total: {quantityFormatter.format(block.totalQuantity)} unidades</p>
        ) : null}

        {block.existingOrder ? (
          <Link href={block.existingOrder.href} className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary hover:bg-app-background">
            Abrir Pedido {block.existingOrder.negotiationNumber}
          </Link>
        ) : null}

        {supplierOrderPhotoPreviewCanCreate(block) ? (
          <div className="border-t border-border-neutral pt-3">
            <button
              type="button"
              disabled={disabled || isPreparingCreate || isSubmitting}
              onClick={(event) => void prepareCreate(event.currentTarget)}
              className="nk-focus inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isPreparingCreate ? "Preparando confirmação..." : "Criar Pedido"}
            </button>
            {!createProposal && createError ? (
              <p role="alert" className="mt-2 text-xs font-bold text-red-800">{createError}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {dialog ? (
        <div className="fixed inset-0 z-[180] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="photo-line-dialog-title" className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-2xl sm:p-6">
            <h3 id="photo-line-dialog-title" className="text-lg font-black text-text-primary">
              {dialog.mode === "create" ? "Cadastrar peça avulsa" : "Corrigir código"}
            </h3>
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-black text-text-primary">Código
                <input ref={firstFieldRef} value={dialog.code} maxLength={120} disabled={isSubmitting} onChange={(event) => setDialog({ ...dialog, code: event.target.value })} className="nk-field mt-1 block min-h-11 w-full rounded-xl border px-3" />
              </label>
              {dialog.mode === "create" ? (
                <>
                  <label className="block text-sm font-black text-text-primary">Descrição
                    <input value={dialog.description} maxLength={500} disabled={isSubmitting} onChange={(event) => setDialog({ ...dialog, description: event.target.value })} className="nk-field mt-1 block min-h-11 w-full rounded-xl border px-3" />
                  </label>
                  <div className="rounded-xl bg-app-background px-3 py-2 text-sm"><strong>Tipo:</strong> Peça avulsa</div>
                  <p className="text-xs leading-5 font-semibold text-text-muted">Isso cria somente o cadastro da peça. Não adiciona estoque e não cria o Pedido.</p>
                </>
              ) : null}
              {dialogError ? <p role="alert" className="text-sm font-bold text-red-800">{dialogError}</p> : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={isSubmitting} onClick={closeDialog} className="nk-focus min-h-11 rounded-xl border border-border-neutral px-4 text-sm font-black">Cancelar</button>
              <button type="button" disabled={isSubmitting} onClick={() => void submitDialog()} className="nk-focus min-h-11 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:opacity-50">
                {isSubmitting ? "Aguarde..." : dialog.mode === "create" ? "Cadastrar peça" : "Validar código"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {createProposal ? (
        <div
          className="fixed inset-0 z-[190] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeCreateDialog();
          }}
        >
          <section
            ref={createDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={createDialogTitleId}
            className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border-neutral bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-6"
          >
            <h3 id={createDialogTitleId} className="text-lg font-black text-text-primary">
              Confirmar criação do Pedido
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-app-background p-3 text-sm">
              <div>
                <span className="block text-[0.62rem] font-black tracking-wide text-text-muted uppercase">Pedido</span>
                <strong>{createProposal.negotiationNumber}</strong>
              </div>
              <div>
                <span className="block text-[0.62rem] font-black tracking-wide text-text-muted uppercase">Data</span>
                <strong>{orderDateFormatter.format(new Date(`${createProposal.orderDate}T00:00:00Z`))}</strong>
              </div>
            </div>
            <div className="mt-3 divide-y divide-border-neutral overflow-hidden rounded-xl border border-border-neutral">
              {createProposal.lines.map((line) => (
                <div key={`${line.kind}-${line.targetId}-${line.commercialConfigurationCodeId ?? "none"}`} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-violet-800">Cód. {line.code}</p>
                      <p className="break-words text-sm font-bold text-text-primary">{line.description}</p>
                    </div>
                    <strong className="shrink-0 text-sm text-text-primary">{quantityFormatter.format(line.quantity)}</strong>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-right text-sm font-black text-text-primary">
              Total: {quantityFormatter.format(createProposal.totalQuantity)} unidades
            </p>
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 font-bold text-amber-950">
              Isso cria o Pedido. Nenhuma entrada ou retirada de estoque será realizada.
            </p>
            {createError ? <p role="alert" className="mt-3 text-sm font-bold text-red-800">{createError}</p> : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={createCancelRef}
                type="button"
                disabled={isConfirmingCreate}
                onClick={closeCreateDialog}
                className="nk-focus min-h-11 rounded-xl border border-border-neutral px-4 text-sm font-black text-text-primary disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isConfirmingCreate}
                onClick={() => void confirmCreate()}
                className="nk-focus min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isConfirmingCreate ? "Criando Pedido..." : "Confirmar criação"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SupplierOrderPhotoCreateResult({
  block,
}: {
  block: AssistantSupplierOrderPhotoCreateResultBlock;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border shadow-sm ${
      block.outcome === "success"
        ? "border-emerald-200 bg-emerald-50/40"
        : "border-amber-200 bg-amber-50/40"
    }`}>
      <div className="p-4">
        <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-dark uppercase">
          Resultado da ação
        </p>
        <h3 className="mt-1 text-lg font-black text-text-primary">{block.title}</h3>
        <p className="mt-1 text-sm font-semibold text-text-muted">{block.message}</p>
        {block.outcome === "success" ? (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface p-3 text-center">
            <div>
              <span className="block text-[0.62rem] font-black text-text-muted uppercase">Linhas</span>
              <strong>{quantityFormatter.format(block.lineCount)}</strong>
            </div>
            <div>
              <span className="block text-[0.62rem] font-black text-text-muted uppercase">Unidades</span>
              <strong>{quantityFormatter.format(block.totalQuantity)}</strong>
            </div>
          </div>
        ) : null}
        <Link
          href={block.order.href}
          className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
        >
          Abrir Pedido
        </Link>
      </div>
    </section>
  );
}

function MediaControl({
  descriptor,
  labeled = false,
}: {
  descriptor: AssistantMediaDescriptor | null;
  labeled?: boolean;
}) {
  if (!descriptor) {
    return null;
  }

  if (descriptor.kind === "commercial_configuration_image") {
    return (
      <CommercialConfigurationImage
        commercialCodes={descriptor.commercialCodes}
        imageUrl={descriptor.imageUrl}
        triggerVariant={labeled ? "assistant-action" : "icon-button"}
      />
    );
  }

  return (
    <CompatibleKitImages
      kitCode={descriptor.kitCode}
      options={descriptor.options}
      triggerVariant={labeled ? "assistant-action" : "icon-button"}
    />
  );
}

function AlertCard({ item }: { item: AssistantInventoryAlertCard }) {
  const isZero = item.status === "ZERO";

  return (
    <article
      className={`relative overflow-hidden rounded-xl border ${
        isZero
          ? "border-red-200 bg-red-50/70"
          : "border-amber-200 bg-amber-50/70"
      }`}
    >
      <Link
        href={item.href}
        className="nk-focus block min-h-24 rounded-xl p-3 pr-14 transition hover:bg-white/60"
        aria-label={`Abrir código ${item.displayCode} no Estoque`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-black text-text-primary">
            Cód. {item.displayCode}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[0.62rem] font-black uppercase ${
              isZero
                ? "bg-red-100 text-red-900"
                : "bg-amber-100 text-amber-950"
            }`}
          >
            {isZero ? "Zerado" : "Baixo"}
          </span>
        </span>
        <span className="mt-1.5 block break-words text-sm font-bold text-text-primary">
          {item.description}
        </span>
        <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-text-muted">
          <span>
            Estoque:{" "}
            <strong className="font-black text-text-primary">
              {quantityFormatter.format(item.currentStock)}
            </strong>
          </span>
          <span>
            Mínimo:{" "}
            <strong className="font-black text-text-primary">
              {quantityFormatter.format(item.minimumStock)}
            </strong>
          </span>
        </span>
      </Link>
      {item.mediaDescriptor ? (
        <div className="absolute top-3 right-3">
          <MediaControl descriptor={item.mediaDescriptor} />
        </div>
      ) : null}
    </article>
  );
}

function AlertSection({
  title,
  items,
}: {
  title: string;
  items: AssistantInventoryAlertCard[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mt-4" aria-label={title}>
      <h4 className="mb-2 text-[0.68rem] font-black tracking-[0.12em] text-text-muted uppercase">
        {title}
      </h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <AlertCard
            key={`${item.targetKind}-${item.targetId}`}
            item={item}
          />
        ))}
      </div>
    </section>
  );
}

function InventoryAlertsBlock({
  block,
}: {
  block: AssistantInventoryAlertsBlock;
}) {
  const hasAlerts = block.summary.totalCount > 0;

  return (
    <div className="min-w-0">
      <header>
        <p className="text-[0.65rem] font-black tracking-[0.14em] text-brand-gold-ink uppercase">
          Estoque
        </p>
        <h3 className="text-base font-black text-text-primary sm:text-lg">
          {hasAlerts ? block.title : "Estoque em dia"}
        </h3>
        <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">
          {hasAlerts
            ? `${quantityFormatter.format(block.summary.zeroCount)} ${
                block.summary.zeroCount === 1 ? "zerado" : "zerados"
              } · ${quantityFormatter.format(block.summary.lowCount)} ${
                block.summary.lowCount === 1 ? "baixo" : "baixos"
              }`
            : "Nenhum item precisa de reposição no momento."}
        </p>
      </header>

      <AlertSection title="Zerados" items={block.zeroItems} />
      <AlertSection title="Baixos" items={block.lowItems} />

      {block.remainingCount > 0 ? (
        <p className="mt-3 text-xs font-bold text-text-muted">
          + {quantityFormatter.format(block.remainingCount)}{" "}
          {block.remainingCount === 1
            ? "item adicional precisa"
            : "itens adicionais precisam"}{" "}
          de atenção.
        </p>
      ) : null}

      <Link
        href={block.inventoryHref}
        className="nk-focus mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
      >
        {hasAlerts ? "Ver todos no Estoque" : "Abrir Estoque"}
      </Link>
    </div>
  );
}

const inventoryStatusClasses = {
  ZERO: "bg-red-100 text-red-900",
  LOW: "bg-amber-100 text-amber-950",
  OK: "bg-emerald-100 text-emerald-900",
  NO_MINIMUM: "bg-slate-100 text-slate-700",
} as const;

function InventoryItemPrimaryMetric({
  block,
  target,
}: {
  block: AssistantInventoryItemSummaryBlock;
  target: AssistantInventoryItemSummaryTarget;
}) {
  if (block.metric === "MINIMUM") {
    return (
      <>
        <span className="text-[0.65rem] font-black tracking-[0.1em] text-text-muted uppercase">
          Estoque mínimo
        </span>
        <strong className="mt-0.5 block text-2xl font-black tabular-nums text-text-primary">
          {target.minimumStock === null
            ? "Não definido"
            : quantityFormatter.format(target.minimumStock)}
        </strong>
      </>
    );
  }

  if (block.metric === "STATUS") {
    return (
      <>
        <span className="text-[0.65rem] font-black tracking-[0.1em] text-text-muted uppercase">
          Situação
        </span>
        <strong className="mt-1 block text-xl font-black text-text-primary">
          {target.statusLabel}
        </strong>
      </>
    );
  }

  if (block.metric === "SHORTFALL") {
    return (
      <>
        <span className="text-[0.65rem] font-black tracking-[0.1em] text-text-muted uppercase">
          Falta para o mínimo
        </span>
        <strong className="mt-0.5 block text-2xl font-black tabular-nums text-text-primary">
          {target.shortfall === null
            ? "Não definido"
            : quantityFormatter.format(target.shortfall)}
        </strong>
        {target.shortfall !== null ? (
          <span className="text-xs font-bold text-text-muted">
            {target.shortfall === 1 ? "unidade" : "unidades"}
          </span>
        ) : null}
      </>
    );
  }

  if (
    block.metric === "DESCRIPTION" ||
    block.metric === "COMPOSITION"
  ) {
    return (
      <>
        <span className="text-[0.65rem] font-black tracking-[0.1em] text-text-muted uppercase">
          Estoque atual
        </span>
        <strong className="mt-0.5 block text-xl font-black tabular-nums text-text-primary">
          {quantityFormatter.format(target.currentStock)}{" "}
          <span className="text-sm">{target.stockUnitLabel}</span>
        </strong>
      </>
    );
  }

  return (
    <>
      <span className="text-[0.65rem] font-black tracking-[0.1em] text-text-muted uppercase">
        Estoque atual
      </span>
      <strong className="mt-0.5 block text-2xl font-black tabular-nums text-text-primary">
        {quantityFormatter.format(target.currentStock)}
      </strong>
      <span className="text-xs font-bold text-text-muted">
        {target.stockUnitLabel}
      </span>
    </>
  );
}

function InventoryItemSummaryCard({
  block,
  target,
}: {
  block: AssistantInventoryItemSummaryBlock;
  target: AssistantInventoryItemSummaryTarget;
}) {
  const badgeShowsStatus = block.metric === "MINIMUM";
  const badgeLabel = badgeShowsStatus
    ? target.statusLabel
    : target.minimumStock === null
      ? "Mínimo não definido"
      : `Mínimo: ${quantityFormatter.format(target.minimumStock)}`;

  return (
    <article className="min-w-0 rounded-xl border border-border-neutral bg-surface p-3 shadow-sm sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-black text-text-primary">
          Cód. {target.displayCode}
        </span>
        <span className="rounded-full border border-border-neutral px-2 py-1 text-[0.62rem] font-black tracking-[0.08em] text-text-muted uppercase">
          {target.typeLabel}
        </span>
      </header>

      <h4 className="mt-2 break-words text-sm font-black text-text-primary sm:text-base">
        {target.description}
      </h4>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-y border-border-neutral py-3">
        <div className="min-w-0">
          <InventoryItemPrimaryMetric block={block} target={target} />
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[0.68rem] font-black ${
            badgeShowsStatus
              ? inventoryStatusClasses[target.status]
              : "bg-slate-100 text-slate-700"
          }`}
        >
          {badgeLabel}
        </span>
      </div>

      {target.composition ? (
        <dl className="mt-3 grid gap-2 border-t border-border-neutral pt-3 text-xs sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="font-black text-text-muted">
              Servoembreagem
            </dt>
            <dd className="mt-0.5 break-words font-bold text-text-primary">
              Cód. {target.composition.servoCode} ·{" "}
              {target.composition.servoDescription}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="font-black text-text-muted">
              Kit de instalação
            </dt>
            <dd className="mt-0.5 break-words font-bold text-text-primary">
              Cód. {target.composition.installationKitCode} ·{" "}
              {target.composition.installationKitDescription}
            </dd>
          </div>
        </dl>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {target.mediaDescriptor ? (
          <MediaControl descriptor={target.mediaDescriptor} labeled />
        ) : null}
        <Link
          href={target.href}
          className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-charcoal px-3 text-xs font-black text-white transition hover:bg-brand-charcoal-soft"
          aria-label={`Abrir código ${target.displayCode} no Estoque`}
        >
          Abrir no Estoque
        </Link>
      </footer>
    </article>
  );
}

function InventoryItemSummaryBlock({
  block,
}: {
  block: AssistantInventoryItemSummaryBlock;
}) {
  if (block.status === "NOT_FOUND") {
    return (
      <div className="min-w-0">
        <h3 className="font-black text-text-primary">
          Código não encontrado
        </h3>
        <p className="mt-1 text-sm font-semibold text-text-muted">
          {block.primaryText}
        </p>
        <Link
          href={block.inventoryHref}
          className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
        >
          Abrir busca no Estoque
        </Link>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="text-sm font-bold text-text-primary">
        {block.primaryText}
      </p>
      {block.status === "AMBIGUOUS" ? (
        <p className="mt-1 text-xs font-semibold text-text-muted">
          Nenhum resultado foi escolhido automaticamente.
        </p>
      ) : null}
      <div className="mt-3 grid gap-3">
        {block.results.map((target) => (
          <InventoryItemSummaryCard
            key={`${target.targetKind}-${target.targetId}`}
            block={block}
            target={target}
          />
        ))}
      </div>
    </div>
  );
}

function ServoModelBreakdownTarget({
  target,
  codes,
}: {
  target: AssistantInventoryItemSummaryTarget;
  codes: string[];
}) {
  return (
    <article className="min-w-0 rounded-xl border border-border-neutral bg-surface p-3 shadow-sm">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-[0.68rem] font-black tracking-[0.1em] text-text-muted uppercase">
          {target.typeLabel}
        </span>
        <span className="max-w-full break-words rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-black whitespace-normal text-text-primary">
          Cód. {codes.join(" / ")}
        </span>
      </header>
      <p className="mt-2 break-words text-sm font-black text-text-primary">
        {target.description}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-1.5 border-y border-border-neutral py-2.5">
        <div className="min-w-0">
          <dt className="text-[0.58rem] font-black tracking-wide text-text-muted uppercase">
            Estoque
          </dt>
          <dd className="mt-0.5 text-lg font-black tabular-nums text-text-primary">
            {quantityFormatter.format(target.currentStock)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.58rem] font-black tracking-wide text-text-muted uppercase">
            Mínimo
          </dt>
          <dd className="mt-0.5 break-words text-sm font-black text-text-primary">
            {target.minimumStock === null
              ? "Não definido"
              : quantityFormatter.format(target.minimumStock)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.58rem] font-black tracking-wide text-text-muted uppercase">
            Situação
          </dt>
          <dd
            className={`mt-0.5 inline-flex max-w-full justify-center rounded-full px-2 py-0.5 text-center text-[0.62rem] leading-tight font-black whitespace-normal ${inventoryStatusClasses[target.status]}`}
          >
            {target.statusLabel}
          </dd>
        </div>
      </dl>
      <Link
        href={target.href}
        className="nk-focus mt-2.5 inline-flex min-h-11 items-center justify-center rounded-xl border border-border-neutral px-3 text-xs font-black text-text-primary transition hover:bg-app-background"
      >
        Abrir no Estoque
      </Link>
    </article>
  );
}

function ServoModelInventoryBreakdown({
  block,
}: {
  block: AssistantServoModelInventoryBreakdownBlock;
}) {
  const mountedConfigurationsOnly =
    block.scope === "MOUNTED_CONFIGURATIONS";

  return (
    <div className="min-w-0">
      <p className="text-[0.68rem] font-black tracking-[0.12em] text-brand-gold-dark uppercase">
        {mountedConfigurationsOnly ? "Configurações com kit" : "Estoque por modelo"}
      </p>
      <h3 className="mt-0.5 break-words text-base font-black text-text-primary sm:text-lg">
        {mountedConfigurationsOnly
          ? `Configurações do modelo ${block.model.official}`
          : `Estoque do modelo ${block.model.official}`}
      </h3>
      <p className="mt-1 text-xs font-semibold text-text-muted">
        {mountedConfigurationsOnly
          ? "Somente os Servos montados com kit são mostrados aqui."
          : "Cada saldo físico é mostrado separadamente."}
      </p>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {!mountedConfigurationsOnly && block.bareServo ? (
          <ServoModelBreakdownTarget
            target={block.bareServo}
            codes={[block.bareServo.displayCode]}
          />
        ) : null}
        {block.configurations.map(({ target, aliases }) => (
          <ServoModelBreakdownTarget
            key={target.targetId}
            target={target}
            codes={aliases}
          />
        ))}
      </div>
      {block.remainingConfigurations > 0 ? (
        <p className="mt-2 text-xs font-semibold text-text-muted">
          Mais {block.remainingConfigurations}{" "}
          {block.remainingConfigurations === 1
            ? "configuração disponível"
            : "configurações disponíveis"}{" "}
          no Estoque.
        </p>
      ) : null}
      <Link
        href={block.inventoryHref}
        className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand-charcoal px-3 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
      >
        Ver todos no Estoque
      </Link>
    </div>
  );
}

function CatalogMediaPreview({
  target,
}: {
  target: AssistantCatalogMediaTarget;
}) {
  const descriptor = target.mediaDescriptor;

  if (!descriptor) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-border-neutral bg-app-background px-3 py-2 text-xs font-semibold text-text-muted">
        Foto não cadastrada
      </p>
    );
  }

  if (descriptor.kind === "commercial_configuration_image") {
    return (
      <CommercialConfigurationImage
        commercialCodes={descriptor.commercialCodes}
        imageUrl={descriptor.imageUrl}
        compact
      />
    );
  }

  return (
    <div className="mt-3 flex min-h-11 items-center gap-2">
      <CompatibleKitImages
        kitCode={descriptor.kitCode}
        options={descriptor.options}
      />
      <span className="text-xs font-bold text-violet-900">
        {descriptor.options.length === 1
          ? "Ver foto compatível"
          : `Ver ${descriptor.options.length} fotos compatíveis`}
      </span>
    </div>
  );
}

function CatalogTargetCard({
  target,
}: {
  target: AssistantCatalogMediaTarget;
}) {
  return (
    <article className="rounded-xl border border-border-neutral bg-surface p-3 shadow-sm">
      <p className="text-[0.62rem] font-black tracking-[0.12em] text-text-muted uppercase">
        {target.typeLabel}
      </p>
      <p className="mt-0.5 font-mono text-base font-black text-violet-900">
        Cód. {target.displayCode}
      </p>
      <p className="mt-1 break-words text-sm font-bold text-text-primary">
        {target.description}
      </p>
      <CatalogMediaPreview target={target} />
      <Link
        href={target.href}
        className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-xs font-black text-text-primary transition hover:border-brand-gold-dark hover:bg-app-background"
      >
        Abrir no Estoque
      </Link>
    </article>
  );
}

function CatalogMediaBlock({ block }: { block: AssistantCatalogMediaBlock }) {
  if (block.status === "NOT_FOUND") {
    return (
      <div>
        <p className="font-bold text-text-primary">
          Não encontrei o código “{block.queryCode}” no catálogo.
        </p>
        <p className="mt-1 text-xs font-semibold text-text-muted">
          Confira o código e tente novamente.
        </p>
        <Link
          href={block.inventoryHref}
          className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
        >
          Abrir Estoque
        </Link>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <h3 className="text-base font-black text-text-primary">
        {block.status === "AMBIGUOUS"
          ? `Resultados para “${block.queryCode}”`
          : `Foto do código ${block.queryCode}`}
      </h3>
      {block.status === "AMBIGUOUS" ? (
        <p className="mt-1 text-xs font-semibold text-text-muted">
          Encontrei mais de um cadastro. Escolha o resultado correto.
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {block.results.map((target) => (
          <CatalogTargetCard
            key={`${target.targetKind}-${target.targetId}`}
            target={target}
          />
        ))}
      </div>
    </div>
  );
}

function OrderStatus({
  order,
}: {
  order: AssistantSupplierOrderCard;
}) {
  const label =
    order.closureKind === "FINALIZED"
      ? "Finalizado"
      : orderStatusLabels[order.status];
  const classes =
    order.closureKind === "FINALIZED"
      ? "bg-emerald-100 text-emerald-900"
      : order.status === "CANCELLED"
        ? "bg-red-100 text-red-900"
        : order.status === "COMPLETED"
          ? "bg-sky-100 text-sky-900"
          : order.status === "PARTIAL"
            ? "bg-violet-100 text-violet-900"
            : "bg-amber-100 text-amber-950";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[0.62rem] font-black uppercase ${classes}`}
    >
      {label}
    </span>
  );
}

function formatOrderDate(value: string) {
  return orderDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function SupplierOrderCard({
  order,
  catalogLines = [],
  showTotals = true,
}: {
  order: AssistantSupplierOrderCard;
  catalogLines?: AssistantSupplierOrderCatalogLine[];
  showTotals?: boolean;
}) {
  return (
    <Link
      href={order.href}
      className="nk-focus block rounded-xl border border-border-neutral bg-surface p-3 shadow-sm transition hover:border-brand-gold-dark hover:bg-brand-gold-soft/20"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-base font-black text-violet-900">
          Pedido {order.negotiationNumber}
        </span>
        <OrderStatus order={order} />
      </span>
      <span className="mt-1 block text-xs font-semibold text-text-muted">
        {formatOrderDate(order.orderDate)} ·{" "}
        {quantityFormatter.format(order.lineCount)}{" "}
        {order.lineCount === 1 ? "item" : "itens"}
      </span>
      {catalogLines.length > 0
        ? catalogLines.map((line) => (
            <span
              key={line.id}
              className="mt-2 block border-t border-border-neutral pt-2"
            >
              <span className="block font-mono text-xs font-black text-violet-900">
                Cód. {line.displayCode}
              </span>
              <span className="mt-0.5 block break-words text-xs font-bold text-text-primary">
                {line.description}
              </span>
              <span className="mt-2 grid grid-cols-3 gap-1.5">
                {[
                  ["Solicitado", line.orderedQuantity],
                  ["Retirado", line.pickedQuantity],
                  ["Para retirar", line.waitingPickupQuantity],
                ].map(([label, value]) => (
                  <span
                    key={String(label)}
                    className="rounded-lg bg-app-background px-1.5 py-2 text-center"
                  >
                    <span className="block text-[0.56rem] font-black text-text-muted uppercase">
                      {label}
                    </span>
                    <strong className="block font-mono text-sm text-text-primary">
                      {quantityFormatter.format(Number(value))}
                    </strong>
                  </span>
                ))}
              </span>
              {line.cancelledQuantity > 0 ||
              line.stockedQuantity > 0 ||
              line.waitingStockQuantity > 0 ? (
                <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] font-black">
                  {line.cancelledQuantity > 0 ? (
                    <span className="text-red-800">
                      Cancelado:{" "}
                      {quantityFormatter.format(line.cancelledQuantity)}
                    </span>
                  ) : null}
                  {line.stockedQuantity > 0 ? (
                    <span className="text-emerald-800">
                      Já lançado:{" "}
                      {quantityFormatter.format(line.stockedQuantity)}
                    </span>
                  ) : null}
                  {line.waitingStockQuantity > 0 ? (
                    <span className="text-amber-900">
                      Aguardando entrada:{" "}
                      {quantityFormatter.format(
                        line.waitingStockQuantity,
                      )}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
          ))
        : showTotals
          ? (
              <>
                <span className="mt-2 grid grid-cols-3 gap-1.5">
                  {[
                    ["Solicitado", order.orderedQuantity],
                    ["Retirado", order.pickedQuantity],
                    ["Para retirar", order.waitingPickupQuantity],
                  ].map(([label, value]) => (
                    <span
                      key={String(label)}
                      className="rounded-lg bg-app-background px-1.5 py-2 text-center"
                    >
                      <span className="block text-[0.58rem] font-black text-text-muted uppercase">
                        {label}
                      </span>
                      <strong className="block font-mono text-sm text-text-primary">
                        {quantityFormatter.format(Number(value))}
                      </strong>
                    </span>
                  ))}
                </span>
                {order.waitingStockQuantity > 0 ? (
                  <span className="mt-2 block rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-black text-amber-950">
                    {quantityFormatter.format(
                      order.waitingStockQuantity,
                    )}{" "}
                    para entrada no estoque
                  </span>
                ) : null}
              </>
            )
          : null}
      <span className="mt-2 block text-xs font-black text-brand-gold-ink">
        Abrir pedido
      </span>
    </Link>
  );
}

function SupplierOrderList({
  block,
}: {
  block: AssistantSupplierOrderListBlock;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-base font-black text-text-primary">
        {block.title}
      </h3>
      <p className="mt-1 text-xs font-semibold text-text-muted">
        {block.filtersSummary}
      </p>
      {block.orders.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {block.orders.map((order) => (
            <SupplierOrderCard
              key={order.id}
              order={order}
              catalogLines={block.catalogLines.filter(
                (line) => line.supplierOrderId === order.id,
              )}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-border-neutral px-3 py-4 text-sm font-semibold text-text-muted">
          {block.fallbackText}
        </p>
      )}
      {block.remainingCount > 0 ? (
        <p className="mt-3 text-xs font-bold text-text-muted">
          + {quantityFormatter.format(block.remainingCount)}{" "}
          {block.remainingCount === 1
            ? "pedido adicional"
            : "pedidos adicionais"}
        </p>
      ) : null}
      <Link
        href={block.ordersHref}
        className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
      >
        Abrir Pedidos
      </Link>
    </div>
  );
}

function SupplierOrderItem({
  item,
}: {
  item: AssistantSupplierOrderItemCard;
}) {
  return (
    <article className="rounded-xl border border-border-neutral bg-app-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-black tracking-wide text-text-muted uppercase">
            {item.typeLabel}
          </p>
          <p className="font-mono text-sm font-black text-violet-900">
            Cód. {item.displayCode}
          </p>
          <p className="mt-1 break-words text-sm font-bold text-text-primary">
            {item.description}
          </p>
        </div>
        <MediaControl descriptor={item.mediaDescriptor} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[
          ["Solicitado", item.orderedQuantity],
          ["Retirado", item.pickedQuantity],
          ["Para retirar", item.waitingPickupQuantity],
          ["Para entrada", item.waitingStockQuantity],
        ].map(([label, value]) => (
          <span
            key={String(label)}
            className="rounded-lg border border-border-neutral bg-white px-2 py-1.5 text-center"
          >
            <span className="block text-[0.56rem] font-black text-text-muted uppercase">
              {label}
            </span>
            <strong className="font-mono text-sm text-text-primary">
              {quantityFormatter.format(Number(value))}
            </strong>
          </span>
        ))}
      </div>
    </article>
  );
}

function SupplierOrderDetail({
  block,
}: {
  block: AssistantSupplierOrderDetailBlock;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-base font-black text-text-primary">
        {block.title}
      </h3>
      <div className="mt-3">
        <SupplierOrderCard
          order={block.order}
          showTotals={!block.catalogCode}
        />
      </div>
      {block.items.length > 0 ? (
        <section className="mt-4" aria-label="Itens do pedido">
          <h4 className="mb-2 text-[0.68rem] font-black tracking-[0.12em] text-text-muted uppercase">
            Itens
          </h4>
          <div className="grid gap-2">
            {block.items.map((item) => (
              <SupplierOrderItem key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-border-neutral px-3 py-3 text-sm font-semibold text-text-muted">
          Nenhum item corresponde ao recorte solicitado.
        </p>
      )}
      {block.hiddenItemCount > 0 ? (
        <p className="mt-2 text-xs font-bold text-text-muted">
          + {quantityFormatter.format(block.hiddenItemCount)}{" "}
          {block.hiddenItemCount === 1 ? "item adicional" : "itens adicionais"}
        </p>
      ) : null}
    </div>
  );
}

function SupplierOrderAggregate({
  block,
}: {
  block: AssistantSupplierOrderAggregateBlock;
}) {
  const metrics = [
    ["ORDER_COUNT", "Pedidos", block.orderCount],
    ["ORDERED_UNITS", "Solicitado", block.orderedQuantity],
    ["PICKED_UNITS", "Retirado", block.pickedQuantity],
    ["WAITING_PICKUP_UNITS", "Para retirar", block.waitingPickupQuantity],
    ["STOCKED_UNITS", "Já lançado", block.stockedQuantity],
    ["WAITING_STOCK_UNITS", "Aguardando entrada", block.waitingStockQuantity],
  ] as const;
  const primaryMetric =
    metrics.find(([metric]) => metric === block.primaryMetric) ?? metrics[0];
  const [, primaryLabel, primaryValue] = primaryMetric;
  const cancelledQuantity = Math.max(
    block.orderedQuantity -
      block.pickedQuantity -
      block.waitingPickupQuantity,
    0,
  );
  const compactMetrics = metrics.filter(
    ([metric, , value]) =>
      metric !== block.primaryMetric &&
      (metric !== "WAITING_STOCK_UNITS" || value > 0),
  );

  return (
    <div className="min-w-0">
      <h3 className="text-base font-black text-text-primary">
        {block.title}
      </h3>
      <p className="mt-1 text-xs font-semibold text-text-muted">
        {block.filtersSummary}
      </p>
      <div className="mt-3 rounded-xl border border-violet-300 bg-violet-50 px-3 py-3">
        <span className="block text-[0.62rem] font-black tracking-[0.08em] text-violet-900 uppercase">
          {primaryLabel}
        </span>
        <strong className="mt-0.5 block font-mono text-2xl font-black tabular-nums text-text-primary">
          {quantityFormatter.format(primaryValue)}
        </strong>
        <span className="text-xs font-bold text-text-muted">
          {block.primaryMetric === "ORDER_COUNT"
            ? primaryValue === 1
              ? "pedido"
              : "pedidos"
            : primaryValue === 1
              ? "unidade"
              : "unidades"}
        </span>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1 text-xs font-semibold text-text-muted">
        {compactMetrics.map(([metric, label, value], index) => (
          <span key={metric}>
            {index > 0 ? (
              <span aria-hidden="true" className="mr-1.5 text-border-neutral">
                ·
              </span>
            ) : null}
            {label}{" "}
            <strong className="font-black text-text-primary">
              {quantityFormatter.format(value)}
            </strong>
          </span>
        ))}
        {cancelledQuantity > 0 ? (
          <span>
            {compactMetrics.length > 0 ? (
              <span aria-hidden="true" className="mr-1.5 text-border-neutral">
                ·
              </span>
            ) : null}
            Cancelado{" "}
            <strong className="font-black text-text-primary">
              {quantityFormatter.format(cancelledQuantity)}
            </strong>
          </span>
        ) : null}
      </p>
      <Link
        href={block.ordersHref}
        className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
      >
        Abrir Pedidos
      </Link>
    </div>
  );
}

function PurchaseRecommendationCard({
  item,
}: {
  item: PurchaseRecommendationItem;
}) {
  const hasPendingPurchase = item.pendingPurchaseQuantity > 0;
  const relatedOrderLabel =
    item.relatedOrders.length === 1
      ? `Pedido ${item.relatedOrders[0].negotiationNumber}`
      : `${item.relatedOrders.length} Pedidos relacionados`;

  return (
    <li className="grid gap-x-4 gap-y-1.5 border-b border-border-neutral py-2.5 last:border-b-0 min-[440px]:grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <div className="min-w-0">
        <p className="break-words text-sm font-bold text-text-primary">
          <span className="mr-1 font-mono text-xs font-black text-brand-gold-ink">
            Cód. {item.primaryCode}
          </span>
          {item.description}
        </p>
        {item.aliases.length > 0 ? (
          <p className="mt-0.5 text-xs font-semibold text-text-muted">
            Também: {item.aliases.map((code) => `Cód. ${code}`).join(", ")}
          </p>
        ) : null}
      </div>
      <dl className="flex gap-3 text-xs min-[440px]:col-start-2 min-[440px]:row-start-1 sm:shrink-0">
        <div>
          <dt className="font-black text-text-muted">Est.</dt>
          <dd className="font-mono text-sm font-black text-text-primary">
            {quantityFormatter.format(item.currentStock)}
          </dd>
        </div>
        <div>
          <dt className="font-black text-text-muted">Mín.</dt>
          <dd className="font-mono text-sm font-black text-text-primary">
            {item.minimumStock === null
              ? "Não definido"
              : quantityFormatter.format(item.minimumStock)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-text-muted min-[440px]:col-span-2 sm:col-span-1 sm:max-w-72 sm:justify-end">
        {item.group === "BUY_NOW" ? (
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-black text-amber-950">
            Comprar {quantityFormatter.format(item.recommendedQuantity ?? 0)}
          </span>
        ) : null}
        {hasPendingPurchase ? (
          <span>
            Já comprado {quantityFormatter.format(item.pendingPurchaseQuantity)}
            {item.projectedStock !== null
              ? ` · Projetado ${quantityFormatter.format(item.projectedStock)}`
              : ""}
            {item.coverage === "SUFFICIENT"
              ? " · cobre mínimo"
              : item.coverage === "INSUFFICIENT"
                ? " · ainda falta"
                : ""}
          </span>
        ) : null}
        {item.relatedOrders.length > 0 ? (
          <Link
            href={item.relatedOrders[0].href}
            className="nk-focus underline decoration-brand-gold/70 underline-offset-2 hover:text-text-primary"
          >
            {relatedOrderLabel}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function PurchaseRecommendationList({
  block,
}: {
  block: AssistantPurchaseRecommendationBlock;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[0.65rem] font-black tracking-[0.14em] text-brand-gold-ink uppercase">
        Reposição
      </p>
      <h3 className="text-base font-black text-text-primary sm:text-lg">
        {block.title}
      </h3>
      <p className="mt-1 text-sm font-bold text-text-primary">
        {block.primaryText}
      </p>
      <p className="mt-1 text-xs font-semibold text-text-muted">
        {block.subtitle}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {[
          ["Comprar", block.summary.buyNowCount],
          ["Comprados", block.summary.alreadyOrderedCount],
          ["Sem mínimo", block.summary.missingMinimumCount],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-border-neutral bg-app-background px-1.5 py-2 text-center"
          >
            <strong className="block font-mono text-sm text-text-primary">
              {quantityFormatter.format(Number(value))}
            </strong>
            <span className="block text-[0.55rem] font-black text-text-muted uppercase">
              {label}
            </span>
          </div>
        ))}
      </div>
      {block.items.length > 0 ? (
        <ul className="mt-3 divide-y divide-border-neutral rounded-xl border border-border-neutral bg-white px-3">
          {block.items.map((item) => (
            <PurchaseRecommendationCard
              key={`${item.targetKind}-${item.targetId}`}
              item={item}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-border-neutral bg-app-background px-3 py-3 text-sm font-semibold text-text-muted">
          Nenhum item encontrado para esta consulta.
        </p>
      )}
      {block.remainingCount > 0 ? (
        <p className="mt-2 text-xs font-bold text-text-muted">
          Mostrando {quantityFormatter.format(block.items.length)} de{" "}
          {quantityFormatter.format(block.totalCount)} itens.
        </p>
      ) : null}
      <Link
        href={block.listHref}
        className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand-charcoal px-3 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
      >
        Abrir lista completa
      </Link>
    </div>
  );
}

function SupplierOrderAmbiguity({
  block,
}: {
  block: AssistantSupplierOrderAmbiguityBlock;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-base font-black text-text-primary">
        {block.title}
      </h3>
      <p className="mt-1 text-xs font-semibold text-text-muted">
        {block.description}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {block.orders.map((order) => (
          <SupplierOrderCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}

function PickupOrderHeader({
  order,
}: {
  order: AssistantSupplierOrderPickupPreviewBlock["order"];
}) {
  return (
    <div className="rounded-xl border border-border-neutral bg-app-background/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="font-mono text-sm font-black text-violet-900 sm:text-base">
          Pedido {order.negotiationNumber}
        </strong>
        <OrderStatus order={order} />
      </div>
      <p className="mt-1 text-xs font-semibold text-text-muted">
        {formatOrderDate(order.orderDate)}
      </p>
    </div>
  );
}

function PickupMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <span
      className={`rounded-lg border px-2 py-2 text-center ${
        emphasis
          ? "border-violet-200 bg-violet-50"
          : "border-border-neutral bg-white"
      }`}
    >
      <span className="block text-xs leading-4 font-black text-text-muted uppercase">
        {label}
      </span>
      <strong className="mt-0.5 block font-mono text-base font-black tabular-nums text-text-primary">
        {quantityFormatter.format(value)}
      </strong>
    </span>
  );
}

function SupplierOrderPickupPreview({
  block,
  disabled,
  confirming,
  progressLabel,
  onConfirm,
  onCancel,
  onPromptSelect,
}: {
  block: AssistantSupplierOrderPickupPreviewBlock;
  disabled: boolean;
  confirming: boolean;
  progressLabel: string | null;
  onConfirm?: (block: AssistantSupplierOrderPickupPreviewBlock) => void;
  onCancel?: (block: AssistantSupplierOrderPickupPreviewBlock) => void;
  onPromptSelect?: (prompt: string) => void;
}) {
  const [isLocallyExpired, setIsLocallyExpired] = useState(false);

  useEffect(() => {
    if (block.state !== "pending" || !block.expiresAt) {
      return;
    }

    const remaining = Date.parse(block.expiresAt) - Date.now();
    const timeout = window.setTimeout(
      () => setIsLocallyExpired(true),
      Math.max(remaining, 0),
    );

    return () => window.clearTimeout(timeout);
  }, [block.expiresAt, block.state]);

  const isExpired = block.state === "expired" || isLocallyExpired;
  const canConfirm =
    block.state === "pending" &&
    !isExpired &&
    Boolean(block.proposalToken) &&
    Boolean(onConfirm);

  return (
    <div className="min-w-0">
      <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">
        Ação operacional
      </p>
      <h3 className="text-base font-black text-text-primary sm:text-lg">
        {isExpired ? "Prévia expirada" : block.title}
      </h3>
      <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">
        {isExpired
          ? "Solicite novamente a retirada para confirmar com os valores atuais."
          : block.message}
      </p>

      <div className="mt-3">
        <PickupOrderHeader order={block.order} />
      </div>

      {block.item ? (
        <article className="mt-3 rounded-xl border border-violet-200 bg-violet-50/45 p-3">
          <p className="font-mono text-sm font-black text-violet-900">
            Cód. {block.item.displayCode}
          </p>
          <p className="mt-1 break-words text-sm font-bold text-text-primary">
            {block.item.description}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <PickupMetric
              label="Pronto pela Safisa"
              value={block.item.readyQuantity}
            />
            <PickupMetric
              label="Já retirado"
              value={block.item.currentPickedQuantity}
            />
            <PickupMetric
              label="Disponível para retirar"
              value={block.item.availableQuantity}
            />
            <PickupMetric
              label="Retirar agora"
              value={block.item.addedQuantity}
              emphasis
            />
            <PickupMetric
              label="Entrada automática"
              value={block.item.automaticStockEntryQuantity}
              emphasis
            />
            <PickupMetric
              label="Restará pronto"
              value={block.item.remainingAfter}
            />
          </div>
          {block.item.waitingStockQuantity > 0 ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-950">
              Pendente antigo de entrada: {quantityFormatter.format(block.item.waitingStockQuantity)}. Esse saldo não faz parte desta confirmação.
            </p>
          ) : null}
          {block.item.cancelledQuantity > 0 ? (
            <p className="mt-2 text-xs font-black text-red-800">
              Cancelado:{" "}
              {quantityFormatter.format(block.item.cancelledQuantity)}
            </p>
          ) : null}
        </article>
      ) : null}

      {block.markAll ? (
        <section className="mt-3" aria-label="Linhas da retirada total">
          <div className="grid grid-cols-2 gap-1.5">
            <PickupMetric
              label="Linhas alteradas"
              value={block.markAll.changedLines}
              emphasis
            />
            <PickupMetric
              label="Unidades retiradas"
              value={block.markAll.addedPickedQuantity}
              emphasis
            />
          </div>
          <div className="mt-2 grid gap-1.5">
            {block.markAll.items.map((item) => (
              <div
                key={item.id}
                className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border-neutral bg-white px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <span className="min-w-0">
                  <strong className="block font-mono text-xs text-violet-900">
                    Cód. {item.displayCode}
                  </strong>
                  <span className="block break-words text-xs font-semibold text-text-muted">
                    {item.description}
                  </span>
                </span>
                <span className="font-mono text-xs font-black tabular-nums text-text-primary sm:shrink-0">
                  Retirar {quantityFormatter.format(item.addedQuantity)} → Estoque +{quantityFormatter.format(item.automaticStockEntryQuantity)}
                </span>
              </div>
            ))}
          </div>
          {block.markAll.hiddenItemCount > 0 ? (
            <p className="mt-2 text-xs font-bold text-text-muted">
              + {quantityFormatter.format(block.markAll.hiddenItemCount)}{" "}
              {block.markAll.hiddenItemCount === 1
                ? "linha adicional"
                : "linhas adicionais"}
            </p>
          ) : null}
        </section>
      ) : null}

      {block.warnings.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs font-semibold text-amber-950">
          {block.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {isExpired ? (
        <button
          type="button"
          disabled={disabled || !onPromptSelect}
          onClick={() => onPromptSelect?.(block.regeneratePrompt)}
          className="nk-focus mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          Gerar nova prévia
        </button>
      ) : block.state === "cancelled" ? (
        <p className="mt-4 rounded-xl border border-border-neutral bg-app-background px-3 py-2 text-sm font-bold text-text-muted">
          Prévia cancelada. Nenhuma retirada foi executada.
        </p>
      ) : (
        <div className="mt-4">
          {confirming && progressLabel ? (
            <p
              role="status"
              aria-live="polite"
              className="mb-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-900"
            >
              {progressLabel}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled || confirming || !canConfirm}
              aria-busy={confirming}
              onClick={() => onConfirm?.(block)}
              className="nk-focus min-h-11 rounded-xl bg-emerald-700 px-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming
                ? (progressLabel ?? "Confirmando...")
                : block.confirmLabel}
            </button>
            <button
              type="button"
              disabled={disabled || confirming || !onCancel}
              onClick={() => onCancel?.(block)}
              className="nk-focus min-h-11 rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary transition hover:bg-app-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {block.cancelLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SupplierOrderPickupResult({
  block,
  disabled,
  onPromptSelect,
}: {
  block: AssistantSupplierOrderPickupResultBlock;
  disabled: boolean;
  onPromptSelect?: (prompt: string) => void;
}) {
  const tone =
    block.outcome === "success"
      ? "border-emerald-200 bg-emerald-50/55"
      : block.outcome === "conflict"
        ? "border-amber-200 bg-amber-50/55"
        : block.outcome === "error"
          ? "border-red-200 bg-red-50/55"
          : "border-border-neutral bg-app-background/70";

  return (
    <div className="min-w-0">
      <div className={`rounded-xl border p-3 ${tone}`}>
        <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">
          Resultado da ação
        </p>
        <h3 className="text-base font-black text-text-primary sm:text-lg">
          {block.title}
        </h3>
        <p className="mt-1 text-sm font-semibold text-text-muted">
          {block.message}
        </p>
        {block.idempotentReplay ? (
          <span className="mt-2 inline-flex rounded-full bg-violet-100 px-2 py-1 text-[0.62rem] font-black text-violet-900 uppercase">
            Resultado idempotente
          </span>
        ) : null}
        {block.refreshWarning && block.warnings?.length ? (
          <div
            role="status"
            className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950"
          >
            <p className="font-black">Atualização pendente</p>
            {block.warnings.map((warning) => (
              <p key={warning} className="mt-1">
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {block.order ? (
        <div className="mt-3">
          <PickupOrderHeader order={block.order} />
        </div>
      ) : null}

      {block.item ? (
        <article className="mt-3 rounded-xl border border-border-neutral bg-white p-3">
          <p className="font-mono text-sm font-black text-violet-900">
            Cód. {block.item.displayCode}
          </p>
          <p className="mt-1 break-words text-sm font-bold text-text-primary">
            {block.item.description}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <PickupMetric
              label="Antes"
              value={block.item.previousPickedQuantity}
            />
            <PickupMetric
              label="Retirado agora"
              value={block.item.addedPickedQuantity}
              emphasis
            />
            {block.item.automaticStockEntryQuantity !== null ? (
              <PickupMetric
                label="Entrada no Estoque"
                value={block.item.automaticStockEntryQuantity}
                emphasis
              />
            ) : null}
            <PickupMetric
              label="Retirado total"
              value={block.item.currentPickedQuantity}
              emphasis
            />
            <PickupMetric
              label="Ainda falta"
              value={block.item.remainingPickupQuantity}
            />
          </div>
        </article>
      ) : null}

      {block.markAll ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <PickupMetric
            label="Linhas alteradas"
            value={block.markAll.changedLines}
            emphasis
          />
          <PickupMetric
            label="Unidades retiradas"
            value={block.markAll.addedPickedQuantity}
            emphasis
          />
          {block.markAll.automaticStockEntryQuantity !== null ? (
            <PickupMetric
              label="Entrada no Estoque"
              value={block.markAll.automaticStockEntryQuantity}
              emphasis
            />
          ) : null}
        </div>
      ) : null}

      {block.actions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {block.actions.map((action) =>
            action.kind === "link" ? (
              <Link
                key={`${action.kind}-${action.label}`}
                href={action.href}
                className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={`${action.kind}-${action.label}`}
                type="button"
                disabled={disabled || !onPromptSelect}
                onClick={() => onPromptSelect?.(action.prompt)}
                className="nk-focus min-h-11 rounded-xl border border-violet-200 bg-violet-50 px-3 text-sm font-black text-violet-950 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

type StockEntryPreviewBlock =
  | AssistantSupplierOrderStockEntryPreviewBlock
  | AssistantManualStockEntryPreviewBlock;
type StockEntryResultBlock =
  | AssistantSupplierOrderStockEntryResultBlock
  | AssistantManualStockEntryResultBlock;

function StockEntryTargetHeader({ target }: { target: AssistantStockEntryTarget }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.62rem] font-black tracking-wide text-violet-800 uppercase">
        {target.typeLabel}
      </p>
      <p className="font-mono text-sm font-black text-text-primary">
        Cód. {target.displayCode}
      </p>
      <p className="mt-0.5 break-words text-sm font-bold text-text-primary">
        {target.description}
      </p>
      {target.detail ? (
        <p className="mt-0.5 break-words text-xs font-semibold text-text-muted">
          {target.detail}
        </p>
      ) : null}
      {target.aliases.length > 1 ? (
        <p className="mt-1 text-xs font-semibold text-text-muted">
          Códigos: {target.aliases.join(" / ")}
        </p>
      ) : null}
    </div>
  );
}

function StockEntryPreview({
  block,
  disabled,
  confirming,
  onConfirm,
  onCancel,
  onPromptSelect,
}: {
  block: StockEntryPreviewBlock;
  disabled: boolean;
  confirming: boolean;
  onConfirm?: (block: StockEntryPreviewBlock) => void;
  onCancel?: (block: StockEntryPreviewBlock) => void;
  onPromptSelect?: (prompt: string) => void;
}) {
  const [locallyExpired, setLocallyExpired] = useState(false);
  useEffect(() => {
    if (block.state !== "pending" || !block.expiresAt) return;
    const timeout = window.setTimeout(() => setLocallyExpired(true), Math.max(Date.parse(block.expiresAt) - Date.now(), 0));
    return () => window.clearTimeout(timeout);
  }, [block.expiresAt, block.state]);
  const expired = block.state === "expired" || locallyExpired;
  const lines = block.lines;
  return (
    <div className="min-w-0">
      <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">
        Ação operacional
      </p>
      <h3 className="text-base font-black text-text-primary sm:text-lg">
        {expired ? "Prévia expirada" : block.title}
      </h3>
      <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">
        {expired ? "Gere uma nova prévia com os valores atuais." : block.message}
      </p>
      {block.kind === "supplier_order_stock_entry_preview" ? (
        <div className="mt-3"><PickupOrderHeader order={block.order} /></div>
      ) : null}
      <div className="mt-3 grid gap-2">
        {lines.map((line) => {
          const orderLine = "orderedQuantity" in line ? line : null;
          return (
            <article key={`${line.target.kind}-${line.target.targetId}`} className="rounded-xl border border-violet-200 bg-violet-50/35 p-3">
              <StockEntryTargetHeader target={line.target} />
              <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <PickupMetric label="Saldo atual" value={line.target.currentStock} />
                <PickupMetric label="Entrada" value={line.entryQuantity} emphasis />
                <PickupMetric label="Saldo estimado" value={line.estimatedStockAfter} emphasis />
              </div>
              {orderLine ? (
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <PickupMetric label="Pedido" value={orderLine.orderedQuantity} />
                  <PickupMetric label="Retirado" value={orderLine.pickedQuantity} />
                  <PickupMetric label="Já lançado" value={orderLine.stockedQuantity} />
                  <PickupMetric label="Continuará aguardando" value={orderLine.remainingQuantity} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {block.kind === "manual_stock_entry_preview" ? (
        <p className="mt-3 text-xs font-semibold text-text-muted">
          Esta entrada será registrada como uma entrada manual confirmada pela Assistente NK.
        </p>
      ) : (
        <p className="mt-3 text-xs font-semibold text-text-muted">
          {quantityFormatter.format(block.lines.length)} linha{block.lines.length === 1 ? "" : "s"} · {quantityFormatter.format(block.totalQuantity)} unidade{block.totalQuantity === 1 ? "" : "s"}. O banco fará a validação final.
        </p>
      )}
      {expired ? (
        <button type="button" disabled={disabled || !onPromptSelect} onClick={() => onPromptSelect?.(block.regeneratePrompt)}
          className="nk-focus mt-4 min-h-11 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:opacity-50">
          Gerar nova prévia
        </button>
      ) : (
        <>
          {confirming ? <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-900">Registrando entrada. Não feche esta tela.</p> : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={disabled || confirming || block.state !== "pending" || !block.proposalToken || !onConfirm}
            aria-busy={confirming} onClick={() => onConfirm?.(block)}
            className="nk-focus min-h-11 rounded-xl bg-emerald-700 px-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
            {confirming ? "Registrando entrada..." : block.confirmLabel}
          </button>
          <button type="button" disabled={disabled || confirming || block.state !== "pending" || !onCancel}
            onClick={() => onCancel?.(block)}
            className="nk-focus min-h-11 rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary disabled:opacity-50">
            {block.cancelLabel}
          </button>
          </div>
        </>
      )}
    </div>
  );
}

function StockEntryResult({ block }: { block: StockEntryResultBlock }) {
  const tone = block.outcome === "success" ? "border-emerald-200 bg-emerald-50/55" :
    block.outcome === "conflict" ? "border-amber-200 bg-amber-50/55" : "border-red-200 bg-red-50/45";
  return (
    <div className="min-w-0">
      <div className={`rounded-xl border p-3 ${tone}`}>
        <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">Resultado da ação</p>
        <h3 className="text-base font-black text-text-primary sm:text-lg">{block.title}</h3>
        <p className="mt-1 text-sm font-semibold text-text-muted">{block.message}</p>
        {block.idempotentReplay ? <span className="mt-2 inline-flex rounded-full bg-violet-100 px-2 py-1 text-[0.62rem] font-black text-violet-900 uppercase">Resultado idempotente</span> : null}
        {block.refreshWarning ? <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-950">A operação foi concluída; a atualização visual pode exigir recarregar a página.</p> : null}
      </div>
      {block.kind === "supplier_order_stock_entry_result" && block.order ? <div className="mt-3"><PickupOrderHeader order={block.order} /></div> : null}
      <div className="mt-3 grid gap-2">
        {block.lines.map((line) => (
          <article key={`${line.target.kind}-${line.target.targetId}`} className="rounded-xl border border-border-neutral bg-white p-3">
            <StockEntryTargetHeader target={line.target} />
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <PickupMetric label="Antes" value={line.previousStock} />
              <PickupMetric label="Entrada" value={line.entryQuantity} emphasis />
              <PickupMetric label="Depois" value={line.currentStock} emphasis />
            </div>
          </article>
        ))}
      </div>
      {block.actions.length ? <div className="mt-4 flex flex-wrap gap-2">{block.actions.map((action) => action.kind === "link" ? (
        <Link key={`${action.label}-${action.href}`} href={action.href} className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary">{action.label}</Link>
      ) : null)}</div> : null}
    </div>
  );
}

function StockOutputPreview({ block, disabled, confirming, onConfirm, onCancel, onPromptSelect }: {
  block: AssistantManualStockOutputPreviewBlock;
  disabled: boolean;
  confirming: boolean;
  onConfirm?: (block: AssistantManualStockOutputPreviewBlock) => void;
  onCancel?: (block: AssistantManualStockOutputPreviewBlock) => void;
  onPromptSelect?: (prompt: string) => void;
}) {
  const [locallyExpired, setLocallyExpired] = useState(false);
  useEffect(() => {
    if (block.state !== "pending" || !block.expiresAt) return;
    const timeout = window.setTimeout(() => setLocallyExpired(true), Math.max(Date.parse(block.expiresAt) - Date.now(), 0));
    return () => window.clearTimeout(timeout);
  }, [block.expiresAt, block.state]);
  const expired = block.state === "expired" || locallyExpired;
  return <div className="min-w-0">
    <p className="text-[0.65rem] font-black tracking-[0.12em] text-red-800 uppercase">Ação operacional</p>
    <h3 className="text-base font-black text-text-primary sm:text-lg">{expired ? "Prévia expirada" : block.title}</h3>
    <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">{expired ? "Gere uma nova prévia com os saldos atuais." : block.message}</p>
    <div className="mt-3 grid gap-2">
      {block.lines.map((line) => <article key={`${line.target.kind}-${line.target.targetId}`} className="rounded-xl border border-red-200 bg-red-50/35 p-3">
        <StockEntryTargetHeader target={line.target} />
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <PickupMetric label="Saldo atual" value={line.target.currentStock} />
          <PickupMetric label="Saída" value={-line.outputQuantity} emphasis />
          <PickupMetric label="Saldo estimado" value={line.estimatedStockAfter} emphasis />
        </div>
        {line.target.kind === "COMMERCIAL_CODE" ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-950">
          {line.autoAssembledQuantity > 0 ? <>
            Montagem automática prevista: {quantityFormatter.format(line.autoAssembledQuantity)}. Consumo avulso: {quantityFormatter.format(line.autoAssembledQuantity)} × Cód. {line.target.servo?.code} e {quantityFormatter.format(line.autoAssembledQuantity)} × Cód. {line.target.installationKit?.code}.
          </> : "O saldo montado atual atende esta saída; nenhuma montagem automática está prevista."}
        </div> : null}
      </article>)}
    </div>
    <p className="mt-3 text-xs font-semibold text-text-muted">Esta saída será registrada como uma saída manual confirmada pela Assistente NK. O banco fará a validação final.</p>
    {expired ? <button type="button" disabled={disabled || !onPromptSelect} onClick={() => onPromptSelect?.(block.regeneratePrompt)}
      className="nk-focus mt-4 min-h-11 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:opacity-50">Gerar nova prévia</button>
      : <>
        {confirming ? <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-900">Registrando saída. Não feche esta tela.</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || confirming || block.state !== "pending" || !block.proposalToken || !onConfirm}
          aria-busy={confirming} onClick={() => onConfirm?.(block)}
          className="nk-focus min-h-11 rounded-xl bg-red-700 px-3 text-sm font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">
          {confirming ? "Registrando saída..." : block.confirmLabel}
        </button>
        <button type="button" disabled={disabled || confirming || block.state !== "pending" || !onCancel} onClick={() => onCancel?.(block)}
          className="nk-focus min-h-11 rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary disabled:opacity-50">{block.cancelLabel}</button>
        </div>
      </>}
  </div>;
}

function StockOutputResult({ block }: { block: AssistantManualStockOutputResultBlock }) {
  const tone = block.outcome === "success" ? "border-emerald-200 bg-emerald-50/55" : "border-red-200 bg-red-50/45";
  return <div className="min-w-0">
    <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">Resultado da ação</p>
      <h3 className="text-base font-black text-text-primary sm:text-lg">{block.title}</h3>
      <p className="mt-1 text-sm font-semibold text-text-muted">{block.message}</p>
      {block.idempotentReplay ? <span className="mt-2 inline-flex rounded-full bg-violet-100 px-2 py-1 text-[0.62rem] font-black text-violet-900 uppercase">Resultado idempotente</span> : null}
      {block.refreshWarning ? <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-950">A operação foi concluída; a atualização visual pode exigir recarregar a página.</p> : null}
    </div>
    <div className="mt-3 grid gap-2">{block.lines.map((line) => <article key={`${line.target.kind}-${line.target.targetId}`} className="rounded-xl border border-border-neutral bg-white p-3">
      <StockEntryTargetHeader target={line.target} />
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <PickupMetric label="Antes" value={line.previousStock} />
        <PickupMetric label="Saída" value={line.outputQuantity} emphasis />
        <PickupMetric label="Depois" value={line.currentStock} emphasis />
      </div>
      {line.autoAssembledQuantity > 0 ? <p className="mt-2 text-xs font-semibold text-text-muted">Montagem automática registrada: {quantityFormatter.format(line.autoAssembledQuantity)}.</p> : null}
    </article>)}</div>
    {block.actions.length ? <div className="mt-4 flex flex-wrap gap-2">{block.actions.map((action) => action.kind === "link" ? <Link key={`${action.label}-${action.href}`} href={action.href}
      className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary">{action.label}</Link> : null)}</div> : null}
  </div>;
}

function ConfigurationAssemblyTargetHeader({ target }: { target: AssistantConfigurationAssemblyPreviewBlock["target"] }) {
  return <div className="min-w-0">
    <p className="text-[0.65rem] font-black tracking-[0.1em] text-violet-800 uppercase">Servo com kit</p>
    <p className="mt-1 font-mono text-xs font-black text-violet-900">Cód. {target.aliases.join(" / ") || target.displayCode}</p>
    <h4 className="mt-1 break-words text-sm font-black text-text-primary">{target.description}</h4>
    <p className="mt-1 text-xs font-semibold text-text-muted">
      Servo Cód. {target.servo.code} + Kit Cód. {target.installationKit.code}
    </p>
  </div>;
}

function ConfigurationAssemblyPreview({ block, disabled, confirming, onConfirm, onCancel, onPromptSelect }: {
  block: AssistantConfigurationAssemblyPreviewBlock;
  disabled: boolean;
  confirming: boolean;
  onConfirm?: (block: AssistantConfigurationAssemblyPreviewBlock) => void;
  onCancel?: (block: AssistantConfigurationAssemblyPreviewBlock) => void;
  onPromptSelect?: (prompt: string) => void;
}) {
  const [locallyExpired, setLocallyExpired] = useState(false);
  useEffect(() => {
    if (block.state !== "pending" || !block.expiresAt) return;
    const timeout = window.setTimeout(() => setLocallyExpired(true), Math.max(Date.parse(block.expiresAt) - Date.now(), 0));
    return () => window.clearTimeout(timeout);
  }, [block.expiresAt, block.state]);
  const expired = block.state === "expired" || locallyExpired;
  return <div className="min-w-0">
    <p className="text-[0.65rem] font-black tracking-[0.12em] text-violet-800 uppercase">Ação operacional</p>
    <h3 className="text-base font-black text-text-primary sm:text-lg">{expired ? "Prévia expirada" : block.title}</h3>
    <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">{expired ? "Gere uma nova prévia com os saldos atuais." : block.message}</p>
    <article className="mt-3 rounded-xl border border-violet-200 bg-violet-50/35 p-3">
      <ConfigurationAssemblyTargetHeader target={block.target} />
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <PickupMetric label="Montados agora" value={block.target.currentStock} />
        <PickupMetric label="Montagem" value={block.quantity} emphasis />
        <PickupMetric label="Montados depois" value={block.mountedStockAfter} emphasis />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <PickupMetric label={`Servo ${block.target.servo.code} depois`} value={block.servoStockAfter} />
        <PickupMetric label={`Kit ${block.target.installationKit.code} depois`} value={block.installationKitStockAfter} />
      </div>
    </article>
    <p className="mt-3 text-xs font-semibold text-text-muted">A montagem consumirá a mesma quantidade de Servos e Kits avulsos. O banco fará a validação final.</p>
    {expired ? <button type="button" disabled={disabled || !onPromptSelect} onClick={() => onPromptSelect?.(block.regeneratePrompt)}
      className="nk-focus mt-4 min-h-11 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:opacity-50">Gerar nova prévia</button>
      : <>
        {confirming ? <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-900">Registrando montagem. Não feche esta tela.</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || confirming || block.state !== "pending" || !block.proposalToken || !onConfirm}
          aria-busy={confirming} onClick={() => onConfirm?.(block)}
          className="nk-focus min-h-11 rounded-xl bg-violet-700 px-3 text-sm font-black text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
          {confirming ? "Registrando montagem..." : block.confirmLabel}
        </button>
        <button type="button" disabled={disabled || confirming || block.state !== "pending" || !onCancel} onClick={() => onCancel?.(block)}
          className="nk-focus min-h-11 rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary disabled:opacity-50">{block.cancelLabel}</button>
        </div>
      </>}
  </div>;
}

function ConfigurationAssemblyResult({ block }: { block: AssistantConfigurationAssemblyResultBlock }) {
  const tone = block.outcome === "success" ? "border-emerald-200 bg-emerald-50/55" : "border-red-200 bg-red-50/45";
  return <div className="min-w-0">
    <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">Resultado da ação</p>
      <h3 className="text-base font-black text-text-primary sm:text-lg">{block.title}</h3>
      <p className="mt-1 text-sm font-semibold text-text-muted">{block.message}</p>
      {block.idempotentReplay ? <span className="mt-2 inline-flex rounded-full bg-violet-100 px-2 py-1 text-[0.62rem] font-black text-violet-900 uppercase">Resultado idempotente</span> : null}
      {block.refreshWarning ? <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-950">A operação foi concluída; a atualização visual pode exigir recarregar a página.</p> : null}
    </div>
    {block.target && block.mountedStockBefore !== null && block.mountedStockAfter !== null &&
      block.servoStockAfter !== null && block.installationKitStockAfter !== null ? <article className="mt-3 rounded-xl border border-border-neutral bg-white p-3">
        <ConfigurationAssemblyTargetHeader target={block.target} />
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <PickupMetric label="Antes" value={block.mountedStockBefore} />
          <PickupMetric label="Montagem" value={block.quantity} emphasis />
          <PickupMetric label="Depois" value={block.mountedStockAfter} emphasis />
        </div>
        <p className="mt-2 text-xs font-semibold text-text-muted">
          Saldos avulsos após a montagem: Servo {block.target.servo.code}: {block.servoStockAfter}; Kit {block.target.installationKit.code}: {block.installationKitStockAfter}.
        </p>
      </article> : null}
    {block.actions.length ? <div className="mt-4 flex flex-wrap gap-2">{block.actions.map((action) => action.kind === "link" ? <Link key={`${action.label}-${action.href}`} href={action.href}
      className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary">{action.label}</Link> : null)}</div> : null}
  </div>;
}

function ConfigurationDisassemblyPreview({ block, disabled, confirming, onConfirm, onCancel, onPromptSelect }: {
  block: AssistantConfigurationDisassemblyPreviewBlock;
  disabled: boolean;
  confirming: boolean;
  onConfirm?: (block: AssistantConfigurationDisassemblyPreviewBlock) => void;
  onCancel?: (block: AssistantConfigurationDisassemblyPreviewBlock) => void;
  onPromptSelect?: (prompt: string) => void;
}) {
  const [locallyExpired, setLocallyExpired] = useState(false);
  useEffect(() => {
    if (block.state !== "pending" || !block.expiresAt) return;
    const timeout = window.setTimeout(() => setLocallyExpired(true), Math.max(Date.parse(block.expiresAt) - Date.now(), 0));
    return () => window.clearTimeout(timeout);
  }, [block.expiresAt, block.state]);
  const expired = block.state === "expired" || locallyExpired;
  return <div className="min-w-0">
    <p className="text-[0.65rem] font-black tracking-[0.12em] text-violet-800 uppercase">Ação operacional</p>
    <h3 className="text-base font-black text-text-primary sm:text-lg">{expired ? "Prévia expirada" : block.title}</h3>
    <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">{expired ? "Gere uma nova prévia com os saldos atuais." : block.message}</p>
    <article className="mt-3 rounded-xl border border-violet-200 bg-violet-50/35 p-3">
      <ConfigurationAssemblyTargetHeader target={block.target} />
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <PickupMetric label="Montados agora" value={block.target.currentStock} />
        <PickupMetric label="Desmontagem" value={block.quantity} emphasis />
        <PickupMetric label="Montados depois" value={block.mountedStockAfter} emphasis />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <PickupMetric label={`Servo ${block.target.servo.code} depois`} value={block.servoStockAfter} />
        <PickupMetric label={`Kit ${block.target.installationKit.code} depois`} value={block.installationKitStockAfter} />
      </div>
    </article>
    <p className="mt-3 text-xs font-semibold text-text-muted">A desmontagem devolverá a mesma quantidade de Servos e Kits avulsos. O banco fará a validação final.</p>
    {expired ? <button type="button" disabled={disabled || !onPromptSelect} onClick={() => onPromptSelect?.(block.regeneratePrompt)}
      className="nk-focus mt-4 min-h-11 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:opacity-50">Gerar nova prévia</button>
      : <>
        {confirming ? <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-900">Registrando desmontagem. Não feche esta tela.</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || confirming || block.state !== "pending" || !block.proposalToken || !onConfirm}
          aria-busy={confirming} onClick={() => onConfirm?.(block)}
          className="nk-focus min-h-11 rounded-xl bg-violet-700 px-3 text-sm font-black text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
          {confirming ? "Registrando desmontagem..." : block.confirmLabel}
        </button>
        <button type="button" disabled={disabled || confirming || block.state !== "pending" || !onCancel} onClick={() => onCancel?.(block)}
          className="nk-focus min-h-11 rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary disabled:opacity-50">{block.cancelLabel}</button>
        </div>
      </>}
  </div>;
}

function ConfigurationDisassemblyResult({ block }: { block: AssistantConfigurationDisassemblyResultBlock }) {
  const tone = block.outcome === "success" ? "border-emerald-200 bg-emerald-50/55" : "border-red-200 bg-red-50/45";
  return <div className="min-w-0">
    <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">Resultado da ação</p>
      <h3 className="text-base font-black text-text-primary sm:text-lg">{block.title}</h3>
      <p className="mt-1 text-sm font-semibold text-text-muted">{block.message}</p>
      {block.idempotentReplay ? <span className="mt-2 inline-flex rounded-full bg-violet-100 px-2 py-1 text-[0.62rem] font-black text-violet-900 uppercase">Resultado idempotente</span> : null}
      {block.refreshWarning ? <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-950">A operação foi concluída; a atualização visual pode exigir recarregar a página.</p> : null}
    </div>
    {block.target && block.mountedStockBefore !== null && block.mountedStockAfter !== null &&
      block.servoStockAfter !== null && block.installationKitStockAfter !== null ? <article className="mt-3 rounded-xl border border-border-neutral bg-white p-3">
        <ConfigurationAssemblyTargetHeader target={block.target} />
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <PickupMetric label="Antes" value={block.mountedStockBefore} />
          <PickupMetric label="Desmontagem" value={block.quantity} emphasis />
          <PickupMetric label="Depois" value={block.mountedStockAfter} emphasis />
        </div>
        <p className="mt-2 text-xs font-semibold text-text-muted">Saldos avulsos após a desmontagem: Servo {block.target.servo.code}: {block.servoStockAfter}; Kit {block.target.installationKit.code}: {block.installationKitStockAfter}.</p>
      </article> : null}
    {block.actions.length ? <div className="mt-4 flex flex-wrap gap-2">{block.actions.map((action) => action.kind === "link" ? <Link key={`${action.label}-${action.href}`} href={action.href}
      className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary">{action.label}</Link> : null)}</div> : null}
  </div>;
}

function SupplierOrderFinalizationPreview({ block, disabled, confirming, onConfirm, onCancel, onPromptSelect }: {
  block: AssistantSupplierOrderFinalizationPreviewBlock;
  disabled: boolean;
  confirming: boolean;
  onConfirm?: (block: AssistantSupplierOrderFinalizationPreviewBlock) => void;
  onCancel?: (block: AssistantSupplierOrderFinalizationPreviewBlock) => void;
  onPromptSelect?: (prompt: string) => void;
}) {
  const [locallyExpired, setLocallyExpired] = useState(false);
  useEffect(() => {
    if (block.state !== "pending" || !block.expiresAt) return;
    const timeout = window.setTimeout(() => setLocallyExpired(true), Math.max(Date.parse(block.expiresAt) - Date.now(), 0));
    return () => window.clearTimeout(timeout);
  }, [block.expiresAt, block.state]);
  const expired = block.state === "expired" || locallyExpired;
  return <div className="min-w-0">
    <p className="text-[0.65rem] font-black tracking-[0.12em] text-violet-800 uppercase">Ação operacional</p>
    <h3 className="text-base font-black text-text-primary sm:text-lg">{expired ? "Prévia expirada" : block.title}</h3>
    <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">{expired ? "Gere uma nova prévia com os dados atuais." : block.message}</p>
    <article className="mt-3 rounded-xl border border-violet-200 bg-violet-50/35 p-3">
      <PickupOrderHeader order={block.order} />
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <PickupMetric label="Solicitado" value={block.order.orderedQuantity} />
        <PickupMetric label="Retirado" value={block.order.pickedQuantity} emphasis />
        <PickupMetric label="Pendente" value={block.order.waitingPickupQuantity} />
      </div>
      <p className="mt-3 text-xs font-semibold text-text-muted">Este Pedido será encerrado e passará para o Histórico/finalizados.</p>
    </article>
    {expired ? <button type="button" disabled={disabled || !onPromptSelect} onClick={() => onPromptSelect?.(block.regeneratePrompt)}
      className="nk-focus mt-4 min-h-11 rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white disabled:opacity-50">Gerar nova prévia</button>
      : <>
        {confirming ? <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-900">Finalizando Pedido. Não feche esta tela.</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || confirming || !block.proposalToken || !onConfirm}
          aria-busy={confirming} onClick={() => onConfirm?.(block)}
          className="nk-focus min-h-11 rounded-xl bg-emerald-700 px-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
          {confirming ? "Finalizando Pedido..." : block.confirmLabel}
        </button>
        <button type="button" disabled={disabled || confirming || !onCancel} onClick={() => onCancel?.(block)}
          className="nk-focus min-h-11 rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary disabled:opacity-50">{block.cancelLabel}</button>
        </div>
      </>}
  </div>;
}

function SupplierOrderFinalizationResult({ block }: { block: AssistantSupplierOrderFinalizationResultBlock }) {
  const tone = block.outcome === "success" ? "border-emerald-200 bg-emerald-50/55" :
    block.outcome === "conflict" ? "border-amber-200 bg-amber-50/55" : "border-red-200 bg-red-50/45";
  return <div className="min-w-0">
    <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="text-[0.65rem] font-black tracking-[0.12em] text-brand-gold-ink uppercase">Resultado da ação</p>
      <h3 className="text-base font-black text-text-primary sm:text-lg">{block.title}</h3>
      <p className="mt-1 text-sm font-semibold text-text-muted">{block.message}</p>
      {block.idempotentReplay ? <span className="mt-2 inline-flex rounded-full bg-violet-100 px-2 py-1 text-[0.62rem] font-black text-violet-900 uppercase">Resultado idempotente</span> : null}
      {block.refreshWarning ? <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-950">A operação foi concluída; a atualização visual pode exigir recarregar a página.</p> : null}
    </div>
    {block.order ? <div className="mt-3"><PickupOrderHeader order={block.order} /></div> : null}
    {block.actions.length ? <div className="mt-4 flex flex-wrap gap-2">{block.actions.map((action) => action.kind === "link" ? <Link key={`${action.label}-${action.href}`} href={action.href}
      className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-border-neutral bg-white px-3 text-sm font-black text-text-primary">{action.label}</Link> : null)}</div> : null}
  </div>;
}

const clarificationGroups: Array<{
  label: string;
  categories: AssistantClarificationCategory[];
}> = [
  { label: "Estoque", categories: ["inventory"] },
  { label: "Pedidos", categories: ["supplier_orders"] },
  {
    label: "Fotos e reposição",
    categories: ["media", "replenishment"],
  },
];

function AssistantClarification({
  block,
  disabled,
  onPromptSelect,
}: {
  block: AssistantClarificationBlock;
  disabled: boolean;
  onPromptSelect?: (
    prompt: string,
    context?: {
      supplierOrderId?: string;
      supplierOrderItemId?: string;
      inventoryAction?: AssistantServoModelInventoryAction;
      stockEntrySelection?: AssistantStockEntrySelection;
      stockOutputSelection?: AssistantStockOutputSelection;
      configurationAssemblySelection?: AssistantConfigurationAssemblySelection;
      configurationDisassemblySelection?: AssistantConfigurationDisassemblySelection;
      openOrderPhotoPicker?: boolean;
      cancelStockEntry?: boolean;
      cancelStockOutput?: boolean;
      cancelConfigurationAssembly?: boolean;
      cancelConfigurationDisassembly?: boolean;
    },
  ) => void;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-base font-black text-text-primary sm:text-lg">
        {block.title}
      </h3>
      {block.message ? (
        <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">
          {block.message}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3">
        {clarificationGroups.map((group) => {
          const options = block.options.filter((option) =>
            group.categories.includes(option.category),
          );

          if (options.length === 0) {
            return null;
          }

          return (
            <section key={group.label} aria-label={group.label}>
              <h4 className="mb-1 text-[0.65rem] font-black tracking-[0.1em] text-text-muted uppercase">
                {group.label}
              </h4>
              <div className="grid gap-1.5">
                {options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled || !onPromptSelect}
                    onClick={() =>
                      onPromptSelect?.(option.prompt, {
                        ...(option.contextSupplierOrderId
                          ? {
                              supplierOrderId:
                                option.contextSupplierOrderId,
                            }
                          : {}),
                        ...(option.contextSupplierOrderItemId
                          ? {
                              supplierOrderItemId:
                                option.contextSupplierOrderItemId,
                            }
                          : {}),
                        ...(option.action
                          ? { inventoryAction: option.action }
                          : {}),
                        ...(option.stockEntrySelection
                          ? { stockEntrySelection: option.stockEntrySelection }
                          : {}),
                        ...(option.stockOutputSelection
                          ? { stockOutputSelection: option.stockOutputSelection }
                          : {}),
                        ...(option.configurationAssemblySelection
                          ? { configurationAssemblySelection: option.configurationAssemblySelection }
                          : {}),
                        ...(option.configurationDisassemblySelection
                          ? { configurationDisassemblySelection: option.configurationDisassemblySelection }
                          : {}),
                        ...(option.id === "initial-order-photo"
                          ? { openOrderPhotoPicker: true }
                          : {}),
                        ...(option.id === "entry-cancel"
                          ? { cancelStockEntry: true }
                          : {}),
                        ...(option.id === "output-cancel"
                          ? { cancelStockOutput: true }
                          : {}),
                        ...(option.id === "assembly-cancel"
                          ? { cancelConfigurationAssembly: true }
                          : {}),
                        ...(option.id === "disassembly-cancel"
                          ? { cancelConfigurationDisassembly: true }
                          : {}),
                      })
                    }
                    aria-label={option.id === "entry-cancel" ? "Cancelar entrada" : option.id === "output-cancel" ? "Cancelar saída" : option.id === "assembly-cancel" ? "Cancelar montagem" : option.id === "disassembly-cancel" ? "Cancelar desmontagem" : `Enviar sugestão: ${option.prompt}`}
                    className="nk-focus flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-border-neutral bg-app-background px-3 py-2 text-left transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      aria-hidden="true"
                      className="shrink-0 font-black text-violet-700"
                    >
                      ›
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-xs font-black text-text-primary sm:text-sm">
                        {option.label}
                      </strong>
                      <span className="block break-words text-[0.68rem] leading-4 font-semibold text-text-muted sm:text-xs">
                        {option.description ?? option.prompt}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function AssistantStructuredBlockView({
  block,
  disabled = false,
  onPromptSelect,
  onPickupConfirm,
  onPickupCancel,
  confirmingPickup = false,
  pickupProgressLabel = null,
  onStockEntryConfirm,
  onStockEntryCancel,
  confirmingStockEntry = false,
  onStockOutputConfirm,
  onStockOutputCancel,
  confirmingStockOutput = false,
  onConfigurationAssemblyConfirm,
  onConfigurationAssemblyCancel,
  confirmingConfigurationAssembly = false,
  onConfigurationDisassemblyConfirm,
  onConfigurationDisassemblyCancel,
  confirmingConfigurationDisassembly = false,
  onSupplierOrderFinalizationConfirm,
  onSupplierOrderFinalizationCancel,
  confirmingSupplierOrderFinalization = false,
  onSupplierOrderPhotoUpdate,
}: {
  block: AssistantStructuredBlock;
  disabled?: boolean;
  onPromptSelect?: (
    prompt: string,
    context?: {
      supplierOrderId?: string;
      supplierOrderItemId?: string;
      inventoryAction?: AssistantServoModelInventoryAction;
      stockEntrySelection?: AssistantStockEntrySelection;
      stockOutputSelection?: AssistantStockOutputSelection;
      configurationAssemblySelection?: AssistantConfigurationAssemblySelection;
      configurationDisassemblySelection?: AssistantConfigurationDisassemblySelection;
      openOrderPhotoPicker?: boolean;
      cancelStockEntry?: boolean;
      cancelStockOutput?: boolean;
      cancelConfigurationAssembly?: boolean;
      cancelConfigurationDisassembly?: boolean;
    },
  ) => void;
  onPickupConfirm?: (
    block: AssistantSupplierOrderPickupPreviewBlock,
  ) => void;
  onPickupCancel?: (
    block: AssistantSupplierOrderPickupPreviewBlock,
  ) => void;
  confirmingPickup?: boolean;
  pickupProgressLabel?: string | null;
  onStockEntryConfirm?: (block: StockEntryPreviewBlock) => void;
  onStockEntryCancel?: (block: StockEntryPreviewBlock) => void;
  confirmingStockEntry?: boolean;
  onStockOutputConfirm?: (block: AssistantManualStockOutputPreviewBlock) => void;
  onStockOutputCancel?: (block: AssistantManualStockOutputPreviewBlock) => void;
  confirmingStockOutput?: boolean;
  onConfigurationAssemblyConfirm?: (block: AssistantConfigurationAssemblyPreviewBlock) => void;
  onConfigurationAssemblyCancel?: (block: AssistantConfigurationAssemblyPreviewBlock) => void;
  confirmingConfigurationAssembly?: boolean;
  onConfigurationDisassemblyConfirm?: (block: AssistantConfigurationDisassemblyPreviewBlock) => void;
  onConfigurationDisassemblyCancel?: (block: AssistantConfigurationDisassemblyPreviewBlock) => void;
  confirmingConfigurationDisassembly?: boolean;
  onSupplierOrderFinalizationConfirm?: (block: AssistantSupplierOrderFinalizationPreviewBlock) => void;
  onSupplierOrderFinalizationCancel?: (block: AssistantSupplierOrderFinalizationPreviewBlock) => void;
  confirmingSupplierOrderFinalization?: boolean;
  onSupplierOrderPhotoUpdate?: (
    block: AssistantSupplierOrderPhotoPreviewBlock | AssistantSupplierOrderPhotoCreateResultBlock,
  ) => void;
}) {
  switch (block.kind) {
    case "assistant_statistics":
      return <AssistantStatistics block={block} />;
    case "supplier_order_photo_preview":
      return <SupplierOrderPhotoPreview block={block} disabled={disabled} onUpdate={onSupplierOrderPhotoUpdate} />;
    case "supplier_order_photo_create_result":
      return <SupplierOrderPhotoCreateResult block={block} />;
    case "supplier_order_stock_entry_preview":
    case "manual_stock_entry_preview":
      return <StockEntryPreview block={block} disabled={disabled} confirming={confirmingStockEntry}
        onConfirm={onStockEntryConfirm} onCancel={onStockEntryCancel} onPromptSelect={onPromptSelect} />;
    case "supplier_order_stock_entry_result":
    case "manual_stock_entry_result":
      return <StockEntryResult block={block} />;
    case "manual_stock_output_preview":
      return <StockOutputPreview block={block} disabled={disabled} confirming={confirmingStockOutput}
        onConfirm={onStockOutputConfirm} onCancel={onStockOutputCancel} onPromptSelect={onPromptSelect} />;
    case "manual_stock_output_result":
      return <StockOutputResult block={block} />;
    case "configuration_assembly_preview":
      return <ConfigurationAssemblyPreview block={block} disabled={disabled} confirming={confirmingConfigurationAssembly}
        onConfirm={onConfigurationAssemblyConfirm} onCancel={onConfigurationAssemblyCancel} onPromptSelect={onPromptSelect} />;
    case "configuration_assembly_result":
      return <ConfigurationAssemblyResult block={block} />;
    case "configuration_disassembly_preview":
      return <ConfigurationDisassemblyPreview block={block} disabled={disabled} confirming={confirmingConfigurationDisassembly}
        onConfirm={onConfigurationDisassemblyConfirm} onCancel={onConfigurationDisassemblyCancel} onPromptSelect={onPromptSelect} />;
    case "configuration_disassembly_result":
      return <ConfigurationDisassemblyResult block={block} />;
    case "supplier_order_finalization_preview":
      return <SupplierOrderFinalizationPreview block={block} disabled={disabled} confirming={confirmingSupplierOrderFinalization}
        onConfirm={onSupplierOrderFinalizationConfirm} onCancel={onSupplierOrderFinalizationCancel} onPromptSelect={onPromptSelect} />;
    case "supplier_order_finalization_result":
      return <SupplierOrderFinalizationResult block={block} />;
    case "assistant_action_preview":
      return (
        <SupplierOrderPickupPreview
          block={block}
          disabled={disabled}
          confirming={confirmingPickup}
          progressLabel={pickupProgressLabel}
          onConfirm={onPickupConfirm}
          onCancel={onPickupCancel}
          onPromptSelect={onPromptSelect}
        />
      );
    case "assistant_action_result":
      return (
        <SupplierOrderPickupResult
          block={block}
          disabled={disabled}
          onPromptSelect={onPromptSelect}
        />
      );
    case "assistant_clarification":
      return (
        <AssistantClarification
          block={block}
          disabled={disabled}
          onPromptSelect={onPromptSelect}
        />
      );
    case "inventory_alerts":
      return <InventoryAlertsBlock block={block} />;
    case "inventory_item_summary":
      return <InventoryItemSummaryBlock block={block} />;
    case "servo_model_inventory_breakdown":
      return <ServoModelInventoryBreakdown block={block} />;
    case "catalog_media":
      return <CatalogMediaBlock block={block} />;
    case "supplier_order_list":
      return <SupplierOrderList block={block} />;
    case "supplier_order_detail":
      return <SupplierOrderDetail block={block} />;
    case "supplier_order_aggregate":
      return <SupplierOrderAggregate block={block} />;
    case "supplier_order_ambiguity":
      return <SupplierOrderAmbiguity block={block} />;
    case "purchase_recommendation_list":
      return <PurchaseRecommendationList block={block} />;
  }
}
