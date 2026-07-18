import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  ClockIcon,
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
        <dt className="text-[0.68rem] font-bold uppercase tracking-wide text-text-muted sm:text-xs">
          Antes
        </dt>
        <dd className="mt-1 font-mono text-lg font-black tabular-nums text-text-primary">
          {formatQuantity(before)}
        </dd>
      </div>
      <div className={`rounded-xl px-2 py-3 text-center ${changeClassName}`}>
        <dt className="text-[0.68rem] font-bold uppercase tracking-wide sm:text-xs">
          Alteração
        </dt>
        <dd className="mt-1 font-mono text-lg font-black tabular-nums">
          {formatQuantityChange(change)}
        </dd>
      </div>
      <div className="rounded-xl bg-app-background px-2 py-3 text-center">
        <dt className="text-[0.68rem] font-bold uppercase tracking-wide text-text-muted sm:text-xs">
          Depois
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

      <section className="nk-industrial-grid relative mt-4 overflow-hidden rounded-3xl border border-brand-gold/25 bg-brand-charcoal px-5 py-7 text-white shadow-[0_22px_55px_-38px_rgba(23,29,33,0.95)] sm:px-8 sm:py-9">
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5 bg-brand-gold"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black tracking-[0.2em] text-brand-gold uppercase">
              Detalhes do lote
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {movementTypeLabels[batch.movementType]}
            </h1>
            <p className="mt-2 break-words text-sm leading-6 text-slate-200 sm:text-base">
              {batch.description?.trim() || "Sem descrição"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-3 py-1.5 text-xs font-black ${movementTypeStyles[batch.movementType]}`}
            >
              {movementTypeLabels[batch.movementType]}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white">
              {movementSourceLabels[batch.source]}
            </span>
          </div>
        </div>
      </section>

      <section className="nk-panel mt-5 p-4 sm:p-5" aria-labelledby="audit-title">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-gold-soft text-brand-charcoal">
            <ClockIcon className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
              Auditoria
            </p>
            <h2 id="audit-title" className="mt-1 text-lg font-black text-text-primary">
              Identificação da operação
            </h2>
          </div>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-app-background px-3 py-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Data e horário
            </dt>
            <dd className="mt-1 font-semibold text-text-primary">
              <time dateTime={batch.occurredAt}>
                {formatDate(batch.occurredAt)}
              </time>
            </dd>
          </div>
          <div className="rounded-xl bg-app-background px-3 py-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Usuário registrado
            </dt>
            <dd className="mt-1 break-words font-semibold text-text-primary">
              {batch.userName?.trim() || "Usuário não identificado"}
            </dd>
          </div>
          <div className="rounded-xl bg-app-background px-3 py-3 sm:col-span-2">
            <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Movement batch ID
            </dt>
            <dd className="mt-1 break-all font-mono text-sm font-bold text-text-primary">
              {batch.id}
            </dd>
          </div>
          <div className="rounded-xl bg-app-background px-3 py-3 sm:col-span-2">
            <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">
              Descrição
            </dt>
            <dd className="mt-1 break-words font-semibold text-text-primary">
              {batch.description?.trim() || "Sem descrição"}
            </dd>
          </div>
        </dl>

        {batch.reversedBatchId ? (
          <div className="mt-3 rounded-xl border border-brand-gold/50 bg-brand-gold-soft/50 px-3 py-3 text-sm leading-6 text-brand-charcoal">
            Este lote está relacionado ao lote revertido{" "}
            <Link
              href={`/historico/${batch.reversedBatchId}`}
              className="nk-focus break-all font-mono font-black underline decoration-2 underline-offset-2"
            >
              {batch.reversedBatchId}
            </Link>
            .
          </div>
        ) : null}
      </section>

      <section
        className="mt-7"
        aria-labelledby="registered-request-title"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-charcoal text-brand-gold">
            <StockIcon className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
              Pedido original
            </p>
            <h2
              id="registered-request-title"
              className="mt-1 text-xl font-black text-text-primary"
            >
              Solicitação registrada
            </h2>
          </div>
        </div>

        {!hasRequestLines ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-6 text-sm leading-6 text-text-muted">
            Este lote foi criado antes do registro detalhado da solicitação.
            Consulte o impacto nos saldos abaixo.
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
                            Caixas
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
                            Caixas já montadas
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

      <section className="mt-8" aria-labelledby="physical-impact-title">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
            Saldos físicos
          </p>
          <h2
            id="physical-impact-title"
            className="mt-1 text-xl font-black text-text-primary"
          >
            Impacto nos itens separados
          </h2>
        </div>

        {batch.stockMovements.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-6 text-sm leading-6 text-text-muted">
            Nenhum saldo de item separado foi alterado neste lote.
          </div>
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
                    <p className="mt-1 break-words text-sm leading-6 font-semibold text-text-primary">
                      {movement.item.description}
                    </p>
                  </div>
                  <span className="rounded-full bg-app-background px-2.5 py-1 text-xs font-bold text-text-muted">
                    {movement.item.typeLabel}
                  </span>
                </div>
                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-brand-gold-ink">
                  {movement.item.balanceLabel}
                </p>
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

      <section className="mt-8" aria-labelledby="configuration-impact-title">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
            Saldo compartilhado por configuração
          </p>
          <h2
            id="configuration-impact-title"
            className="mt-1 text-xl font-black text-text-primary"
          >
            Impacto nas caixas montadas
          </h2>
        </div>

        {batch.configurationMovements.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-6 text-sm leading-6 text-text-muted">
            Nenhum saldo de caixa montada foi alterado neste lote.
          </div>
        ) : (
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
                  <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-900">
                    Movimento {movement.sequence}
                  </span>
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

      {batch.assemblyOperations.length > 0 ? (
        <section className="mt-8 pb-8" aria-labelledby="assembly-title">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-gold-ink">
              Composição física
            </p>
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
      ) : (
        <div className="pb-8" />
      )}
    </main>
  );
}
