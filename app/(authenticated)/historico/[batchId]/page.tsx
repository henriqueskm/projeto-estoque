import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  StockIcon,
} from "@/components/icons";
import { loadHistoryBatch } from "@/lib/history-data";
import {
  isUuid,
  movementSourceLabels,
  movementTypeLabels,
  type HistoryConfiguration,
  type MovementType,
} from "@/lib/history-types";

type HistoryDetailPageProps = {
  params: Promise<{ batchId: string }>;
};

const quantityFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const movementTypeStyles: Record<MovementType, string> = {
  INBOUND: "bg-emerald-100 text-emerald-900",
  OUTBOUND: "bg-red-100 text-red-900",
  ASSEMBLY: "bg-sky-100 text-sky-900",
  DISASSEMBLY: "bg-indigo-100 text-indigo-900",
  ADJUSTMENT: "bg-amber-100 text-amber-950",
  REVERSAL: "bg-brand-gold-soft text-brand-charcoal",
};

function formatDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : dateFormatter.format(date);
}

function formatQuantity(value: number) {
  return quantityFormatter.format(value);
}

function formatQuantityChange(value: number) {
  if (value > 0) {
    return `+${formatQuantity(value)}`;
  }

  return formatQuantity(value);
}

function CommercialCodes({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <span className="text-sm font-semibold text-text-muted">
        Código não disponível
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Códigos comerciais">
      {codes.map((code) => (
        <span
          key={code}
          className="rounded-lg bg-violet-100 px-2.5 py-1 font-mono text-sm font-black text-violet-900"
        >
          {code}
        </span>
      ))}
    </div>
  );
}

function ConfigurationIdentity({
  configuration,
  showCodes = true,
}: {
  configuration: HistoryConfiguration;
  showCodes?: boolean;
}) {
  return (
    <div className="min-w-0">
      {showCodes ? <CommercialCodes codes={configuration.codes} /> : null}
      <p className={`${showCodes ? "mt-2" : ""} break-words font-bold text-text-primary`}>
        {configuration.description}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl bg-emerald-50 px-3 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
            Servo
          </p>
          <p className="mt-1 font-mono font-black text-text-primary">
            {configuration.servo.code}
          </p>
          <p className="mt-1 break-words text-xs leading-5 text-text-muted">
            {configuration.servo.description}
          </p>
        </div>
        <div className="min-w-0 rounded-xl bg-sky-50 px-3 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-sky-800">
            Kit
          </p>
          <p className="mt-1 font-mono font-black text-text-primary">
            {configuration.installationKit.code}
          </p>
          <p className="mt-1 break-words text-xs leading-5 text-text-muted">
            {configuration.installationKit.description}
          </p>
        </div>
      </div>
    </div>
  );
}

function QuantityFlow({
  before,
  change,
  after,
}: {
  before: number;
  change: number;
  after: number;
}) {
  const changeClassName =
    change > 0
      ? "bg-emerald-50 text-emerald-900"
      : "bg-red-50 text-red-900";

  return (
    <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border-neutral/70 pt-4">
      <div className="rounded-xl bg-app-background px-2 py-3 text-center">
        <dt className="text-sm font-bold text-text-muted">
          Tinha
        </dt>
        <dd className="mt-1 font-mono text-lg font-black tabular-nums text-text-primary">
          {formatQuantity(before)}
        </dd>
      </div>
      <div className={`rounded-xl px-2 py-3 text-center ${changeClassName}`}>
        <dt className="text-sm font-bold">
          Mudou
        </dt>
        <dd className="mt-1 font-mono text-lg font-black tabular-nums">
          {formatQuantityChange(change)}
        </dd>
      </div>
      <div className="rounded-xl bg-app-background px-2 py-3 text-center">
        <dt className="text-sm font-bold text-text-muted">
          Ficou
        </dt>
        <dd className="mt-1 font-mono text-lg font-black tabular-nums text-text-primary">
          {formatQuantity(after)}
        </dd>
      </div>
    </dl>
  );
}

export default async function HistoryDetailPage({
  params,
}: HistoryDetailPageProps) {
  // Operational data waits for a real navigation, never a runtime prefetch.
  await connection();
  const { batchId } = await params;

  if (!isUuid(batchId)) {
    notFound();
  }

  const detailResult = await loadHistoryBatch(batchId);

  if (detailResult.status === "not-found") {
    notFound();
  }

  if (detailResult.status === "error") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/historico"
          className="nk-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-text-primary transition hover:bg-surface"
        >
          <ArrowLeftIcon className="size-5" />
          Voltar ao histórico
        </Link>
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-6 text-sm leading-6 font-semibold text-red-900"
        >
          {detailResult.error} Tente atualizar a página em alguns instantes.
        </div>
      </main>
    );
  }

  const batch = detailResult.data;
  const hasRequestLines =
    batch.inboundLines.length > 0 || batch.outboundLines.length > 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
      <Link
        href="/historico"
        className="nk-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-text-primary transition hover:bg-surface"
      >
        <ArrowLeftIcon className="size-5" />
        Voltar ao histórico
      </Link>

      <header className="mt-3">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-sm font-black ${movementTypeStyles[batch.movementType]}`}
        >
          {movementTypeLabels[batch.movementType]}
        </span>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
          <time dateTime={batch.occurredAt}>{formatDate(batch.occurredAt)}</time>
        </h1>
        <p className="mt-1 text-base text-text-muted">
          {batch.userName?.trim() || "Nome não cadastrado"}
          {batch.source !== "MANUAL" ? ` · ${movementSourceLabels[batch.source]}` : ""}
        </p>
        {batch.description?.trim() ? (
          <p className="mt-3 break-words rounded-xl bg-surface px-4 py-3 text-base leading-7 text-text-primary">
            {batch.description.trim()}
          </p>
        ) : null}
        {batch.reversedBatchId ? (
          <p className="mt-3 text-base">
            <Link
              href={`/historico/${batch.reversedBatchId}`}
              className="nk-focus font-bold text-brand-gold-ink underline decoration-2 underline-offset-2"
            >
              Ver a movimentação que foi desfeita
            </Link>
          </p>
        ) : null}
      </header>

      <section className="mt-8" aria-labelledby="physical-impact-title">
        <h2
          id="physical-impact-title"
          className="text-xl font-black text-text-primary"
        >
          O que mudou no estoque
        </h2>

        {batch.stockMovements.length === 0 ? (
          batch.configurationMovements.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-6 text-base leading-7 text-text-muted">
              Nenhuma quantidade foi alterada.
            </div>
          ) : null
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {batch.stockMovements.map((movement) => (
              <article
                key={movement.id}
                className="min-w-0 rounded-2xl border border-border-neutral bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-lg font-black text-text-primary">
                      {movement.item.code}
                    </p>
                    <p className="mt-1 break-words text-base leading-6 text-text-primary">
                      {movement.item.description}
                    </p>
                  </div>
                </div>
                <QuantityFlow
                  before={movement.quantityBefore}
                  change={movement.quantityChange}
                  after={movement.quantityAfter}
                />
              </article>
            ))}
          </div>
        )}
      </section>

      {batch.configurationMovements.length > 0 ? (
      <section className="mt-6" aria-labelledby="configuration-impact-title">
        <h2
          id="configuration-impact-title"
          className="text-lg font-black text-text-primary"
        >
          Servos com kit
        </h2>

          <div className="mt-3 grid gap-3">
            {batch.configurationMovements.map((movement) => (
              <article
                key={movement.id}
                className="min-w-0 rounded-2xl border border-violet-200 bg-surface p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <ConfigurationIdentity
                      configuration={movement.configuration}
                    />
                  </div>
                </div>
                <QuantityFlow
                  before={movement.quantityBefore}
                  change={movement.quantityChange}
                  after={movement.quantityAfter}
                />
              </article>
            ))}
          </div>
      </section>
      ) : null}

      <details className="group mt-8 rounded-2xl border border-border-neutral bg-surface p-4">
        <summary className="nk-focus flex min-h-12 cursor-pointer list-none items-center justify-between rounded-xl text-base font-bold text-text-primary">
          Mais detalhes
          <span aria-hidden="true" className="text-text-muted transition group-open:rotate-180">▾</span>
        </summary>
        <p className="mt-2 break-all text-sm text-text-muted">
          Código da movimentação: <span className="font-mono">{batch.id}</span>
        </p>
      <section
        className="mt-7"
        aria-labelledby="registered-request-title"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-charcoal text-brand-gold">
            <StockIcon className="size-5" />
          </span>
          <div>
            <h2
              id="registered-request-title"
              className="text-lg font-black text-text-primary"
            >
              O que foi pedido
            </h2>
          </div>
        </div>

        {!hasRequestLines ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-6 text-sm leading-6 text-text-muted">
            Esta movimentação é antiga e não guardou o pedido detalhado.
            Veja acima o que mudou no estoque.
          </div>
        ) : (
          <>
            <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm leading-6 text-sky-950">
              Os IDs e as quantidades vêm do registro do lote. Códigos,
              descrições, aliases e componentes refletem o catálogo atual.
            </p>
            <div className="mt-3 grid gap-3">
              {batch.inboundLines.map((line) => (
                <article
                  key={line.id}
                  className="min-w-0 rounded-2xl border border-emerald-200 bg-surface p-4 shadow-sm sm:p-5"
                >
                  {line.kind === "ITEM" ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                          Item físico · {line.item.balanceLabel}
                        </p>
                        <p className="mt-1 font-mono text-xl font-black text-text-primary">
                          {line.item.code}
                        </p>
                        <p className="mt-1 break-words text-sm leading-6 font-semibold text-text-primary">
                          {line.item.description}
                        </p>
                        <p className="mt-1 text-xs font-bold text-text-muted">
                          {line.item.typeLabel}
                        </p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 px-3 py-3 text-right">
                        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                          Quantidade
                        </p>
                        <p className="mt-1 font-mono text-2xl font-black tabular-nums text-emerald-900">
                          {formatQuantity(line.quantity)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-violet-800">
                            Código comercial escolhido
                          </p>
                          <p className="mt-1 font-mono text-2xl font-black text-violet-950">
                            {line.commercialCode}
                          </p>
                        </div>
                        <div className="rounded-xl bg-violet-50 px-3 py-3 text-right">
                          <p className="text-xs font-bold uppercase tracking-wide text-violet-800">
                            Servos com kit
                          </p>
                          <p className="mt-1 font-mono text-2xl font-black tabular-nums text-violet-950">
                            {formatQuantity(line.quantity)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 border-t border-border-neutral/70 pt-4">
                        <ConfigurationIdentity
                          configuration={line.configuration}
                        />
                      </div>
                    </>
                  )}
                </article>
              ))}

              {batch.outboundLines.map((line) => (
                <article
                  key={line.id}
                  className="min-w-0 rounded-2xl border border-red-200 bg-surface p-4 shadow-sm sm:p-5"
                >
                  {line.kind === "ITEM" ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-wide text-red-800">
                          Item físico
                        </p>
                        <p className="mt-1 font-mono text-xl font-black text-text-primary">
                          {line.item.code}
                        </p>
                        <p className="mt-1 break-words text-sm leading-6 font-semibold text-text-primary">
                          {line.item.description}
                        </p>
                        <p className="mt-1 text-xs font-bold text-text-muted">
                          {line.item.typeLabel}
                        </p>
                      </div>
                      <div className="rounded-xl bg-red-50 px-3 py-3 text-right">
                        <p className="text-xs font-bold uppercase tracking-wide text-red-800">
                          Solicitada
                        </p>
                        <p className="mt-1 font-mono text-2xl font-black tabular-nums text-red-900">
                          {formatQuantity(line.quantity)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-violet-800">
                            Código comercial escolhido
                          </p>
                          <p className="mt-1 font-mono text-2xl font-black text-violet-950">
                            {line.commercialCode}
                          </p>
                        </div>
                        <div className="rounded-xl bg-red-50 px-3 py-3 text-right">
                          <p className="text-xs font-bold uppercase tracking-wide text-red-800">
                            Solicitada
                          </p>
                          <p className="mt-1 font-mono text-2xl font-black tabular-nums text-red-900">
                            {formatQuantity(line.quantity)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 border-t border-border-neutral/70 pt-4">
                        <ConfigurationIdentity
                          configuration={line.configuration}
                        />
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-violet-50 px-3 py-3">
                          <dt className="text-xs font-bold uppercase tracking-wide text-violet-800">
                            Servos já montados com kit
                          </dt>
                          <dd className="mt-1 font-mono text-xl font-black tabular-nums text-violet-950">
                            {formatQuantity(line.assembledQuantityUsed)}
                          </dd>
                        </div>
                        <div className="rounded-xl bg-amber-50 px-3 py-3">
                          <dt className="text-xs font-bold uppercase tracking-wide text-amber-900">
                            Montadas automaticamente
                          </dt>
                          <dd className="mt-1 font-mono text-xl font-black tabular-nums text-amber-950">
                            {formatQuantity(line.autoAssembledQuantity)}
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {batch.assemblyOperations.length > 0 ? (
        <section className="mt-8 pb-8" aria-labelledby="assembly-title">
          <div>
            <h2
              id="assembly-title"
              className="mt-1 text-xl font-black text-text-primary"
            >
              Operações de montagem
            </h2>
          </div>

          <div className="mt-3 grid gap-3">
            {batch.assemblyOperations.map((operation) => (
              <article
                key={operation.id}
                className="min-w-0 rounded-2xl border border-amber-200 bg-surface p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-amber-900">
                      {operation.isAutomaticOutboundAssembly
                        ? "Montagem automática para atender a saída"
                        : operation.operationType === "ASSEMBLY"
                          ? "Montagem"
                          : "Desmontagem"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-text-muted">
                      Esta operação interna não é contabilizada como uma venda
                      separada.
                    </p>
                  </div>
                  <div className="rounded-xl bg-amber-50 px-3 py-3 text-right">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                      Quantidade
                    </p>
                    <p className="mt-1 font-mono text-2xl font-black tabular-nums text-amber-950">
                      {formatQuantity(operation.quantity)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 border-t border-border-neutral/70 pt-4">
                  <ConfigurationIdentity
                    configuration={operation.configuration}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      </details>
      <div className="pb-8" />
    </main>
  );
}
