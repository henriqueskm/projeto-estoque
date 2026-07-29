"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  PurchaseRecommendationItem,
  PurchaseRecommendationSummary,
  PurchaseRecommendationsData,
} from "@/lib/purchase-recommendation-types";

type RecommendationTab = "buy-now" | "already-ordered" | "missing-minimum";

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

function getOrderSituationLabel(
  order: PurchaseRecommendationItem["relatedOrders"][number],
) {
  return order.closureKind === "FINALIZED"
    ? "Finalizado"
    : order.closureKind === "CANCELLED"
      ? "Cancelado"
      : orderStatusLabels[order.status];
}

function quantityLabel(quantity: number) {
  return quantity === 1 ? "unidade" : "unidades";
}

function RecommendationIdentity({
  item,
}: {
  item: PurchaseRecommendationItem;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-black text-text-primary">
          Cód. {item.primaryCode}
        </span>
        <span className="text-[0.65rem] font-black tracking-[0.08em] text-text-muted uppercase">
          {item.typeLabel}
        </span>
      </div>
      {item.aliases.length > 0 ? (
        <p className="mt-1 text-xs font-semibold text-text-muted">
          Também:{" "}
          {item.aliases.map((alias) => `Cód. ${alias}`).join(", ")}
        </p>
      ) : null}
      <p className="mt-1.5 break-words text-sm font-bold text-text-primary">
        {item.description}
      </p>
    </>
  );
}

function StockMetrics({
  item,
  includePending = false,
}: {
  item: PurchaseRecommendationItem;
  includePending?: boolean;
}) {
  const metrics: Array<readonly [string, number | null]> = [
    ["Estoque atual", item.currentStock],
    ["Estoque mínimo", item.minimumStock],
  ];

  if (includePending) {
    metrics.push(
      ["Compra pendente", item.pendingPurchaseQuantity],
      ["Saldo projetado", item.projectedStock],
    );
  } else {
    metrics.push(["Falta para o mínimo", item.shortfall]);
  }

  return (
    <dl className="mt-3 grid grid-cols-2 gap-1.5">
      {metrics.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border border-border-neutral bg-app-background px-2.5 py-2"
        >
          <dt className="text-[0.62rem] font-black text-text-muted uppercase">
            {label}
          </dt>
          <dd className="mt-0.5 font-mono text-base font-black text-text-primary">
            {value === null ? "—" : quantityFormatter.format(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function InventoryLink({ item }: { item: PurchaseRecommendationItem }) {
  return (
    <Link
      href={item.inventoryHref}
      className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
    >
      Abrir no Estoque
    </Link>
  );
}

function BuyNowCard({ item }: { item: PurchaseRecommendationItem }) {
  const recommendation = item.recommendedQuantity ?? 0;

  return (
    <article className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
      <RecommendationIdentity item={item} />
      <StockMetrics item={item} />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
        <div>
          <span className="block text-[0.62rem] font-black tracking-[0.1em] text-amber-950 uppercase">
            Comprar
          </span>
          <strong className="font-mono text-2xl font-black text-text-primary">
            {quantityFormatter.format(recommendation)}
          </strong>{" "}
          <span className="text-xs font-bold text-text-muted">
            {quantityLabel(recommendation)}
          </span>
        </div>
        <InventoryLink item={item} />
      </div>
    </article>
  );
}

function AlreadyOrderedCard({
  item,
}: {
  item: PurchaseRecommendationItem;
}) {
  return (
    <article className="rounded-xl border border-emerald-200 bg-white p-3 shadow-sm">
      <RecommendationIdentity item={item} />
      <StockMetrics item={item} includePending />
      <p
        className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${
          item.coverage === "SUFFICIENT"
            ? "bg-emerald-50 text-emerald-900"
            : "bg-amber-50 text-amber-950"
        }`}
      >
        {item.coverage === "SUFFICIENT"
          ? "A compra pendente cobre o estoque mínimo."
          : "A compra existente ainda não cobre o mínimo. Nenhuma compra adicional é sugerida enquanto houver pendência."}
      </p>
      <div className="mt-3 grid gap-2">
        {item.relatedOrders.map((order, index) => (
          <article
            key={`${order.orderId}-${order.codeSnapshot}-${index}`}
            className="rounded-lg border border-border-neutral bg-app-background px-3 py-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-black text-text-primary">
                  Pedido {order.negotiationNumber}
                </p>
                <p className="mt-0.5 text-[0.68rem] font-semibold text-text-muted">
                  {getOrderSituationLabel(order)} ·{" "}
                  {orderDateFormatter.format(
                    new Date(`${order.orderDate}T00:00:00Z`),
                  )}
                </p>
                <p className="mt-1 text-xs font-bold text-text-primary">
                  Comprado no Pedido como Cód. {order.codeSnapshot} ·{" "}
                  {quantityFormatter.format(order.pendingQuantity)}{" "}
                  {quantityLabel(order.pendingQuantity)}
                </p>
              </div>
              <Link
                href={order.href}
                className="nk-focus inline-flex min-h-10 items-center rounded-lg border border-border-neutral bg-white px-3 text-xs font-black text-text-primary transition hover:bg-slate-50"
              >
                Abrir Pedido
              </Link>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-3">
        <InventoryLink item={item} />
      </div>
    </article>
  );
}

function MissingMinimumCard({
  item,
}: {
  item: PurchaseRecommendationItem;
}) {
  return (
    <article className="rounded-xl border border-border-neutral bg-white p-3 shadow-sm">
      <RecommendationIdentity item={item} />
      <div className="mt-3 rounded-lg border border-border-neutral bg-app-background px-3 py-2.5">
        <p className="text-xs font-semibold text-text-muted">
          Estoque atual
        </p>
        <p className="font-mono text-lg font-black text-text-primary">
          {quantityFormatter.format(item.currentStock)}
        </p>
        <p className="mt-1 text-xs font-bold text-text-primary">
          Estoque mínimo não definido
        </p>
      </div>
      <div className="mt-3">
        <InventoryLink item={item} />
      </div>
    </article>
  );
}

async function copyTextWithFallback(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard unavailable.");
  }
}

export function PurchaseRecommendationPanel({
  data,
  error,
}: {
  data:
    | Pick<
        PurchaseRecommendationsData,
        "buyNow" | "alreadyOrdered" | "missingMinimum"
      > & { summary: PurchaseRecommendationSummary }
    | null;
  error: string | null;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [activeTab, setActiveTab] =
    useState<RecommendationTab>("buy-now");
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        router.replace("/estoque");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [router]);

  const tabs = [
    {
      id: "buy-now" as const,
      label: "Comprar agora",
      count: data?.summary.buyNowCount ?? 0,
    },
    {
      id: "already-ordered" as const,
      label: "Já comprados",
      count: data?.summary.alreadyOrderedCount ?? 0,
    },
    {
      id: "missing-minimum" as const,
      label: "Sem mínimo",
      count: data?.summary.missingMinimumCount ?? 0,
    },
  ];
  const selectedItems =
    activeTab === "buy-now"
      ? (data?.buyNow ?? [])
      : activeTab === "already-ordered"
        ? (data?.alreadyOrdered ?? [])
        : (data?.missingMinimum ?? []);

  async function handleCopy() {
    if (!data || data.buyNow.length === 0) {
      return;
    }

    const text = [
      "LISTA RECOMENDADA DE COMPRA",
      "",
      ...data.buyNow.map((item) => {
        const quantity = item.recommendedQuantity ?? 0;
        return `Cód. ${item.primaryCode} — ${quantity} ${quantityLabel(quantity)}`;
      }),
    ].join("\n");

    try {
      await copyTextWithFallback(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-5">
      <button
        type="button"
        aria-label="Fechar lista recomendada"
        className="absolute inset-0 bg-brand-charcoal/55"
        onClick={() => router.replace("/estoque")}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-recommendation-title"
        className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border-neutral bg-app-background shadow-2xl sm:max-w-4xl sm:rounded-2xl"
      >
        <header className="shrink-0 border-b border-border-neutral bg-white px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.65rem] font-black tracking-[0.14em] text-brand-gold-ink uppercase">
                Reposição
              </p>
              <h2
                id="purchase-recommendation-title"
                ref={titleRef}
                tabIndex={-1}
                className="nk-focus text-xl font-black text-text-primary outline-none sm:text-2xl"
              >
                Lista recomendada de compra
              </h2>
              <p className="mt-1 max-w-2xl text-xs font-semibold text-text-muted sm:text-sm">
                Itens abaixo do estoque mínimo que ainda não possuem compra
                pendente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.replace("/estoque")}
              className="nk-focus inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border-neutral bg-white text-xl font-black text-text-primary hover:bg-slate-50"
              aria-label="Fechar lista recomendada"
            >
              ×
            </button>
          </div>
          {data ? (
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="rounded-lg border border-border-neutral bg-app-background px-2 py-2 text-center"
                >
                  <strong className="block font-mono text-base text-text-primary">
                    {quantityFormatter.format(tab.count)}
                  </strong>
                  <span className="block text-[0.58rem] font-black text-text-muted uppercase sm:text-[0.65rem]">
                    {tab.label}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
          {error || !data ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-semibold text-red-900"
            >
              {error ?? "Não foi possível carregar a lista recomendada."}
            </div>
          ) : (
            <>
              <div
                role="tablist"
                aria-label="Grupos da lista recomendada"
                className="grid grid-cols-3 gap-1 rounded-xl border border-border-neutral bg-white p-1"
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`nk-focus min-h-11 rounded-lg px-1.5 py-2 text-[0.66rem] font-black sm:text-xs ${
                      activeTab === tab.id
                        ? "bg-brand-charcoal text-white"
                        : "text-text-muted hover:bg-app-background"
                    }`}
                  >
                    {tab.label} ({quantityFormatter.format(tab.count)})
                  </button>
                ))}
              </div>

              {activeTab === "buy-now" ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text-muted">
                    Prioridade por maior falta para o mínimo.
                  </p>
                  <button
                    type="button"
                    disabled={data.buyNow.length === 0}
                    onClick={handleCopy}
                    className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-brand-gold-dark bg-white px-3 text-sm font-black text-brand-gold-ink transition hover:bg-brand-gold-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copiar lista
                  </button>
                  <p
                    aria-live="polite"
                    className="w-full text-right text-xs font-bold text-text-muted"
                  >
                    {copyStatus === "copied"
                      ? "Lista copiada."
                      : copyStatus === "error"
                        ? "Não foi possível copiar a lista."
                        : ""}
                  </p>
                </div>
              ) : null}

              {selectedItems.length > 0 ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {selectedItems.map((item) =>
                    activeTab === "buy-now" ? (
                      <BuyNowCard
                        key={`${item.targetKind}-${item.targetId}`}
                        item={item}
                      />
                    ) : activeTab === "already-ordered" ? (
                      <AlreadyOrderedCard
                        key={`${item.targetKind}-${item.targetId}`}
                        item={item}
                      />
                    ) : (
                      <MissingMinimumCard
                        key={`${item.targetKind}-${item.targetId}`}
                        item={item}
                      />
                    ),
                  )}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-border-neutral bg-white px-4 py-6 text-center">
                  <h3 className="font-black text-text-primary">
                    {activeTab === "buy-now"
                      ? "Nenhuma compra recomendada agora"
                      : activeTab === "already-ordered"
                        ? "Nenhuma compra pendente para itens abaixo do mínimo"
                        : "Todos os itens ativos possuem mínimo definido"}
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-text-muted sm:text-sm">
                    {activeTab === "buy-now"
                      ? "Todos os itens com estoque mínimo definido estão atendidos ou já possuem compra pendente em Pedidos."
                      : "Não há itens neste grupo no momento."}
                  </p>
                </div>
              )}

              <p className="mt-4 rounded-xl border border-border-neutral bg-white px-3 py-3 text-xs font-semibold text-text-muted">
                Esta recomendação considera o estoque físico atual e não
                simula montagens.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
