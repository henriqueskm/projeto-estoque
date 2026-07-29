"use client";

import Link from "next/link";
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
  AssistantSupplierOrderAggregateBlock,
  AssistantSupplierOrderAmbiguityBlock,
  AssistantSupplierOrderCard,
  AssistantSupplierOrderCatalogLine,
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
  onPromptSelect?: (prompt: string) => void;
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
                    onClick={() => onPromptSelect?.(option.prompt)}
                    aria-label={`Enviar sugestão: ${option.prompt}`}
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
                        {option.prompt}
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
}: {
  block: AssistantStructuredBlock;
  disabled?: boolean;
  onPromptSelect?: (prompt: string) => void;
}) {
  switch (block.kind) {
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
