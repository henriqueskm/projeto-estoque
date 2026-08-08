"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  correctSafisaReadyQuantity,
  incrementSafisaReadyQuantity,
  markSafisaRemainingReady,
  safisaLogout,
} from "@/app/safisa/actions";
import {
  maximumReadyQuantity,
  readinessLabel,
} from "@/lib/safisa-portal-readiness";
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
  | { kind: "remaining"; line: SafisaOrderLine }
  | { kind: "correction"; line: SafisaOrderLine; total: number; justification: string }
  | null;

const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function closureLabel(order: SafisaOrderSummary | SafisaOrderDetail) {
  if (order.closureKind === "FINALIZED") return "Finalizado";
  if (order.closureKind === "CANCELLED") return "Cancelado";
  return readinessLabel(order.readinessStatus, order.readyQuantity, order.pickedQuantity);
}

function Metric({ label, value, tone = "neutral", compact = false }: { label: string; value: number; tone?: "neutral" | "blue" | "green"; compact?: boolean }) {
  const toneClass = tone === "green" ? "border-emerald-200 bg-emerald-50" : tone === "blue" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50";
  return (
    <div className={`min-w-0 border ${compact ? "rounded-lg px-2 py-1.5" : "rounded-xl px-3 py-2"} ${toneClass}`}>
      <dt className={`${compact ? "text-[0.6rem] tracking-normal" : "text-[0.68rem] tracking-wide"} font-black text-slate-600 uppercase`}>{label}</dt>
      <dd className={`${compact ? "mt-px text-base leading-5" : "mt-0.5 text-xl"} font-black tabular-nums text-slate-950`}>{numberFormatter.format(value)}</dd>
    </div>
  );
}

export function SafisaPortal({ displayName, activeOrders, completedOrders, selectedOrder, loadMessage }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<SafisaActionResult | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>(null);
  const [selectedList, setSelectedList] = useState<"ACTIVE" | "COMPLETED">(
    selectedOrder?.portalState ?? "ACTIVE",
  );
  const operationLock = useRef(false);
  const orders = selectedList === "ACTIVE" ? activeOrders : completedOrders;

  function completeAction(lineId: string, action: () => Promise<SafisaActionResult>) {
    if (isPending || operationLock.current) return;
    operationLock.current = true;
    setActiveLineId(lineId);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
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

  return (
    <div className="min-h-dvh bg-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-black tracking-[0.16em] text-blue-800 uppercase">Portal Safisa</p>
            <p className="truncate text-sm font-semibold text-slate-600">Olá, {displayName}</p>
          </div>
          <form action={safisaLogout}>
            <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700">Sair</button>
          </form>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-5 px-4 py-5 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="orders-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black tracking-[0.14em] text-blue-800 uppercase">Pedidos Safisa</p>
              <h1 id="orders-title" className="mt-1 text-2xl font-black tracking-tight text-slate-950">Pedidos Safisa</h1>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{orders.length}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Situação dos pedidos">
            <button type="button" role="tab" aria-selected={selectedList === "ACTIVE"} onClick={() => setSelectedList("ACTIVE")} className={`min-h-10 rounded-lg px-3 text-sm font-black focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${selectedList === "ACTIVE" ? "bg-white text-blue-900 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}>Em andamento</button>
            <button type="button" role="tab" aria-selected={selectedList === "COMPLETED"} onClick={() => setSelectedList("COMPLETED")} className={`min-h-10 rounded-lg px-3 text-sm font-black focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${selectedList === "COMPLETED" ? "bg-white text-blue-900 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}>Concluídos</button>
          </div>

          {orders.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-600">{selectedList === "ACTIVE" ? "Nenhum pedido em andamento no momento." : "Nenhum pedido concluído no momento."}</div>
          ) : (
            <div className="mt-4 space-y-3">
              {orders.map((order) => {
                const active = selectedOrder?.supplierOrderId === order.supplierOrderId;
                return (
                  <Link
                    key={order.supplierOrderId}
                    href={`/safisa?pedido=${encodeURIComponent(order.supplierOrderId)}`}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-xl border p-4 transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${active ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-base font-black text-slate-950">Pedido {order.negotiationNumber}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(order.orderDate)} · {order.lineCount} {order.lineCount === 1 ? "item" : "itens"}</p>
                      </div>
                      <span className="max-w-28 rounded-full bg-white px-2.5 py-1 text-center text-[0.66rem] font-black leading-4 text-blue-900 ring-1 ring-slate-200">{closureLabel(order)}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="font-semibold text-slate-500">Pronto</dt><dd className="font-black tabular-nums text-slate-900">{order.readyQuantity} de {order.orderedQuantity}</dd></div>
                      <div><dt className="font-semibold text-slate-500">Aguardando retirada</dt><dd className="font-black tabular-nums text-slate-900">{order.readyWaitingPickupQuantity}</dd></div>
                    </dl>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section aria-live="polite" className="min-w-0">
          {feedback ? (
            <div role={feedback.status === "success" ? "status" : "alert"} className={`mb-4 rounded-xl border px-4 py-3 text-sm font-bold ${feedback.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : feedback.status === "conflict" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-800"}`}>{feedback.message}</div>
          ) : null}
          {loadMessage ? <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">{loadMessage}</div> : null}

          {!selectedOrder ? (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <div><div aria-hidden="true" className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-blue-100 text-2xl font-black text-blue-800">✓</div><h2 className="mt-4 text-xl font-black text-slate-950">Selecione um pedido</h2><p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">Veja os itens do pedido e informe as novas unidades que ficaram prontas.</p></div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-xs font-black tracking-[0.14em] text-blue-800 uppercase">Detalhes do pedido</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Pedido {selectedOrder.negotiationNumber}</h2><p className="mt-1 text-sm font-semibold text-slate-500">{formatDate(selectedOrder.orderDate)}</p></div>
                  <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-900 ring-1 ring-blue-200">{closureLabel(selectedOrder)}</span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Pedido" value={selectedOrder.orderedQuantity} />
                  <Metric label="Pronto" value={selectedOrder.readyQuantity} tone="blue" />
                  <Metric label="A preparar" value={selectedOrder.waitingReadyQuantity} />
                  <Metric label="A retirar" value={selectedOrder.readyWaitingPickupQuantity} tone="green" />
                </dl>
                {selectedOrder.isReadOnly ? <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">Pedido encerrado: informações disponíveis somente para consulta.</p> : null}
              </div>

              <div className="space-y-3 p-4 sm:p-5">
                {selectedOrder.lines.map((line) => (
                  <article key={line.supplierOrderItemId} className="rounded-xl border border-slate-200 p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1"><p className="text-[0.68rem] font-black tracking-wide text-blue-800 uppercase">Cód. {line.code}</p><h3 className="mt-0.5 text-base font-black leading-5 text-slate-950">{line.description}</h3>{line.model ? <p className="mt-0.5 text-sm leading-5 font-semibold text-slate-600">{line.model}</p> : null}</div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.62rem] font-black leading-4 text-slate-700">{readinessLabel(line.readinessStatus, line.readyQuantity, line.pickedQuantity)}</span>
                    </div>
                    <dl className="mt-2.5 grid grid-cols-2 gap-1.5 min-[360px]:grid-cols-4">
                      <Metric compact label="Pedido" value={line.orderedQuantity} />
                      <Metric compact label="Já pronto" value={line.readyQuantity} tone="blue" />
                      <Metric compact label="Retirado" value={line.pickedQuantity} tone="green" />
                      <Metric compact label="Restante" value={line.waitingReadyQuantity} />
                    </dl>

                    {!selectedOrder.isReadOnly && line.waitingReadyQuantity > 0 ? (
                      <div className="mt-2.5 border-t border-slate-200 pt-2.5">
                        <form
                          className="flex flex-wrap items-end gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            const quantity = Number(form.get("quantity"));
                            const idempotencyKey = crypto.randomUUID();
                            completeAction(line.supplierOrderItemId, () => incrementSafisaReadyQuantity({ idempotencyKey, supplierOrderId: selectedOrder.supplierOrderId, supplierOrderItemId: line.supplierOrderItemId, incrementQuantity: quantity }));
                          }}
                        >
                          <div className="w-max shrink-0"><label htmlFor={`quantity-${line.supplierOrderItemId}`} className="mb-1 block text-xs font-black whitespace-nowrap text-slate-800">Novas prontas</label><input id={`quantity-${line.supplierOrderItemId}`} name="quantity" type="number" inputMode="numeric" min="1" max={line.waitingReadyQuantity} step="1" required disabled={isPending} className="min-h-10 w-[5.25rem] rounded-lg border border-slate-300 px-2 text-base font-bold outline-none focus:border-blue-700 focus:ring-3 focus:ring-blue-100 disabled:bg-slate-100" /></div>
                          <button type="submit" disabled={isPending} className="min-h-10 min-w-0 flex-1 rounded-lg bg-blue-800 px-3 text-xs font-black whitespace-nowrap text-white transition hover:bg-blue-900 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60 sm:flex-none sm:text-sm">{activeLineId === line.supplierOrderItemId && isPending ? "Salvando..." : "Informar como pronto"}</button>
                        </form>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <button type="button" disabled={isPending} onClick={() => setConfirmation({ kind: "remaining", line })} className="min-h-10 rounded-lg border border-blue-300 bg-white px-3 text-xs font-black text-blue-900 transition hover:bg-blue-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50 sm:text-sm">Marcar restante</button>
                          <details className="group min-w-0">
                            <summary className="cursor-pointer rounded-lg px-1 py-2 text-xs font-bold text-slate-600 hover:text-slate-950 focus-visible:outline-3 focus-visible:outline-blue-700 sm:text-sm">Corrigir quantidade pronta</summary>
                            <form className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setConfirmation({ kind: "correction", line, total: Number(form.get("total")), justification: String(form.get("justification") ?? "") }); }}>
                              <div><label htmlFor={`total-${line.supplierOrderItemId}`} className="mb-1 block text-sm font-bold text-slate-800">Novo total pronto</label><input id={`total-${line.supplierOrderItemId}`} name="total" type="number" inputMode="numeric" min={line.pickedQuantity} max={maximumReadyQuantity(line.readyQuantity, line.waitingReadyQuantity)} defaultValue={line.readyQuantity} required className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-bold outline-none focus:border-amber-700 focus:ring-3 focus:ring-amber-100" /></div>
                              <div><label htmlFor={`justification-${line.supplierOrderItemId}`} className="mb-1 block text-sm font-bold text-slate-800">Justificativa</label><textarea id={`justification-${line.supplierOrderItemId}`} name="justification" minLength={1} maxLength={500} required rows={3} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-700 focus:ring-3 focus:ring-amber-100" /></div>
                              <button type="submit" disabled={isPending} className="min-h-11 w-full rounded-xl border border-amber-500 bg-white px-4 text-sm font-black text-amber-950 hover:bg-amber-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-700">Revisar correção</button>
                            </form>
                          </details>
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {confirmation ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isPending) setConfirmation(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="safisa-confirm-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <p className="text-xs font-black tracking-[0.14em] text-blue-800 uppercase">Confirmação</p>
            <h2 id="safisa-confirm-title" className="mt-1 text-xl font-black text-slate-950">{confirmation.kind === "remaining" ? "Marcar todo o restante?" : "Confirmar correção?"}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">Cód. {confirmation.line.code} · {confirmation.line.description}</p>
            {confirmation.kind === "remaining" ? <p className="mt-3 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">Serão adicionadas {confirmation.line.waitingReadyQuantity} novas unidades prontas.</p> : <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950"><p><strong>Novo total:</strong> {confirmation.total}</p><p className="mt-1 break-words"><strong>Justificativa:</strong> {confirmation.justification}</p></div>}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" disabled={isPending} autoFocus onClick={() => setConfirmation(null)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-800 hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-blue-700 disabled:opacity-50">Voltar</button>
              <button type="button" disabled={isPending} onClick={() => {
                const idempotencyKey = crypto.randomUUID();
                if (confirmation.kind === "remaining") {
                  completeAction(confirmation.line.supplierOrderItemId, () => markSafisaRemainingReady({ idempotencyKey, supplierOrderId: selectedOrder!.supplierOrderId, supplierOrderItemId: confirmation.line.supplierOrderItemId }));
                } else {
                  completeAction(confirmation.line.supplierOrderItemId, () => correctSafisaReadyQuantity({ idempotencyKey, supplierOrderId: selectedOrder!.supplierOrderId, supplierOrderItemId: confirmation.line.supplierOrderItemId, newReadyQuantity: confirmation.total, justification: confirmation.justification, expectedUpdatedAt: confirmation.line.updatedAt }));
                }
              }} className={`min-h-11 rounded-xl px-4 text-sm font-black text-white focus-visible:outline-3 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 ${confirmation.kind === "remaining" ? "bg-blue-800 hover:bg-blue-900 focus-visible:outline-blue-700" : "bg-amber-700 hover:bg-amber-800 focus-visible:outline-amber-700"}`}>{isPending ? "Confirmando..." : "Confirmar"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
