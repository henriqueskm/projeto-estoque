import Link from "next/link";
import { ChevronDownIcon } from "@/components/icons";
import type {
  AssistantAttentionItem,
  AssistantAttentionSummary,
} from "@/lib/assistant-attention";

type AssistantAttentionSummaryProps = {
  attention: AssistantAttentionSummary | null;
  attentionError: string | null;
  firstName: string | null;
  onAttentionSelect: (item: AssistantAttentionItem) => void;
};

const severityPresentation = {
  CRITICAL: {
    label: "Prioridade máxima",
    accent: "bg-red-700",
    badge: "border-red-200 bg-red-50 text-red-900",
  },
  HIGH: {
    label: "Alta prioridade",
    accent: "bg-amber-600",
    badge: "border-amber-200 bg-amber-50 text-amber-950",
  },
  MEDIUM: {
    label: "Acompanhar",
    accent: "bg-sky-700",
    badge: "border-sky-200 bg-sky-50 text-sky-950",
  },
  INFO: {
    label: "Informação",
    accent: "bg-slate-500",
    badge: "border-slate-200 bg-slate-50 text-slate-900",
  },
} satisfies Record<
  AssistantAttentionItem["severity"],
  { label: string; accent: string; badge: string }
>;

function greeting(generatedAt: string | null) {
  if (!generatedAt) return "Olá";

  const hourPart = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  })
    .formatToParts(new Date(generatedAt))
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);

  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

const quantityFormatter = new Intl.NumberFormat("pt-BR");

function ReplenishmentAttention({ item }: {
  item: Extract<AssistantAttentionItem, { kind: "REPLENISHMENT_NEEDED" }>;
}) {
  const presentation = severityPresentation[item.severity];
  return (
    <details className="group min-w-0 rounded-xl border border-border-neutral bg-surface">
      <summary className="nk-focus flex min-h-24 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-app-background [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm font-black text-text-primary sm:text-base">{item.title}</strong>
            <span className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-black ${presentation.badge}`}>{presentation.label}</span>
          </span>
          <span className="mt-1 block text-sm font-semibold text-text-muted">
            {quantityFormatter.format(item.count)} {item.count === 1 ? "item para repor" : "itens para repor"}
            {item.metadata.zeroStockCount > 0 ? ` · ${quantityFormatter.format(item.metadata.zeroStockCount)} sem estoque` : ""}
          </span>
          <span className="mt-2 block text-xs font-bold text-brand-gold-ink group-open:hidden">Ver todos os itens</span>
          <span className="mt-2 hidden text-xs font-bold text-brand-gold-ink group-open:block">Ocultar itens</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="min-w-0 border-t border-border-neutral px-3 pb-3 sm:px-4 sm:pb-4">
        <table className="w-full table-fixed text-left">
          <caption className="sr-only">Todos os itens que precisam de reposição</caption>
          <colgroup><col /><col className="w-10 sm:w-14" /><col className="w-10 sm:w-14" /><col className="w-14 sm:w-20" /></colgroup>
          <thead>
            <tr className="text-[0.65rem] font-bold text-text-muted sm:text-xs">
              <th scope="col" className="py-2 pr-2">Item</th>
              <th scope="col" className="py-2 text-right">Saldo</th>
              <th scope="col" className="py-2 text-right"><abbr title="Estoque mínimo" className="no-underline">Mín.</abbr></th>
              <th scope="col" className="py-2 text-right">Comprar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-neutral">
            {item.detail.lines.map((line) => (
              <tr key={line.code}>
                <th scope="row" className="py-2 pr-2 font-normal">
                  <span className="block break-all font-mono text-sm font-black text-text-primary">{line.code}</span>
                  <span title={line.description} className="mt-0.5 line-clamp-2 break-words text-xs leading-4 text-text-muted">{line.description}</span>
                  {line.pendingPurchaseQuantity > 0 ? <span className="mt-0.5 block text-[0.65rem] text-text-muted">Em Pedidos: {quantityFormatter.format(line.pendingPurchaseQuantity)}</span> : null}
                </th>
                <td className="break-all py-2 text-right font-mono text-sm font-bold tabular-nums text-text-primary">{quantityFormatter.format(line.currentStock)}</td>
                <td className="break-all py-2 text-right font-mono text-sm font-bold tabular-nums text-text-primary">{quantityFormatter.format(line.minimumStock)}</td>
                <td className="break-all py-2 text-right font-mono text-sm font-black tabular-nums text-red-700">{quantityFormatter.format(line.remainingGap)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs leading-4 text-text-muted">Comprar já considera as quantidades em Pedidos.</p>
        <Link href="/estoque?view=purchase-recommendations" className="nk-focus mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-brand-gold-dark px-3 text-sm font-bold text-brand-gold-ink transition hover:bg-brand-gold-soft">
          Abrir lista recomendada
        </Link>
      </div>
    </details>
  );
}

function AttentionCard({
  item,
  onSelect,
}: {
  item: AssistantAttentionItem;
  onSelect: (item: AssistantAttentionItem) => void;
}) {
  const presentation = severityPresentation[item.severity];

  return (
    <button
      type="button"
      aria-label={`Mostrar ${item.title.toLocaleLowerCase("pt-BR")} no chat`}
      onClick={() => onSelect(item)}
      className="nk-focus group relative flex min-h-24 w-full overflow-hidden rounded-xl border border-border-neutral bg-surface px-4 py-3 text-left shadow-sm transition hover:border-brand-gold-dark hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${presentation.accent}`}
      />
      <span className="flex min-w-0 flex-1 flex-col pl-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm font-black text-text-primary sm:text-base">
            {item.title}
          </strong>
          <span
            className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-black ${presentation.badge}`}
          >
            {presentation.label}
          </span>
        </span>
        <span className="mt-1 text-sm font-semibold leading-5 text-text-muted">
          {item.summary}
        </span>
        <span className="mt-2 text-xs font-black text-brand-gold-ink group-hover:underline">
          Ver no chat
        </span>
      </span>
    </button>
  );
}

export function AssistantAttentionSummaryView({
  attention,
  attentionError,
  firstName,
  onAttentionSelect,
}: AssistantAttentionSummaryProps) {
  const salutation = `${greeting(attention?.generatedAt ?? null)}${
    firstName ? `, ${firstName}` : ""
  }.`;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-5 text-center sm:mb-7">
        <p className="text-xl font-black tracking-tight text-text-primary sm:text-2xl">
          {salutation}
        </p>
        {attention?.status === "HAS_ATTENTION" ? (
          <p className="mt-1 text-sm font-semibold text-text-muted sm:text-base">
            Encontrei {attention.items.length} {attention.items.length === 1 ? "ponto que merece" : "pontos que merecem"} sua atenção.
          </p>
        ) : attention?.status === "ALL_CLEAR" ? (
          <>
            <p className="mt-2 text-base font-black text-text-primary">
              Tudo em dia por aqui.
            </p>
            <p className="mt-1 text-sm font-semibold text-text-muted">
              Não encontrei nenhuma pendência importante agora.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm font-semibold text-text-muted">
            {attentionError ?? "Não foi possível conferir as pendências agora."}
          </p>
        )}
      </div>

      {attention?.status === "HAS_ATTENTION" ? (
        <section
          aria-labelledby="assistant-attention-heading"
          className="space-y-2.5"
        >
          <h2 id="assistant-attention-heading" className="sr-only">
            O que precisa da minha atenção hoje?
          </h2>
          {attention.items.map((item) => (
            item.kind === "REPLENISHMENT_NEEDED" ? <ReplenishmentAttention key={item.kind} item={item} /> : <AttentionCard
              key={item.kind}
              item={item}
              onSelect={onAttentionSelect}
            />
          ))}
        </section>
      ) : null}

      <p className="mt-5 text-center text-sm font-semibold text-text-muted">
        Se precisar de outra coisa, é só me perguntar.
      </p>
    </div>
  );
}
