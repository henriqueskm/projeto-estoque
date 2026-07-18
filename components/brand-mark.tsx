type BrandMarkProps = {
  variant?: "compact" | "full";
  size?: "sm" | "md" | "lg";
  inverted?: boolean;
  className?: string;
};

const markSizes = {
  sm: "size-10 text-base",
  md: "size-12 text-lg",
  lg: "size-16 text-2xl",
};

export function BrandMark({
  variant = "full",
  size = "md",
  inverted = false,
  className = "",
}: BrandMarkProps) {
  const compact = variant === "compact";

  return (
    <div
      className={`inline-flex min-w-0 items-center gap-3 ${className}`}
      aria-label={compact ? "NK Servos" : undefined}
      role={compact ? "img" : undefined}
    >
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-full border border-brand-gold/70 bg-brand-charcoal font-black tracking-[-0.14em] shadow-[inset_0_0_0_3px_rgba(255,255,255,0.04),0_8px_24px_-12px_rgba(0,0,0,0.8)] ${markSizes[size]}`}
      >
        <span className="text-white">N</span>
        <span className="pr-0.5 text-brand-gold">K</span>
      </span>

      {!compact ? (
        <span className="min-w-0 leading-none">
          <span
            className={`block truncate text-sm font-black tracking-[0.08em] uppercase sm:text-base ${
              inverted ? "text-white" : "text-brand-charcoal"
            }`}
          >
            NK Servos
          </span>
          <span
            className={`mt-1 block truncate text-[0.65rem] font-bold tracking-[0.12em] uppercase ${
              inverted ? "text-brand-gold" : "text-brand-gold-ink"
            }`}
          >
            Negócios K
          </span>
        </span>
      ) : null}
    </div>
  );
}
