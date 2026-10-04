"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type SetStateAction } from "react";
import { useRouteTransientCleanup } from "@/components/route-transient-state";
import { useStockFlowWorkspace } from "@/components/use-stock-flow-workspace";
import {
  CheckIcon,
  InboundIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import { StockFlowBundleReview } from "@/components/stock-flow-bundles";
import { StockFlowSearchResults } from "@/components/stock-flow-search-results";
import { StockFlowCartShortcut } from "@/components/stock-flow-cart-shortcut";
import { dismissSearchKeyboard } from "@/lib/search-input";
import { assessNewLoosePartCode } from "@/lib/catalog-code-policy";
import {
  buildInboundPreview,
  type InboundPreviewInputLine,
} from "@/lib/inbound-preview";
import {
  type InboundCatalog,
  type InboundCatalogOption,
  type InboundNewLoosePart,
  type InboundReceipt,
  type InboundRequestLine,
  type PhysicalItemType,
} from "@/lib/inbound-types";
import { submitStockInbound } from "./actions";

const maximumQuantity = 2_147_483_647;
const maximumDescriptionLength = 500;
const maximumItemCodeLength = 120;
const maximumSearchLength = 120;
const maximumLines = 500;
const numberFormatter = new Intl.NumberFormat("pt-BR");

type FlowStep = "editing" | "review" | "success";

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
  if (option.kind === "BUNDLE_CODE") return `BUNDLE_CODE:${option.bundleCodeId}`;
  if (option.kind === "ITEM") {
    return `ITEM:${option.id}`;
  }

  if (option.kind === "NEW_LOOSE_PART") {
    return `NEW_LOOSE_PART:${option.code}`;
  }

  return `COMMERCIAL_CODE:${option.commercialCodeId}`;
}

function getQuantityControlId(option: InboundCatalogOption) {
  return `inbound-quantity-${getOptionKey(option).replace(":", "-")}`;
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
  return option.kind === "ITEM" || option.kind === "NEW_LOOSE_PART" ? (
    <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-emerald-950 uppercase">
      {option.kind === "NEW_LOOSE_PART"
        ? "Nova peça avulsa"
        : option.itemType === "REPAIR_KIT"
          ? "Reparo"
          : "Item separado"}
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-violet-200 px-2.5 py-1 text-[0.65rem] font-black tracking-wide text-violet-950 uppercase">
      {option.kind === "BUNDLE_CODE" ? "Conjunto" : "Servo com kit"}
    </span>
  );
}

export function InboundEntryFlow({
  catalog,
}: {
  catalog: InboundCatalog;
}) {
  const router = useRouter();
  const workspace = useStockFlowWorkspace<InboundCatalogOption>("entrada", catalog);
  const { search, description } = workspace.state;
  const { lines, setLines } = workspace;
  const [receipt, setReceipt] = useState<InboundReceipt | null>(null);
  const step: FlowStep = receipt ? "success" : workspace.state.step;
  const setStep = (value: FlowStep) => { if (value !== "success") workspace.setField("step", value); };
  const setSearch = (value: string) => workspace.setField("search", value);
  const setDescription = (value: string) => workspace.setField("description", value);
  const { isNewLoosePartOpen, newLoosePartCode, newLoosePartDescription, newLoosePartQuantity } = workspace.state;
  const setIsNewLoosePartOpen = (value: SetStateAction<boolean>) => workspace.setField("isNewLoosePartOpen", value);
  const setNewLoosePartCode = (value: string) => workspace.setField("newLoosePartCode", value);
  const setNewLoosePartDescription = (value: string) => workspace.setField("newLoosePartDescription", value);
  const setNewLoosePartQuantity = (value: string) => workspace.setField("newLoosePartQuantity", value);
  const [newLoosePartError, setNewLoosePartError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submissionInFlight = useRef(false);
  const visit = useRouteTransientCleanup(() => {
    setReceipt(null);
    setNewLoosePartError(null);
    setValidationError(null);
    setSubmissionError(null);
    // Do not clear the draft, rotate its key or release the in-flight guard.
  });

  const selectedKeys = useMemo(
    () => new Set(lines.map((line) => getOptionKey(line.option))),
    [lines],
  );
  const searchOptions = useMemo(
    () => [...catalog.physicalItems, ...catalog.commercialCodes, ...catalog.bundleCodes],
    [catalog.physicalItems, catalog.commercialCodes, catalog.bundleCodes],
  );
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
    workspace.setField("idempotencyKey", globalThis.crypto.randomUUID());
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

  function addNewLoosePart() {
    if (isPending) {
      return;
    }

    const code = newLoosePartCode.trim();
    const loosePartDescription = newLoosePartDescription.trim();
    const quantity = parseQuantity(newLoosePartQuantity);

    if (!code || code.length > maximumItemCodeLength) {
      setNewLoosePartError(
        `Informe um código com até ${maximumItemCodeLength} caracteres.`,
      );
      return;
    }

    if (
      !loosePartDescription ||
      loosePartDescription.length > maximumDescriptionLength
    ) {
      setNewLoosePartError(
        `Informe uma descrição com até ${maximumDescriptionLength} caracteres.`,
      );
      return;
    }

    if (quantity === null) {
      setNewLoosePartError(
        "Informe uma quantidade inteira maior que zero.",
      );
      return;
    }

    const existingItem = catalog.physicalItems.find(
      (item) => item.code === code,
    );

    const assessment = assessNewLoosePartCode([
      ...catalog.physicalItems, ...catalog.commercialCodes, ...catalog.bundleCodes,
    ], code);
    if (!existingItem && !assessment.allowed) {
      setNewLoosePartError("Este código já pertence ao catálogo oficial ou não possui uma identidade válida. Selecione o produto existente.");
      return;
    }

    if (existingItem) {
      if (existingItem.itemType !== "LOOSE_PART") {
        setNewLoosePartError(
          `O código ${code} já pertence a outro tipo de item.`,
        );
        return;
      }

      if (
        existingItem.description.trim().toLocaleLowerCase("pt-BR") !==
        loosePartDescription.toLocaleLowerCase("pt-BR")
      ) {
        setNewLoosePartError(
          `O código ${code} já existe com outra descrição. O cadastro atual não será substituído.`,
        );
        return;
      }

      if (selectedKeys.has(getOptionKey(existingItem))) {
        setNewLoosePartError(
          `${code} já está na entrada. Ajuste a quantidade no carrinho.`,
        );
        return;
      }

      markPayloadChanged();
      setLines((currentLines) => [
        ...currentLines,
        { option: existingItem, quantity: String(quantity) },
      ]);
    } else {
      const newLoosePart: InboundNewLoosePart = {
        kind: "NEW_LOOSE_PART",
        code,
        description: loosePartDescription,
        itemType: "LOOSE_PART",
        model: null,
        balance: 0,
      };

      if (selectedKeys.has(getOptionKey(newLoosePart))) {
        setNewLoosePartError(
          `${code} já está na entrada. Ajuste a quantidade no carrinho.`,
        );
        return;
      }

      markPayloadChanged();
      setLines((currentLines) => [
        ...currentLines,
        { option: newLoosePart, quantity: String(quantity) },
      ]);
    }

    setNewLoosePartCode("");
    setNewLoosePartDescription("");
    setNewLoosePartQuantity("1");
    setNewLoosePartError(null);
    setIsNewLoosePartOpen(false);
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
    workspace.cancelScrollRestore();
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
    workspace.cancelScrollRestore();
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
      if (line.option.kind === "BUNDLE_CODE") return { kind: "BUNDLE_CODE", bundle_code_id: line.option.bundleCodeId, quantity };

      if (line.option.kind === "ITEM") {
        return {
          kind: "ITEM",
          item_id: line.option.id,
          quantity,
        } as const;
      }

      if (line.option.kind === "NEW_LOOSE_PART") {
        return {
          kind: "NEW_LOOSE_PART",
          code: line.option.code,
          description: line.option.description,
          quantity,
        } as const;
      }

      return {
        kind: "COMMERCIAL_CODE",
        commercial_code_id: line.option.commercialCodeId,
        quantity,
      } as const;
    });
  }

  function confirmEntry() {
    if (workspace.needsReconciliation) return;
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
      workspace.state.idempotencyKey ?? globalThis.crypto.randomUUID();
    workspace.setField("idempotencyKey", key);
    workspace.persistNow();
    submissionInFlight.current = true;
    setSubmissionError(null);
    const isCurrentVisit = visit.capture();

    startTransition(async () => {
      try {
        const result = await submitStockInbound({
          p_lines: buildRequestLines(),
          p_idempotency_key: key,
          p_description: description.trim() || null,
        });

        if (!result.ok) {
          if (isCurrentVisit()) setSubmissionError(result.error);
          return;
        }

        workspace.clear();
        if (!isCurrentVisit()) return;
        workspace.cancelScrollRestore();
        setReceipt(result.receipt);
        setStep("success");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        if (!isCurrentVisit()) return;
        setSubmissionError(
          "A comunicação foi interrompida. Tente confirmar novamente.",
        );
      } finally {
        submissionInFlight.current = false;
      }
    });
  }

  function startNewEntry() {
    workspace.clear();
    workspace.cancelScrollRestore();
    setLines([]);
    setDescription("");
    setSearch("");
    setIsNewLoosePartOpen(false);
    setNewLoosePartCode("");
    setNewLoosePartDescription("");
    setNewLoosePartQuantity("1");
    setNewLoosePartError(null);
    setValidationError(null);
    setSubmissionError(null);
    setReceipt(null);
    rotateIdempotencyKey();
    setStep("editing");
    router.refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderNewLoosePartForm() {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => {
            setIsNewLoosePartOpen((current) => !current);
            setNewLoosePartError(null);
          }}
          aria-expanded={isNewLoosePartOpen}
          aria-controls="new-loose-part-form"
          className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl border border-border-neutral px-3 text-sm font-bold text-text-primary transition hover:bg-app-background"
        >
          Nova peça avulsa
        </button>

        {isNewLoosePartOpen ? (
          <div id="new-loose-part-form" className="mt-3 grid gap-4 rounded-xl border border-border-neutral bg-app-background p-4">
            <div>
              <label
                htmlFor="new-loose-part-code"
                className="block text-sm font-black text-text-primary"
              >
                Código
              </label>
              <input
                id="new-loose-part-code"
                value={newLoosePartCode}
                required
                maxLength={maximumItemCodeLength}
                onChange={(event) => {
                  setNewLoosePartCode(event.target.value);
                  setNewLoosePartError(null);
                }}
                className="nk-field mt-2 min-h-12 w-full rounded-xl border px-4 font-mono text-base font-black outline-none transition"
              />
            </div>
            <div>
              <label
                htmlFor="new-loose-part-description"
                className="block text-sm font-black text-text-primary"
              >
                Descrição
              </label>
              <input
                id="new-loose-part-description"
                value={newLoosePartDescription}
                required
                maxLength={maximumDescriptionLength}
                onChange={(event) => {
                  setNewLoosePartDescription(event.target.value);
                  setNewLoosePartError(null);
                }}
                className="nk-field mt-2 min-h-12 w-full rounded-xl border px-4 text-base font-semibold outline-none transition"
              />
            </div>
            <div>
              <label
                htmlFor="new-loose-part-quantity"
                className="block text-sm font-black text-text-primary"
              >
                Quantidade
              </label>
              <input
                id="new-loose-part-quantity"
                type="number"
                min="1"
                max={maximumQuantity}
                step="1"
                inputMode="numeric"
                value={newLoosePartQuantity}
                required
                onChange={(event) => {
                  setNewLoosePartQuantity(event.target.value);
                  setNewLoosePartError(null);
                }}
                className="nk-field mt-2 min-h-12 w-full rounded-xl border px-4 text-base font-black outline-none transition"
              />
            </div>
            <p className="text-xs font-semibold text-text-muted">
              O cadastro e a entrada só serão efetivados juntos após a
              confirmação. Se o código já existir, o banco validará o tipo e
              a descrição antes de reutilizá-lo.
            </p>
            {newLoosePartError ? (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-950"
              >
                {newLoosePartError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={addNewLoosePart}
              className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
            >
              Adicionar à entrada
            </button>
          </div>
        ) : null}
      </div>
    );
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
              Servos com kit
            </p>
            <p className="mt-1 text-2xl font-black text-violet-950">
              {numberFormatter.format(receipt.commercialQuantity)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs font-semibold text-text-muted">
          “Unidades informadas” soma as quantidades das linhas. Cada Servo com kit
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
                    key={getOptionKey(line.option)}
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
                        {line.option.kind === "NEW_LOOSE_PART" ? (
                          <p className="mt-2 text-xs font-bold text-emerald-800">
                            O item e o subtipo de peça avulsa serão criados na
                            mesma transação desta entrada.
                          </p>
                        ) : null}
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

          <StockFlowBundleReview lines={preview.bundleLines} direction="INBOUND" />
          {preview.commercialLines.length > 0 ? (
            <section className="mt-7" aria-labelledby="inbound-review-boxes">
              <h3
                id="inbound-review-boxes"
                className="text-lg font-black text-text-primary"
              >
                Servos recebidos com kit
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
                      Servos com kit — impacto consolidado
                    </p>
                    <p className="mt-1 font-mono text-lg font-black text-violet-950">
                      {impact.requestedCodes.join(" + ")}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-text-muted">
                      {impact.requestedCodes.length > 1
                        ? "Os aliases selecionados compartilham o mesmo saldo montado."
                        : "Saldo atual e previsto dos Servos com kit."}
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
                Os Servos com kit serão registrados como já montados. Os
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
        <div className="min-w-0 sm:rounded-3xl sm:border sm:border-border-neutral sm:bg-surface sm:p-6 sm:shadow-sm">
          <div>
            <h2 className="text-xl font-black text-text-primary">
              Selecione peças ou Servos com kit
            </h2>
          </div>

          <div className="mt-3 px-1 text-xs leading-5 font-semibold text-text-muted sm:mt-5 sm:rounded-2xl sm:border sm:border-brand-gold/40 sm:bg-brand-gold-soft/55 sm:p-4 sm:text-sm sm:font-bold sm:text-brand-charcoal">
            Use o código comercial quando o Servo chegar com kit. Se
            as peças chegarem separadas, adicione os códigos físicos.
          </div>

          <div className="mt-4 sm:mt-5">
            <label
              htmlFor="inbound-search"
              className="block text-sm font-black text-text-primary"
            >
              Pesquisar itens
            </label>
            <div className="relative mt-2">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
              <input
                id="inbound-search"
                type="search"
                enterKeyHint="search"
                onKeyDown={dismissSearchKeyboard}
                value={search}
                maxLength={maximumSearchLength}
                onChange={(event) =>
                  setSearch(event.target.value.slice(0, maximumSearchLength))
                }
                placeholder="Código, descrição, modelo, servo ou kit"
                className="nk-field min-h-13 w-full rounded-2xl border pr-4 pl-12 text-base font-semibold outline-none transition placeholder:text-text-muted"
              />
            </div>
          </div>

          {renderNewLoosePartForm()}
          <StockFlowCartShortcut count={lines.length} headingId="inbound-cart-title" />
          {workspace.reconciliationNotice ? <p role="status" className="mb-3 text-sm font-bold text-amber-900">Um item salvo neste rascunho não está mais disponível e foi removido. Revise os itens antes de confirmar.</p> : null}
          <StockFlowSearchResults options={searchOptions} search={search} selectedKeys={selectedKeys} onAdd={addOption} />
        </div>

        <div className="min-w-0 rounded-3xl border border-border-neutral bg-surface p-4 shadow-sm sm:p-6 lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-brand-gold-ink uppercase">
                Entrada atual
              </p>
              <h2 id="inbound-cart-title" tabIndex={-1} className="nk-focus mt-1 scroll-mt-20 text-xl font-black text-text-primary">
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
                Adicione itens separados ou Servos com kit para continuar.
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
                      line.option.kind === "ITEM" ||
                      line.option.kind === "NEW_LOOSE_PART"
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
