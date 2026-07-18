"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  CheckIcon,
  InboundIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import {
  buildInboundPreview,
  type InboundPreviewInputLine,
} from "@/lib/inbound-preview";
import {
  physicalItemTypeLabels,
  type InboundCatalog,
  type InboundCatalogOption,
  type InboundCommercialCode,
  type InboundPhysicalItem,
  type InboundReceipt,
  type InboundRequestLine,
  type PhysicalItemType,
} from "@/lib/inbound-types";
import { submitStockInbound } from "./actions";

const maximumQuantity = 2_147_483_647;
const maximumDescriptionLength = 500;
const maximumSearchLength = 120;
const maximumLines = 500;
const numberFormatter = new Intl.NumberFormat("pt-BR");

type DraftLine = {
  option: InboundCatalogOption;
  quantity: string;
};

type FlowStep = "editing" | "review" | "success";

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function parseQuantity(value: string) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const quantity = Number(value);

  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > maximumQuantity
  ) {
    return null;
  }

  return quantity;
}

function getOptionKey(option: InboundCatalogOption) {
  return option.kind === "ITEM"
    ? `ITEM:${option.id}`
    : `COMMERCIAL_CODE:${option.commercialCodeId}`;
}

function getQuantityControlId(option: InboundCatalogOption) {
  return `inbound-quantity-${getOptionKey(option).replace(":", "-")}`;
}

function getOptionSearchText(option: InboundCatalogOption) {
  if (option.kind === "ITEM") {
    return [
      option.code,
      option.description,
      option.model,
      physicalItemTypeLabels[option.itemType],
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    option.code,
    option.description,
    ...option.aliases,
    option.servo.code,
    option.servo.description,
    option.servo.model,
    option.installationKit.code,
    option.installationKit.description,
  ]
    .filter(Boolean)
    .join(" ");
}

function getPhysicalBalanceLabel(itemType: PhysicalItemType) {
  if (itemType === "SERVO") {
    return "Sem kit";
  }

  if (itemType === "INSTALLATION_KIT") {
    return "Separados";
  }

  return "Quantidade";
}

function getPhysicalActionLabel(itemType: PhysicalItemType) {
  return itemType === "SERVO" || itemType === "INSTALLATION_KIT"
    ? "Adicionar separado"
    : "Adicionar";
}

function Summary({
  distinctLines,
  totalUnits,
}: {
  distinctLines: number;
  totalUnits: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-border-neutral bg-app-background p-4">
        <p className="text-xs font-black tracking-wide text-text-muted uppercase">
          Linhas distintas
        </p>
        <p className="mt-1 text-2xl font-black text-text-primary">
          {numberFormatter.format(distinctLines)}
        </p>
      </div>
      <div className="rounded-2xl border border-border-neutral bg-app-background p-4">
        <p className="text-xs font-black tracking-wide text-text-muted uppercase">
          Total de unidades
        </p>
        <p className="mt-1 text-2xl font-black text-text-primary">
          {numberFormatter.format(totalUnits)}
        </p>
      </div>
    </div>
  );
}

function OptionBadge({ option }: { option: InboundCatalogOption }) {
  return option.kind === "ITEM" ? (
    <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-emerald-950 uppercase">
      Item separado
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-violet-200 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-violet-950 uppercase">
      Caixa com kit
    </span>
  );
}

function PhysicalCatalogCard({
  item,
  isSelected,
  onAdd,
}: {
  item: InboundPhysicalItem;
  isSelected: boolean;
  onAdd: () => void;
}) {
  const balanceLabel = getPhysicalBalanceLabel(item.itemType);

  return (
    <article className="flex min-h-64 flex-col rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <OptionBadge option={item} />
        <span className="text-right text-xs font-black text-emerald-950">
          {balanceLabel}: {numberFormatter.format(item.balance)}
        </span>
      </div>
      <span className="mt-3 w-fit rounded-full bg-brand-gold-soft px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-brand-gold-ink uppercase">
        {physicalItemTypeLabels[item.itemType]}
      </span>
      <p className="mt-2 font-mono text-xl font-black text-text-primary">
        {item.code}
      </p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold text-text-muted">
        {item.description}
      </p>
      {item.model ? (
        <p className="mt-2 text-xs font-bold text-text-muted">
          Modelo: <span className="text-text-primary">{item.model}</span>
        </p>
      ) : null}
      <button
        type="button"
        onClick={onAdd}
        disabled={isSelected}
        className="nk-focus mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-black text-white transition hover:bg-emerald-900 disabled:cursor-default disabled:bg-emerald-100 disabled:text-emerald-950"
      >
        {isSelected ? (
          <>
            <CheckIcon className="size-5" />
            Adicionado
          </>
        ) : (
          <>
            <PlusIcon className="size-5" />
            {getPhysicalActionLabel(item.itemType)}
          </>
        )}
      </button>
    </article>
  );
}

function CommercialCatalogCard({
  option,
  isSelected,
  onAdd,
}: {
  option: InboundCommercialCode;
  isSelected: boolean;
  onAdd: () => void;
}) {
  return (
    <article className="flex min-h-80 flex-col rounded-2xl border border-violet-300 bg-violet-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <OptionBadge option={option} />
        <span className="text-right text-xs font-black text-violet-950">
          Caixas montadas:{" "}
          {numberFormatter.format(option.assembledBalance)}
        </span>
      </div>
      <p className="mt-3 font-mono text-2xl font-black text-violet-950">
        {option.code}
      </p>
      <p className="mt-1 text-sm font-semibold text-text-muted">
        {option.description}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-surface p-3">
          <p className="text-[0.65rem] font-black tracking-wide text-violet-800 uppercase">
            Servo dentro da caixa
          </p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            {option.servo.code}
          </p>
          <p className="mt-1 text-xs font-semibold text-text-muted">
            {option.servo.description}
          </p>
          {option.servo.model ? (
            <p className="mt-1 text-xs font-bold text-text-muted">
              Modelo: {option.servo.model}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl bg-surface p-3">
          <p className="text-[0.65rem] font-black tracking-wide text-violet-800 uppercase">
            Kit dentro da caixa
          </p>
          <p className="mt-1 font-mono text-sm font-black text-text-primary">
            {option.installationKit.code}
          </p>
          <p className="mt-1 text-xs font-semibold text-text-muted">
            {option.installationKit.description}
          </p>
        </div>
      </div>

      {option.aliases.length > 0 ? (
        <div className="mt-3">
          <p className="text-[0.65rem] font-black tracking-wide text-violet-800 uppercase">
            Mesma configuração
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {option.aliases.map((alias) => (
              <span
                key={alias}
                className="rounded-full border border-violet-200 bg-surface px-2.5 py-1 font-mono text-xs font-black text-violet-950"
              >
                {alias}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs font-bold text-violet-900">
        1 unidade representa uma caixa completa com um servo e um kit.
      </p>
      <button
        type="button"
        onClick={onAdd}
        disabled={isSelected}
        className="nk-focus mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-900 px-4 text-sm font-black text-white transition hover:bg-violet-950 disabled:cursor-default disabled:bg-violet-200 disabled:text-violet-950"
      >
        {isSelected ? (
          <>
            <CheckIcon className="size-5" />
            Adicionada
          </>
        ) : (
          <>
            <PlusIcon className="size-5" />
            Adicionar caixa
          </>
        )}
      </button>
    </article>
  );
}

export function InboundEntryFlow({
  catalog,
}: {
  catalog: InboundCatalog;
}) {
  const router = useRouter();
  const [step, setStep] = useState<FlowStep>("editing");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<InboundReceipt | null>(null);
  const [isPending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);
  const submissionInFlight = useRef(false);

  const options = useMemo<InboundCatalogOption[]>(
    () => [...catalog.physicalItems, ...catalog.commercialCodes],
    [catalog],
  );
  const selectedKeys = useMemo(
    () => new Set(lines.map((line) => getOptionKey(line.option))),
    [lines],
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);

    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) =>
      normalizeSearch(getOptionSearchText(option)).includes(normalizedQuery),
    );
  }, [options, search]);
  const parsedLines = useMemo<InboundPreviewInputLine[]>(
    () =>
      lines.flatMap((line) => {
        const quantity = parseQuantity(line.quantity);

        return quantity === null
          ? []
          : [{ option: line.option, quantity }];
      }),
    [lines],
  );
  const preview = useMemo(
    () => buildInboundPreview(parsedLines),
    [parsedLines],
  );

  function rotateIdempotencyKey() {
    idempotencyKey.current = globalThis.crypto.randomUUID();
  }

  function markPayloadChanged() {
    rotateIdempotencyKey();
    setValidationError(null);
    setSubmissionError(null);
  }

  function addOption(option: InboundCatalogOption) {
    if (selectedKeys.has(getOptionKey(option)) || isPending) {
      return;
    }

    markPayloadChanged();
    setLines((currentLines) => [
      ...currentLines,
      { option, quantity: "1" },
    ]);
  }

  function changeQuantity(key: string, quantity: string) {
    if (isPending) {
      return;
    }

    markPayloadChanged();
    setLines((currentLines) =>
      currentLines.map((line) =>
        getOptionKey(line.option) === key ? { ...line, quantity } : line,
      ),
    );
  }

  function removeLine(key: string) {
    if (isPending) {
      return;
    }

    markPayloadChanged();
    setLines((currentLines) =>
      currentLines.filter((line) => getOptionKey(line.option) !== key),
    );
  }

  function changeDescription(value: string) {
    if (isPending) {
      return;
    }

    markPayloadChanged();
    setDescription(value);
  }

  function validateDraft() {
    if (lines.length === 0) {
      return "Adicione pelo menos um item ou código comercial à entrada.";
    }

    if (lines.length > maximumLines) {
      return "A entrada possui linhas demais para uma única operação.";
    }

    if (lines.some((line) => parseQuantity(line.quantity) === null)) {
      return "Revise as quantidades. Use somente números inteiros e positivos.";
    }

    if (description.trim().length > maximumDescriptionLength) {
      return `A descrição deve ter no máximo ${maximumDescriptionLength} caracteres.`;
    }

    if (!preview.isValid) {
      return "A previsão encontrou uma quantidade acima do limite permitido.";
    }

    return null;
  }

  function reviewEntry() {
    const error = validateDraft();

    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    setSubmissionError(null);
    setStep("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function returnToEditing() {
    if (isPending) {
      return;
    }

    setSubmissionError(null);
    setStep("editing");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildRequestLines(): InboundRequestLine[] {
    return lines.map((line) => {
      const quantity = parseQuantity(line.quantity) as number;

      return line.option.kind === "ITEM"
        ? {
            kind: "ITEM",
            item_id: line.option.id,
            quantity,
          }
        : {
            kind: "COMMERCIAL_CODE",
            commercial_code_id: line.option.commercialCodeId,
            quantity,
          };
    });
  }

  function confirmEntry() {
    if (isPending || submissionInFlight.current) {
      return;
    }

    const error = validateDraft();

    if (error) {
      setValidationError(error);
      setStep("editing");
      return;
    }

    const key =
      idempotencyKey.current ?? globalThis.crypto.randomUUID();
    idempotencyKey.current = key;
    submissionInFlight.current = true;
    setSubmissionError(null);

    startTransition(async () => {
      try {
        const result = await submitStockInbound({
          p_lines: buildRequestLines(),
          p_idempotency_key: key,
          p_description: description.trim() || null,
        });

        if (!result.ok) {
          setSubmissionError(result.error);
          return;
        }

        setReceipt(result.receipt);
        rotateIdempotencyKey();
        setStep("success");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        setSubmissionError(
          "A comunicação foi interrompida. Tente confirmar novamente.",
        );
      } finally {
        submissionInFlight.current = false;
      }
    });
  }

  function startNewEntry() {
    setLines([]);
    setDescription("");
    setSearch("");
    setValidationError(null);
    setSubmissionError(null);
    setReceipt(null);
    rotateIdempotencyKey();
    setStep("editing");
    router.refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (step === "success" && receipt) {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-surface p-5 shadow-lg shadow-emerald-950/5 sm:p-8">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <CheckIcon className="size-9" />
        </div>
        <p className="mt-6 text-xs font-black tracking-[0.18em] text-emerald-700 uppercase">
          Operação concluída
        </p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-text-primary sm:text-3xl">
          Entrada registrada
        </h2>
        <p className="mt-2 font-semibold text-text-muted">
          Os saldos foram atualizados e o histórico da movimentação foi
          criado.
        </p>

        <div className="mt-6 rounded-2xl border border-border-neutral bg-app-background p-4 sm:p-5">
          <p className="text-xs font-black tracking-wide text-text-muted uppercase">
            ID do lote
          </p>
          <p className="mt-2 break-all font-mono text-sm font-bold text-text-primary">
            {receipt.movementBatchId}
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border-neutral bg-app-background p-4">
            <p className="text-xs font-black tracking-wide text-text-muted uppercase">
              Linhas processadas
            </p>
            <p className="mt-1 text-2xl font-black text-text-primary">
              {numberFormatter.format(receipt.linesProcessed)}
            </p>
          </div>
          <div className="rounded-2xl border border-border-neutral bg-app-background p-4">
            <p className="text-xs font-black tracking-wide text-text-muted uppercase">
              Unidades informadas
            </p>
            <p className="mt-1 text-2xl font-black text-text-primary">
              {numberFormatter.format(receipt.totalQuantity)}
            </p>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <p className="text-xs font-black tracking-wide text-violet-800 uppercase">
              Caixas com kit
            </p>
            <p className="mt-1 text-2xl font-black text-violet-950">
              {numberFormatter.format(receipt.commercialQuantity)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs font-semibold text-text-muted">
          “Unidades informadas” soma as quantidades das linhas. Cada caixa
          comercial conta como uma unidade, não como dois componentes.
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={startNewEntry}
            className="nk-focus inline-flex min-h-14 items-center justify-center rounded-2xl bg-brand-charcoal px-5 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
          >
            Nova entrada
          </button>
          <Link
            href="/"
            className="nk-focus inline-flex min-h-14 items-center justify-center rounded-2xl border border-border-neutral bg-surface px-5 text-sm font-black text-text-primary transition hover:bg-app-background"
          >
            Voltar para o início
          </Link>
        </div>
      </section>
    );
  }

  if (step === "review") {
    return (
      <section className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-center gap-3" aria-label="Etapa 2 de 2">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-700 text-sm font-black text-white">
            <CheckIcon className="size-5" />
          </span>
          <span className="h-1 flex-1 rounded-full bg-brand-gold" />
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-charcoal text-sm font-black text-white ring-2 ring-brand-gold">
            2
          </span>
          <p className="sr-only">Revisão da entrada antes da confirmação</p>
        </div>

        <div className="rounded-3xl border border-border-neutral bg-surface p-5 shadow-sm sm:p-7">
          <p className="text-xs font-black tracking-[0.16em] text-brand-gold-ink uppercase">
            Etapa 2 de 2
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-text-primary">
            Revise a entrada
          </h2>
          <p className="mt-2 text-sm font-semibold text-text-muted">
            Esta é uma previsão. O banco validará novamente os dados ao
            selecionar “Confirmar entrada”.
          </p>

          {preview.itemLines.length > 0 ? (
            <section className="mt-7" aria-labelledby="inbound-review-items">
              <h3
                id="inbound-review-items"
                className="text-lg font-black text-text-primary"
              >
                Peças recebidas separadas
              </h3>
              <div className="mt-3 space-y-3">
                {preview.itemLines.map((line) => (
                  <article
                    key={line.option.id}
                    className={`rounded-2xl border p-4 ${
                      line.isValid
                        ? "border-emerald-200 bg-emerald-50/40"
                        : "border-red-300 bg-red-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <OptionBadge option={line.option} />
                        <p className="mt-2 font-mono text-xl font-black text-text-primary">
                          {line.option.code}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-text-muted">
                          {line.option.description}
                        </p>
                      </div>
                      <div className="rounded-xl bg-emerald-900 px-3 py-2 text-right text-white">
                        <p className="text-[0.65rem] font-black tracking-wide text-emerald-200 uppercase">
                          Receber
                        </p>
                        <p className="text-xl font-black">
                          {numberFormatter.format(line.receivedQuantity)}
                        </p>
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-surface p-3">
                        <dt className="text-[0.65rem] font-black text-text-muted uppercase">
                          {getPhysicalBalanceLabel(line.option.itemType)} atual
                        </dt>
                        <dd className="mt-1 font-black text-text-primary">
                          {numberFormatter.format(line.option.balance)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-surface p-3">
                        <dt className="text-[0.65rem] font-black text-text-muted uppercase">
                          Entrada
                        </dt>
                        <dd className="mt-1 font-black text-emerald-800">
                          +{numberFormatter.format(line.receivedQuantity)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-surface p-3">
                        <dt className="text-[0.65rem] font-black text-text-muted uppercase">
                          Previsto
                        </dt>
                        <dd
                          className={`mt-1 font-black ${
                            line.isValid
                              ? "text-emerald-800"
                              : "text-red-800"
                          }`}
                        >
                          {numberFormatter.format(line.predictedBalance)}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {preview.commercialLines.length > 0 ? (
            <section className="mt-7" aria-labelledby="inbound-review-boxes">
              <h3
                id="inbound-review-boxes"
                className="text-lg font-black text-text-primary"
              >
                Caixas recebidas com kit
              </h3>
              <div className="mt-3 space-y-3">
                {preview.commercialLines.map((line) => (
                  <article
                    key={line.option.commercialCodeId}
                    className="rounded-2xl border border-violet-300 bg-violet-50/70 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <OptionBadge option={line.option} />
                        <p className="mt-2 font-mono text-2xl font-black text-violet-950">
                          {line.option.code}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-text-muted">
                          {line.option.description}
                        </p>
                      </div>
                      <div className="rounded-xl bg-violet-950 px-3 py-2 text-right text-white">
                        <p className="text-[0.65rem] font-black tracking-wide text-violet-200 uppercase">
                          Receber
                        </p>
                        <p className="text-xl font-black">
                          {numberFormatter.format(line.receivedQuantity)}
                        </p>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-1 rounded-xl bg-surface p-3 text-sm font-semibold text-text-muted">
                      <li>
                        Contém servo{" "}
                        <strong className="text-text-primary">
                          {line.option.servo.code}
                        </strong>{" "}
                        — {line.option.servo.description}
                      </li>
                      <li>
                        Contém kit{" "}
                        <strong className="text-text-primary">
                          {line.option.installationKit.code}
                        </strong>{" "}
                        — {line.option.installationKit.description}
                      </li>
                    </ul>
                  </article>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {preview.configurationImpacts.map((impact) => (
                  <article
                    key={impact.configurationId}
                    className={`rounded-2xl border p-4 ${
                      impact.isValid
                        ? "border-violet-300 bg-violet-50"
                        : "border-red-300 bg-red-50"
                    }`}
                  >
                    <p className="text-xs font-black tracking-wide text-violet-800 uppercase">
                      Caixas montadas — impacto consolidado
                    </p>
                    <p className="mt-1 font-mono text-lg font-black text-violet-950">
                      {impact.requestedCodes.join(" + ")}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-text-muted">
                      {impact.requestedCodes.length > 1
                        ? "Os aliases selecionados compartilham o mesmo saldo montado."
                        : "Saldo atual e previsto das caixas montadas."}
                    </p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-surface p-2.5">
                        <dt className="text-[0.6rem] font-black text-text-muted uppercase">
                          Atual
                        </dt>
                        <dd className="mt-1 font-black text-text-primary">
                          {numberFormatter.format(impact.currentBalance)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-surface p-2.5">
                        <dt className="text-[0.6rem] font-black text-text-muted uppercase">
                          Entrada
                        </dt>
                        <dd className="mt-1 font-black text-violet-900">
                          +{numberFormatter.format(impact.receivedQuantity)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-surface p-2.5">
                        <dt className="text-[0.6rem] font-black text-text-muted uppercase">
                          Previsto
                        </dt>
                        <dd
                          className={`mt-1 font-black ${
                            impact.isValid
                              ? "text-violet-900"
                              : "text-red-800"
                          }`}
                        >
                          {numberFormatter.format(impact.predictedBalance)}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-violet-300 bg-violet-100/70 p-4 text-sm font-bold text-violet-950">
                As caixas comerciais serão registradas como já montadas. Os
                componentes não serão adicionados ao estoque separado.
              </div>
            </section>
          ) : null}

          <div className="mt-6 rounded-2xl border border-border-neutral p-4">
            <p className="text-xs font-black tracking-wide text-text-muted uppercase">
              Descrição
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-text-primary">
              {description.trim() || "Sem descrição"}
            </p>
          </div>

          <div className="mt-5">
            <Summary
              distinctLines={lines.length}
              totalUnits={preview.totalQuantity}
            />
          </div>

          {!preview.isValid ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950"
            >
              <p className="font-black">A entrada não pode ser confirmada.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">
                {preview.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {submissionError ? (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-950"
            >
              {submissionError}
            </div>
          ) : null}

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={returnToEditing}
              disabled={isPending}
              className="nk-focus order-2 inline-flex min-h-14 items-center justify-center rounded-2xl border border-border-neutral bg-surface px-5 text-sm font-black text-text-primary transition hover:bg-app-background disabled:cursor-not-allowed disabled:opacity-50 sm:order-1"
            >
              Voltar e corrigir
            </button>
            <button
              type="button"
              onClick={confirmEntry}
              disabled={isPending || !preview.isValid}
              aria-busy={isPending}
              className="order-1 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 text-sm font-black text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-55 sm:order-2"
            >
              {isPending ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                  Registrando entrada...
                </>
              ) : (
                "Confirmar entrada"
              )}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-5 flex items-center gap-3" aria-label="Etapa 1 de 2">
        <span className="flex size-9 items-center justify-center rounded-full bg-brand-charcoal text-sm font-black text-white ring-2 ring-brand-gold">
          1
        </span>
        <span className="h-1 flex-1 rounded-full bg-border-neutral" />
        <span className="flex size-9 items-center justify-center rounded-full bg-brand-gold-soft text-sm font-black text-brand-charcoal">
          2
        </span>
        <p className="sr-only">Edição da entrada</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="min-w-0 rounded-3xl border border-border-neutral bg-surface p-4 shadow-sm sm:p-6">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-brand-gold-ink uppercase">
              Etapa 1 de 2
            </p>
            <h2 className="mt-1 text-xl font-black text-text-primary">
              Selecione peças ou caixas
            </h2>
          </div>

          <div className="mt-5 rounded-2xl border border-brand-gold/40 bg-brand-gold-soft/55 p-4 text-sm font-bold text-brand-charcoal">
            Use o código comercial quando a caixa chegar com servo e kit. Se
            as peças chegarem separadas, adicione os códigos físicos.
          </div>

          <label
            htmlFor="inbound-search"
            className="mt-5 block text-sm font-black text-text-primary"
          >
            Pesquisar catálogo
          </label>
          <div className="relative mt-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
            <input
              id="inbound-search"
              type="search"
              value={search}
              maxLength={maximumSearchLength}
              onChange={(event) =>
                setSearch(event.target.value.slice(0, maximumSearchLength))
              }
              placeholder="Código, descrição, modelo, servo ou kit"
              className="nk-field min-h-13 w-full rounded-2xl border pr-4 pl-12 text-base font-semibold outline-none transition placeholder:text-text-muted"
            />
          </div>

          <p className="mt-3 text-xs font-bold text-text-muted" aria-live="polite">
            {!search.trim()
              ? `Mostrando todas as ${numberFormatter.format(filteredOptions.length)} opções`
              : filteredOptions.length === 1
                ? "1 opção encontrada"
                : `${numberFormatter.format(filteredOptions.length)} opções encontradas`}
          </p>

          {filteredOptions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border-neutral bg-app-background p-6 text-center">
              <SearchIcon className="mx-auto size-8 text-text-muted" />
              <h3 className="mt-3 font-black text-text-primary">
                Nenhum resultado
              </h3>
              <p className="mt-1 text-sm font-semibold text-text-muted">
                Tente outro código, descrição, modelo, servo ou kit.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {filteredOptions.map((option) => {
                const key = getOptionKey(option);
                const isSelected = selectedKeys.has(key);

                return option.kind === "ITEM" ? (
                  <PhysicalCatalogCard
                    key={key}
                    item={option}
                    isSelected={isSelected}
                    onAdd={() => addOption(option)}
                  />
                ) : (
                  <CommercialCatalogCard
                    key={key}
                    option={option}
                    isSelected={isSelected}
                    onAdd={() => addOption(option)}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-3xl border border-border-neutral bg-surface p-4 shadow-sm sm:p-6 lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-brand-gold-ink uppercase">
                Entrada atual
              </p>
              <h2 className="mt-1 text-xl font-black text-text-primary">
                Linhas e quantidades
              </h2>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
              <InboundIcon className="size-6" />
            </span>
          </div>

          {lines.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border-neutral bg-app-background p-6 text-center">
              <h3 className="font-black text-text-primary">Carrinho vazio</h3>
              <p className="mt-1 text-sm font-semibold text-text-muted">
                Adicione itens separados ou caixas com kit para continuar.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {lines.map((line) => {
                const key = getOptionKey(line.option);
                const controlId = getQuantityControlId(line.option);
                const quantityIsInvalid =
                  parseQuantity(line.quantity) === null;

                return (
                  <article
                    key={key}
                    className={`rounded-2xl border p-4 ${
                      line.option.kind === "ITEM"
                        ? "border-emerald-200"
                        : "border-violet-300 bg-violet-50/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <OptionBadge option={line.option} />
                        <p className="mt-2 font-mono text-lg font-black text-text-primary">
                          {line.option.code}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs font-bold text-text-muted">
                          {line.option.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(key)}
                        aria-label={`Remover ${line.option.code}`}
                        className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-800 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-200"
                      >
                        <TrashIcon className="size-5" />
                      </button>
                    </div>

                    <label
                      htmlFor={controlId}
                      className="mt-4 block text-xs font-black tracking-wide text-text-muted uppercase"
                    >
                      Quantidade
                    </label>
                    <input
                      id={controlId}
                      type="number"
                      min="1"
                      max={maximumQuantity}
                      step="1"
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(event) =>
                        changeQuantity(key, event.target.value)
                      }
                      aria-invalid={quantityIsInvalid}
                      aria-describedby={
                        quantityIsInvalid
                          ? `${controlId}-error`
                          : undefined
                      }
                      className="nk-field mt-2 min-h-12 w-full rounded-xl border px-4 text-base font-black outline-none transition aria-invalid:border-red-600 aria-invalid:ring-3 aria-invalid:ring-red-100"
                    />
                    {quantityIsInvalid ? (
                      <p
                        id={`${controlId}-error`}
                        className="mt-2 text-xs font-bold text-red-800"
                      >
                        Informe um número inteiro maior que zero.
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}

          <label
            htmlFor="inbound-description"
            className="mt-5 block text-sm font-black text-text-primary"
          >
            Descrição{" "}
            <span className="font-semibold text-text-muted">(opcional)</span>
          </label>
          <textarea
            id="inbound-description"
            value={description}
            onChange={(event) => changeDescription(event.target.value)}
            maxLength={maximumDescriptionLength}
            rows={3}
            placeholder="Ex.: recebimento do fornecedor"
            className="nk-field mt-2 w-full resize-y rounded-2xl border px-4 py-3 text-base font-semibold outline-none transition placeholder:text-text-muted"
          />
          <p className="mt-1 text-right text-xs font-bold text-text-muted">
            {description.length}/{maximumDescriptionLength}
          </p>

          <div className="mt-5">
            <Summary
              distinctLines={lines.length}
              totalUnits={preview.totalQuantity}
            />
          </div>

          {validationError ? (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-950"
            >
              {validationError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={reviewEntry}
            className="nk-focus mt-5 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-brand-charcoal px-5 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
          >
            Revisar entrada
          </button>
          <p className="mt-3 text-center text-xs font-bold text-text-muted">
            Revisar não movimenta o estoque.
          </p>
        </div>
      </div>
    </section>
  );
}
