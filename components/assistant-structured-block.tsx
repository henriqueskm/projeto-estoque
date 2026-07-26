"use client";

import Link from "next/link";
import { CompatibleKitImages } from "@/components/compatible-kit-images";
import { CommercialConfigurationImage } from "@/components/commercial-configuration-image";
import type {
  AssistantCatalogMediaBlock,
  AssistantCatalogMediaTarget,
  AssistantInventoryAlertCard,
  AssistantInventoryAlertsBlock,
  AssistantMediaDescriptor,
  AssistantSupplierOrderAggregateBlock,
  AssistantSupplierOrderAmbiguityBlock,
  AssistantSupplierOrderCard,
  AssistantSupplierOrderDetailBlock,
  AssistantSupplierOrderItemCard,
  AssistantSupplierOrderListBlock,
  AssistantStructuredBlock,
} from "@/lib/assistant-types";

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

function MediaControl({
  descriptor,
}: {
  descriptor: AssistantMediaDescriptor | null;
}) {
  if (!descriptor) {
    return null;
  }

  if (descriptor.kind === "commercial_configuration_image") {
    return (
      <CommercialConfigurationImage
        commercialCodes={descriptor.commercialCodes}
        imageUrl={descriptor.imageUrl}
        triggerVariant="icon-button"
      />
    );
  }

  return (
    <CompatibleKitImages
      kitCode={descriptor.kitCode}
      options={descriptor.options}
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
}: {
  order: AssistantSupplierOrderCard;
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
          {quantityFormatter.format(order.waitingStockQuantity)} para entrada
          no estoque
        </span>
      ) : null}
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
            <SupplierOrderCard key={order.id} order={order} />
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
        <SupplierOrderCard order={block.order} />
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
    ["Pedidos", block.orderCount],
    ["Unidades pedidas", block.orderedQuantity],
    ["Retiradas", block.pickedQuantity],
    ["Para retirar", block.waitingPickupQuantity],
    ["Lançadas", block.stockedQuantity],
    ["Para entrada", block.waitingStockQuantity],
  ];

  return (
    <div className="min-w-0">
      <h3 className="text-base font-black text-text-primary">
        {block.title}
      </h3>
      <p className="mt-1 text-xs font-semibold text-text-muted">
        {block.filtersSummary}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <span
            key={String(label)}
            className="rounded-xl border border-border-neutral bg-app-background px-2 py-3 text-center"
          >
            <span className="block text-[0.6rem] font-black text-text-muted uppercase">
              {label}
            </span>
            <strong className="mt-0.5 block font-mono text-lg text-text-primary">
              {quantityFormatter.format(Number(value))}
            </strong>
          </span>
        ))}
      </div>
      <Link
        href={block.ordersHref}
        className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl border border-border-neutral px-3 text-sm font-black text-text-primary transition hover:bg-app-background"
      >
        Abrir Pedidos
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

export function AssistantStructuredBlockView({
  block,
}: {
  block: AssistantStructuredBlock;
}) {
  switch (block.kind) {
    case "inventory_alerts":
      return <InventoryAlertsBlock block={block} />;
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
  }
}
