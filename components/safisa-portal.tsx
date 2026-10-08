"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  correctSafisaReadyQuantity,
  incrementSafisaReadyQuantity,
  markSafisaOrderRemainingReady,
  markSafisaRemainingReady,
  safisaLogout,
} from "@/app/safisa/actions";
import { SafisaPortalDialog } from "@/components/safisa-portal-dialog";
import { maximumReadyQuantity } from "@/lib/safisa-portal-readiness";
import {
  markSafisaAttemptResultUnknown,
  prepareSafisaLogicalAttempt,
  restoreSafisaLogicalAttempt,
  serializeSafisaLogicalAttempt,
  type SafisaAttemptStartMode,
  type SafisaAttemptPayload,
  type SafisaLogicalAttempt,
} from "@/lib/safisa-logical-attempt";
import type {
  SafisaActionResult,
  SafisaOrderDetail,
  SafisaOrderLine,
  SafisaOrderSummary,
} from "@/lib/safisa-portal-types";

type Props = {
  userId: string;
  displayName: string;
  activeOrders: SafisaOrderSummary[];
  completedOrders: SafisaOrderSummary[];
  selectedOrder: SafisaOrderDetail | null;
  loadMessage?: string;
};

type PendingConfirmation =
  | { kind: "order"; pendingQuantity: number; pendingLineCount: number }
  | { kind: "remaining"; line: SafisaOrderLine }
  | { kind: "correction"; line: SafisaOrderLine; total: number; justification: string }
  | null;

type StatusSource = {
  closureKind?: SafisaOrderSummary["closureKind"];
  readinessStatus: SafisaOrderSummary["readinessStatus"];
};

const numberFormatter = new Intl.NumberFormat("pt-BR");

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));
}

function closureLabel(order: SafisaOrderSummary | SafisaOrderDetail) {
  if (order.closureKind === "FINALIZED") return "Finalizado";
  if (order.closureKind === "CANCELLED") return "Cancelado";
  // Portal status describes production. Pickup remains secondary information.
  if (order.readinessStatus === "COMPLETELY_READY") return "Completamente pronto";
  if (order.readinessStatus === "PARTIALLY_READY") return "Parcialmente pronto";
  return "Em preparação";
}

function statusClass(order: StatusSource) {
  if (order.closureKind) return "border-slate-200 bg-slate-100 text-slate-700";
  if (order.readinessStatus === "COMPLETELY_READY") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (order.readinessStatus === "PARTIALLY_READY") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  return "border-blue-200 bg-blue-50 text-blue-950";
}

function orderHref(id: string) {
  return "/safisa?pedido=" + encodeURIComponent(id);
}

function attemptTargetId(payload: SafisaAttemptPayload) {
  return payload.kind === "MARK_ORDER_REMAINING_READY"
    ? payload.supplierOrderId
    : payload.supplierOrderItemId;
}

function executeSafisaAttempt(
  payload: SafisaAttemptPayload,
  idempotencyKey: string,
): Promise<SafisaActionResult> {
  switch (payload.kind) {
    case "INCREMENT_READY_QUANTITY":
      return incrementSafisaReadyQuantity({
        idempotencyKey,
        supplierOrderId: payload.supplierOrderId,
        supplierOrderItemId: payload.supplierOrderItemId,
        incrementQuantity: payload.incrementQuantity,
      });
    case "MARK_LINE_REMAINING_READY":
      return markSafisaRemainingReady({
        idempotencyKey,
        supplierOrderId: payload.supplierOrderId,
        supplierOrderItemId: payload.supplierOrderItemId,
        incrementQuantity: payload.incrementQuantity,
      });
    case "MARK_ORDER_REMAINING_READY":
      return markSafisaOrderRemainingReady({
        idempotencyKey,
        supplierOrderId: payload.supplierOrderId,
      });
    case "CORRECT_READY_QUANTITY":
      return correctSafisaReadyQuantity({
        idempotencyKey,
        supplierOrderId: payload.supplierOrderId,
        supplierOrderItemId: payload.supplierOrderItemId,
        newReadyQuantity: payload.newReadyQuantity,
        justification: payload.justification,
        expectedUpdatedAt: payload.expectedUpdatedAt,
      });
  }
}

function ProductionProgress({ order, compact = false }: {
  order: SafisaOrderSummary | SafisaOrderDetail;
  compact?: boolean;
}) {
  const progress = order.orderedQuantity > 0
    ? Math.min(100, (order.readyQuantity / order.orderedQuantity) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className={compact ? "text-[0.65rem] font-semibold tabular-nums sm:text-xs" : "text-sm font-bold tabular-nums sm:text-base"}>
          {numberFormatter.format(order.readyQuantity)} {compact ? "/" : "de"} {numberFormatter.format(order.orderedQuantity)}
          <span className={compact ? "hidden lg:inline" : ""}>{compact ? " prontos" : " unidades prontas"}</span>
        </p>
        <span className={compact ? "hidden font-mono text-xs font-bold sm:inline" : "font-mono text-xl font-black"}>{Math.round(progress)}%</span>
      </div>
      <div role="progressbar" aria-label="Progresso da produção"
        aria-valuemin={0} aria-valuemax={order.orderedQuantity} aria-valuenow={order.readyQuantity}
        className={`mt-1.5 overflow-hidden rounded-full bg-slate-200 ${compact ? "h-1.5" : "h-2"}`}>
        <div className={`h-full rounded-full ${order.readinessStatus === "COMPLETELY_READY" ? "bg-emerald-600" : "bg-blue-700"}`} style={{ width: progress + "%" }} />
      </div>
    </div>
  );
}

export function SafisaPortal({
  userId,
  displayName,
  activeOrders,
  completedOrders,
  selectedOrder,
  loadMessage,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<SafisaActionResult | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>(null);
  const [isAttemptRestoring, setIsAttemptRestoring] = useState(true);
  const [selectedList, setSelectedList] = useState<"ACTIVE" | "COMPLETED">(
    selectedOrder?.portalState ?? "ACTIVE",
  );
  const openedFromList = useRef(false);
  const operationLock = useRef(false);
  const logicalAttempt = useRef<SafisaLogicalAttempt | null>(null);
  const [unknownAttempt, setUnknownAttempt] = useState<SafisaLogicalAttempt | null>(null);
  const attemptStorageKey = `negocios-k:safisa-logical-attempt:v1:${userId}`;
  const orders = selectedList === "ACTIVE" ? activeOrders : completedOrders;
  const remainingLineCount =
    selectedOrder?.lines.filter((line) => line.waitingReadyQuantity > 0).length ?? 0;
  const mutationControlsBlocked =
    isAttemptRestoring || isPending || unknownAttempt !== null;

  // A URL change / Activity hide must not resurrect a mutation confirmation.
  // The operation ref and persisted logical attempt remain untouched.
  useEffect(() => () => {
    if (!operationLock.current) setConfirmation(null);
  }, [selectedOrder?.supplierOrderId]);

  useEffect(() => {
    let restored: SafisaLogicalAttempt | null = null;
    try {
      const serialized = localStorage.getItem(attemptStorageKey);
      restored = serialized ? restoreSafisaLogicalAttempt(serialized) : null;
      if (restored && !logicalAttempt.current && !operationLock.current) {
        logicalAttempt.current = restored;
      }
    } catch {
      // The in-memory attempt remains available when browser storage is blocked.
    }
    const restoreTimer = setTimeout(() => {
      if (restored && logicalAttempt.current === restored) {
        setUnknownAttempt(restored);
        setFeedback({
          status: "unknown",
          message: "Não foi possível confirmar o resultado da operação. Tente verificar novamente.",
        });
      }
      setIsAttemptRestoring(false);
    }, 0);
    return () => {
      clearTimeout(restoreTimer);
    };
  }, [attemptStorageKey]);

  function persistAttempt(attempt: SafisaLogicalAttempt) {
    try {
      localStorage.setItem(attemptStorageKey, serializeSafisaLogicalAttempt(attempt));
    } catch {
      // The ref still protects retries for the lifetime of this mounted portal.
    }
  }

  function clearPersistedAttempt() {
    try {
      localStorage.removeItem(attemptStorageKey);
    } catch {
      // A stale stored attempt is safe: replaying its key can only fetch its receipt.
    }
  }

  function showUnknownAttemptBlock(attempt: SafisaLogicalAttempt | null) {
    if (attempt?.state === "RESULT_UNKNOWN") {
      setUnknownAttempt(attempt);
    }
    setConfirmation(null);
    setFeedback({
      status: "unknown",
      message: "Não foi possível confirmar o resultado da operação. Tente verificar novamente.",
    });
  }

  function requestConfirmation(nextConfirmation: Exclude<PendingConfirmation, null>) {
    if (isAttemptRestoring) return;
    const currentAttempt = logicalAttempt.current;
    if (currentAttempt?.state === "RESULT_UNKNOWN") {
      showUnknownAttemptBlock(currentAttempt);
      return;
    }
    setConfirmation(nextConfirmation);
  }

  function completeAction(
    payload: SafisaAttemptPayload,
    mode: SafisaAttemptStartMode = "NEW_MUTATION",
  ) {
    if (isAttemptRestoring || isPending || operationLock.current) return;
    const currentAttempt = logicalAttempt.current;
    const attemptStart = prepareSafisaLogicalAttempt(
      currentAttempt,
      payload,
      () => crypto.randomUUID(),
      mode,
    );
    if (attemptStart.kind === "BLOCKED_BY_UNKNOWN") {
      showUnknownAttemptBlock(attemptStart.attempt);
      return;
    }

    operationLock.current = true;
    const { attempt, retryingUnknownAttempt } = attemptStart;
    logicalAttempt.current = attempt;
    persistAttempt(attempt);
    setUnknownAttempt(null);
    setActiveLineId(attemptTargetId(payload));
    setFeedback(null);

    startTransition(async () => {
      try {
        const result = await executeSafisaAttempt(payload, attempt.idempotencyKey);
        setFeedback(result);
        if (
          result.status === "unknown" ||
          (retryingUnknownAttempt && result.status !== "success")
        ) {
          const unresolvedAttempt = markSafisaAttemptResultUnknown(attempt);
          logicalAttempt.current = unresolvedAttempt;
          setUnknownAttempt(unresolvedAttempt);
          persistAttempt(unresolvedAttempt);
          if (result.status !== "unknown") {
            setFeedback({
              status: "unknown",
              message: `O resultado anterior continua sem confirmação. ${result.message}`,
            });
          }
          return;
        }
        logicalAttempt.current = null;
        clearPersistedAttempt();
        router.refresh();
      } catch {
        const unresolvedAttempt = markSafisaAttemptResultUnknown(attempt);
        logicalAttempt.current = unresolvedAttempt;
        setUnknownAttempt(unresolvedAttempt);
        persistAttempt(unresolvedAttempt);
        setFeedback({
          status: "unknown",
          message: "Não foi possível confirmar o resultado da operação. Tente verificar novamente.",
        });
      } finally {
        setActiveLineId(null);
        setConfirmation(null);
        operationLock.current = false;
      }
    });
  }

  function retryUnknownAction() {
    if (!unknownAttempt) return;
    completeAction(unknownAttempt.payload, "RECONCILE_UNKNOWN");
  }

  function warmOrder(orderId: string) {
    router.prefetch(orderHref(orderId));
  }

  function openOrder(order: SafisaOrderSummary) {
    if (isPending || operationLock.current) return;
    openedFromList.current = true;
    router.push(orderHref(order.supplierOrderId), { scroll: false });
    setSelectedList(order.portalState);
    setOpeningOrderId(order.supplierOrderId);
    window.setTimeout(() => {
      setOpeningOrderId((currentOrderId) =>
        currentOrderId === order.supplierOrderId ? null : currentOrderId,
      );
    }, 5_000);
  }

  function closeOrder() {
    if (isPending || operationLock.current || confirmation) return;
    setOpeningOrderId(null);
    if (openedFromList.current) router.back();
    else router.replace("/safisa", { scroll: false });
  }

  return (
    <div className="min-h-dvh bg-[#f4f7fb] text-slate-950">
      <header inert={selectedOrder ? true : undefined} className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex min-h-[4.5rem] max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-black tracking-[0.16em] text-blue-800 uppercase">Central operacional</p>
            <p className="mt-0.5 truncate text-base font-black tracking-tight text-slate-950">
              Portal Safisa
              <span className="ml-2 hidden text-sm font-semibold text-slate-500 sm:inline">· Olá, {displayName}</span>
            </p>
          </div>
          <form action={safisaLogout}>
            <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
              Sair
            </button>
          </form>
        </div>
      </header>

      <div inert={selectedOrder ? true : undefined}>
      <main className="mx-auto max-w-7xl px-3 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 lg:px-8">
        <section aria-labelledby="orders-title" className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h1 id="orders-title" className="text-2xl font-black tracking-tight">Pedidos</h1>
            <span className="text-sm font-bold tabular-nums text-slate-500">{orders.length} {orders.length === 1 ? "pedido" : "pedidos"}</span>
          </div>
          <div className="mt-4 flex gap-1 rounded-xl bg-slate-200/60 p-1 sm:w-fit" role="tablist" aria-label="Situação dos pedidos">
            {(["ACTIVE", "COMPLETED"] as const).map(view => (
              <button key={view} type="button" role="tab" aria-selected={selectedList === view}
                onClick={() => setSelectedList(view)}
                className={classNames("min-h-11 flex-1 rounded-lg px-4 text-sm font-bold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:flex-none",
                  selectedList === view ? "bg-white text-blue-950 shadow-sm" : "text-slate-600 hover:bg-white/50")}>
                {view === "ACTIVE" ? "Em andamento" : "Histórico"}
              </button>
            ))}
          </div>
          {!selectedOrder ? <div aria-live="polite" className="mt-3">          {feedback ? (
            <div
              role={feedback.status === "success" ? "status" : "alert"}
              className={classNames(
                "mb-4 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm",
                feedback.status === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : feedback.status === "conflict" || feedback.status === "unknown"
                    ? "border-amber-200 bg-amber-50 text-amber-950"
                    : "border-red-200 bg-red-50 text-red-800",
              )}
            >
              <p>{feedback.message}</p>
              {feedback.status === "unknown" && unknownAttempt ? (
                <>
                  <p className="mt-1 font-semibold">
                    Confirme o resultado da operação anterior antes de realizar outra ação.
                  </p>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={retryUnknownAction}
                    className="mt-3 min-h-11 rounded-xl border border-amber-400 bg-white px-4 text-sm font-black text-amber-950 transition hover:bg-amber-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isPending ? "Verificando…" : "Tentar verificar novamente"}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {loadMessage ? (
            <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950 shadow-sm">
              {loadMessage}
            </div>
          ) : null}

</div> : null}
          {orders.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-600">
              {selectedList === "ACTIVE" ? "Nenhum pedido em andamento no momento." : "Nenhum pedido concluído no momento."}
            </p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full table-fixed text-left">
                <caption className="sr-only">Pedidos Safisa {selectedList === "ACTIVE" ? "em andamento" : "no histórico"}. Selecione uma linha para abrir o pedido.</caption>
                <thead className="border-b border-slate-200 bg-slate-100 text-[0.65rem] font-black uppercase sm:text-xs">
                  <tr>
                    <th scope="col" className="w-[19%] px-2 py-3 sm:w-[16%] sm:px-4">Data</th>
                    <th scope="col" className="w-[22%] px-1 py-3 sm:w-[19%] sm:px-4"><span className="sm:hidden">Pedido</span><span className="hidden sm:inline">Nº do pedido</span></th>
                    <th scope="col" className="w-[22%] px-1 py-3 sm:w-[18%] sm:px-4"><span className="sm:hidden">Itens</span><span className="hidden sm:inline">Total de itens</span></th>
                    <th scope="col" className="px-2 py-3 sm:w-[23%] sm:px-4"><span className="sm:hidden">Situação</span><span className="hidden sm:inline">Status</span></th>
                    <th scope="col" className="hidden w-[24%] px-4 py-3 sm:table-cell">Progresso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {orders.map(order => {
                    const opening = !selectedOrder && !loadMessage && openingOrderId === order.supplierOrderId;
                    return (
                      <tr key={order.supplierOrderId} role="button" tabIndex={0}
                        aria-label={`Abrir Pedido ${order.negotiationNumber}, ${closureLabel(order)}`}
                        aria-busy={opening || undefined}
                        onPointerEnter={() => warmOrder(order.supplierOrderId)}
                        onFocus={() => warmOrder(order.supplierOrderId)}
                        onTouchStart={() => warmOrder(order.supplierOrderId)}
                        onClick={event => { event.currentTarget.focus(); openOrder(order); }}
                        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openOrder(order); } }}
                        className="cursor-pointer text-xs outline-offset-[-3px] focus-visible:outline-2 focus-visible:outline-blue-700 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-blue-50/60 sm:text-sm">
                        <td className="px-2 py-3 align-middle font-semibold text-slate-600 sm:px-4"><span className="sm:hidden">{formatDate(order.orderDate).slice(0, 5)}</span><span className="hidden sm:inline">{formatDate(order.orderDate)}</span></td>
                        <td className="px-1 py-3 align-middle font-mono font-black break-all sm:px-4 sm:text-base">{order.negotiationNumber}</td>
                        <td className="px-1 py-3 align-middle sm:px-4"><p className="font-bold tabular-nums">{numberFormatter.format(order.orderedQuantity)} un.</p><p className="mt-0.5 text-[0.65rem] text-slate-500 sm:text-xs">{order.lineCount} {order.lineCount === 1 ? "item" : "itens"}</p></td>
                        <td className="px-2 py-3 align-middle sm:px-4"><span className={classNames("inline-block max-w-full rounded-lg border px-1.5 py-1 text-[0.6rem] leading-tight font-bold break-words sm:text-xs", statusClass(order))}>{opening ? "Abrindo…" : closureLabel(order)}</span><div className="mt-1.5 sm:hidden"><ProductionProgress order={order} compact /></div></td>
                        <td className="hidden px-4 py-3 align-middle sm:table-cell"><ProductionProgress order={order} compact /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      </div>

      {selectedOrder ? (
        <SafisaPortalDialog titleId="safisa-order-title" descriptionId="safisa-order-description"
          title={`Pedido ${selectedOrder.negotiationNumber}`} onClose={closeOrder}
          pending={isPending} covered={confirmation !== null}
          footer={!selectedOrder.isReadOnly && selectedOrder.waitingReadyQuantity > 0 ? (
                  <div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:px-5">
                    <button
                      type="button"
                      disabled={mutationControlsBlocked}
                      onClick={() =>
                        requestConfirmation({
                          kind: "order",
                          pendingQuantity: selectedOrder.waitingReadyQuantity,
                          pendingLineCount: remainingLineCount,
                        })
                      }
                      className="min-h-11 shrink-0 rounded-xl bg-blue-800 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-900 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      Dar todo o Pedido como pronto
                    </button>
                  </div>
                ) : null}>
          <div id="safisa-order-description" className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 sm:px-5">
            <p className="text-xs font-semibold text-slate-600 sm:text-sm">{formatDate(selectedOrder.orderDate)}</p>
            <span className={classNames("rounded-full border px-2.5 py-1 text-[0.65rem] font-bold sm:text-xs", statusClass(selectedOrder))}>{closureLabel(selectedOrder)}</span>
          </div>
          <div aria-live="polite" className="px-3 pt-3 sm:px-5">          {feedback ? (
            <div
              role={feedback.status === "success" ? "status" : "alert"}
              className={classNames(
                "mb-4 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm",
                feedback.status === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : feedback.status === "conflict" || feedback.status === "unknown"
                    ? "border-amber-200 bg-amber-50 text-amber-950"
                    : "border-red-200 bg-red-50 text-red-800",
              )}
            >
              <p>{feedback.message}</p>
              {feedback.status === "unknown" && unknownAttempt ? (
                <>
                  <p className="mt-1 font-semibold">
                    Confirme o resultado da operação anterior antes de realizar outra ação.
                  </p>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={retryUnknownAction}
                    className="mt-3 min-h-11 rounded-xl border border-amber-400 bg-white px-4 text-sm font-black text-amber-950 transition hover:bg-amber-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isPending ? "Verificando…" : "Tentar verificar novamente"}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {loadMessage ? (
            <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950 shadow-sm">
              {loadMessage}
            </div>
          ) : null}

</div>
          <section aria-labelledby="safisa-production-title" className="border-b border-slate-200 px-3 pb-3 sm:px-5">
            <h3 id="safisa-production-title" className="mb-2 text-[0.68rem] font-black tracking-wider text-slate-600 uppercase">Progresso da produção</h3>
            <ProductionProgress order={selectedOrder} />
            <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
              <p>Faltam {numberFormatter.format(selectedOrder.waitingReadyQuantity)} unidades.</p>
              <p>Pronto aguardando retirada: {numberFormatter.format(selectedOrder.readyWaitingPickupQuantity)}</p>
            </div>
            {selectedOrder.isReadOnly ? <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">Pedido encerrado: informações disponíveis somente para consulta.</p> : null}
          </section>
          <section aria-labelledby="safisa-products-title">
            <div className="px-3 py-3 sm:px-5"><p className="text-[0.65rem] font-black tracking-wider text-blue-800 uppercase">Ordem de produção</p><h3 id="safisa-products-title" className="mt-0.5 text-sm font-black sm:text-base">Descrição dos Produtos</h3></div>
            <div role="table" aria-label="Itens da ordem de produção">
              <div role="row" className="grid grid-cols-[minmax(2.5rem,0.7fr)_minmax(0,2.5fr)_minmax(3rem,0.5fr)_minmax(3rem,0.6fr)] gap-2 bg-blue-950 px-3 py-2.5 text-[0.6rem] font-black text-white uppercase sm:px-5 sm:text-xs">
                <span role="columnheader">Cód.</span><span role="columnheader">Descrição dos Produtos</span><span role="columnheader" className="text-right">Qtde.</span><span role="columnheader" className="text-right">Pronto</span>
              </div>
              {selectedOrder.lines.map(line => {
                const canMarkReady = !selectedOrder.isReadOnly && line.waitingReadyQuantity > 0;
                const inputId = "quantity-" + line.supplierOrderItemId;
                return (
                  <div key={line.supplierOrderItemId} className="border-b border-slate-200 last:border-b-0">
                    <div role="row" className={classNames("grid grid-cols-[minmax(2.5rem,0.7fr)_minmax(0,2.5fr)_minmax(3rem,0.5fr)_minmax(3rem,0.6fr)] items-start gap-2 px-3 py-3 sm:px-5", line.readinessStatus === "COMPLETELY_READY" ? "bg-emerald-50/70" : "bg-white")}>
                      <span role="cell" className="font-mono text-sm leading-5 font-black break-all sm:text-base">{line.code}</span>
                      <div role="cell" className="min-w-0"><p className="text-xs leading-5 font-bold break-words sm:text-sm">{line.description}</p>{line.model ? <p className="mt-0.5 text-[0.65rem] break-words text-slate-500 sm:text-xs">{line.model}</p> : null}
                        <div className="mt-1 space-y-0.5 text-[0.65rem] font-semibold text-slate-600 sm:text-xs">
                          {line.waitingReadyQuantity > 0 ? <p>Faltam preparar: {numberFormatter.format(line.waitingReadyQuantity)}</p> : <p className="text-emerald-800">Completamente pronto</p>}
                          {line.pickedQuantity > 0 ? <p>Retirado: {numberFormatter.format(line.pickedQuantity)}</p> : null}
                          {line.readyWaitingPickupQuantity > 0 ? <p>Pronto para retirar: {numberFormatter.format(line.readyWaitingPickupQuantity)}</p> : null}
                        </div>
                      </div>
                      <span role="cell" className="text-right font-mono text-sm font-extrabold tabular-nums sm:text-base">{numberFormatter.format(line.orderedQuantity)}</span>
                      <span role="cell" className="text-right font-mono text-sm font-black tabular-nums text-emerald-800 sm:text-base">{numberFormatter.format(line.readyQuantity)}</span>
                    </div>
                      {canMarkReady ? (
                        <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 sm:px-5">
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                            <form
                              className="flex flex-wrap items-end gap-2"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                const payload: SafisaAttemptPayload = {
                                  kind: "INCREMENT_READY_QUANTITY",
                                  supplierOrderId: selectedOrder.supplierOrderId,
                                  supplierOrderItemId: line.supplierOrderItemId,
                                  incrementQuantity: Number(form.get("quantity")),
                                };
                                completeAction(payload);
                              }}
                            >
                              <div className="w-20 shrink-0 sm:w-[6.5rem]">
                                <label htmlFor={inputId} className="mb-1 block text-xs font-black text-slate-700">Quantidade</label>
                                <input
                                  id={inputId}
                                  name="quantity"
                                  type="number"
                                  inputMode="numeric"
                                  min="1"
                                  max={line.waitingReadyQuantity}
                                  step="1"
                                  required
                                  disabled={mutationControlsBlocked}
                                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-black tabular-nums outline-none transition focus:border-blue-700 focus:ring-3 focus:ring-blue-100 disabled:bg-slate-100"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={mutationControlsBlocked}
                                className="min-h-11 rounded-xl border border-blue-300 bg-white px-4 text-sm font-black text-blue-950 transition hover:bg-blue-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
                              >
                                {activeLineId === line.supplierOrderItemId && isPending ? "Salvando…" : "Informar quantidade"}
                              </button>
                            </form>
                            <button
                              type="button"
                              disabled={mutationControlsBlocked}
                              onClick={() => requestConfirmation({ kind: "remaining", line })}
                              className="min-h-11 rounded-xl bg-blue-800 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-900 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
                            >
                              Concluir este item ({line.waitingReadyQuantity})
                            </button>
                          </div>
                          <details className="group mt-2">
                            <summary
                              aria-disabled={mutationControlsBlocked}
                              onClick={(event) => {
                                if (mutationControlsBlocked) event.preventDefault();
                              }}
                              className={classNames(
                                "inline-flex min-h-11 items-center rounded-lg px-1 text-xs font-bold transition focus-visible:outline-3 focus-visible:outline-blue-700 sm:text-sm",
                                mutationControlsBlocked
                                  ? "cursor-not-allowed text-slate-400"
                                  : "cursor-pointer text-slate-600 hover:text-slate-950",
                              )}
                            >
                              Corrigir quantidade pronta
                            </summary>
                            <form
                              className="mt-2 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                requestConfirmation({
                                  kind: "correction",
                                  line,
                                  total: Number(form.get("total")),
                                  justification: String(form.get("justification") ?? ""),
                                });
                              }}
                            >
                              <div>
                                <label htmlFor={"total-" + line.supplierOrderItemId} className="mb-1 block text-sm font-bold text-slate-800">Novo total pronto</label>
                                <input
                                  id={"total-" + line.supplierOrderItemId}
                                  name="total"
                                  type="number"
                                  inputMode="numeric"
                                  min={line.pickedQuantity}
                                  max={maximumReadyQuantity(line.readyQuantity, line.waitingReadyQuantity)}
                                  defaultValue={line.readyQuantity}
                                  required
                                  disabled={mutationControlsBlocked}
                                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-amber-700 focus:ring-3 focus:ring-amber-100 disabled:bg-slate-100"
                                />
                              </div>
                              <div>
                                <label htmlFor={"justification-" + line.supplierOrderItemId} className="mb-1 block text-sm font-bold text-slate-800">Justificativa</label>
                                <textarea
                                  id={"justification-" + line.supplierOrderItemId}
                                  name="justification"
                                  minLength={1}
                                  maxLength={500}
                                  required
                                  rows={3}
                                  disabled={mutationControlsBlocked}
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-700 focus:ring-3 focus:ring-amber-100 disabled:bg-slate-100"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={mutationControlsBlocked}
                                className="min-h-11 w-full rounded-xl border border-amber-500 bg-white px-4 text-sm font-black text-amber-950 transition hover:bg-amber-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Revisar correção
                              </button>
                            </form>
                          </details>
                        </div>
                      ) : null}

                  </div>
                );
              })}
            </div>
          </section>
        </SafisaPortalDialog>
      ) : null}

      {confirmation && selectedOrder ? (
        <SafisaPortalDialog compact titleId="safisa-confirm-title" descriptionId="safisa-confirm-description"
          pending={isPending} onClose={() => { if (!isPending) setConfirmation(null); }}
          title={confirmation.kind === "order" ? "Dar todo o Pedido como pronto?" : confirmation.kind === "remaining" ? "Concluir este item?" : "Confirmar correção?"}>
          <div className="p-4 sm:p-5">
            <p id="safisa-confirm-description" className="text-xs font-bold text-slate-500">Revise as quantidades antes de confirmar.</p>
            {confirmation.kind === "order" ? (
              <>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Pedido {selectedOrder!.negotiationNumber}
                </p>
                <p className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
                  Serão adicionadas {confirmation.pendingQuantity} novas unidades prontas em {confirmation.pendingLineCount} {confirmation.pendingLineCount === 1 ? "item" : "itens"}.
                </p>
              </>
            ) : confirmation.kind === "remaining" ? (
              <>
                <p className="mt-3 text-sm leading-6 text-slate-600">Cód. {confirmation.line.code} · {confirmation.line.description}</p>
              <p className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
                Serão adicionadas {confirmation.line.waitingReadyQuantity} novas unidades prontas.
              </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm leading-6 text-slate-600">Cód. {confirmation.line.code} · {confirmation.line.description}</p>
                <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <p><strong>Novo total:</strong> {confirmation.total}</p>
                  <p className="mt-1 break-words"><strong>Justificativa:</strong> {confirmation.justification}</p>
                </div>
              </>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isPending}
                                onClick={() => setConfirmation(null)}
                className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-blue-700 disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={mutationControlsBlocked}
                onClick={() => {
                  if (confirmation.kind === "order") {
                    const payload: SafisaAttemptPayload = {
                      kind: "MARK_ORDER_REMAINING_READY",
                      supplierOrderId: selectedOrder!.supplierOrderId,
                    };
                    completeAction(payload);
                  } else if (confirmation.kind === "remaining") {
                    const payload: SafisaAttemptPayload = {
                      kind: "MARK_LINE_REMAINING_READY",
                      supplierOrderId: selectedOrder!.supplierOrderId,
                      supplierOrderItemId: confirmation.line.supplierOrderItemId,
                      incrementQuantity: confirmation.line.waitingReadyQuantity,
                    };
                    completeAction(payload);
                  } else {
                    const payload: SafisaAttemptPayload = {
                      kind: "CORRECT_READY_QUANTITY",
                      supplierOrderId: selectedOrder!.supplierOrderId,
                      supplierOrderItemId: confirmation.line.supplierOrderItemId,
                      newReadyQuantity: confirmation.total,
                      justification: confirmation.justification.trim(),
                      expectedUpdatedAt: confirmation.line.updatedAt,
                    };
                    completeAction(payload);
                  }
                }}
                className={classNames(
                  "min-h-11 rounded-xl px-4 text-sm font-black text-white transition focus-visible:outline-3 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60",
                  confirmation.kind === "order" || confirmation.kind === "remaining"
                    ? "bg-blue-800 hover:bg-blue-900 focus-visible:outline-blue-700"
                    : "bg-amber-700 hover:bg-amber-800 focus-visible:outline-amber-700",
                )}
              >
                {isPending ? "Confirmando…" : "Confirmar"}
              </button>
            </div>

          </div>
        </SafisaPortalDialog>
      ) : null}
    </div>
  );
}
