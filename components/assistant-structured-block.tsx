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
  AssistantStructuredBlock,
} from "@/lib/assistant-types";

const quantityFormatter = new Intl.NumberFormat("pt-BR");

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

export function AssistantStructuredBlockView({
  block,
}: {
  block: AssistantStructuredBlock;
}) {
  return block.kind === "inventory_alerts" ? (
    <InventoryAlertsBlock block={block} />
  ) : (
    <CatalogMediaBlock block={block} />
  );
}
