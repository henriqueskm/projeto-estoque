"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  CheckIcon,
  InboundIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import {
  physicalItemTypeLabels,
  type InboundCatalogItem,
  type InboundReceipt,
} from "@/lib/inbound-types";
import { submitStockInbound } from "./actions";

const maximumQuantity = 2_147_483_647;
const maximumDescriptionLength = 500;
const numberFormatter = new Intl.NumberFormat("pt-BR");

type DraftLine = {
  item: InboundCatalogItem;
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

function Summary({
  distinctItems,
  totalUnits,
}: {
  distinctItems: number;
  totalUnits: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
          Itens distintos
        </p>
        <p className="mt-1 text-2xl font-black text-slate-950">
          {numberFormatter.format(distinctItems)}
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

export function InboundEntryFlow({
  catalog,
}: {
  catalog: InboundCatalogItem[];
}) {
  const [step, setStep] = useState<FlowStep>("editing");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<InboundReceipt | null>(null);
  const [isPending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);

  const selectedIds = useMemo(
    () => new Set(lines.map((line) => line.item.id)),
    [lines],
  );

  const filteredCatalog = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);

    if (!normalizedQuery) {
      return catalog;
    }

    return catalog.filter((item) =>
      normalizeSearch(`${item.code} ${item.description}`).includes(
        normalizedQuery,
      ),
    );
  }, [catalog, search]);

  const totalUnits = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + (parseQuantity(line.quantity) ?? 0),
        0,
      ),
    [lines],
  );

  function rotateIdempotencyKey() {
    idempotencyKey.current = globalThis.crypto.randomUUID();
  }

  function markPayloadChanged() {
    rotateIdempotencyKey();
    setValidationError(null);
    setSubmissionError(null);
  }

  function addItem(item: InboundCatalogItem) {
    if (selectedIds.has(item.id) || isPending) {
      return;
    }

    markPayloadChanged();
    setLines((currentLines) => [
      ...currentLines,
      { item, quantity: "1" },
    ]);
  }

  function changeQuantity(itemId: string, quantity: string) {
    if (isPending) {
      return;
    }

    markPayloadChanged();
    setLines((currentLines) =>
      currentLines.map((line) =>
        line.item.id === itemId ? { ...line, quantity } : line,
      ),
    );
  }

  function removeItem(itemId: string) {
    if (isPending) {
      return;
    }

    markPayloadChanged();
    setLines((currentLines) =>
      currentLines.filter((line) => line.item.id !== itemId),
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
      return "Adicione pelo menos um item à entrada.";
    }

    if (lines.some((line) => parseQuantity(line.quantity) === null)) {
      return "Revise as quantidades. Use somente números inteiros e positivos.";
    }

    if (description.trim().length > maximumDescriptionLength) {
      return `A descrição deve ter no máximo ${maximumDescriptionLength} caracteres.`;
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

  function confirmEntry() {
    if (isPending) {
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
    setSubmissionError(null);

    const items = lines.map((line) => ({
      item_id: line.item.id,
      quantity: parseQuantity(line.quantity) as number,
    }));

    startTransition(async () => {
      try {
        const result = await submitStockInbound({
          p_items: items,
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
          Entrada registrada
        </h2>
        <p className="mt-2 font-semibold text-slate-600">
          O estoque foi atualizado e o histórico da movimentação foi criado.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
            Movement batch ID
          </p>
          <p className="mt-2 break-all font-mono text-sm font-bold text-slate-950">
            {receipt.movementBatchId}
          </p>
        </div>

        <div className="mt-4">
          <Summary
            distinctItems={receipt.itemsProcessed}
            totalUnits={receipt.totalQuantity}
          />
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={startNewEntry}
            className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-blue-700 px-5 text-sm font-black text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-blue-300"
          >
            Nova entrada
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
      <section className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center gap-3" aria-label="Etapa 2 de 2">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-700 text-sm font-black text-white">
            <CheckIcon className="size-5" />
          </span>
          <span className="h-1 flex-1 rounded-full bg-blue-700" />
          <span className="flex size-9 items-center justify-center rounded-full bg-blue-700 text-sm font-black text-white">
            2
          </span>
          <p className="sr-only">Revisão antes da confirmação</p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-black tracking-[0.16em] text-blue-700 uppercase">
            Etapa 2 de 2
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
            Revise antes de confirmar
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            A movimentação só acontecerá ao selecionar “Confirmar entrada”.
          </p>

          <div className="mt-6 space-y-3">
            {lines.map((line) => (
              <article
                key={line.item.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-blue-900 uppercase">
                      {physicalItemTypeLabels[line.item.itemType]}
                    </span>
                    <p className="mt-2 text-xl font-black text-slate-950">
                      {line.item.code}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-600">
                      {line.item.description}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-xl bg-slate-950 px-3 py-2 text-right text-white">
                    <p className="text-[0.65rem] font-black tracking-wide text-slate-300 uppercase">
                      Quantidade
                    </p>
                    <p className="text-xl font-black">
                      {numberFormatter.format(
                        parseQuantity(line.quantity) ?? 0,
                      )}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-black tracking-wide text-slate-500 uppercase">
              Descrição
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-800">
              {description.trim() || "Sem descrição"}
            </p>
          </div>

          <div className="mt-5">
            <Summary distinctItems={lines.length} totalUnits={totalUnits} />
          </div>

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
              onClick={confirmEntry}
              disabled={isPending}
              aria-busy={isPending}
              className="order-1 inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 text-sm font-black text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:opacity-70 sm:order-2"
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
        <span className="flex size-9 items-center justify-center rounded-full bg-blue-700 text-sm font-black text-white">
          1
        </span>
        <span className="h-1 flex-1 rounded-full bg-slate-200" />
        <span className="flex size-9 items-center justify-center rounded-full bg-slate-200 text-sm font-black text-slate-600">
          2
        </span>
        <p className="sr-only">Edição da entrada</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-blue-700 uppercase">
              Etapa 1 de 2
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              Selecione os itens
            </h2>
          </div>

          <label
            htmlFor="inbound-search"
            className="mt-5 block text-sm font-black text-slate-800"
          >
            Pesquisar catálogo
          </label>
          <div className="relative mt-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-slate-500" />
            <input
              id="inbound-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Código ou descrição"
              className="min-h-13 w-full rounded-2xl border border-slate-300 bg-white pr-4 pl-12 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
            />
          </div>

          <p className="mt-3 text-xs font-bold text-slate-500" aria-live="polite">
            {filteredCatalog.length === 1
              ? "1 item encontrado"
              : `${numberFormatter.format(filteredCatalog.length)} itens encontrados`}
          </p>

          {filteredCatalog.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <SearchIcon className="mx-auto size-8 text-slate-400" />
              <h3 className="mt-3 font-black text-slate-950">
                Nenhum resultado
              </h3>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Tente pesquisar por outro código ou descrição.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {filteredCatalog.map((item) => {
                const isSelected = selectedIds.has(item.id);

                return (
                  <article
                    key={item.id}
                    className="flex min-h-52 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-blue-900 uppercase">
                        {physicalItemTypeLabels[item.itemType]}
                      </span>
                      <span className="text-right text-xs font-black text-slate-600">
                        Saldo: {numberFormatter.format(item.balance)}
                      </span>
                    </div>
                    <p className="mt-3 text-xl font-black text-slate-950">
                      {item.code}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-600">
                      {item.description}
                    </p>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      disabled={isSelected}
                      className="mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-black text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-blue-300 disabled:cursor-default disabled:bg-emerald-100 disabled:text-emerald-900"
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
              })}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-blue-700 uppercase">
                Entrada atual
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-950">
                Itens e quantidades
              </h2>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-800">
              <InboundIcon className="size-6" />
            </span>
          </div>

          {lines.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <h3 className="font-black text-slate-950">Carrinho vazio</h3>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Adicione um ou mais itens do catálogo para continuar.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {lines.map((line) => {
                const quantityIsInvalid =
                  parseQuantity(line.quantity) === null;

                return (
                  <article
                    key={line.item.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-black text-slate-950">
                          {line.item.code}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs font-bold text-slate-600">
                          {line.item.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(line.item.id)}
                        aria-label={`Remover ${line.item.code}`}
                        className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-800 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-200"
                      >
                        <TrashIcon className="size-5" />
                      </button>
                    </div>

                    <label
                      htmlFor={`quantity-${line.item.id}`}
                      className="mt-4 block text-xs font-black tracking-wide text-slate-600 uppercase"
                    >
                      Quantidade
                    </label>
                    <input
                      id={`quantity-${line.item.id}`}
                      type="number"
                      min="1"
                      max={maximumQuantity}
                      step="1"
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(event) =>
                        changeQuantity(line.item.id, event.target.value)
                      }
                      aria-invalid={quantityIsInvalid}
                      aria-describedby={
                        quantityIsInvalid
                          ? `quantity-error-${line.item.id}`
                          : undefined
                      }
                      className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-black text-slate-950 outline-none transition focus:border-blue-600 focus:ring-3 focus:ring-blue-100 aria-invalid:border-red-600 aria-invalid:ring-red-100"
                    />
                    {quantityIsInvalid ? (
                      <p
                        id={`quantity-error-${line.item.id}`}
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
            className="mt-5 block text-sm font-black text-slate-800"
          >
            Descrição{" "}
            <span className="font-semibold text-slate-500">(opcional)</span>
          </label>
          <textarea
            id="inbound-description"
            value={description}
            onChange={(event) => changeDescription(event.target.value)}
            maxLength={maximumDescriptionLength}
            rows={3}
            placeholder="Ex.: recebimento do fornecedor"
            className="mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
          />
          <p className="mt-1 text-right text-xs font-bold text-slate-500">
            {description.length}/{maximumDescriptionLength}
          </p>

          <div className="mt-5">
            <Summary distinctItems={lines.length} totalUnits={totalUnits} />
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
            onClick={reviewEntry}
            className="mt-5 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-blue-700 px-5 text-sm font-black text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-blue-300"
          >
            Revisar entrada
          </button>
        </div>
      </div>
    </section>
  );
}
