import type { ReactNode } from "react";

const numberFormatter = new Intl.NumberFormat("pt-BR");

/**
 * Phone-only "current → predicted" line for review cards. The desktop keeps
 * its three-column breakdown; this replaces it below `sm`.
 */
export function StockFlowBalanceChange({
  label,
  current,
  predicted,
  isValid,
  tone,
}: {
  label: string;
  current: number;
  predicted: number;
  isValid: boolean;
  tone: "inbound" | "outbound" | "configuration";
}) {
  const predictedClassName = !isValid
    ? "text-red-800"
    : tone === "configuration"
      ? "text-violet-900"
      : tone === "inbound"
        ? "text-emerald-800"
        : "text-text-primary";

  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 rounded-xl bg-surface px-3 py-2.5 text-base font-bold text-text-muted sm:hidden">
      <span>{label}:</span>
      <span className="font-mono text-xl font-black text-text-primary">
        {numberFormatter.format(current)}
      </span>
      <span aria-hidden="true">→</span>
      <span className="sr-only">passa para</span>
      <span className={`font-mono text-xl font-black ${predictedClassName}`}>
        {numberFormatter.format(predicted)}
      </span>
      {isValid ? null : <span className="text-red-800">(saldo insuficiente)</span>}
    </p>
  );
}

/** Stepper buttons that wrap a quantity input with big touch targets. */
export function StockFlowQuantityStepper({
  code,
  quantity,
  maximum,
  onChange,
  children,
}: {
  code: string;
  quantity: number | null;
  maximum: number;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const buttonClassName =
    "nk-focus flex size-12 shrink-0 items-center justify-center rounded-xl border border-border-neutral bg-surface text-2xl font-black text-text-primary transition hover:bg-app-background disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-2 flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => onChange(String(Math.max(1, (quantity ?? 2) - 1)))}
        disabled={quantity !== null && quantity <= 1}
        aria-label={`Diminuir quantidade de ${code}`}
        className={buttonClassName}
      >
        <span aria-hidden="true">−</span>
      </button>
      {children}
      <button
        type="button"
        onClick={() => onChange(String(Math.min(maximum, (quantity ?? 0) + 1)))}
        disabled={quantity !== null && quantity >= maximum}
        aria-label={`Aumentar quantidade de ${code}`}
        className={buttonClassName}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
