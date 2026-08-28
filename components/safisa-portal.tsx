"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  correctSafisaReadyQuantity,
  incrementSafisaReadyQuantity,
  markSafisaOrderRemainingReady,
  markSafisaRemainingReady,
  safisaLogout,
} from "@/app/safisa/actions";
import { maximumReadyQuantity, readinessLabel } from "@/lib/safisa-portal-readiness";
import type {
  SafisaActionResult,
  SafisaOrderDetail,
  SafisaOrderLine,
  SafisaOrderSummary,
} from "@/lib/safisa-portal-types";

type Props = {
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
  return readinessLabel(order.readinessStatus, order.readyQuantity, order.pickedQuantity);
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

function Metric({
  label,
  value,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "blue" | "green" | "amber";
  compact?: boolean;
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "blue"
        ? "border-blue-200 bg-blue-50"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-slate-50";

  return (
    <div className={classNames("min-w-0 border", compact ? "rounded-xl px-2.5 py-2" : "rounded-2xl px-3 py-3", toneClass)}>
      <dt className={classNames(compact ? "text-[0.62rem]" : "text-[0.67rem] tracking-[0.08em]", "font-black text-slate-600 uppercase")}>
        {label}
      </dt>
      <dd className={classNames(compact ? "mt-0.5 text-lg leading-5" : "mt-1 text-2xl leading-7", "font-black tabular-nums text-slate-950")}>
        {numberFormatter.format(value)}
      </dd>
    </div>
  );
}

export function SafisaPortal({
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
  const [selectedList, setSelectedList] = useState<"ACTIVE" | "COMPLETED">(
    selectedOrder?.portalState ?? "ACTIVE",
  );
  const operationLock = useRef(false);
  const orders = selectedList === "ACTIVE" ? activeOrders : completedOrders;
  const remainingLineCount =
    selectedOrder?.lines.filter((line) => line.waitingReadyQuantity > 0).length ?? 0;

  function completeAction(lineId: string, action: () => Promise<SafisaActionResult>) {
    if (isPending || operationLock.current) return;
    operationLock.current = true;
    setActiveLineId(lineId);
    setFeedback(null);

    startTransition(async () => {
      try {
        setFeedback(await action());
        router.refresh();
      } catch {
        setFeedback({
          status: "error",
          message: "Não foi possível concluir a operação. Verifique sua conexão e tente novamente.",
        });
      } finally {
        setActiveLineId(null);
        setConfirmation(null);
        operationLock.current = false;
      }
    });
  }

  function warmOrder(orderId: string) {
    router.prefetch(orderHref(orderId));
  }

  function openOrder(order: SafisaOrderSummary) {
    setSelectedList(order.portalState);
    setOpeningOrderId(order.supplierOrderId);
    window.setTimeout(() => {
      setOpeningOrderId((currentOrderId) =>
        currentOrderId === order.supplierOrderId ? null : currentOrderId,
      );
    }, 5_000);
  }

  return (
    <div className="min-h-dvh bg-[#f4f7fb] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 shadow-sm backdrop-blur">
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

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:px-8">
        <section
          aria-labelledby="orders-title"
          className={classNames(
            selectedOrder && "hidden lg:block",
            "min-w-0 rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-4 lg:sticky lg:top-[5.5rem]",
          )}
        >
          <div className="flex items-end justify-between gap-3 px-1 pt-1">
            <div>
              <p className="text-[0.66rem] font-black tracking-[0.14em] text-blue-800 uppercase">Fila de produção</p>
              <h1 id="orders-title" className="mt-1 text-2xl font-black tracking-tight text-slate-950">Pedidos</h1>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black tabular-nums text-slate-700">{orders.length}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Situação dos pedidos">
            <button
              type="button"
              role="tab"
              aria-selected={selectedList === "ACTIVE"}
              onClick={() => setSelectedList("ACTIVE")}
              className={classNames(
                "min-h-11 rounded-xl px-3 text-sm font-black transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700",
                selectedList === "ACTIVE" ? "bg-white text-blue-950 shadow-sm" : "text-slate-600 hover:text-slate-950",
              )}
            >
              Em andamento
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedList === "COMPLETED"}
              onClick={() => setSelectedList("COMPLETED")}
              className={classNames(
                "min-h-11 rounded-xl px-3 text-sm font-black transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700",
                selectedList === "COMPLETED" ? "bg-white text-blue-950 shadow-sm" : "text-slate-600 hover:text-slate-950",
              )}
            >
              Histórico
            </button>
          </div>

          {orders.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm font-semibold leading-6 text-slate-600">
              {selectedList === "ACTIVE" ? "Nenhum pedido em andamento no momento." : "Nenhum pedido concluído no momento."}
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {orders.map((order) => {
                const active = selectedOrder?.supplierOrderId === order.supplierOrderId;
                const opening =
                  !selectedOrder &&
                  !loadMessage &&
                  openingOrderId === order.supplierOrderId;
                const progress = order.orderedQuantity > 0
                  ? Math.min(100, (order.readyQuantity / order.orderedQuantity) * 100)
                  : 0;

                return (
                  <Link
                    key={order.supplierOrderId}
                    href={orderHref(order.supplierOrderId)}
                    aria-current={active ? "page" : undefined}
                    aria-busy={opening || undefined}
                    onPointerEnter={() => warmOrder(order.supplierOrderId)}
                    onFocus={() => warmOrder(order.supplierOrderId)}
                    onTouchStart={() => warmOrder(order.supplierOrderId)}
                    onClick={() => openOrder(order)}
                    className={classNames(
                      "block rounded-2xl border p-3.5 transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700",
                      active ? "border-blue-600 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-black tracking-tight text-slate-950">Pedido {order.negotiationNumber}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {formatDate(order.orderDate)} · {order.lineCount} {order.lineCount === 1 ? "item" : "itens"}
                        </p>
                      </div>
                      <span className={classNames("shrink-0 rounded-full border px-2.5 py-1 text-center text-[0.62rem] font-black leading-4", statusClass(order))}>
                        {opening ? "Abrindo…" : closureLabel(order)}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-700 transition-[width] duration-300" style={{ width: progress + "%" }} />
                    </div>
                    <dl className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="font-semibold text-slate-500">Em preparação</dt>
                        <dd className="mt-0.5 font-black tabular-nums text-slate-950">{order.waitingReadyQuantity}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-500">Pronto p/ retirada</dt>
                        <dd className="mt-0.5 font-black tabular-nums text-emerald-800">{order.readyWaitingPickupQuantity}</dd>
                      </div>
                    </dl>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section aria-live="polite" className="min-w-0">
          {feedback ? (
            <div
              role={feedback.status === "success" ? "status" : "alert"}
              className={classNames(
                "mb-4 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm",
                feedback.status === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : feedback.status === "conflict"
                    ? "border-amber-200 bg-amber-50 text-amber-950"
                    : "border-red-200 bg-red-50 text-red-800",
              )}
            >
              {feedback.message}
            </div>
          ) : null}
          {loadMessage ? (
            <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950 shadow-sm">
              {loadMessage}
            </div>
          ) : null}

          {!selectedOrder ? (
            <div className="hidden min-h-80 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm lg:flex">
              <div>
                <div aria-hidden="true" className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-100 text-2xl font-black text-blue-800">✓</div>
                <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950">Selecione um pedido</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">Abra um pedido para informar a produção concluída item a item.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
              <div className="border-b border-slate-200 bg-gradient-to-br from-white via-white to-blue-50/70 p-4 sm:p-6">
                <Link
                  href="/safisa"
                  onClick={() => setOpeningOrderId(null)}
                  className="inline-flex min-h-10 items-center rounded-xl px-2 text-sm font-black text-blue-900 transition hover:bg-blue-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 lg:hidden"
                >
                  ← Todos os pedidos
                </Link>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.66rem] font-black tracking-[0.14em] text-blue-800 uppercase">Ordem de produção</p>
                    <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Pedido {selectedOrder.negotiationNumber}</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {formatDate(selectedOrder.orderDate)} · {selectedOrder.lines.length} {selectedOrder.lines.length === 1 ? "item" : "itens"}
                    </p>
                  </div>
                  <span className={classNames("rounded-full border px-3 py-1.5 text-xs font-black", statusClass(selectedOrder))}>
                    {closureLabel(selectedOrder)}
                  </span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Pedido" value={selectedOrder.orderedQuantity} />
                  <Metric label="Já pronto" value={selectedOrder.readyQuantity} tone="blue" />
                  <Metric label="A preparar" value={selectedOrder.waitingReadyQuantity} tone="amber" />
                  <Metric label="Para retirada" value={selectedOrder.readyWaitingPickupQuantity} tone="green" />
                </dl>
                {!selectedOrder.isReadOnly && selectedOrder.waitingReadyQuantity > 0 ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-blue-950">Concluir todo o Pedido</p>
                      <p className="mt-0.5 text-sm font-semibold text-blue-900">
                        {selectedOrder.waitingReadyQuantity} unidade(s) em {remainingLineCount} {remainingLineCount === 1 ? "item" : "itens"} ainda aguardam preparação.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        setConfirmation({
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
                ) : null}
                {selectedOrder.isReadOnly ? (
                  <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                    Pedido encerrado: informações disponíveis somente para consulta.
                  </p>
                ) : null}
              </div>

              <div className="space-y-3 bg-slate-50/70 p-3 sm:p-5">
                <div className="px-1 pb-1">
                  <h3 className="text-lg font-black tracking-tight text-slate-950">Itens para preparar</h3>
                  <p className="mt-0.5 text-sm font-semibold text-slate-600">Informe a quantidade concluída ou marque todo o restante do item.</p>
                </div>
                {selectedOrder.lines.map((line, index) => {
                  const canMarkReady = !selectedOrder.isReadOnly && line.waitingReadyQuantity > 0;
                  const itemLabel = readinessLabel(line.readinessStatus, line.readyQuantity, line.pickedQuantity);
                  const inputId = "quantity-" + line.supplierOrderItemId;

                  return (
                    <article key={line.supplierOrderItemId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex items-start gap-3 p-3.5 sm:p-4">
                        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-black tabular-nums text-slate-600">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[0.68rem] font-black tracking-[0.08em] text-blue-800 uppercase">Cód. {line.code}</p>
                              <h4 className="mt-1 text-base font-black leading-5 text-slate-950 sm:text-lg">{line.description}</h4>
                              {line.model ? <p className="mt-1 text-sm leading-5 font-semibold text-slate-600">{line.model}</p> : null}
                            </div>
                            <span className={classNames("shrink-0 rounded-full border px-2.5 py-1 text-[0.62rem] font-black leading-4", statusClass(line))}>{itemLabel}</span>
                          </div>
                          <dl className="mt-4 grid grid-cols-2 gap-2 min-[480px]:grid-cols-4">
                            <Metric compact label="Pedido" value={line.orderedQuantity} />
                            <Metric compact label="Pronto" value={line.readyQuantity} tone="blue" />
                            <Metric compact label="Retirado" value={line.pickedQuantity} tone="green" />
                            <Metric compact label="Faltam" value={line.waitingReadyQuantity} tone="amber" />
                          </dl>
                        </div>
                      </div>

                      {canMarkReady ? (
                        <div className="border-t border-slate-200 bg-slate-50 px-3.5 py-3 sm:px-4">
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                            <form
                              className="flex flex-wrap items-end gap-2"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                const idempotencyKey = crypto.randomUUID();
                                completeAction(line.supplierOrderItemId, () =>
                                  incrementSafisaReadyQuantity({
                                    idempotencyKey,
                                    supplierOrderId: selectedOrder.supplierOrderId,
                                    supplierOrderItemId: line.supplierOrderItemId,
                                    incrementQuantity: Number(form.get("quantity")),
                                  }),
                                );
                              }}
                            >
                              <div className="w-[6.5rem] shrink-0">
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
                                  disabled={isPending}
                                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-black tabular-nums outline-none transition focus:border-blue-700 focus:ring-3 focus:ring-blue-100 disabled:bg-slate-100"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={isPending}
                                className="min-h-11 rounded-xl border border-blue-300 bg-white px-4 text-sm font-black text-blue-950 transition hover:bg-blue-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
                              >
                                {activeLineId === line.supplierOrderItemId && isPending ? "Salvando…" : "Informar quantidade"}
                              </button>
                            </form>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setConfirmation({ kind: "remaining", line })}
                              className="min-h-11 rounded-xl bg-blue-800 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-900 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
                            >
                              Concluir este item ({line.waitingReadyQuantity})
                            </button>
                          </div>
                          <details className="group mt-2">
                            <summary className="inline-flex min-h-10 cursor-pointer items-center rounded-lg px-1 text-xs font-bold text-slate-600 transition hover:text-slate-950 focus-visible:outline-3 focus-visible:outline-blue-700 sm:text-sm">
                              Corrigir quantidade pronta
                            </summary>
                            <form
                              className="mt-2 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                setConfirmation({
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
                                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-amber-700 focus:ring-3 focus:ring-amber-100"
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
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-700 focus:ring-3 focus:ring-amber-100"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={isPending}
                                className="min-h-11 w-full rounded-xl border border-amber-500 bg-white px-4 text-sm font-black text-amber-950 transition hover:bg-amber-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                              >
                                Revisar correção
                              </button>
                            </form>
                          </details>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </main>

      {confirmation ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) setConfirmation(null);
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="safisa-confirm-title" className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <p className="text-[0.66rem] font-black tracking-[0.14em] text-blue-800 uppercase">Confirmação necessária</p>
            <h2 id="safisa-confirm-title" className="mt-1 text-2xl font-black tracking-tight text-slate-950">
              {confirmation.kind === "order"
                ? "Dar todo o Pedido como pronto?"
                : confirmation.kind === "remaining"
                  ? "Concluir este item?"
                  : "Confirmar correção?"}
            </h2>
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
                autoFocus
                onClick={() => setConfirmation(null)}
                className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-blue-700 disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  const idempotencyKey = crypto.randomUUID();
                  if (confirmation.kind === "order") {
                    completeAction(selectedOrder!.supplierOrderId, () =>
                      markSafisaOrderRemainingReady({
                        idempotencyKey,
                        supplierOrderId: selectedOrder!.supplierOrderId,
                      }),
                    );
                  } else if (confirmation.kind === "remaining") {
                    completeAction(confirmation.line.supplierOrderItemId, () =>
                      markSafisaRemainingReady({
                        idempotencyKey,
                        supplierOrderId: selectedOrder!.supplierOrderId,
                        supplierOrderItemId: confirmation.line.supplierOrderItemId,
                      }),
                    );
                  } else {
                    completeAction(confirmation.line.supplierOrderItemId, () =>
                      correctSafisaReadyQuantity({
                        idempotencyKey,
                        supplierOrderId: selectedOrder!.supplierOrderId,
                        supplierOrderItemId: confirmation.line.supplierOrderItemId,
                        newReadyQuantity: confirmation.total,
                        justification: confirmation.justification,
                        expectedUpdatedAt: confirmation.line.updatedAt,
                      }),
                    );
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
          </section>
        </div>
      ) : null}
    </div>
  );
}
