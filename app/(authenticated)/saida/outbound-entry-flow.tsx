"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  CheckIcon,
  OutboundIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import { physicalItemTypeLabels } from "@/lib/inbound-types";
import {
  buildOutboundPreview,
  type OutboundPreviewInputLine,
} from "@/lib/outbound-preview";
import type {
  OutboundCatalog,
  OutboundCatalogOption,
  OutboundCommercialCode,
  OutboundPhysicalItem,
  OutboundReceipt,
  OutboundRequestLine,
} from "@/lib/outbound-types";
import { submitStockOutbound } from "./actions";

const maximumQuantity = 2_147_483_647;
const maximumDescriptionLength = 500;
const numberFormatter = new Intl.NumberFormat("pt-BR");

type DraftLine = {
  option: OutboundCatalogOption;
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

function getOptionKey(option: OutboundCatalogOption) {
  return option.kind === "ITEM"
    ? `ITEM:${option.id}`
    : `COMMERCIAL_CODE:${option.commercialCodeId}`;
}

function getOptionSearchText(option: OutboundCatalogOption) {
  if (option.kind === "ITEM") {
    return `${option.code} ${option.description} ${physicalItemTypeLabels[option.itemType]}`;
  }

  return [
    option.code,
    option.description,
    option.servo.code,
    option.servo.description,
    option.servo.model,
    option.installationKit.code,
    option.installationKit.description,
  ]
    .filter(Boolean)
    .join(" ");
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
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
          Linhas distintas
        </p>
        <p className="mt-1 text-2xl font-black text-slate-950">
          {numberFormatter.format(distinctLines)}
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
          Total de unidades
        </p>
        <p className="mt-1 text-2xl font-black text-slate-950">
          {numberFormatter.format(totalUnits)}
        </p>
      </div>
    </div>
  );
}

function OptionBadge({ option }: { option: OutboundCatalogOption }) {
  return option.kind === "ITEM" ? (
    <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-slate-800 uppercase">
      Item físico
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-violet-100 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-violet-900 uppercase">
      Código comercial
    </span>
  );
}

function PhysicalCatalogCard({
  item,
  isSelected,
  onAdd,
}: {
  item: OutboundPhysicalItem;
  isSelected: boolean;
  onAdd: () => void;
}) {
  return (
    <article className="flex min-h-60 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <OptionBadge option={item} />
        <span className="text-right text-xs font-black text-slate-600">
          Saldo avulso: {numberFormatter.format(item.balance)}
        </span>
      </div>
      <span className="mt-3 w-fit rounded-full bg-red-100 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-red-900 uppercase">
        {physicalItemTypeLabels[item.itemType]}
      </span>
      <p className="mt-2 text-xl font-black text-slate-950">{item.code}</p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-600">
        {item.description}
      </p>
      <button
        type="button"
        onClick={onAdd}
        disabled={isSelected}
        className="mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-black text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-300 disabled:cursor-default disabled:bg-emerald-100 disabled:text-emerald-900"
      >
        {isSelected ? (
          <>
            <CheckIcon className="size-5" />
            Adicionado
          </>
        ) : (
          <>
            <PlusIcon className="size-5" />
            Adicionar
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
  option: OutboundCommercialCode;
  isSelected: boolean;
  onAdd: () => void;
}) {
  return (
    <article className="flex min-h-72 flex-col rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <OptionBadge option={option} />
        <span className="text-right text-xs font-black text-violet-900">
          Montados: {numberFormatter.format(option.assembledBalance)}
        </span>
      </div>
      <p className="mt-3 text-xl font-black text-slate-950">{option.code}</p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-700">
        {option.description}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-700">
        <div className="rounded-xl bg-white/80 p-2.5">
          <span className="block text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
            Servo
          </span>
          <span className="mt-1 block text-slate-950">
            {option.servo.code}
          </span>
          <span className="mt-0.5 block font-semibold">
            Avulso: {numberFormatter.format(option.servo.balance)}
          </span>
        </div>
        <div className="rounded-xl bg-white/80 p-2.5">
          <span className="block text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
            Kit
          </span>
          <span className="mt-1 block text-slate-950">
            {option.installationKit.code}
          </span>
          <span className="mt-0.5 block font-semibold">
            Avulso:{" "}
            {numberFormatter.format(option.installationKit.balance)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={isSelected}
        className="mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-black text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-300 disabled:cursor-default disabled:bg-emerald-100 disabled:text-emerald-900"
      >
        {isSelected ? (
          <>
            <CheckIcon className="size-5" />
            Adicionado
          </>
        ) : (
          <>
            <PlusIcon className="size-5" />
            Adicionar
          </>
        )}
      </button>
    </article>
  );
}

export function OutboundEntryFlow({
  catalog,
}: {
  catalog: OutboundCatalog;
}) {
  const router = useRouter();
  const [step, setStep] = useState<FlowStep>("editing");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OutboundReceipt | null>(null);
  const [isPending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);
  const submissionInFlight = useRef(false);

  const options = useMemo<OutboundCatalogOption[]>(
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
  const parsedLines = useMemo<OutboundPreviewInputLine[]>(
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
    () => buildOutboundPreview(parsedLines),
    [parsedLines],
  );
  const totalUnits = parsedLines.reduce(
    (total, line) => total + line.quantity,
    0,
  );

  function rotateIdempotencyKey() {
    idempotencyKey.current = globalThis.crypto.randomUUID();
  }

  function markPayloadChanged() {
    rotateIdempotencyKey();
    setValidationError(null);
    setSubmissionError(null);
  }

  function addOption(option: OutboundCatalogOption) {
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
      return "Adicione pelo menos um item ou código comercial à saída.";
    }

    if (lines.some((line) => parseQuantity(line.quantity) === null)) {
      return "Revise as quantidades. Use somente números inteiros e positivos.";
    }

    if (description.trim().length > maximumDescriptionLength) {
      return `A descrição deve ter no máximo ${maximumDescriptionLength} caracteres.`;
    }

    return null;
  }

  function reviewOutbound() {
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

  function buildRequestLines(): OutboundRequestLine[] {
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

  function confirmOutbound() {
    if (isPending || submissionInFlight.current) {
      return;
    }

    const error = validateDraft();

    if (error) {
      setValidationError(error);
      setStep("editing");
      return;
    }

    if (!preview.isValid) {
      setSubmissionError(
        "A previsão encontrou saldo insuficiente. Volte e ajuste as quantidades.",
      );
      return;
    }

    const key =
      idempotencyKey.current ?? globalThis.crypto.randomUUID();
    idempotencyKey.current = key;
    submissionInFlight.current = true;
    setSubmissionError(null);

    startTransition(async () => {
      try {
        const result = await submitStockOutbound({
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

  function startNewOutbound() {
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
      <section className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-5 shadow-lg shadow-emerald-950/5 sm:p-8">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <CheckIcon className="size-9" />
        </div>
        <p className="mt-6 text-xs font-black tracking-[0.18em] text-emerald-700 uppercase">
          Operação concluída
        </p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
          Saída registrada
        </h2>
        <p className="mt-2 font-semibold text-slate-600">
          Os saldos foram atualizados e o histórico da movimentação foi
          criado.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
            Movement batch ID
          </p>
          <p className="mt-2 break-all font-mono text-sm font-bold text-slate-950">
            {receipt.movementBatchId}
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
              Linhas
            </p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {numberFormatter.format(receipt.linesProcessed)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
              Unidades
            </p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {numberFormatter.format(receipt.totalQuantity)}
            </p>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <p className="text-xs font-black tracking-wide text-violet-700 uppercase">
              Auto montadas
            </p>
            <p className="mt-1 text-2xl font-black text-violet-950">
              {numberFormatter.format(receipt.autoAssembledQuantity)}
            </p>
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={startNewOutbound}
            className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-red-700 px-5 text-sm font-black text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-300"
          >
            Nova saída
          </button>
          <Link
            href="/"
            className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-black text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-slate-300"
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
          <span className="h-1 flex-1 rounded-full bg-red-700" />
          <span className="flex size-9 items-center justify-center rounded-full bg-red-700 text-sm font-black text-white">
            2
          </span>
          <p className="sr-only">Revisão da saída antes da confirmação</p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-black tracking-[0.16em] text-red-700 uppercase">
            Etapa 2 de 2
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
            Revise saldos e montagens
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Esta é uma previsão. O banco validará novamente os saldos ao
            selecionar “Confirmar saída”.
          </p>

          {preview.itemLines.length > 0 ? (
            <section className="mt-7" aria-labelledby="review-items-title">
              <h3
                id="review-items-title"
                className="text-base font-black text-slate-950"
              >
                Itens físicos
              </h3>
              <div className="mt-3 space-y-3">
                {preview.itemLines.map((line) => (
                  <article
                    key={line.option.id}
                    className={`rounded-2xl border p-4 ${
                      line.isSufficient
                        ? "border-slate-200 bg-slate-50"
                        : "border-red-300 bg-red-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <OptionBadge option={line.option} />
                        <p className="mt-2 text-xl font-black text-slate-950">
                          {line.option.code}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-600">
                          {line.option.description}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-950 px-3 py-2 text-right text-white">
                        <p className="text-[0.65rem] font-black tracking-wide text-slate-300 uppercase">
                          Solicitado
                        </p>
                        <p className="text-xl font-black">
                          {numberFormatter.format(line.requestedQuantity)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
                          Saldo atual
                        </p>
                        <p className="mt-1 font-black text-slate-950">
                          {numberFormatter.format(line.option.balance)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
                          Consumo total
                        </p>
                        <p className="mt-1 font-black text-slate-950">
                          {numberFormatter.format(
                            line.totalPhysicalConsumption,
                          )}
                        </p>
                      </div>
                      <div className="col-span-2 rounded-xl bg-white p-3 sm:col-span-1">
                        <p className="text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
                          Saldo previsto
                        </p>
                        <p
                          className={`mt-1 font-black ${
                            line.isSufficient
                              ? "text-emerald-800"
                              : "text-red-800"
                          }`}
                        >
                          {numberFormatter.format(line.predictedBalance)}
                        </p>
                      </div>
                    </div>
                    {line.totalPhysicalConsumption >
                    line.requestedQuantity ? (
                      <p className="mt-3 text-xs font-bold text-violet-800">
                        O consumo total inclui este item como componente de
                        montagem automática.
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {preview.commercialLines.length > 0 ? (
            <section className="mt-7" aria-labelledby="review-codes-title">
              <h3
                id="review-codes-title"
                className="text-base font-black text-slate-950"
              >
                Códigos comerciais
              </h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Aliases da mesma configuração compartilham o saldo montado,
                distribuído por código comercial e ID.
              </p>
              <div className="mt-3 space-y-3">
                {preview.commercialLines.map((line) => (
                  <article
                    key={line.option.commercialCodeId}
                    className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <OptionBadge option={line.option} />
                        <p className="mt-2 text-xl font-black text-slate-950">
                          {line.option.code}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-700">
                          {line.option.description}
                        </p>
                      </div>
                      <div className="rounded-xl bg-violet-950 px-3 py-2 text-right text-white">
                        <p className="text-[0.65rem] font-black tracking-wide text-violet-200 uppercase">
                          Solicitado
                        </p>
                        <p className="text-xl font-black">
                          {numberFormatter.format(line.requestedQuantity)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
                          Saldo montado
                        </p>
                        <p className="mt-1 font-black text-slate-950">
                          {numberFormatter.format(
                            line.option.assembledBalance,
                          )}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
                          Usar montados
                        </p>
                        <p className="mt-1 font-black text-slate-950">
                          {numberFormatter.format(
                            line.assembledQuantityUsed,
                          )}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-[0.65rem] font-black tracking-wide text-slate-500 uppercase">
                          Montar automaticamente
                        </p>
                        <p className="mt-1 font-black text-violet-900">
                          {numberFormatter.format(
                            line.autoAssembledQuantity,
                          )}
                        </p>
                      </div>
                    </div>
                    {line.autoAssembledQuantity > 0 ? (
                      <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
                        <p className="text-xs font-black tracking-wide text-violet-800 uppercase">
                          Consumir avulsos
                        </p>
                        <ul className="mt-2 space-y-1 text-sm font-semibold text-slate-700">
                          <li>
                            {numberFormatter.format(
                              line.autoAssembledQuantity,
                            )}{" "}
                            × servo {line.option.servo.code} —{" "}
                            {line.option.servo.description}
                          </li>
                          <li>
                            {numberFormatter.format(
                              line.autoAssembledQuantity,
                            )}{" "}
                            × kit {line.option.installationKit.code} —{" "}
                            {line.option.installationKit.description}
                          </li>
                        </ul>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-7" aria-labelledby="physical-impact-title">
            <h3
              id="physical-impact-title"
              className="text-base font-black text-slate-950"
            >
              Impacto total nos saldos avulsos
            </h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Soma as saídas físicas diretas e todos os componentes das
              montagens automáticas.
            </p>
            {preview.physicalRequirements.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-950">
                Nenhum saldo avulso será consumido. Todas as unidades
                solicitadas serão atendidas pelo saldo já montado.
              </div>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {preview.physicalRequirements.map((requirement) => (
                  <article
                    key={requirement.item.id}
                    className={`rounded-2xl border p-4 ${
                      requirement.isSufficient
                        ? "border-slate-200 bg-slate-50"
                        : "border-red-300 bg-red-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-950">
                          {requirement.item.code}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">
                          {requirement.item.description}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-black ${
                          requirement.isSufficient
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-red-200 text-red-950"
                        }`}
                      >
                        {requirement.isSufficient
                          ? "Saldo suficiente"
                          : "Saldo insuficiente"}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <dt className="text-[0.65rem] font-black text-slate-500 uppercase">
                          Atual
                        </dt>
                        <dd className="mt-1 font-black text-slate-950">
                          {numberFormatter.format(requirement.item.balance)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[0.65rem] font-black text-slate-500 uppercase">
                          Necessário
                        </dt>
                        <dd className="mt-1 font-black text-slate-950">
                          {numberFormatter.format(
                            requirement.totalQuantity,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[0.65rem] font-black text-slate-500 uppercase">
                          Previsto
                        </dt>
                        <dd
                          className={`mt-1 font-black ${
                            requirement.isSufficient
                              ? "text-emerald-800"
                              : "text-red-800"
                          }`}
                        >
                          {numberFormatter.format(
                            requirement.predictedBalance,
                          )}
                        </dd>
                      </div>
                    </dl>
                    {requirement.directQuantity > 0 &&
                    requirement.autoAssemblyQuantity > 0 ? (
                      <p className="mt-3 text-xs font-bold text-violet-800">
                        {numberFormatter.format(
                          requirement.directQuantity,
                        )}{" "}
                        diretas +{" "}
                        {numberFormatter.format(
                          requirement.autoAssemblyQuantity,
                        )}{" "}
                        para montagem automática
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="mt-5 rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
              Descrição
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-800">
              {description.trim() || "Sem descrição"}
            </p>
          </div>

          <div className="mt-5">
            <Summary
              distinctLines={lines.length}
              totalUnits={preview.totalQuantity}
            />
          </div>

          {preview.autoAssembledQuantity > 0 ? (
            <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <p className="text-xs font-black tracking-wide text-violet-700 uppercase">
                Total de montagens automáticas previstas
              </p>
              <p className="mt-1 text-2xl font-black text-violet-950">
                {numberFormatter.format(preview.autoAssembledQuantity)}
              </p>
            </div>
          ) : null}

          {!preview.isValid ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950"
            >
              <p className="font-black">A saída não pode ser confirmada.</p>
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
              className="order-2 inline-flex min-h-14 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-black text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50 sm:order-1"
            >
              Voltar e corrigir
            </button>
            <button
              type="button"
              onClick={confirmOutbound}
              disabled={isPending || !preview.isValid}
              aria-busy={isPending}
              className="order-1 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-red-700 px-5 text-sm font-black text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-55 sm:order-2"
            >
              {isPending ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                  Registrando saída...
                </>
              ) : (
                "Confirmar saída"
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
        <span className="flex size-9 items-center justify-center rounded-full bg-red-700 text-sm font-black text-white">
          1
        </span>
        <span className="h-1 flex-1 rounded-full bg-slate-200" />
        <span className="flex size-9 items-center justify-center rounded-full bg-slate-200 text-sm font-black text-slate-600">
          2
        </span>
        <p className="sr-only">Edição da saída</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-red-700 uppercase">
              Etapa 1 de 2
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              Selecione itens ou códigos
            </h2>
          </div>

          <label
            htmlFor="outbound-search"
            className="mt-5 block text-sm font-black text-slate-800"
          >
            Pesquisar catálogo
          </label>
          <div className="relative mt-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-slate-500" />
            <input
              id="outbound-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Código, descrição, modelo, servo ou kit"
              className="min-h-13 w-full rounded-2xl border border-slate-300 bg-white pr-4 pl-12 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-3 focus:ring-red-100"
            />
          </div>

          <p className="mt-3 text-xs font-bold text-slate-500" aria-live="polite">
            {!search.trim()
              ? `Mostrando todas as ${numberFormatter.format(filteredOptions.length)} opções`
              : filteredOptions.length === 1
                ? "1 opção encontrada"
                : `${numberFormatter.format(filteredOptions.length)} opções encontradas`}
          </p>

          {filteredOptions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <SearchIcon className="mx-auto size-8 text-slate-400" />
              <h3 className="mt-3 font-black text-slate-950">
                Nenhum resultado
              </h3>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Tente pesquisar por outro código, descrição, modelo, servo ou
                kit.
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

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-red-700 uppercase">
                Saída atual
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-950">
                Linhas e quantidades
              </h2>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-800">
              <OutboundIcon className="size-6" />
            </span>
          </div>

          {lines.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <h3 className="font-black text-slate-950">Carrinho vazio</h3>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Adicione itens físicos ou códigos comerciais para continuar.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {lines.map((line) => {
                const key = getOptionKey(line.option);
                const quantityIsInvalid =
                  parseQuantity(line.quantity) === null;

                return (
                  <article
                    key={key}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <OptionBadge option={line.option} />
                        <p className="mt-2 text-lg font-black text-slate-950">
                          {line.option.code}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs font-bold text-slate-600">
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
                      htmlFor={`quantity-${key}`}
                      className="mt-4 block text-xs font-black tracking-wide text-slate-600 uppercase"
                    >
                      Quantidade
                    </label>
                    <input
                      id={`quantity-${key}`}
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
                          ? `quantity-error-${key}`
                          : undefined
                      }
                      className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-black text-slate-950 outline-none transition focus:border-red-600 focus:ring-3 focus:ring-red-100 aria-invalid:border-red-600 aria-invalid:ring-red-100"
                    />
                    {quantityIsInvalid ? (
                      <p
                        id={`quantity-error-${key}`}
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
            htmlFor="outbound-description"
            className="mt-5 block text-sm font-black text-slate-800"
          >
            Descrição{" "}
            <span className="font-semibold text-slate-500">(opcional)</span>
          </label>
          <textarea
            id="outbound-description"
            value={description}
            onChange={(event) => changeDescription(event.target.value)}
            maxLength={maximumDescriptionLength}
            rows={3}
            placeholder="Ex.: envio para cliente"
            className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-3 focus:ring-red-100"
          />
          <p className="mt-1 text-right text-xs font-bold text-slate-500">
            {description.length}/{maximumDescriptionLength}
          </p>

          <div className="mt-5">
            <Summary
              distinctLines={lines.length}
              totalUnits={totalUnits}
            />
          </div>

          {validationError ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-950"
            >
              {validationError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={reviewOutbound}
            className="mt-5 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-red-700 px-5 text-sm font-black text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-300"
          >
            Revisar saída
          </button>
          <p className="mt-3 text-center text-xs font-bold text-slate-500">
            Revisar não movimenta o estoque.
          </p>
        </div>
      </div>
    </section>
  );
}
