import Link from "next/link";
import type {
  AssistantAttentionItem,
  AssistantAttentionSummary,
} from "@/lib/assistant-attention";

type AssistantAttentionSummaryProps = {
  attention: AssistantAttentionSummary | null;
  attentionError: string | null;
  firstName: string | null;
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

function AttentionCard({ item }: { item: AssistantAttentionItem }) {
  const presentation = severityPresentation[item.severity];

  return (
    <Link
      href={item.href}
      className="nk-focus group relative flex min-h-24 overflow-hidden rounded-xl border border-border-neutral bg-surface px-4 py-3 shadow-sm transition hover:border-brand-gold-dark hover:shadow-md"
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
          Ver detalhes
        </span>
      </span>
    </Link>
  );
}

export function AssistantAttentionSummaryView({
  attention,
  attentionError,
  firstName,
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
            <AttentionCard key={item.kind} item={item} />
          ))}
        </section>
      ) : null}

      <p className="mt-5 text-center text-sm font-semibold text-text-muted">
        Se precisar de outra coisa, é só me perguntar.
      </p>
    </div>
  );
}
